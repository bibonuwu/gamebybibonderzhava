// Рисует иконку программы electron/icon.png (512×512) из public/icon.svg.
// Запуск: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'public', 'icon.svg'), 'utf8');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  const out = path.join(root, 'electron', 'icon.png');
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`Иконка готова: ${out}`);
  app.quit();
});
