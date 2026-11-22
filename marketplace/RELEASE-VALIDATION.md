# 精神 0.4.2 本地发行包复核

包名为 `dsh-jingshen`，作者 fenglin。唯一目标宿主为 DeepSeek Harness `0.2.2-rc.5`，Node.js 要求 24.9+。

本版默认使用 PrimeTTS v1b 16 kHz 单一声线、随包的 Zipformer 中文 CTC 识别模型和 ONNX Runtime Web CPU 运行时，并复用 rc.5 的 Sherpa-ONNX。真实宿主的验收项目包括干净 profile 下的设备检测、随包样音、开麦转写、答复朗读、打断和挂断。默认路径应在未配置语音服务、未下载额外模型且无需 Python 或 GPU 的情况下工作。文字聊天期间无需启动语音进程，转写和合成在实际使用时加载。

发行包检查需要核对 TTS、ASR、WASM、随包样音及各自的许可声明。兼容性、大小和性能以最终构建的实际验证记录为准。此前对单一精神预设、真实旧状态升级和 Linux Web 的完整复核见 [0.4.0 验证档案](../docs/verification-0.4.0.json)。[版本验证记录](../docs/verification.json)标明每份结果所对应的包版本。

安装本地包的步骤见 [README](../README.md)。公开发行标签及市场收录状态以实际仓库和社区目录为准。
