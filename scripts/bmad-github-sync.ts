// Policy contract for this runner lives in scripts/bmad-github-sync.md.
// Project field schema reference lives in scripts/bmad-project-schema.yaml.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

type ItemType = "epic" | "story";
type ProjectFieldType =
  | "single_select"
  | "text"
  | "date"
  | "iteration"
  | "number"
  | "person";

type SyncItem = {
  type: ItemType;
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  effort?: string;
  milestone?: string;
  epicId?: string;
  bmadFile: string;
  bmadSha: string;
  importantLinks: string[];
};

type SummaryRecord = {
  file: string;
  id?: string;
  issue?: number;
  title?: string;
  error?: string;
};

type Summary = {
  created: SummaryRecord[];
  updated: SummaryRecord[];
  closed: SummaryRecord[];
  skipped: SummaryRecord[];
  errored: SummaryRecord[];
};

type Issue = {
  number: number;
  node_id: string;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: Array<{ name?: string }>;
  pull_request?: unknown;
};

type Frontmatter = Record<string, string | string[] | boolean | number | null>;

type ProjectField = {
  id: string;
  name: string;
  type: ProjectFieldType;
  optionsByName: Map<string, string>;
};

type ProjectContext = {
  id: string;
  title: string;
  fieldsByName: Map<string, ProjectField>;
  itemIdByIssueNodeId: Map<string, string>;
};

type ProjectItem = {
  id: string;
  content?: {
    __typename: string;
    id: string;
  };
};

const DRY_RUN =
  process.argv.includes("--dry-run") ||
  process.env.BMAD_SYNC_DRY_RUN === "true";
const SHOW_HELP =
  process.argv.includes("--help") || process.argv.includes("-h");
const SUMMARY_PATH =
  process.env.BMAD_SYNC_SUMMARY_PATH || "bmad-sync-summary.json";
const ARCHIVE_DIR = process.env.BMAD_SYNC_ARCHIVE_DIR || ".artifacts/bmad-sync";
const ADMIN_ISSUE_NUMBER = process.env.BMAD_ADMIN_ISSUE_NUMBER || "";
const PROJECT_SCHEMA_PATH =
  process.env.BMAD_PROJECT_SCHEMA_PATH || "scripts/bmad-project-schema.yaml";
const ENABLE_PROJECT_SYNC =
  (process.env.BMAD_PROJECT_SYNC || "true").toLowerCase() !== "false";

const DEFAULT_STATUS = "backlog";
const DEFAULT_PRIORITY = "medium";
const MANAGED_LABEL_PREFIXES = ["bmad:", "type:", "status:", "priority:"];
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".tmp",
  ".artifacts",
]);

const summary: Summary = {
  created: [],
  updated: [],
  closed: [],
  skipped: [],
  errored: [],
};

function printHelp(): void {
  console.log(
    [
      "BMAD -> GitHub local sync runner",
      "",
      "Usage:",
      "  npm run bmad:sync",
      "  npm run bmad:sync:dry",
      "  npm run bmad:sync -- --dry-run",
      "",
      "Required environment:",
      "  GITHUB_TOKEN or GH_TOKEN",
      "  GITHUB_REPOSITORY=owner/repo (optional if origin remote can be parsed)",
      "",
      "Optional environment:",
      "  BMAD_SYNC_SUMMARY_PATH=bmad-sync-summary.json",
      "  BMAD_SYNC_ARCHIVE_DIR=.artifacts/bmad-sync",
      "  BMAD_ADMIN_ISSUE_NUMBER=123",
      "  BMAD_PROJECT_SYNC=true|false (default true)",
      '  BMAD_PROJECT_NAME="BMAD Backlog" (optional override)',
      "  BMAD_PROJECT_SCHEMA_PATH=scripts/bmad-project-schema.yaml",
    ].join("\n"),
  );
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentBranch(): string {
  try {
    return commandOutput("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return "main";
  }
}

function inferRepository(): string | null {
  const explicit = process.env.GITHUB_REPOSITORY;
  if (explicit) {
    return explicit;
  }

  try {
    const remoteUrl = commandOutput("git", ["remote", "get-url", "origin"]);
    const sshMatch = remoteUrl.match(/[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    return sshMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

function githubToken(): string {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error("Missing GITHUB_TOKEN or GH_TOKEN environment variable.");
  }
  return token;
}

function parseProjectNameFromSchema(schemaPath: string): string | null {
  if (!existsSync(schemaPath)) {
    return null;
  }

  const content = readFileSync(schemaPath, "utf8");
  const match = content.match(
    /(^|\n)project:\s*[\s\S]*?(\n\s*name:\s*"?([^"\n]+)"?)/m,
  );
  return match?.[3]?.trim() || null;
}

const repository = inferRepository();
if (!repository && !SHOW_HELP) {
  throw new Error(
    "Missing GITHUB_REPOSITORY and could not infer origin remote.",
  );
}

const branch = currentBranch();
const projectName =
  process.env.BMAD_PROJECT_NAME ||
  parseProjectNameFromSchema(PROJECT_SCHEMA_PATH) ||
  "BMAD Backlog";

function repoBlobUrl(filePath: string): string {
  if (!repository) {
    return filePath;
  }
  return `https://github.com/${repository}/blob/${branch}/${filePath}`;
}

function truncateSummary(input: string, maxLength = 220): string {
  const oneLine = input.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeValue(value: string | undefined, fallback: string): string {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || fallback;
}

function toStatusOptionName(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "in-progress" || normalized === "in progress")
    return "In Progress";
  if (normalized === "in-review" || normalized === "in review")
    return "In Review";
  if (normalized === "done") return "Done";
  if (normalized === "ready") return "Ready";
  if (normalized === "closed") return "Closed";
  return "Backlog";
}

function toPriorityOptionName(priority: string): string {
  const normalized = priority.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Medium";
}

function toEffortOptionName(effort?: string): string | null {
  if (!effort) {
    return null;
  }
  const normalized = effort.trim().toUpperCase();
  if (["XS", "S", "M", "L", "XL"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function parseInlineList(raw: string): string[] {
  return raw
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content };
  }

  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }

  const raw = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontmatter: Frontmatter = {};

  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2].trim();

    if (!value) {
      frontmatter[key] = "";
      continue;
    }

    if (value === "true" || value === "false") {
      frontmatter[key] = value === "true";
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = parseInlineList(value);
      continue;
    }

    frontmatter[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return { frontmatter, body };
}

function firstHeading(body: string, prefix: string): string | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(
    new RegExp(`^#{1,4}\\s+(?:${escaped}\\s+[\\d.]+[:\\s]+)?(.+)$`, "m"),
  );
  return match?.[1]?.trim() ?? null;
}

function firstParagraphAfterHeading(body: string): string {
  const lines = body.split("\n");
  let seenHeading = false;
  const paragraph: string[] = [];

  for (const line of lines) {
    if (!seenHeading) {
      if (/^#{1,4}\s+/.test(line.trim())) {
        seenHeading = true;
      }
      continue;
    }

    if (!line.trim()) {
      if (paragraph.length) {
        break;
      }
      continue;
    }

    if (/^#{1,4}\s+/.test(line.trim())) {
      break;
    }

    paragraph.push(line.trim());
  }

  return paragraph.join(" ").trim();
}

function storyIdsFromStoriesSection(body: string): string[] {
  const match = body.match(/(^|\n)Stories:\s*\n([\s\S]*?)(?=\n#{1,4}\s|\Z)/i);
  if (!match) {
    return [];
  }

  return match[2]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => /^story-[\d.]+/.test(line));
}

function getFileSha(filePath: string): string {
  try {
    return commandOutput("git", ["log", "-1", "--format=%H", "--", filePath]);
  } catch {
    return commandOutput("git", ["rev-parse", "HEAD"]);
  }
}

function isStandaloneEpicFile(filePath: string): boolean {
  return (
    /\/epic-[^/]+\.md$/.test(`/${filePath}`) &&
    !/\/epic-list\.md$/.test(`/${filePath}`)
  );
}

function fileStem(filePath: string): string {
  return filePath.split("/").pop()?.replace(/\.md$/, "") || "";
}

function fallbackEpicId(filePath: string, body: string): string {
  const headingMatch = body.match(/^#{1,4}\s+Epic\s+(\d+)\b/m);
  if (headingMatch) {
    return `epic-${headingMatch[1]}`;
  }

  const fileMatch = fileStem(filePath).match(/^epic-(\d+)\b/);
  if (fileMatch) {
    return `epic-${fileMatch[1]}`;
  }

  return fileStem(filePath) || "epic";
}

function fallbackStoryId(filePath: string, body: string): string {
  const headingMatch = body.match(/^#{1,4}\s+Story\s+([\d.]+)\b/m);
  if (headingMatch) {
    return `story-${headingMatch[1]}`;
  }

  const fileMatch = fileStem(filePath).match(/^story-([\d.]+)\b/);
  if (fileMatch) {
    return `story-${fileMatch[1]}`;
  }

  return fileStem(filePath) || "story";
}

function collectMatchingFiles(root: string): string[] {
  const results: string[] = [];

  function walk(dirPath: string): void {
    for (const entry of readdirSync(dirPath)) {
      const fullPath = join(dirPath, entry);
      const relPath = relative(root, fullPath).replace(/\\/g, "/");
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry) || relPath.startsWith("_bmad/core/")) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (
        isStandaloneEpicFile(relPath) ||
        /\/story-[^/]+\.md$/.test(`/${relPath}`) ||
        /\/(epics|epic-breakdown)\.md$/.test(`/${relPath}`)
      ) {
        results.push(relPath);
      }
    }
  }

  walk(root);
  return results.sort();
}

function parseEpic(
  filePath: string,
  body: string,
  frontmatter: Frontmatter,
  sha: string,
): SyncItem {
  const id = String(frontmatter.id || fallbackEpicId(filePath, body));
  const title = String(frontmatter.title || firstHeading(body, "Epic") || id);
  const description = truncateSummary(firstParagraphAfterHeading(body));

  return {
    type: "epic",
    id,
    title,
    description,
    status: normalizeValue(String(frontmatter.status || ""), DEFAULT_STATUS),
    priority: normalizeValue(
      String(frontmatter.priority || ""),
      DEFAULT_PRIORITY,
    ),
    effort: String(frontmatter.effort || "").trim() || undefined,
    milestone: String(frontmatter.milestone || "").trim() || undefined,
    bmadFile: filePath,
    bmadSha: sha,
    importantLinks: [filePath],
  };
}

function parseStory(
  filePath: string,
  body: string,
  frontmatter: Frontmatter,
  sha: string,
  parentEpicFile?: string,
): SyncItem {
  const id = String(frontmatter.id || fallbackStoryId(filePath, body));
  const title = String(frontmatter.title || firstHeading(body, "Story") || id);
  const firstParagraph = firstParagraphAfterHeading(body);
  const description = truncateSummary(firstParagraph || title);
  const epicId = String(frontmatter.epic_id || "");

  const importantLinks = [filePath];
  if (parentEpicFile) {
    importantLinks.push(parentEpicFile);
  }

  return {
    type: "story",
    id,
    title,
    description,
    status: normalizeValue(String(frontmatter.status || ""), DEFAULT_STATUS),
    priority: normalizeValue(
      String(frontmatter.priority || ""),
      DEFAULT_PRIORITY,
    ),
    effort: String(frontmatter.effort || "").trim() || undefined,
    milestone: String(frontmatter.milestone || "").trim() || undefined,
    epicId,
    bmadFile: filePath,
    bmadSha: sha,
    importantLinks,
  };
}

function parseCombinedDocument(
  filePath: string,
  content: string,
  sha: string,
): SyncItem[] {
  const items: SyncItem[] = [];
  const epicMatches = [...content.matchAll(/^##+\s+Epic\s+(\d+):\s*(.+)$/gm)];

  for (let index = 0; index < epicMatches.length; index += 1) {
    const current = epicMatches[index];
    const next = epicMatches[index + 1];
    const start = current.index ?? 0;
    const end = next?.index ?? content.length;
    const section = content.slice(start, end);
    const epicNumber = current[1];
    const epicId = `epic-${epicNumber}`;
    const epicPath = `${filePath}#${epicId}`;

    const epicDescription = truncateSummary(
      firstParagraphAfterHeading(section),
    );
    items.push({
      type: "epic",
      id: epicId,
      title: current[2].trim(),
      description: epicDescription,
      status: DEFAULT_STATUS,
      priority: DEFAULT_PRIORITY,
      effort: "M",
      bmadFile: epicPath,
      bmadSha: sha,
      importantLinks: [filePath],
    });

    const storyMatches = [
      ...section.matchAll(/^###\s+Story\s+([\d.]+):\s*(.+)$/gm),
    ];
    for (
      let storyIndex = 0;
      storyIndex < storyMatches.length;
      storyIndex += 1
    ) {
      const storyCurrent = storyMatches[storyIndex];
      const storyNext = storyMatches[storyIndex + 1];
      const storyStart = storyCurrent.index ?? 0;
      const storyEnd = storyNext?.index ?? section.length;
      const storySection = section.slice(storyStart, storyEnd);
      const storyId = `story-${storyCurrent[1]}`;

      items.push({
        type: "story",
        id: storyId,
        epicId,
        title: storyCurrent[2].trim(),
        description: truncateSummary(
          firstParagraphAfterHeading(storySection) || storyCurrent[2].trim(),
        ),
        status: DEFAULT_STATUS,
        priority: DEFAULT_PRIORITY,
        effort: "M",
        bmadFile: `${filePath}#${storyId}`,
        bmadSha: sha,
        importantLinks: [filePath, epicPath],
      });
    }

    const storyIds = storyIdsFromStoriesSection(section);
    for (const storyId of storyIds) {
      if (items.some((item) => item.id === storyId)) {
        continue;
      }

      items.push({
        type: "story",
        id: storyId,
        epicId,
        title: storyId,
        description: truncateSummary(
          `Tracked from Stories section of ${epicId}.`,
        ),
        status: DEFAULT_STATUS,
        priority: DEFAULT_PRIORITY,
        effort: "M",
        bmadFile: `${filePath}#${storyId}`,
        bmadSha: sha,
        importantLinks: [filePath, epicPath],
      });
    }
  }

  return items;
}

function parseItems(root: string): SyncItem[] {
  const files = collectMatchingFiles(root);
  const items: SyncItem[] = [];

  for (const filePath of files) {
    const content = readFileSync(join(root, filePath), "utf8");
    const sha = getFileSha(filePath);

    if (/(^|\/)(epics|epic-breakdown)\.md$/.test(filePath)) {
      items.push(...parseCombinedDocument(filePath, content, sha));
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    if (isStandaloneEpicFile(filePath)) {
      items.push(parseEpic(filePath, body, frontmatter, sha));
      continue;
    }

    if (/\/story-[^/]+\.md$/.test(`/${filePath}`)) {
      const epicFile =
        typeof frontmatter.epic_id === "string" && frontmatter.epic_id
          ? files.find((candidate) =>
              candidate.endsWith(`${frontmatter.epic_id}.md`),
            )
          : undefined;
      items.push(parseStory(filePath, body, frontmatter, sha, epicFile));
    }
  }

  return items;
}

class GitHubClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor(private readonly repoRef: string) {
    this.token = githubToken();
    const [owner, repo] = repoRef.split("/");
    this.owner = owner;
    this.repo = repo;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allow404 = false,
  ): Promise<T | null> {
    const url = `https://api.github.com${path}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.headers || {}),
        },
      });

      if (allow404 && response.status === 404) {
        return null;
      }

      if ((response.status === 403 || response.status === 429) && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") || "2");
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (response.status >= 500 && attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 2 ** (attempt + 1) * 1000),
        );
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API ${response.status} for ${path}: ${text}`);
      }

      if (response.status === 204) {
        return null;
      }

      return (await response.json()) as T;
    }

    throw new Error(`GitHub API retry limit reached for ${path}`);
  }

  private async graphQL<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub GraphQL ${response.status}: ${text}`);
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((entry) => entry.message).join(" | "));
    }

    if (!payload.data) {
      throw new Error("GitHub GraphQL returned empty data payload.");
    }

    return payload.data;
  }

  async ensureLabel(name: string): Promise<void> {
    const encoded = encodeURIComponent(name);
    const existing = await this.request(
      `/repos/${this.owner}/${this.repo}/labels/${encoded}`,
      {},
      true,
    );
    if (existing || DRY_RUN) {
      return;
    }

    await this.request(`/repos/${this.owner}/${this.repo}/labels`, {
      method: "POST",
      body: JSON.stringify({
        name,
        color: name.startsWith("bmad:") ? "e4e669" : "c5def5",
        description: "Managed by BMAD local sync",
      }),
    });
  }

  async listIssues(): Promise<Issue[]> {
    const all: Issue[] = [];
    let page = 1;

    while (true) {
      const pageItems = await this.request<Issue[]>(
        `/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100&page=${page}`,
      );
      const filtered = (pageItems || []).filter((issue) => !issue.pull_request);
      all.push(...filtered);
      if (!pageItems || pageItems.length < 100) {
        break;
      }
      page += 1;
    }

    return all;
  }

  async createIssue(payload: Record<string, unknown>): Promise<Issue> {
    return (await this.request<Issue>(
      `/repos/${this.owner}/${this.repo}/issues`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    )) as Issue;
  }

  async updateIssue(
    issueNumber: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      `/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    const path = `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.request(path, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTransientNodeResolutionFailure =
          message.includes("GitHub API 422") &&
          message.includes("Could not resolve to a node with the global id");

        if (!isTransientNodeResolutionFailure || attempt === 2) {
          throw error;
        }

        await delay(1500 * (attempt + 1));
      }
    }
  }

  async resolveProjectContext(
    projectTitle: string,
  ): Promise<ProjectContext | null> {
    type ProjectsNode = {
      id: string;
      title: string;
      fields: {
        nodes: Array<{
          __typename: string;
          id: string;
          name: string;
          dataType: string;
          options?: Array<{ id: string; name: string }>;
        }>;
      };
    };

    type Data = {
      repositoryOwner: {
        __typename: "User" | "Organization";
        projectsV2: { nodes: ProjectsNode[] };
      } | null;
    };

    const data = await this.graphQL<Data>(
      `query($login: String!, $first: Int!) {
        repositoryOwner(login: $login) {
          __typename
          ... on User {
            projectsV2(first: $first) {
              nodes {
                id
                title
                fields(first: 100) {
                  nodes {
                    __typename
                    ... on ProjectV2Field {
                      id
                      name
                      dataType
                    }
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                      dataType
                      options {
                        id
                        name
                      }
                    }
                    ... on ProjectV2IterationField {
                      id
                      name
                      dataType
                    }
                  }
                }
              }
            }
          }
          ... on Organization {
            projectsV2(first: $first) {
              nodes {
                id
                title
                fields(first: 100) {
                  nodes {
                    __typename
                    ... on ProjectV2Field {
                      id
                      name
                      dataType
                    }
                    ... on ProjectV2SingleSelectField {
                      id
                      name
                      dataType
                      options {
                        id
                        name
                      }
                    }
                    ... on ProjectV2IterationField {
                      id
                      name
                      dataType
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { login: this.owner, first: 50 },
    );

    const allProjects = data.repositoryOwner?.projectsV2.nodes || [];

    const project = allProjects.find((entry) => entry.title === projectTitle);
    if (!project) {
      return null;
    }

    const fieldsByName = new Map<string, ProjectField>();
    for (const field of project.fields.nodes) {
      const optionsByName = new Map<string, string>();
      for (const option of field.options || []) {
        optionsByName.set(option.name, option.id);
      }

      const loweredType = String(field.dataType || "").toLowerCase();
      const type =
        loweredType === "single_select" ||
        loweredType === "text" ||
        loweredType === "date" ||
        loweredType === "iteration" ||
        loweredType === "number" ||
        loweredType === "person"
          ? (loweredType as ProjectFieldType)
          : "text";

      fieldsByName.set(field.name, {
        id: field.id,
        name: field.name,
        type,
        optionsByName,
      });
    }

    const itemIdByIssueNodeId = await this.getProjectItems(project.id);
    return {
      id: project.id,
      title: project.title,
      fieldsByName,
      itemIdByIssueNodeId,
    };
  }

  private async getProjectItems(
    projectId: string,
  ): Promise<Map<string, string>> {
    type Data = {
      node: {
        items: {
          nodes: ProjectItem[];
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      } | null;
    };

    const map = new Map<string, string>();
    let cursor: string | null = null;

    while (true) {
      const data: Data = await this.graphQL<Data>(
        `query($projectId: ID!, $after: String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes {
                  id
                  content {
                    __typename
                    ... on Issue {
                      id
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }`,
        { projectId, after: cursor },
      );

      const items = data.node?.items.nodes || [];
      for (const item of items) {
        if (item.content?.__typename === "Issue" && item.content.id) {
          map.set(item.content.id, item.id);
        }
      }

      const pageInfo = data.node?.items.pageInfo;
      if (!pageInfo?.hasNextPage) {
        break;
      }
      cursor = pageInfo.endCursor;
    }

    return map;
  }

  async ensureProjectItem(
    project: ProjectContext,
    issueNodeId: string,
  ): Promise<string> {
    const existing = project.itemIdByIssueNodeId.get(issueNodeId);
    if (existing) {
      return existing;
    }

    if (DRY_RUN) {
      return "dry-run-item";
    }

    type Data = {
      addProjectV2ItemById: {
        item: {
          id: string;
        };
      };
    };

    const data = await this.graphQL<Data>(
      `mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }`,
      { projectId: project.id, contentId: issueNodeId },
    );

    const itemId = data.addProjectV2ItemById.item.id;
    project.itemIdByIssueNodeId.set(issueNodeId, itemId);
    return itemId;
  }

  async setProjectFieldText(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: string,
  ): Promise<void> {
    if (DRY_RUN) {
      return;
    }

    await this.graphQL(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { text: $text }
        }) {
          projectV2Item { id }
        }
      }`,
      { projectId, itemId, fieldId, text: value },
    );
  }

  async setProjectFieldDate(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: string,
  ): Promise<void> {
    if (DRY_RUN) {
      return;
    }

    await this.graphQL(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { date: $date }
        }) {
          projectV2Item { id }
        }
      }`,
      { projectId, itemId, fieldId, date: value },
    );
  }

  async setProjectFieldSingleSelect(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    if (DRY_RUN) {
      return;
    }

    await this.graphQL(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item { id }
        }
      }`,
      { projectId, itemId, fieldId, optionId },
    );
  }
}

function managedLabels(item: SyncItem): string[] {
  return [
    `bmad:${item.id}`,
    `type:${item.type}`,
    `status:${item.status}`,
    `priority:${item.priority}`,
  ];
}

function mergeLabels(existing: string[], nextManaged: string[]): string[] {
  const preserved = existing.filter(
    (label) =>
      !MANAGED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix)),
  );
  return [...new Set([...preserved, ...nextManaged])];
}

function extractManagedBlock(body: string): string | null {
  const match = body.match(/<!-- BMAD:START -->[\s\S]*?<!-- BMAD:END -->/);
  return match?.[0] ?? null;
}

function extractManagedSha(body: string): string | null {
  const match = body.match(/BMAD SHA:\s*(.+)/);
  return match?.[1]?.trim() ?? null;
}

function replaceManagedBlock(body: string, block: string): string {
  const existing = extractManagedBlock(body);
  if (!existing) {
    return `${block}\n\n---\n\n${body}`.trim();
  }
  return body.replace(existing, block);
}

function buildManagedBlock(item: SyncItem, epicIssueNumber?: number): string {
  const links = item.importantLinks
    .map((link, index) => {
      const label = index === 0 ? "BMAD File" : `Related File ${index}`;
      return `- ${label}: [${link}](${repoBlobUrl(link.split("#")[0])})`;
    })
    .join("\n");

  const lines = [
    "<!-- BMAD:START -->",
    `Type: ${item.type === "epic" ? "Epic" : "Story"}`,
    `BMAD ID: ${item.id}`,
    `BMAD File: ${item.bmadFile}`,
    `BMAD SHA: ${item.bmadSha}`,
    `Summary: ${item.description}`,
  ];

  if (item.type === "story") {
    lines.push(
      `Parent Epic: ${epicIssueNumber ? `#${epicIssueNumber}` : item.epicId || "unresolved"}`,
    );
  }

  lines.push("Important Links:");
  lines.push(links || "- BMAD File: unavailable");
  lines.push("<!-- BMAD:END -->");
  return lines.join("\n");
}

function issueTitle(item: SyncItem): string {
  return `[${item.type === "epic" ? "Epic" : "Story"} ${item.id}] ${item.title}`;
}

function issueByBmadId(issues: Issue[], id: string): Issue | undefined {
  return issues.find((issue) =>
    issue.labels.some((label) => label.name === `bmad:${id}`),
  );
}

async function applyProjectFields(
  client: GitHubClient,
  project: ProjectContext,
  issue: Issue,
  item: SyncItem,
  parentIssueNumber?: number,
): Promise<void> {
  const itemId = await client.ensureProjectItem(project, issue.node_id);
  const today = new Date().toISOString().slice(0, 10);

  const setSingleSelect = async (
    fieldName: string,
    optionName: string | null,
  ): Promise<void> => {
    if (!optionName) {
      return;
    }
    const field = project.fieldsByName.get(fieldName);
    if (!field || field.type !== "single_select") {
      return;
    }
    const optionId = field.optionsByName.get(optionName);
    if (!optionId) {
      return;
    }
    await client.setProjectFieldSingleSelect(
      project.id,
      itemId,
      field.id,
      optionId,
    );
  };

  const setText = async (
    fieldName: string,
    value: string | null | undefined,
  ): Promise<void> => {
    if (!value) {
      return;
    }
    const field = project.fieldsByName.get(fieldName);
    if (!field || field.type !== "text") {
      return;
    }
    await client.setProjectFieldText(project.id, itemId, field.id, value);
  };

  const setDate = async (fieldName: string, value: string): Promise<void> => {
    const field = project.fieldsByName.get(fieldName);
    if (!field || field.type !== "date") {
      return;
    }
    await client.setProjectFieldDate(project.id, itemId, field.id, value);
  };

  await setSingleSelect("Status", toStatusOptionName(item.status));
  await setSingleSelect("Priority", toPriorityOptionName(item.priority));
  await setSingleSelect("Effort", toEffortOptionName(item.effort));
  await setSingleSelect("BMAD Type", item.type === "epic" ? "Epic" : "Story");

  await setText("BMAD ID", item.id);
  await setText("BMAD File", item.bmadFile);
  await setText("BMAD SHA", item.bmadSha);
  await setText("Milestone", item.milestone || null);
  if (item.type === "story") {
    await setText(
      "Parent Epic",
      parentIssueNumber ? `#${parentIssueNumber}` : item.epicId || null,
    );
  }
  await setDate("Last Synced", today);
}

async function sync(): Promise<void> {
  if (SHOW_HELP) {
    printHelp();
    return;
  }

  const client = new GitHubClient(repository as string);
  const root = process.cwd();
  const items = parseItems(root);
  const issues = await client.listIssues();
  const itemIds = new Set(items.map((item) => item.id));
  const epicIssueNumbers = new Map<string, number>();

  let projectContext: ProjectContext | null = null;
  if (ENABLE_PROJECT_SYNC) {
    try {
      projectContext = await client.resolveProjectContext(projectName);
      if (!projectContext) {
        summary.errored.push({
          file: PROJECT_SCHEMA_PATH,
          error: `GitHub Project '${projectName}' was not found for owner '${repository?.split("/")[0]}'.`,
        });
      }
    } catch (error) {
      summary.errored.push({
        file: PROJECT_SCHEMA_PATH,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const label of new Set(items.flatMap((item) => managedLabels(item)))) {
    await client.ensureLabel(label);
  }

  const orderedItems = [...items].sort((left, right) => {
    if (left.type === right.type) {
      return left.id.localeCompare(right.id);
    }
    return left.type === "epic" ? -1 : 1;
  });

  for (const item of orderedItems) {
    try {
      const existing = issueByBmadId(issues, item.id);
      const mergedLabels = mergeLabels(
        existing?.labels
          .map((label) => label.name)
          .filter((name): name is string => Boolean(name)) || [],
        managedLabels(item),
      );
      const parentIssueNumber = item.epicId
        ? epicIssueNumbers.get(item.epicId)
        : undefined;
      const block = buildManagedBlock(item, parentIssueNumber);
      const nextTitle = issueTitle(item);

      if (!existing) {
        if (DRY_RUN) {
          summary.created.push({
            file: item.bmadFile,
            id: item.id,
            title: nextTitle,
          });
          continue;
        }

        const created = await client.createIssue({
          title: nextTitle,
          body: block,
          labels: mergedLabels,
        });
        await client.addComment(
          created.number,
          `BMAD sync created this issue from ${item.bmadFile} at ${item.bmadSha}.`,
        );
        issues.push(created);
        if (item.type === "epic") {
          epicIssueNumbers.set(item.id, created.number);
        }
        if (projectContext) {
          await applyProjectFields(
            client,
            projectContext,
            created,
            item,
            parentIssueNumber,
          );
        }
        summary.created.push({
          file: item.bmadFile,
          id: item.id,
          issue: created.number,
          title: nextTitle,
        });
        continue;
      }

      if (item.type === "epic") {
        epicIssueNumbers.set(item.id, existing.number);
      }

      const currentSha = extractManagedSha(existing.body || "");
      const nextBody = replaceManagedBlock(existing.body || "", block);
      const labelsChanged =
        JSON.stringify([...mergedLabels].sort()) !==
        JSON.stringify(
          existing.labels
            .map((label) => label.name)
            .filter((name): name is string => Boolean(name))
            .sort(),
        );
      const titleChanged = existing.title !== nextTitle;
      const bodyChanged =
        extractManagedBlock(existing.body || "") !==
        extractManagedBlock(nextBody);

      if (
        currentSha === item.bmadSha &&
        !labelsChanged &&
        !titleChanged &&
        !bodyChanged
      ) {
        if (projectContext) {
          await applyProjectFields(
            client,
            projectContext,
            existing,
            item,
            parentIssueNumber,
          );
        }
        summary.skipped.push({
          file: item.bmadFile,
          id: item.id,
          issue: existing.number,
          title: nextTitle,
        });
        continue;
      }

      if (DRY_RUN) {
        summary.updated.push({
          file: item.bmadFile,
          id: item.id,
          issue: existing.number,
          title: nextTitle,
        });
        continue;
      }

      await client.updateIssue(existing.number, {
        title: nextTitle,
        body: nextBody,
        labels: mergedLabels,
        state: "open",
      });
      await client.addComment(
        existing.number,
        `BMAD sync updated this issue from ${item.bmadFile} at ${item.bmadSha}. Previous BMAD SHA: ${currentSha || "none"}.`,
      );
      existing.title = nextTitle;
      existing.body = nextBody;
      existing.labels = mergedLabels.map((name) => ({ name }));
      if (projectContext) {
        await applyProjectFields(
          client,
          projectContext,
          existing,
          item,
          parentIssueNumber,
        );
      }
      summary.updated.push({
        file: item.bmadFile,
        id: item.id,
        issue: existing.number,
        title: nextTitle,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errored.push({
        file: item.bmadFile,
        id: item.id,
        error: message,
      });
    }
  }

  for (const issue of issues) {
    const label = issue.labels
      .map((entry) => entry.name)
      .find(
        (name): name is string =>
          typeof name === "string" && name.startsWith("bmad:"),
      );
    if (!label) {
      continue;
    }

    const id = label.slice("bmad:".length);
    if (itemIds.has(id) || issue.state === "closed") {
      continue;
    }

    if (DRY_RUN) {
      summary.closed.push({
        file: "",
        id,
        issue: issue.number,
        title: issue.title,
      });
      continue;
    }

    await client.updateIssue(issue.number, {
      state: "closed",
      state_reason: "not_planned",
    });
    await client.addComment(
      issue.number,
      `BMAD sync closed this issue because BMAD item ${id} is no longer present in the planning sources.`,
    );
    summary.closed.push({
      file: "",
      id,
      issue: issue.number,
      title: issue.title,
    });
  }

  if (summary.errored.length && ADMIN_ISSUE_NUMBER && !DRY_RUN) {
    const body = [
      "BMAD local sync encountered errors.",
      "",
      ...summary.errored.map(
        (entry) => `- ${entry.id || entry.file}: ${entry.error}`,
      ),
    ].join("\n");
    await client.addComment(Number(ADMIN_ISSUE_NUMBER), body);
  }
}

function writeSummary(): void {
  const payload = JSON.stringify(summary, null, 2);
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
  writeFileSync(SUMMARY_PATH, payload, "utf8");

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(ARCHIVE_DIR, `${timestamp}.json`), payload, "utf8");
  writeFileSync(join(ARCHIVE_DIR, "latest.json"), payload, "utf8");
}

async function main(): Promise<void> {
  if (SHOW_HELP) {
    printHelp();
    return;
  }

  try {
    await sync();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errored.push({ file: "", error: message });
  } finally {
    writeSummary();
  }

  const totalErrors = summary.errored.length;
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Summary written to ${SUMMARY_PATH}`);

  if (totalErrors > 0) {
    process.exitCode = 1;
  }
}

void main();
