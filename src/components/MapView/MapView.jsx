import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { getAllStudents } from '../../services/studentService';
import { getCurrentLocation } from '../../services/geolocationService';
import 'leaflet/dist/leaflet.css';

// Custom icons for Leaflet
const deviceIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iIzAwNTJDQyIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

const presentIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxMCIgZmlsbD0iIzEwQjk4MSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

const absentIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNCIgY3k9IjE0IiByPSIxMCIgZmlsbD0iI0VGNDQ0NCIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

const MapView = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [mapCenter, setMapCenter] = useState([10.7769, 106.7009]); // Default: Saigon [lat, lng]

  useEffect(() => {
    fetchStudentsAndLocation();
  }, []);

  const fetchStudentsAndLocation = async () => {
    try {
      // Get current device location
      const location = await getCurrentLocation();
      setCurrentLocation(location);
      setMapCenter([location.lat, location.lng]);

      // Get students data
      const data = await getAllStudents();
      setStudents(data);
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  const presentStudents = students.filter(s => s.status && s.location);
  const absentStudents = students.filter(s => !s.status && s.location);

  if (loading) return <div className="loading">Đang tải bản đồ...</div>;

  return (
    <div className="map-view">
      <h2>🗺️ Bản Đồ Vị Trí Học Sinh</h2>

      {currentLocation && (
        <div className="map-info">
          <p>
            📍 <strong>Vị trí thiết bị hiện tại:</strong> {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
          </p>
          <p>
            📏 <strong>Độ chính xác:</strong> ±{currentLocation.accuracy.toFixed(0)}m
          </p>
        </div>
      )}

      <div className="map-container">
        <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%' }}>
          {/* OpenStreetMap Tile Layer */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          {/* Current device location */}
          {currentLocation && (
            <Marker position={[currentLocation.lat, currentLocation.lng]} icon={deviceIcon}>
              <Popup>
                <div style={{ textAlign: 'center' }}>
                  <p><strong>📱 Vị Trí Thiết Bị</strong></p>
                  <p>Tọa độ: {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}</p>
                  <p>Độ chính xác: ±{currentLocation.accuracy.toFixed(0)}m</p>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Present students markers (Green) */}
          {presentStudents.map(student => (
            <Marker
              key={student.id}
              position={[student.location.lat, student.location.lng]}
              icon={presentIcon}
            >
              <Popup>
                <div style={{ textAlign: 'center', minWidth: '200px' }}>
                  <p><strong>✅ {student.name}</strong></p>
                  <p>Lớp: {student.class}</p>
                  <p style={{ color: '#10B981', fontWeight: 'bold' }}>Đã đến</p>
                  <p style={{ fontSize: '12px', color: '#666' }}>
                    {student.location.lat.toFixed(6)}, {student.location.lng.toFixed(6)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Absent students markers (Red) */}
          {absentStudents.map(student => (
            <Marker
              key={student.id}
              position={[student.location.lat, student.location.lng]}
              icon={absentIcon}
            >
              <Popup>
                <div style={{ textAlign: 'center', minWidth: '200px' }}>
                  <p><strong>❌ {student.name}</strong></p>
                  <p>Lớp: {student.class}</p>
                  <p style={{ color: '#EF4444', fontWeight: 'bold' }}>Chưa đến</p>
                  <p style={{ fontSize: '12px', color: '#666' }}>
                    {student.location.lat.toFixed(6)}, {student.location.lng.toFixed(6)}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Statistics */}
      <div className="stats-container">
        <div className="stat-card present">
          <h3>✅ Đã Đến (có GPS)</h3>
          <p className="stat-number">{presentStudents.length}</p>
        </div>

        <div className="stat-card absent">
          <h3>❌ Chưa Đến (có GPS)</h3>
          <p className="stat-number">{absentStudents.length}</p>
        </div>

        <div className="stat-card total">
          <h3>📍 Có GPS</h3>
          <p className="stat-number">{presentStudents.length + absentStudents.length}</p>
        </div>
      </div>

      {/* Legend */}
      <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
        <h3 style={{ marginBottom: '15px', color: '#0052CC' }}>📌 Chú Thích</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
          <div>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: '#0052CC', borderRadius: '50%', marginRight: '8px' }}></span>
            📱 Vị trí thiết bị
          </div>
          <div>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: '#10B981', borderRadius: '50%', marginRight: '8px' }}></span>
            ✅ Học sinh đã đến
          </div>
          <div>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: '#EF4444', borderRadius: '50%', marginRight: '8px' }}></span>
            ❌ Học sinh chưa đến
          </div>
        </div>
        <p style={{ marginTop: '15px', fontSize: '12px', color: '#666' }}>
          💡 Dữ liệu bản đồ từ OpenStreetMap (miễn phí, không cần API key)
        </p>
      </div>
    </div>
  );
};

export default MapView;
