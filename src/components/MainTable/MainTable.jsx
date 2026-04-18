import React, { useState, useEffect } from 'react';
import { listenToStudents, updateStudentStatus, deleteStudent } from '../../services/studentService';
import { useAuth } from '../../hooks/useAuth';
import { addLog } from '../../services/logService';

const MainTable = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState('');
  const { currentUser } = useAuth();

  useEffect(() => {
    const unsubscribe = listenToStudents((data) => {
      setStudents(data);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const handleStatusToggle = async (studentId, currentStatus) => {
    try {
      const newStatus = !currentStatus;
      await updateStudentStatus(studentId, newStatus);
      
      if (currentUser) {
        const statusText = newStatus ? 'Cập nhật trạng thái: Đã đến' : 'Cập nhật trạng thái: Chưa đến';
        await addLog(currentUser.uid, statusText);
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleDelete = async (studentId) => {
    if (window.confirm('Bạn chắc chắn muốn xóa học sinh này?')) {
      try {
        await deleteStudent(studentId);
        
        if (currentUser) {
          await addLog(currentUser.uid, 'Xóa học sinh');
        }
      } catch (error) {
        console.error('Error deleting student:', error);
      }
    }
  };

  const filteredStudents = filterClass
    ? students.filter(s => s.class === filterClass)
    : students;

  const uniqueClasses = [...new Set(students.map(s => s.class))];

  if (loading) return <div className="loading">Đang tải dữ liệu...</div>;

  return (
    <div className="main-table">
      <h2>Danh Sách Học Sinh</h2>

      <div className="filter-section">
        <label>Lọc theo lớp:</label>
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
          <option value="">Tất cả lớp</option>
          {uniqueClasses.map(className => (
            <option key={className} value={className}>{className}</option>
          ))}
        </select>
        <span className="student-count">Tổng: {filteredStudents.length} học sinh</span>
      </div>

      {filteredStudents.length === 0 ? (
        <div className="empty-state">Không có học sinh nào</div>
      ) : (
        <table className="students-table">
          <thead>
            <tr>
              <th>Ảnh</th>
              <th>Họ Tên</th>
              <th>Lớp</th>
              <th>Trạng Thái Đến Trường</th>
              <th>Hành Động</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map(student => (
              <tr key={student.id}>
                <td className="image-cell">
                  {student.imageData ? (
                    <img src={student.imageData} alt={student.name} />
                  ) : (
                    <div className="no-image">Không ảnh</div>
                  )}
                </td>
                <td>{student.name}</td>
                <td>{student.class}</td>
                <td>
                  <button
                    className={`status-btn ${student.status ? 'present' : 'absent'}`}
                    onClick={() => handleStatusToggle(student.id, student.status)}
                  >
                    {student.status ? '✅ Đã đến' : '❌ Chưa đến'}
                  </button>
                </td>
                <td>
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(student.id)}
                  >
                    🗑️ Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default MainTable;
