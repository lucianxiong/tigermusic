// 蓝虎听歌 - Electron 入口
// 主进程仅创建窗口，并限制渲染层导航与权限；界面直接加载本地静态文件。
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

app.setName('蓝虎听歌');
app.setAppUserModelId('com.lvhu.music');
/* 远程桌面 / 虚拟机 / 无 GPU 环境下 Chromium GPU 进程可能崩溃导致窗口闪退；
   本应用为静态界面，软件渲染完全够用，故禁用硬件加速保证稳定启动。 */
app.disableHardwareAcceleration();

function lockWindow(win){
  win.webContents.setWindowOpenHandler(function(details){
    if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', function(event, targetUrl){
    const current = win.webContents.getURL();
    if (targetUrl !== current) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', function(event){
    event.preventDefault();
  });
}

function configurePermissions(){
  const allowed = new Set(['media', 'mediakeySystem', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler(function(_webContents, permission, callback){
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler(function(_webContents, permission){
    return allowed.has(permission);
  });
}

function createWindow(){
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: '蓝虎听歌',
    icon: path.join(__dirname, '..', 'app', 'assets', 'logo', 'logo.ico'),
    backgroundColor: '#070E18',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  Menu.setApplicationMenu(null);
  lockWindow(win);
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

app.whenReady().then(function(){
  configurePermissions();
  createWindow();
  app.on('activate', function(){
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function(){
  if (process.platform !== 'darwin') app.quit();
});
