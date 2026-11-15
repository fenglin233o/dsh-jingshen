import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const toolsRoot = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(toolsRoot, '..');
export const registry = 'https://registry.npmjs.org/';

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function packageFile(path) {
  requireValue(typeof path === 'string' && path.length > 0, 'Expected a package-relative file path.');
  const target = resolve(packageRoot, path);
  const rel = relative(packageRoot, target);
  requireValue(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'), `Path leaves package: ${path}`);
  return target;
}

export async function publishedBytes(url, limit = 32 * 1024 * 1024) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  requireValue(response.ok, `HTTP ${response.status}: ${url}`);
  const length = Number(response.headers.get('content-length'));
  requireValue(!Number.isFinite(length) || length <= limit, `Response exceeds limit: ${url}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      requireValue(size <= limit, `Response exceeds limit: ${url}`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

export async function publishedJson(url) {
  return JSON.parse((await publishedBytes(url)).toString('utf8'));
}

export function githubRepository(value) {
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && url.hostname === 'github.com'
    && !url.username && !url.password && !url.search && !url.hash,
  'Repository must be a public https://github.com/OWNER/REPO URL without credentials, query, or fragment.');
  const pieces = url.pathname.replace(/\.git$/, '').replace(/\/$/, '').split('/').filter(Boolean);
  requireValue(pieces.length === 2 && pieces.every(part => /^[A-Za-z0-9_.-]+$/.test(part)), 'Expected GitHub owner/repository.');
  return { url: `https://github.com/${pieces.join('/')}`, owner: pieces[0], repo: pieces[1] };
}

export function directoryPath(value = '') {
  requireValue(typeof value === 'string' && (value === '' || value.split('/').every(part =>
    /^[A-Za-z0-9._@+-]+$/.test(part) && part !== '.' && part !== '..')), 'Invalid package subdirectory.');
  return value;
}

export function manifestMatches(local, published) {
  for (const field of ['name', 'version']) {
    requireValue(local[field] === published[field], `Published ${field} differs from the local package.`);
  }
  requireValue(JSON.stringify(local.dsh?.bundle) === JSON.stringify(published.dsh?.bundle), 'Published dsh.bundle differs.');
  requireValue(local.engines?.dsh === published.engines?.dsh, 'Published engines.dsh differs.');
  requireValue(published.private !== true && !published.deprecated, 'Published version is private or deprecated.');
}

export async function localizedDisplay(manifest, read) {
  const title = {};
  const description = {};
  for (const lang of ['en', 'zh']) {
    const path = manifest.exports?.[`./locale/${lang}.json`];
    if (typeof path !== 'string') continue;
    const locale = JSON.parse((await read(path.replace(/^\.\//, ''))).toString('utf8'));
    if (locale.meta?.title) title[lang] = locale.meta.title;
    if (locale.meta?.description) description[lang] = locale.meta.description;
  }
  return {
    title: title.en ? title : manifest.name,
    description: description.en ? description : manifest.description,
  };
}

export function entryFor(manifest, display, version) {
  const author = typeof manifest.author === 'object' ? manifest.author?.name
    : typeof manifest.author === 'string' ? manifest.author.replace(/<[^>]*>|\([^)]*\)/g, '').trim() : undefined;
  let repository;
  if (manifest.repository) {
    const declared = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository.url;
    const normalized = declared?.replace(/^git\+/, '').replace(/\.git$/, '');
    if (normalized) {
      const repo = githubRepository(normalized);
      repository = { url: repo.url };
      if (manifest.repository.directory) repository.directory = directoryPath(manifest.repository.directory);
    }
  }
  return {
    name: manifest.name,
    ...display,
    ...(author ? { author } : {}),
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    ...(repository ? { repository } : {}),
    metadata: { keywords: manifest.keywords ?? [] },
    versions: [version],
  };
}

export function indexFor(entry) {
  return {
    format: 1,
    title: { en: 'Spirit plugins', zh: '精神插件索引' },
    description: { en: 'Independent personal assistant for DeepSeek Harness.', zh: 'DeepSeek Harness 独立个人助手插件。' },
    plugins: [entry],
  };
}

export async function writeJson(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
