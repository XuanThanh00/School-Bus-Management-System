import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { listenToStudents } from '../../services/studentService';
import { listenToBusStops } from '../../services/busStopService';
import { listenToSchoolConfig, DEFAULT_SCHOOL } from '../../services/schoolConfigService';
import { rtdb } from '../../firebase';
import { ref, onValue } from 'firebase/database';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import 'leaflet/dist/leaflet.css';

const svgDataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const svgIcon = (color, size = 28) => new L.Icon({
  iconUrl: svgDataUrl(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="${color}" stroke="white" stroke-width="2.5"/>
    </svg>`
  ),
  iconSize: [size, size],
  iconAnchor: [size/2, size/2],
  popupAnchor: [0, -size/2-2],
});

const busStopIcon = new L.Icon({
  iconUrl: svgDataUrl(
    `<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="32" height="32" rx="8" fill="#0052CC" stroke="white" stroke-width="2.5"/>
      <rect x="8" y="9" width="20" height="13" rx="3" fill="white"/>
      <rect x="9" y="11" width="8" height="5" rx="1" fill="#0052CC"/>
      <rect x="19" y="11" width="8" height="5" rx="1" fill="#0052CC"/>
      <circle cx="11" cy="25" r="2.5" fill="white"/>
      <circle cx="25" cy="25" r="2.5" fill="white"/>
    </svg>`
  ),
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
});

const schoolIcon = new L.Icon({
  iconUrl: svgDataUrl(
    `<svg width="40" height="44" viewBox="0 0 40 44" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 44 L13 30 Q5 22 5 16 A15 15 0 0 1 35 16 Q35 22 27 30 Z" fill="#1E3A8A" stroke="white" stroke-width="1.5"/>
      <rect x="10" y="8" width="20" height="16" rx="2" fill="white"/>
      <polygon points="20,2 8,9 32,9" fill="#0052CC"/>
      <rect x="12" y="12" width="5" height="4" rx="1" fill="#0052CC"/>
      <rect x="23" y="12" width="5" height="4" rx="1" fill="#0052CC"/>
      <rect x="17" y="18" width="6" height="6" rx="1" fill="#0052CC"/>
    </svg>`
  ),
  iconSize: [40, 44], iconAnchor: [20, 44], popupAnchor: [0, -46],
});

// Animated bus marker for real-time GPS
const busGpsIcon = new L.Icon({
  iconUrl: svgDataUrl(
    `<svg width="46" height="46" viewBox="0 0 46 46" xmlns="http://www.w3.org/2000/svg">
      <circle cx="23" cy="23" r="22" fill="#F59E0B" stroke="white" stroke-width="2.5"/>
      <rect x="10" y="14" width="26" height="15" rx="4" fill="white"/>
      <rect x="11" y="16" width="10" height="6" rx="1.5" fill="#F59E0B"/>
      <rect x="25" y="16" width="10" height="6" rx="1.5" fill="#F59E0B"/>
      <circle cx="14" cy="32" r="3" fill="white"/>
      <circle cx="32" cy="32" r="3" fill="white"/>
      <rect x="9" y="19" width="2" height="5" rx="1" fill="#F59E0B"/>
      <rect x="35" y="19" width="2" height="5" rx="1" fill="#F59E0B"/>
    </svg>`
  ),
  iconSize: [46, 46], iconAnchor: [23, 23], popupAnchor: [0, -26],
});

const notBoardedIcon = svgIcon('#EF4444', 28);
const absentIcon     = svgIcon('#F59E0B', 28);
const boardedIcon  = svgIcon('#0052CC', 28);
const arrivedIcon  = svgIcon('#059669', 30);

// Component to pan map to bus location when GPS updates
const BusTracker = ({ position, follow }) => {
  const map = useMap();
  const prevPos = useRef(null);
  useEffect(() => {
    if (!position || !follow) return;
    const previous = prevPos.current;
    const next = [position.lat, position.lng];
    const isSamePosition = previous?.lat === position.lat && previous?.lng === position.lng;
    if (!isSamePosition) map.panTo(next, { animate: true, duration: 0.8 });
    prevPos.current = position;
  }, [position, follow, map]);
  return null;
};

const getStudentStatus = (student) =>
  student.attendanceStatus || (student.status ? 'arrived' : 'not_boarded');

const STATUS_LABELS = {
  not_boarded: 'Chưa lên xe',
  boarded:     'Đã lên xe',
  arrived:     'Đã đến trường',
  not_arrived: 'Vắng không phép',
  absent:      'Vắng có phép',
};

const MapView = () => {
  const [students, setStudents]           = useState([]);
  const [busStops, setBusStops]           = useState([]);
  const [school, setSchool]               = useState(DEFAULT_SCHOOL);
  const [busGps, setBusGps]               = useState(null);
  const [busActive, setBusActive]         = useState(false);
  const [followBus, setFollowBus]         = useState(true);
  const [mapCenter]                       = useState([DEFAULT_SCHOOL.lat, DEFAULT_SCHOOL.lng]);
  const [loading, setLoading]             = useState(true);
  const [showStops, setShowStops]         = useState(true);
  const [showStudents, setShowStudents]   = useState(true);

  useEffect(() => {
    const unsubStops    = listenToBusStops(setBusStops);
    const unsubStudents = listenToStudents((data) => { setStudents(data); setLoading(false); });
    const unsubSchool   = listenToSchoolConfig(setSchool);

    // Real-time bus GPS from RTDB
    const busRef = ref(rtdb, 'bus/gps');
    const unsubGps = onValue(busRef, (snap) => {
      const data = snap.val();
      if (data?.lat && data?.lng) {
        setBusGps(data);
        setBusActive(data.isActive !== false);
      } else {
        setBusGps(null);
        setBusActive(false);
      }
    });

    return () => {
      unsubStops();
      unsubStudents();
      unsubSchool();
      unsubGps();
    };
  }, []);

  const studentsWithGPS = students.filter((s) => s.location?.lat);

  const stopsWithGPS = busStops
    .filter((s) => s.location?.lat && s.location?.lng)
    .sort((a, b) => a.order - b.order);

  const routePositions = [
    ...stopsWithGPS.map((s) => [s.location.lat, s.location.lng]),
    [school.lat, school.lng],
  ];

  // Stats
  const arrived      = students.filter((s) => getStudentStatus(s) === 'arrived').length;
  const boarded      = students.filter((s) => getStudentStatus(s) === 'boarded').length;
  const absent       = students.filter((s) => getStudentStatus(s) === 'absent').length;

  const formatSpeed = (v) => (v != null ? `${Math.round(v)} km/h` : '—');
  const formatTime  = (ts) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-state"><div className="spinner" /><p>Đang tải bản đồ...</p></div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Bản đồ hệ thống</h2>
          
        </div>
        {busGps && (
          <button
            className={`btn ${followBus ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFollowBus(!followBus)}
          >
            <DirectionsBusIcon style={{ fontSize: 16 }} />
            {followBus ? 'Đang bám xe' : 'Bám theo xe'}
          </button>
        )}
      </div>

      {/* Bus GPS status banner */}
      {busGps && (
        <div className={`bus-gps-banner ${busActive ? 'active' : 'idle'}`}>
          <DirectionsBusIcon style={{ fontSize: 20 }} />
          <span>
            <strong>Xe đang {busActive ? 'hoạt động' : 'dừng'}:</strong>{' '}
            {busGps.lat.toFixed(5)}, {busGps.lng.toFixed(5)}
            {busGps.speed != null && <> &nbsp;·&nbsp; {formatSpeed(busGps.speed)}</>}
            {' '}&nbsp;·&nbsp; Cập nhật: {formatTime(busGps.updatedAt)}
          </span>
        </div>
      )}
      {!busGps && (
        <div className="bus-gps-banner offline">
          <DirectionsBusIcon style={{ fontSize: 20 }} />
          <span>Chưa nhận được tín hiệu GPS từ xe</span>
        </div>
      )}

      {/* Stats */}
      <div className="map-stats-row">
        <div className="map-stat-card" style={{ background: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)', color: '#047857' }}>
          <CheckCircleIcon className="map-stat-icon" style={{ fontSize: 32, color: '#10B981' }} />
          <div>
            <div className="map-stat-num">{arrived}</div>
            <div className="map-stat-label">Đã đến trường</div>
          </div>
        </div>
        <div className="map-stat-card" style={{ background: 'linear-gradient(135deg,#DBEAFE,#BFDBFE)', color: '#1E40AF' }}>
          <DirectionsBusIcon className="map-stat-icon" style={{ fontSize: 32, color: '#0052CC' }} />
          <div>
            <div className="map-stat-num">{boarded}</div>
            <div className="map-stat-label">Đã lên xe</div>
          </div>
        </div>
        <div className="map-stat-card" style={{ background: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', color: '#92400E' }}>
          <CancelIcon className="map-stat-icon" style={{ fontSize: 32, color: '#EF4444' }} />
          <div>
            <div className="map-stat-num">{absent}</div>
            <div className="map-stat-label">Vắng có phép</div>
          </div>
        </div>
        <div className="map-stat-card" style={{ background: 'linear-gradient(135deg,#E0E7FF,#C7D2FE)', color: '#3730A3' }}>
          <PeopleAltIcon className="map-stat-icon" style={{ fontSize: 32, color: '#4F46E5' }} />
          <div>
            <div className="map-stat-num">{students.length}</div>
            <div className="map-stat-label">Tổng học sinh</div>
          </div>
        </div>
      </div>

      {/* Toggle controls */}
      <div className="map-controls">
        <button
          className={`map-toggle-btn ${showStops ? 'active' : ''}`}
          onClick={() => setShowStops(!showStops)}
        >
          <DirectionsBusIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }} />
          Trạm ({stopsWithGPS.length})
        </button>
        <button
          className={`map-toggle-btn ${showStudents ? 'active' : ''}`}
          onClick={() => setShowStudents(!showStudents)}
          style={showStudents ? { borderColor: '#10B981', color: '#10B981', background: '#ECFDF5' } : {}}
        >
          <CheckCircleIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }} />
          Học sinh ({studentsWithGPS.length})
        </button>
      </div>

      {/* Map */}
      <div className="map-container">
        <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />

          {/* Bus GPS tracker (pans map when followBus is true) */}
          {busGps && <BusTracker position={busGps} follow={followBus} />}

          {/* Route line */}
          {showStops && routePositions.length >= 2 && (
            <Polyline
              positions={routePositions}
              pathOptions={{ color: '#0052CC', weight: 3, opacity: 0.75, dashArray: '8 5' }}
            />
          )}

          {/* School marker */}
          <Marker position={[school.lat, school.lng]} icon={schoolIcon}>
            <Popup>
              <div className="map-popup">
                <strong>{school.name}</strong>
                <p style={{ color: '#0052CC', fontWeight: 600 }}>Điểm đến cuối tuyến</p>
                <p style={{ color: '#666' }}>{school.address}</p>
                <p style={{ color: '#666', fontSize: 12 }}>{school.lat.toFixed(5)}, {school.lng.toFixed(5)}</p>
              </div>
            </Popup>
          </Marker>

          {/* Real-time bus GPS marker */}
          {busGps && (
            <Marker position={[busGps.lat, busGps.lng]} icon={busGpsIcon}>
              <Popup>
                <div className="map-popup">
                  <strong>🚌 Xe buýt (GPS thực tế)</strong>
                  <p style={{ color: busActive ? '#F59E0B' : '#666', fontWeight: 600 }}>
                    {busActive ? 'Đang hoạt động' : 'Đang dừng'}
                  </p>
                  <p>{busGps.lat.toFixed(5)}, {busGps.lng.toFixed(5)}</p>
                  {busGps.speed != null && <p>Tốc độ: {formatSpeed(busGps.speed)}</p>}
                  <p style={{ fontSize: 12, color: '#666' }}>Cập nhật: {formatTime(busGps.updatedAt)}</p>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Bus stops */}
          {showStops && stopsWithGPS.map((stop) => (
            <Marker key={stop.id} position={[stop.location.lat, stop.location.lng]} icon={busStopIcon}>
              <Popup>
                <div className="map-popup">
                  <strong>Trạm {stop.order}: {stop.name}</strong>
                  <p style={{ color: '#666' }}>{stop.address}</p>
                  <p style={{ color: '#0052CC', fontSize: 12 }}>
                    {stop.location.lat.toFixed(5)}, {stop.location.lng.toFixed(5)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Students */}
          {showStudents && studentsWithGPS.map((s) => {
            const status = getStudentStatus(s);
            const icon = status === 'arrived' ? arrivedIcon
              : status === 'boarded' ? boardedIcon
              : status === 'absent' ? absentIcon
              : notBoardedIcon;
            const statusColor = status === 'arrived' ? '#059669'
              : status === 'boarded' ? '#0052CC'
              : status === 'absent' ? '#92400E'
              : '#EF4444';
            return (
              <Marker key={s.id} position={[s.location.lat, s.location.lng]} icon={icon}>
                <Popup>
                  <div className="map-popup">
                    <strong>{s.name}</strong>
                    <p>Lớp: {s.class}</p>
                    <p style={{ fontWeight: 600, color: statusColor }}>
                      {STATUS_LABELS[status] || status}
                    </p>
                    {s.studentId && <p style={{ color: '#666', fontSize: 12 }}>Mã HS: {s.studentId}</p>}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="map-legend">
        <span className="legend-item">
          <span className="legend-dot legend-square" style={{ background: '#1E3A8A', width: 14, height: 14, borderRadius: 3 }} />
          Trường học
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: '#F59E0B', width: 16, height: 16, borderRadius: 3 }} />
          Xe buýt (GPS)
        </span>
        <span className="legend-item">
          <span className="legend-dot legend-square" style={{ background: '#0052CC' }} />
          Trạm xe
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: '#059669' }} />
          Đã đến trường
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: '#0052CC' }} />
          Đã lên xe
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: '#EF4444' }} />
          Chưa lên xe
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: '#F59E0B' }} />
          Vắng có phép
        </span>
        <span className="legend-item legend-route">
          <span className="legend-line" />
          Tuyến xe
        </span>
      </div>
    </div>
  );
};

export default MapView;
