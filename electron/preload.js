// 蓝虎听歌 - 预加载桥：渲染层不暴露 Node 能力，仅标记桌面环境。
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('tigerDesktop', {
  isDesktop: true
});

