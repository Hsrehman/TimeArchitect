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
let isOnline = true;
let offlineQueue = [];
let keydownListener = null;
let mousedownListener = null;

// Function to sync offline queue
async function syncOfflineQueue() {
  if (offlineQueue.length === 0) return;

  console.log(`Attempting to sync ${offlineQueue.length} queued items`);
  const failedItems = [];

  for (const item of offlineQueue) {
    try {
      let response;
      if (item.type === 'activity') {
        // Ensure offline flag is set for queued activities
        const activityData = {
          ...item.data,
          isOfflineSync: true
        };
        console.log('Syncing offline activity:', activityData);
        response = await axios.post(`${SERVER_URL}/api/activity`, activityData);
        console.log('Activity sync response:', {
          status: response.status,
          data: response.data
        });
      } else {
        // Handle other types (clock-in/out) as before
        console.log(`Syncing ${item.type}:`, item.data);
        response = await axios.post(`${SERVER_URL}/api/${item.type}`, item.data);
        console.log(`${item.type} sync response:`, {
          status: response.status,
          data: response.data
        });
      }
    } catch (error) {
      console.error('Failed to sync item:', item);
      if (error.response) {
        console.error('Server error:', {
          status: error.response.status,
          data: error.response.data
        });
      } else if (error.request) {
        console.error('No response received:', error.request);
      } else {
        console.error('Error setting up request:', error.message);
      }
      failedItems.push(item);
    }
  }

  // Update queue with only failed items
  offlineQueue = failedItems;
  console.log(`Sync complete. ${failedItems.length} items remaining in queue`);
}

// Function to handle connectivity changes
async function handleConnectivityChange(newIsOnline) {
  const previousState = isOnline;
  isOnline = newIsOnline;

  console.log(`Connectivity changed: ${previousState} -> ${isOnline}`);

  if (isOnline && !previousState) {
    console.log('Back online, attempting to sync offline queue');
    await syncOfflineQueue();
  }
}

// Function to send activity to server
async function sendActivity(type, details) {
  if (!currentSessionId) {
    console.log('No active session ID available');
    return;
  }

  const activity = {
    sessionId: currentSessionId,
    type,
    details,
    timestamp: new Date().toISOString(),
    isOfflineSync: !isOnline  // Add flag to indicate if this was recorded offline
  };

  if (!isOnline) {
    console.log('Offline: Queueing activity:', activity);
    offlineQueue.push({ type: 'activity', data: activity });
    return;
  }

  try {
    console.log('Sending activity:', activity);
    const response = await axios.post(`${SERVER_URL}/api/activity`, activity);
    console.log('Activity logged successfully:', response.data);
  } catch (error) {
    console.log('Failed to send activity, queueing:', activity);
    offlineQueue.push({ type: 'activity', data: activity });

    if (error.response) {
      console.error('Server error logging activity:', {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      console.error('No response from server:', error.request);
    } else {
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

  // Create keyboard event handler
  keydownListener = (event) => {
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
  };

  // Create mouse event handler
  mousedownListener = (event) => {
    console.log('Mouse event:', event);
    sendActivity('mouse', { button: event.button });
  };

  // Add event listeners
  uIOhook.on('keydown', keydownListener);
  uIOhook.on('mousedown', mousedownListener);

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

  console.log('Stopping activity tracking');

  try {
    // Remove event listeners
    if (keydownListener) {
      uIOhook.removeListener('keydown', keydownListener);
      keydownListener = null;
    }
    if (mousedownListener) {
      uIOhook.removeListener('mousedown', mousedownListener);
      mousedownListener = null;
    }

    // Stop uIOhook
    uIOhook.stop();

    // Reset tracking state but keep sessionId for offline syncing
    isTrackingEnabled = false;
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
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
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

// IPC handlers for clock-in/out and connectivity
ipcMain.handle('clock-in', async (event, sessionId) => {
  console.log('IPC: Received clock-in request for session:', sessionId);
  startTracking(sessionId);
  return { success: true };
});

ipcMain.handle('clock-out', async (event) => {
  console.log('IPC: Received clock-out request');
  stopTracking();
  return { success: true };
});

ipcMain.handle('notify-connectivity', async (event, newIsOnline) => {
  console.log('IPC: Received connectivity update:', newIsOnline);
  await handleConnectivityChange(newIsOnline);
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