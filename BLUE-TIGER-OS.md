# 蓝虎 OS · 系列应用制作操作系统

一键式统一管理蓝虎系列所有应用（tigermusic / tigervideo / tigerchat …）的版本、三端源码、网页部署、云端打包。

## 核心原则

1. 唯一权威源：`package.json` 的 `version`
2. 强拦截：pre-commit 自动校验，版本不一致无法提交
3. 唯一入口：`npx tiger-os <command>`
4. 零手动：无需手动改任何版本号

## 快速开始

    npx tiger-os status              # 版本一致性面板
    npx tiger-os install-hooks       # 安装 pre-commit（首次）
    npx tiger-os bump 1.6.0          # 升级版本并同步
    npx tiger-os release "feat: xxx" # 一键发布

## 命令表

| 命令 | 作用 |
| :--- | :--- |
| `init` | 检查核心文件是否齐全 |
| `status` | 7 个关键文件版本一致性面板 |
| `doctor` | 检查 node/java/git/gh 环境 |
| `install-hooks` | 安装 pre-commit 强校验 |
| `bump <x.y.z>` | 升级版本 + 强制同步所有文件 |
| `check` | 全量校验（lint+test+build+version） |
| `sync` | 同步 Android 原生工程 |
| `release [msg]` | 一键发布（完整流程） |

## 版本同步覆盖的 7 处文件

1. `package.json` 的 `version`
2. `app/js/version.js` 的 `window.TIGER_MUSIC_VERSION`
3. `app/sw.js` 的 `CACHE` 常量
4. `app/index.html` 的所有 `?v=X.Y.Z`
5. `README.md` 的标题 + 下载链接 + 文件名
6. `app/js/app.js` 的首页下载链接
7. `app/js/version.js` 由 gen-version.js 生成

## 三端发布流程

    bump-version（强同步 7 处）
        ↓
    npm run check（lint+test+build+version）
        ↓
    npx cap sync android（同步 Android）
        ↓
    git commit + push main（触发网页部署）
        ↓
    git tag vX.Y.Z + push（触发云端打包）
        ↓
    云端自动清理旧 Release，只留最新

## 开发蓝虎系列新产品

1. 从 tigermusic 复制 `tools/` 目录到新项目
2. 改 `package.json` 的 `name`，版本设 0.1.0
3. 改 `AGENTS.md` / `README.md` 替换产品名
4. 执行：
       npx tiger-os init
       npx tiger-os install-hooks
       npx tiger-os doctor

## 常见问题

**Q: pre-commit 报版本不一致？**
A: `npx tiger-os bump <当前版本>` 强制重刷，或 `npx tiger-os status` 定位。

**Q: 网页版没更新？**
A: 查 GitHub Actions → Deploy to GitHub Pages 是否成功。

**Q: 云端打包失败？**
A: 查 Build and Release 红色 job；跑 `npx tiger-os status` 先确认版本一致。

**Q: 彻底重置版本？**
A: `npx tiger-os bump <目标版本>` 强制覆写所有 7 处。