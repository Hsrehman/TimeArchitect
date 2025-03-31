const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const { uIOhook, UiohookKey } = require('uiohook-napi');
const axios = require('axios');
const activeWindow = require('active-win');

// Constants
const SERVER_URL = 'http://localhost:3000';
const DEFAULT_INACTIVE_THRESHOLD = 20; // 20 seconds
const DEFAULT_PENDING_VALIDATION_THRESHOLD = 10; // 10 seconds
const DEFAULT_AUTO_CLOCK_OUT_DELAY = 40; // 40 seconds for testing

class PopupManager {
  constructor() {
    this.inactivePopup = null;
  }

  showInactivePopup(inactiveStart, threshold) {
    if (this.inactivePopup) {
      console.log('Popup already exists, not creating another one');
      return;
    }

    // Get the display where the main window is
    const displays = screen.getAllDisplays();
    const mainWindowBounds = mainWindow.getBounds();
    const currentDisplay = screen.getDisplayNearestPoint({
      x: mainWindowBounds.x,
      y: mainWindowBounds.y
    });

    // Calculate center position on the current display
    const x = Math.floor(currentDisplay.bounds.x + (currentDisplay.bounds.width - 300) / 2);
    const y = Math.floor(currentDisplay.bounds.y + (currentDisplay.bounds.height - 200) / 2);

    console.log('Creating inactive popup window');
    this.inactivePopup = new BrowserWindow({
      width: 300,
      height: 200,
      x: x,
      y: y,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      type: 'panel',
      closable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Load the inactive.html file
    this.inactivePopup.loadFile(path.join(__dirname, '../inactive.html'));
    
    // Focus the window when it appears
    this.inactivePopup.once('ready-to-show', () => {
      console.log('Popup ready to show, focusing it');
      this.inactivePopup.show();
      this.inactivePopup.focus();
    });

    // Prevent closing when clicking outside by refocusing
    this.inactivePopup.on('blur', () => {
      if (this.inactivePopup) {
        console.log('Popup lost focus, refocusing');
        this.inactivePopup.focus();
      }
    });

    // Send initial timer data after the page loads
    this.inactivePopup.webContents.once('did-finish-load', () => {
      if (this.inactivePopup) {
        console.log('Sending timer data to popup');
        this.inactivePopup.webContents.send('start-inactive-timer', {
          startTime: inactiveStart,
          threshold: threshold
        });
      }
    });

    // Handle popup close
    this.inactivePopup.on('closed', () => {
      console.log('Popup closed event received');
      this.inactivePopup = null;
    });
  }

  closeInactivePopup() {
    try {
      console.log('Attempting to close inactive popup');
      
      if (!this.inactivePopup) {
        console.log('No popup to close, reference is null');
        return;
      }
      
      if (this.inactivePopup.isDestroyed()) {
        console.log('Popup already destroyed, setting reference to null');
        this.inactivePopup = null;
        return;
      }
      
      // Remove all listeners before closing to prevent issues
      this.inactivePopup.removeAllListeners('blur');
      
      // Force close without calling close event handlers
      this.inactivePopup.destroy();
      console.log('Popup destroyed successfully');
      
      // Null the reference immediately
      this.inactivePopup = null;
    } catch (error) {
      console.error('Error closing popup:', error);
      // Ensure reference is nulled even if there's an error
      this.inactivePopup = null;
    }
  }
}

// Activity tracking state
let currentSessionId = null;
let isTrackingEnabled = false;
let isOnline = true;
let offlineQueue = [];
let keydownListener = null;
let mousedownListener = null;
let inactivityTimer = null;
let lastActivityTime = null;
let inactivityThreshold = DEFAULT_INACTIVE_THRESHOLD;
let pendingValidationThreshold = DEFAULT_PENDING_VALIDATION_THRESHOLD;
let autoClockOutDelay = DEFAULT_AUTO_CLOCK_OUT_DELAY;
let autoClockOutEnabled = true;
let lastWindow = null;
let currentState = 'working';
let inactiveStart = null;
let mainWindow = null;
const popupManager = new PopupManager();

// Function to fetch settings from server
async function fetchSettings() {
  try {
    if (!isOnline) {
      console.log('Offline: Using default thresholds');
      offlineQueue.push({ 
        type: 'settings', 
        data: { 
          key: 'thresholds',
          pendingValidationThreshold: DEFAULT_PENDING_VALIDATION_THRESHOLD,
          inactivityThreshold: DEFAULT_INACTIVE_THRESHOLD,
          autoClockOutDelay: DEFAULT_AUTO_CLOCK_OUT_DELAY
        } 
      });
      return {
        pendingValidationThreshold: DEFAULT_PENDING_VALIDATION_THRESHOLD,
        inactivityThreshold: DEFAULT_INACTIVE_THRESHOLD,
        autoClockOutDelay: DEFAULT_AUTO_CLOCK_OUT_DELAY,
        autoClockOutEnabled: true
      };
    }

    const [pendingResponse, inactiveResponse, delayResponse, enabledResponse] = await Promise.all([
      axios.get(`${SERVER_URL}/api/settings/pendingValidationThreshold`),
      axios.get(`${SERVER_URL}/api/settings/inactiveThreshold`),
      axios.get(`${SERVER_URL}/api/settings/autoClockOutDelay`),
      axios.get(`${SERVER_URL}/api/settings/autoClockOutEnabled`)
    ]);

    console.log('Fetched settings:', {
      pendingValidationThreshold: pendingResponse.data.value,
      inactivityThreshold: inactiveResponse.data.value,
      autoClockOutDelay: delayResponse.data.value,
      autoClockOutEnabled: enabledResponse.data.value
    });

    return {
      pendingValidationThreshold: pendingResponse.data.value,
      inactivityThreshold: inactiveResponse.data.value,
      autoClockOutDelay: delayResponse.data.value,
      autoClockOutEnabled: enabledResponse.data.value
    };
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return {
      pendingValidationThreshold: DEFAULT_PENDING_VALIDATION_THRESHOLD,
      inactivityThreshold: DEFAULT_INACTIVE_THRESHOLD,
      autoClockOutDelay: DEFAULT_AUTO_CLOCK_OUT_DELAY,
      autoClockOutEnabled: true
    };
  }
}

// Function to check active window and calculate duration
async function checkActiveWindow() {
  if (!isTrackingEnabled) return null;
  
  try {
    const currentWindow = await activeWindow();
    const now = Date.now();
    
    // If no window data available
    if (!currentWindow) {
      console.log('No active window data available');
      return null;
    }

    // Format window data
    const windowData = {
      title: currentWindow.title,
      appName: currentWindow.owner.name,
      startTime: now
    };

    // If this is the first window or window has changed
    if (!lastWindow || 
        lastWindow.title !== windowData.title || 
        lastWindow.appName !== windowData.appName) {
      
      // Calculate duration for the last window if it exists
      let windowChangeData = null;
      if (lastWindow) {
        const duration = Math.floor((now - lastWindow.startTime) / 1000);
        windowChangeData = {
          previousTitle: lastWindow.title,
          previousAppName: lastWindow.appName,
          appDuration: duration
        };
        
        // Log window change as activity
        await sendActivity('window_switch', windowChangeData);
      }

      // Update last window
      lastWindow = windowData;
      console.log('Window changed:', {
        current: windowData,
        previous: windowChangeData
      });
    }

    return windowData;
  } catch (error) {
    console.error('Error checking active window:', error);
    return null;
  }
}

// Function to handle state check
async function handleStateCheck() {
  if (!isTrackingEnabled || !lastActivityTime) return;

  const now = Date.now();
  const inactiveTime = Math.floor((now - lastActivityTime) / 1000);

  // Debug log current state
  console.log('Checking state:', {
    now: new Date(now).toISOString(),
    lastActivity: new Date(lastActivityTime).toISOString(),
    inactiveTime,
    currentState,
    pendingValidationThreshold,
    inactivityThreshold,
    autoClockOutDelay
  });

  // Handle state transitions
  if (currentState === 'working' && inactiveTime >= pendingValidationThreshold) {
    currentState = 'pending_validation';
    console.log('State transition: working -> pending_validation', {
      inactiveTime,
      lastActivityTime: new Date(lastActivityTime).toISOString()
    });
  }

  if (inactiveTime >= inactivityThreshold && currentState !== 'inactive') {
    currentState = 'inactive';
    inactiveStart = lastActivityTime;
    console.log('State transition: -> inactive', {
      inactiveTime,
      inactiveStart: new Date(inactiveStart).toISOString()
    });

    // Show inactive popup
    popupManager.showInactivePopup(inactiveStart, inactivityThreshold);
  }

  // Handle auto clock-out
  if (autoClockOutEnabled && inactiveTime >= autoClockOutDelay) {
    console.log('Auto clock-out triggered:', {
      inactiveTime,
      autoClockOutDelay
    });
    
    // Log the auto clock-out event
    await sendActivity('auto_clock_out', { 
      duration: inactiveTime,
      start: new Date(lastActivityTime).toISOString(),
      end: new Date(now).toISOString()
    });
    
    // Close popup if exists
    popupManager.closeInactivePopup();
    
    // Trigger clock-out in backend
    await stopTracking();
    
    // Notify the renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('Sending auto-clock-out event to renderer');
      mainWindow.webContents.send('auto-clock-out');
    }
    
    // Legacy event for any main process listeners
    ipcMain.emit('force-clock-out');
  }
}

// Function to handle activity and state transition
async function handleActivity() {
  // Don't process activity if in inactive state
  if (currentState === 'inactive') {
    console.log('Ignoring activity while in inactive state');
    return;
  }

  const now = Date.now();
  
  // Calculate full duration from last activity
  const duration = Math.floor((now - lastActivityTime) / 1000);
  
  // Handle state-specific logging
  if (currentState === 'pending_validation') {
    console.log('Exiting pending validation state:', {
      duration,
      start: new Date(lastActivityTime).toISOString(),
      end: new Date(now).toISOString()
    });
    
    await sendActivity('pending_validation', {
      duration,
      start: new Date(lastActivityTime).toISOString(),
      end: new Date(now).toISOString()
    });
  }
  else if (currentState === 'inactive') {
    console.log('Exiting inactive state:', {
      duration,
      start: new Date(inactiveStart).toISOString(),
      end: new Date(now).toISOString()
    });
    
    await sendActivity('inactivity', {
      duration,
      start: new Date(inactiveStart).toISOString(),
      end: new Date(now).toISOString(),
      resumed: true
    });

    // Close inactive popup
    popupManager.closeInactivePopup();
    inactiveStart = null;
  }
  
  // Reset state
  currentState = 'working';
  lastActivityTime = now;
}

// Function to sync offline queue
async function syncOfflineQueue() {
  if (offlineQueue.length === 0) return;

  console.log(`Attempting to sync ${offlineQueue.length} queued items`);
  const failedItems = [];

  for (const item of offlineQueue) {
    try {
      let response;
      if (item.type === 'activity') {
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
      } else if (item.type === 'settings') {
        // After reconnecting, fetch fresh settings
        const settings = await fetchSettings();
        inactivityThreshold = settings.inactivityThreshold;
        pendingValidationThreshold = settings.pendingValidationThreshold;
        autoClockOutDelay = settings.autoClockOutDelay;
        autoClockOutEnabled = settings.autoClockOutEnabled;
        console.log('Updated thresholds:', {
          inactiveThreshold: inactivityThreshold,
          pendingValidation: pendingValidationThreshold,
          autoClockOut: {
            enabled: autoClockOutEnabled,
            delay: autoClockOutDelay
          }
        });
        continue; // Skip adding to failedItems
      } else {
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
async function sendActivity(type, details = {}) {
  if (!currentSessionId) {
    console.log('No active session ID available');
    return;
  }

  // Update last activity time and handle state transition for keyboard/mouse events
  if (type === 'keyboard' || type === 'mouse') {
    await handleActivity();
    
    // Get current window info
    const windowInfo = await checkActiveWindow();
    if (windowInfo) {
      details = {
        ...details,
        windowTitle: windowInfo.title,
        appName: windowInfo.appName,
        appDuration: Math.floor((Date.now() - windowInfo.startTime) / 1000)
      };
    }
  }

  const activity = {
    sessionId: currentSessionId,
    type,
    details,
    timestamp: new Date().toISOString(),
    isOfflineSync: !isOnline
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
async function startTracking(sessionId) {
  if (isTrackingEnabled) {
    console.log('Activity tracking already enabled');
    return;
  }

  currentSessionId = sessionId;
  console.log('Starting activity tracking for session:', sessionId);

  // Fetch settings
  const settings = await fetchSettings();
  pendingValidationThreshold = settings.pendingValidationThreshold;
  inactivityThreshold = settings.inactivityThreshold;
  autoClockOutDelay = settings.autoClockOutDelay;
  autoClockOutEnabled = settings.autoClockOutEnabled;
  
  console.log('Using settings:', {
    pendingValidation: pendingValidationThreshold,
    inactivity: inactivityThreshold,
    autoClockOut: {
      enabled: autoClockOutEnabled,
      delay: autoClockOutDelay
    }
  });

  // Initialize tracking state
  lastActivityTime = Date.now();
  lastWindow = null;
  currentState = 'working';
  inactiveStart = null;

  // Initialize first window
  await checkActiveWindow();

  // Create keyboard event handler
  keydownListener = (event) => {
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

    // Start state check timer
    inactivityTimer = setInterval(handleStateCheck, 1000);
  } catch (error) {
    console.error('Failed to start activity tracking:', error);
  }
}

// Function to stop activity tracking
async function stopTracking() {
  if (!isTrackingEnabled) {
    console.log('Activity tracking not enabled');
    return;
  }

  console.log('Stopping activity tracking');

  try {
    // Log final state durations if needed
    const now = Date.now();
    
    if (currentState === 'pending_validation') {
      const duration = Math.floor((now - lastActivityTime) / 1000);
      await sendActivity('pending_validation', {
        duration,
        start: new Date(lastActivityTime).toISOString(),
        end: new Date(now).toISOString(),
        isFinal: true
      });
    }
    else if (currentState === 'inactive' && inactiveStart) {
      const duration = Math.floor((now - inactiveStart) / 1000);
      await sendActivity('inactivity', {
        duration,
        start: new Date(inactiveStart).toISOString(),
        end: new Date(now).toISOString(),
        isFinal: true
      });
    }

    // Close inactive popup if exists
    popupManager.closeInactivePopup();

    // Log final window duration if exists
    if (lastWindow) {
      const duration = Math.floor((now - lastWindow.startTime) / 1000);
      await sendActivity('window_switch', {
        previousTitle: lastWindow.title,
        previousAppName: lastWindow.appName,
        appDuration: duration,
        isFinal: true
      });
    }

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

    // Clear inactivity timer
    if (inactivityTimer) {
      clearInterval(inactivityTimer);
      inactivityTimer = null;
    }

    // Reset tracking state
    isTrackingEnabled = false;
    lastActivityTime = null;
    lastWindow = null;
    currentState = 'working';
    inactiveStart = null;
    console.log('Activity tracking stopped');
  } catch (error) {
    console.error('Failed to stop activity tracking:', error);
  }
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

// IPC handlers for inactivity popup
ipcMain.on('resume-inactive', async () => {
  console.log('Resume inactive event received');
  
  // Close popup first to avoid race conditions
  popupManager.closeInactivePopup();
  
  const now = Date.now();
  if (currentState === 'inactive' && inactiveStart) {
    console.log('Resuming from inactive state:', {
      duration: Math.floor((now - inactiveStart) / 1000),
      start: new Date(inactiveStart).toISOString(),
      end: new Date(now).toISOString()
    });
    
    try {
      await sendActivity('inactivity', {
        duration: Math.floor((now - inactiveStart) / 1000),
        start: new Date(inactiveStart).toISOString(),
        end: new Date(now).toISOString(),
        resumed: true
      });
      
      currentState = 'working';
      lastActivityTime = now;
    } catch (error) {
      console.error('Error sending activity on resume:', error);
      // Still update state even if sending fails
      currentState = 'working';
      lastActivityTime = now;
    }
  }
});

ipcMain.on('take-break', () => {
  console.log('Take break event received');
  // Close popup first to avoid race conditions
  popupManager.closeInactivePopup();
  // Placeholder for Prompt 19 (break logic)
});

function createWindow() {
  console.log('Creating Electron window...');
  mainWindow = new BrowserWindow({
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