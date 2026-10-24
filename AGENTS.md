# 蓝虎听歌 · 项目规则（AGENTS）

本文件是面向 Agent 的最高指令：开发约束、发布流程与工程口径。产品与内容口径见 README.md。

## 最高指令

网页版、Windows 电脑版、Android 手机版必须始终是同一份最新代码：**唯一源码是 app/**，Electron 与 Capacitor 只做薄壳，不得在壳内另写界面或数据。

每次修改后先跑 npm run check；确认全绿后再执行一次：npm run sync:all

该命令完成：校验 → 同步 Android（本地生效，android/ 不入库）→ 提交并推送 main（GitHub Actions 自动部署网页版）。

发布后必须确认网页版是最新版：Pages 部署成功。Windows 安装包与 Android APK 为本地构建（npm run dist:win / npm run apk:debug），不自动发布。

## 三端自动同步流程

唯一源码为 app/，Electron 与 Capacitor 均为薄壳，禁止在壳内编写界面或数据逻辑。

每次修改 app/ 后，必须按顺序执行：

1. npm run check：全绿才能继续
2. npm run sync:all：一步完成三端同步

sync:all 内部做的事：
- 校验 app/
- 同步 Android 原生工程（cap sync android）
- 提交并推送 main，触发 GitHub Actions 自动部署网页版

发布后必须确认：
- 网页版 Pages 部署成功（Cloudflare / GitHub Pages）
- 电脑版安装包为本地构建，不自动发布
- 手机版 APK 为本地构建，不自动发布

禁止跳过 check 直接 sync:all；失败时先修问题，不允许强推。

## 开发原则

- 修改任一模块须完成一致性校验；任何模块不得占用多余空间，无用、无指令的空模块立即删除。
- 优先修改 app/，多端自动生效，避免在薄壳内打补丁。
- 每次更新自动更新版本号并修正 README。
- 版本号唯一权威源：package.json 的 version 字段；app/js/version.js 由 tools/gen-version.js 自动生成，禁止手改。
- 修改前端静态资源时需同步递增：app/index.html 中所有 ?v=X.Y.Z 参数；app/sw.js 中 CACHE 常量。
- 深浅主题装饰（日月/花朵/星空云朵）的位置与尺寸需保持 dark 与 light 严格对称，避免切换时元素跳动。

## 版本历史

- **v1.5.0**：主题装饰（夜间星空月亮+冷调花 / 白天云朵圆日+暖调花）、播放行音柱、进度条渐变、Toast 三色、快捷键、统一焦点环、Hero 大字顶格。
- **v1.4.0**：稳定基线。
