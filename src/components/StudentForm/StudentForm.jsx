import React, { useState } from 'react';
import { addStudent } from '../../services/studentService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import { getCurrentLocation } from '../../services/geolocationService';

const StudentForm = () => {
  const [name, setName] = useState('');
  const [className, setClassName] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [locationData, setLocationData] = useState(null);
  const { currentUser } = useAuth();

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);

      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGetLocation = async () => {
    setGettingLocation(true);
    setError('');
    try {
      const location = await getCurrentLocation();
      setLocationData(location);
      setSuccess(`📍 Vị trí: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)} (±${location.accuracy.toFixed(0)}m)`);
    } catch (err) {
      setError('Không thể lấy vị trí: ' + err.message);
    } finally {
      setGettingLocation(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!name.trim() || !className.trim()) {
      setError('Vui lòng điền đầy đủ thông tin');
      return;
    }

    setLoading(true);

    try {
      const studentData = {
        name: name.trim(),
        class: className.trim(),
        status: false,
        ...(locationData && {
          location: {
            lat: locationData.lat,
            lng: locationData.lng,
            accuracy: locationData.accuracy,
            timestamp: new Date(),
          },
        }),
      };

      await addStudent(studentData, imageFile);

      if (currentUser) {
        await addLog(currentUser.uid, `Thêm học sinh: ${name}`);
      }

      setSuccess('✅ Thêm học sinh thành công!');

      setName('');
      setClassName('');
      setImageFile(null);
      setImagePreview(null);
      setLocationData(null);

      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Thêm học sinh thất bại');
    } finally {
      setLoading(false);
    }
  };

  const classes = ['12A1', '12A2', '12A3', '12B1', '12B2', '11A1', '11A2', '10A1'];

  return (
    <div className="student-form">
      <h2>➕ Thêm Học Sinh Mới</h2>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Họ Tên:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nhập họ tên học sinh"
            required
          />
        </div>

        <div className="form-group">
          <label>Lớp:</label>
          <select
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            required
          >
            <option value="">Chọn lớp</option>
            {classes.map(cls => (
              <option key={cls} value={cls}>
                {cls}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Vị Trí (Tùy Chọn):</label>
          <button
            type="button"
            onClick={handleGetLocation}
            disabled={gettingLocation}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: locationData ? '#10B981' : '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '700',
              transition: 'all 0.3s',
            }}
          >
            {gettingLocation ? '⏳ Đang lấy GPS...' : locationData ? '✅ GPS lấy được' : '📍 Lấy Vị Trí Hiện Tại'}
          </button>
          {locationData && (
            <p style={{ marginTop: '8px', fontSize: '13px', color: '#10B981' }}>
              📍 {locationData.lat.toFixed(6)}, {locationData.lng.toFixed(6)} (±{locationData.accuracy.toFixed(0)}m)
            </p>
          )}
        </div>

        <div className="form-group">
          <label>Ảnh (Tùy Chọn):</label>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
          />

          {imagePreview && (
            <div className="image-preview">
              <img src={imagePreview} alt="Preview" />
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setImagePreview(null);
                }}
              >
                Xóa ảnh
              </button>
            </div>
          )}
        </div>

        <button type="submit" disabled={loading}>
          {loading ? '⏳ Đang thêm...' : '➕ Thêm Học Sinh'}
        </button>
      </form>
    </div>
  );
};

export default StudentForm;
