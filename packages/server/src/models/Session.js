const mongoose = require('mongoose');

const breakSchema = new mongoose.Schema({
  start_time: {
    type: Date,
    required: true,
    default: Date.now,
  },
  end_time: {
    type: Date,
    default: null,
  },
  type: {
    type: String,
    enum: ['normal', 'office'],
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  intended_duration: {
    type: Number, // in seconds
    required: true,
  }
}, { _id: false });

const activityLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
  },
  type: {
    type: String,
    enum: ['keyboard', 'mouse', 'window_switch', 'browser', 'inactivity', 'pending_validation', 'auto_clock_out'],
    required: true,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  }
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
  },
  start_time: {
    type: Date,
    required: true,
    default: Date.now,
  },
  end_time: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'pending_validation', 'inactive', 'completed'],
    default: 'active',
  },
  breaks: {
    type: [breakSchema],
    default: [],
  },
  pending_validation_time: {
    type: Number,
    default: 0, // in seconds
  },
  inactive_time: {
    type: Number,
    default: 0, // in seconds
  },
  last_synced_duration: {
    type: Number,
    default: 0, // in seconds
  },
  last_sync_time: {
    type: Date,
    default: null,
  },
  activity_logs: {
    type: [activityLogSchema],
    default: [],
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt timestamps
  toJSON: { virtuals: true }, // Include virtuals when converting to JSON
  toObject: { virtuals: true } // Include virtuals when converting to object
});

// Duration virtual now uses last_synced_duration for active sessions
sessionSchema.virtual('duration').get(function() {
  if (this.status === 'completed' && this.end_time) {
    return Math.floor((this.end_time - this.start_time) / 1000);
  }
  return this.last_synced_duration;
});

// Break durations by type
sessionSchema.virtual('normal_break_duration').get(function() {
  if (!this.breaks || this.breaks.length === 0) return 0;
  
  return this.breaks
    .filter(breakItem => breakItem.type === 'normal')
    .reduce((total, breakItem) => {
      const endTime = breakItem.end_time || new Date();
      return total + (endTime - breakItem.start_time);
    }, 0) / 1000; // Convert to seconds
});

sessionSchema.virtual('office_break_duration').get(function() {
  if (!this.breaks || this.breaks.length === 0) return 0;
  
  return this.breaks
    .filter(breakItem => breakItem.type === 'office')
    .reduce((total, breakItem) => {
      const endTime = breakItem.end_time || new Date();
      return total + (endTime - breakItem.start_time);
    }, 0) / 1000; // Convert to seconds
});

// Total break duration (all types)
sessionSchema.virtual('total_break_duration').get(function() {
  return this.normal_break_duration + this.office_break_duration;
});

// Work time (excluding all breaks and inactive time)
sessionSchema.virtual('work_time').get(function() {
  return Math.max(0, this.duration - this.total_break_duration - this.inactive_time);
});

// Payable hours (work time plus office breaks)
sessionSchema.virtual('payable_hours').get(function() {
  return this.work_time + this.office_break_duration;
});

// Add a method to start a break
sessionSchema.methods.startBreak = function(type, reason, intended_duration) {
  this.breaks.push({
    start_time: new Date(),
    type,
    reason,
    intended_duration
  });
  return this.save();
};

// Add a method to end the latest break
sessionSchema.methods.endBreak = function() {
  if (this.breaks.length === 0) return null;
  const latestBreak = this.breaks[this.breaks.length - 1];
  if (latestBreak.end_time) return null;
  
  latestBreak.end_time = new Date();
  return this.save();
};

// Add a method to end the session
sessionSchema.methods.endSession = function() {
  // End any active break
  const latestBreak = this.breaks[this.breaks.length - 1];
  if (latestBreak && !latestBreak.end_time) {
    latestBreak.end_time = new Date();
  }
  
  this.end_time = new Date();
  this.status = 'completed';
  return this.save();
};

// Add a method to get the active break if any
sessionSchema.methods.getActiveBreak = function() {
  if (this.breaks.length === 0) return null;
  const latestBreak = this.breaks[this.breaks.length - 1];
  return latestBreak.end_time ? null : latestBreak;
};

// Add a method to update inactive time
sessionSchema.methods.addInactiveTime = function(seconds) {
  this.inactive_time += seconds;
  return this.save();
};

// Add a method to update pending validation time
sessionSchema.methods.addPendingValidationTime = function(seconds) {
  this.pending_validation_time += seconds;
  return this.save();
};

// Add method to update synced duration
sessionSchema.methods.updateSyncedDuration = function(duration) {
  this.last_synced_duration = duration;
  this.last_sync_time = new Date();
  return this.save();
};

// Add method to log activity
sessionSchema.methods.logActivity = function(type, details = null) {
  this.activity_logs.push({
    timestamp: new Date(),
    type,
    details
  });
  return this.save();
};

// Add method to update session status
sessionSchema.methods.updateStatus = function(newStatus) {
  if (!['active', 'pending_validation', 'inactive', 'completed'].includes(newStatus)) {
    throw new Error('Invalid status');
  }
  this.status = newStatus;
  return this.save();
};

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session; 