# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`1.3.0` is the first version published to npm; earlier versions existed as git tags only.

## [Unreleased]

## [1.3.1] - 2026-11-13

### Fixed

- The endpoint card shows its own success and error messages. Saving or failing to save an
  endpoint used to print the message under the API key card, which made it look like the key
  had been rejected.
- Saved files carry the media type of the bytes MiniMax actually returned. The API answers a
  `png` request with JPEG in some cases, and the plugin used the requested format for base64
  responses and the `content-type` header for downloads, so a JPEG could be stored as `.png`.
- `scripts/smoke.mjs` writes the generated file with the extension of the bytes it
  received (MiniMax returns JPEG for `1024x1024`) instead of always `.png`, and now
  reports the media type and pixel size next to the byte count.

### Changed

- `engines.dsh` accepts every DSH `0.2.x` and `0.3.x` release
  (`>=0.2.0-rc.1 <0.4.0-0`), so a DSH upgrade no longer blocks the plugin on install.
- Settings and plugin screenshots are regenerated from the 1.3 line.

## [1.3.0] - 2026-11-13

### Added

- **Endpoint selector in settings.** Choose Mainland China (`api.minimax.cn`), International
  (`api.minimax.io`) or a custom proxy URL instead of setting an environment variable. The choice
  is saved to `<DSH home>/plugin-data/dsh-minimax-image/settings.json`, survives restarts, and is
  read on every request, so switching regions needs no DSH restart. `MINIMAX_API_BASE` still works
  as a fallback when nothing is saved, and `.cn` remains the default.
- **Actionable error hints** for region mismatch (HTTP 401), empty balance (402 / 1008), missing
  model access (2022), content safety (1026 / 1027) and rate limits (429 / 1002 / 2056): the tool
  result now says what to do next instead of only echoing the upstream message.
- Unit tests (`tests/unit.test.js`) for size parsing, image header sniffing, reference-image
  building, argument normalization and endpoint resolution, using `node:test` with no
  dependencies.
- API tests (`tests/api.test.js`) against a stubbed `fetch`: success, 401, 402 / 1008, partial
  image failures, timeout, and an assertion that requests are **not** retried.
- Route tests (`tests/routes.test.js`) for the credential endpoint: endpoint round-trips,
  invalid custom URLs returning 400, method/content-type/body-size guards and the same-origin
  check.
- CI workflow (`.github/workflows/ci.yml`) running `node --check` and `node --test` on Node 20 and
  22.
- `scripts/smoke.mjs`: an opt-in live check that runs one real generation and skips itself when
  `MINIMAX_API_KEY` is unset (generation is billed and never retried).
- Three documented install paths (npm, `github:`, local `link:`) and this changelog.

### Changed

- `minimax_generate_image` / `minimax_edit_image` resolve their base URL per call instead of
  reading a module-level constant at load time.
- The credential endpoint accepts `set-endpoint` and returns the resolved endpoint from
  `describe`, so the settings page can render the current region without a second request.
- README Requirements, Setup and Troubleshooting now talk about the region selector rather than
  `MINIMAX_API_BASE` as the primary switch.

### Fixed

- A rejected custom endpoint now returns HTTP 400 with a readable message instead of HTTP 500.
- The key status line no longer prints the word "Configured" twice for a key stored in the
  credential file.

## [1.2.1] - 2026-11-12

### Changed

- Package renamed to `dsh-minimax-image` (breaking for anyone importing the old id).
- `engines.dsh` and the client UI peer range accept the `0.2.x` prerelease line.
- Store icon and README screenshots added.

## [1.2.0] - 2026-11-12

### Added

- **Test connection** button in settings: calls only the free `GET /v1/models` endpoint, so a key
  can be validated without generating (and paying for) an image.

## [1.1.0] - 2026-11-12

### Added

- `minimax_generate_image` (text to image) and `minimax_edit_image` (image to image) tools backed
  by MiniMax H3-Image and H3-Image-Highspeed.
- Settings section for the API key, stored in the DSH credential store as `MINIMAX_API_KEY`.
- Reference-image validation, size parsing, media sniffing and attachment persistence for tool
  results.

[Unreleased]: https://github.com/ffpinkle/dsh-minimax-image/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/ffpinkle/dsh-minimax-image/releases/tag/v1.3.0
[1.2.1]: https://github.com/ffpinkle/dsh-minimax-image/releases/tag/v1.2.1
[1.2.0]: https://github.com/ffpinkle/dsh-minimax-image/releases/tag/v1.2.0
[1.1.0]: https://github.com/ffpinkle/dsh-minimax-image/releases/tag/v1.1.0
