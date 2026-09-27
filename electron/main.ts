import { app, BrowserWindow, Menu, safeStorage, session, shell } from 'electron';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

// electron/package.json sets "type": "commonjs", so both dev (main.ts via tsx/cjs)
// and the build (tsc → CommonJS) run this as CommonJS and the built-in __dirname is
// available. Don't use import.meta here: it makes Node re-parse the file as ESM,
// where __dirname and `exports` are undefined and the app crashes before opening
// a window.

const IS_DEV = process.env.ELECTRON_DEV === 'true';
const PORT = 58342;

// Per-launch secret for the embedded API (see server/src/middleware/security.ts).
// Only this app's window gets it, as an HttpOnly cookie, so other programs or
// users on the machine can't use the API even though they can reach the port.
const API_TOKEN = IS_DEV ? undefined : randomBytes(32).toString('hex');

// Dev loads the Vite server; the packaged app is served by the embedded server so
// the page is same-origin with the API.
const APP_URL = IS_DEV ? 'http://localhost:5173/' : `http://localhost:${PORT}/`;
const APP_ORIGIN = new URL(APP_URL).origin;

function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function openExternalIfSafe(url: string): void {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url);
  } catch {
    /* not a valid URL — ignore */
  }
}

// Set ALL env vars BEFORE requiring any server code so db/index.ts picks them up
if (!IS_DEV) {
  const userData = app.getPath('userData');
  process.env.DB_PATH = path.join(userData, 'budget.db');
  process.env.ELECTRON_PROD = 'true';
  // better-sqlite3 (>=13) ships Node-API prebuilds that work in both Node and
  // Electron, and finds them in its own prebuilds/ folder — no rebuild or
  // DB_NATIVE_BINDING needed.
  process.env.MIGRATIONS_PATH = path.join(process.resourcesPath, 'migrations');
  // client/dist/ is two levels up from electron/dist/
  process.env.CLIENT_DIST = path.join(__dirname, '../../client/dist');
  process.env.FLYBUDGET_API_TOKEN = API_TOKEN;
}
process.env.EXPRESS_PORT = String(PORT);

/**
 * The key that encrypts bank credentials inside budget.db (see
 * server/src/db/secretCrypto.ts). It's stored in userData, itself encrypted by the
 * OS (Windows DPAPI / macOS Keychain / Linux secret service), so it only works for
 * this user on this machine. Returns undefined if OS encryption is unavailable, in
 * which case credentials stay unencrypted as before.
 */
function loadCredentialKey(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('OS secure storage unavailable; bank credentials will not be encrypted');
    return undefined;
  }
  const keyPath = path.join(app.getPath('userData'), 'credentials.key');
  try {
    if (fs.existsSync(keyPath)) return safeStorage.decryptString(fs.readFileSync(keyPath));
    const key = randomBytes(32).toString('base64');
    fs.writeFileSync(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
    return key;
  } catch (err) {
    // e.g. the profile moved to another machine: banks will need reconnecting
    console.error('Could not load the credential encryption key:', err);
    return undefined;
  }
}

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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // DevTools would let anyone at the keyboard run code with the page's API access
      devTools: IS_DEV,
      // Chromium's spellchecker downloads dictionaries from Google
      spellcheck: false,
    },
  });

  // Links that open a new window (target="_blank") go to the system browser, but only
  // for https. Passing arbitrary URLs to openExternal is a known code-execution vector
  // (file://, ms-msdt:, custom protocol handlers).
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });

  // The window may only ever show the app itself.
  const keepInApp = (event: Electron.Event, url: string) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalIfSafe(url);
  };
  win.webContents.on('will-navigate', keepInApp);
  win.webContents.on('will-redirect', keepInApp);

  win.loadURL(APP_URL);
  if (IS_DEV) win.webContents.openDevTools();
}

Menu.setApplicationMenu(null);

// Only one instance: a second one would fail to bind the port and show a blank window
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

// Defense in depth for any web contents, including ones created by libraries
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;

  // FlyBudget needs no camera, microphone, location, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (!IS_DEV) {
    const dataKey = loadCredentialKey();
    if (dataKey) process.env.FLYBUDGET_DATA_KEY = dataKey;
    // server.js is in the same directory as main.js (electron/dist/)
    const { startServer } = require(path.join(__dirname, 'server.js')) as {
      startServer: (port: number) => Promise<void>;
    };
    // The server read its secrets on load; don't leave them in the environment
    delete process.env.FLYBUDGET_DATA_KEY;
    delete process.env.FLYBUDGET_API_TOKEN;
    await startServer(PORT);
    await waitForServer(PORT);
    // Session cookie (no expiry), SameSite=Strict so other sites can never send it
    await session.defaultSession.cookies.set({
      url: `http://localhost:${PORT}`,
      name: 'flybudget_token',
      value: API_TOKEN!,
      httpOnly: true,
      sameSite: 'strict',
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
