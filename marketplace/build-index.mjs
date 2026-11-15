#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { packageFile, jsonFile, registry, requireValue, publishedJson, publishedBytes, githubRepository, directoryPath, manifestMatches, localizedDisplay, entryFor, indexFor, writeJson } from './lib.mjs';

try {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, output: { type: 'string' }, tarball: { type: 'string' },
    repository: { type: 'string' }, commit: { type: 'string' }, path: { type: 'string' },
  }, strict: true });
  requireValue(values.source === 'npm' || values.source === 'git', 'Use --source npm or --source git. Format 1 has no tarball source.');
  requireValue(values.output, 'Provide --output PATH for the index.');
  const local = await jsonFile(packageFile('package.json'));
  requireValue(local.name !== 'dsh-spirit', 'The name dsh-spirit is occupied by another public plugin. Resolve the package identity before producing a public index.');
  let manifest, source, publishedAt, readPublished, evidence;
  if (values.source === 'npm') {
    requireValue(values.tarball, 'Provide --tarball PATH to the exact npm pack artifact that was published.');
    const packument = await publishedJson(`${registry}${encodeURIComponent(local.name)}`);
    manifest = packument.versions?.[local.version];
    requireValue(manifest, `${local.name}@${local.version} is not published on public npm.`);
    manifestMatches(local, manifest);
    const archive = await readFile(values.tarball);
    const integrity = manifest.dist?.integrity;
    requireValue(typeof integrity === 'string', 'Published npm version does not supply an integrity hash.');
    const hashMatches = integrity.split(/\s+/).some(item => {
      const match = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(item);
      return match && createHash(match[1]).update(archive).digest('base64') === match[2];
    });
    requireValue(hashMatches, 'Local tarball bytes do not match the published npm integrity hash.');
    readPublished = async path => {
      requireValue(!path.startsWith('/') && !path.split('/').includes('..'), 'Invalid tarball member path.');
      const result = spawnSync('tar', ['-xOzf', resolve(values.tarball), `package/${path}`], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
      requireValue(result.status === 0, `Cannot read package/${path} from the published tarball; tar must be installed.`);
      return result.stdout;
    };
    const packedManifest = JSON.parse((await readPublished('package.json')).toString('utf8'));
    manifestMatches(local, packedManifest);
    manifest = packedManifest;
    publishedAt = packument.time?.[local.version];
    source = { type: 'npm', registry };
    evidence = { registry, integrity, tarball: packument.versions[local.version].dist.tarball };
  } else {
    requireValue(values.repository && values.commit, 'Git indexes need --repository URL and --commit FULL_SHA.');
    const repo = githubRepository(values.repository);
    requireValue(/^[0-9a-f]{40}$/.test(values.commit), 'Git commit must be a lowercase, full 40-character SHA.');
    const path = directoryPath(values.path ?? '');
    const commit = await publishedJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${values.commit}`);
    requireValue(commit.sha === values.commit, 'GitHub returned a different commit.');
    const base = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${values.commit}/${path ? `${path}/` : ''}`;
    readPublished = file => publishedBytes(`${base}${file.replace(/^\.\//, '')}`);
    manifest = JSON.parse((await readPublished('package.json')).toString('utf8'));
    manifestMatches(local, manifest);
    publishedAt = commit.commit?.committer?.date;
    source = { type: 'git', url: repo.url, commit: values.commit, ...(path ? { path } : {}) };
    evidence = { repository: repo.url, commit: values.commit, path };
  }
  const seconds = Date.parse(publishedAt) / 1000;
  requireValue(Number.isFinite(seconds) && seconds >= 0, 'The public source did not supply a valid publication/commit time.');
  const patches = Array.isArray(manifest.dsh.bundle.patch) ? manifest.dsh.bundle.patch : [manifest.dsh.bundle.patch];
  const requiredFiles = ['lib/index.js', 'lib/client.js', 'README.md', 'LICENSE', 'NOTICE', ...patches];
  for (const file of requiredFiles) {
    const published = await readPublished(file.replace(/^\.\//, ''));
    const localBytes = await readFile(packageFile(file));
    requireValue(published.equals(localBytes), `Published ${file} differs from the current package. Build the index from the released checkout.`);
  }
  const display = await localizedDisplay(manifest, readPublished);
  const entry = entryFor(manifest, display, {
    version: manifest.version, publishTimestamp: Math.floor(seconds), source,
    engines: { dsh: manifest.engines.dsh },
  });
  const index = indexFor(entry);
  const parsed = parseMarketIndex(index, 'https://validation.invalid/index.json');
  await writeJson(values.output, index);
  await writeJson(`${values.output}.evidence.json`, {
    checkedAt: new Date().toISOString(), package: manifest.name, version: manifest.version,
    publishTimestamp: Math.floor(seconds), source: evidence, comparedFiles: requiredFiles,
  });
  console.log(JSON.stringify({ output: resolve(values.output), package: manifest.name, version: manifest.version,
    install: marketInstallTarget(parsed.plugins[0].name, parsed.plugins[0].versions[0]), publishedIndex: false }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
