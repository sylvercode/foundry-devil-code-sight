import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

function collectTestFiles(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    const testFiles = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            testFiles.push(...collectTestFiles(entryPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.test.js')) {
            testFiles.push(entryPath);
        }
    }

    return testFiles;
}

const targetDirectory = process.argv[2];

if (!targetDirectory) {
    console.error('Usage: node scripts/run-node-tests.mjs <compiled-test-directory>');
    process.exit(1);
}

const testFiles = collectTestFiles(targetDirectory).sort();

if (testFiles.length === 0) {
    console.error(`No compiled test files found under ${targetDirectory}`);
    process.exit(1);
}

const isIntegrationRun = targetDirectory.split(path.sep).includes('integration');
const nodeTestArgs = isIntegrationRun
    ? ['--test', '--test-concurrency=1', ...testFiles]
    : ['--test', ...testFiles];

const result = spawnSync(process.execPath, nodeTestArgs, {
    stdio: 'inherit'
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
