import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

// Local storage keys
const STORAGE_KEYS = {
  SESSION: 'timeArchitect_session',
  OFFLINE_ACTIONS: 'timeArchitect_offlineActions',
  TOTAL_SHIFT_TIME: 'timeArchitect_totalShiftTime',
  SYNC_QUEUE: 'timeArchitect_syncQueue'
};

// Constants
const DEFAULT_SYNC_INTERVAL = 10000; // 10 seconds in milliseconds
const SERVER_URL = 'http://localhost:3000';

// Function to format time in HH:MM:SS
const formatTimeHHMMSS = (seconds) => {
  if (!seconds) return '00:00:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

// Function to fetch total shift time from the server
const fetchTotalShiftTime = async () => {
  try {
    const response = await axios.get('http://localhost:3000/api/total-shift-time/user123');
    return response.data.total_shift_time;
  } catch (error) {
    console.error('Failed to fetch total shift time:', error);
    return 0;
  }
};

// Function to verify if a session is still active on the server
const verifySession = async (sessionId) => {
  try {
    console.log(`Verifying session: ${sessionId}`);
    // Try to fetch the specific session by ID
    const response = await axios.get(`http://localhost:3000/api/session/${sessionId}`);
    
    // Check if session exists and is active
    if (response.data && response.data.status === 'active') {
      console.log('Session is valid and active on server');
      return true;
    } else {
      console.log('Session exists but is not active');
      return false;
    }
  } catch (error) {
    // If we get a 404, session doesn't exist
    if (error.response && error.response.status === 404) {
      console.log('Session not found on server');
      return false;
    }
    
    // For other errors, we can't verify, so assume it's not valid
    console.error('Error verifying session:', error);
    return false;
  }
};

// Function to retry an API request
const retryRequest = async (fn, maxRetries = 3, delay = 2000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

function TimeTracking() {
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentSessionTime, setCurrentSessionTime] = useState(0);
  const [totalShiftTime, setTotalShiftTime] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClockOutLoading, setIsClockOutLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [serverSyncInterval, setServerSyncInterval] = useState(DEFAULT_SYNC_INTERVAL);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [isVerifyingSession, setIsVerifyingSession] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isTracking, setIsTracking] = useState(false);

  // Load session state and totalShiftTime from localStorage on mount
  useEffect(() => {
    const loadSessionData = async () => {
      try {
        setIsVerifyingSession(true);
        const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION);
        
        if (savedSession) {
          const session = JSON.parse(savedSession);
          
          if (session.isClockedIn && session.startTime && session.sessionId) {
            console.log('Found saved session, verifying with server...');
            const isValid = await verifySession(session.sessionId);
            
            if (isValid) {
              // Session is valid on server, restore it
              console.log('Session verified, restoring local state');
              const startTime = new Date(session.startTime);
              setIsClockedIn(true);
              setSessionId(session.sessionId);
              setSessionStartTime(startTime);
              setCurrentSessionTime(Math.floor((Date.now() - startTime) / 1000));
            } else {
              // Session is not valid, clear it
              console.log('Session not valid on server, clearing local state');
              localStorage.removeItem(STORAGE_KEYS.SESSION);
            }
          }
        }

        const savedTotalShiftTime = localStorage.getItem(STORAGE_KEYS.TOTAL_SHIFT_TIME);
        if (savedTotalShiftTime) {
          setTotalShiftTime(parseInt(savedTotalShiftTime, 10));
        }
      } catch (error) {
        console.error('Error loading session data:', error);
        // On error, clear session to avoid stuck state
        localStorage.removeItem(STORAGE_KEYS.SESSION);
      } finally {
        setIsVerifyingSession(false);
      }
    };

    loadSessionData();
  }, []);

  // Load sync interval from server settings
  useEffect(() => {
    const fetchSyncInterval = async () => {
      try {
        const response = await axios.get('http://localhost:3000/api/settings/serverSyncInterval');
        setServerSyncInterval(response.data.value * 1000 || DEFAULT_SYNC_INTERVAL); // Convert to ms
      } catch (error) {
        console.error('Failed to fetch sync interval:', error);
        setServerSyncInterval(DEFAULT_SYNC_INTERVAL);
      }
    };
    fetchSyncInterval();
  }, []);

  // Save session state to localStorage
  const saveSessionState = (state) => {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(state));
  };

  // Save totalShiftTime to localStorage
  const saveTotalShiftTime = (time) => {
    localStorage.setItem(STORAGE_KEYS.TOTAL_SHIFT_TIME, time.toString());
  };

  // Manage the local timer for currentSessionTime
  useEffect(() => {
    let timer = null;
    if (isClockedIn && sessionStartTime) {
      timer = setInterval(() => {
        const elapsedTime = Math.floor((Date.now() - sessionStartTime) / 1000);
        setCurrentSessionTime(elapsedTime);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
      setCurrentSessionTime(0);
    };
  }, [isClockedIn, sessionStartTime]);

  // Queue sync update
  const queueSyncUpdate = (duration) => {
    const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE) || '[]');
    queue.push({
      sessionId,
      duration,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
  };

  // Process sync queue
  const processSyncQueue = async () => {
    if (!isOnline) return;

    const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE) || '[]');
    if (queue.length === 0) return;

    const newQueue = [];
    for (const update of queue) {
      try {
        await socket.emit('sessionTimeUpdate', {
          session_id: update.sessionId,
          duration: update.duration
        });
      } catch (error) {
        console.error('Failed to sync update:', error);
        newQueue.push(update);
      }
    }

    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(newQueue));
  };

  // Sync interval handler with debug logging
  useEffect(() => {
    let syncTimer = null;

    if (isClockedIn && sessionId) {
      console.log(`Setting up sync timer with interval: ${serverSyncInterval}ms`);
      syncTimer = setInterval(async () => {
        const currentDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
        console.log(`Sync timer triggered. Current duration: ${currentDuration}s`);
        
        if (isOnline) {
          try {
            await socket.emit('sessionTimeUpdate', {
              session_id: sessionId,
              duration: currentDuration
            });
            setLastSyncTime(new Date());
            console.log('Session time synced successfully');
          } catch (error) {
            console.error('Failed to sync session time:', error);
            queueSyncUpdate(currentDuration);
          }
        } else {
          console.log('Offline: Queuing sync update');
          queueSyncUpdate(currentDuration);
        }
      }, serverSyncInterval);
    }

    return () => {
      if (syncTimer) {
        console.log('Clearing sync timer');
        clearInterval(syncTimer);
      }
    };
  }, [isClockedIn, sessionId, serverSyncInterval, isOnline, sessionStartTime]);

  // Process sync queue when coming back online
  useEffect(() => {
    if (isOnline) {
      processSyncQueue();
    }
  }, [isOnline]);

  // Function to sync offline actions
  const syncOfflineActions = async () => {
    const offlineActions = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFLINE_ACTIONS) || '[]');
    console.log('Syncing offline actions:', offlineActions);
    if (offlineActions.length === 0) return;

    let hasError = false;
    for (const action of offlineActions) {
      try {
        if (action.type === 'clockIn') {
          console.log('Syncing clock-in action:', action);
          await retryRequest(() =>
            axios.post('http://localhost:3000/api/clock-in', { user_id: action.userId })
          );
        } else if (action.type === 'clockOut') {
          console.log('Syncing clock-out action:', action);
          await retryRequest(() =>
            axios.post('http://localhost:3000/api/clock-out', {
              user_id: action.userId,
              duration: action.duration,
              endTime: action.endTime,
            })
          );
        }
      } catch (error) {
        console.error('Failed to sync action:', action, error.response?.data || error.message);
        hasError = true;
      }
    }

    if (!hasError) {
      localStorage.setItem(STORAGE_KEYS.OFFLINE_ACTIONS, '[]');
    }

    // Reconcile totalShiftTime with the server
    const serverTotalShiftTime = await fetchTotalShiftTime();
    const localTotalShiftTime = parseInt(localStorage.getItem(STORAGE_KEYS.TOTAL_SHIFT_TIME) || '0', 10);
    const reconciledTotalShiftTime = Math.max(serverTotalShiftTime, localTotalShiftTime);
    setTotalShiftTime(reconciledTotalShiftTime);
    saveTotalShiftTime(reconciledTotalShiftTime);
  };

  // WebSocket connection setup
  useEffect(() => {
    const newSocket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    newSocket.on('connect', async () => {
      console.log('WebSocket: Connected to server');
      setIsConnected(true);
      setIsOnline(true);
      newSocket.emit('register', 'user123');
      
      // Sync offline actions when the WebSocket connects
      await syncOfflineActions();
      
      // Notify main process of online status to trigger activity sync
      try {
        await window.electron.notifyConnectivity(true);
        console.log('IPC: Notified main process of online status');
      } catch (error) {
        console.error('Failed to notify online status:', error);
      }
    });

    newSocket.on('disconnect', async () => {
      console.log('WebSocket: Disconnected from server');
      setIsConnected(false);
      setIsOnline(false);
      
      // Notify main process of offline status
      try {
        await window.electron.notifyConnectivity(false);
        console.log('IPC: Notified main process of offline status');
      } catch (error) {
        console.error('Failed to notify offline status:', error);
      }
    });

    // Listen for auto clock-out events from main process
    window.electron.onAutoClockOut(() => {
      console.log('Received auto-clock-out event from main process');
      setIsClockedIn(false);
      setSessionId(null);
      setSessionStartTime(null);
      setCurrentSessionTime(0);
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      
      // Update total shift time with last known duration
      const duration = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : 0;
      const newTotalShiftTime = totalShiftTime + duration;
      setTotalShiftTime(newTotalShiftTime);
      saveTotalShiftTime(newTotalShiftTime);
      
      // Show notification to user
      if ('Notification' in window) {
        new Notification('Auto Clock-Out', {
          body: 'You have been automatically clocked out due to inactivity.'
        });
      }
    });

    newSocket.on('sessionStarted', async (data) => {
      console.log('WebSocket: Session started', data);
      const { session_id } = data;
      setCurrentSessionId(session_id);
      setIsTracking(true);

      try {
        // Start activity tracking via IPC
        const result = await window.electron.clockIn(session_id);
        console.log('IPC: Clock-in result:', result);
      } catch (error) {
        console.error('IPC: Failed to start tracking:', error);
      }
    });

    newSocket.on('sessionEnded', async (data) => {
      console.log('WebSocket: Session ended', data);
      setCurrentSessionId(null);
      setIsTracking(false);

      try {
        // Stop activity tracking via IPC
        const result = await window.electron.clockOut();
        console.log('IPC: Clock-out result:', result);
      } catch (error) {
        console.error('IPC: Failed to stop tracking:', error);
      }
    });

    newSocket.on('settingsUpdated', (data) => {
      if (data.key === 'serverSyncInterval') {
        console.log('Received new sync interval:', data.value);
        setServerSyncInterval(data.value);
      }
    });

    newSocket.on('totalShiftTimeUpdate', (data) => {
      if (data.user_id === 'user123' && isClockedIn) {
        console.log('Received total shift time update:', data.total_shift_time);
        setTotalShiftTime(data.total_shift_time);
        saveTotalShiftTime(data.total_shift_time);
      }
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      if (newSocket) {
        console.log('WebSocket: Cleaning up connection');
        newSocket.disconnect();
      }
    };
  }, [isClockedIn]);

  const handleClockIn = async () => {
    setIsLoading(true);
    const startTime = new Date();

    try {
      if (isOnline) {
        const response = await axios.post('http://localhost:3000/api/clock-in', {
          user_id: 'user123',
        });

        if (response.status === 201) {
          setSessionId(response.data.session_id);
          setSessionStartTime(startTime);
          setIsClockedIn(true);
          setCurrentSessionTime(0);
          setLastSyncTime(startTime);
          saveSessionState({
            isClockedIn: true,
            sessionId: response.data.session_id,
            startTime: startTime,
          });
        }
      } else {
        setSessionStartTime(startTime);
        setIsClockedIn(true);
        setCurrentSessionTime(0);
        saveSessionState({
          isClockedIn: true,
          startTime: startTime,
        });
        localStorage.setItem(
          STORAGE_KEYS.OFFLINE_ACTIONS,
          JSON.stringify([
            { type: 'clockIn', userId: 'user123', timestamp: startTime },
          ])
        );
      }
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to clock in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async () => {
    setIsClockOutLoading(true);

    try {
      const endTime = new Date();
      const duration = sessionStartTime ? Math.floor((endTime - sessionStartTime) / 1000) : 0;

      // Stop activity tracking first
      try {
        await window.electron.clockOut();
        console.log('IPC: Activity tracking stopped');
      } catch (error) {
        console.error('IPC: Failed to stop tracking:', error);
      }

      if (isOnline) {
        const response = await axios.post('http://localhost:3000/api/clock-out', {
          user_id: 'user123',
        });

        if (response.status === 200) {
          setIsClockedIn(false);
          setSessionId(null);
          setSessionStartTime(null);
          setCurrentSessionTime(0);
          localStorage.removeItem(STORAGE_KEYS.SESSION);
          const totalTime = await fetchTotalShiftTime();
          setTotalShiftTime(totalTime);
          saveTotalShiftTime(totalTime);
        }
      } else {
        // Calculate and store the session duration locally
        const newTotalShiftTime = totalShiftTime + duration;
        setIsClockedIn(false);
        setSessionId(null);
        setSessionStartTime(null);
        setCurrentSessionTime(0);
        setTotalShiftTime(newTotalShiftTime);
        saveTotalShiftTime(newTotalShiftTime);
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        localStorage.setItem(
          STORAGE_KEYS.OFFLINE_ACTIONS,
          JSON.stringify([
            {
              type: 'clockOut',
              userId: 'user123',
              timestamp: endTime,
              duration: duration,
              endTime: endTime.toISOString(),
            },
          ])
        );
      }
    } catch (error) {
      console.error('Clock out error:', error);
      alert(error.response?.data?.message || 'Failed to clock out. Please try again.');
    } finally {
      setIsClockOutLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="time-tracking-container">
        <h1>Time Architect</h1>
        <div className="connection-status">
          {!isOnline && <span className="offline-badge">Offline Mode</span>}
          {isVerifyingSession && <span className="verification-badge">Verifying Session...</span>}
        </div>
        <div className="time-displays">
          <div className="time-card">
            <h2>Current Session</h2>
            <div className="time-value">{formatTimeHHMMSS(currentSessionTime)}</div>
          </div>
          <div className="time-card">
            <h2>Total Shift Time</h2>
            <div className="time-value">{formatTimeHHMMSS(totalShiftTime)}</div>
          </div>
        </div>
        <div className="button-container">
          <button
            className={`clock-button ${isClockedIn ? 'clocked-in' : ''}`}
            onClick={handleClockIn}
            disabled={isClockedIn || isLoading || isVerifyingSession}
          >
            {isLoading ? 'Clocking In...' : 'Clock In'}
          </button>
          <button
            className={`clock-button ${!isClockedIn ? 'clocked-out' : ''}`}
            onClick={handleClockOut}
            disabled={!isClockedIn || isClockOutLoading || isVerifyingSession}
          >
            {isClockOutLoading ? 'Clocking Out...' : 'Clock Out'}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  return <TimeTracking />;
}

export default App;