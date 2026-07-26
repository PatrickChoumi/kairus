const { app, BrowserWindow } = require('electron');
let win;
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1100, height: 750, minWidth: 800, minHeight: 500, titleBarStyle: 'hiddenInset', webPreferences: { preload: __dirname + '/preload.js' } });
  win.loadURL(process.argv.includes('--dev') ? 'http://localhost:5173' : 'http://localhost:3001');
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
