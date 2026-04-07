// @ts-check
'use strict';

/**
 * esbuild configuration for the Jupyter Browser Kernel VS Code extension.
 *
 * Output format: ESM
 * Rationale: VS Code 1.92+ supports ESM extensions natively. Transport
 * dependencies remain externalized so the bundle does not emit dynamic
 * require(...) shims that fail during activation.
 */

const esbuild = require('esbuild');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.mjs',
    external: ['vscode', 'chrome-remote-interface', 'ws'],
    format: 'esm',
    platform: 'node',
    target: 'node20',
    tsconfig: 'tsconfig.json',
    sourcemap: true,
    minify: false,
    logLevel: 'info',
};

if (watch) {
    esbuild.context(buildOptions).then((ctx) => {
        ctx.watch();
        console.log('[esbuild] Watching for changes...');
    }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
} else {
    esbuild.build(buildOptions).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
