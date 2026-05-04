import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { logoutUser } from '../../services/authService';
import { addLog } from '../../services/logService';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import MapIcon from '@mui/icons-material/Map';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import EventNoteIcon from '@mui/icons-material/EventNote';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import LogoutIcon from '@mui/icons-material/Logout';
import './Sidebar.css';

/**
 * NAV_ITEMS
 * Ordered list of navigation entries. Each entry maps a view key to its
 * MUI icon and Vietnamese display label. Reorder or extend here to update the menu.
 */
const NAV_ITEMS = [
  { key: 'list',          icon: <PeopleAltIcon />,       label: 'Danh sách học sinh' },
  { key: 'form',          icon: <PersonAddIcon />,        label: 'Thêm học sinh' },
  { key: 'map',           icon: <MapIcon />,              label: 'Bản đồ' },
  { key: 'busstops',      icon: <DirectionsBusIcon />,    label: 'Quản lý trạm xe' },
  { key: 'leaverequests', icon: <EventNoteIcon />,        label: 'Đơn xin nghỉ học' },
  { key: 'parents',       icon: <FamilyRestroomIcon />,   label: 'Tài khoản phụ huynh' },
  { key: 'gpsdemo',       icon: <GpsFixedIcon />,         label: 'Demo GPS' },
];

/**
 * Sidebar
 * Persistent left-hand navigation panel.
 * Renders the app brand, current user info, nav menu, and logout control.
 *
 * Props:
 *   activeView    {string}    — key of the currently visible view
 *   setActiveView {Function}  — callback to switch the active view
 */
const Sidebar = ({ activeView, setActiveView }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  /**
   * handleLogout
   * Writes an audit log entry, signs the user out via the auth service,
   * then redirects to /login.
   */
  const handleLogout = async () => {
    try {
      if (currentUser) await addLog(currentUser.uid, 'Đăng xuất');
      await logoutUser();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  /**
   * initials
   * Single uppercase character from the user's email, used as the avatar fallback.
   */
  const initials = currentUser?.email?.charAt(0).toUpperCase() || 'A';

  return (
    <aside className="sidebar">

      {/* Brand */}
      <div className="sidebar-brand">
        <div className="brand-icon">
          <DirectionsBusIcon />
        </div>
        <div>
          <h2 className="brand-name">BusAttend</h2>
          <p className="brand-sub">Quản Trị Viên</p>
        </div>
      </div>

      {/* Current user */}
      <div className="sidebar-user">
        <div className="user-avatar">{initials}</div>
        <div className="user-info">
          <p className="user-name">{currentUser?.displayName || 'Admin'}</p>
          <p className="user-email">{currentUser?.email}</p>
        </div>
      </div>

      {/* Primary navigation */}
      <nav className="sidebar-nav">
        <p className="nav-section-label">Menu</p>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`nav-btn ${activeView === item.key ? 'active' : ''}`}
            onClick={() => setActiveView(item.key)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {activeView === item.key && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>

      {/* Logout */}
      <div className="sidebar-footer">
        <button className="logout-btn" onClick={handleLogout}>
          <LogoutIcon style={{ fontSize: 17 }} />
          <span>Đăng Xuất</span>
        </button>
      </div>

    </aside>
  );
};

export default Sidebar;
