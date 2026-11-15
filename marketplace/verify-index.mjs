#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { packageFile, jsonFile, publishedJson, requireValue } from './lib.mjs';

try {
  const { values } = parseArgs({ options: {
    file: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' },
  }, strict: true });
  requireValue(!!values.file !== !!values.url, 'Provide exactly one of --file PATH or --url URL.');
  if (values.url) {
    const url = new URL(values.url);
    requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Use the final HTTPS index URL without credentials or fragment.');
  }
  const raw = values.file ? JSON.parse(await readFile(values.file, 'utf8')) : await publishedJson(values.url);
  const parsed = parseMarketIndex(raw, values.url ?? 'https://validation.invalid/index.json');
  const local = await jsonFile(packageFile('package.json'));
  const name = values.name ?? local.name;
  const version = values.version ?? local.version;
  const entry = parsed.plugins.find(plugin => plugin.name === name);
  requireValue(entry, `${name} is not listed in this index.`);
  const listed = entry.versions.find(item => item.version === version);
  requireValue(listed, `${name}@${version} is not listed in this index.`);
  requireValue(listed.engines.dsh === local.engines.dsh, 'Index compatibility differs from the local package.');
  console.log(JSON.stringify({ valid: true, checked: values.url ? 'public-index-schema-and-listing' : 'local-index-schema-and-listing',
    name, version, title: entry.title, keywords: entry.metadata.keywords,
    engines: listed.engines, install: marketInstallTarget(name, listed),
    installedOrExecuted: false }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
