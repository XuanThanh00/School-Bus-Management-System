import React, { useState, useEffect } from 'react';
import { listenToParents, deleteParentRecord, resetParentPassword } from '../../services/authService';
import { getStudentsByIds } from '../../services/studentService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import InfoIcon from '@mui/icons-material/Info';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CloseIcon from '@mui/icons-material/Close';
import BadgeIcon from '@mui/icons-material/Badge';
import SchoolIcon from '@mui/icons-material/School';
import LockResetIcon from '@mui/icons-material/LockReset';
import './ParentAccounts.css';

const ParentAccounts = () => {
  const { currentUser } = useAuth();
  const [parents, setParents] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedParent, setSelectedParent] = useState(null);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetResult, setResetResult] = useState(null); // { authUpdated, error }

  useEffect(() => {
    const unsub = listenToParents((data) => {
      setParents(data);
      setLoadingList(false);
    });
    return unsub;
  }, []);

  const openDetail = async (parent) => {
    setSelectedParent(parent);
    setShowPassword(false);
    setNewPassword('');
    setResetResult(null);
    setStudents([]);
    if (parent.studentIds?.length) {
      setLoadingStudents(true);
      try {
        const data = await getStudentsByIds(parent.studentIds);
        setStudents(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingStudents(false);
      }
    }
  };

  const closeDetail = () => { setSelectedParent(null); setStudents([]); setResetResult(null); };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) return;
    setResetting(true);
    setResetResult(null);
    try {
      const { authUpdated } = await resetParentPassword(
        selectedParent.phone,
        selectedParent.defaultPassword || '123456',
        newPassword,
      );
      if (currentUser) await addLog(currentUser.uid, `Đặt lại mật khẩu phụ huynh: ${selectedParent.displayName}`);
      setSelectedParent((p) => ({ ...p, defaultPassword: newPassword }));
      setResetResult({ authUpdated });
      setNewPassword('');
    } catch (e) {
      setResetResult({ error: e.message });
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (parentId, name) => {
    if (!window.confirm(`Xóa tài khoản của "${name}"? (Chỉ xóa dữ liệu, không xóa Firebase Auth)`)) return;
    try {
      await deleteParentRecord(parentId);
      if (currentUser) await addLog(currentUser.uid, `Xóa tài khoản phụ huynh: ${name}`);
      flash('Đã xóa tài khoản');
      closeDetail();
    } catch (err) {
      setError(err.message);
    }
  };

  const flash = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 5000);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Tài Khoản Phụ Huynh</h2>
          <p className="page-subtitle">Quản lý tài khoản phụ huynh đăng nhập trên mobile app</p>
        </div>
      </div>

      <div className="info-box info-box-blue" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <InfoIcon style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4>Hướng Dẫn Đăng Nhập App</h4>
            <p>
              Phụ huynh dùng <strong>Số điện thoại</strong> + <strong>Mật khẩu mặc định 123456</strong> để đăng nhập BusAttend mobile app.
              Tài khoản được tự động tạo khi thêm học sinh có SĐT phụ huynh.
            </p>
          </div>
        </div>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <h3 style={{ marginBottom: 16, color: 'var(--text)', fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
        <FamilyRestroomIcon style={{ color: 'var(--primary)' }} />
        Danh Sách Phụ Huynh ({parents.length})
      </h3>

      {loadingList ? (
        <div className="loading-state"><div className="spinner" /></div>
      ) : parents.length === 0 ? (
        <div className="empty-state">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <FamilyRestroomIcon style={{ fontSize: 60, color: '#CBD5E1', marginBottom: 12 }} />
            <p>Chưa có tài khoản phụ huynh nào</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {parents.map((p) => (
            <div key={p.id} className="parent-card">
              <div className="parent-avatar">
                {p.displayName?.charAt(0)?.toUpperCase() || 'P'}
              </div>

              <div className="parent-info">
                <div className="parent-name">{p.displayName}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <PhoneAndroidIcon style={{ fontSize: 13, color: 'var(--text-light)' }} />
                  <span className="parent-phone">{p.phone}</span>
                </div>
                {p.studentIds?.length > 0 && (
                  <div className="student-chips">
                    {p.studentIds.map((id) => (
                      <span key={id} className="student-chip">{id}</span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                {p.hasAuth !== false ? (
                  <span className="auth-status active">
                    <CheckCircleIcon />
                    Đã kích hoạt
                  </span>
                ) : (
                  <span className="auth-status pending">
                    <PendingIcon />
                    Chưa kích hoạt
                  </span>
                )}
              </div>

              <div className="text-muted-sm" style={{ minWidth: 80, textAlign: 'right' }}>
                {p.createdAt?.toDate
                  ? p.createdAt.toDate().toLocaleDateString('vi-VN')
                  : '—'}
              </div>

              <button
                className="btn btn-sm btn-outline"
                onClick={() => openDetail(p)}
                style={{ whiteSpace: 'nowrap' }}
              >
                <InfoIcon style={{ fontSize: 15 }} />
                Chi Tiết
              </button>

              <button
                className="btn-icon-danger"
                onClick={() => handleDelete(p.id, p.displayName)}
                title="Xóa"
              >
                <DeleteOutlinedIcon style={{ fontSize: 18 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedParent && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FamilyRestroomIcon style={{ fontSize: 20 }} />
                Thông Tin Phụ Huynh
              </h3>
              <button className="modal-close" onClick={closeDetail}>
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>

            <div className="detail-grid" style={{ marginBottom: 24 }}>
              <div className="detail-item">
                <span className="detail-label">Họ tên</span>
                <span className="detail-value"><strong>{selectedParent.displayName}</strong></span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Số điện thoại</span>
                <span className="detail-value" style={{ fontFamily: 'monospace' }}>{selectedParent.phone}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Email đăng nhập</span>
                <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {selectedParent.email || `${selectedParent.phone}@busattend.app`}
                </span>
              </div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <span className="detail-label">Mật khẩu</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Current password display */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', letterSpacing: showPassword ? 0 : 3 }}>
                      {showPassword ? (selectedParent.defaultPassword || '123456') : '••••••'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      style={{ padding: '2px 8px' }}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <VisibilityOffIcon style={{ fontSize: 15 }} /> : <VisibilityIcon style={{ fontSize: 15 }} />}
                    </button>
                  </span>

                  {/* Reset password input */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: 240 }}>
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
                        style={{ width: '100%', paddingRight: 36, fontFamily: 'monospace' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}
                      >
                        {showNewPassword ? <VisibilityOffIcon style={{ fontSize: 15 }} /> : <VisibilityIcon style={{ fontSize: 15 }} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleResetPassword}
                      disabled={resetting || newPassword.length < 6}
                    >
                      <LockResetIcon style={{ fontSize: 15 }} />
                      {resetting ? 'Đang đặt lại...' : 'Đặt lại'}
                    </button>
                  </div>

                  {/* Result feedback */}
                  {resetResult && !resetResult.error && (
                    <div style={{ fontSize: 13, color: resetResult.authUpdated ? 'var(--success)' : 'var(--warning)' }}>
                      {resetResult.authUpdated
                        ? 'Đã đổi mật khẩu trên cả Firebase Auth và Firestore.'
                        : 'Đã lưu mật khẩu mới vào Firestore. Lưu ý: phụ huynh đã tự đổi mật khẩu trên app nên Firebase Auth chưa được cập nhật — yêu cầu phụ huynh đổi lại trong app.'}
                    </div>
                  )}
                  {resetResult?.error && (
                    <div style={{ fontSize: 13, color: 'var(--danger)' }}>{resetResult.error}</div>
                  )}
                </div>
              </div>
              <div className="detail-item">
                <span className="detail-label">Trạng thái</span>
                {selectedParent.hasAuth !== false ? (
                  <span className="auth-status active" style={{ fontSize: 13 }}>
                    <CheckCircleIcon style={{ fontSize: 15 }} /> Đã kích hoạt
                  </span>
                ) : (
                  <span className="auth-status pending" style={{ fontSize: 13 }}>
                    <PendingIcon style={{ fontSize: 15 }} /> Chưa kích hoạt
                  </span>
                )}
              </div>
              <div className="detail-item">
                <span className="detail-label">Ngày tạo</span>
                <span className="detail-value">
                  {selectedParent.createdAt?.toDate
                    ? selectedParent.createdAt.toDate().toLocaleDateString('vi-VN')
                    : '—'}
                </span>
              </div>
            </div>

            <div>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, color: 'var(--primary)' }}>
                <SchoolIcon style={{ fontSize: 18 }} />
                Học Sinh ({selectedParent.studentIds?.length || 0})
              </h4>

              {loadingStudents ? (
                <div style={{ padding: '20px 0', textAlign: 'center' }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </div>
              ) : students.length === 0 ? (
                <div style={{ color: 'var(--text-light)', fontSize: 14, padding: '12px 0' }}>
                  Chưa có học sinh nào được liên kết
                </div>
              ) : (
                <div className="table-wrapper" style={{ margin: 0 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 52 }}>Ảnh</th>
                        <th>Họ Tên</th>
                        <th>Mã HS</th>
                        <th>Lớp</th>
                        <th>Ngày Sinh</th>
                        <th>Trạng Thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id} className="table-row">
                          <td>
                            {s.imageData ? (
                              <img
                                src={s.imageData}
                                alt={s.name}
                                style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }}
                              />
                            ) : (
                              <div style={{
                                width: 38, height: 38, borderRadius: '50%',
                                background: 'var(--primary-pale)', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                              }}>
                                <BadgeIcon style={{ fontSize: 18, color: 'var(--primary)' }} />
                              </div>
                            )}
                          </td>
                          <td><strong>{s.name}</strong></td>
                          <td><span className="badge badge-gray">{s.studentId}</span></td>
                          <td><span className="badge badge-purple">{s.class}</span></td>
                          <td className="text-muted-sm">{s.dateOfBirth || '—'}</td>
                          <td>
                            <span className={`badge ${s.status ? 'badge-green' : 'badge-gray'}`}>
                              {s.status ? 'Đang trên xe' : 'Không trên xe'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(selectedParent.id, selectedParent.displayName)}
              >
                <DeleteOutlinedIcon style={{ fontSize: 16 }} />
                Xóa Tài Khoản
              </button>
              <button className="btn btn-outline" onClick={closeDetail}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ParentAccounts;
