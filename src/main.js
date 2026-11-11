// Main process: owns the window, reads files from disk and talks to Windows.
const { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

let mainWindow = null;
let rendererReady = false;
let pendingPaths = [];

// Windows passes the file path as a command-line argument when you
// double-click a PDF or choose "Open with".
function pdfPathsFromArgs(argv, cwd = process.cwd()) {
  return argv
    .filter((arg) => !arg.startsWith('-') && arg.toLowerCase().endsWith('.pdf'))
    .map((arg) => path.resolve(cwd, arg));
}

async function readPdf(filePath) {
  try {
    const data = await fs.readFile(filePath);
    return { path: filePath, name: path.basename(filePath), data };
  } catch (err) {
    return { path: filePath, name: path.basename(filePath), error: err.code === 'ENOENT' ? 'the file no longer exists.' : err.message };
  }
}

async function sendFiles(paths) {
  if (!paths.length) return;
  if (!mainWindow || !rendererReady) {
    pendingPaths.push(...paths);
    return;
  }
  const files = await Promise.all(paths.map(readPdf));
  mainWindow.webContents.send('files:open', files);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Folio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17191c' : '#e7eaee',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links inside PDFs open in the normal web browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Stop a dropped file from replacing the app's own page.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  // Pinch-zoom would scale the whole interface; the viewer handles zoom itself.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Only one copy of the app runs; opening another PDF adds a tab instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    sendFiles(pdfPathsFromArgs(argv, workingDirectory));
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    pendingPaths = pdfPathsFromArgs(process.argv);
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a PDF',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(readPdf));
});

ipcMain.handle('app:initial-files', async () => {
  rendererReady = true;
  const paths = pendingPaths;
  pendingPaths = [];
  return Promise.all(paths.map(readPdf));
});

ipcMain.handle('app:set-theme', (_event, mode) => {
  if (['system', 'light', 'dark'].includes(mode)) nativeTheme.themeSource = mode;
});

ipcMain.on('app:toggle-devtools', () => mainWindow?.webContents.toggleDevTools());
