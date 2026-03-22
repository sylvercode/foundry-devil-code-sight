# BMAD -> GitHub Manual Sync Policy (Local Runner)

This document defines the BMAD -> GitHub sync policy for the local runner in `scripts/bmad-github-sync.ts`.
BMAD Markdown is the only source of truth, and GitHub is a lightweight mirror.

---

## 1) Purpose

Maintain concise GitHub tracking issues for BMAD Epics and Stories without duplicating full planning content.

- Direction: BMAD -> GitHub only
- BMAD authority: absolute
- GitHub role: discovery, assignment, status tracking, and discussion
- Data minimization: issue body contains only short summary + canonical links

---

## 2) Hard Rules (Non-Negotiable)

1. Never edit BMAD files from the sync process.
2. Never treat GitHub issue content as canonical.
3. Never copy full Epic or Story text into issue bodies.
4. Never invent Epics or Stories not found in BMAD.
5. Never delete human comments in issues.
6. Only update BMAD-managed block inside issue body markers.
7. Always record BMAD file path and BMAD file commit SHA on create/update.

---

## 3) Manual Sync Triggers

The sync runs only when manually invoked.

Recommended execution host:

- Local TypeScript runner via `npm run bmad:sync`

Project sync configuration:

- Schema file lives beside the runner at `scripts/bmad-project-schema.yaml`
- Runner applies Project v2 fields when `BMAD_PROJECT_SYNC=true` (default)
- Use `BMAD_PROJECT_NAME` to override the project name detected from schema

Recommended important-event triggers:

- After approving planning changes
- Before sprint planning or sprint kickoff
- Before release cut
- After major scope decisions

Not allowed as defaults:

- on push
- on PR merge
- daily scheduled drift checks

---

## 4) File Detection Rules

Primary standalone files:

- Epic files: `epic-*.md`
- Story files: `story-*.md`

Explicit exclusions:

- Reference or index documents are not sync sources even if their names begin with `epic-`
- `docs/epics/epic-list.md` must never be treated as an Epic item

Secondary combined source:

- If standalone story files are absent, stories may be defined under a `Stories:` section inside an epic file.

Search scope:

- Recursively scan repository content folders where BMAD planning files live.
- Exclude framework/internal folders not used for project planning content.

---

## 5) Parsing Rules

### 5.1 Epic parsing

Extract these fields from frontmatter when present; otherwise derive from headings/sections:

- `id`
- `title`
- `description` (brief only)
- `status`
- `priority`
- `effort`
- `owner`
- `dependencies`
- `file_path`
- `file_sha`

Accepted heading fallbacks:

- First epic heading -> title
- Epic heading number like `Epic 4:` -> BMAD ID `epic-4`
- Intro paragraph -> short description source
- `Stories:` section -> child story references

### 5.2 Story parsing

Extract these fields from frontmatter when present; otherwise derive from headings/sections:

- `id`
- `epic_id`
- `title`
- `description` (brief only)
- `status`
- `priority`
- `effort`
- `owner`
- `dependencies`
- `file_path`
- `file_sha`

Accepted heading fallbacks:

- First story heading -> title
- Story heading number like `Story 4.2:` -> BMAD ID `story-4.2`
- First user-story block or intro -> short description source

ID normalization rule:

- When frontmatter `id` is absent, the runner derives the BMAD ID from the heading number before falling back to the filename stem
- This keeps IDs canonical, such as `epic-4` and `story-4.2`, and avoids GitHub label-length violations from verbose filenames

### 5.3 Brief-description rule

The issue description must be brief, capped to one short paragraph.
Do not include full acceptance criteria, long context, or full requirement lists.

---

## 6) GitHub Mapping (Minimal Mirror)

Required labels:

- `type:epic` or `type:story`
- `bmad:<id>`
- `status:<value>`
- `priority:<value>`

Issue title:

- Epic: `[Epic <id>] <title>`
- Story: `[Story <id>] <title>`

Issue body must include BMAD-managed marker block only with:

- item type
- BMAD id
- BMAD file path
- BMAD file SHA
- short summary (1 paragraph max)
- parent epic link (for story)
- links to important BMAD files

No full-content mirroring is allowed.

Project field sync (when enabled):

- Add/keep each synced issue in the configured Project v2
- Apply supported fields by name: `Status`, `Priority`, `Effort`, `BMAD ID`, `BMAD Type`, `BMAD File`, `BMAD SHA`, `Parent Epic`, `Milestone`, and `Last Synced`
- `Sprint` remains manual and is never overwritten by the runner

---

## 7) BMAD-Managed Body Contract

The runner updates only content inside this block:

<!-- BMAD:START -->

Type: Story
BMAD ID: story-1.2
BMAD File: docs/planning/story-1.2.md
BMAD SHA: abc123
Summary: Short tracking summary generated from BMAD (max one paragraph).
Parent Epic: #45
Important Links:

- BMAD Story File: docs/planning/story-1.2.md
- BMAD Epic File: docs/planning/epic-1.md
<!-- BMAD:END -->

Rules:

- Preserve all issue text outside markers.
- If markers are missing, insert at top and preserve existing text below.

---

## 8) Create / Update / Close Rules

### 8.1 Create

Create issue if no issue exists with label `bmad:<id>`.
Then:

- set title and labels
- write minimal BMAD block
- add comment: created from BMAD file + SHA
- if GitHub comment creation hits transient issue-node propagation errors, retry before recording failure

### 8.2 Update

Update when BMAD SHA differs from issue BMAD SHA metadata.
Then:

- update title/labels if changed
- replace BMAD block only
- add comment with old SHA -> new SHA
- if GitHub comment creation hits transient issue-node propagation errors, retry before recording failure

### 8.3 Close

If BMAD item is explicitly removed from source planning set:

- close corresponding GitHub issue
- add comment with deletion rationale and BMAD commit SHA

---

## 9) Parent/Child Linking

For stories:

- Include parent epic issue reference in BMAD block
- Include direct link to parent epic BMAD file
- Use GitHub issue linking/sub-issue relation if available

For epics:

- Optionally list child story issue references by ID only (no copied story text)

---

## 10) Conflict Resolution

If BMAD and GitHub differ, BMAD always wins.

Priority order:

1. BMAD files
2. BMAD metadata in issue block
3. Other GitHub fields

Human comments and discussion outside BMAD markers are never modified.

---

## 11) Drift Detection (Manual Run Scope)

When manually run, detect:

- missing issue for BMAD item
- title mismatch
- label mismatch
- BMAD SHA mismatch
- broken parent epic link
- orphaned issue (has `bmad:<id>` but BMAD item missing)

Reconcile immediately under BMAD-first policy.

---

## 12) Error Handling

On errors (parse/API/linking):

- do not mutate BMAD
- continue best-effort on remaining items
- produce run summary with `created`, `updated`, `closed`, `skipped`, and `errored`
- report failures to configured admin issue/comment target if configured

---

## 13) Safeguards

1. No auto-run defaults.
2. No bulk text replication from BMAD into GitHub.
3. No updates outside BMAD markers.
4. No issue creation without matching BMAD item.
5. No deletion/closure without explicit BMAD state evidence.
6. Keep operation idempotent (rerun-safe).

---

## 14) Minimal Templates (Reference)

Epic issue BMAD block fields:

- Type
- BMAD ID
- BMAD File
- BMAD SHA
- Summary
- Important Links

Story issue BMAD block fields:

- Type
- BMAD ID
- BMAD File
- BMAD SHA
- Summary
- Parent Epic
- Important Links
