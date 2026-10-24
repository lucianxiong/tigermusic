# 蓝虎听歌 · 数据源与网络策略

> 本文件是音源选型、超时、音质策略的**唯一权威说明**。新增或删改音源前先读本文件。
> 最后更新：随 v1.4.0 音效与音质扩展一并修订。

## 一、在线音源（全部免密钥）

| 源 | 授权 | 格式 | 实测耗时 | 用途 |
|---|---|---|---|---|
| Internet Archive | 公共领域 / 开放授权 | MP3 / OGG / FLAC / M4A / WAV | ~2.3s | 主曲库，含无损 FLAC |
| Audius | 独立音乐人自有 | MP3 (320k) | ~3.3s | 独立音乐人曲库 |
| Openverse | CC 授权聚合 | MP3 / OGG / FLAC / M4A / WAV / OPUS / AAC | ~3.0s | CC 聚合曲库 |
| ccMixter | CC 授权混音 | MP3 / FLAC | ~2.7s | 混音与原创，含 FLAC |

歌词源：

| 源 | 耗时 | 用途 | 能否淘汰 |
|---|---|---|---|
| LRCLIB | ~6.5s | 同步歌词（唯一来源） | **不能**——无替代品 |
| lyrics.ovh | ~3.7s | 纯文本兜底 | 可以，但保留成本低 |

## 二、音源选型规则

### 允许新增的源（必须同时满足）
1. **免密钥**：请求 URL 中不含 client_id / api_key / token
2. **可全曲播放**：不接受 30s 试听片段
3. **授权明确**：公共领域 / CC 授权，或艺术家自有版权（如 Audius）
4. **实测耗时 < 5s**（本地 Invoke-WebRequest 单次探测）
5. **返回字段稳定**：至少能解析出 title、artist、audio URL

### 明确拒绝的源
- **Jamendo**：需 client_id，破坏免密钥原则
- **iTunes / Apple Music**：仅 30s 试听，不满足全曲要求
- **Deezer**：同样 30s 试听限制
- **Spotify / 网易云 / QQ 音乐**：需 OAuth、有版权风险、API 封闭
- **YouTube / Bilibili 直链**：违反 ToS，不做播放

## 三、超时策略

| 调用场景 | 超时 | 依据 |
|---|---|---|
| `fetchJSON` 默认 | 7000ms | 一般歌词/JSON 请求 |
| IA 元数据（`loadIAItem`） | **8000ms** | 实测 2.7s，给 3 倍余量 |
| IA 搜索（`iaRowsFor` / 推荐） | **5000ms** | 实测 2.3s |
| Audius 搜索 | **5000ms** | 实测 3.3s |
| Openverse 搜索 | **5000ms** | 实测 3.0s |
| ccMixter 搜索 | **5000ms** | 实测 2.7s |

**统一原则**：超时 = max(实测耗时 × 1.5, 5s)。任何源连续 3 次超时，视为服务降级，移除该源。

## 四、音质策略

### `PREF.quality` 取值

| 值 | 含义 | 格式优先级 |
|---|---|---|
| `fast`（默认） | 标准音质，加载优先 | MP3 > OGG > M4A > AAC > WAV > FLAC |
| `hq` | 高品质，码率均衡 | M4A > MP3 > OGG > AAC > WAV > FLAC |
| `lossless` | 高音质，体积优先 | FLAC > M4A > WAV > AAC > OGG > MP3 |

### 选择依据
- **默认 fast**：用户首次使用最在意"点开就能听"，FLAC 文件 30-70MB 会让首播等待 5-10s
- **lossless 可选**：发烧用户可主动切换，界面在「我的 → 外观与语言 → 音质模式」
- **同格式内取最大体积**：FLAC 内部不同码率下选最大，等价于最高音质

## 五、搜索缓存

| 缓存 | 位置 | 时长 | 容量 |
|---|---|---|---|
| 搜索结果 | `sessionStorage`（`searchCache`） | 5 分钟 | 最多 20 条关键词 |
| 推荐 | 内存 | 10 分钟 | 单次会话 |

**依据**：用户 5 分钟内重复搜同一关键词是高频行为（打字纠错、切页回看），命中缓存 0 网络。

## 六、单条音频加载失败处理

- `loadIAItem` 超时 8s → 抛错 → toast「该条目暂无可播放的音频文件」→ 用户可换一条
- 不做重试（避免长时间卡住），改为在结果列表中跳过该条
- 这是"删除长时间加载的曲库"的落地方式：不删源，删单条

## 七、新增源的操作步骤

1. 在 `app/js/music-utils.js` 加 `xxxSearchURL` + `xxxFilesFrom`（纯函数，可测）
2. 在 `app/js/app.js` 加 `xxxSongFrom` + `xxxRowsFor` + 在 `doSearch` 的 `Promise.allSettled` 里加一项
3. `renderResults` 加一个 `srcBlock` + `paintSongRows`
4. `sourceName` 加分支
5. `app/css/style.css` 加 `.src-dot.xxx` 配色
6. `tools/test/music.test.js` 加 ≥3 条测试
7. 在本文档「在线音源」表加一行，并在 git commit message 里写明实测耗时

## 八、Agent 自动化规则

以下规则由 AI Agent 在每次改动音源相关代码时**自动遵守**：

- **R1 超时固定**：所有 `fetchJSON` 调音源必须显式传超时，禁止用默认 7000ms 蒙混
- **R2 并发聚合**：多源搜索必须用 `Promise.allSettled`，禁止 `Promise.all`（一个失败不能拖垮全局）
- **R3 音质贯通**：任何新增音频选择逻辑必须接收 `PREF.quality` 参数
- **R4 无密钥硬约束**：提交前 grep `client_id|api_key|token|secret`，有命中即 CI 失败（已由 `build-check.js` 覆盖）
- **R5 测试门禁**：`npm test` + `npm run build` 必须全绿才能提交，任何一条失败禁止 push
- **R6 缓存优先**：新增用户可见的联网搜索，必须在 `doSearch` 层接入 `searchCache`
- **R7 源淘汰阈值**：单源连续 3 次 5s 超时 → 在本文档标记「观察中」→ 再 3 次仍失败 → 移除源并更新本文件

## 九、变更日志

- **v1.4.0**：新增音效系统（10 段 EQ + 低音/高音，Web Audio API，双播放元素方案：开启后经独立元素走音效链，音源不支持跨域时自动回退直连）；音质模式新增 `hq` 档（M4A 优先）；搜索结果 5 分钟内存缓存；各音源搜索超时统一 5s、IA 元数据 8s。
- **v1.3.0**：新增 ccMixter 源；`pickAudioFile` 加 `quality` 参数；`loadIAItem` 超时 12s→8s；各源搜索超时统一 5s；新增搜索缓存；新增音质模式设置项。

