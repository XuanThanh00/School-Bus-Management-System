import React, { useState, useEffect } from 'react';
import {
  listenToBusStops, addBusStop, updateBusStop, deleteBusStop,
} from '../../services/busStopService';
import {
  listenToSchoolConfig, updateSchoolConfig, DEFAULT_SCHOOL,
} from '../../services/schoolConfigService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import AddLocationIcon from '@mui/icons-material/AddLocation';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import InfoIcon from '@mui/icons-material/Info';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import SchoolIcon from '@mui/icons-material/School';
import SettingsIcon from '@mui/icons-material/Settings';
import './BusStops.css';

const EMPTY_FORM = { name: '', address: '', order: '' };
const EMPTY_SCHOOL_FORM = { name: '', address: '' };

const geocodeAddress = async (address) => {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=vn`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'vi', 'User-Agent': 'BusAttend-Admin/1.0' } });
  if (!res.ok) throw new Error('Lỗi kết nối geocoding');
  const data = await res.json();
  if (!data.length) throw new Error(`Không tìm thấy địa chỉ: "${address}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
};

const BusStops = () => {
  const { currentUser } = useAuth();
  const [stops, setStops]                       = useState([]);
  const [school, setSchool]                     = useState(DEFAULT_SCHOOL);
  const [loading, setLoading]                   = useState(true);

  // Stop form
  const [showForm, setShowForm]                 = useState(false);
  const [editingId, setEditingId]               = useState(null);
  const [form, setForm]                         = useState(EMPTY_FORM);
  const [saving, setSaving]                     = useState(false);
  const [geocoding, setGeocoding]               = useState(false);
  const [geocodedCoords, setGeocodedCoords]     = useState(null);

  // School edit form
  const [showSchoolForm, setShowSchoolForm]     = useState(false);
  const [schoolForm, setSchoolForm]             = useState(EMPTY_SCHOOL_FORM);
  const [schoolGeocoding, setSchoolGeocoding]   = useState(false);
  const [schoolCoords, setSchoolCoords]         = useState(null);
  const [savingSchool, setSavingSchool]         = useState(false);

  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const unsubStops   = listenToBusStops((data) => { setStops(data); setLoading(false); });
    const unsubSchool  = listenToSchoolConfig(setSchool);
    return () => { unsubStops(); unsubSchool(); };
  }, []);

  // ── Stop form handlers ──────────────────────────────────────

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, order: stops.length + 1 });
    setEditingId(null);
    setGeocodedCoords(null);
    setShowForm(true);
    setError('');
  };

  const openEdit = (stop) => {
    setForm({ name: stop.name || '', address: stop.address || '', order: stop.order || '' });
    setEditingId(stop.id);
    setGeocodedCoords(stop.location || null);
    setShowForm(true);
    setError('');
  };

  const handleAddressBlur = async () => {
    if (!form.address.trim() || geocodedCoords) return;
    setGeocoding(true);
    try {
      setGeocodedCoords(await geocodeAddress(form.address.trim()));
    } catch (_) { /* retry on submit */ } finally { setGeocoding(false); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) { setError('Tên trạm và địa chỉ là bắt buộc'); return; }
    setSaving(true); setError('');
    try {
      let location = geocodedCoords;
      if (!location) {
        setGeocoding(true);
        location = await geocodeAddress(form.address.trim());
        setGeocodedCoords(location);
        setGeocoding(false);
      }
      const data = { name: form.name.trim(), address: form.address.trim(), order: Number(form.order) || 1, location };
      if (editingId) {
        await updateBusStop(editingId, data);
        flash('Cập nhật trạm thành công');
        if (currentUser) await addLog(currentUser.uid, `Sửa trạm: ${data.name}`);
      } else {
        await addBusStop(data);
        flash('Thêm trạm thành công');
        if (currentUser) await addLog(currentUser.uid, `Thêm trạm: ${data.name}`);
      }
      setShowForm(false); setForm(EMPTY_FORM); setEditingId(null); setGeocodedCoords(null);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); setGeocoding(false); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Xóa trạm "${name}"?`)) return;
    try {
      await deleteBusStop(id);
      if (currentUser) await addLog(currentUser.uid, `Xóa trạm: ${name}`);
      flash('Đã xóa trạm');
    } catch (err) { setError(err.message); }
  };

  // ── School location handlers ──────────────────────────────────

  const openSchoolEdit = () => {
    setSchoolForm({ name: school.name, address: school.address });
    setSchoolCoords({ lat: school.lat, lng: school.lng });
    setShowSchoolForm(true);
    setError('');
  };

  const handleSchoolAddressBlur = async () => {
    if (!schoolForm.address.trim()) return;
    setSchoolGeocoding(true);
    try {
      const coords = await geocodeAddress(schoolForm.address.trim());
      setSchoolCoords(coords);
    } catch (_) { /* retry on submit */ } finally { setSchoolGeocoding(false); }
  };

  const handleSaveSchool = async (e) => {
    e.preventDefault();
    if (!schoolForm.name.trim() || !schoolForm.address.trim()) {
      setError('Tên và địa chỉ trường là bắt buộc');
      return;
    }
    setSavingSchool(true); setError('');
    try {
      let coords = schoolCoords;
      if (!coords || (coords.lat === school.lat && coords.lng === school.lng && schoolForm.address !== school.address)) {
        setSchoolGeocoding(true);
        coords = await geocodeAddress(schoolForm.address.trim());
        setSchoolCoords(coords);
        setSchoolGeocoding(false);
      }
      await updateSchoolConfig({
        name: schoolForm.name.trim(),
        address: schoolForm.address.trim(),
        lat: coords.lat,
        lng: coords.lng,
      });
      if (currentUser) await addLog(currentUser.uid, `Cập nhật vị trí trường: ${schoolForm.name}`);
      flash('Đã cập nhật vị trí trường học');
      setShowSchoolForm(false);
    } catch (err) { setError(err.message); }
    finally { setSavingSchool(false); setSchoolGeocoding(false); }
  };

  const flash = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  if (loading) {
    return <div className="page-container"><div className="loading-state"><div className="spinner" /><p>Đang tải...</p></div></div>;
  }

  return (
    <div className="page-container busstops-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Quản Lý Trạm Xe Buýt</h2>
          <p className="page-subtitle">Nhập địa chỉ — hệ thống tự động lấy tọa độ GPS và vẽ tuyến đường</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <AddLocationIcon style={{ fontSize: 18 }} />
          Thêm Trạm
        </button>
      </div>

      {/* School location bar */}
      <div className="school-location-bar">
        <SchoolIcon style={{ fontSize: 18, color: 'var(--primary)' }} />
        <div style={{ flex: 1 }}>
          <strong>{school.name}</strong>
          <span style={{ marginLeft: 8, color: 'var(--text-light)' }}>{school.address}</span>
        </div>
        <span className="coord-display">
          <LocationOnIcon />
          {school.lat.toFixed(4)}, {school.lng.toFixed(4)}
        </span>
        <button className="btn btn-sm btn-outline" onClick={openSchoolEdit} style={{ marginLeft: 8 }}>
          <SettingsIcon style={{ fontSize: 15 }} />
          Đổi vị trí trường
        </button>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error   && <div className="alert alert-error">{error}</div>}

      {/* ── School Edit Modal ── */}
      {showSchoolForm && (
        <div className="modal-overlay" onClick={() => setShowSchoolForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <SchoolIcon style={{ fontSize: 18, marginRight: 8, verticalAlign: 'middle' }} />
                Cập Nhật Vị Trí Trường Học
              </h3>
              <button className="modal-close" onClick={() => setShowSchoolForm(false)}>
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>
            <form onSubmit={handleSaveSchool}>
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group">
                <label>Tên Trường <span className="required">*</span></label>
                <input
                  type="text"
                  value={schoolForm.name}
                  onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })}
                  placeholder="Trường THPT Nguyễn Trãi"
                  required
                />
              </div>
              <div className="form-group">
                <label>Địa Chỉ <span className="required">*</span></label>
                <input
                  type="text"
                  value={schoolForm.address}
                  onChange={(e) => {
                    setSchoolForm({ ...schoolForm, address: e.target.value });
                    setSchoolCoords(null);
                  }}
                  onBlur={handleSchoolAddressBlur}
                  placeholder="Số 1 Đường Nguyễn Trãi, Quận 1, TP.HCM"
                  required
                />
                {schoolGeocoding && (
                  <div className="geocode-status geocoding">
                    <div className="spinner-sm" />
                    Đang tìm tọa độ GPS...
                  </div>
                )}
                {schoolCoords && !schoolGeocoding && (
                  <div className="geocode-status geocoded">
                    <MyLocationIcon style={{ fontSize: 15 }} />
                    GPS: {schoolCoords.lat.toFixed(5)}, {schoolCoords.lng.toFixed(5)}
                  </div>
                )}
              </div>
              <div className="info-box info-box-blue" style={{ marginBottom: 16 }}>
                <InfoIcon style={{ fontSize: 16, color: 'var(--primary)', flexShrink: 0 }} />
                <p style={{ fontSize: 14, margin: 0 }}>
                  Khi GPS xe trùng với vị trí trường (trong bán kính 150m), hệ thống tự động đánh dấu học sinh "Đã đến trường".
                </p>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowSchoolForm(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={savingSchool || schoolGeocoding}>
                  <SaveIcon style={{ fontSize: 17 }} />
                  {savingSchool ? 'Đang lưu...' : schoolGeocoding ? 'Đang định vị...' : 'Lưu Vị Trí Trường'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Stop Add/Edit Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingId ? 'Sửa Trạm' : 'Thêm Trạm Mới'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              {error && <div className="alert alert-error">{error}</div>}
              <div className="form-group">
                <label>Tên Trạm <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Trạm 1 – Cổng Trường"
                  required
                />
              </div>
              <div className="form-group">
                <label>Địa Chỉ <span className="required">*</span></label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => { setForm({ ...form, address: e.target.value }); setGeocodedCoords(null); }}
                  onBlur={handleAddressBlur}
                  placeholder="123 Đường Lê Lợi, Quận 1, TP.HCM"
                  required
                />
                {geocoding && (
                  <div className="geocode-status geocoding">
                    <div className="spinner-sm" />
                    Đang tìm tọa độ GPS...
                  </div>
                )}
                {geocodedCoords && !geocoding && (
                  <div className="geocode-status geocoded">
                    <MyLocationIcon style={{ fontSize: 15 }} />
                    GPS: {geocodedCoords.lat.toFixed(5)}, {geocodedCoords.lng.toFixed(5)}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Thứ Tự Trạm</label>
                <input type="number" min={1} value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })} placeholder="1" />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving || geocoding}>
                  <SaveIcon style={{ fontSize: 17 }} />
                  {saving ? 'Đang lưu...' : geocoding ? 'Đang định vị...' : editingId ? 'Cập Nhật' : 'Thêm Trạm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Stops Table ── */}
      {stops.length === 0 ? (
        <div className="empty-state">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <DirectionsBusIcon style={{ fontSize: 64, color: '#CBD5E1', marginBottom: 12 }} />
            <p>Chưa có trạm nào — nhấn "Thêm Trạm" để bắt đầu</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>STT</th>
                <th>Tên Trạm</th>
                <th>Địa Chỉ</th>
                <th>Tọa Độ GPS</th>
                <th style={{ width: 110 }}>Hành Động</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((stop) => (
                <tr key={stop.id} className="table-row">
                  <td><span className="stop-order-badge">{stop.order}</span></td>
                  <td><div className="stop-name">{stop.name}</div></td>
                  <td><span className="stop-address">{stop.address}</span></td>
                  <td>
                    {stop.location ? (
                      <span className="coord-display">
                        <LocationOnIcon />
                        {stop.location.lat?.toFixed(4)}, {stop.location.lng?.toFixed(4)}
                      </span>
                    ) : (
                      <span className="geocode-pending">
                        <MyLocationIcon style={{ fontSize: 14 }} />
                        Chưa có tọa độ
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="action-btns">
                      <button className="btn-icon" onClick={() => openEdit(stop)} title="Sửa">
                        <EditIcon style={{ fontSize: 17 }} />
                      </button>
                      <button className="btn-icon-danger" onClick={() => handleDelete(stop.id, stop.name)} title="Xóa">
                        <DeleteOutlinedIcon style={{ fontSize: 17 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="info-box info-box-blue" style={{ marginTop: 20 }}>
        <div className="busstops-info-box">
          <InfoIcon />
          <p>
            <strong>Tự động định vị:</strong> Chỉ cần nhập địa chỉ, hệ thống tự lấy tọa độ GPS.
            Tuyến đường tự cập nhật trên bản đồ theo thứ tự trạm.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BusStops;
