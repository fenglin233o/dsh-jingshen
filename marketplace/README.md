# 精神：公开分发与市场收录

核查日期：2026-11-15。目标包版本 0.2.0，Harness 0.2.2-rc.3，Node.js 24.9+。这些文件是发布材料和本地工具，**不表示已经发布、提交或获准收录**。

## 本次选定的市场

按用户选择的“市场插件中 GitHub star 数最多者”，主目标为 **[dshmarket](https://github.com/dsh-market/dsh-market)**。2026-11-15 15:18 UTC 的 GitHub API 查询显示其有 **12,508 stars**；同次查到的相关市场插件中，`LivXue/dsh-plugin-shop` 为 665，`dshplugin/dsh-plugin-hub` 为 528，`2BingLing/dsh-market` 为 208，`bradeGithub/DSH-Plugins-Marketplace` 为 205。另做了按 stars 降序的英文/中文市场关键词搜索，结果一致；这是对查到的相关插件的比较，不把精选目录的 stars 算成市场插件的 stars。可复查记录见 [market-selection.json](market-selection.json)。

本次公开包名选为 **`dsh-jingshen`**，显示名仍为“精神”，作者署名 **fenglin**。用户没有 npm 账户，因此主发布路径是：**公开 GitHub 仓库 → 预构建 Release `.tgz` → awesome-dsh-plugin 单 YAML PR → 审核合并后由 dshmarket 目录同步**。GitHub 实际账户和仓库 URL 确认后再写入 metadata；署名不等同于 GitHub handle。无需为这条主路径先创建 npm 账户。

## 已核实的发布路径

Harness 0.2.2-rc.3 及本次核查的官方 `master` 都没有默认索引源。打开「插件 → 实验性插件 → 自定义插件索引」后，用户在「发现」中添加一个索引 URL，才能搜索该索引里的插件。npm 上出现一个带 `dsh-plugin` 关键词的包，不会使它自动出现在所有人的 Harness 中。

| 目标 | 提交与审核 | 可以安装的来源 | npm 是否必须 |
| --- | --- | --- | --- |
| 自己发布原生「发现」索引 | 自己托管 `index.json`，用户添加 URL；无需向 DeepSeek 提交 PR | npm 精确版本，或固定 40 位 Git 提交及包目录 | 否；Git 提交必须包含可安装内容 |
| `dshmarket` 社区市场界面 | 向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交单个 YAML 文件 PR；CI 后由维护者读源码评审 | npm、Git 源码或预构建 GitHub Release `.tgz` | 否 |
| 上述社区提供的原生「发现」索引 | 同一社区条目审核后，还须被其 npm 映射采集 | **当前生成器仅导出 npm 条目** | 当前是；GitHub-only 会被跳过 |
| 开放插件市场 `dshopen.org` | 向 `polang233/dsh-plugin-index` 发收录 Issue；维护者核对归属、内容和基础安全性 | npm，或含构建产物的固定 GitHub 提交 | 否；不接受 Release 附件作为来源 |

社区项目与 DeepSeek 官方没有隶属关系。没有查到官方集中收录库或全局自动上架流程；上表的 PR/审核规则来自各社区自己的贡献指南。

已存在的索引地址：

- `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`：awesome-dsh-plugin 的 npm 子集。
- `https://dshopen.org/index.json`：开放插件市场；可申请固定 Git 来源。

官方 format 1 的 `source.type` 只有 `npm` 和 `git`。GitHub Release 的 `.tgz` URL 可供插件管理器直接安装，也可填进 awesome 目录的 `tarball` 字段，但不能伪装为原生索引的 Git 来源。

## 先确定发布身份

公开 npm 包名 **`dsh-spirit` 已被另一项目使用**：本次查询返回 200，维护者 `drscrewdriver`，最新版本 `0.9.0`，仓库为 `drscrewdriver/dsh-spirit`。不要把此项目发布到该名称下，也不要把现有包当成本项目的发布结果。`dsh-personal-spirit` 和 `dsh-jingshen` 在核查时返回 404；这不是保留名称或保证可发布。

本次已确定包名 `dsh-jingshen` 和署名 fenglin，还需实际的 GitHub 账户和公开仓库。npm 路径仅为后续可选方案。原始源码 checkout 的 `origin` 指向 SuperAgent 上游，不能据此填成本项目的公开发布仓库。`submission.config.json` 对未知值使用 `null`；填写真实值后再生成投稿。

最终包名改动要涵盖 `package.json`、lockfile、bundle patch 的插件 `name`、客户端模块加载 ID/构建配置，以及 `upstream/src/infra/paths.ts` 中的上游资源定位。预设 ID、状态目录名和历史会话标识可保持稳定，不应全局替换所有字符串。改名后需重新构建、检查和打包。

## 包的展示信息

`package-metadata.fragment.json` 是待合并片段，**保留原来的 exports，并向 files 追加内容**。它提供 npm 关键词、公开发布设置，以及指向本目录 `locale/` 的英文/中文元数据导出。

官方参考生成器的读取顺序是：

- `./locale/en.json`、`./locale/zh.json` 的 `meta.title` / `meta.description`，通过 package exports 读取；缺失时回退到包名/description。
- `package.json` 的 `keywords` → 索引 `metadata.keywords`。关键词帮助已配置索引内的搜索，不会触发收录。
- manifest 的 `author`、`homepage`、`repository`，以及 monorepo 的 `repository.directory`。只填写真实公开信息。
- `engines.dsh` 原样进入版本兼容范围。目前保持 `0.2.2-rc.3`，不放宽到尚未验证的宿主版本。

本次使用用户确认的作者署名 fenglin，未添加虚构主页、仓库、下载量、审核标签或 Desktop 支持声明。市场详情默认可以使用包内 README；无需另造介绍页面。

## 本地发布检查

以下命令从最终公开发行的包根目录执行；本次准备为独立的 `dsh-jingshen/`。工具依赖在独立的 `marketplace/` 中，`private: true` 防止把工具目录误发成插件。

```sh
npm --prefix marketplace ci --ignore-scripts
npm run check
npm --prefix marketplace run check
npm --prefix marketplace run check -- --online
npm pack --ignore-scripts
```

`check-release.mjs` 检查真实包的名称、兼容范围、lockfile、客户端模块 ID、bundle 引用、保留上游资源定位、locale 元数据和 `npm pack --dry-run` 的实际文件列表。它使用官方 `@deepseek-ai/dsh-plugin-market-index@0.2.2-rc.3` 校验元数据；`--online` 还只读查询公开 npm 名称及该版本是否已存在。检查不代替宿主集成测试，也不判断账户是否拥有发布权。

公开发布前继续使用包内 `docs/verification.json` 所记录的真实验证范围。Electron Desktop 尚未验收，Linux Web 通过不代表桌面发行通过；真实模型的长期学习或行为改善也未由受控测试证明。

### npm 路径

使用已完成检查的 `.tgz` 发布到实际有权使用的名称，保留这份原始 tarball。发布完成后才生成索引：

```sh
# PACKAGE_TGZ 是本次 npm pack 生成并核对过的文件路径。
npm publish "$PACKAGE_TGZ" --access public --registry=https://registry.npmjs.org/

node --use-env-proxy marketplace/build-index.mjs \
  --source npm --tarball "$PACKAGE_TGZ" \
  --output marketplace/out/index.json
node marketplace/verify-index.mjs --file marketplace/out/index.json
```

生成器要求该精确版本已出现在公开 npm，验证原始 tarball 的字节与 registry 的 SRI hash 一致，再比较包 manifest、运行入口、补丁、README 和许可文件；发布时间取 npm 的版本发布时间，绝不使用准备材料的时间冒充发版时间。工具需要系统 `tar` 以只读方式读取该 tarball。

### 固定 Git 提交路径

公开提交中的包目录必须包含 `package.json`、bundle patch、`lib/index.js`、`lib/client.js` 及运行资产。当前插件没有 Git 安装用的 `prepare`；只发布 TypeScript 源码不足以让 Git 安装加载。优先提交已验证的构建产物到实际发行提交；如果另行引入构建生命周期脚本，还要处理 pnpm 对构建的授权，不能宣称无需构建就能装。

```sh
# REPOSITORY、COMMIT_SHA 为实际公开 GitHub 仓库及完整提交。
# 本次独立公开仓库以包目录为根，不加 --path。
node --use-env-proxy marketplace/build-index.mjs \
  --source git --repository "$REPOSITORY" --commit "$COMMIT_SHA" \
  --output marketplace/out/index.json
node marketplace/verify-index.mjs --file marketplace/out/index.json
```

生成器从 GitHub 读取这个固定提交，核对包名/版本和主要发行文件的字节，使用提交者时间作为索引时间。没有公开提交就会失败，不会输出假安装地址。当前工具专门支持公开 GitHub 仓库；官方索引格式也能表示其他 HTTPS Git 主机。

将实际生成的 `index.json` 置于静态 HTTPS 地址。该 URL 必须直接返回 2xx，不能依赖重定向。生成的 `.evidence.json` 可留作发布记录，不必对外托管。托管完成后检查：

```sh
node --use-env-proxy marketplace/verify-index.mjs --url "$INDEX_URL"
```

然后用一个干净的 Harness profile 添加该 URL，搜索「精神」与最终包名，核对版本和来源并安装。这一步验证“能在市场搜索安装”；本地 schema 校验通过不等于这一验收已完成。脚本生成的是本次单版本索引；需要保留历史版本或汇集多个插件时，可使用官方参考生成器。

### GitHub Release 安装包路径

GitHub Release 可以上传与检查结果一致的 `.tgz` 和校验和，并使用**固定 tag + 版本文件名**。awesome-dsh-plugin 的 `tarball` 字段可指向它，用户也可通过自己的 profile 直接安装：

```sh
dsh plugin --profile spirit add "$RELEASE_TARBALL_URL"
```

这条路径不需要 npm 登录，但只靠 Release 附件不能进入原生 format 1 索引。也不要将 CLI 的 `spirit` profile 当成 Electron 应用管理的 profile。

## 生成社区投稿

填写 `submission.config.json` 中的真实仓库、默认分支、包目录，以及已有的固定 Release tarball 或 Git 提交。仓库根就是插件目录时将 `packagePath` 设为空字符串。

```sh
node marketplace/prepare-submission.mjs
```

它只写本地 `marketplace/out/submission/`：一个 awesome 目录 YAML、PR 正文和开放插件市场 Issue 正文。生成过程不验证仓库已公开，投稿前须核对链接、发行文件和归属。

awesome-dsh-plugin 的具体规则：

1. 新增 `data/plugins/<owner>__<repo>.yml`；子目录条目用 `owner__repo--personal.yml` 并让 `url` 指向子目录。只提交自己这一项，不改自动生成的 README。
2. 仓库创建已满 **1 天**，添加 `dsh-plugin` topic，具有真实代码和 `dsh.bundle`。这是社区自己的门槛。
3. 双语描述只陈述现有能力；当前条目选择 `workflow`。可选 `tarball` 必须是该 GitHub 仓库 Release 的 HTTPS `.tgz`；无需填写 `npm:` 字段，后者反而会被拒。
4. CI 检查后由维护者阅读源码评审。合并后由社区构建发布目录；等待期间不能声称已收录。
5. npm 包的 `repository` 必须正确指回该项目，社区才会自动建立 npm 映射。仅有 Release 包的条目进入其市场界面，但目前不进入其原生索引导出。

开放插件市场通过 [收录申请](https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml) 接受 npm 包或固定 Git 提交。公开源码、明确 MIT 许可、bundle patch、构建产物、用途及版本信息需要齐全；维护者会做基础安全审查。它接受 1–6 张实际使用截图。awesome 则可在插件 package.json 旁声明 `screenshots.json`，列出 1–8 张仓库内相对图片路径。只使用真实测试画面，避免把 Web 截图标成已通过 Desktop 验收。

## 依据

- [官方插件索引指南（本次核查提交）](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/user/guide/plugin-market.zh.md)
- [官方参考生成器](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/apps/plugin-market-generator/README.zh.md)
- [官方索引格式校验器](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/util/plugin-market-index/src/index.ts)
- [官方打包与安装说明](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/user/develop/basic/publish.zh.md)
- [dshmarket 的投稿指引](https://github.com/dsh-market/dsh-market#submit-your-plugin)
- [awesome-dsh-plugin 贡献指南（本次核查提交）](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/1cdd13cfeaae82c7f5c649b5d49866615a84edd3/contributing.md)
- [awesome 原生索引导出仅含 npm 的实现](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/1cdd13cfeaae82c7f5c649b5d49866615a84edd3/scripts/lib/market-index.mjs)
- [开放插件市场贡献指南](https://github.com/polang233/dsh-plugin-index/blob/HEAD/.github/CONTRIBUTING.md)

在本机还核对了已安装的官方 0.2.2-rc.3 `dsh-plugin-market-index`、`dsh-plugin-market`、`dsh-plugin-manager` 与 `dsh/docs`。公开名称查询摘要见 [research.json](research.json)。
