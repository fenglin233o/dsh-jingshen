# 精神 0.4.2

fenglin 的 DeepSeek Harness 个人助手，目标宿主为 `0.2.2-rc.5`。

- 插件自带中文女声和普通话识别模型。装入官方宿主后即可在小肥鱼通讯窗接通，录音和语音合成都在本机 CPU 上完成。
- 一条回复可以先播放第一个意群，再继续合成后文。开口打断会取消这条朗读，下一次发言仍使用同一主会话。
- 沿用原来的 profile 和状态目录。通话输出可以切换到设备已安装的普通话声线，也可继续使用先前显式配置的语音服务。

```sh
dsh plugin --profile spirit add /绝对路径/dsh-jingshen-0.4.2.tgz
```

[使用说明](../README.md) · [通话与视觉](../docs/MEDIA.md) · [实际通话样音](../media/voice/xiaoyu-light-preview.mp3) · [验证记录](../docs/verification.json)
