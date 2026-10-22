# 蓝虎听歌 · 项目规则（AGENTS）

本文件是面向 Agent 的最高指令：开发约束与工程口径。产品与内容口径见 `README.md`。

## 最高指令

Windows 电脑版、Android 手机版、浏览器版必须始终是同一份最新代码：**唯一源码是 `app/`**，Electron 与 Capacitor 只做薄壳，不得在壳内另写界面或数据。

每次修改后先跑 `npm run check`，确认全绿后再提交推送 `main`。

- 发布口径：`main` 分支推送后由 GitHub Actions 自动部署网页版（GitHub Pages，自定义域名 https://tiger-music.pages.dev/；github.io 原地址自动跳转）。
- 仅发布到本项目仓库 `lucianxiong/tiger-music`；不向其他仓库、平台或服务推送，不创建远端 PR / issue。
- 搜索引擎收录：`app/robots.txt`、`app/sitemap.xml` 随站点发布；谷歌 / 百度收录由站长平台账号维护。
- 隐私说明：`app/PRIVACY.md`，新增在线数据源、权限或网络行为时同步更新它。

## 开发原则

- 同类模块统一颜色、大小、位置、方向，避免不一致。
- 只改被点名模块；任何模块不得占用多余空间，无用、无指令的空模块立即删除。
- 新增功能先分析用途，再补齐对应交互与样式；删除重复、半成品与无关功能，保持代码干净。
- 优先修改 `app/`，多端自动生效，避免在薄壳内打补丁。

## 工程口径（已固化，改动须同步）

- **版本号唯一入口**：`package.json` 的 `version`。Windows 安装包 / 便携版 / APK 产物名由 `${version}` 宏自动生成，升级版本只改一处，禁止硬编码产物名。
- **三端启动背景色统一为 `#070E18`**（页面最深底色 `--bg-0`）：`electron/main.js`、`capacitor.config.json`、`app/index.html`（theme-color）、`app/manifest.webmanifest`（theme/background_color）四处必须一致。
- **全局共享变量**：`app/js` 多文件共享浏览器全局作用域，`tools/gen-globals.js` 维护全局表（lint 前自动重建）；`tools/app-globals.json` 为生成物，勿手改。
- **纯逻辑层**：`app/js/music-utils.js` 不依赖 DOM，浏览器与 Node 双端可用（UMD 守卫）；新增可测逻辑放这里，并补 `tools/test/music.test.js` 用例。
- **隐私说明**：唯一副本在 `app/PRIVACY.md`。

## 在线资料边界

- 在线数据源白名单（仅此两类，不得新增未经审核的来源）：
  - 在线试听：Apple iTunes Search 公开接口（无密钥、支持 CORS），仅提供 30 秒预览片段，标注「试听」。
  - 公共曲库：Internet Archive（archive.org）公共领域 / 开放授权音频，可全曲播放；不可达时给出明确错误提示。
- 不接入需要密钥的第三方音乐接口；不接入盗版 / 未授权音乐源。
- 本地音乐导入只在设备本地读取文件内容，不上传任何数据。
- 三端加载同一份 `app/`；Electron 直接 `loadFile`，Capacitor 以 `app/` 为 webDir。

## 验证

- 最低验证：`npm run check`（lint、语法、单元测试、构建检查）；涉及界面再复核 390 / 800 / 1280 宽度、中英文、深浅色和播放器（搜索 → 试听 → 收藏 → 歌单 → 队列 → 循环/随机）。
- 发布验证：推送 `main` 后确认 GitHub Pages 部署成功，网页版可访问、sitemap 可读取。
- 本地预览：`npx http-server app -p 8787`。
- Windows：`npm run dist:win`，产物在 `dist/`（已 gitignore）。
- Android：`npm run apk:debug` 需 JDK 21 + Android SDK；本机缺省时先装齐再构建。
- 签名密钥、`.env`、`*.keystore`、`*.jks` 绝不能进入提交或构建包（`build-check.js` 含密钥扫描闸门）。

## 已知限制

- Internet Archive 在当前网络可能不可达，应用会显示错误与重试入口，不影响 iTunes 试听与本地导入。
- Electron 已禁用硬件加速（`app.disableHardwareAcceleration()`）以兼容远程桌面 / 虚拟机 / 无 GPU 环境；沙箱保持开启。
