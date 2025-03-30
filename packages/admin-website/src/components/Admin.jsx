import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatDateTime, formatDuration } from '@shared/utils/time';

function Admin() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Filter states
  const [userIdFilter, setUserIdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  
  // Sort states
  const [sortField, setSortField] = useState('start_time');
  const [sortDirection, setSortDirection] = useState('desc');

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await axios.get('http://localhost:3000/api/sessions');
      setSessions(response.data);
      setLoading(false);
    } catch (error) {
      setError('Failed to fetch sessions');
      setLoading(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const filteredAndSortedSessions = () => {
    let filtered = [...sessions];

    // Apply filters
    if (userIdFilter) {
      filtered = filtered.filter(session => 
        session.user_id.toLowerCase().includes(userIdFilter.toLowerCase())
      );
    }
    if (statusFilter !== 'All') {
      filtered = filtered.filter(session => session.status === statusFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'start_time':
          comparison = new Date(a.start_time) - new Date(b.start_time);
          break;
        case 'end_time':
          comparison = new Date(a.end_time || 0) - new Date(b.end_time || 0);
          break;
        case 'duration':
          comparison = (a.duration || 0) - (b.duration || 0);
          break;
        default:
          comparison = 0;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  };

  if (loading) return <div className="admin-container">Loading sessions...</div>;
  if (error) return <div className="admin-container">Error: {error}</div>;

  return (
    <div className="admin-container">
      <h1>Session Management</h1>
      
      <div className="filters">
        <div className="filter-group">
          <label htmlFor="userId">User ID:</label>
          <input
            id="userId"
            type="text"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="Filter by User ID"
          />
        </div>
        
        <div className="filter-group">
          <label htmlFor="status">Status:</label>
          <select
            id="status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="All">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="sessions-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th onClick={() => handleSort('start_time')} className="sortable">
                Start Time {getSortIcon('start_time')}
              </th>
              <th onClick={() => handleSort('end_time')} className="sortable">
                End Time {getSortIcon('end_time')}
              </th>
              <th onClick={() => handleSort('duration')} className="sortable">
                Duration {getSortIcon('duration')}
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedSessions().map((session) => (
              <tr key={session._id}>
                <td>{session.user_id}</td>
                <td>{formatDateTime(session.start_time)}</td>
                <td>{formatDateTime(session.end_time)}</td>
                <td>{formatDuration(session.duration)}</td>
                <td>
                  <span className={`status-badge ${session.status}`}>
                    {session.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Admin; 