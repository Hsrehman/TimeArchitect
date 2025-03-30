const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const { uIOhook, UiohookKey } = require('uiohook-napi');
const axios = require('axios');

// Constants
const SERVER_URL = 'http://localhost:3000';

// Activity tracking state
let currentSessionId = null;
let isTrackingEnabled = false;

// Function to send activity to server
async function sendActivity(type, details) {
  if (!currentSessionId || !isTrackingEnabled) {
    console.log('Activity tracking not enabled or no active session');
    return;
  }

  try {
    const payload = {
      sessionId: currentSessionId,
      type,
      details,
      timestamp: new Date().toISOString()
    };
    
    console.log('Sending activity:', payload);
    
    const response = await axios.post(`${SERVER_URL}/api/activity`, payload);
    console.log('Activity logged successfully:', response.data);
  } catch (error) {
    if (error.response) {
      // Server responded with error
      console.error('Server error logging activity:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
    } else if (error.request) {
      // Request made but no response
      console.error('No response from server:', error.request);
    } else {
      // Error setting up request
      console.error('Error setting up request:', error.message);
    }
  }
}

// Function to start activity tracking
function startTracking(sessionId) {
  if (isTrackingEnabled) {
    console.log('Activity tracking already enabled');
    return;
  }

  currentSessionId = sessionId;
  console.log('Starting activity tracking for session:', sessionId);

  // Handle keyboard events
  uIOhook.on('keydown', (event) => {
    // Filter out modifier keys
    if (![
      UiohookKey.Shift,
      UiohookKey.Alt,
      UiohookKey.Control,
      UiohookKey.Meta
    ].includes(event.keycode)) {
      console.log('Keyboard event:', event);
      sendActivity('keyboard', { keycode: event.keycode });
    }
  });

  // Handle mouse events
  uIOhook.on('mousedown', (event) => {
    console.log('Mouse event:', event);
    sendActivity('mouse', { button: event.button });
  });

  // Start tracking
  try {
    uIOhook.start();
    isTrackingEnabled = true;
    console.log('Activity tracking started');
  } catch (error) {
    console.error('Failed to start activity tracking:', error);
  }
}

// Function to stop activity tracking
function stopTracking() {
  if (!isTrackingEnabled) {
    console.log('Activity tracking not enabled');
    return;
  }

  try {
    uIOhook.stop();
    isTrackingEnabled = false;
    currentSessionId = null;
    console.log('Activity tracking stopped');
  } catch (error) {
    console.error('Failed to stop activity tracking:', error);
  }
}

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

// IPC handlers for clock-in/out
ipcMain.handle('clock-in', async (event, sessionId) => {
  startTracking(sessionId);
  return { success: true };
});

ipcMain.handle('clock-out', async (event) => {
  stopTracking();
  return { success: true };
});

app.whenReady().then(() => {
  console.log('Electron app is ready');
  createWindow();
});

app.on('window-all-closed', () => {
  // Stop activity tracking if enabled
  if (isTrackingEnabled) {
    stopTracking();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 