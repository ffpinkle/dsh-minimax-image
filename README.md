# DSH MiniMax Image

DSH plugin that gives the agent MiniMax **H3-Image** capabilities: text-to-image generation
(`minimax_generate_image`) and image-to-image editing (`minimax_edit_image`).

[中文说明](#中文说明)

## Requirements

- A MiniMax API key whose account can call `MiniMax-H3-Image` / `MiniMax-H3-Image-Highspeed`
  and has a positive balance. Image calls are billed per generated image.
- The key must belong to the same region as the endpoint. The default endpoint is
  `https://api.minimax.cn/v1` (MiniMax China). For the international site
  (`platform.minimax.io`) or a proxy, set `MINIMAX_API_BASE` before starting DSH, e.g.
  `MINIMAX_API_BASE=https://api.minimax.io/v1`. An international key against the China
  endpoint (or the reverse) fails with HTTP 401.

## Setup

1. Open **Settings → MiniMax Image / MiniMax 图像**.
2. Paste the API key and choose **Save key / 保存 Key**.
   The key is stored in the DSH credential store as `MINIMAX_API_KEY`; it is never written to
   plugin config, session logs, or tool output.
3. If the settings page cannot manage credentials in your client, set `MINIMAX_API_KEY` in the
   environment instead.

## Tools

### `minimax_generate_image` (text to image)

| Parameter | Default | Notes |
| --- | --- | --- |
| `prompt` | required | Up to 32000 characters |
| `size` | — | Exact output size as `WxH` pixels (e.g. `1024x1536`); overrides `aspect_ratio` and `area`. 655,360–20,000,000 px total, ratio within 1:3–3:1 |
| `n` | 1 | 1–10; each image is billed |
| `aspect_ratio` | `1:1` | `auto` or `X:Y`, 1:3–3:1 |
| `area` | `2K` | `1K`, `2K`, or `4K` |
| `output_format` | `jpeg` | `jpeg`, `png`, or `webp` |
| `output_compression` | 95 | 0–100 for jpeg/webp |
| `prompt_enhance` | true | `false` requires an explicit aspect ratio |
| `aigc_watermark` | false | Explicit watermark; implicit AIGC metadata is always written |
| `highspeed` | false | Uses `MiniMax-H3-Image-Highspeed` |

### `minimax_edit_image` (image to image)

| Parameter | Default | Notes |
| --- | --- | --- |
| `prompt` | required | What to change; editing always applies MiniMax prompt enhancement |
| `images` | required | 1–16 references, in order: local file path, `http(s)` URL, or `data:image/...` URI |
| `size` | — | Exact output size as `WxH` pixels; overrides `aspect_ratio` and `area` |
| `n` | 1 | 1–10; each image is billed |
| `aspect_ratio` | `auto` | `auto` or `X:Y`, 1:3–3:1 |
| `area` | `2K` | `1K`, `2K`, or `4K` |
| `output_format` | `jpeg` | `jpeg`, `png`, or `webp` |
| `output_compression` | 95 | 0–100 for jpeg/webp |
| `aigc_watermark` | false | Explicit watermark |
| `highspeed` | false | Uses `MiniMax-H3-Image-Highspeed` |

Reference limits (enforced by MiniMax): JPG/JPEG/PNG/WEBP/HEIC/HEIF, at most 64 MiB per file,
128–8192 px per side, aspect ratio up to 4:1, 1–16 images, and 64 MiB for the whole request body
(local files are inline base64, so they grow by about 4/3). Local paths are read by the plugin,
checked for size, format, and pixel dimensions before upload (so an oversized or too-small
reference fails locally instead of burning a round trip), and uploaded inline; public URLs are
passed through untouched.

The model does not support mask-based local editing, transparent backgrounds, or preview images.

Both tools save results through the DSH attachment service and return them as image content plus
a text summary. Partial failures are reported per image; a request still succeeds when at least
one image was produced.

## Billing and retries

MiniMax bills per generated image. The endpoints are **not idempotent**: after a timeout or a
network error the server may still finish and bill the request. The plugin never retries
automatically. Do not retry blindly; check the MiniMax console first.

Rough 2026-11 pricing on the international site (per 1M tokens): text input $2.30, image input
$1.50, output $3.80 — about $0.022 for one 1K image.

## Troubleshooting

| Symptom | Meaning |
| --- | --- |
| HTTP 401 | Bad key, or key and `MINIMAX_API_BASE` are in different regions |
| HTTP 402, code 1008 | Account balance is zero — top up or claim credit in the console |
| HTTP 2022 | The account has no access to the model/plan |
| HTTP 1027 / 1026 | Output / input blocked by content safety; rephrase the prompt or image |
| `aspect_ratio must be explicit when prompt_enhance is false` | Pass a concrete ratio, or re-enable enhancement |

## Install (local development)

The plugin is a normal DSH bundle. From this directory:

```
plugin_manager install_bundle  target: <path to this directory>
```

The bundle patch is `cordis.patch.yml`. During development the package can also be linked into
the profile's `node_modules` as a junction, so edits to `index.js` take effect after restarting
DSH.

## 中文说明

这是一个 DSH 插件，把 MiniMax **H3-Image** 接到 agent 上，提供两个工具：

- `minimax_generate_image`：文生图；
- `minimax_edit_image`：图生图（图片编辑）。

**配置**：设置 → 「MiniMax 图像」→ 粘贴 API Key → 保存。Key 存在 DSH 凭证库（`MINIMAX_API_KEY`），
不会写入配置、日志或工具输出。国内站用默认端点 `https://api.minimax.cn/v1`；国际站
（platform.minimax.io）的 Key 需要设置环境变量 `MINIMAX_API_BASE=https://api.minimax.io/v1`，
否则会 401。

**图生图用法**：给 `images` 传 1–16 张参考图，可以是本地文件路径（插件自动读文件、校验大小与格式、
转 base64 上传）、公网 URL，或 `data:image/...` 形式的 data URI。编辑固定会开启 MiniMax 的提示词增强，
返回的 `revised_prompt` 通常比你写的更详细。参考图限制：JPG/PNG/WEBP/HEIC/HEIF、单张 ≤64MB、
边长 128–8192px、长宽比不超过 4:1、整个请求体 ≤64MB。

**计费**：按张计费，接口非幂等——超时或断连后请求可能仍会完成并扣费，插件不会自动重试，不要盲目重复调用。
