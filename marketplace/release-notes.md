# 精神 0.4.1

fenglin 的 DeepSeek Harness 个人助手，目标宿主为 `0.2.2-rc.5`。

- 更新小肥鱼的角色声线，随包提供声音参考和可直接试听的样例。
- 在源码目录执行 `npm run voice` 可准备模型并启动本机角色语音合成服务。通话仍需要就绪的语音识别；显式配置的服务优先。
- 沿用原来的状态目录和 profile 可接续已有聊天、权限及工作。0.4.0 的完整功能与验证见 [历史验证记录](../docs/verification-0.4.0.json)。

```sh
dsh plugin --profile spirit add /绝对路径/dsh-jingshen-0.4.1.tgz
```

[使用说明](../README.md) · [通话与视觉](../docs/MEDIA.md) · [试听小肥鱼](../media/voice/xiaoyu-preview.mp3) · [验证记录](../docs/verification.json)
