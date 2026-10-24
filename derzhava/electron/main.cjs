// Программа «Держава» для Windows: открывает собранную игру из dist/ в своём окне — без браузера и сервера.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// музыка и звуки — сразу, без ожидания первого клика
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('com.derzhava.game');

// одна копия игры: два окна перезаписывали бы одно сохранение
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 640,
    backgroundColor: '#0a1424',
    title: 'Держава',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  // F11 — полный экран
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  // внешние ссылки — в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
