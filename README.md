# 蓝虎听歌（Tiger Music）· v1.0.0

在线音乐应用：在线搜索试听、公共曲库全曲播放、本地音乐导入、同步歌词、收藏与歌单。

## 在线体验
* **Cloudflare Pages**（主站）：[https://tigermusic.pages.dev/](https://tigermusic.pages.dev/)
* **GitHub Pages**（备选）：[https://lucianxiong.github.io/tigermusic/](https://lucianxiong.github.io/tigermusic/)

## 下载客户端
| 平台 | 版本 | 下载 |
| :--- | :--- | :--- |
| Windows | 安装版 | [Tiger-Music-v1.0.0-setup.exe](https://github.com/lucianxiong/tigermusic/releases/download/v1.0.0/Tiger-Music-v1.0.0-setup.exe) |
| Windows | 便携版 | [Tiger-Music-v1.0.0-portable.exe](https://github.com/lucianxiong/tigermusic/releases/download/v1.0.0/Tiger-Music-v1.0.0-portable.exe) |
| Android | Debug APK | [tigermusic-debug.apk](https://github.com/lucianxiong/tigermusic/releases/download/v1.0.0/tigermusic-debug.apk) |

## 主要功能
* **全曲搜播**：聚合 Internet Archive / Audius / Openverse / ccMixter 免费全曲，可完整播放。
* **本地导入**：支持本地音乐导入，不上传任何文件，全部在本机读取。
* **歌词引擎**：同步歌词（LRCLIB）与纯文本兜底（lyrics.ovh），支持逐句校正、点击跳转、滚动跟随。
* **个人管理**：收藏 / 最近播放 / 自定义歌单，全部保存在本机 localStorage。
* **听歌统计**：记录总播放次数、累计收听时长、收藏排行。
* **专业音效**：10 段图形均衡 + 低音/高音增益 + 动态压缩（Web Audio API）。
* **纯净听歌**：支持睡眠定时器、播放队列、随机 / 单曲循环 / 列表循环。
* **主题装饰**：夜间星空 + 圆月 + 三朵冷调夜花；白天云朵 + 圆日 + 三朵暖调花。
* **键盘快捷键**：空格播放暂停，←→ 快退快进 5 秒，N/P 切歌。
* **三端同源**：深浅双主题、中英双语，Windows / Android / 浏览器三端共用 `app/` 源码。

## 开发规范
见 [AGENTS.md](AGENTS.md)。

