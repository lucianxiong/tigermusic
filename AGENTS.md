# 蓝虎听歌 · 项目规则（AGENTS）

本文件是面向 Agent 的最高指令：开发约束、发布流程与工程口径。产品与内容口径见 README.md。

## 内容极简与同步规则

1. **极简主义**：应用内『关于』页面、README、AGENTS.md 和 Release Notes 必须保持极简，禁止保留历史版本的更新日志或过时说明。
2. **单版本同步**：任何文档或页面描述，只能反映当前唯一的版本状态（如当前版本），禁止出现诸如『某版本新增』这类跨版本残留。
3. **发布即同步**：每次 npm run sync:all 或打 tag 发布前，必须检查并清理上述文档中的旧版本残留。

## 最高指令

网页版、Windows 电脑版、Android 手机版必须始终是同一份最新代码：唯一源码是 app/，Electron 与 Capacitor 只做薄壳，不得在壳内另写界面或数据。

## 三端自动同步（一条命令发布）

每次修改 app/ 后，**只需执行一条命令**：
npm run sync:all -- "提交信息"
脚本内部自动完成：
1. 读取 package.json 版本号，**自动同步 README.md 与 app/js/app.js 中的下载链接**（旧版本号自动替换为新版本）
2. npm run check（lint + 语法 + 单测 + 构建检查，全绿才继续）
3. npx cap sync android（同步 Android 原生工程）
4. git add -A && git commit && git push origin main（触发 GitHub Actions 部署网页版）
5. **自动打 tag vX.Y.Z 并推送**（触发云端打包 Windows + Android）
6. **云端 create-release 自动删除所有旧版本 Release**，只保留最新版本

**禁止**手动执行零散步骤；**禁止**跳过 check 直接发布。

## 发版流程

1. 修改 package.json 中的 version（例如 1.0.0 → 1.0.1）
2. 执行 `npm run sync:all -- "release: v1.0.1 ..."` 
3. 等待约 2-3 分钟，云端自动打包并发布
4. 访问 Releases 页面，确认只有最新一个版本（旧版已自动清理）

发布后必须确认：
- 网页版 Pages 部署成功（Cloudflare / GitHub Pages）
- GitHub Releases 只有最新版本的安装包

## 开发原则

- 修改任一模块须完成一致性校验；任何模块不得占用多余空间，无用、无指令的空模块立即删除。
- 优先修改 app/，多端自动生效，避免在薄壳内打补丁。
- 版本号唯一权威源：package.json 的 version 字段；app/js/version.js 由 tools/gen-version.js 自动生成，禁止手改。
- 修改前端静态资源时需同步递增：app/index.html 中所有 ?v=X.Y.Z 参数；app/sw.js 中 CACHE 常量。
- 深浅主题装饰（日月/花朵/星空云朵）的位置与尺寸需保持 dark 与 light 严格对称，避免切换时元素跳动。

## 当前版本

当前版本以 package.json 的 version 字段为唯一权威源。

