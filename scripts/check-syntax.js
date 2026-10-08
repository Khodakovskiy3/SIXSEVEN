/**
 * Syntax check for every JavaScript file shipped by the project
 * (server, browser modules, service worker, scripts, Electron).
 *
 * Usage: npm run check:syntax
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DIRS = ['server', 'public', 'scripts', 'electron', 'tests'];
const SKIP = new Set(['node_modules', 'uploads']);

export function listJsFiles(dir = ROOT, dirs = DIRS) {
  const files = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      if (SKIP.has(entry)) continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(c|m)?js$/.test(entry)) {
        files.push(full);
      }
    }
  };
  for (const name of dirs) walk(join(dir, name));
  return files;
}

export function checkFiles(files) {
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({ file: relative(ROOT, file), error: result.stderr.trim() });
    }
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = listJsFiles();
  const failures = checkFiles(files);
  for (const failure of failures) {
    console.error(`✗ ${failure.file}\n${failure.error}\n`);
  }
  console.log(`${files.length - failures.length}/${files.length} files OK`);
  process.exitCode = failures.length ? 1 : 0;
}
