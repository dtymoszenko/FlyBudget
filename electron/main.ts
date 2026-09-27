import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// @ts-expect-error import.meta.url works in Electron 41's Node for both ESM (dev) and CJS (build)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_DEV = process.env.ELECTRON_DEV === 'true';
const PORT = 58342;

// Set ALL env vars BEFORE requiring any server code so db/index.ts picks them up
if (!IS_DEV) {
  const userData = app.getPath('userData');
  process.env.DB_PATH = path.join(userData, 'budget.db');
  process.env.ELECTRON_PROD = 'true';
  // __dirname in packaged app = .../resources/app/electron/dist/
  // better-sqlite3 package is at .../resources/app/node_modules/better-sqlite3/
  process.env.DB_NATIVE_BINDING = path.join(
    __dirname,
    '../../node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  process.env.MIGRATIONS_PATH = path.join(process.resourcesPath, 'migrations');
  // client/dist/ is two levels up from electron/dist/
  process.env.CLIENT_DIST = path.join(__dirname, '../../client/dist');
}
process.env.EXPRESS_PORT = String(PORT);

async function waitForServer(port: number, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server failed to start on port ${port}`);
}

function createWindow(): void {
  const iconPath = IS_DEV
    ? path.join(__dirname, '../../client/public/logo.png')
    : path.join(__dirname, '../../build/icon.png');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (IS_DEV) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Served by the embedded server so the page is same-origin with the API
    win.loadURL(`http://localhost:${PORT}/`);
  }
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  if (!IS_DEV) {
    // server.js is in the same directory as main.js (electron/dist/)
    const { startServer } = require(path.join(__dirname, 'server.js')) as {
      startServer: (port: number) => Promise<void>;
    };
    await startServer(PORT);
    await waitForServer(PORT);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
