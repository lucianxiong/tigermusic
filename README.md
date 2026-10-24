# 蓝虎听歌（Tiger Music）· v1.5.2

在线音乐应用：在线搜索试听、公共曲库全曲播放、本地音乐导入、同步歌词、收藏与歌单。

## 在线体验
* **Cloudflare Pages**（主站）：[https://tigermusic.pages.dev/](https://tigermusic.pages.dev/)
* **GitHub Pages**（备选）：[https://lucianxiong.github.io/tigermusic/](https://lucianxiong.github.io/tigermusic/)

## 下载客户端
| 平台 | 版本 | 下载 |
| :--- | :--- | :--- |
| Windows | 安装版 | [Tiger-Music-v1.5.0-setup.exe](https://github.com/lucianxiong/tigermusic/releases/download/v1.5.2/Tiger-Music-v1.5.2-setup.exe) |
| Windows | 便携版 | [Tiger-Music-v1.5.0-portable.exe](https://github.com/lucianxiong/tigermusic/releases/download/v1.5.2/Tiger-Music-v1.5.2-portable.exe) |
| Android | Debug APK | [tigermusic-debug.apk](https://github.com/lucianxiong/tigermusic/releases/download/v1.5.2/tigermusic-debug.apk) |

> 历史版本及更新日志请查看 [GitHub Releases](https://github.com/lucianxiong/tigermusic/releases)。

## 主要功能
* **全曲搜播**：聚合 Internet Archive / Audius / Openverse / ccMixter 免费全曲，可完整播放。
* **本地导入**：支持本地音乐导入，不上传任何文件，全部在本机读取。
* **歌词引擎**：同步歌词（LRCLIB）与纯文本兜底（lyrics.ovh），支持逐句校正、点击跳转、滚动跟随。
* **个人管理**：收藏 / 最近播放 / 自定义歌单，全部保存在本机 localStorage。
* **听歌统计**：记录总播放次数、累计收听时长、收藏排行。
* **专业音效**：10 段图形均衡 + 低音/高音增益 + 动态压缩（Web Audio API）。
* **纯净听歌**：支持睡眠定时器、播放队列、随机 / 单曲循环 / 列表循环。
* **三端同源**：深浅双主题、中英双语，Windows / Android / 浏览器三端共用 `app/` 源码。

## v1.5 新增特性
* **主题装饰**：夜间星空 + 圆月 + 三朵冷调夜花；白天云朵 + 圆日 + 三朵暖调花。日夜位置尺寸严格对齐，呼吸发光动画。
* **正在播放行音柱**：当前歌曲行显示跳动音符与封面描边高亮。
* **进度条渐变拖尾**：随播放实时填充。
* **Toast 三色态**：成功 / 失败 / 警告分色显示。
* **键盘快捷键**：空格播放暂停，←→ 快退快进 5 秒，N/P 切歌。
* **统一焦点环**：全站 focus-visible 统一视觉。
* **应用下载入口**：首页底部新增 Windows 安装版/便携版与 Android APK 下载卡片。
* **CI/CD 支持**：完善 GitHub Actions 与 Cloudflare Pages 双端自动部署。

## 开发规范
见 [AGENTS.md](AGENTS.md)。