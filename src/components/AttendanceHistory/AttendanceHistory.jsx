import React, { useState, useEffect } from 'react';
import {
  listenToAttendanceRecords,
  deleteAttendanceRecord,
  deleteAllAttendanceRecords,
} from '../../services/attendanceService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HistoryIcon from '@mui/icons-material/History';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import NightlightRoundIcon from '@mui/icons-material/NightlightRound';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import './AttendanceHistory.css';

const SHIFT_LABEL = { morning: 'Sáng', afternoon: 'Chiều' };

const getStatusConfig = (rec) => {
  if (rec.isOnLeave) return { label: 'Nghỉ phép',  cls: 'att-leave',   Icon: EventBusyIcon   };
  if (rec.status === 'present') return { label: 'Có mặt', cls: 'att-present', Icon: CheckCircleIcon };
  return { label: 'Vắng', cls: 'att-absent', Icon: CancelIcon };
};

const AttendanceHistory = () => {
  const { currentUser } = useAuth();

  const [records, setRecords]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [filterShift, setFilterShift]     = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo]   = useState('');
  const [expandedRow, setExpandedRow]     = useState(null);
  const [deleting, setDeleting]           = useState(false);

  useEffect(() => {
    const unsub = listenToAttendanceRecords((data) => {
      setRecords(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  const filtered = records.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.studentName?.toLowerCase().includes(q) && !r.studentId?.toLowerCase().includes(q)) return false;
    }
    if (filterShift && r.shift !== filterShift) return false;
    if (filterDateFrom && r.date < filterDateFrom) return false;
    if (filterDateTo   && r.date > filterDateTo)   return false;
    if (filterStatus === 'present' && (r.isOnLeave || r.status !== 'present')) return false;
    if (filterStatus === 'absent'  && (r.isOnLeave || r.status === 'present')) return false;
    if (filterStatus === 'leave'   && !r.isOnLeave)                            return false;
    return true;
  });

  const stats = {
    total:     filtered.length,
    present:   filtered.filter((r) => !r.isOnLeave && r.status === 'present').length,
    absent:    filtered.filter((r) => !r.isOnLeave && r.status !== 'present').length,
    leave:     filtered.filter((r) => r.isOnLeave).length,
    morning:   filtered.filter((r) => r.shift === 'morning').length,
    afternoon: filtered.filter((r) => r.shift === 'afternoon').length,
  };

  const hasFilter = search || filterShift || filterStatus || filterDateFrom || filterDateTo;
  const clearFilters = () => {
    setSearch(''); setFilterShift(''); setFilterStatus('');
    setFilterDateFrom(''); setFilterDateTo('');
  };

  const handleDelete = async (docId, studentName) => {
    if (!window.confirm(`Xóa bản ghi điểm danh của "${studentName}"?`)) return;
    try {
      await deleteAttendanceRecord(docId);
      if (currentUser) await addLog(currentUser.uid, `Xóa lịch sử điểm danh: ${studentName} (${docId})`);
      if (expandedRow === docId) setExpandedRow(null);
    } catch (err) { console.error(err); }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(
      `Xóa toàn bộ ${records.length} bản ghi lịch sử điểm danh?\n\nThao tác này không thể hoàn tác!`
    )) return;
    setDeleting(true);
    try {
      await deleteAllAttendanceRecords();
      if (currentUser) await addLog(currentUser.uid, `Xóa toàn bộ lịch sử điểm danh (${records.length} bản ghi)`);
    } catch (err) { console.error(err); }
    finally { setDeleting(false); }
  };

  const handleExportCSV = () => {
    const header = ['Ngày', 'Ca', 'Mã HS', 'Họ Tên', 'Trạng thái', 'Lên xe lúc', 'Xuống xe lúc', 'Vị trí lên xe', 'Vị trí xuống xe'];
    const rows = filtered.map((r) => {
      const statusLabel = r.isOnLeave ? 'Nghỉ phép' : r.status === 'present' ? 'Có mặt' : 'Vắng';
      const locBoard  = r.boardedLat  && r.boardedLng  ? `${r.boardedLat},${r.boardedLng}`   : '';
      const locAlight = r.alightedLat && r.alightedLng ? `${r.alightedLat},${r.alightedLng}` : '';
      return [
        r.date        || '',
        SHIFT_LABEL[r.shift] || r.shift || '',
        r.studentId   || '',
        r.studentName || '',
        statusLabel,
        r.boardedAt   || '',
        r.alightedAt  || '',
        locBoard,
        locAlight,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv  = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `diem_danh_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-state"><div className="spinner" /><p>Đang tải lịch sử điểm danh...</p></div>
      </div>
    );
  }

  return (
    <div className="page-container">

      {/* Header */}
      <div className="page-header">
        <h2 className="page-title">Lịch sử điểm danh</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={handleExportCSV}
            disabled={filtered.length === 0}
          >
            <DownloadIcon style={{ fontSize: 16 }} />
            Xuất CSV ({filtered.length})
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleDeleteAll}
            disabled={deleting || records.length === 0}
          >
            <DeleteSweepIcon style={{ fontSize: 16 }} />
            {deleting ? 'Đang xóa...' : `Xóa tất cả (${records.length})`}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-pill total">
          <span className="stat-pill-label">Tổng bản ghi</span>
          <span className="stat-pill-value">{stats.total}</span>
        </div>
        <div className="stat-pill arrived">
          <span className="stat-pill-label">Có mặt</span>
          <span className="stat-pill-value">{stats.present}</span>
        </div>
        <div className="stat-pill not-boarded">
          <span className="stat-pill-label">Vắng</span>
          <span className="stat-pill-value">{stats.absent}</span>
        </div>
        <div className="stat-pill absent">
          <span className="stat-pill-label">Nghỉ phép</span>
          <span className="stat-pill-value">{stats.leave}</span>
        </div>
        <div className="stat-pill boarded">
          <span className="stat-pill-label">Ca sáng / chiều</span>
          <span className="stat-pill-value">{stats.morning} / {stats.afternoon}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar att-filter-bar">
        <div className="search-box">
          <span className="search-icon"><SearchIcon /></span>
          <input
            type="text"
            placeholder="Tìm tên, mã học sinh..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          className="filter-select"
          title="Từ ngày"
        />
        <span className="att-date-sep">→</span>
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          className="filter-select"
          title="Đến ngày"
        />
        <select value={filterShift} onChange={(e) => setFilterShift(e.target.value)} className="filter-select">
          <option value="">Tất cả ca</option>
          <option value="morning">Ca sáng</option>
          <option value="afternoon">Ca chiều</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-select">
          <option value="">Tất cả trạng thái</option>
          <option value="present">Có mặt</option>
          <option value="absent">Vắng</option>
          <option value="leave">Nghỉ phép</option>
        </select>
        {hasFilter && (
          <button className="btn btn-outline btn-sm" onClick={clearFilters}>
            Xóa bộ lọc
          </button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <HistoryIcon style={{ fontSize: 60, color: '#CBD5E1', marginBottom: 12 }} />
            <p>{records.length === 0 ? 'Chưa có lịch sử điểm danh' : 'Không tìm thấy bản ghi nào'}</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th style={{ width: 56 }}>Ảnh</th>
                <th>Ngày</th>
                <th>Ca</th>
                <th>Họ Tên</th>
                <th>Mã HS</th>
                <th>Trạng Thái</th>
                <th>Lên xe lúc</th>
                <th>Xuống xe lúc</th>
                <th style={{ width: 56 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const cfg        = getStatusConfig(r);
                const { Icon }   = cfg;
                const isExpanded = expandedRow === r.id;

                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className={`table-row ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <span className={`expand-chevron ${isExpanded ? 'open' : ''}`}>
                          <ChevronRightIcon style={{ fontSize: 18 }} />
                        </span>
                      </td>

                      {/* Ảnh */}
                      <td className="image-cell">
                        {r.imageData ? (
                          <img src={r.imageData} alt={r.studentName} className="avatar" />
                        ) : (
                          <div className="avatar-placeholder">{r.studentName?.charAt(0) || '?'}</div>
                        )}
                      </td>

                      {/* Ngày */}
                      <td><span className="text-mono">{r.date || '—'}</span></td>

                      {/* Ca */}
                      <td>
                        {r.shift === 'morning' && (
                          <span className="att-shift-badge att-shift-morning">
                            <WbSunnyIcon style={{ fontSize: 13 }} /> Sáng
                          </span>
                        )}
                        {r.shift === 'afternoon' && (
                          <span className="att-shift-badge att-shift-afternoon">
                            <NightlightRoundIcon style={{ fontSize: 13 }} /> Chiều
                          </span>
                        )}
                        {!r.shift && <span className="text-muted-sm">—</span>}
                      </td>

                      {/* Họ tên */}
                      <td><span className="student-name-cell">{r.studentName || '—'}</span></td>

                      {/* Mã HS */}
                      <td><span className="badge badge-blue">{r.studentId || '—'}</span></td>

                      {/* Trạng thái */}
                      <td>
                        <span className={`att-status-badge ${cfg.cls}`}>
                          <Icon style={{ fontSize: 14 }} />
                          {cfg.label}
                        </span>
                      </td>

                      {/* Lên xe */}
                      <td><span className="text-mono">{r.boardedAt || '—'}</span></td>

                      {/* Xuống xe */}
                      <td><span className="text-mono">{r.alightedAt || '—'}</span></td>

                      {/* Xóa */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-icon-danger"
                          onClick={() => handleDelete(r.id, r.studentName)}
                          title="Xóa bản ghi này"
                        >
                          <DeleteOutlinedIcon style={{ fontSize: 18 }} />
                        </button>
                      </td>
                    </tr>

                    {/* Detail row */}
                    {isExpanded && (
                      <tr className="detail-row">
                        <td colSpan={10}>
                          <div className="detail-panel">
                            <div className="att-detail-body">

                              {/* Ảnh lớn */}
                              {r.imageData && (
                                <img
                                  src={r.imageData}
                                  alt={r.studentName}
                                  className="att-detail-img"
                                />
                              )}

                              <div className="detail-grid" style={{ flex: 1 }}>
                                <div className="detail-item">
                                  <span className="detail-label">Mã bản ghi</span>
                                  <span className="detail-value att-record-id">{r.id}</span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">Ngày / Ca</span>
                                  <span className="detail-value">
                                    {r.date} — {SHIFT_LABEL[r.shift] || r.shift || '—'}
                                  </span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">Vị trí lên xe</span>
                                  <span className="detail-value">
                                    {r.boardedLat && r.boardedLng ? (
                                      <>
                                        <LocationOnIcon style={{ fontSize: 13, color: 'var(--primary)', verticalAlign: 'middle' }} />
                                        {' '}{Number(r.boardedLat).toFixed(5)}, {Number(r.boardedLng).toFixed(5)}
                                      </>
                                    ) : '—'}
                                  </span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">Vị trí xuống xe</span>
                                  <span className="detail-value">
                                    {r.alightedLat && r.alightedLng ? (
                                      <>
                                        <LocationOnIcon style={{ fontSize: 13, color: '#10B981', verticalAlign: 'middle' }} />
                                        {' '}{Number(r.alightedLat).toFixed(5)}, {Number(r.alightedLng).toFixed(5)}
                                      </>
                                    ) : '—'}
                                  </span>
                                </div>
                              </div>
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

export default AttendanceHistory;
