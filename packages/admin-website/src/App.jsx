import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import Home from './pages/Home';
import Sessions from './pages/Sessions';
import Settings from './pages/Settings';
import 'react-toastify/dist/ReactToastify.css';
import './styles/index.css';
import './styles/sessions.css';
import './styles/settings.css';
import './styles/home.css';

function App() {
  return (
    <Router>
      <div className="admin-app">
        <nav className="admin-nav">
          <div className="nav-brand">Time Architect</div>
          <ul className="nav-links">
            <li>
              <NavLink to="/" end>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to="/sessions">
                Sessions
              </NavLink>
            </li>
            <li>
              <NavLink to="/settings">
                Settings
              </NavLink>
            </li>
          </ul>
        </nav>
        <main className="admin-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
        <ToastContainer 
          position="bottom-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored"
        />
      </div>
    </Router>
  );
}

export default App; 