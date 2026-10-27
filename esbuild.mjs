import * as esbuild from 'esbuild';
const builds = [
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', platform: 'node', format: 'cjs', external: ['vscode'], target: 'node20' },
  { entryPoints: ['src/webview/main.ts'], outfile: 'dist/webview.js', platform: 'browser', format: 'iife', target: 'es2022' }
].map(options => ({ ...options, bundle: true, sourcemap: true, minify: !process.argv.includes('--watch'), logLevel: 'info' }));
if (process.argv.includes('--watch')) {
  await Promise.all(builds.map(async options => (await esbuild.context(options)).watch()));
} else await Promise.all(builds.map(options => esbuild.build(options)));
