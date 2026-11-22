# 通话、连续视觉与小肥鱼

点击画幅上的小肥鱼打开通讯窗，选择主会话模型。通话和视觉都在这个会话中工作。手机、笔记本和休眠姿态对应实际活动；精神也可以选择独立的表情。

## 给精神打电话

1. 在 DeepSeek Harness 0.2.2-rc.5 中打开小肥鱼通讯窗，选择主会话模型。点击“检查语音”可确认通话实际选用的识别和合成服务。默认合成显示“小肥鱼 · 轻声普通话（宿主本机）”。
2. 点击“试听小肥鱼声线”可播放随包的实际合成样音，无需打开麦克风。当前默认声线是 PrimeTTS v1b 的 16 kHz 单一声线，定位为轻盈的中文女声。[听这一版的实际通话样音](../media/voice/xiaoyu-light-preview.mp3)。
3. 点击“接通并开麦”，在浏览器中授权麦克风。开口可以打断当前朗读，也会终止该条答复仍在继续的生成。之后可以继续说话，其他项目可以继续工作。挂断会释放麦克风。

默认语音在 Harness 宿主的 CPU 上运行。语音合成使用随包的 ONNX Runtime Web。录音转写使用随包的 Zipformer 中文 CTC 模型和宿主随附的 Sherpa-ONNX 运行时。普通文字聊天无需启动语音进程，首次转写或合成时才加载对应模型。默认通话无需 Python、GPU、额外模型、语音服务地址或 API 密钥。会话回复仍由你在 Harness 里选定的聊天模型生成。许可证及来源见 [语音合成声明](../media/voice/local/tts/NOTICE.txt) 和 [语音识别声明](../media/voice/local/asr/NOTICE)。

如想让浏览器所在设备负责朗读，可在“通话输出”中选择“设备中文朗读”。只有设备已经安装普通话声线且浏览器将它标为本机服务（`localService`）时，这个选项才可用。界面显示实际选用的声线名称。麦克风转写仍由“检查语音”显示的识别服务处理。

在已安装依赖的源码目录运行 `node --experimental-transform-types tests/bundled-call-smoke.mjs`，可以在自己的机器上测同一句话冷启动、连续通话时的首段耗时和完整音频时长。

### 使用现有的语音服务

以下是启动 Harness 进程的可选环境变量。重启进程后在通讯窗检查语音。界面会注明每个服务在本机还是云端。选择云端服务时，录音片段交给所选识别服务，已交付的文字交给所选合成服务。

| 设置 | 用途 |
| --- | --- |
| `SPIRIT_ASR_BASE_URL`、`SPIRIT_ASR_MODEL`、`SPIRIT_ASR_API_KEY` | 选择 OpenAI 兼容的 `/audio/transcriptions` 服务。未指定地址时，可继续使用 Harness 已选且可用的本机语音输入，其余情况使用随包普通话识别 |
| `SPIRIT_ASR_LANGUAGE` | 默认 `zh`；选择 `auto` 让服务自行判断语言 |
| `SPIRIT_TTS_BASE_URL`、`SPIRIT_TTS_MODEL`、`SPIRIT_TTS_VOICE`、`SPIRIT_TTS_API_KEY` | 选择 `/audio/speech` 服务、模型、声音与密钥。密钥仅随请求发往显式配置的地址。兼容服务的响应为 24 kHz 单声道有符号 16 位小端 PCM |
| `SPIRIT_TTS_PROTOCOL=audiocpp` | 显式选择 audio.cpp 的 BreezeTTS 2 流式接口。默认地址为 `http://127.0.0.1:8080/v1`，模型标识为 `breeze`，声库别名为 `xiaoyu` |
| `SPIRIT_TTS_STYLE` | 在常规兼容接口中，`pace` 传送语速，`instructions` 传送表演提示 |
| `SPIRIT_TTS_LOCAL_PROBE=0` | 禁用 ZipVoice 或 Kokoro 的本地端口自动发现。显式选择 audio.cpp 时仍会检查相应服务的模型 |

如要继续使用先前配置的 Kokoro，可明确设置 `SPIRIT_TTS_BASE_URL=http://127.0.0.1:8880/v1`、`SPIRIT_TTS_MODEL=kokoro` 和自己的 `SPIRIT_TTS_VOICE`。使用 Sherpa-ONNX、Kokoro v1.1 与 SenseVoice 的本机示例包括录音输入和打断测试。[本机示例](../tests/fixtures/voice-local-server.py) · [浏览器通话验收](../tests/voice-browser-smoke.mjs) · [中文模型与音色编号](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html)

### 继续使用 0.4.1 的 ZipVoice 声线

在插件源码目录执行 `npm run voice` 并保留运行服务的终端。首次准备需要带 venv 的 Python 3.11 或更高版本和网络，后续可复用本机缓存。等服务就绪后，使用下列命令启动 Harness。

```sh
SPIRIT_TTS_MODEL=jingshen-character dsh --profile spirit --no-open
```

这条声线使用随包的原创参考录音和台词，通话服务以 ZipVoice 合成实际交付的发言。原创参考录音由 Qwen3-TTS VoiceDesign 按文字描述生成。ZipVoice 的 Emilia 预训练权重需由可选脚本单独下载，并遵循其非商业许可。[旧版合成样音](../media/voice/xiaoyu-preview.mp3) · [声线设计模型](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign) · [ZipVoice 模型与许可](https://huggingface.co/k2-fsa/ZipVoice#4-license)

### 用 audio.cpp 进行本机声线研究

在同一台电脑运行 audio.cpp v0.9.6，按官方配置示例注册 `id: "breeze"`、`family: "breeze_tts"`、`task: "tts"`、`mode: "streaming"`。将服务绑定到 `127.0.0.1`，按本机硬件选择推理后端。BreezeTTS 2 权重采用 BreezeBlue 研究和非商业许可，使用者在本机自行准备权重和参考录音。[服务配置示例](https://github.com/0xShug0/audio.cpp/blob/v0.9.6/examples/server/breeze-tts.json) · [BreezeTTS 2 模型与许可](https://huggingface.co/BreezeBlue/Breeze-TTS-2)

在 audio.cpp 配置的 `voice_dir` 中放入自己制作或已获得授权的 `xiaoyu.wav`。在同目录的 `prompt_text` 中写一行 `xiaoyu|录音的逐字稿`。名字需要与 WAV 文件的主名一致。启动服务后，用以下环境变量启动 Harness。

```sh
SPIRIT_TTS_PROTOCOL=audiocpp \
  SPIRIT_TTS_BASE_URL=http://127.0.0.1:8080/v1 \
  SPIRIT_TTS_MODEL=breeze SPIRIT_TTS_VOICE=xiaoyu \
  dsh --profile spirit --no-open
```

如果把推理放在局域网的另一台电脑上，请显式填写 `SPIRIT_TTS_BASE_URL`。界面会把非回环地址标为远端服务。未填写地址时只检测本机默认端口，服务不可用时显示合成不可用。

合成请求分别发送正文、声库别名和 `options.instruct`。默认以参考声线自然朗读，精神选择具体语气时才加入对应说明。BreezeTTS 2 逐步输出 24 kHz 单声道 PCM，朗读可以随音频块开始。打断会取消当前 HTTP 读取，服务端停止生成的时机取决于其对连接断开的处理。[audio.cpp v0.9.6 的语音接口](https://github.com/0xShug0/audio.cpp/blob/v0.9.6/app/server/api.md#post-v1audiospeech) · [本机声库格式](https://github.com/0xShug0/audio.cpp/blob/v0.9.6/app/server/README.md#voice-library-voice_dir)

## 共享视觉

在通讯窗或通话中打开“视觉”，可选择摄像头、共享屏幕或浏览器标签页。浏览器持续采集视频，独立 Worker 使用随包的 EfficientDet-Lite0，目标间隔约 0.85 秒；处理不过来时丢弃过期帧。精神可以读到时间、物体标签、位置、置信度和最近的变化。捕获期间可继续说话、打字或工作。现场帧率受硬件、浏览器调度、窗口是否可见和输入源影响。[MediaPipe Web 视频检测](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector/web_js) · [模型卡](https://www.kaggle.com/models/tensorflow/efficientdet/tflite/lite0-detection-metadata/1)

默认只有提取出的识别结果抵达宿主。点击“发送当前画面”才将该帧作为图片写入主会话，交给支持图片输入的已选模型。要结束采集，点击“停止视觉”或使用浏览器停止共享。设备断开、会话暂停或窗口关闭也会释放相应资源。识别器覆盖其训练类别；读屏、文字、剧情或任意场景的深入理解取决于更具体的输入和模型。

## 让它观看视频

在“视觉”中选一个本地视频或填入可直接播放的 HTTPS 媒体地址。精神可以自行决定何时播放或停止。播放器有实际进度，角色才会显示玩手机。远程直链需要支持浏览器读取跨源画面；网站的播放器页面可以使用标签页共享。

你也可以一次授权一个 HTTPS 视频域名，默认建议 Wikimedia Commons 的媒体域名 `upload.wikimedia.org`。授权后，精神能从该域名挑选新的短片、换片、播放或停下。在完全访问模式下，已有开放机会就可以用这项授权，不需要你再发消息。这个通道一次最多读取 25 MiB，下载时省略账号凭据，拒绝重定向。缩小通讯窗后，已授权的本地视频、直链或视频库可以继续工作；实际播放时，画幅上的小肥鱼会玩手机。重新打开并点击“停止视觉”即可收回授权。摄像头、屏幕和已登录浏览器标签页在缩小时释放。

如要控制一个已登录网站的视频播放器，可以安装源包内的可选 Chromium 扩展。

1. 打开 `chrome://extensions`，启用开发者模式，点击“加载已解压的扩展程序”，选择 `media/chromium-video`。在浏览器中用自己的账户打开目标视频页。
2. 先在本地 Harness 页点击该扩展图标，显示“主”；再在目标 HTTPS 视频页点击，显示“✓”。回到精神通讯窗，选择“共享正在用的浏览器标签页”，在浏览器选择器中选刚授权的标签页。
3. 精神可以使用 `spirit_watch` 对该页可见的 HTML 视频执行播放、暂停和查询。扩展仅配对当前文档和实际被捕获的标签页。再次点击图标可以解除授权。更换页面需要重新选择。由浏览器或网站要求的登录、验证码和首次播放手势由本人完成。

工作画幅里的鱼会随获准视频的播放状态改变姿态。[实播截图](../media/screenshots/watching.png)

此次测试的 Chromium 管理策略禁止安装本地扩展。标签页捕获、文档配对和视频播放使用了真实浏览器，扩展的工具栏授权与消息转发使用了测试替身。浏览器允许的标签页共享、本地视频和获准的媒体直链都可以独立使用。通话、摄像头与屏幕共享需要支持这些能力的本机浏览器。

语音打断与实时交互的设计参考了 Open-LLM-VTuber。身份、公开发言、权限与会话投递使用 Harness 原生接口。[交互参考](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/tree/992309c0aa19845960228f880013d4685fde93b5)
