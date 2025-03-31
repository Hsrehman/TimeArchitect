const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    enum: [
      'pendingValidationThreshold',
      'inactiveThreshold',
      'autoClockOutEnabled',
      'autoClockOutDelay',
      'serverSyncInterval',
      'minActivityThreshold'
    ]
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Static method to get a setting by key
settingsSchema.statics.getSetting = async function(key) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : null;
};

// Static method to update a setting
settingsSchema.statics.updateSetting = async function(key, value) {
  const result = await this.findOneAndUpdate(
    { key },
    { value },
    { new: true }
  );
  return result;
};

// Static method to initialize default settings
settingsSchema.statics.initializeDefaults = async function() {
  const defaults = [
    {
      key: 'pendingValidationThreshold',
      value: 10, // Changed from 300 to 10 seconds
      description: 'Time of inactivity before session requires validation (in seconds)'
    },
    {
      key: 'inactiveThreshold',
      value: 20, // 20 seconds
      description: 'Time of inactivity before session is marked as inactive (in seconds)'
    },
    {
      key: 'autoClockOutEnabled',
      value: true,
      description: 'Whether to automatically clock out inactive sessions'
    },
    {
      key: 'autoClockOutDelay',
      value: 40, // 30 minutes in seconds
      description: 'Time to wait before auto clocking out an inactive session (in seconds)'
    },
    {
      key: 'serverSyncInterval',
      value: 5, // 1 minute in seconds
      description: 'Interval for syncing session data with server (in seconds)'
    },
    {
      key: 'minActivityThreshold',
      value: 5, // 5 seconds
      description: 'Minimum time between activity logs (in seconds)'
    }
  ];

  for (const setting of defaults) {
    await this.findOneAndUpdate(
      { key: setting.key },
      setting,
      { upsert: true }
    );
  }

  // Fetch and log all settings
  const allSettings = await this.find({}).lean();
  console.log('\n=== Current Settings ===');
  allSettings.forEach(setting => {
    console.log(`${setting.key}:`, {
      value: setting.value,
      description: setting.description
    });
  });
  console.log('=====================\n');
};

const Settings = mongoose.model('Settings', settingsSchema);

// Initialize default settings when the model is first loaded
Settings.initializeDefaults().catch(console.error);

module.exports = Settings; 