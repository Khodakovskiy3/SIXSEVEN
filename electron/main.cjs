/**
 * Головний процес Electron-обгортки Cluvyra (необов'язковий компонент,
 * не входить у Railway-деплой).
 *
 * Два режими:
 *  • CLUVYRA_REMOTE_URL=https://… — тонкий клієнт: вікно відкриває вже
 *    розгорнутий застосунок, жодних секретів на машині користувача;
 *  • без неї — локальний режим розробника: піднімає server/index.js у цьому
 *    процесі (конфігурація з оточення / локального .env розробника).
 *
 * Секрети (.env, ANTHROPIC_API_KEY, DATABASE_URL, JWT_SECRET, SMTP_PASS)
 * НІКОЛИ не пакуються в інсталятор — див. "build.files" у package.json.
 */

const { app, BrowserWindow } = require('electron');
const net = require('node:net');
const path = require('node:path');

// У запакованому застосунку код лежить у Resources/app (asar вимкнено в
// package.json, бо сервер імпортується динамічно і читає public/ та .env
// як звичайні файли з диска).
const ROOT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');
const APP_ICON = path.join(ROOT_DIR, 'public', 'assets', 'icons', 'icon-512.png');
const DEFAULT_PORT = 3000;
const PORT_POLL_INTERVAL_MS = 300;
const PORT_WAIT_TIMEOUT_MS = 30000;
const RELOAD_DELAY_MS = 1000;

let mainWindow;

/**
 * Піднімає Express-сервер у поточному процесі. server/index.js — ESM-модуль,
 * що сам читає .env; слухати порт він починає лише ПІСЛЯ виконання міграцій,
 * тому завершення import ще не означає готовність сервера.
 */
async function startServer() {
  process.chdir(ROOT_DIR);
  await import(path.join(ROOT_DIR, 'server', 'index.js'));
}

/**
 * Чекає, поки локальний порт почне приймати з'єднання.
 *
 * @param {number} port
 * @returns {Promise<void>} — reject, якщо сервер не піднявся за таймаут.
 */
function waitForPort(port) {
  const deadline = Date.now() + PORT_WAIT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect({ port, host: '127.0.0.1' }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Сервер не відповів на порту ${port} за ${PORT_WAIT_TIMEOUT_MS} мс`));
        } else {
          setTimeout(tryConnect, PORT_POLL_INTERVAL_MS);
        }
      });
    };
    tryConnect();
  });
}

function createWindow(target) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Cluvyra',
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Підстраховка: якщо завантаження все ж не вдалося (сервер перезапускається
  // тощо) — пробуємо ще раз, а не лишаємо біле вікно.
  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(target);
      }
    }, RELOAD_DELAY_MS);
  });

  mainWindow.loadURL(target);
}

app.whenReady().then(async () => {
  const remoteUrl = process.env.CLUVYRA_REMOTE_URL;
  if (remoteUrl && /^https:\/\//.test(remoteUrl)) {
    createWindow(remoteUrl);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(remoteUrl);
      }
    });
    return;
  }

  const port = Number(process.env.PORT) || DEFAULT_PORT;

  try {
    await startServer();
    await waitForPort(port);
  } catch (error) {
    console.error('Не вдалося запустити вбудований сервер:', error);
    app.quit();
    return;
  }

  const localUrl = `http://localhost:${port}/app`;
  createWindow(localUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(localUrl);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
