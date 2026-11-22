#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { toolsRoot, packageFile, jsonFile, requireValue, githubRepository, directoryPath } from './lib.mjs';

try {
  const { values } = parseArgs({ options: {
    config: { type: 'string', default: resolve(toolsRoot, 'submission.config.json') },
    output: { type: 'string', default: resolve(toolsRoot, 'out/submission') },
  }, strict: true });
  const config = await jsonFile(values.config);
  requireValue(config.repository && config.branch, 'Fill repository and branch in submission.config.json with the actual public project; no files were generated.');
  const repo = githubRepository(config.repository);
  const path = directoryPath(config.packagePath ?? '');
  requireValue(typeof config.branch === 'string' && config.branch.trim() === config.branch && config.branch.length > 0, 'Set the actual default branch.');
  const manifest = await jsonFile(packageFile('package.json'));
  requireValue(manifest.name !== 'dsh-spirit', 'Resolve the public package-name collision before preparing a submission.');
  if (config.commit) requireValue(/^[0-9a-f]{40}$/.test(config.commit), 'commit must be a full lowercase SHA.');
  if (config.releaseTarball) {
    const tarball = new URL(config.releaseTarball);
    requireValue(tarball.origin === 'https://github.com' && !tarball.search && !tarball.hash && !tarball.username && !tarball.password
      && tarball.pathname.startsWith(`/${repo.owner}/${repo.repo}/releases/download/`) && tarball.pathname.endsWith('.tgz'),
    'releaseTarball must be a version-pinned HTTPS .tgz asset under this GitHub repository.');
  }
  const displayName = `${repo.owner}/${repo.repo}${path ? `#${manifest.name.split('/').at(-1)}` : ''}`;
  const url = path ? `${repo.url}/tree/${encodeURIComponent(config.branch)}/${path}` : repo.url;
  const filename = `${repo.owner}__${repo.repo}${path ? `--${path.replaceAll('/', '-')}` : ''}.yml`;
  const en = 'Spirit (精神): personal assistant with persistent conversations, experience memory, autonomous intentions, and checked, reversible source changes.';
  const zh = '精神（Spirit）个人助手：延续会话、记录经验、形成主动意向，并通过验证、检查点和回退改造自身源码。';
  const yaml = [`url: ${JSON.stringify(url)}`, `name: ${JSON.stringify(displayName)}`, 'category: workflow', 'description:',
    `  en: ${JSON.stringify(en)}`, `  zh: ${JSON.stringify(zh)}`,
    ...(config.releaseTarball ? [`tarball: ${JSON.stringify(config.releaseTarball)}`] : []), ''].join('\n');
  await mkdir(values.output, { recursive: true });
  await writeFile(resolve(values.output, filename), yaml);
  const source = config.releaseTarball ? `Prebuilt release artifact: ${config.releaseTarball}` : `Package: ${manifest.name}@${manifest.version}`;
  await writeFile(resolve(values.output, 'awesome-pr.md'), `Adds Spirit (精神), a personal assistant for DeepSeek Harness, as one workflow entry. It maintains conversations, experience memory and autonomous intentions, and provides checked source changes with checkpoints and rollback.\n\nSource: ${url}\n\n${source}\n\nTarget: Harness ${manifest.engines.dsh}, Node.js 24.9+. Linux Web and controlled native-runtime integration have been checked; Electron Desktop, Windows/PowerShell and live-model long-term learning have not been validated. Verification details are included in the package's docs/verification.json.\n\nThe implementation incorporates MIT-licensed SuperAgent code with provenance in NOTICE and upstream/PROVENANCE.json. It contains its own runtime coordination, user controls and UI.\n\nThis PR adds only data/plugins/${filename}. The public repository age, dsh-plugin topic and downloadable artifact must be verified before submission.\n`);
  const gitLine = config.commit ? `固定提交：${config.commit}\n包目录：${path || '仓库根目录'}\n` : '';
  await writeFile(resolve(values.output, 'open-market-issue.md'), `### 插件地址 / Plugin link\n\n${url}\n\n包：${manifest.name}@${manifest.version}\n${gitLine}\n### 简短说明 / Summary\n\n${zh}\n\n它以持续的个人关系与事务处理为主线，结合跨会话操作、可纠正经验和自身源码改动。与仅记录体验或注入角色状态的插件不同，这个插件还协调主动意向、事务执行、暂停/停止及改动验证与恢复。\n\n### 补充信息 / Additional details\n\n- Harness ${manifest.engines.dsh}；Node.js 24.9+；MIT。\n- 已验证 Linux Web 与受控宿主集成；证据见包内 docs/verification.json。\n- Electron 桌面、Windows/PowerShell、真实模型的长期自主学习效果尚未验收。\n- 模型与工具由 Harness 提供；不包含模型密钥，不宣称训练 API 模型权重或验证意识。\n- 自身改造需源码写权限；完整激活使用独立监督启动器。\n- 上游来源见 NOTICE 与 upstream/PROVENANCE.json。\n\n开放插件市场只接受已发布 npm 或包含构建产物的固定 Git 提交；GitHub Release 附件不能单独作为它的来源。此文件是本地投稿草稿，未发送。\n`);
  console.log(JSON.stringify({ output: resolve(values.output), awesomeEntry: `data/plugins/${filename}`,
    targets: ['https://github.com/awesome-dsh-plugin/awesome-dsh-plugin', 'https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml'],
    publicSourceVerified: false, sent: false }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
