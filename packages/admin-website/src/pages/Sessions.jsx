import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatDateTime, formatTime, formatDuration } from '@shared/utils/time';
import './Sessions.css';

function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState('start_time');
  const [sortDirection, setSortDirection] = useState('desc');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    userId: '',
    status: 'all'
  });

  useEffect(() => {
    fetchSessions();
  }, [sortField, sortDirection, filters]);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      let url = `http://localhost:3000/api/sessions?sort=${sortField}&direction=${sortDirection}`;
      
      // Add filters to URL
      if (filters.startDate) {
        url += `&startDate=${filters.startDate}`;
      }
      if (filters.endDate) {
        url += `&endDate=${filters.endDate}`;
      }
      if (filters.userId) {
        url += `&userId=${filters.userId}`;
      }
      if (filters.status !== 'all') {
        url += `&status=${filters.status}`;
      }

      const response = await axios.get(url);
      setSessions(response.data);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeWithHumanReadable = (seconds) => {
    if (!seconds) return 'N/A';
    return formatDuration(seconds);
  };

  const getGroupStatus = (sessions) => {
    return sessions.some(session => session.status === 'active') ? 'Active' : 'Completed';
  };

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (field !== sortField) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (isLoading) {
    return <div className="loading">Loading sessions...</div>;
  }

  return (
    <div className="sessions-page">
      <div className="page-header">
        <h1>Session Management</h1>
        <p>View and manage employee work sessions</p>
      </div>
      <div className="content-card">
        <div className="filters-section">
          <div className="filters-form">
            <div className="filter-group">
              <label>Date Range</label>
              <div className="date-inputs">
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  placeholder="Start Date"
                />
                <span>to</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  placeholder="End Date"
                />
              </div>
            </div>
            <div className="filter-group">
              <label>User ID</label>
              <input
                type="text"
                value={filters.userId}
                onChange={(e) => handleFilterChange('userId', e.target.value)}
                placeholder="Filter by User ID"
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <button 
            className="refresh-button"
            onClick={fetchSessions}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="table-container">
          {sessions.map((groupedSession) => (
            <div key={`${groupedSession.user_id}_${groupedSession.date}`} className="session-group">
              <div className="group-header">
                <div className="group-header-top">
                  <h3>User ID: {groupedSession.user_id} - Date: {groupedSession.date}</h3>
                  <span className={`status-badge ${getGroupStatus(groupedSession.sessions).toLowerCase()}`}>
                    {getGroupStatus(groupedSession.sessions)}
                  </span>
                </div>
                <div className="group-totals">
                  <span>Total Shift Time: {formatTimeWithHumanReadable(groupedSession.total_shift_time)}</span>
                  <span>Total Break Time: {formatTimeWithHumanReadable(groupedSession.total_break_duration)}</span>
                  <span>Normal Break Time: {formatTimeWithHumanReadable(groupedSession.total_normal_break_duration)}</span>
                  <span>Office Break Time: {formatTimeWithHumanReadable(groupedSession.total_office_break_duration)}</span>
                  <span>Total Payable Hours: {formatTimeWithHumanReadable(groupedSession.total_payable_hours)}</span>
                </div>
              </div>
              <table className="sessions-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('start_time')}>
                      Start Time {getSortIcon('start_time')}
                    </th>
                    <th onClick={() => handleSort('end_time')}>
                      End Time {getSortIcon('end_time')}
                    </th>
                    <th onClick={() => handleSort('duration')}>
                      Duration {getSortIcon('duration')}
                    </th>
                    <th onClick={() => handleSort('status')}>
                      Status {getSortIcon('status')}
                    </th>
                    <th>Normal Break</th>
                    <th>Office Break</th>
                    <th>Inactive Time</th>
                    <th>Payable Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedSession.sessions.map((session) => (
                    <tr key={session._id}>
                      <td>{formatDateTime(session.start_time)}</td>
                      <td>{session.end_time ? formatDateTime(session.end_time) : '-'}</td>
                      <td>{formatDuration(session.duration || 0)}</td>
                      <td>
                        <span className={`status-badge ${session.status}`}>
                          {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                        </span>
                      </td>
                      <td>{formatDuration(session.normal_break_duration || 0)}</td>
                      <td>{formatDuration(session.office_break_duration || 0)}</td>
                      <td>{formatDuration(session.inactive_time || 0)}</td>
                      <td>{formatDuration(session.payable_hours || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Sessions; 