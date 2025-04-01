import React from 'react';
import '../styles/home.css';

function Home() {
  return (
    <div className="home-page">
      <div className="content-card">
        <h1>Welcome to Time Architect Admin</h1>
        <p className="welcome-text">
          Time Architect is a comprehensive time tracking solution that helps you manage employee work sessions,
          breaks, and payable hours efficiently. Use the navigation above to:
        </p>
        <ul className="feature-list">
          <li>
            <strong>Sessions:</strong> View and manage employee work sessions, including start times, end times,
            breaks, and payable hours.
          </li>
          <li>
            <strong>Settings:</strong> Configure system-wide settings such as server sync intervals and other
            parameters.
          </li>
        </ul>
        <div className="quick-stats">
          <p>
            For technical support or feature requests, please contact your system administrator.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Home; 