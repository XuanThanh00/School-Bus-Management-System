import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { logoutUser } from '../../services/authService';
import { addLog } from '../../services/logService';

const Sidebar = ({ activeView, setActiveView }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const handleLogout = async () => {
    try {
      if (currentUser) {
        await addLog(currentUser.uid, 'Đăng xuất');
      }
      await logoutUser();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>📚 Quản Lý Học Sinh</h2>
        <p className="user-email">{currentUser?.email}</p>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-btn ${activeView === 'list' ? 'active' : ''}`}
          onClick={() => setActiveView('list')}
        >
          📋 Danh Sách Học Sinh
        </button>

        <button
          className={`nav-btn ${activeView === 'form' ? 'active' : ''}`}
          onClick={() => setActiveView('form')}
        >
          ➕ Thêm Học Sinh
        </button>

        <button
          className={`nav-btn ${activeView === 'map' ? 'active' : ''}`}
          onClick={() => setActiveView('map')}
        >
          🗺️ Xem Bản Đồ
        </button>
      </nav>

      <button className="logout-btn" onClick={handleLogout}>
        🚪 Đăng Xuất
      </button>
    </aside>
  );
};

export default Sidebar;
