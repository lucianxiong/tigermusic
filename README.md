# 蓝虎听歌（Tiger Music）

本地优先的在线音乐应用：在线搜索试听、公共领域曲库全曲播放、本地音乐导入，Windows / Android / 浏览器三端同源。收藏、最近播放与自定义歌单全部保存在本机，不注册账号、不收集个人信息。

- 🌐 网页版（在线听歌）：https://tigermusic.duckdns.org/ （原地址 https://lucianxiong.github.io/tiger-music/ 自动跳转至该域名）
- 📦 源码仓库：https://github.com/lucianxiong/tiger-music
- 🔒 隐私说明：https://tigermusic.duckdns.org/PRIVACY.md

## 功能

- **四大模块**：首页 · 曲库 · 歌单 · 我的
  - 首页：搜索框、热门搜索、最近播放、我的收藏
  - 曲库：在线搜索（iTunes 曲库，30 秒试听）/ 公共曲库（Internet Archive 全曲）/ 本地文件导入
  - 歌单：我的收藏、最近播放、自定义歌单（新建 / 加歌 / 删除）
  - 我的：主题（跟随系统 / 深色 / 浅色）、中英双语、默认音量、本地数据管理、关于与数据来源说明
- **播放器**：播放 / 暂停、上一首 / 下一首、进度拖动、音量与静音、列表循环 / 单曲循环 / 顺序播放、随机播放、播放队列面板
- **全局深浅色主题**与**中英双语**，设置随本机保存
- **本地优先**：收藏、歌单、偏好全部保存在本机存储，无账号、无统计、无上传

## 在线数据来源（合规）

- **在线试听**：Apple iTunes Search 公开接口，每曲仅提供 30 秒预览片段，用于试听参考。
- **公共曲库**：Internet Archive（archive.org）公共领域 / 开放授权音频，可全曲播放；若当前网络无法访问 archive.org 会给出明确提示。
- **本地导入**：仅在你的设备上读取所选音频文件，内容不离开本机。

## 技术栈

站点主体是无框架、无打包器的 HTML + CSS + 原生 JS（纯逻辑抽在 `music-utils.js`，可单测）；桌面端用 Electron 封装，移动端用 Capacitor 封装 Android。

```
app/            站点根目录（唯一源码）
  index.html    单页外壳（含 CSP / SEO / PWA meta）
  css/          样式（深蓝夜空统一色阶，深浅双主题）
  js/           应用逻辑（app.js）与纯逻辑工具（music-utils.js）
  sw.js         Service Worker（界面外壳离线可用；在线音乐播放仍需网络）
  PRIVACY.md    隐私说明
electron/       Electron 主进程与 preload（薄壳，已禁用硬件加速兼容远程桌面）
tools/          构建校验、语法检查、单元测试、全局变量表生成
```

## 快速开始

| 平台 | 获取方式 |
|---|---|
| 网页版 | https://tigermusic.duckdns.org/ （GitHub Pages 部署 + DuckDNS 免费域名，支持安装为 PWA） |
| Windows | `npm run dist:win` 本地构建安装包 / 便携版（产物在 `dist/`） |
| Android | `npm run apk:debug` 本地构建调试包（需 JDK + Android SDK） |
| 浏览器 | `npx http-server app -p 8787` 后访问本机地址；或 `npm start` 直接起桌面版 |

## 开发

```bash
npm install

npm run check        # 全量校验：lint + 语法 + 单元测试 + 构建检查（每次修改后必跑）
npm run lint         # ESLint（会先生成跨文件全局变量表）
npm run typecheck    # node --check 解析全部 JS
npm test             # 纯逻辑单元测试
npm run build        # 语法 + 资源引用 + 密钥扫描
npm run gen:globals  # 重新生成 tools/app-globals.json（新增顶层全局后执行）

npm start            # 本地起 Electron（直接加载本地静态文件）
npm run dist:win     # 打 Windows 安装包与便携版（产物在 dist/）
npm run apk:debug    # 打 Android 调试包（需 JDK 21 + Android SDK）
```

### 发布

网页版由 GitHub Actions 自动部署：`npm run check` 全绿后，提交并推送 `main`，`.github/workflows/deploy.yml` 会把 `app/` 发布到 GitHub Pages，自定义域名 https://tigermusic.duckdns.org/（DuckDNS A 记录 → GitHub Pages IP 185.199.108.153）自动生效。

## 合规说明

- 所有在线内容版权归各自权利人所有；试听片段仅作试听用途，公共领域曲目可全曲播放。
- 应用不收集、不上传任何个人信息或用户数据。
- 隐私说明见 `app/PRIVACY.md`。
- 站点面向搜索引擎收录已准备：`app/robots.txt` 与 `app/sitemap.xml` 随网页版发布；提交 Google 搜索收录与百度站长平台收录需要站长账号操作（见「发布」章节）。
