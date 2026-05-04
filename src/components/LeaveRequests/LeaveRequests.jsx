import React, { useState, useEffect } from 'react';
import {
  listenToLeaveRequests, rejectLeaveRequest, approveLeaveRequest, deleteLeaveRequest,
} from '../../services/leaveRequestService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArticleIcon from '@mui/icons-material/Article';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoIcon from '@mui/icons-material/Info';
import './LeaveRequests.css';

const STATUS_TABS = [
  { key: null,       label: 'Tất Cả' },
  { key: 'pending',  label: 'Chờ Duyệt' },
  { key: 'approved', label: 'Đã Duyệt' },
  { key: 'rejected', label: 'Bị Từ Chối' },
];

const statusBadge = (status) => {
  const map = {
    approved: { label: 'Đã duyệt', cls: 'badge-green' },
    rejected: { label: 'Từ chối',       cls: 'badge-red' },
    pending:  { label: 'Chờ duyệt',     cls: 'badge-warning' },
  };
  return map[status] || { label: status, cls: 'badge-gray' };
};

const statusRowClass = (status) => ({
  approved: 'leave-row-approved',
  rejected: 'leave-row-rejected',
  pending:  'leave-row-pending',
})[status] || '';

const LeaveRequests = () => {
  const { currentUser }           = useAuth();
  const [requests, setRequests]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState(null);
  const [selectedReq, setSelectedReq]   = useState(null);
  const [adminNote, setAdminNote]   = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess]       = useState('');
  const [error, setError]           = useState('');

  useEffect(() => {
    const unsub = listenToLeaveRequests((data) => { setRequests(data); setLoading(false); }, statusFilter);
    return unsub;
  }, [statusFilter]);

  const handleReject = async () => {
    if (!selectedReq) return;
    setProcessing(true);
    try {
      await rejectLeaveRequest(selectedReq.id, adminNote, currentUser?.uid);
      if (currentUser) await addLog(currentUser.uid, `Từ chối đơn nghỉ: ${selectedReq.studentName}`);
      flash('Đã từ chối đơn xin nghỉ');
      closeModal();
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const handleReApprove = async () => {
    if (!selectedReq) return;
    setProcessing(true);
    try {
      await approveLeaveRequest(selectedReq.id, '', currentUser?.uid);
      if (currentUser) await addLog(currentUser.uid, `Duyệt lại đơn nghỉ: ${selectedReq.studentName}`);
      flash('Đã duyệt lại đơn xin nghỉ');
      closeModal();
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const handleDelete = async () => {
    if (!selectedReq) return;
    if (!window.confirm(`Xóa đơn của ${selectedReq.studentName}?`)) return;
    setProcessing(true);
    try {
      await deleteLeaveRequest(selectedReq.id);
      if (currentUser) await addLog(currentUser.uid, `Xóa đơn nghỉ: ${selectedReq.studentName}`);
      flash('Đã xóa đơn xin nghỉ');
      closeModal();
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const openModal  = (req) => { setSelectedReq(req); setAdminNote(req.adminNote || ''); setError(''); };
  const closeModal = ()    => { setSelectedReq(null); setAdminNote(''); };
  const flash      = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const formatDate = (val) => {
    if (!val) return '—';
    if (val?.toDate) return val.toDate().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '/');
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const [y, m, d] = val.split('-');
      return `${d}/${m}/${y}`;
    }
    return val;
  };

  const approvedCount = requests.filter((r) => r.status === 'approved').length;
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length;

  if (loading) {
    return <div className="page-container"><div className="loading-state"><div className="spinner" /><p>Đang tải...</p></div></div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">
            <EventBusyIcon style={{ fontSize: 26, verticalAlign: 'middle', marginRight: 8 }} />
            Đơn xin nghỉ học
          </h2>
        </div>
      </div>


      {/* Stats */}
      <div className="leave-stats-row">
        <div className="leave-stat approved">
          <CheckCircleIcon style={{ fontSize: 22 }} />
          <span><strong>{approvedCount}</strong> Đã duyệt</span>
        </div>
        <div className="leave-stat rejected">
          <CancelIcon style={{ fontSize: 22 }} />
          <span><strong>{rejectedCount}</strong> Từ chối</span>
        </div>
      </div>

      {success && <div className="alert alert-success">{success}</div>}

      {/* Status tabs */}
      <div className="tab-bar">
        {STATUS_TABS.map((tab) => (
          <button
            key={String(tab.key)}
            className={`tab-btn ${statusFilter === tab.key ? 'active' : ''}`}
            onClick={() => setStatusFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className="empty-state">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <ArticleIcon style={{ fontSize: 60, color: '#CBD5E1', marginBottom: 12 }} />
            <p>Không có đơn nào</p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Học Sinh</th>
                <th>Lớp</th>
                <th>Phụ Huynh</th>
                <th>Ngày Nghỉ</th>
                <th>Lý Do</th>
                <th>Nộp Lúc</th>
                <th>Trạng Thái</th>
                <th style={{ width: 100 }}>Chi Tiết</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => {
                const { label, cls } = statusBadge(req.status);
                return (
                  <tr key={req.id} className={`table-row ${statusRowClass(req.status)}`}>
                    <td><strong>{req.studentName}</strong></td>
                    <td><span className="badge badge-purple">{req.studentClass}</span></td>
                    <td>
                      <div>{req.parentName}</div>
                      <div className="text-muted-sm">{req.parentPhone}</div>
                    </td>
                    <td>
                      <div>{formatDate(req.startDate)}</div>
                      {req.endDate && req.endDate !== req.startDate && (
                        <div className="text-muted-sm">→ {formatDate(req.endDate)}</div>
                      )}
                    </td>
                    <td style={{ maxWidth: 180 }}>
                      <span title={req.reason} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {req.reason}
                      </span>
                    </td>
                    <td className="text-muted-sm">{formatDate(req.createdAt)}</td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline leave-action-btn"
                        onClick={() => openModal(req)}
                      >
                        <VisibilityIcon style={{ fontSize: 15 }} />
                        Chi Tiết
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {selectedReq && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chi Tiết Đơn Xin Nghỉ</h3>
              <button className="modal-close" onClick={closeModal}>
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="detail-grid" style={{ marginBottom: 20 }}>
              <div className="detail-item">
                <span className="detail-label">Học sinh</span>
                <span className="detail-value"><strong>{selectedReq.studentName}</strong></span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Lớp</span>
                <span className="detail-value">{selectedReq.studentClass}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Phụ huynh</span>
                <span className="detail-value">{selectedReq.parentName}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">SĐT</span>
                <span className="detail-value">{selectedReq.parentPhone}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Từ ngày</span>
                <span className="detail-value">{formatDate(selectedReq.startDate)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Đến ngày</span>
                <span className="detail-value">{formatDate(selectedReq.endDate || selectedReq.startDate)}</span>
              </div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <span className="detail-label">Lý do</span>
                <span className="detail-value">{selectedReq.reason}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Trạng thái</span>
                <span className={`badge ${statusBadge(selectedReq.status).cls}`}>
                  {statusBadge(selectedReq.status).label}
                </span>
              </div>
              {selectedReq.adminNote && selectedReq.adminNote !== 'Tự động duyệt' && (
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="detail-label">Ghi chú admin</span>
                  <span className="detail-value">{selectedReq.adminNote}</span>
                </div>
              )}
            </div>

            {/* Auto-approved info */}
            {selectedReq.status === 'approved' && selectedReq.reviewedBy === 'auto' && (
              <div className="info-box info-box-green" style={{ marginBottom: 16 }}>
                <InfoIcon style={{ fontSize: 16, color: 'var(--success)' }} />
                <p style={{ margin: 0, fontSize: 14 }}>
                  Đơn này được tự động duyệt. Học sinh sẽ được đánh dấu vắng phép trong ngày nghỉ.
                </p>
              </div>
            )}

            {/* Admin actions */}
            <div className="form-actions">
              {selectedReq.status === 'pending' && (
                <>
                  <button
                    className="btn btn-success btn-approve"
                    onClick={handleReApprove}
                    disabled={processing}
                  >
                    <CheckCircleIcon />
                    {processing ? '...' : 'Duyệt Đơn'}
                  </button>
                  <button
                    className="btn btn-danger btn-reject"
                    onClick={handleReject}
                    disabled={processing}
                  >
                    <CancelIcon />
                    {processing ? '...' : 'Từ Chối'}
                  </button>
                </>
              )}
              {selectedReq.status === 'approved' && (
                <button
                  className="btn btn-danger btn-reject"
                  onClick={handleReject}
                  disabled={processing}
                >
                  <CancelIcon />
                  {processing ? '...' : 'Từ Chối Đơn Này'}
                </button>
              )}
              {selectedReq.status === 'rejected' && (
                <>
                  <div className="form-group" style={{ flex: 1 }}>
                    <textarea
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Ghi chú (tùy chọn)"
                      rows={2}
                      className="textarea"
                    />
                  </div>
                  <button
                    className="btn btn-success btn-approve"
                    onClick={handleReApprove}
                    disabled={processing}
                  >
                    <CheckCircleIcon />
                    {processing ? '...' : 'Duyệt Lại'}
                  </button>
                </>
              )}
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={processing}
                style={{ marginLeft: 'auto' }}
              >
                <DeleteIcon style={{ fontSize: 16 }} />
                {processing ? '...' : 'Xóa Đơn'}
              </button>
              <button className="btn btn-outline" onClick={closeModal}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveRequests;
