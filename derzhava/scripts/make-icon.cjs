// Рисует иконки из public/icon.svg: electron/icon.png (программа для Windows)
// и public/icon-*.png (установка сайта как приложения на телефон/ПК).
// Запуск: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'public', 'icon.svg'), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// maskable: телефон сам обрезает иконку кругом/скруглением — рисуем на сплошном фоне с полями
const OUT = [
  { file: 'electron/icon.png', size: 512 },
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/icon-maskable-512.png', size: 512, maskable: true },
];

async function render(size, maskable) {
  const win = new BrowserWindow({
    width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const inner = maskable ? Math.round(size * 0.8) : size;
  const html = `<html><body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${maskable ? '#0f1f37' : 'transparent'}">
    <img src="${src}" width="${inner}" height="${inner}" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  win.destroy();
  return img.resize({ width: size, height: size }).toPNG();
}

app.disableHardwareAcceleration();
// окна закрываются после каждой иконки — не выходим раньше времени
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const o of OUT) {
    const out = path.join(root, o.file);
    fs.writeFileSync(out, await render(o.size, o.maskable));
    console.log(`Иконка готова: ${out}`);
  }
  app.quit();
});
