#!/usr/bin/env node
// One-command release: bump APP_VERSION (src/version.js) and CACHE_VERSION
// (sw.js) in lockstep, then run the smoke suite. The two version strings MUST
// stay in sync — APP_VERSION drives the client-side auto-reparse trigger and
// CACHE_VERSION drives the service-worker cache-bust. Bumping one without the
// other ships broken updates (stale code from old SW, or a no-op auto-reparse).
//
// This script is the source of truth for that invariant. Don't bump versions
// by hand.
//
// Usage:
//   node tools/release.mjs              # bump from current vNN to v(NN+1)
//   node tools/release.mjs --to v60     # bump to a specific version
//   node tools/release.mjs --check      # verify the two are in sync, no edit
//   node tools/release.mjs --no-tests   # skip smoke (use sparingly)
//
// Exit codes:
//   0 = success (versions in sync after run, smoke green)
//   1 = mismatch / smoke failure / bad arguments

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VERSION_JS = resolve(ROOT, 'src/version.js');
const SW_JS = resolve(ROOT, 'sw.js');
const SMOKE = resolve(ROOT, 'tests/smoke/run.mjs');

const APP_RE   = /export const APP_VERSION = '(v\d+)';/;
const CACHE_RE = /const CACHE_VERSION = '(v\d+)';/;

function die(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { check: false, runTests: true, to: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--no-tests') args.runTests = false;
    else if (a === '--to') {
      args.to = argv[i + 1];
      i += 1;
    } else die(`unknown arg: ${a}`);
  }
  if (args.to && !/^v\d+$/.test(args.to)) die(`--to must be like "v55", got: ${args.to}`);
  return args;
}

async function readVersion(path, re, label) {
  const src = await readFile(path, 'utf8');
  const m = src.match(re);
  if (!m) die(`could not find ${label} in ${path}`);
  return { src, version: m[1] };
}

function nextVersion(v) {
  const n = Number(v.slice(1));
  if (!Number.isFinite(n)) die(`bad version string: ${v}`);
  return `v${n + 1}`;
}

async function bumpFile(path, src, re, oldV, newV) {
  const next = src.replace(re, (line) => line.replace(oldV, newV));
  if (next === src) die(`no replacement made in ${path}`);
  await writeFile(path, next);
}

function runSmoke() {
  return new Promise((res) => {
    const child = spawn(process.execPath, [SMOKE], { stdio: 'inherit', cwd: ROOT });
    child.on('exit', (code) => res(code ?? 1));
  });
}

async function main() {
  const args = parseArgs(process.argv);

  const app   = await readVersion(VERSION_JS, APP_RE,   'APP_VERSION');
  const cache = await readVersion(SW_JS,      CACHE_RE, 'CACHE_VERSION');

  if (args.check) {
    if (app.version !== cache.version) {
      die(`out of sync: APP_VERSION=${app.version}, CACHE_VERSION=${cache.version}`);
    }
    console.log(`release: in sync at ${app.version}`);
    return;
  }

  if (app.version !== cache.version) {
    die(`refusing to bump: versions are already out of sync (APP=${app.version}, CACHE=${cache.version}). Reconcile by hand first.`);
  }

  const oldV = app.version;
  const newV = args.to || nextVersion(oldV);

  if (newV === oldV) die(`--to ${newV} matches current version, nothing to do`);

  await bumpFile(VERSION_JS, app.src,   APP_RE,   oldV, newV);
  await bumpFile(SW_JS,      cache.src, CACHE_RE, oldV, newV);

  console.log(`release: bumped ${oldV} → ${newV}`);

  if (args.runTests) {
    console.log('release: running smoke suite...');
    const code = await runSmoke();
    if (code !== 0) die(`smoke failed (exit ${code}). Versions were bumped on disk; revert with git if needed.`);
  } else {
    console.log('release: skipped smoke (--no-tests)');
  }

  console.log(`release: ready. Next: review the diff, commit, and push.`);
}

main().catch((err) => die(err.stack || String(err)));
