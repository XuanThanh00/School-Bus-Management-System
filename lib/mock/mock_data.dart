// Mock data — some fields still used by account_screen and leave_screen

class StudentModel {
  final String id;
  final String fullName;
  final String className;
  final String uid;
  final String photoUrl;
  final AttendanceStatus status;
  final String? checkedAt;
  final String? route;

  const StudentModel({
    required this.id,
    required this.fullName,
    required this.className,
    required this.uid,
    required this.photoUrl,
    required this.status,
    this.checkedAt,
    this.route,
  });
}

enum AttendanceStatus {
  present,       // Arrived at school (boarded and alighted)
  absent,        // Absent without leave
  onBus,         // On the bus (boarded, not yet alighted)
  waiting,       // Waiting to board (bus running, not yet checked in)
  holiday,       // No school (weekend)
  approvedLeave, // Excused absence (leave approved)
  pendingLeave,  // Leave pending approval
  error,         // Data error
  unknown,       // Unknown
}

class LeaveRequest {
  final String id;
  final String date;
  final String reason;
  final LeaveStatus status;

  const LeaveRequest({
    required this.id,
    required this.date,
    required this.reason,
    required this.status,
  });
}

enum LeaveStatus { approved, pending, rejected }

class BusLocation {
  final double lat;
  final double lng;
  final String nextStop;
  final String eta;
  final String driverName;
  final String minutesToNext;

  const BusLocation({
    required this.lat,
    required this.lng,
    required this.nextStop,
    required this.eta,
    required this.driverName,
    required this.minutesToNext,
  });
}

// ── Mock data ──────────────────────────────────────────

final mockStudent = StudentModel(
  id: 'hs001',
  fullName: 'Võ Minh Thái',
  className: '1A2',
  uid: 'FF8E4C1E',
  photoUrl: '',
  status: AttendanceStatus.present,
  checkedAt: '07:32',
  route: 'Tuyến 01',
);

final mockLeaveHistory = [
  LeaveRequest(
    id: 'lr001',
    date: '01/04/2026',
    reason: 'Bé ốm, sốt cao',
    status: LeaveStatus.approved,
  ),
  LeaveRequest(
    id: 'lr002',
    date: '20/03/2026',
    reason: 'Việc gia đình',
    status: LeaveStatus.pending,
  ),
  LeaveRequest(
    id: 'lr003',
    date: '05/03/2026',
    reason: 'Khám sức khỏe',
    status: LeaveStatus.approved,
  ),
];

final mockBus = BusLocation(
  lat: 10.7769,
  lng: 106.7009,
  nextStop: 'Trạm B – Nguyễn Thị Minh Khai',
  eta: '07:45',
  driverName: 'Nguyễn Văn Bình',
  minutesToNext: '3',
);

const mockParentName = 'Phương Nguyễn';
const mockParentEmail = 'phuong.nguyen@gmail.com';
const mockParentPhone = '0901 234 567';