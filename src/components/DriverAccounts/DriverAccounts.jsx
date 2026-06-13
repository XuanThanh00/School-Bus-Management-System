import React, { useState, useEffect } from 'react';
import { addDriver, listenToDrivers, deleteDriverRecord } from '../../services/driverService';
import { listenToBusStops } from '../../services/busStopService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import TableRowsIcon from '@mui/icons-material/TableRows';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import BadgeIcon from '@mui/icons-material/Badge';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import CloseIcon from '@mui/icons-material/Close';
import ImageIcon from '@mui/icons-material/Image';
import SaveIcon from '@mui/icons-material/Save';
import DriveEtaIcon from '@mui/icons-material/DriveEta';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import InfoIcon from '@mui/icons-material/Info';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import LockResetIcon from '@mui/icons-material/LockReset';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import './DriverAccounts.css';

const isValidVNDate = (val) => /^\d{2}\/\d{2}\/\d{4}$/.test(val);

const EMPTY_FORM = { driverId: '', name: '', dateOfBirth: '', phone: '', busStopIds: [] };

const DriverAccounts = () => {
  const { currentUser } = useAuth();

  const [tab, setTab] = useState('register');

  // Register form
  const [form, setForm] = useState(EMPTY_FORM);
  const [imageFile, setImageFile]       = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving]             = useState(false);

  // List
  const [drivers, setDrivers]         = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  // Detail modal
  const [selected, setSelected]           = useState(null);
  const [showPassword, setShowPassword]   = useState(false);

  // Bus stops
  const [busStops, setBusStops] = useState([]);

  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const unsub = listenToDrivers((data) => { setDrivers(data); setLoadingList(false); });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = listenToBusStops((data) => setBusStops(data));
    return unsub;
  }, []);

  const flash = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); };

  // ── Image handling ──────────────────────────────────────────────────────────
  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  // ── Submit register ──────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.driverId.trim())                          { setError('Mã tài xế là bắt buộc'); return; }
    if (!form.name.trim())                              { setError('Họ tên là bắt buộc'); return; }
    if (!form.dateOfBirth || !isValidVNDate(form.dateOfBirth)) { setError('Ngày sinh phải theo định dạng DD/MM/YYYY'); return; }
    if (!form.phone.trim())                             { setError('Số điện thoại là bắt buộc'); return; }
    if (!form.busStopIds || form.busStopIds.length === 0) { setError('Vui lòng chọn ít nhất một trạm xe'); return; }

    setSaving(true);
    try {
      let imageData = null;
      if (imageFile) {
        imageData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.readAsDataURL(imageFile);
        });
      }

      const busStopName = form.busStopIds
        .map((id) => {
          const s = busStops.find((x) => x.id === id);
          return s ? `${s.order ? `${s.order}. ` : ''}${s.name}${s.address ? ` — ${s.address}` : ''}` : '';
        })
        .filter(Boolean)
        .join('; ');
      await addDriver({ ...form, imageData, busStopName });
      if (currentUser) await addLog(currentUser.uid, `Thêm tài xế: ${form.name}`);
      flash('Đã thêm tài xế thành công');
      setForm(EMPTY_FORM);
      setImageFile(null);
      setImagePreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (driverId, name) => {
    if (!window.confirm(`Xóa tài khoản tài xế "${name}"?\n(Sẽ xóa cả tài khoản Firebase Auth)`)) return;
    try {
      await deleteDriverRecord(driverId);
      if (currentUser) await addLog(currentUser.uid, `Xóa tài xế: ${name}`);
      flash('Đã xóa tài xế');
      if (selected?.id === driverId) setSelected(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setImageFile(null);
    setImagePreview(null);
    setError('');
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <h2 className="page-title">Tài khoản tài xế</h2>
        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${tab === 'register' ? 'active' : ''}`}
            onClick={() => setTab('register')}
          >
            <PersonAddIcon /> Đăng ký
          </button>
          <button
            className={`view-toggle-btn ${tab === 'list' ? 'active' : ''}`}
            onClick={() => setTab('list')}
          >
            <TableRowsIcon /> Xem tài khoản
          </button>
        </div>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error   && <div className="alert alert-error">{error}</div>}

      {/* ═══════════════ REGISTER TAB ═══════════════ */}
      {tab === 'register' && (
        <form onSubmit={handleSubmit}>
          {/* Thông tin tài xế */}
          <div className="form-card">
            <div className="form-section-title">
              <DriveEtaIcon />
              THÔNG TIN TÀI XẾ
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Mã Tài Xế <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.driverId}
                  onChange={(e) => setForm({ ...form, driverId: e.target.value })}
                  placeholder="TX001"
                />
              </div>
              <div className="form-group">
                <label>Họ Tên <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Lê Thành Tài"
                />
              </div>
              <div className="form-group">
                <label>Ngày Tháng Năm Sinh <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                />
              </div>
              <div className="form-group">
                <label>SĐT <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0901234567"
                />
              </div>
            </div>
          </div>

          {/* Ảnh & Trạm xe */}
          <div className="form-card" style={{ marginTop: 0 }}>
            <div className="form-section-title">
              <DirectionsBusIcon />
              ẢNH & TRẠM XE
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Ảnh Tài Xế</label>
                <label className="image-upload-area" style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="preview"
                      style={{ width: 120, height: 120, borderRadius: 8, objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="upload-placeholder">
                      <ImageIcon />
                      <span>Chọn ảnh tài xế</span>
                    </div>
                  )}
                </label>
              </div>
              <div className="form-group">
                <label>
                  <DirectionsBusIcon style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }} />
                  Trạm Xe <span className="required">*</span>
                </label>
                {busStops.length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-light)', marginTop: 6 }}>
                    Chưa có trạm xe — vào <strong>Quản lý trạm xe</strong> để thêm trước.
                  </p>
                ) : (
                  <div className="bus-stop-checklist">
                    {busStops.map((s) => (
                      <label key={s.id} className="bus-stop-check-item">
                        <input
                          type="checkbox"
                          checked={form.busStopIds.includes(s.id)}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...form.busStopIds, s.id]
                              : form.busStopIds.filter((id) => id !== s.id);
                            setForm({ ...form, busStopIds: ids });
                          }}
                        />
                        <span>{s.order ? `${s.order}. ` : ''}{s.name}{s.address ? ` — ${s.address}` : ''}</span>
                      </label>
                    ))}
                  </div>
                )}
                {form.busStopIds.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {form.busStopIds.map((id) => {
                      const s = busStops.find((x) => x.id === id);
                      return s ? (
                        <span key={id} className="badge driver-stop-badge">
                          <LocationOnIcon style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 2 }} />
                          {s.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={resetForm}>Xóa Form</button>
            <button type="submit" className="btn btn-primary btn-submit-form" disabled={saving}>
              <SaveIcon style={{ fontSize: 18 }} />
              {saving ? 'Đang lưu...' : 'Thêm Tài Xế'}
            </button>
          </div>
        </form>
      )}

      {/* ═══════════════ LIST TAB ═══════════════ */}
      {tab === 'list' && (
        <>
          <h3 className="driver-list-heading">
            <DriveEtaIcon style={{ color: 'var(--primary)' }} />
            Danh Sách Tài Xế ({drivers.length})
          </h3>

          {loadingList ? (
            <div className="loading-state"><div className="spinner" /></div>
          ) : drivers.length === 0 ? (
            <div className="empty-state">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <DriveEtaIcon style={{ fontSize: 60, color: '#CBD5E1', marginBottom: 12 }} />
                <p>Chưa có tài xế nào được đăng ký</p>
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Ảnh</th>
                    <th>Họ Tên</th>
                    <th>Mã TX</th>
                    <th>SĐT</th>
                    <th>Ngày Sinh</th>
                    <th>Trạm Xe</th>
                    <th>Trạng Thái</th>
                    <th style={{ width: 100 }}>Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => {
                    const driverStops = (d.busStopIds?.length ? d.busStopIds : d.busStopId ? [d.busStopId] : [])
                      .map((id) => busStops.find((s) => s.id === id))
                      .filter(Boolean);
                    return (
                      <tr key={d.id} className="table-row">
                        <td>
                          {d.imageData ? (
                            <img
                              src={d.imageData}
                              alt={d.name}
                              style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div className="driver-avatar-fallback">
                              <BadgeIcon style={{ fontSize: 20, color: 'var(--primary)' }} />
                            </div>
                          )}
                        </td>
                        <td><strong>{d.name}</strong></td>
                        <td><span className="badge badge-gray">{d.driverId}</span></td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: 17 }}>
                            {d.phone}
                          </span>
                        </td>
                        <td className="text-muted-sm">{d.dateOfBirth || '—'}</td>
                        <td>
                          {driverStops.length > 0
                            ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {driverStops.map((s) => (
                                  <span key={s.id} className="badge driver-stop-badge">{s.name}</span>
                                ))}
                              </div>
                            : <span className="text-muted-sm">—</span>}
                        </td>
                        <td>
                          {d.hasAuth ? (
                            <span className="driver-auth-status active">
                              <CheckCircleIcon style={{ fontSize: 15 }} /> Đã kích hoạt
                            </span>
                          ) : (
                            <span className="driver-auth-status pending">
                              <PendingIcon style={{ fontSize: 15 }} /> Chưa kích hoạt
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => { setSelected(d); setShowPassword(false); }}
                              title="Chi tiết"
                            >
                              <InfoIcon style={{ fontSize: 15 }} />
                            </button>
                            <button
                              className="btn-icon-danger"
                              onClick={() => handleDelete(d.id, d.name)}
                              title="Xóa"
                            >
                              <DeleteOutlinedIcon style={{ fontSize: 18 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══════════════ DETAIL MODAL ═══════════════ */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DriveEtaIcon style={{ fontSize: 20 }} />
                Thông Tin Tài Xế
              </h3>
              <button className="modal-close" onClick={() => setSelected(null)}>
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 20, alignItems: 'center' }}>
              {selected.imageData ? (
                <img
                  src={selected.imageData}
                  alt={selected.name}
                  style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div className="driver-avatar-lg">
                  {selected.name?.charAt(0)?.toUpperCase() || 'T'}
                </div>
              )}
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{selected.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: 'var(--text-light)' }}>
                  <PhoneAndroidIcon style={{ fontSize: 14 }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 16 }}>{selected.phone}</span>
                </div>
              </div>
            </div>

            <div className="detail-grid" style={{ marginBottom: 20 }}>
              <div className="detail-item">
                <span className="detail-label">Mã Tài Xế</span>
                <span className="detail-value"><strong>{selected.driverId}</strong></span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Ngày Sinh</span>
                <span className="detail-value">{selected.dateOfBirth || '—'}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Trạm Xe</span>
                <span className="detail-value">
                  {(selected.busStopIds?.length ? selected.busStopIds : selected.busStopId ? [selected.busStopId] : [])
                    .map((id) => busStops.find((s) => s.id === id)?.name)
                    .filter(Boolean)
                    .join(', ') || '—'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Trạng Thái</span>
                {selected.hasAuth ? (
                  <span className="driver-auth-status active" style={{ fontSize: 13 }}>
                    <CheckCircleIcon style={{ fontSize: 15 }} /> Đã kích hoạt
                  </span>
                ) : (
                  <span className="driver-auth-status pending" style={{ fontSize: 13 }}>
                    <PendingIcon style={{ fontSize: 15 }} /> Chưa kích hoạt
                  </span>
                )}
              </div>
              <div className="detail-item">
                <span className="detail-label">Email đăng nhập</span>
                <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {selected.email}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Mật khẩu</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', letterSpacing: showPassword ? 0 : 3 }}>
                    {showPassword ? (selected.defaultPassword || '123456') : '••••••'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ padding: '2px 8px' }}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword
                      ? <VisibilityOffIcon style={{ fontSize: 15 }} />
                      : <VisibilityIcon   style={{ fontSize: 15 }} />}
                  </button>
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Ngày tạo</span>
                <span className="detail-value">
                  {selected.createdAt?.toDate
                    ? selected.createdAt.toDate().toLocaleDateString('vi-VN')
                    : '—'}
                </span>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 8 }}>
              <button
                className="btn btn-danger"
                onClick={() => handleDelete(selected.id, selected.name)}
              >
                <DeleteOutlinedIcon style={{ fontSize: 16 }} />
                Xóa Tài Khoản
              </button>
              <button className="btn btn-outline" onClick={() => setSelected(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverAccounts;
