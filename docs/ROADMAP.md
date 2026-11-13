# Roadmap — 从「能用」到「正式产品」

> 现状基线（2026-11-13）：v1.3.0 已发布到 npm（https://www.npmjs.com/package/dsh-minimax-image），
> tag `v1.3.0` 与 Release 页（https://github.com/ffpinkle/dsh-minimax-image/releases/tag/v1.3.0）已上线，仓库 https://github.com/ffpinkle/dsh-minimax-image
> 已完成：文生图 / 图生图（1–16 参考图）/ 精确 size / 本地预校验 / 设置页存 Key + 测试连接 / 中英文案 /
> 包名已改为无作用域 `dsh-minimax-image` / profile Junction 已同步 / 截图与图标已入库 /
> **端点设置页可切（A1）** / **错误文案可行动化（A2）** / **README 三种装法（A4）** / **CHANGELOG 与 1.3.0（A5）** /
> **单元测试 + API 打桩测试 + CI（B1–B3）** / **真机 smoke 实跑（B4）**。
> 未完成：市场 PR（E3，等 awesome-dsh-plugin 条目解冻）。

「正式产品」的判据（缺一不可）：

1. 一个陌生用户能按 README 三步装上并出图；
2. 出错时能自己看懂并修好，不需要读源码；
3. 有自动化测试与 CI，改动不会悄悄回归；
4. 有版本语义（semver）、CHANGELOG、Release 页；
5. 许可证、Issue 模板、贡献指南齐全，别人敢提 PR。

---

## Phase A · 发布闭环（先做，约 2 小时）

**目标**：让别人能装上、装上能用、出错能自解。

| # | 任务 | 验收标准 |
|---|---|---|
| A1 ✅ | 端点可配置：设置页下拉「国内 .cn / 国际 .io / 自定义」，存 DSH storage，请求时动态读取；未配置时回退 `MINIMAX_API_BASE` → `.cn` | 切到 .io 后，`测试连接` 的返回里 `endpoint` 变为 `.io`；重启后设置保留 |
| A2 ✅ | 错误文案可行动化：401 直接说「你在 platform.minimax.io 注册的话，把端点切到国际站」；1008 说「余额不足，去控制台充值」；2022 说「该 Key 没有 H3-Image 权限」；1027/1026 说「内容被安全策略拒绝，换描述或换图」 | 四个错误各有一条中文可执行提示，不出现裸错误码 |
| A3 ✅ | npm 发布 1.3.0：`npm publish` + git tag `v1.3.0` + GitHub Release | `https://registry.npmjs.org/dsh-minimax-image` 返回 200；`npm i dsh-minimax-image` 可用 |
| A4 ✅ | README 安装段三选一写清：npm / `github:ffpinkle/dsh-minimax-image` / 本地目录 | 照 README 操作能在干净 profile 里装上 |
| A5 ✅ | 新增 CHANGELOG.md（Keep a Changelog 格式），补 1.0.0→1.3.0 | 每次发版有对应条目 |

**风险**：npm 发布不可逆（同名版本不能覆盖）。做法：先 `npm publish --dry-run` 看清楚 `files` 清单，再真发；发布需要 npm token 或浏览器 2FA。

**不做**：mm_file://、stream、批量 prompt（收益低于成本，见 Phase D）。

---

## Phase B · 质量门禁（第二优先，约 3 小时）

**目标**：改动不回归，且**没有 API Key 也能跑完测试**。

| # | 任务 | 验收标准 |
|---|---|---|
| B1 ✅ | `tests/unit.test.js`（node:test，零依赖）：`parsePixelSize`、`readImageSize`（JPEG/PNG/WebP/HEIC fixture）、`sniffMediaType`、`buildReferenceImages`、`normalizeImageArgs` | `node --test tests/` 全绿，fixture 图 <20KB 入库 |
| B2 ✅ | `tests/api.test.js`：用假 `fetch` 打桩，覆盖成功、402/1008、401、部分失败（data 里带 error）、超时、**不重试** | 断言请求体字段正确（size 与 aspect_ratio 互斥等） |
| B3 ✅ | GitHub Actions `.github/workflows/ci.yml`：Node 20/22 矩阵 + `node --check` + `node --test` | PR 上出现绿色 check |
| B4 ✅ | 手动联调脚本 `scripts/smoke.mjs`（需真 Key，无 Key 自动跳过） | 2026-11-13 实跑通过：`.cn` 端点 7.7 s 出图，JPEG 1024×1024、217,904 字节、`request_id 0745d8be…`，全程只发一次请求 |
| B5 ✅ | `tests/routes.test.js`：凭证路由的端点读写、非法 custom 400、方法/类型/体积守卫、同源校验 | `node --test` 全绿 |

**关键约束**：MiniMax 出图**非幂等**，超时/断连仍可能计费 —— 任何重试逻辑都不许加，测试里要有一条断言守住这点。

---

## Phase C · 产品化体验（约 4 小时）

| # | 任务 | 价值 |
|---|---|---|
| C1 | 设置页补默认值：默认 area / 默认格式 / 默认水印 | 少传参数 |
| C2 | 出图结果卡片：尺寸、耗时、request_id、估算费用（按 1K/2K/4K 单价换算） | 花多少钱心里有数 |
| C3 | 最近出图列表（读 attachments 最近 N 张，可点开） | 找不到图时不用翻目录 |
| C4 | 全部错误与提示走 locale 文件，zh/en 键值对齐检查 | 不出现中英混杂 |
| C5 | 设置页「测试连接」增加区域建议：401 时直接给「切换到国际站」按钮 | 一键自愈 |

---

## Phase D · 进阶能力（按需，收益需评估）

- **mm_file:// 支持**：先上传到 MiniMax 文件服务拿 file_id，同一批参考图反复出图时更快；代价是要多实现上传 + 缓存。
- **stream 进度**：长任务有进度反馈，但 10 秒级出图收益有限。
- **批量多 prompt**：一次请求多条描述，适合批量出图。
- **会话式编辑链**：把上一次输出当输入，连续改图（本质是工具组合，DSH 侧已可做）。
- **费用上限保护**：单次调用前预估 token 成本，超阈值需确认。

---

## Phase E · 运营与曝光（发布后）

| # | 任务 |
|---|---|
| E1 | `.github/ISSUE_TEMPLATE/bug.yml` + `feature.yml`、`CONTRIBUTING.md`、`SECURITY.md` |
| E2 | README 首屏放 GIF 演示（30 秒内看完「一句话出图 → 改图」） |
| E3 | 上架 DSH 插件市场（dshmarket 可搜索安装），补齐市场所需元数据 |
| E4 | 版本兼容矩阵：DSH 0.2.x 各 rc 版本实测表 |
| E5 | 每周看 Issues，按 semver 发 patch/minor |

---

## 顺序与理由

```
A 发布闭环  →  B 质量门禁  →  C 体验  →  D 进阶  →  E 运营
（能被装上）   （不被改坏）    （好用）    （差异化）  （被看见）
```

先 A：装不上，后面全白做；先 B：没有测试就进 C/D，改一处崩一处。
C 之所以排在 B 后：体验优化改的是「用户感受」，但测试缺口改的是「你半夜被 Issue 叫醒的概率」。

## 现在就能定的三个决定

1. **npm 包名**：`dsh-minimax-image`（已改好，registry 未占用 —— 抢注风险存在，Phase A 越早越好）。
2. **端点默认值**：保持 `.cn`（现有用户不受影响），国际用户走设置页。
3. **测试框架**：`node:test`（零依赖，Node 20+ 自带），不引入 jest/vitest。
