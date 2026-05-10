import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  listenToBusStops, addBusStop, updateBusStop, deleteBusStop,
} from '../../services/busStopService';
import {
  listenToSchoolConfig, updateSchoolConfig, DEFAULT_SCHOOL,
} from '../../services/schoolConfigService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import TableRowsIcon from '@mui/icons-material/TableRows';
import MapIcon from '@mui/icons-material/Map';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import SchoolIcon from '@mui/icons-material/School';
import SettingsIcon from '@mui/icons-material/Settings';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import './BusStops.css';

const svgDataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const stopIcon = new L.Icon({
  iconUrl: svgDataUrl(`<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.82 0 0 5.82 0 13c0 8.67 13 21 13 21S26 21.67 26 13C26 5.82 20.18 0 13 0z" fill="#0052CC"/><circle cx="13" cy="13" r="5.5" fill="white"/></svg>`),
  iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -34],
});

const pendingIcon = new L.Icon({
  iconUrl: svgDataUrl(`<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.82 0 0 5.82 0 13c0 8.67 13 21 13 21S26 21.67 26 13C26 5.82 20.18 0 13 0z" fill="#F59E0B"/><circle cx="13" cy="13" r="5.5" fill="white"/></svg>`),
  iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -34],
});

const schoolIcon = new L.Icon({
  iconUrl: svgDataUrl(`<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="15" r="13" fill="#10B981" stroke="white" stroke-width="2.5"/><text x="15" y="20" text-anchor="middle" font-size="13" fill="white" font-family="Arial" font-weight="bold">S</text></svg>`),
  iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30],
});

const geocodeAddress = async (address) => {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=vn`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'vi', 'User-Agent': 'BusAttend-Admin/1.0' } });
  if (!res.ok) throw new Error('Lỗi kết nối geocoding');
  const data = await res.json();
  if (!data.length) throw new Error(`Không tìm thấy địa chỉ: "${address}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
};

const MapClickHandler = ({ onMapClick }) => {
  useMapEvents({ click: (e) => onMapClick(e.latlng) });
  return null;
};

const BusStops = () => {
  const { currentUser } = useAuth();
  const [stops, setStops]   = useState([]);
  const [school, setSchool] = useState(DEFAULT_SCHOOL);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState('table');

  // Map pin add
  const [pendingPin, setPendingPin] = useState(null);
  const [pinForm, setPinForm]       = useState({ name: '', address: '', order: '' });
  const [savingPin, setSavingPin]   = useState(false);

  // Edit modal
  const [editingStop, setEditingStop] = useState(null);
  const [editForm, setEditForm]       = useState({ name: '', address: '', order: '' });
  const [savingEdit, setSavingEdit]   = useState(false);

  // School form
  const [showSchoolForm, setShowSchoolForm]   = useState(false);
  const [schoolForm, setSchoolForm]           = useState({ name: '', address: '' });
  const [schoolGeocoding, setSchoolGeocoding] = useState(false);
  const [schoolCoords, setSchoolCoords]       = useState(null);
  const [savingSchool, setSavingSchool]       = useState(false);

  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const unsubStops  = listenToBusStops((data) => { setStops(data); setLoading(false); });
    const unsubSchool = listenToSchoolConfig(setSchool);
    return () => { unsubStops(); unsubSchool(); };
  }, []);

  const flash = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  // ── Map pin handlers ────────────────────────────────────────
  const handleMapClick = ({ lat, lng }) => {
    setPendingPin({ lat, lng });
    setPinForm((f) => ({ ...f, order: String(stops.length + 1) }));
    setError('');
  };

  const handleSavePin = async (e) => {
    e.preventDefault();
    if (!pinForm.name.trim()) { setError('Vui lòng nhập tên trạm'); return; }
    setSavingPin(true); setError('');
    try {
      await addBusStop({
        name: pinForm.name.trim(),
        address: pinForm.address.trim(),
        order: Number(pinForm.order) || stops.length + 1,
        location: pendingPin,
      });
      if (currentUser) await addLog(currentUser.uid, `Thêm trạm: ${pinForm.name.trim()}`);
      flash('Thêm trạm thành công');
      setPendingPin(null);
      setPinForm({ name: '', address: '', order: '' });
    } catch (err) { setError(err.message); }
    finally { setSavingPin(false); }
  };

  // ── Edit handlers ───────────────────────────────────────────
  const openEdit = (stop) => {
    setEditingStop(stop);
    setEditForm({ name: stop.name || '', address: stop.address || '', order: stop.order || '' });
    setError('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) { setError('Tên trạm là bắt buộc'); return; }
    setSavingEdit(true); setError('');
    try {
      await updateBusStop(editingStop.id, {
        name: editForm.name.trim(),
        address: editForm.address.trim(),
        order: Number(editForm.order) || editingStop.order,
        location: editingStop.location,
      });
      if (currentUser) await addLog(currentUser.uid, `Sửa trạm: ${editForm.name.trim()}`);
      flash('Cập nhật trạm thành công');
      setEditingStop(null);
    } catch (err) { setError(err.message); }
    finally { setSavingEdit(false); }
  };

  // ── Delete ──────────────────────────────────────────────────
  const handleDelete = async (id, name) => {
    if (!window.confirm(`Xóa trạm "${name}"?`)) return;
    try {
      await deleteBusStop(id);
      if (currentUser) await addLog(currentUser.uid, `Xóa trạm: ${name}`);
      flash('Đã xóa trạm');
    } catch (err) { setError(err.message); }
  };

  // ── School handlers ─────────────────────────────────────────
  const openSchoolEdit = () => {
    setSchoolForm({ name: school.name, address: school.address });
    setSchoolCoords({ lat: school.lat, lng: school.lng });
    setShowSchoolForm(true); setError('');
  };

  const handleSchoolAddressBlur = async () => {
    if (!schoolForm.address.trim()) return;
    setSchoolGeocoding(true);
    try { setSchoolCoords(await geocodeAddress(schoolForm.address.trim())); }
    catch (_) { } finally { setSchoolGeocoding(false); }
  };

  const handleSaveSchool = async (e) => {
    e.preventDefault();
    if (!schoolForm.name.trim() || !schoolForm.address.trim()) { setError('Tên và địa chỉ trường là bắt buộc'); return; }
    setSavingSchool(true); setError('');
    try {
      let coords = schoolCoords;
      if (!coords || (coords.lat === school.lat && coords.lng === school.lng && schoolForm.address !== school.address)) {
        setSchoolGeocoding(true);
        coords = await geocodeAddress(schoolForm.address.trim());
        setSchoolCoords(coords); setSchoolGeocoding(false);
      }
      await updateSchoolConfig({ name: schoolForm.name.trim(), address: schoolForm.address.trim(), lat: coords.lat, lng: coords.lng });
      if (currentUser) await addLog(currentUser.uid, `Cập nhật vị trí trường: ${schoolForm.name}`);
      flash('Đã cập nhật vị trí trường học'); setShowSchoolForm(false);
    } catch (err) { setError(err.message); }
    finally { setSavingSchool(false); setSchoolGeocoding(false); }
  };

  if (loading) {
    return <div className="page-container"><div className="loading-state"><div className="spinner" /><p>Đang tải...</p></div></div>;
  }

  return (
    <>
      {/* ── MAP VIEW — Full-screen overlay ── */}
      {viewMode === 'map' && (
        <div className="map-fullscreen-overlay">
          <div className="map-fullscreen-header">
            <MapIcon style={{ fontSize: 24, color: 'rgba(255,255,255,.9)' }} />
            <span className="map-fullscreen-title">Bản đồ trạm xe</span>
            <div className="map-header-school">
              <SchoolIcon style={{ fontSize: 18 }} />
              <span>{school.name}</span>
            </div>
            {success && <div className="map-header-alert success">{success}</div>}
            {error   && <div className="map-header-alert error">{error}</div>}
            <span className="map-header-count">
              <img src="/logo/front-of-bus.png" alt="bus" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              {stops.length} trạm
            </span>
            <button
              className="map-exit-btn"
              onClick={() => { setViewMode('table'); setPendingPin(null); setError(''); }}
            >
              <FullscreenExitIcon />
              Thu nhỏ
            </button>
          </div>

          <div className="map-fullscreen-body">
            <div className="map-fullscreen-map">
              <MapContainer center={[school.lat, school.lng]} zoom={14} style={{ width: '100%', height: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onMapClick={handleMapClick} />

                <Marker position={[school.lat, school.lng]} icon={schoolIcon}>
                  <Popup><strong>{school.name}</strong></Popup>
                </Marker>

                {stops.map((stop) => stop.location && (
                  <Marker key={stop.id} position={[stop.location.lat, stop.location.lng]} icon={stopIcon}>
                    <Popup>
                      <strong>{stop.name}</strong>
                      {stop.address && <><br />{stop.address}</>}
                    </Popup>
                  </Marker>
                ))}

                {pendingPin && (
                  <Marker position={[pendingPin.lat, pendingPin.lng]} icon={pendingIcon} />
                )}
              </MapContainer>
            </div>

            <div className="map-fullscreen-panel">
              {!pendingPin ? (
                <div className="map-hint">
                  <AddLocationAltIcon style={{ fontSize: 48, color: 'var(--primary)', opacity: 0.4 }} />
                  <p>Nhấn vào bản đồ để ghim vị trí trạm xe mới</p>
                  {stops.length > 0 && (
                    <p style={{ fontSize: 13, color: 'var(--text-light)' }}>{stops.length} trạm đã đăng ký</p>
                  )}
                  <div className="map-legend">
                    <div className="legend-item"><span className="legend-dot blue" />Trạm xe</div>
                    <div className="legend-item"><span className="legend-dot green" />Trường học</div>
                    <div className="legend-item"><span className="legend-dot yellow" />Đang chọn</div>
                  </div>
                </div>
              ) : (
                <form className="pin-form" onSubmit={handleSavePin}>
                  <div className="pin-form-title">
                    <AddLocationAltIcon style={{ fontSize: 18 }} />
                    Thêm Trạm Mới
                  </div>
                  <div className="geocode-status geocoded" style={{ marginBottom: 14 }}>
                    <MyLocationIcon style={{ fontSize: 14 }} />
                    {pendingPin.lat.toFixed(5)}, {pendingPin.lng.toFixed(5)}
                  </div>
                  <div className="form-group">
                    <label>Tên Trạm <span className="required">*</span></label>
                    <input
                      type="text"
                      value={pinForm.name}
                      onChange={(e) => setPinForm({ ...pinForm, name: e.target.value })}
                      placeholder="Trạm 1 – Cổng Trường"
                      required autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Ghi Chú Địa Điểm</label>
                    <input
                      type="text"
                      value={pinForm.address}
                      onChange={(e) => setPinForm({ ...pinForm, address: e.target.value })}
                      placeholder="Mô tả vị trí (không bắt buộc)"
                    />
                  </div>
                  <div className="form-group">
                    <label>Thứ Tự Trạm</label>
                    <input type="number" min={1} value={pinForm.order} onChange={(e) => setPinForm({ ...pinForm, order: e.target.value })} />
                  </div>
                  <div className="form-actions" style={{ marginTop: 'auto' }}>
                    <button type="button" className="btn btn-outline" onClick={() => { setPendingPin(null); setError(''); }}>Bỏ chọn</button>
                    <button type="submit" className="btn btn-primary" disabled={savingPin}>
                      <SaveIcon style={{ fontSize: 16 }} />{savingPin ? 'Đang lưu...' : 'Lưu Trạm'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TABLE VIEW & normal page ── */}
      <div className={`page-container busstops-page${viewMode === 'map' ? ' busstops-hidden' : ''}`}>
        <div className="page-header">
          <h2 className="page-title">Quản lý trạm xe</h2>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              <TableRowsIcon style={{ fontSize: 16 }} /> Bảng
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => { setViewMode('map'); setPendingPin(null); setError(''); }}
            >
              <MapIcon style={{ fontSize: 16 }} /> Bản đồ
            </button>
          </div>
        </div>

        {/* School bar */}
        <div className="school-location-bar">
          <SchoolIcon style={{ fontSize: 17, color: 'var(--primary)' }} />
          <div style={{ flex: 1 }}>
            <strong>{school.name}</strong>
            <span style={{ marginLeft: 8, color: 'var(--text-light)' }}>{school.address}</span>
          </div>
          <span className="coord-display">
            <LocationOnIcon />{school.lat.toFixed(4)}, {school.lng.toFixed(4)}
          </span>
          <button className="btn btn-sm btn-outline" onClick={openSchoolEdit} style={{ marginLeft: 8 }}>
            <SettingsIcon style={{ fontSize: 14 }} /> Đổi vị trí trường
          </button>
        </div>

        {success && <div className="alert alert-success">{success}</div>}
        {error   && <div className="alert alert-error">{error}</div>}

        {/* School Edit Modal */}
        {showSchoolForm && (
          <div className="modal-overlay" onClick={() => setShowSchoolForm(false)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3><SchoolIcon style={{ fontSize: 17, marginRight: 8, verticalAlign: 'middle' }} />Cập Nhật Vị Trí Trường</h3>
                <button className="modal-close" onClick={() => setShowSchoolForm(false)}><CloseIcon style={{ fontSize: 17 }} /></button>
              </div>
              <form onSubmit={handleSaveSchool}>
                <div className="form-group">
                  <label>Tên Trường <span className="required">*</span></label>
                  <input type="text" value={schoolForm.name} onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Địa Chỉ <span className="required">*</span></label>
                  <input
                    type="text" value={schoolForm.address}
                    onChange={(e) => { setSchoolForm({ ...schoolForm, address: e.target.value }); setSchoolCoords(null); }}
                    onBlur={handleSchoolAddressBlur} required
                  />
                  {schoolGeocoding && <div className="geocode-status geocoding"><div className="spinner-sm" />Đang tìm tọa độ GPS...</div>}
                  {schoolCoords && !schoolGeocoding && (
                    <div className="geocode-status geocoded">
                      <MyLocationIcon style={{ fontSize: 14 }} />
                      GPS: {schoolCoords.lat.toFixed(5)}, {schoolCoords.lng.toFixed(5)}
                    </div>
                  )}
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setShowSchoolForm(false)}>Hủy</button>
                  <button type="submit" className="btn btn-primary" disabled={savingSchool || schoolGeocoding}>
                    <SaveIcon style={{ fontSize: 16 }} />{savingSchool ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Stop Modal */}
        {editingStop && (
          <div className="modal-overlay" onClick={() => setEditingStop(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Sửa Trạm</h3>
                <button className="modal-close" onClick={() => setEditingStop(null)}><CloseIcon style={{ fontSize: 17 }} /></button>
              </div>
              <form onSubmit={handleSaveEdit}>
                <div className="form-group">
                  <label>Tên Trạm <span className="required">*</span></label>
                  <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Địa Chỉ</label>
                  <input type="text" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Thứ Tự</label>
                  <input type="number" min={1} value={editForm.order} onChange={(e) => setEditForm({ ...editForm, order: e.target.value })} />
                </div>
                {editingStop.location && (
                  <div className="geocode-status geocoded" style={{ marginBottom: 12 }}>
                    <MyLocationIcon style={{ fontSize: 14 }} />
                    GPS: {editingStop.location.lat.toFixed(5)}, {editingStop.location.lng.toFixed(5)}
                  </div>
                )}
                <div className="form-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setEditingStop(null)}>Hủy</button>
                  <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                    <SaveIcon style={{ fontSize: 16 }} />{savingEdit ? 'Đang lưu...' : 'Cập Nhật'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table */}
        {stops.length === 0 ? (
          <div className="empty-state">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <DirectionsBusIcon style={{ fontSize: 64, color: '#CBD5E1', marginBottom: 12 }} />
              <p>Chưa có trạm nào — chuyển sang tab <strong>Bản đồ</strong> để thêm</p>
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
                          <LocationOnIcon />{stop.location.lat?.toFixed(4)}, {stop.location.lng?.toFixed(4)}
                        </span>
                      ) : (
                        <span className="geocode-pending"><MyLocationIcon style={{ fontSize: 13 }} />Chưa có tọa độ</span>
                      )}
                    </td>
                    <td>
                      <div className="action-btns">
                        <button className="btn-icon" onClick={() => openEdit(stop)} title="Sửa"><EditIcon style={{ fontSize: 16 }} /></button>
                        <button className="btn-icon-danger" onClick={() => handleDelete(stop.id, stop.name)} title="Xóa"><DeleteOutlinedIcon style={{ fontSize: 16 }} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default BusStops;
