const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const Session = require('./models/Session');
const Settings = require('./models/Settings');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5174", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/time_tracking';

// Middleware
app.use(cors({
  origin: ["http://localhost:5174", "http://localhost:5173"],
  credentials: true,
}));
app.use(express.json());

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Function to get start of current day in UTC
const getStartOfDay = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

// Function to calculate total shift time for a user
const calculateTotalShiftTime = async (userId) => {
  try {
    const startOfDay = getStartOfDay();
    const sessions = await Session.find({
      user_id: userId,
      start_time: { $gte: startOfDay },
    });

    let totalTime = 0;
    for (const session of sessions) {
      if (session.status === 'completed') {
        totalTime += Math.floor((session.end_time - session.start_time) / 1000);
      } else {
        totalTime += session.last_synced_duration;
      }
    }
    return totalTime;
  } catch (error) {
    console.error('Error calculating total shift time:', error);
    return 0;
  }
};

// Function to emit total shift time update for a user
const emitTotalShiftTimeUpdate = async (userId) => {
  try {
    const totalShiftTime = await calculateTotalShiftTime(userId);
    io.to(userId).emit('totalShiftTimeUpdate', {
      user_id: userId,
      total_shift_time: totalShiftTime,
    });
  } catch (error) {
    console.error('Error emitting total shift time update:', error);
  }
};

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (userId) => {
    console.log(`Client ${socket.id} registered as user ${userId}`);
    socket.join(userId);
  });

  socket.on('sessionTimeUpdate', async ({ session_id, duration }) => {
    try {
      const session = await Session.findById(session_id);
      if (!session || session.status !== 'active') {
        return;
      }

      await session.updateSyncedDuration(duration);
      console.log(`Session time updated for ${session_id}: ${duration}s`);
      
      // Emit update to admin dashboard
      io.emit('sessionUpdated', {
        session_id,
        duration,
        user_id: session.user_id
      });
    } catch (error) {
      console.error('Error updating session time:', error);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, reason);
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Get all sessions endpoint
app.get('/api/sessions', async (req, res) => {
  try {
    const { startDate, endDate, userId, status } = req.query;
    let query = {};

    if (startDate || endDate) {
      query.start_time = {};
      if (startDate) query.start_time.$gte = new Date(startDate);
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.start_time.$lte = endDateTime;
      }
    }

    if (userId) query.user_id = userId;
    if (status && status !== 'all') query.status = status.toLowerCase();

    const sessions = await Session.find(query).sort({ start_time: -1 });

    // Group sessions by user_id and date
    const groupedSessions = sessions.reduce((acc, session) => {
      const date = new Date(session.start_time).toISOString().split('T')[0];
      const key = `${session.user_id}_${date}`;
      
      if (!acc[key]) {
        acc[key] = {
          user_id: session.user_id,
          date,
          sessions: [],
          total_shift_time: 0,
          total_normal_break_duration: 0,
          total_office_break_duration: 0,
          total_break_duration: 0,
          total_inactive_time: 0,
          total_pending_validation_time: 0,
          total_payable_hours: 0
        };
      }

      // Include activity_logs in session data
      acc[key].sessions.push({
        _id: session._id,
        start_time: session.start_time,
        end_time: session.end_time,
        status: session.status,
        duration: session.duration,
        work_time: session.work_time,
        breaks: session.breaks,
        normal_break_duration: session.normal_break_duration || 0,
        office_break_duration: session.office_break_duration || 0,
        total_break_duration: session.total_break_duration || 0,
        inactive_time: session.inactive_time || 0,
        pending_validation_time: session.pending_validation_time || 0,
        payable_hours: session.payable_hours || 0,
        activity_logs: session.activity_logs || []
      });

      // Update totals
      acc[key].total_shift_time += session.duration || 0;
      acc[key].total_normal_break_duration += session.normal_break_duration || 0;
      acc[key].total_office_break_duration += session.office_break_duration || 0;
      acc[key].total_break_duration += session.total_break_duration || 0;
      acc[key].total_inactive_time += session.inactive_time || 0;
      acc[key].total_pending_validation_time += session.pending_validation_time || 0;
      acc[key].total_payable_hours += session.payable_hours || 0;

      return acc;
    }, {});

    // Convert to array and sort by date (descending)
    const result = Object.values(groupedSessions).sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );

    res.json(result);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ message: 'Failed to fetch sessions', error: error.message });
  }
});

// Clock In endpoint
app.post('/api/clock-in', async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: 'user_id is required' });
    }

    const session = new Session({
      user_id,
      start_time: new Date(),
      status: 'active',
    });

    await session.save();

    io.to(user_id).emit('sessionStarted', {
      session_id: session._id,
      user_id: session.user_id,
      start_time: session.start_time,
    });

    await emitTotalShiftTimeUpdate(user_id);

    res.status(201).json({
      message: 'Session started successfully',
      session_id: session._id,
    });
  } catch (error) {
    console.error('Clock in error:', error);
    res.status(500).json({ message: 'Failed to start session', error: error.message });
  }
});

// Clock Out endpoint
app.post('/api/clock-out', async (req, res) => {
  try {
    const { user_id, duration, endTime } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: 'user_id is required' });
    }

    const activeSession = await Session.findOne({
      user_id,
      status: 'active',
      end_time: null,
    });

    if (!activeSession) {
      return res.status(404).json({ message: 'No active session found' });
    }

    // Use the client-provided endTime if available, otherwise use server time
    activeSession.end_time = endTime ? new Date(endTime) : new Date();
    activeSession.status = 'completed';
    await activeSession.save();

    await emitTotalShiftTimeUpdate(user_id);

    res.status(200).json({
      message: 'Session ended successfully',
      session_id: activeSession._id,
      duration: duration || activeSession.duration, // Return client-provided duration if available
    });
  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({ message: 'Failed to end session', error: error.message });
  }
});
// Start Break endpoint
app.post('/api/break-start', async (req, res) => {
  try {
    const { user_id, type, reason, intended_duration } = req.body;

    if (!user_id) return res.status(400).json({ message: 'user_id is required' });
    if (!type || !['normal', 'office'].includes(type)) {
      return res.status(400).json({ message: 'Valid break type (normal/office) is required' });
    }
    if (!reason) return res.status(400).json({ message: 'Break reason is required' });
    if (typeof intended_duration !== 'number' || intended_duration <= 0) {
      return res.status(400).json({ message: 'Valid intended_duration (in seconds) is required' });
    }

    const session = await Session.findOne({ user_id, status: 'active' });
    if (!session) return res.status(400).json({ message: 'No active session found' });

    const activeBreak = session.getActiveBreak();
    if (activeBreak) return res.status(400).json({ message: 'Break already in progress' });

    await session.startBreak(type, reason, intended_duration);

    io.to(user_id).emit('breakStarted', {
      session_id: session._id,
      user_id: session.user_id,
      break: session.breaks[session.breaks.length - 1],
    });

    await emitTotalShiftTimeUpdate(user_id);

    res.json({ message: 'Break started successfully', session_id: session._id });
  } catch (error) {
    console.error('Break start error:', error);
    res.status(500).json({ message: 'Failed to start break', error: error.message });
  }
});

// End Break endpoint
app.post('/api/break-end', async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ message: 'user_id is required' });

    const session = await Session.findOne({ user_id, status: 'active' });
    if (!session) return res.status(400).json({ message: 'No active session found' });

    const activeBreak = session.getActiveBreak();
    if (!activeBreak) return res.status(400).json({ message: 'No active break found' });

    await session.endBreak();

    io.to(user_id).emit('breakEnded', {
      session_id: session._id,
      user_id: session.user_id,
      break: session.breaks[session.breaks.length - 1],
    });

    await emitTotalShiftTimeUpdate(user_id);

    res.json({ message: 'Break ended successfully', session_id: session._id });
  } catch (error) {
    console.error('Break end error:', error);
    res.status(500).json({ message: 'Failed to end break', error: error.message });
  }
});

// Remove the /api/update-session-time endpoint
// It's no longer needed since the client manages currentSessionTime locally

// Settings endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.find();
    const settingsObject = settings.reduce((acc, setting) => {
      acc[setting.key] = {
        value: setting.value,
        description: setting.description,
      };
      return acc;
    }, {});
    res.json(settingsObject);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
});

// Add specific endpoint for serverSyncInterval
app.get('/api/settings/serverSyncInterval', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'serverSyncInterval' });
    if (!setting) {
      return res.status(404).json({ message: 'Setting not found' });
    }
    res.json({
      key: setting.key,
      value: setting.value * 1000, // Convert to milliseconds
      description: setting.description,
    });
  } catch (error) {
    console.error('Error fetching serverSyncInterval:', error);
    res.status(500).json({ message: 'Failed to fetch serverSyncInterval' });
  }
});

// Update specific endpoint for serverSyncInterval
app.put('/api/settings/serverSyncInterval', async (req, res) => {
  try {
    const { value } = req.body;

    if (typeof value !== 'number' || value <= 0) {
      return res.status(400).json({ 
        message: 'value must be a positive number (milliseconds)' 
      });
    }

    const setting = await Settings.findOne({ key: 'serverSyncInterval' });
    if (!setting) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    // Convert milliseconds to seconds for storage
    setting.value = Math.floor(value / 1000);
    await setting.save();

    // Emit WebSocket event to all clients
    io.emit('settingsUpdated', {
      key: 'serverSyncInterval',
      value: value, // Send milliseconds to clients
    });

    res.json({
      key: setting.key,
      value: value, // Return milliseconds
      description: setting.description,
    });
  } catch (error) {
    console.error('Error updating serverSyncInterval:', error);
    res.status(500).json({ 
      message: 'Failed to update serverSyncInterval', 
      error: error.message 
    });
  }
});

// General settings update endpoint
app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ message: 'key and value are required' });
    }

    const setting = await Settings.findOne({ key });
    if (!setting) return res.status(404).json({ message: 'Setting not found' });

    setting.value = value;
    await setting.save();

    // For serverSyncInterval, also emit WebSocket event
    if (key === 'serverSyncInterval') {
      io.emit('settingsUpdated', {
        key: 'serverSyncInterval',
        value: value * 1000, // Convert to milliseconds for clients
      });
    }

    res.json({
      key: setting.key,
      value: setting.value,
      description: setting.description,
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ message: 'Failed to update setting', error: error.message });
  }
});

// Add new endpoint for getting total shift time
app.get('/api/total-shift-time/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const totalShiftTime = await calculateTotalShiftTime(userId);
    res.json({ total_shift_time: totalShiftTime });
  } catch (error) {
    console.error('Error fetching total shift time:', error);
    res.status(500).json({ message: 'Failed to fetch total shift time', error: error.message });
  }
});

// Get setting by key
app.get('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const setting = await Settings.findOne({ key });
    
    if (!setting) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    res.json({
      key: setting.key,
      value: setting.value,
      description: setting.description
    });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ message: 'Failed to fetch setting' });
  }
});

// Update setting by key
app.put('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ message: 'value is required' });
    }

    const setting = await Settings.findOne({ key });
    if (!setting) {
      return res.status(404).json({ message: 'Setting not found' });
    }

    setting.value = value;
    await setting.save();

    // Emit WebSocket event
    io.emit('settingsUpdated', {
      key,
      value,
      description: setting.description
    });

    res.json({
      key: setting.key,
      value: setting.value,
      description: setting.description
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ message: 'Failed to update setting' });
  }
});

// Activity logging endpoint
app.post('/api/activity', async (req, res) => {
  try {
    const { sessionId, type, count, details } = req.body;
    
    if (!sessionId || !type) {
      return res.status(400).json({ message: 'sessionId and type are required' });
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const activityLog = {
      timestamp: new Date(),
      type,
      details: type === 'window_switch' ? details : { count }
    };

    session.activity_logs.push(activityLog);
    await session.save();

    res.status(200).json({
      message: 'Activity logged successfully',
      activity: activityLog
    });
  } catch (error) {
    console.error('Activity logging error:', error);
    res.status(500).json({ message: 'Failed to log activity', error: error.message });
  }
});

// Settings endpoints
app.get('/api/settings/pendingValidationThreshold', async (req, res) => {
  try {
    const value = await Settings.getSetting('pendingValidationThreshold');
    res.json({ value: value ?? 10 }); // Default: 10 seconds
  } catch (error) {
    console.error('Error fetching pendingValidationThreshold:', error);
    res.status(500).json({ message: 'Failed to fetch setting', error: error.message });
  }
});

app.get('/api/settings/inactiveThreshold', async (req, res) => {
  try {
    const value = await Settings.getSetting('inactiveThreshold');
    res.json({ value: value ?? 3000 }); // Default: 3000 seconds
  } catch (error) {
    console.error('Error fetching inactiveThreshold:', error);
    res.status(500).json({ message: 'Failed to fetch setting', error: error.message });
  }
});

app.get('/api/settings/autoClockOutEnabled', async (req, res) => {
  try {
    const value = await Settings.getSetting('autoClockOutEnabled');
    res.json({ value: value ?? true }); // Default: true
  } catch (error) {
    console.error('Error fetching autoClockOutEnabled:', error);
    res.status(500).json({ message: 'Failed to fetch setting', error: error.message });
  }
});

// Seed default settings
const seedDefaultSettings = async () => {
  try {
    const defaultSettings = [
      {
        key: 'serverSyncInterval',
        value: 10,
        description: 'Interval (in seconds) for clients to sync session time with the server',
      },
    ];

    for (const setting of defaultSettings) {
      const exists = await Settings.findOne({ key: setting.key });
      if (!exists) {
        await Settings.create(setting);
        console.log(`Created default setting: ${setting.key}`);
      }
    }
  } catch (error) {
    console.error('Error seeding default settings:', error);
  }
};

// Get a single session by ID
app.get('/api/session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const session = await Session.findById(id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    
    res.json({
      _id: session._id,
      user_id: session.user_id,
      start_time: session.start_time,
      end_time: session.end_time,
      status: session.status,
      duration: session.duration,
      work_time: session.work_time,
      breaks: session.breaks,
      normal_break_duration: session.normal_break_duration || 0,
      office_break_duration: session.office_break_duration || 0,
      total_break_duration: session.total_break_duration || 0,
      inactive_time: session.inactive_time || 0,
      pending_validation_time: session.pending_validation_time || 0
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ message: 'Failed to fetch session' });
  }
});

// Start the server
connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    seedDefaultSettings();
  });
}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});