import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';

function Settings() {
  const [settings, setSettings] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [syncInterval, setSyncInterval] = useState('');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('http://localhost:3000/api/settings');
      setSettings(response.data);
      if (response.data.serverSyncInterval) {
        setSyncInterval(response.data.serverSyncInterval.value.toString());
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const validateSyncInterval = (value) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return 'Sync interval must be a number';
    }
    if (numValue < 5) {
      return 'Sync interval must be at least 5 seconds';
    }
    if (numValue > 60) {
      return 'Sync interval cannot exceed 60 seconds';
    }
    return '';
  };

  const handleSyncIntervalChange = (e) => {
    const value = e.target.value;
    setSyncInterval(value);
    setValidationError(validateSyncInterval(value));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const error = validateSyncInterval(syncInterval);
    if (error) {
      setValidationError(error);
      return;
    }

    setIsSaving(true);
    try {
      const value = parseInt(syncInterval, 10);
      await axios.post('http://localhost:3000/api/settings', {
        key: 'serverSyncInterval',
        value
      });

      toast.success('Settings updated successfully');
      await fetchSettings();
    } catch (error) {
      console.error('Failed to update settings:', error);
      toast.error(error.response?.data?.message || 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="loading">Loading settings...</div>;
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
        <p>Configure system-wide settings for Time Architect</p>
      </div>
      <div className="content-card">
        <form onSubmit={handleSubmit}>
          <div className="setting-item">
            <label htmlFor="serverSyncInterval">Server Sync Interval</label>
            <div className="setting-input">
              <input
                type="number"
                id="serverSyncInterval"
                min="5"
                max="60"
                value={syncInterval}
                onChange={handleSyncIntervalChange}
                disabled={isSaving}
                className={validationError ? 'error' : ''}
              />
              <span className="unit">seconds</span>
            </div>
            {validationError && (
              <div className="validation-error">{validationError}</div>
            )}
            <p className="setting-description">
              {settings.serverSyncInterval?.description}
            </p>
          </div>
          <div className="form-actions">
            <button 
              type="submit" 
              className="save-button"
              disabled={isSaving || !!validationError}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Settings; 