import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../theme/app_theme.dart';
import '../mock/mock_data.dart';
import '../widgets/shared_widgets.dart';
import '../services/notification_service.dart';

// ── Models ────────────────────────────────────────────

class _StudentData {
  final String docId;
  final String studentId;
  final String name;
  final String className;
  final String dateOfBirth;
  final String attendanceStatus;
  final String? imageData;

  const _StudentData({
    required this.docId,
    required this.studentId,
    required this.name,
    required this.className,
    required this.dateOfBirth,
    required this.attendanceStatus,
    this.imageData,
  });

  factory _StudentData.fromDoc(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    return _StudentData(
      docId: doc.id,
      studentId: d['studentId']?.toString() ?? '',
      name: d['name']?.toString() ?? '',
      className: d['class']?.toString() ?? '',
      dateOfBirth: d['dateOfBirth']?.toString() ?? '',
      attendanceStatus: d['attendanceStatus']?.toString() ?? 'not_boarded',
      imageData: d['imageData']?.toString(),
    );
  }
}

class _AttendanceRecord {
  final String? boardedAt;
  final String? alightedAt;
  final double? boardedLat;
  final double? boardedLng;
  final double? alightedLat;
  final double? alightedLng;
  final String? imageData; // data:image/jpeg;base64,… format

  const _AttendanceRecord({
    this.boardedAt,
    this.alightedAt,
    this.boardedLat,
    this.boardedLng,
    this.alightedLat,
    this.alightedLng,
    this.imageData,
  });

  factory _AttendanceRecord.fromMap(Map<String, dynamic> map) {
    String? extractTime(dynamic v) {
      if (v == null) return null;
      if (v is Timestamp) {
        final dt = v.toDate();
        return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
      }
      final s = v.toString();
      return s.isEmpty ? null : s;
    }

    double? extractDouble(dynamic v) {
      if (v == null) return null;
      return (v as num?)?.toDouble();
    }

    final img = map['imageData']?.toString() ?? '';
    return _AttendanceRecord(
      boardedAt:   extractTime(map['boardedAt']),
      alightedAt:  extractTime(map['alightedAt'] ?? map['arrivedAt']),
      boardedLat:  extractDouble(map['boardedLat']),
      boardedLng:  extractDouble(map['boardedLng']),
      alightedLat: extractDouble(map['alightedLat']),
      alightedLng: extractDouble(map['alightedLng']),
      imageData:   img.isNotEmpty ? img : null,
    );
  }

  bool get hasBoardedGps => boardedLat != null && boardedLng != null;
  bool get hasAlightedGps => alightedLat != null && alightedLng != null;

  String get boardedGpsText =>
      hasBoardedGps ? '${boardedLat!.toStringAsFixed(5)}, ${boardedLng!.toStringAsFixed(5)}' : '';
  String get alightedGpsText =>
      hasAlightedGps ? '${alightedLat!.toStringAsFixed(5)}, ${alightedLng!.toStringAsFixed(5)}' : '';
}

// ── Screen ────────────────────────────────────────────

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  StreamSubscription? _studentSub;
  StreamSubscription? _morningSub;
  StreamSubscription? _afternoonSub;
  StreamSubscription? _leaveSub;

  String? _parentName;
  _StudentData? _student;
  _AttendanceRecord? _morningRecord;
  _AttendanceRecord? _afternoonRecord;
  String? _todayLeaveStatus; // "approved" | "pending" | null
  bool _initialLoading = true;
  String? _error;

  // Last 7 days excluding today
  List<({String dateKey, String dateLabel,
         _AttendanceRecord? morning, _AttendanceRecord? afternoon})> _weekHistory = [];

  String get _todayDateKey {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _studentSub?.cancel();
    _morningSub?.cancel();
    _afternoonSub?.cancel();
    _leaveSub?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() { _initialLoading = true; _error = null; });
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập');

      final fs = FirebaseFirestore.instance;

      // Step 1: find parent doc by email
      final parentSnap = await fs
          .collection('parents')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();

      if (parentSnap.docs.isEmpty) {
        throw Exception('Không tìm thấy thông tin phụ huynh');
      }

      final parentDoc  = parentSnap.docs.first;
      final parentData = parentDoc.data();
      final parentName = parentData['displayName']?.toString() ?? '';
      final studentIds = List<String>.from(parentData['studentIds'] ?? []);
      NotificationService.init(parentDoc.id);
      // Stream leave requests
      _leaveSub?.cancel();
      _leaveSub = fs
          .collection('leaveRequests')
          .where('parentId', isEqualTo: parentDoc.id)
          .snapshots()
          .listen((snap) {
        if (!mounted) return;
        final today = _todayDateKey;
        String? leaveStatus;
        for (final doc in snap.docs) {
          final d     = doc.data();
          final start = d['startDate']?.toString() ?? '';
          final end   = d['endDate']?.toString() ?? '';
          if (start.compareTo(today) <= 0 && end.compareTo(today) >= 0) {
            final s = d['status']?.toString() ?? '';
            if (s == 'approved') { leaveStatus = 'approved'; break; }
            if (s == 'pending') leaveStatus = 'pending';
          }
        }
        setState(() => _todayLeaveStatus = leaveStatus);
      }, onError: (_) {});

      if (studentIds.isEmpty) {
        throw Exception('Tài khoản chưa được liên kết với học sinh nào');
      }

      // Step 2: stream student doc (real-time)
      _studentSub?.cancel();
      _studentSub = fs
          .collection('students')
          .where('studentId', isEqualTo: studentIds.first)
          .limit(1)
          .snapshots()
          .listen((snap) {
        if (!mounted) return;
        if (snap.docs.isEmpty) {
          setState(() {
            _error = 'Không tìm thấy dữ liệu học sinh';
            _initialLoading = false;
          });
          return;
        }

        final student = _StudentData.fromDoc(snap.docs.first);

        // Step 3: stream today's morning + afternoon docs
        // Doc ID: {YYYY-MM-DD}_{morning|afternoon}_{studentId}
        final sid = student.studentId;
        void listenRecord(String docId, bool isMorning) {
          final sub = fs.collection('attendanceRecords').doc(docId)
              .snapshots()
              .listen((doc) {
            if (!mounted) return;
            final rec = (doc.exists && doc.data() != null)
                ? _AttendanceRecord.fromMap(doc.data()!) : null;
            setState(() {
              if (isMorning) _morningRecord   = rec;
              else           _afternoonRecord = rec;
            });
          }, onError: (_) {});
          if (isMorning) {
            _morningSub?.cancel();
            _morningSub = sub;
          } else {
            _afternoonSub?.cancel();
            _afternoonSub = sub;
          }
        }
        listenRecord('${_todayDateKey}_morning_$sid',   true);
        listenRecord('${_todayDateKey}_afternoon_$sid', false);

        if (mounted) {
          setState(() {
            _parentName      = parentName;
            _student         = student;
            _error           = null;
            _initialLoading  = false;
          });
          _loadWeekHistory(student.studentId);
        }
      }, onError: (e) {
        if (mounted) setState(() { _error = e.toString(); _initialLoading = false; });
      });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _initialLoading = false; });
    }
  }

  Future<void> _loadWeekHistory(String studentId) async {
    if (studentId.isEmpty) return;
    final fs  = FirebaseFirestore.instance;
    final now = DateTime.now();
    const days = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

    _AttendanceRecord? _rec(DocumentSnapshot doc) =>
        (doc.exists && doc.data() != null)
            ? _AttendanceRecord.fromMap(doc.data()! as Map<String, dynamic>)
            : null;

    final futures = List.generate(7, (i) {
      final d     = now.subtract(Duration(days: i + 1));
      final key   = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      final label = '${days[d.weekday]} ${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
      return Future.wait([
        fs.collection('attendanceRecords').doc('${key}_morning_$studentId').get(),
        fs.collection('attendanceRecords').doc('${key}_afternoon_$studentId').get(),
      ]).then((docs) => (
            dateKey:   key,
            dateLabel: label,
            morning:   _rec(docs[0]),
            afternoon: _rec(docs[1]),
          ));
    });

    final results = await Future.wait(futures);
    if (mounted) setState(() => _weekHistory = results);
  }

  // ── Status logic ──────────────────────────────────────
  // Afternoon takes priority over morning (most recent trip).
  // students.attendanceStatus is not used — it doesn't reset daily.
  AttendanceStatus get _statusEnum {
    if (_isWeekend) return AttendanceStatus.holiday;
    if (_todayLeaveStatus == 'approved') return AttendanceStatus.approvedLeave;
    if (_todayLeaveStatus == 'pending')  return AttendanceStatus.pendingLeave;
    // Afternoon first (most recent trip)
    if (_afternoonRecord != null) {
      if (_afternoonRecord!.alightedAt != null) return AttendanceStatus.present;
      if (_afternoonRecord!.boardedAt  != null) return AttendanceStatus.onBus;
    }
    if (_morningRecord != null) {
      if (_morningRecord!.alightedAt != null) return AttendanceStatus.present;
      if (_morningRecord!.boardedAt  != null) return AttendanceStatus.onBus;
    }
    return _isBusRunning ? AttendanceStatus.waiting : AttendanceStatus.unknown;
  }

  bool get _isWeekend {
    final w = DateTime.now().weekday;
    return w == DateTime.saturday || w == DateTime.sunday;
  }

  bool get _isBusRunning {
    final now     = DateTime.now();
    final minutes = now.hour * 60 + now.minute;
    final morning   = minutes >= 6 * 60 + 30 && minutes <= 8 * 60;
    final afternoon = minutes >= 16 * 60 + 30 && minutes <= 18 * 60;
    return morning || afternoon;
  }

  String _todayVN() {
    final now  = DateTime.now();
    const days = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
    return '${days[now.weekday]}, ${now.day.toString().padLeft(2, '0')}/${now.month.toString().padLeft(2, '0')}/${now.year}';
  }

  @override
  Widget build(BuildContext context) {
    if (_initialLoading) {
      return const Scaffold(
        backgroundColor: AppColors.bg,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null && _student == null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: _ErrorView(error: _error!, onRetry: _loadData),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 130,
            pinned: true,
            backgroundColor: AppColors.primary,
            flexibleSpace: FlexibleSpaceBar(background: _buildHeader()),
            actions: [
              IconButton(
                icon: const Icon(Icons.notifications_outlined,
                    color: Colors.white, size: 24),
                onPressed: () {},
              ),
              const SizedBox(width: 4),
            ],
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                _buildStudentCard(),
                const SizedBox(height: 16),
                const SectionTitle('HOẠT ĐỘNG HÔM NAY'),
                _buildTimeline(),
                const SizedBox(height: 16),
                const SectionTitle('LỊCH SỬ ĐIỂM DANH'),
                _buildWeekHistory(),
                const SizedBox(height: 80),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(color: AppColors.primary),
      padding: const EdgeInsets.fromLTRB(20, 52, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Text('Xin chào, ${_parentName ?? ''} 👋',
              style: GoogleFonts.dmSans(
                  fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white)),
          const SizedBox(height: 2),
          Text(_todayVN(),
              style: GoogleFonts.dmSans(
                  fontSize: 13, color: Colors.white.withValues(alpha: 0.75))),
        ],
      ),
    );
  }

  Widget _buildStudentCard() {
    final student = _student;
    if (student == null) return const SizedBox.shrink();

    final status   = _statusEnum;
    final hasMorning   = _morningRecord?.boardedAt != null;
    final hasAfternoon = _afternoonRecord?.boardedAt != null;

    return AppCard(
      child: Column(
        children: [
          // Avatar + name + status badge
          Row(
            children: [
              _buildAvatar(student),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(student.name,
                        style: GoogleFonts.dmSans(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textMain)),
                    const SizedBox(height: 2),
                    Text('Lớp ${student.className}  ·  ${student.dateOfBirth}',
                        style: GoogleFonts.dmSans(
                            fontSize: 12, color: AppColors.textSub)),
                  ],
                ),
              ),
              StatusBadge(status),
            ],
          ),

          if (hasMorning || hasAfternoon) ...[
            const SizedBox(height: 14),
            const Divider(height: 1, color: AppColors.border),
            const SizedBox(height: 10),

            // Morning trip
            if (hasMorning)
              _SessionRow(
                label: 'Sáng',
                record: _morningRecord!,
              ),

            if (hasMorning && hasAfternoon)
              const SizedBox(height: 8),

            // Afternoon trip
            if (hasAfternoon)
              _SessionRow(
                label: 'Chiều',
                record: _afternoonRecord!,
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildAvatar(_StudentData student) {
    if (student.imageData != null && student.imageData!.contains(',')) {
      try {
        final bytes = base64Decode(student.imageData!.split(',').last);
        return ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: Image.memory(bytes, width: 56, height: 56, fit: BoxFit.cover),
        );
      } catch (_) {}
    }
    return StudentAvatar(name: student.name, size: 56);
  }

  Widget _buildTimeline() {
    final status      = _statusEnum;
    final studentName = _student?.name ?? '';

    if (status == AttendanceStatus.holiday) {
      return AppCard(child: _centeredText('Hôm nay không đi học'));
    }
    if (status == AttendanceStatus.approvedLeave) {
      return AppCard(child: _centeredText('Hôm nay nghỉ có phép'));
    }

    List<Widget> buildItems(String departureTime, _AttendanceRecord? rec,
        {required bool isMorning}) {
      final isBoarded  = rec?.boardedAt  != null;
      final isAlighted = rec?.alightedAt != null;
      final boardEvent   = isMorning
          ? '$studentName lên xe (tại trạm)'
          : '$studentName lên xe tại trường';
      final alightEvent  = isMorning
          ? '$studentName xuống xe tại trường'
          : '$studentName xuống xe về nhà';
      final departEvent  = isMorning
          ? 'Xe buýt xuất phát đón học sinh'
          : 'Xe buýt xuất phát từ trường';
      final items = [
        (time: departureTime, event: departEvent, done: true, gps: ''),
        (
          time:  isBoarded ? (rec!.boardedAt!)  : '--:--',
          event: isBoarded ? boardEvent : 'Chưa ghi nhận lên xe',
          done:  isBoarded,
          gps:   rec?.boardedGpsText  ?? '',
        ),
        (
          time:  isAlighted ? (rec!.alightedAt!) : '--:--',
          event: isAlighted ? alightEvent : 'Chưa ghi nhận xuống xe',
          done:  isAlighted,
          gps:   rec?.alightedGpsText ?? '',
        ),
      ];
      return List.generate(items.length, (i) {
        final item      = items[i];
        final isLast    = i == items.length - 1;
        final showImage = i == 1 && isBoarded && rec?.imageData != null;

        double connectorH;
        if (showImage) {
          connectorH = item.gps.isNotEmpty ? 128 : 108;
        } else {
          connectorH = item.gps.isNotEmpty ? 52 : 36;
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 44,
              child: Text(item.time,
                  style: GoogleFonts.dmSans(
                      fontSize: 11,
                      color: AppColors.textSub,
                      fontWeight: FontWeight.w500)),
            ),
            Column(
              children: [
                Container(
                  width: 12, height: 12,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color:  item.done ? AppColors.present : AppColors.border,
                    border: Border.all(
                      color: item.done ? AppColors.present : AppColors.textHint,
                      width: 2,
                    ),
                  ),
                ),
                if (!isLast)
                  Container(
                      width: 2,
                      height: connectorH,
                      color: item.done
                          ? AppColors.present.withValues(alpha: 0.3)
                          : AppColors.border),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.event,
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color:      item.done ? AppColors.textMain : AppColors.textSub,
                          fontWeight: item.done ? FontWeight.w500 : FontWeight.w400,
                        )),
                    if (item.gps.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          const Icon(Icons.location_on_rounded,
                              size: 11, color: AppColors.textHint),
                          const SizedBox(width: 3),
                          Text(item.gps,
                              style: GoogleFonts.dmSans(
                                  fontSize: 10, color: AppColors.textHint)),
                        ],
                      ),
                    ],
                    if (showImage) ...[
                      const SizedBox(height: 8),
                      GestureDetector(
                        onTap: () => _showImageDialog(rec!.imageData!),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            base64Decode(rec!.imageData!.split(',').last),
                            width: 72,
                            height: 72,
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        );
      });
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('CHUYẾN SÁNG',
              style: GoogleFonts.dmSans(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSub,
                  letterSpacing: 0.5)),
          const SizedBox(height: 10),
          ...buildItems('06:30', _morningRecord, isMorning: true),
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 10),
          Text('CHUYẾN CHIỀU',
              style: GoogleFonts.dmSans(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSub,
                  letterSpacing: 0.5)),
          const SizedBox(height: 10),
          ...buildItems('16:30', _afternoonRecord, isMorning: false),
        ],
      ),
    );
  }

  Widget _buildWeekHistory() {
    if (_weekHistory.isEmpty) {
      return AppCard(child: _centeredText('Đang tải lịch sử...'));
    }

    Widget sessionLine(String label, _AttendanceRecord? rec) {
      final hasData = rec?.boardedAt != null;
      final arrived = rec?.alightedAt != null;
      return Row(
        children: [
          SizedBox(
            width: 36,
            child: Text(label,
                style: GoogleFonts.dmSans(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSub)),
          ),
          Text(
            hasData ? rec!.boardedAt! : '--:--',
            style: GoogleFonts.dmSans(
                fontSize: 11,
                color: hasData ? AppColors.textMain : AppColors.textHint),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 3),
            child: Icon(Icons.arrow_forward_rounded,
                size: 10, color: AppColors.textHint),
          ),
          Text(
            hasData ? (rec!.alightedAt ?? '—') : '—',
            style: GoogleFonts.dmSans(
                fontSize: 11,
                color: arrived
                    ? AppColors.present
                    : hasData
                        ? AppColors.primary
                        : AppColors.textHint),
          ),
        ],
      );
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: List.generate(_weekHistory.length, (i) {
          final entry       = _weekHistory[i];
          final isLast      = i == _weekHistory.length - 1;
          final hasMorning   = entry.morning?.boardedAt   != null;
          final hasAfternoon = entry.afternoon?.boardedAt != null;
          final hasAny       = hasMorning || hasAfternoon;
          final dotColor     = hasAny ? AppColors.present : AppColors.border;

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 60,
                      child: Text(entry.dateLabel,
                          style: GoogleFonts.dmSans(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textMain)),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Container(
                        width: 10, height: 10,
                        decoration: BoxDecoration(
                            shape: BoxShape.circle, color: dotColor),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: hasAny
                          ? Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                sessionLine('Sáng', entry.morning),
                                const SizedBox(height: 4),
                                sessionLine('Chiều', entry.afternoon),
                              ],
                            )
                          : Text('Không có dữ liệu',
                              style: GoogleFonts.dmSans(
                                  fontSize: 12,
                                  color: AppColors.textHint,
                                  fontStyle: FontStyle.italic)),
                    ),
                  ],
                ),
              ),
              if (!isLast) const Divider(height: 1, color: AppColors.border),
            ],
          );
        }),
      ),
    );
  }

  void _showImageDialog(String imageData) {
    final bytes = base64Decode(imageData.split(',').last);
    showDialog(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(16),
        child: Stack(
          alignment: Alignment.topRight,
          children: [
            InteractiveViewer(
              child: Image.memory(bytes, fit: BoxFit.contain),
            ),
            IconButton(
              icon: const Icon(Icons.close_rounded, color: Colors.white),
              onPressed: () => Navigator.pop(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _centeredText(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: Text(text,
              style: GoogleFonts.dmSans(fontSize: 13, color: AppColors.textSub)),
        ),
      );
}

// ── Mini widgets ──────────────────────────────────────

class _SessionRow extends StatelessWidget {
  final String label;
  final _AttendanceRecord record;

  const _SessionRow({required this.label, required this.record});

  @override
  Widget build(BuildContext context) {
    final arrived = record.alightedAt != null;
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(label,
              style: GoogleFonts.dmSans(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.primary)),
        ),
        const SizedBox(width: 10),
        Text(record.boardedAt ?? '--:--',
            style: GoogleFonts.dmSans(fontSize: 12, color: AppColors.textMain)),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Icon(Icons.arrow_forward_rounded, size: 12, color: AppColors.textHint),
        ),
        Text(record.alightedAt ?? '—',
            style: GoogleFonts.dmSans(
                fontSize: 12,
                color: arrived ? AppColors.present : AppColors.textSub)),
        const Spacer(),
        if (record.hasBoardedGps) ...[
          const Icon(Icons.location_on_rounded, size: 11, color: AppColors.textHint),
          const SizedBox(width: 2),
          Text(record.boardedGpsText,
              style: GoogleFonts.dmSans(fontSize: 10, color: AppColors.textHint),
              overflow: TextOverflow.ellipsis),
        ],
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;

  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 48, color: AppColors.textHint),
            const SizedBox(height: 16),
            Text('Không tải được dữ liệu',
                style: GoogleFonts.dmSans(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMain)),
            const SizedBox(height: 8),
            Text(error,
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(fontSize: 12, color: AppColors.textSub)),
            const SizedBox(height: 20),
            ElevatedButton(onPressed: onRetry, child: const Text('Thử lại')),
          ],
        ),
      ),
    );
  }
}
