# PowerTokens CLI

Terminal access to Chinese AI models — chat, image generation, video generation, and TTS from your command line.

## Install

```bash
npm install -g powertokens-cli
```

## Quick Start

```bash
# 1. Set your API key
pt login

# 2. Chat with a model
pt chat "Explain quantum computing in one sentence"

# 3. Generate an image
pt generate -m seedream-5-0-260128 -p "a cat wearing a spacesuit" -o cat.png

# 4. List all available models
pt models
```

## Commands

### `pt login [key]`

Configure your PowerTokens API key. If `key` is omitted, prompts interactively.

```bash
pt login                         # interactive prompt
pt login sk-your-api-key-here    # direct argument
```

### `pt whoami`

Show current user info — API key prefix, base URL, and available model count.

### `pt logout`

Remove the stored API key.

### `pt chat [prompt]`

Chat with an LLM model. Reads from stdin if no prompt argument is given.

```bash
pt chat "What is TypeScript?"                     # inline prompt
pt chat -m deepseek-v4-pro "Write a poem"         # pick a model
pt chat -s "You are a poet" "Write a haiku"       # system prompt
pt chat -t 2048 "Write a long story"               # max output tokens
echo "Explain recursion" | pt chat                 # pipe from stdin
```

Options:
| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model` | `glm-4.7-flash` | Model ID |
| `-s, --system` | — | System prompt |
| `-t, --max-tokens` | `1024` | Max output tokens |

### `pt generate`

Generate images, video, or audio.

```bash
# Image (文生图 — 所有图片模型通用)
pt generate -m seedream-5-0-260128 -p "cyberpunk city" -o city.png
pt generate -m kling-v2 -p "一只橘猫坐在窗台上" -o cat.png
pt generate -m qwen-image-2.0-pro -p "科幻城市夜景" -o city.png

# Image-to-image (图生图): local image auto-converted to the right format per provider
pt generate -m kling-v2 -p "保持人物形象不变" --ref start_frame.jpg -o out.png

# Video (文生视频 — 所有视频模型通用)
pt generate -m dreamina-seedance-2-0-260128 -p "a dog running on the beach" -o dog.mp4
pt generate -m kling-v2-1-master -p "一只可爱的小兔子" -o kling.mp4
pt generate -m MiniMax-Hailuo-02 -p "the girl smiles" -o hailuo.mp4

# Image-to-video (图生视频): local image auto-converted to the right format per provider
pt generate -m dreamina-seedance-2-0-260128 -p "camera slowly pushes in" --ref start_frame.jpg -o out.mp4
pt generate -m kling-v2-1-master -p "镜头拉远" --ref start_frame.jpg -o out.mp4
pt generate -m MiniMax-Hailuo-02 -p "the girl smiles" --ref start_frame.jpg -o out.mp4

# First-last-frame video (首尾帧 — Seedance / MiniMax Hailuo / MiniMax H3 / Wan / Vidu)
pt generate -m dreamina-seedance-2-0-260128 -p "smooth transition" --ref first.jpg --last-frame last.jpg -o out.mp4
pt generate -m wan2.2-kf2v-flash -p "smooth transition" --ref first.jpg --last-frame last.jpg -o out.mp4
pt generate -m viduq3-turbo -p "smooth transition" --ref first.jpg --last-frame last.jpg -o out.mp4

# Reference video / audio (参考视频/音频 — Seedance / MiniMax H3)
pt generate -m dreamina-seedance-2-0-260128 -p "same style" --ref-video ref.mp4 -o out.mp4
pt generate -m dreamina-seedance-2-0-260128 -p "lip sync" --ref-audio voice.mp3 -o out.mp4

# Multimodal reference (多模态参考生视频 — 参考图 + 参考视频 + 参考音频，Seedance / MiniMax H3)
pt generate -m dreamina-seedance-2-0-260128 -p "参考生视频" --ref ref-img.jpg --ref-video ref.mp4 --ref-audio voice.mp3 -o out.mp4

# Motion control (运镜控制 — Kling，参考图 + 动作参考视频)
pt generate -m kling-v3 -p "保持人物动作不变" --ref char.jpg --ref-video https://example.com/dance.mp4 --character-orientation image -o out.mp4
# 或用 --params 全量透传（video_url/character_orientation 会自动触发运镜控制端点）
pt generate -m kling-v3 -p "保持人物动作不变" --ref char.jpg --params '{"video_url":"https://example.com/dance.mp4","character_orientation":"image","keep_original_sound":"yes"}' -o out.mp4

# Audio (TTS)
pt generate -m speech-2.6-hd -p "Hello, welcome to PowerTokens" -o hello.mp3
```

Options:
| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model` | `seedream-5-0-260128` | Model ID |
| `-p, --prompt` | — | Generation prompt |
| `-o, --output` | — | Output file path |
| `-s, --size` | — | Image size (per provider: Seedream `2048x2048`, Kling `1k`/`2k`/`4k`, Qwen/Wan `2048*2048`/`2K`) |
| `-r, --resolution` | `720p` | Video resolution (per provider: Seedance/Wan `480p`/`720p`/`1080p`, Kling `std`/`pro`/`4k`, Vidu `540p`/`720p`/`1080p`, Hailuo `768P`/`1080P`) |
| `-d, --duration` | — | Video duration in seconds |
| `--ref` | — | Reference image / first frame (local path, URL, Base64, or asset://) |
| `--last-frame` | — | Last frame (Seedance / MiniMax Hailuo / MiniMax H3 / Kling / Wan / Vidu) |
| `--ref-video` | — | Reference video (Seedance / MiniMax H3 / Kling motion control) |
| `--ref-audio` | — | Reference audio (Seedance / MiniMax H3 / Wan) |
| `--character-orientation` | — | Kling motion control character orientation (`image`/`video`) |
| `--asset-group-id` | — | Asset group ID for Seedance asset upload (default empty) |
| `--negative-prompt` | — | Negative prompt (Kling / Seedream / Wan) |
| `--aspect-ratio` | — | Aspect ratio (Kling / Vidu) |
| `--seed` | — | Random seed (Seedream / Vidu / Wan) |
| `--num` | — | Number of images to generate |
| `--watermark` | — | Enable watermark (Seedream / Seedance / MiniMax Hailuo / Kling / Wan / Vidu / Qwen) |
| `--sound` | — | Video sound (Kling). `--sound` = on, `--sound off` = off |
| `--generate-audio` | — | Video with audio (Seedance / Vidu) |
| `--ratio` | — | Seedance ratio (16:9/4:3/1:1/adaptive) |
| `--voice` | — | TTS voice name (MiniMax speech) |
| `--params` | — | Extra provider params as JSON, merged into request |

> **`--params` JSON 透传**：任意文档参数都可通过 `--params` 透传给供应商，直接合并进请求体。示例：
> ```bash
> pt generate -m kling-v2 -p "cat" --params '{"image_reference":"face","aspect_ratio":"1:1"}'
> pt generate -m dreamina-seedance-2-0-260128 -p "dog" --params '{"generate_audio":true,"watermark":false}'
> ```
>
> **完全透传**：当 `--params` 里直接带 `content`（或 `media`）数组时，CLI 把它当作**完整请求体**原样发送（只额外补一个 `model` 字段），此时**无需 `-p`**：
> ```bash
> pt generate -m dreamina-seedance-2-0-260128 --params '{"content":[{"type":"text","text":"提示词"},{"type":"image_url","image_url":{"url":"asset://xxx"},"role":"first_frame"}],"duration":4,"resolution":"480p","ratio":"1:1"}' -o out.mp4
> ```
>
> **Kling 分辨率说明**：Kling 的 `-r std/pro/4k` 是**画质档位**而非像素尺寸，最终像素由上游 Kling 后端决定，CLI 仅透传 `mode` + `aspect_ratio`。实测 kling-v3 的 `std` 档在 `1:1` 比例下输出 **960×960**（并非文档标注的 720p），`pro` 更高、`4k` 为 4K。

> **视频生成按供应商自动分派**：`pt generate` 会根据模型名自动路由到各供应商的官方透传端点（字节 `/byteplus/api/v3/...`、MiniMax `/minimax/...`、Kling `/kling/...`、Vidu `/vidu/...` 等），无需手动指定。
>
> **图生视频素材处理**：`--ref` / `--last-frame` / `--ref-video` / `--ref-audio` 均支持**本地文件路径**、**公网 URL**、**Base64**，CLI 自动处理——
> - **字节 Seedance**：所有素材（本地文件 / 公网 URL / Base64）一律先上传资产库取得 `asset_id`（以 `asset://<id>` 传入，做人像/授信校验）；仅 `asset://` 路径原样透传。
> - **MiniMax / Kling / Wan / Vidu / HappyHorse**：本地文件自动转成 Base64（Kling 用纯 Base64，其余用 data URL）直接传入，无需资产库。
>
> **首帧 / 首尾帧 / 多模态参考三种互斥场景**（不可混用）：
> - **图生视频-首帧**：仅 `--ref`。
> - **图生视频-首尾帧**：`--ref` + `--last-frame`（2 张图）。支持 Seedance / MiniMax Hailuo / MiniMax H3 / Kling / Wan / Vidu（Kling 用 `image` 首帧 + `image_tail` 尾帧；Wan 的 `wan2.2-kf2v-*`/`wan2.1-kf2v-*` 用 `images` 数组，`wan2.7-i2v` 用 `media` 数组；Vidu 用 `start-end2video` 端点 + `images` 数组）。
> - **多模态参考生视频**：`--ref`（参考图）+ `--ref-video` / `--ref-audio`。支持 Seedance / MiniMax H3。当传入 `--ref-video` 或 `--ref-audio` 时，CLI 自动将 `--ref` 识别为参考图（`reference_image`）。
> - **运镜控制（Kling）**：走 `/kling/v1/videos/motion-control` 端点。`--params` 里出现 `video_url` / `character_orientation` 即自动路由到运镜控制；也可用便利 flag `--ref`（参考图，本地自动转 Base64）+ `--ref-video`（动作视频）+ `--character-orientation image|video`。其余字段（`keep_original_sound`、`external_task_id`、`callback_url` 等）一律走 `--params` 透传。
>
> **文件名**：资产库（仅字节 Seedance 用到）要求素材文件名较短（实测上限约 45 字符），CLI 会自动截断超长文件名（保留扩展名）。

> **各视频供应商参数支持矩阵**（✅ 支持 / ❌ 不支持，未标注的用 `--params` 透传）：
>
> | 参数 | Seedance | MiniMax Hailuo | MiniMax H3 | Kling | Wan | Vidu | HappyHorse |
> |------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
> | `--last-frame` 首尾帧 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
> | `--ref-video` 参考视频 | ✅ | ❌ | ✅ | ✅(运镜) | ✅(r2v) | ❌ | ❌ |
> | `--ref-audio` 参考音频 | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
> | `--negative-prompt` 负向提示词 | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
> | `--watermark` 水印 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
> | `--generate-audio`/`--sound` 声音 | ✅(2.0/1.5) | ❌ | ❌ | ✅(`--sound`) | ❌ | ✅(默认开) | ❌ |
> | `--seed` 种子 | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
> | `--aspect-ratio`/`--ratio` 比例 | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |

> **图片生成按供应商自动分派**：`pt generate` 同样根据模型名路由到正确端点——
> - **Seedream**：`/v1/images/generations`，`size` 像素尺寸（如 `2048x2048`）。
> - **Kling**（`kling-v2`/`kling-v3`/`kling-image-o1`）：`/kling/v1/images/generations`，用 `resolution`（`1k`/`2k`/`4k`，默认 1k）+ `aspect_ratio`（默认 16:9），**异步任务**。`--size 2k` / `--size 2048x2048` 或 `-r 2K` / `-r 4K` 均会映射为对应 `resolution`；图生图（带 `--ref`）仅支持 1k。
> - **Qwen / Wan**：`/v1/images/generations`，提示词走 `input.messages` 结构，`size` 用 `2048*2048` / `2K` 等格式。

### `pt models`

List available models, optionally filtered by type.

```bash
pt models                  # all models
pt models -t chat          # chat models only
pt models -t image         # image models only
pt models -t video         # video models only
pt models -t audio         # audio models only
```

模型列表通过 `GET /v1/models` **动态获取**（缓存 1 小时），下文表格仅为 API 不可用时的内置回退快照。

> **多模态模型**：`kling-v3` / `kling-v3-omni` 同时支持图片和视频生成，会同时出现在 `image` 和 `video` 两个分类里。

### `pt config`

Show or set configuration.

```bash
pt config                                # show current config
pt config -b https://api.custom          # set API base URL
pt config -a https://powertokens.ai/api  # set asset library base URL
pt config --reset                        # reset base URL & asset base URL to default
```

> **资产库地址**：默认从 `base URL` 自动推导（`api.powertokens.ai` → `powertokens.ai/api`）。只有需要指向不同资产库时才用 `-a` 覆盖。

## Supported Models

模型列表通过 `GET /v1/models` 动态获取，运行 `pt models` 查看完整列表。以下仅列出部分模型供参考（按类型分类）：

- **💬 Chat**：`glm-4.7-flash`、`glm-4.5-air`、`glm-4.7`、`glm-5`、`deepseek-v4-pro`、`qwen3-max`、`MiniMax-M2.5`、`MiniMax-M3`
- **🖼 Image**：`seedream-5-0-260128`、`seedream-4-5-251128`、`wan2.7-image-pro`、`kling-v3`、`kling-v3-omni`（后两者多模态，也支持视频）
- **🎬 Video**：`dreamina-seedance-2-0-260128`、`dreamina-seedance-2-0-fast-260128`、`seedance-1-5-pro-251215`、`kling-video-o1`、`MiniMax-Hailuo-02`、`MiniMax-H3`、`kling-v3`、`kling-v3-omni`
- **🔊 Audio**：`speech-2.6-hd`、`speech-02-hd`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `POWERTOKENS_API_KEY` | API key (overrides config file) |
| `POWERTOKENS_BASE_URL` | API base URL (overrides config file) |
| `POWERTOKENS_ASSET_BASE_URL` | Asset library base URL (auto-derived from `POWERTOKENS_BASE_URL`; override only if needed) |
| `PT_DEBUG` | Set to `1` to print the raw request body and task-result response to stderr (useful for debugging parameter mapping and URL selection) |

## Config File

Stored at `~/.powertokens/config.json` (permissions `0600`).

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.powertokens.ai",
  "assetBaseUrl": "https://powertokens.ai/api"
}
```

## License

MIT
