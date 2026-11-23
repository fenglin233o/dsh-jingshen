# 精神 0.4.3

fenglin 的 DeepSeek Harness 个人助手，唯一目标宿主为 `0.2.2-rc.5`，需要 Node.js 24.9+。

- 小肥鱼通话默认使用 Breeze 云端的「大肥鱼（迷糊版）」。从“通话 → 配置 Breeze 密钥”保存专用凭据后，接通通话才会将已交付的发言正文发往 Breeze 进行流式朗读。默认普通话录音转写仍在本机完成。
- 可以手选设备已安装的普通话声线，沿用显式配置的语音服务，或安装同版本的 `dsh-jingshen-0.4.3-local-voice-assets.tgz` 并选择 `SPIRIT_TTS_MODEL=jingshen-light`。继续使用原来的 profile 和状态目录。
- 发行验收未用有效 Breeze 密钥生成音频。实际费用、通话听感和云端延迟仍待实测。可以先听官方音色页的已有试听。

```sh
dsh plugin --profile spirit add /绝对路径/dsh-jingshen-0.4.3.tgz
```

[使用说明](../README.md) · [通话配置与计费](../docs/MEDIA.md) · [迷糊版官方试听](https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2) · [发行包复核](RELEASE-VALIDATION.md)
