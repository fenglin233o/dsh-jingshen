# 精神 0.2.0 · GitHub 源码发行版

面向 DeepSeek Harness **0.2.2-rc.3** 的个人助手，需要 **Node.js 24.9+**。

公开发行包名为 `dsh-jingshen`，显示名“精神”，作者署名 fenglin。

此版本通过公开 GitHub 仓库分发，源码中已提交预构建的 `lib/`，安装无需先在本地运行插件构建。先配置 Harness 的模型账户，再安装到自己的 profile：

```sh
dsh plugin --profile spirit add "github:fenglin233o/dsh-jingshen#v0.2.0"
```

该命令选择固定 `v0.2.0`。拟提交的 `dshmarket` 条目使用 `github:fenglin233o/dsh-jingshen`，跟随默认分支 `main`。本次未发布可下载的独立 `.tgz` 附件；GitHub 自动生成的源码归档包含仓库中已提交的构建产物。

- 延续主会话和事务会话，保存经验、记忆和主动意向。
- 依据事务结果、关注会话中的本人消息和自行选择的时点继续处理事情。
- 使用 Harness 的真实工具与权限；提供暂停、停止和单独停止事务的控制。
- 创建源码改动候选，经检查后应用，并保留检查点、回退和独立恢复入口；独立启动器可按明确激活请求重启宿主。

已完成 Linux 上的 Web 界面和受控宿主集成验证；详细记录随包提供在 `docs/verification.json`。Electron 桌面安装、Windows/PowerShell 和真实模型的长期自主学习效果尚未验收。这里的记忆、技能和源码改动不表示训练 API 模型权重，也不构成对意识的验证。

本插件独立改造自 MIT 许可的 SuperAgent，来源、保留代码及变更见 `NOTICE` 与 `upstream/PROVENANCE.json`。插件安装、独立监督启动器、源码改造和恢复方式见仓库 README；CLI 的 `spirit` profile 不等同于 Electron 应用管理的 profile。市场收录仍需目录 PR 的 CI 和维护者评审，本说明不表示已获收录。
