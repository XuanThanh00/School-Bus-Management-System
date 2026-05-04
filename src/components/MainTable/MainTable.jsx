import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  listenToStudents,
  updateAttendanceStatus,
  deleteStudent,
  updateStudentRfid,
} from '../../services/studentService';
import {
  listenToPendingRFID,
  clearPendingRFID,
  checkRfidRegistered,
} from '../../services/rfidService';
import { listenToApprovedLeavesForDate } from '../../services/leaveRequestService';
import { listenToLeaveBuffer } from '../../services/leaveBufferService';
import { listenToSchoolConfig, DEFAULT_SCHOOL } from '../../services/schoolConfigService';
import { rtdb } from '../../firebase';
import { ref, onValue } from 'firebase/database';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import InboxIcon from '@mui/icons-material/Inbox';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import ContactlessIcon from '@mui/icons-material/Contactless';
import SaveIcon from '@mui/icons-material/Save';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import SchoolIcon from '@mui/icons-material/School';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import RefreshIcon from '@mui/icons-material/Refresh';
import './MainTable.css';

// Haversine distance in meters
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const TODAY = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

// Returns canonical attendanceStatus, falling back to legacy `status` boolean
const getStatus = (student) => {
  if (student.attendanceStatus) return student.attendanceStatus;
  return student.status ? 'arrived' : 'not_boarded';
};

// Status config: label, CSS class, icon component
const STATUS_CONFIG = {
  not_boarded: { label: 'Chưa lên xe',      cls: 'status-not-boarded', Icon: RadioButtonUncheckedIcon },
  boarded:     { label: 'Đã lên xe',         cls: 'status-boarded',     Icon: CheckCircleIcon },
  moving:      { label: 'Đang di chuyển',    cls: 'status-moving',      Icon: DirectionsBusIcon },
  arrived:     { label: 'Đã đến trường',     cls: 'status-arrived',     Icon: SchoolIcon },
  not_arrived: { label: 'Vắng không phép',   cls: 'status-not-arrived', Icon: CancelIcon },
  absent:      { label: 'Vắng có phép',      cls: 'status-absent',      Icon: EventBusyIcon },
};

const getDisplayStatus = (student, isOnLeave, isMoving) => {
  if (isOnLeave) return STATUS_CONFIG.absent;
  const s = getStatus(student);
  if (s === 'boarded' && isMoving) return STATUS_CONFIG.moving;
  return STATUS_CONFIG[s] || STATUS_CONFIG.not_boarded;
};

const MainTable = () => {
  const [students, setStudents]           = useState([]);
  const [leaveIds, setLeaveIds]           = useState(new Set());
  const [bufferLeaveIds, setBufferLeaveIds] = useState(new Set());
  const [school, setSchool]               = useState(DEFAULT_SCHOOL);
  const [busGps, setBusGps]               = useState(null);
  const [isMoving, setIsMoving]           = useState(false);
  const [loading, setLoading]             = useState(true);
  const [filterClass, setFilterClass]     = useState('');
  const [search, setSearch]               = useState('');
  const [expandedRow, setExpandedRow]     = useState(null);
  const [rfidEditId, setRfidEditId]       = useState(null); // firestoreDocId being edited
  const [scannedUid, setScannedUid]       = useState(null);
  const [rfidConflict, setRfidConflict]   = useState(null); // student owning this card
  const [savingRfid, setSavingRfid]       = useState(false);
  const rfidUnsubRef                      = useRef(null);
  const { currentUser }                   = useAuth();

  const studentsRef       = useRef([]);
  const leaveIdsRef         = useRef(new Set());
  const bufferLeaveIdsRef   = useRef(new Set());
  const schoolRef         = useRef(DEFAULT_SCHOOL);
  const movingTimerRef    = useRef(null);
  const arrivalDoneRef    = useRef(false);

  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { schoolRef.current = school; }, [school]);
  useEffect(() => { leaveIdsRef.current = leaveIds; }, [leaveIds]);
  useEffect(() => { bufferLeaveIdsRef.current = bufferLeaveIds; }, [bufferLeaveIds]);

  // Trigger arrival: mark all 'boarded' students as 'arrived'
  const triggerArrival = useCallback(async () => {
    const boarded = studentsRef.current.filter((s) => getStatus(s) === 'boarded');
    if (!boarded.length) return;
    await Promise.all(boarded.map((s) => updateAttendanceStatus(s.id, 'arrived')));
    if (currentUser) await addLog(currentUser.uid, `GPS xe tới trường — điểm danh ${boarded.length} học sinh`);
  }, [currentUser]);

  const syncAbsent = (studentList, ids) => {
    const toMark = studentList.filter(
      (s) => (ids.has(s.studentId) || ids.has(s.id)) && getStatus(s) !== 'absent'
    );
    if (toMark.length) {
      Promise.all(toMark.map((s) => updateAttendanceStatus(s.id, 'absent'))).catch(console.error);
    }
  };

  useEffect(() => {
    const unsubStudents = listenToStudents((data) => {
      studentsRef.current = data;
      setStudents(data);
      setLoading(false);
      setTimeout(() => {
        syncAbsent(data, leaveIdsRef.current);
        syncAbsent(data, bufferLeaveIdsRef.current);
      }, 300);
    });

    const unsubLeaves = listenToApprovedLeavesForDate(TODAY, (ids) => {
      leaveIdsRef.current = ids;
      setLeaveIds(ids);
      syncAbsent(studentsRef.current, ids);
    });
    const unsubSchool  = listenToSchoolConfig(setSchool);

    const unsubBuffer = listenToLeaveBuffer((ids) => {
      bufferLeaveIdsRef.current = ids;
      setBufferLeaveIds(ids);
      syncAbsent(studentsRef.current, ids);
    });

    // Real-time bus GPS
    const busRef = ref(rtdb, 'bus/gps');
    const unsubGps = onValue(busRef, (snap) => {
      const data = snap.val();
      if (!data?.lat || !data?.lng) { setBusGps(null); setIsMoving(false); return; }
      setBusGps(data);

      // Mark as moving; clear after 10s of no update
      setIsMoving(true);
      clearTimeout(movingTimerRef.current);
      movingTimerRef.current = setTimeout(() => setIsMoving(false), 10000);

      // Arrival detection: GPS within 150m of school
      const sc = schoolRef.current;
      const dist = haversineDistance(data.lat, data.lng, sc.lat, sc.lng);
      if (dist < 150 && !arrivalDoneRef.current) {
        arrivalDoneRef.current = true;
        triggerArrival();
      }
      // Reset trigger when bus moves away from school (> 300m)
      if (dist > 300) arrivalDoneRef.current = false;
    });

    return () => {
      unsubStudents();
      unsubLeaves();
      unsubSchool();
      unsubBuffer();
      unsubGps();
      clearTimeout(movingTimerRef.current);
    };
  }, [triggerArrival]);

  const startRfidEdit = (firestoreDocId) => {
    setRfidEditId(firestoreDocId);
    setScannedUid(null);
    setRfidConflict(null);
    rfidUnsubRef.current = listenToPendingRFID(async (data) => {
      if (!data?.uid) return;
      setScannedUid(data.uid);
      const conflict = await checkRfidRegistered(data.uid);
      setRfidConflict(conflict?.id !== firestoreDocId ? conflict : null);
    });
  };

  const cancelRfidEdit = () => {
    rfidUnsubRef.current?.();
    setRfidEditId(null);
    setScannedUid(null);
    setRfidConflict(null);
  };

  const saveRfid = async (firestoreDocId, studentName) => {
    if (!scannedUid || rfidConflict) return;
    setSavingRfid(true);
    try {
      await updateStudentRfid(firestoreDocId, scannedUid);
      await clearPendingRFID();
      if (currentUser) await addLog(currentUser.uid, `Cập nhật RFID học sinh ${studentName}: ${scannedUid}`);
      cancelRfidEdit();
    } catch (e) { console.error(e); }
    finally { setSavingRfid(false); }
  };

  // Cleanup RFID listener on unmount
  useEffect(() => () => rfidUnsubRef.current?.(), []);

  const isStudentOnLeave = useCallback((s) =>
    getStatus(s) === 'absent' ||
    leaveIdsRef.current.has(s.id) ||
    leaveIdsRef.current.has(s.studentId) ||
    bufferLeaveIdsRef.current.has(s.studentId),
  []);

  const handleStatusCycle = async (student) => {
    const onLeave = isStudentOnLeave(student);
    if (onLeave) return;
    const current = getStatus(student);
    const next = {
      not_boarded: 'boarded',
      boarded:     'arrived',
      arrived:     'not_boarded',
      not_arrived: 'not_boarded',
    }[current] || 'not_boarded';
    try {
      await updateAttendanceStatus(student.id, next);
      if (currentUser) await addLog(currentUser.uid, `Cập nhật trạng thái ${student.name}: ${next}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (studentId, studentName) => {
    if (!window.confirm(`Xóa học sinh "${studentName}"?`)) return;
    try {
      await deleteStudent(studentId);
      if (currentUser) await addLog(currentUser.uid, `Xóa học sinh: ${studentName}`);
    } catch (err) { console.error(err); }
  };

  const handleResetDay = async () => {
    if (!window.confirm('Reset trạng thái điểm danh về "Chưa lên xe" cho tất cả học sinh không nghỉ phép?')) return;
    try {
      const targets = students.filter((s) => !isStudentOnLeave(s));
      await Promise.all(targets.map((s) => updateAttendanceStatus(s.id, 'not_boarded')));
      arrivalDoneRef.current = false;
      if (currentUser) await addLog(currentUser.uid, `Reset điểm danh ngày mới`);
    } catch (err) { console.error(err); }
  };

  const uniqueClasses = [...new Set(students.map((s) => s.class).filter(Boolean))].sort();

  const filtered = students.filter((s) => {
    const matchClass  = !filterClass || s.class === filterClass;
    const matchSearch = !search ||
      s.name?.toLowerCase().includes(search.toLowerCase()) ||
      s.studentId?.toLowerCase().includes(search.toLowerCase()) ||
      s.rfidCardId?.toLowerCase().includes(search.toLowerCase()) ||
      s.parentPhone?.includes(search);
    return matchClass && matchSearch;
  });

  // Stats (excluding students on approved leave from active counts)
  const isStudentOnLeaveForRender = (s) =>
    getStatus(s) === 'absent' ||
    leaveIds.has(s.id) ||
    leaveIds.has(s.studentId) ||
    bufferLeaveIds.has(s.studentId);
  const activeStudents = filtered.filter((s) => !isStudentOnLeaveForRender(s));
  const stats = {
    total:       filtered.length,
    onLeave:     filtered.filter((s) => isStudentOnLeaveForRender(s)).length,
    boarded:     activeStudents.filter((s) => getStatus(s) === 'boarded').length,
    arrived:     activeStudents.filter((s) => getStatus(s) === 'arrived').length,
    notBoarded:  activeStudents.filter((s) => !['boarded','arrived','not_arrived'].includes(getStatus(s))).length,
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-state"><div className="spinner" /><p>Đang tải dữ liệu...</p></div>
      </div>
    );
  }

  return (
    <div className="page-container main-table-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Danh sách học sinh</h2>
          
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {busGps && (
            <span className="bus-status-chip">
              <DirectionsBusIcon style={{ fontSize: 20 }} />
              {isMoving ? 'Xe đang di chuyển' : 'Xe đang dừng'}
            </span>
          )}
          <button className="btn btn-outline btn-sm" onClick={handleResetDay} title="Reset điểm danh ngày mới">
            <RefreshIcon style={{ fontSize: 30 }} />
            Reset
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-pill total">
          <span className="stat-pill-label">Tổng</span>
          <span className="stat-pill-value">{stats.total}</span>
        </div>
        <div className="stat-pill arrived">
          <span className="stat-pill-label">Đã đến trường</span>
          <span className="stat-pill-value">{stats.arrived}</span>
        </div>
        <div className="stat-pill boarded">
          <span className="stat-pill-label">Đã lên xe</span>
          <span className="stat-pill-value">{stats.boarded}</span>
        </div>
        <div className="stat-pill absent">
          <span className="stat-pill-label">Vắng có phép</span>
          <span className="stat-pill-value">{stats.onLeave}</span>
        </div>
        <div className="stat-pill not-boarded">
          <span className="stat-pill-label">Chưa lên xe</span>
          <span className="stat-pill-value">{stats.notBoarded}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="search-box">
          <span className="search-icon"><SearchIcon /></span>
          <input
            type="text"
            placeholder="Tìm tên, mã HS, RFID, SĐT phụ huynh..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="filter-select">
          <option value="">Tất cả lớp</option>
          {uniqueClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <InboxIcon style={{ fontSize: 60, color: '#CBD5E1', marginBottom: 12 }} />
            <p>Không tìm thấy học sinh nào</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th style={{ width: 60 }}>Ảnh</th>
                <th>Họ Tên</th>
                <th>Mã HS</th>
                <th>Lớp</th>
                <th>RFID</th>
                <th>SĐT PH</th>
                <th>Trạng Thái</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((student) => {
                const isOnLeave = isStudentOnLeaveForRender(student);
                const dispStatus = getDisplayStatus(student, isOnLeave, isMoving);
                const { Icon } = dispStatus;

                return (
                  <React.Fragment key={student.id}>
                    <tr
                      className={`table-row ${expandedRow === student.id ? 'expanded' : ''} ${isOnLeave ? 'row-on-leave' : ''}`}
                      onClick={() => setExpandedRow(expandedRow === student.id ? null : student.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <span className={`expand-chevron ${expandedRow === student.id ? 'open' : ''}`}>
                          <ChevronRightIcon style={{ fontSize: 18 }} />
                        </span>
                      </td>
                      <td className="image-cell">
                        {student.imageData ? (
                          <img src={student.imageData} alt={student.name} className="avatar" />
                        ) : (
                          <div className="avatar-placeholder">{student.name?.charAt(0) || '?'}</div>
                        )}
                      </td>
                      <td><span className="student-name-cell">{student.name}</span></td>
                      <td><span className="badge badge-blue">{student.studentId || '—'}</span></td>
                      <td><span className="badge badge-purple">{student.class || '—'}</span></td>
                      <td>
                        {student.rfidCardId ? (
                          <span className="rfid-tag" title={student.rfidCardId}>
                            <CreditCardIcon style={{ fontSize: 13 }} />
                            {student.rfidCardId.slice(0, 10)}{student.rfidCardId.length > 10 ? '…' : ''}
                          </span>
                        ) : (
                          <span className="text-muted">Chưa gắn</span>
                        )}
                      </td>
                      <td><span className="text-mono">{student.parentPhone || '—'}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`status-btn ${dispStatus.cls}`}
                          onClick={() => handleStatusCycle(student)}
                          disabled={isOnLeave}
                          title={isOnLeave ? 'Học sinh đang nghỉ phép' : 'Nhấn để chuyển trạng thái'}
                        >
                          <Icon style={{ fontSize: 15 }} />
                          {dispStatus.label}
                        </button>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-icon-danger"
                          onClick={() => handleDelete(student.id, student.name)}
                          title="Xóa học sinh"
                        >
                          <DeleteOutlinedIcon style={{ fontSize: 18 }} />
                        </button>
                      </td>
                    </tr>

                    {expandedRow === student.id && (
                      <tr className="detail-row">
                        <td colSpan={9}>
                          <div className="detail-panel">
                            <div className="detail-grid">
                              <div className="detail-item">
                                <span className="detail-label">Tên phụ huynh</span>
                                <span className="detail-value">{student.parentName || '—'}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">SĐT phụ huynh</span>
                                <span className="detail-value">{student.parentPhone || '—'}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Ngày sinh</span>
                                <span className="detail-value">{student.dateOfBirth || '—'}</span>
                              </div>
                              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                                <span className="detail-label">Mã thẻ RFID</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <span className="detail-value rfid-full">
                                    {student.rfidCardId || 'Chưa gắn thẻ'}
                                  </span>

                                  {rfidEditId === student.id ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      {/* Scanning indicator */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                        <ContactlessIcon style={{ fontSize: 18, color: scannedUid ? 'var(--success)' : 'var(--primary)', animation: scannedUid ? 'none' : 'pulse 1.2s infinite' }} />
                                        {scannedUid
                                          ? <><strong>{scannedUid}</strong>{rfidConflict && <span style={{ color: 'var(--danger)' }}> — Thẻ đã dùng cho {rfidConflict.name}!</span>}</>
                                          : <span style={{ color: 'var(--text-light)' }}>Đặt thẻ lên đầu đọc RFID...</span>
                                        }
                                      </div>
                                      <div style={{ display: 'flex', gap: 6 }}>
                                        <button
                                          className="btn btn-sm btn-primary"
                                          onClick={() => saveRfid(student.id, student.name)}
                                          disabled={!scannedUid || !!rfidConflict || savingRfid}
                                        >
                                          <SaveIcon style={{ fontSize: 14 }} />
                                          {savingRfid ? 'Đang lưu...' : 'Lưu thẻ'}
                                        </button>
                                        <button className="btn btn-sm btn-outline" onClick={cancelRfidEdit}>Hủy</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      className="btn btn-sm btn-outline"
                                      style={{ alignSelf: 'flex-start' }}
                                      onClick={() => startRfidEdit(student.id)}
                                    >
                                      <ContactlessIcon style={{ fontSize: 14 }} />
                                      {student.rfidCardId ? 'Đổi thẻ RFID' : 'Gán thẻ RFID'}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Trạng thái điểm danh</span>
                                <span className={`badge ${dispStatus.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Icon style={{ fontSize: 12 }} />{dispStatus.label}
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Cập nhật lúc</span>
                                <span className="detail-value">
                                  {student.attendanceUpdatedAt?.toDate
                                    ? student.attendanceUpdatedAt.toDate().toLocaleTimeString('vi-VN')
                                    : '—'}
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">GPS học sinh</span>
                                <span className="detail-value">
                                  {student.location
                                    ? `${student.location.lat?.toFixed(5)}, ${student.location.lng?.toFixed(5)}`
                                    : '—'}
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Ngày tạo</span>
                                <span className="detail-value">
                                  {student.createdAt?.toDate
                                    ? student.createdAt.toDate().toLocaleDateString('vi-VN')
                                    : '—'}
                                </span>
                              </div>
                              {isOnLeave && (
                                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                                  <span className="detail-label">Nghỉ phép</span>
                                  <span className="detail-value" style={{ color: 'var(--warning)', fontWeight: 600 }}>
                                    Học sinh đang trong thời gian nghỉ phép được duyệt hôm nay
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MainTable;
