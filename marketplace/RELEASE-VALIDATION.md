# 精神 0.4.3 发行包复核

包名为 `dsh-jingshen`，作者 fenglin。唯一目标宿主为 DeepSeek Harness `0.2.2-rc.5`，Node.js 要求 24.9+。

标准包应包含 Zipformer 中文 CTC 识别模型、词表及许可，并可通过 rc.5 的 Sherpa-ONNX 在本地转写。可选的 `dsh-jingshen-0.4.3-local-voice-assets.tgz` 提供 PrimeTTS 权重与 ONNX Runtime Web CPU 运行时。检查两份发行材料的文件清单、许可证，以及将可选资产解压到标准包后显式启用本机合成的路径。

默认合成接线的复核范围包括缺少密钥时的提示和仅转写状态，原生凭据的保存及宿主环境变量的读取，通话接通后已交付正文的 PCM 朗读请求，以及打断、挂断、错误和显式输出选择。Linux Web 验收在真实 rc.5 中使用受控音频流。另用真实 Breeze 密钥经插件适配器完成 7 次中文合成，返回 24 kHz 单声道 PCM。账户扣费金额未经核对。官方样音由 Breeze 提供。[迷糊版官方试听](https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2)

发行包大小与兼容性以最终构建的验收记录为准。此前对单一精神预设、真实旧状态升级和 Linux Web 的完整复核见 [0.4.0 验证档案](../docs/verification-0.4.0.json)。[版本验证记录](../docs/verification.json)标明每份结果所对应的包版本。

安装本地包的步骤见 [README](../README.md)。公开发行标签及市场收录状态以实际仓库和社区目录为准。
