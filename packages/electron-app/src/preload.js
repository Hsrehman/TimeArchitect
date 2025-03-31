const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    clockIn: (sessionId) => ipcRenderer.invoke('clock-in', sessionId),
    clockOut: () => ipcRenderer.invoke('clock-out'),
    notifyConnectivity: (isOnline) => ipcRenderer.invoke('notify-connectivity', isOnline),
    // Add any other methods you need to expose here
    
    // Inactivity popup handlers
    onStartInactiveTimer: (callback) => {
      ipcRenderer.on('start-inactive-timer', (event, data) => callback(data));
    },
    resumeFromInactive: () => ipcRenderer.send('resume-inactive'),
    takeBreak: () => ipcRenderer.send('take-break'),
    
    // Auto clock-out handler
    onAutoClockOut: (callback) => {
      ipcRenderer.on('auto-clock-out', () => callback());
    }
  }
); 