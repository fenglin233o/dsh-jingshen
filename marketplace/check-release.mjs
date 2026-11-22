#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { packageRoot, packageFile, jsonFile, registry, localizedDisplay, entryFor, indexFor } from './lib.mjs';

const { values } = parseArgs({ options: { online: { type: 'boolean', default: false } }, strict: true });
const errors = [];
const warnings = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
try {
  const manifest = await jsonFile(packageFile('package.json'));
  check(manifest.private !== true, 'personal/package.json must not be private.');
  check(manifest.name !== 'dsh-spirit', 'The public npm name dsh-spirit belongs to another project. Choose the actual publishing name first.');
  check(manifest.engines?.dsh === '0.2.2-rc.5', 'Keep engines.dsh at the tested 0.2.2-rc.5 until other versions are verified.');
  check(manifest.engines?.node === '>=24.9.0', 'Expected the tested Node.js >=24.9.0 requirement.');
  check(Array.isArray(manifest.keywords) && manifest.keywords.includes('dsh-plugin'), 'Add search keywords, including dsh-plugin.');
  check(!!manifest.repository, 'A real public source repository is required for the planned community submissions.');
  if (!manifest.author) warnings.push('No public author name is set; omit the field until the owner chooses it.');
  if (!manifest.homepage) warnings.push('No homepage is set.');
  if (manifest.publishConfig?.access !== 'public') warnings.push('Set publishConfig.access=public before a scoped npm release.');
  const patchPaths = manifest.dsh?.bundle?.patch;
  const patches = Array.isArray(patchPaths) ? patchPaths : [patchPaths];
  check(patches.length > 0 && patches.every(path => typeof path === 'string'), 'dsh.bundle.patch must name its packaged patch file(s).');
  const patchText = (await Promise.all(patches.filter(path => typeof path === 'string').map(path => readFile(packageFile(path), 'utf8')))).join('\n');
  const quotedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  check(new RegExp(`name:\\s*["']?${quotedName}["']?\\s*(?:$|#)`, 'm').test(patchText), 'Bundle host plugin name must resolve the final package name. Preserve logical preset IDs separately.');
  const client = await readFile(packageFile('lib/client.js'), 'utf8');
  const moduleId = /__ModuleLoader__\.load\(\{\s*id:\s*(["'])([^"']+)\1/.exec(client)?.[2];
  check(moduleId === manifest.name, 'Built client ModuleLoader id must match the final package name; update tsdown.config.ts and rebuild.');
  const buildConfig = await readFile(packageFile('tsdown.config.ts'), 'utf8');
  check(manifest.name === 'dsh-spirit' || !buildConfig.includes('id: "dsh-spirit"'), 'tsdown.config.ts still hardcodes the previous client package identity.');
  const paths = await readFile(packageFile('upstream/src/infra/paths.ts'), 'utf8');
  check(manifest.name === 'dsh-spirit' || !/name\s*===\s*['"]dsh-spirit['"]/.test(paths) || paths.includes(manifest.name), 'Upstream asset-root detection still recognizes only dsh-spirit; adapt it to the final package identity.');
  const lock = await jsonFile(packageFile('package-lock.json'));
  check(lock.name === manifest.name && lock.packages?.['']?.name === manifest.name, 'package-lock.json must use the final package name.');
  check(lock.version === manifest.version && lock.packages?.['']?.version === manifest.version, 'package-lock.json must match the package version.');
  for (const lang of ['en', 'zh']) {
    check(typeof manifest.exports?.[`./locale/${lang}.json`] === 'string', `Export ./locale/${lang}.json so reference generators can read the title and description.`);
  }
  const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot, encoding: 'utf8', timeout: 60000, shell: process.platform === 'win32',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  check(pack.status === 0, 'npm pack --dry-run --json --ignore-scripts failed.');
  let packSummary;
  if (pack.status === 0) {
    const packed = JSON.parse(pack.stdout)[0];
    const names = new Set(packed.files.map(file => file.path));
    packSummary = { name: packed.name, version: packed.version, files: names.size, unpackedSize: packed.unpackedSize };
    const required = ['lib/index.js', 'lib/client.js', 'README.md', 'LICENSE', 'NOTICE', 'scripts/run.mjs', 'scripts/spirit-recover.mjs', 'docs/verification.json', ...patches.filter(path => typeof path === 'string').map(path => path.replace(/^\.\//, ''))];
    if (manifest.files?.includes('media/voice')) {
      required.push('scripts/character-voice/prepare.py', 'scripts/character-voice/serve.py',
        'scripts/character-voice/voice.json', 'scripts/character-voice/xiaoyu.wav',
        'scripts/character-voice/xiaoyu.txt', 'media/voice/xiaoyu-preview.mp3');
    }
    for (const lang of ['en', 'zh']) {
      const path = manifest.exports?.[`./locale/${lang}.json`];
      if (typeof path === 'string') required.push(path.replace(/^\.\//, ''));
    }
    for (const path of required) check(names.has(path), `Missing from npm package: ${path}`);
    for (const name of names) {
      check(!/(^|\/)(\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519|personal\.sqlite(?:-.*)?|credentials?\.json)$/.test(name), `Unexpected local state or credential file in package: ${name}`);
    }
  }
  const display = await localizedDisplay(manifest, path => readFile(packageFile(path)));
  // In-memory schema check only: timestamp zero is never written as a release index.
  parseMarketIndex(indexFor(entryFor(manifest, display, {
    version: manifest.version, publishTimestamp: 0,
    source: { type: 'npm', registry }, engines: { dsh: manifest.engines?.dsh },
  })), 'https://validation.invalid/index.json');
  let publicNpm;
  if (values.online) {
    const response = await fetch(`${registry}${encodeURIComponent(manifest.name)}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    check(response.status === 200 || response.status === 404, `Registry lookup failed with HTTP ${response.status}.`);
    if (response.status === 200) {
      const packument = await response.json();
      publicNpm = { exists: true, latest: packument['dist-tags']?.latest, maintainers: packument.maintainers?.map(owner => owner.name), versionAlreadyPublished: !!packument.versions?.[manifest.version] };
      check(!publicNpm.versionAlreadyPublished, `${manifest.name}@${manifest.version} already exists and cannot be republished.`);
      warnings.push('The name already exists. This read-only check does not prove publisher ownership.');
    } else if (response.status === 404) {
      publicNpm = { exists: false };
      warnings.push('HTTP 404 is an availability observation, not a reservation or a guarantee that npm will accept the name.');
    }
  }
  console.log(JSON.stringify({ ready: errors.length === 0, package: `${manifest.name}@${manifest.version}`, pack: packSummary, publicNpm, errors, warnings }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
