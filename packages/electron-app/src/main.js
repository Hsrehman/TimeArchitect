const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;

function createWindow() {
  console.log('Creating Electron window...');
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // Load the index.html from a url in development and the local file in production
  if (isDev) {
    console.log('Running in development mode, waiting for Vite server...');
    // Wait for 3000ms to ensure Vite dev server is ready
    setTimeout(() => {
      console.log('Loading development URL: http://localhost:5174');
      mainWindow.loadURL('http://localhost:5174');
      mainWindow.webContents.openDevTools();
    }, 3000);
  } else {
    console.log('Running in production mode');
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle window events
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('Window started loading');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window finished loading');
  });

  // Handle any navigation errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log('Failed to load URL:', errorDescription);
    console.log('Error code:', errorCode);
    if (isDev) {
      console.log('Retrying in development mode...');
      setTimeout(() => {
        console.log('Retrying URL: http://localhost:5174');
        mainWindow.loadURL('http://localhost:5174');
      }, 1000);
    }
  });
}

app.whenReady().then(() => {
  console.log('Electron app is ready');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 