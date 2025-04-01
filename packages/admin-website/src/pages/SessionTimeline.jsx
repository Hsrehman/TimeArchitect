import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatDateTime, formatDuration } from '@shared/utils/time';
import '../styles/timeline.css';

function SessionTimeline() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [groupDetails, setGroupDetails] = useState({});
  const [loadingDetails, setLoadingDetails] = useState(new Set());

  useEffect(() => {
    fetchSessionDetails();
  }, [sessionId]);

  const fetchSessionDetails = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`http://localhost:3000/api/sessions/${sessionId}`);
      setSession(response.data);
      setError(null);
    } catch (error) {
      console.error('Failed to fetch session details:', error);
      setError('Failed to load session details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGroupDetails = async (groupId) => {
    if (groupDetails[groupId]) return;

    setLoadingDetails(prev => new Set([...prev, groupId]));
    try {
      const response = await axios.get(
        `http://localhost:3000/api/sessions/${sessionId}/activities/${groupId}`
      );
      setGroupDetails(prev => ({
        ...prev,
        [groupId]: response.data.activities
      }));
    } catch (error) {
      console.error('Failed to fetch activity details:', error);
    } finally {
      setLoadingDetails(prev => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  };

  const toggleEventDetails = async (groupId) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
      fetchGroupDetails(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  if (isLoading) return <div className="loading">Loading session details...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!session) return <div className="error">Session not found</div>;

  return (
    <div className="admin-container">
      <div className="header">
        <h1>Session Timeline</h1>
        <button className="back-button" onClick={() => navigate('/sessions')}>
          Back to Sessions
        </button>
      </div>

      <div className="session-details">
        <h2>Session Details</h2>
        <div className="session-meta">
          <div className="meta-item">
            <span className="meta-label">Employee</span>
            <span className="meta-value">{session.user_id}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Session ID</span>
            <span className="meta-value">{session._id}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Start Time</span>
            <span className="meta-value">{formatDateTime(session.start_time)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">End Time</span>
            <span className="meta-value">
              {session.end_time ? formatDateTime(session.end_time) : '-'}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Status</span>
            <span className={`meta-value status-${session.status}`}>
              {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
            </span>
          </div>
        </div>

        <div className="session-summary">
          <h3>Session Summary</h3>
          <div className="summary-item">
            <span>Total Session Duration:</span>
            <span><strong>{formatDuration(session.duration || 0)}</strong></span>
          </div>
          <div className="summary-item">
            <span>Work Time:</span>
            <span>
              <strong>
                {formatDuration(session.work_time || 0)} 
                ({Math.round(((session.work_time || 0) / (session.duration || 1)) * 100)}%)
              </strong>
            </span>
          </div>
          <div className="summary-item">
            <span>Inactive Time:</span>
            <span>
              <strong>
                {formatDuration(session.inactive_time || 0)} 
                ({Math.round(((session.inactive_time || 0) / (session.duration || 1)) * 100)}%)
              </strong>
            </span>
          </div>
        </div>
      </div>

      <div className="timeline">
        {session.timeline.map((group, index) => (
          <div key={group.groupId || index} className="timeline-item">
            <div className="timeline-time">
              {formatDateTime(group.startTime, true)}
            </div>
            <div className={`timeline-dot ${group.type}`}></div>
            <div className={`timeline-content ${group.type}-event`}>
              <div className="event-header">
                <div className="event-title">
                  {(() => {
                    switch (group.type) {
                      case 'clock_in': return 'Clock In';
                      case 'clock_out': return 'Clock Out';
                      case 'auto_clock_out': return 'Auto Clock Out';
                      case 'activity': return group.app;
                      default: return group.type.charAt(0).toUpperCase() + group.type.slice(1).replace('_', ' ');
                    }
                  })()}
                </div>
                {group.duration > 0 && (
                  <div className="event-duration">
                    Duration: {formatDuration(group.duration)}
                  </div>
                )}
              </div>
              
              <div className="event-details">
                {group.type === 'activity' ? (
                  <>
                    <div>{group.description}</div>
                    {group.hasDetails && (
                      <button 
                        className={`event-expand-btn ${expandedGroups.has(group.groupId) ? 'expanded' : ''}`}
                        onClick={() => toggleEventDetails(group.groupId)}
                        disabled={loadingDetails.has(group.groupId)}
                      >
                        {loadingDetails.has(group.groupId) ? 'Loading...' : 'Show Details'}
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </button>
                    )}
                    {expandedGroups.has(group.groupId) && groupDetails[group.groupId] && (
                      <div className="expanded-content">
                        {groupDetails[group.groupId].map((event, eventIndex) => (
                          <div key={eventIndex} className="event-item">
                            <div className="event-time">
                              {formatDateTime(event.timestamp, true)}
                            </div>
                            {event.type === 'keyboard' && (
                              <div>Keyboard: Keycode {event.details?.keycode}</div>
                            )}
                            {event.type === 'mouse' && (
                              <div>
                                Mouse: Button {event.details?.button}
                                {event.details?.position && 
                                  ` (x:${event.details.position.x}, y:${event.details.position.y})`
                                }
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {group.type === 'clock_in' && (
                      <div>User started their work session</div>
                    )}
                    {group.type === 'clock_out' && (
                      <div>User ended their work session</div>
                    )}
                    {group.type === 'inactivity' && (
                      <div>No activity detected for {formatDuration(group.duration)}</div>
                    )}
                    {group.type === 'pending_validation' && (
                      <div>User prompted to confirm activity status</div>
                    )}
                    {group.type === 'auto_clock_out' && (
                      <div>User automatically clocked out after 30 minutes of inactivity</div>
                    )}
                    {group.details?.resumed && (
                      <div className="status-badge resumed">Resumed</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SessionTimeline; 