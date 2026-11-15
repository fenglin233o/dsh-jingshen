# 公开发行版复核

包：`dsh-jingshen@0.2.0`；作者署名：fenglin；Harness：`0.2.2-rc.3`。

公开包为可独立构建的源码目录。原私用包和原有下载文件保持不变。

- 新名称写入 manifest、lockfile、宿主加载入口与客户端 ModuleLoader ID。
- 运行资产目录识别新名称；预设、来源标记、默认状态目录和会话历史标识保持稳定。
- 双语市场 metadata、关键词和 MIT/上游来源随发行资料提供。
- 干净 `npm ci`、严格 TypeScript 检查和生产构建通过。
- 130 项自动化测试通过；18 项官方 rc.3 受控宿主集成检查通过。
- 新名称包在独立 Web profile 中通过实际浏览器验收；面板、主会话、刷新、新浏览器、权限与暂停恢复正常，页面错误为零。
- 测试使用本地确定性适配器，不证明真实模型的长期学习与改善效果。

完整构建摘要见 `docs/verification.json`。公开源码仓库为 https://github.com/fenglin233o/dsh-jingshen 。安装包发布与社区市场收录分别核实，实际状态以 GitHub Release 和社区目录的审核结果为准。
