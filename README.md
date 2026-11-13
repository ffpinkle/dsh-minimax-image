# DSH MiniMax Image

<img src="icon.svg" width="72" height="72" alt="dsh-minimax-image icon">

DSH plugin that gives the agent MiniMax **H3-Image** capabilities: text-to-image generation
(`minimax_generate_image`) and image-to-image editing (`minimax_edit_image`).

[中文说明](#中文说明)

## Screenshots

| Settings | Plugin page |
| --- | --- |
| <img src="assets/screenshot-settings.png" alt="MiniMax Image settings section with a saved key and a passing connection test" width="460"> | <img src="assets/screenshot-plugin.png" alt="dsh-minimax-image plugin page in DSH" width="460"> |

## Install

Requires DSH `0.2.x` (tested on `0.2.2-rc.1`) and Node.js 20+. The plugin is plain ESM with no
build step, so every method below installs the same files.

Three ways to install it. `<your-profile>` is the profile you boot with — `desktop`, `web`,
`tui`, … — and `dsh` without `--profile` boots `web`. Restart DSH afterwards, then configure the
key as described in [Setup](#setup). The plugin id is `dsh-minimax-image`.

### npm

```bash
dsh plugin --profile <your-profile> add dsh-minimax-image
```

Published from `1.3.0`. Pin a version with `dsh-minimax-image@1.3.0`.

### GitHub

Nothing to build: the repository ships `index.js` and `client.js` ready to load.

```bash
dsh plugin --profile <your-profile> add github:ffpinkle/dsh-minimax-image
```

This follows `main`, so every push changes what the next install gets. Pin a tag for a fixed
version:

```bash
dsh plugin --profile <your-profile> add github:ffpinkle/dsh-minimax-image#v1.3.0
```

### Local clone

Clone the repository and link the checkout — edits to `index.js` and `client.js` then take effect
after a DSH restart, with no reinstall:

```bash
git clone https://github.com/ffpinkle/dsh-minimax-image
dsh plugin --profile <your-profile> add link:D:/path/to/dsh-minimax-image
```

### Which one

| Method | Use it when | Updating |
| --- | --- | --- |
| npm | you want versioned releases and no git | bump the version in the `add` command |
| GitHub | you want `main` or a pinned tag | `dsh plugin add` the new ref |
| Local clone | you are changing the plugin | restart DSH after each edit |

## Requirements

- A MiniMax API key whose account can call `MiniMax-H3-Image` / `MiniMax-H3-Image-Highspeed`
  and has a positive balance. Image calls are billed per generated image.
- The key must belong to the same region as the endpoint. Pick the region in **Settings → MiniMax
  Image → API endpoint** (see [Setup](#setup)): `Mainland China (api.minimax.cn)` for keys from
  `platform.minimaxi.com`, `International (api.minimax.io)` for `platform.minimax.io`. For a proxy,
  choose `Custom URL`. Before the setting exists the default is `https://api.minimax.cn/v1`, and
  `MINIMAX_API_BASE` still works as an environment fallback. An international key against the China
  endpoint (or the reverse) fails with HTTP 401.

## Setup

1. Open **Settings → MiniMax Image / MiniMax 图像**.
2. Pick the API endpoint that matches the region of your key — **Mainland China (.cn)**,
   **International (.io)**, or **Custom URL** for a proxy. The choice is saved to
   `<DSH home>/plugin-data/dsh-minimax-image/settings.json` and survives restarts; the next tool
   call and connection test use it immediately, no restart needed. If `MINIMAX_API_BASE` is set in
   the environment, the saved choice here wins and the page says so.
3. Paste the API key and choose **Save key / 保存 Key**.
   The key is stored in the DSH credential store as `MINIMAX_API_KEY`; it is never written to
   plugin config, session logs, or tool output.
4. Choose **Test connection / 测试连接** to check the key without generating anything. The test
   calls only the free model-list endpoint (`GET /v1/models`) behind the same gateway, so it
   proves the key is accepted for the configured endpoint and never bills an image. HTTP 401
   means the key is invalid, revoked, or belongs to another region.
5. If the settings page cannot manage credentials in your client, set `MINIMAX_API_KEY` in the
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
| HTTP 401 | Bad key, or key and endpoint are in different regions |
| HTTP 402, code 1008 | Account balance is zero — top up or claim credit in the console |
| HTTP 2022 | The account has no access to the model/plan |
| HTTP 1027 / 1026 | Output / input blocked by content safety; rephrase the prompt or image |
| `aspect_ratio must be explicit when prompt_enhance is false` | Pass a concrete ratio, or re-enable enhancement |

## Local development (maintainer)

The plugin is a normal DSH bundle. From this directory:

```
plugin_manager install_bundle  target: <path to this directory>
```

The bundle patch is `cordis.patch.yml`. During development the package is linked into the
profile's `node_modules` as a junction instead of being copied, so edits to `index.js` take
effect after restarting DSH and no reinstall is needed. The link is what makes the plugin card
show `@local` / 本地开发 in the plugin manager.

If you keep a checkout next to your profile, link it with:

```bash
dsh plugin --profile <your-profile> add link:D:/path/to/dsh-minimax-image
```

## 中文说明

这是一个 DSH 插件，把 MiniMax **H3-Image** 接到 agent 上，提供两个工具：

- `minimax_generate_image`：文生图；
- `minimax_edit_image`：图生图（图片编辑）。

**安装**：三种方式装的是同一套文件，插件 id 为 `dsh-minimax-image`，需要 DSH 0.2.x（已测
`0.2.2-rc.1`）和 Node 20+。装完重启 DSH，再去设置页配置 Key。

1. npm（1.3.0 起）：`dsh plugin --profile <你的 profile> add dsh-minimax-image`
2. GitHub：`dsh plugin --profile <你的 profile> add github:ffpinkle/dsh-minimax-image`
   （想固定版本就加 `#v1.3.0` 这样的 tag）
3. 本地克隆：`dsh plugin --profile <你的 profile> add link:D:/path/to/dsh-minimax-image`，
   改完代码重启 DSH 即生效，不用重装。

**配置**：设置 → 「MiniMax 图像」→ 先选 **API 端点**（国内 api.minimax.cn / 国际 api.minimax.io /
自定义代理 URL），再粘贴 API Key → 保存。端点选择存在
`<DSH 主目录>/plugin-data/dsh-minimax-image/settings.json`，重启保留、下次调用立即生效。
Key 存在 DSH 凭证库（`MINIMAX_API_KEY`），不会写入配置、日志或工具输出。Key 必须与端点同区域：
国内站（platform.minimaxi.com）的 Key 配 .cn，国际站（platform.minimax.io）的 Key 配 .io，
否则会 401。环境变量 `MINIMAX_API_BASE` 仍可作为兜底，但设置页里保存的选择优先。

**测试连接**：设置页的「测试连接」按钮只请求免费的模型列表接口（`GET /v1/models`），不会出图、
不产生费用，用来确认 Key 与端点区域匹配。返回 401 说明 Key 无效、已撤销或属于另一个区域。

**图生图用法**：给 `images` 传 1–16 张参考图，可以是本地文件路径（插件自动读文件、校验大小与格式、
转 base64 上传）、公网 URL，或 `data:image/...` 形式的 data URI。编辑固定会开启 MiniMax 的提示词增强，
返回的 `revised_prompt` 通常比你写的更详细。参考图限制：JPG/PNG/WEBP/HEIC/HEIF、单张 ≤64MB、
边长 128–8192px、长宽比不超过 4:1、整个请求体 ≤64MB。

**计费**：按张计费，接口非幂等——超时或断连后请求可能仍会完成并扣费，插件不会自动重试，不要盲目重复调用。
