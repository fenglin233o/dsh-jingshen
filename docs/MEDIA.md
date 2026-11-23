# 通话、连续视觉与小肥鱼

点击画幅上的小肥鱼打开通讯窗，选择主会话模型。通话和视觉都在这个会话中工作。手机、笔记本和休眠姿态对应实际活动；精神也可以选择独立的表情。

## 给精神打电话

1. 默认朗读使用 Breeze Blue 的「大肥鱼（迷糊版）」。可以先听官方页面上的试听，再自行在 Breeze 开发者账户创建一把 API 密钥。[迷糊版官方试听](https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2) · [Breeze API 密钥管理](https://breezeblue.ai/zh/app/developer/api-keys)
2. 打开小肥鱼的“通话”，点击“配置 Breeze 密钥”（已有密钥时点“更新 Breeze 密钥”）。在专用输入框中填写后，点击“保存至 Harness”，通话会刷新语音配置。该操作通过 Harness 0.2.2-rc.5 的原生凭据服务在宿主保存 `BREEZE_API_KEY`。请勿把密钥发到聊天、填入其他插件页面或写入仓库。
3. 在小肥鱼通讯窗选定主会话模型，点击“检查语音”确认识别和朗读服务。点击“接通并开麦”后在浏览器授权麦克风。开口可打断当前朗读，挂断会释放麦克风。没有 Breeze 密钥时仍可文字聊天，也可以在有可用识别服务时使用“仅语音转写”。要换声线，请显式选择设备朗读或在宿主配置其他服务。

标准包保留 Zipformer 中文 CTC 识别模型，转写使用宿主的 Sherpa-ONNX。默认云端朗读采用 `breeze-tts-2`、语言 `zh` 和音色 `voc_8yud7hz7c9q2`。接通通话后，宿主只为新交付的公开正文请求 PCM 音频流。该条回复明确选择柔和、温暖、认真或俏皮语气时，宿主另附简短的表演提示，原文照发；默认和中性语气沿用音色本身的读法。麦克风录音、聊天历史和草稿不随合成请求发送。回复内容仍由选定的 Harness 聊天模型生成。[语音识别声明](../media/voice/local/asr/NOTICE)

宿主发送 `enable_logging=false`，请求 Breeze 跳过生成历史记录。服务端仍可能保留运营或计费日志。打断或挂断会停止本地播放并取消仍在读取的流，费用和结算状态以 Breeze 账户明细为准。使用正式 API 和迷糊版音色完成了 7 次中文合成。一次 3.92 秒的试听从发出请求到收到第一块音频耗时 0.921 秒。该时间包含网络与供应商处理，通话还需要浏览器排程播放。[Breeze 流式合成接口](https://docs.breezeblue.ai/api-reference/text-to-speech/stream-text-to-speech)

### 从命令行配置宿主密钥

Harness 使用本地凭据文件时，可将 `BREEZE_API_KEY` 加入现有 `$DSH_HOME/.credentials.yaml` 的 `refs` 部分。未自定义时，文件默认位于 `~/.dsh/.credentials.yaml`。新建文件要写入 `version: 1`，已有文件沿用原有内容和版本。在 Linux 上请将文件权限设为 `0600`。[Harness 本地凭据说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/credentials/credentials-local/README.zh.md)

也可以通过宿主的同名启动环境变量提供密钥。例如在宿主的 Bash 终端执行下列命令，提示后输入实际密钥。

```sh
(
  read -rsp 'Breeze API 密钥：' BREEZE_API_KEY
  printf '\n'
  export BREEZE_API_KEY
  dsh --profile spirit --no-open
)
```

也可在不纳入版本控制的 Harness 主目录 `$DSH_HOME/.env` 设置 `BREEZE_API_KEY`。宿主优先使用已保存的 Harness 凭据。修改启动环境或 `.env` 后重启宿主，再点击“检查语音”。

### Breeze 积分与费用

按 2026 年 11 月 23 日的官方规则，10 个加权字符消耗 1 积分。汉字每个计 2 个，标点、空格、数字和拉丁字母每个计 1 个。50 个纯汉字消耗 10 积分。Free 与非企业付费套餐可每天手动领取 400 积分，Studio 与 API 共用积分余额。充值比例为 3 美元兑 10,000 积分，单次最低充值 5 美元。[Breeze 中文定价](https://breezeblue.ai/zh/pricing) · [Breeze API 计费规则](https://docs.breezeblue.ai/concepts/pricing)

### 选择本机朗读

如想让浏览器所在设备负责朗读，可在“通话输出”中手动选择“设备中文朗读”。设备须已安装普通话声线，且浏览器将它标为本机服务（`localService`）。界面显示实际选用的声线名称，麦克风转写仍由“检查语音”显示的识别服务处理。

要继续用 0.4.2 的 PrimeTTS v1b 轻盈中文女声，请从同版本发布下载 `dsh-jingshen-0.4.3-local-voice-assets.tgz`。先安装标准包，再将资产解压至实际加载的插件根目录，也就是包含该插件 `package.json` 的目录。压缩包提供 `media/voice/local/tts/` 和 `scripts/local-speech/ort/`，安装后仍使用同一个插件和 profile。曾显式配置 `SPIRIT_TTS_PROTOCOL` 或 `SPIRIT_TTS_BASE_URL` 时，先移除这两项设置再启动。

```sh
tar -xzf /绝对路径/dsh-jingshen-0.4.3-local-voice-assets.tgz -C /绝对路径/dsh-jingshen
SPIRIT_TTS_MODEL=jingshen-light dsh --profile spirit --no-open
```

这一选择使用本机 CPU，无需 Breeze 密钥、Python 或 GPU。模型和运行时的许可证随资产包提供。[PrimeTTS 本机样音](../media/voice/xiaoyu-light-preview.mp3)

### 使用现有的语音服务

以下是启动 Harness 进程的可选环境变量。重启进程后在通讯窗检查语音。界面会注明每个服务在本机还是云端。选择云端服务时，录音片段交给所选识别服务，已交付的文字交给所选合成服务。

| 设置 | 用途 |
| --- | --- |
| `SPIRIT_ASR_BASE_URL`、`SPIRIT_ASR_MODEL`、`SPIRIT_ASR_API_KEY` | 选择 OpenAI 兼容的 `/audio/transcriptions` 服务。未指定地址时，可继续使用 Harness 已选且可用的本机语音输入，其余情况使用随包普通话识别 |
| `SPIRIT_ASR_LANGUAGE` | 默认 `zh`；选择 `auto` 让服务自行判断语言 |
| `BREEZE_API_KEY` | 默认 Breeze Blue 云端朗读专用密钥。使用 Harness 凭据或同名宿主环境变量 |
| `SPIRIT_TTS_PROTOCOL=breezeblue` | 显式选择默认的 Breeze Blue 云端服务 |
| `SPIRIT_TTS_BASE_URL`、`SPIRIT_TTS_MODEL`、`SPIRIT_TTS_VOICE`、`SPIRIT_TTS_API_KEY` | 显式选择 `/audio/speech` 服务、模型、声音与该服务的密钥。兼容服务的响应为 24 kHz 单声道有符号 16 位小端 PCM |
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
