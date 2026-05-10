import React, { useState, useEffect } from 'react';
import { addStudent } from '../../services/studentService';
import { registerParent } from '../../services/authService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import { listenToBusStops } from '../../services/busStopService';
import {
  listenToPendingRFID,
  clearPendingRFID,
  checkRfidRegistered,
} from '../../services/rfidService';
import ContactlessIcon from '@mui/icons-material/Contactless';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import RefreshIcon from '@mui/icons-material/Refresh';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BadgeIcon from '@mui/icons-material/Badge';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import ImageIcon from '@mui/icons-material/Image';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import LinkIcon from '@mui/icons-material/Link';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import './StudentForm.css';


const isValidVNDate = (val) => /^\d{2}\/\d{2}\/\d{4}$/.test(val);

const StudentForm = () => {
  const { currentUser } = useAuth();

  const [studentId, setStudentId]     = useState('');
  const [name, setName]               = useState('');
  const [className, setClassName]     = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [parentName, setParentName]   = useState('');
  const [parentPhone, setParentPhone] = useState('');

  const [imageFile, setImageFile]         = useState(null);
  const [imagePreview, setImagePreview]   = useState(null);
  const [busStops, setBusStops]           = useState([]);
  const [selectedStop, setSelectedStop]   = useState(null);

  // RFID
  const [rfidUid, setRfidUid]             = useState(null);
  const [rfidListening, setRfidListening] = useState(true);
  const [rfidDuplicate, setRfidDuplicate] = useState(null);   // student that already owns this card
  const [checkingRfid, setCheckingRfid]   = useState(false);

  // Status
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  // Load active bus stops
  useEffect(() => {
    const unsub = listenToBusStops((data) => {
      setBusStops(data.filter((s) => s.isActive !== false && s.location?.lat && s.location?.lng));
    });
    return unsub;
  }, []);

  // Listen real-time UID from ESP32 via RTDB
  useEffect(() => {
    const unsubscribe = listenToPendingRFID((data) => {
      if (data?.uid) {
        setRfidUid(data.uid);
        setRfidListening(false);
      }
    });
    return unsubscribe;
  }, []);

  // When UID arrives, check if already registered to another student
  useEffect(() => {
    if (!rfidUid) {
      setRfidDuplicate(null);
      return;
    }
    setCheckingRfid(true);
    checkRfidRegistered(rfidUid)
      .then((student) => setRfidDuplicate(student))
      .catch(() => setRfidDuplicate(null))
      .finally(() => setCheckingRfid(false));
  }, [rfidUid]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSelectStop = (stopId) => {
    const stop = busStops.find((s) => s.id === stopId) || null;
    setSelectedStop(stop);
  };

  const handleClearRFID = () => {
    setRfidUid(null);
    setRfidDuplicate(null);
    setRfidListening(true);
    clearPendingRFID();
  };



  const flashSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 3500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!studentId.trim())            { setError('Vui lòng điền mã học sinh'); return; }
    if (!name.trim())                  { setError('Vui lòng điền họ tên học sinh'); return; }
    if (!className)                    { setError('Vui lòng chọn lớp'); return; }
    if (!dateOfBirth.trim())           { setError('Vui lòng điền ngày sinh'); return; }
    if (!isValidVNDate(dateOfBirth))   { setError('Ngày sinh không hợp lệ — nhập theo định dạng DD/MM/YYYY'); return; }
    if (!parentName.trim())            { setError('Vui lòng điền tên phụ huynh'); return; }
    if (!parentPhone.trim())           { setError('Vui lòng điền SĐT phụ huynh'); return; }
    if (!imageFile)                    { setError('Vui lòng chọn ảnh học sinh'); return; }
    if (!selectedStop)                 { setError('Vui lòng chọn trạm xe'); return; }

    setLoading(true);
    try {
      const studentData = {
        studentId: studentId.trim(),
        name: name.trim(),
        class: className,
        dateOfBirth: dateOfBirth || '',
        parentName: parentName.trim(),
        parentPhone: parentPhone.trim(),
        attendanceStatus: 'not_boarded',
        status: false,
        ...(rfidUid && { rfidCardId: rfidUid }),
        ...(selectedStop && {
          busStopId:   selectedStop.id,
          busStopName: selectedStop.name,
          location: {
            lat:       selectedStop.location.lat,
            lng:       selectedStop.location.lng,
            accuracy:  0,
            timestamp: new Date(),
          },
        }),
      };

      await addStudent(studentData, imageFile);
      if (parentPhone.trim()) {
        await registerParent({
          phone: parentPhone.trim(),
          displayName: parentName.trim() || parentPhone.trim(),
          password: '123456',
          studentId: studentId.trim(),
        });
      }

      if (rfidUid) await clearPendingRFID();
      if (currentUser) await addLog(currentUser.uid, `Thêm học sinh: ${name}${rfidUid ? ` (RFID: ${rfidUid})` : ''}`);

      flashSuccess('Thêm học sinh thành công!');
      resetForm();
    } catch (e) {
      setError(e.message || 'Thêm học sinh thất bại');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStudentId('');
    setName('');
    setClassName('');
    setDateOfBirth('');
    setParentName('');
    setParentPhone('');
    setImageFile(null);
    setImagePreview(null);
    setSelectedStop(null);
    setRfidUid(null);
    setRfidDuplicate(null);
    setRfidListening(true);
  };

  return (
    <div className="page-container student-form-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Thêm học sinh</h2>
        </div>
      </div>

      <div className="form-card">
        {error   && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* ── RFID Box ── */}
        <div className={`rfid-box ${rfidUid && !rfidDuplicate ? 'rfid-box--linked' : ''} ${rfidDuplicate ? 'rfid-box--duplicate' : ''}`}>
          <div className="rfid-box-header">
            <h3 className="rfid-box-title">
              <ContactlessIcon />
              Gán UID
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {rfidUid && (
                <button type="button" className="btn btn-sm btn-outline" onClick={handleClearRFID}>
                  Bỏ thẻ
                </button>
              )}
            </div>
          </div>

          {rfidUid ? (
            <div>
              {/* UID display */}
              <div className="rfid-linked">
                {checkingRfid ? (
                  <div className="rfid-pulse" style={{ width: 40, height: 40 }}>
                    <ContactlessIcon style={{ fontSize: 22, color: 'var(--primary)' }} />
                  </div>
                ) : rfidDuplicate ? (
                  <ReportProblemIcon style={{ fontSize: 24, color: 'var(--danger)', flexShrink: 0 }} />
                ) : (
                  <CheckCircleIcon style={{ fontSize: 24, color: 'var(--success)', flexShrink: 0 }} />
                )}
                <div>
                  <div className="rfid-uid-label">UID</div>
                  <div className="rfid-uid-value">
                    <CreditCardIcon style={{ fontSize: 16 }} />
                    {rfidUid}
                  </div>
                  {!checkingRfid && !rfidDuplicate && (
                    <div className="rfid-uid-hint">
                      <LinkIcon style={{ fontSize: 13 }} />
                      Thẻ chưa đăng ký — sẵn sàng gán cho học sinh mới
                    </div>
                  )}
                </div>
              </div>

              {/* Duplicate warning */}
              {!checkingRfid && rfidDuplicate && (
                <div className="rfid-duplicate-warning">
                  <ReportProblemIcon style={{ fontSize: 18 }} />
                  <div>
                    <div className="rfid-dup-title">Thẻ này đã được đăng ký!</div>
                    <div className="rfid-dup-detail">
                      Học sinh: <strong>{rfidDuplicate.name}</strong> — Lớp: <strong>{rfidDuplicate.class}</strong>
                      {rfidDuplicate.studentId && <> — Mã HS: <strong>{rfidDuplicate.studentId}</strong></>}
                    </div>
                    <div className="rfid-dup-hint">
                      Bỏ thẻ và quét lại thẻ khác, hoặc xóa gán thẻ cũ trước khi tiếp tục.
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Waiting state ── */
            <div className="rfid-waiting">
              <div className="rfid-pulse">
                <ContactlessIcon style={{ fontSize: 32, color: 'var(--primary)' }} />
              </div>
              <div>
                <div className="rfid-wait-text">
                  {rfidListening ? 'Đặt thẻ lên đầu đọc RFID...' : 'Đang chờ tín hiệu từ thiết bị đọc thẻ'}
                </div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* ── Student info ── */}
          <div className="form-section-title">
            <BadgeIcon />
            Thông Tin Học Sinh
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Mã Học Sinh <span className="required">*</span></label>
              <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="hs001" required />
            </div>
            <div className="form-group">
              <label>Họ Tên <span className="required">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn An" required />
            </div>
            <div className="form-group">
              <label>Lớp <span className="required">*</span></label>
              <input type="text" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="VD: 4B1" required />
            </div>
            <div className="form-group">
              <label>Ngày Tháng Năm Sinh <span className="required">*</span></label>
              <input
                type="text"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                placeholder="DD/MM/YYYY"
                maxLength={10}
                required
              />
            </div>
          </div>

          {/* ── Parent info ── */}
          <div className="form-section-title" style={{ marginTop: 24 }}>
            <FamilyRestroomIcon />
            Thông Tin Phụ Huynh
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Tên Phụ Huynh <span className="required">*</span></label>
              <input type="text" value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Nguyễn Thị Lan" required />
            </div>
            <div className="form-group">
              <label>SĐT Phụ Huynh <span className="required">*</span></label>
              <input type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="0901234567" required />
              {parentPhone.trim() && (
                <p style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>
                  Tài khoản app sẽ được tạo tự động — mật khẩu mặc định: <strong>123456</strong>
                </p>
              )}
            </div>
          </div>

          {/* ── Photo & Bus Stop ── */}
          <div className="form-section-title" style={{ marginTop: 24 }}>
            <PhotoCameraIcon />
            Ảnh & Trạm Xe
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Ảnh Học Sinh <span className="required">*</span></label>
              <label className="image-upload-area" style={{ display: 'block', cursor: 'pointer' }}>
                <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                {imagePreview ? (
                  <div className="image-preview-box">
                    <img src={imagePreview} alt="preview" />
                    <button type="button" className="btn btn-sm btn-danger" onClick={(e) => { e.preventDefault(); setImageFile(null); setImagePreview(null); }}>
                      Xóa ảnh
                    </button>
                  </div>
                ) : (
                  <div className="upload-placeholder">
                    <ImageIcon style={{ fontSize: 36, color: '#CBD5E1' }} />
                    <span style={{ fontSize: 13, color: 'var(--text-light)' }}>Nhấn để chọn ảnh</span>
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
                <p style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 6 }}>
                  Chưa có trạm nào được đăng ký. Vào <strong>Quản Lý Trạm Xe</strong> để thêm.
                </p>
              ) : (
                <select
                  value={selectedStop?.id || ''}
                  onChange={(e) => handleSelectStop(e.target.value)}
                >
                  <option value="">-- Không chọn trạm --</option>
                  {busStops.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {stop.order ? `${stop.order}. ` : ''}{stop.name}
                      {stop.address ? ` — ${stop.address}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedStop && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--primary-pale)', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--primary)' }}>
                    <LocationOnIcon style={{ fontSize: 15 }} />
                    {selectedStop.name}
                  </div>
                  {selectedStop.address && (
                    <div style={{ color: 'var(--text-light)', marginTop: 2 }}>{selectedStop.address}</div>
                  )}
                  <div style={{ color: 'var(--text-light)', marginTop: 2, fontFamily: 'monospace', fontSize: 12 }}>
                    {selectedStop.location.lat.toFixed(5)}, {selectedStop.location.lng.toFixed(5)}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={resetForm}>
              <RefreshIcon style={{ fontSize: 17 }} />
              Đặt Lại
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-lg btn-submit-form"
              disabled={loading || (rfidDuplicate !== null && rfidUid)}
            >
              <PersonAddIcon style={{ fontSize: 19 }} />
              {loading ? 'Đang thêm...' : 'Thêm Học Sinh'}
            </button>
          </div>
          {rfidDuplicate && rfidUid && (
            <p style={{ color: 'var(--danger)', fontSize: 13, textAlign: 'right', marginTop: 8 }}>
              Vui lòng bỏ thẻ trùng trước khi lưu
            </p>
          )}
        </form>
      </div>
    </div>
  );
};

export default StudentForm;
