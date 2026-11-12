// Copies app/ to dist/ and stamps the build sha (R6) into index.html.
// Usage: node scripts/build.mjs [sha]   (defaults to `git rev-parse HEAD`)
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sha = process.argv[2] || execSync('git rev-parse HEAD').toString().trim();
rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
const html = readFileSync('dist/index.html', 'utf8').replaceAll('__BUILD_SHA__', sha);
writeFileSync('dist/index.html', html);
console.log(`built dist/ for ${sha}`);
