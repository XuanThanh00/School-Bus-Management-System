import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../theme/app_theme.dart';
import '../widgets/shared_widgets.dart';

// ── Models ────────────────────────────────────────────

class _DriverData {
  final String       docId;
  final String       name;
  final String       phone;
  final List<String> busStopIds;
  final String       busStopName; // display string, e.g. "1. Trạm 1; 2. Trạm 2"
  final String?      imageData;

  const _DriverData({
    required this.docId,
    required this.name,
    required this.phone,
    required this.busStopIds,
    required this.busStopName,
    this.imageData,
  });

  factory _DriverData.fromDoc(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    return _DriverData(
      docId:       doc.id,
      name:        d['name']?.toString() ?? '',
      phone:       d['phone']?.toString() ?? '',
      busStopIds:  (d['busStopIds'] as List?)
                       ?.map((e) => e.toString())
                       .toList() ?? [],
      busStopName: d['busStopName']?.toString() ?? '',
      imageData:   d['imageData']?.toString(),
    );
  }
}

class _StopGroup {
  final String            stopName;
  final int               order;
  final List<_StudentItem> students;

  const _StopGroup({
    required this.stopName,
    required this.order,
    required this.students,
  });
}

class _StudentItem {
  final String studentId;
  final String name;
  final String className;
  final String busStopId;
  final String attendanceStatus;
  final String? imageData;

  const _StudentItem({
    required this.studentId,
    required this.name,
    required this.className,
    required this.busStopId,
    required this.attendanceStatus,
    this.imageData,
  });

  factory _StudentItem.fromDoc(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    return _StudentItem(
      studentId:        d['studentId']?.toString() ?? '',
      name:             d['name']?.toString() ?? '',
      className:        d['class']?.toString() ?? '',
      busStopId:        d['busStopId']?.toString() ?? '',
      attendanceStatus: d['attendanceStatus']?.toString() ?? 'not_boarded',
      imageData:        d['imageData']?.toString(),
    );
  }
}

// ── Screen ────────────────────────────────────────────

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  _DriverData?      _driver;
  List<_StopGroup>  _stopGroups = [];
  StreamSubscription? _studentsSub;
  bool   _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _studentsSub?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập');

      final fs = FirebaseFirestore.instance;

      // Load driver by email
      final driverSnap = await fs
          .collection('drivers')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();
      if (driverSnap.docs.isEmpty) throw Exception('Không tìm thấy tài xế');

      final driver = _DriverData.fromDoc(driverSnap.docs.first);

      // Load tất cả stop docs song song, sort theo order
      final stopSnaps = await Future.wait(
        driver.busStopIds.map((id) => fs.collection('busStops').doc(id).get()),
      );
      final stops = stopSnaps
          .where((s) => s.exists)
          .map((s) {
            final d = s.data()!;
            return (
              id:    s.id,
              name:  d['name']?.toString() ?? '',
              order: (d['order'] as num?)?.toInt() ?? 0,
            );
          })
          .toList()
        ..sort((a, b) => a.order.compareTo(b.order));

      if (mounted) setState(() => _driver = driver);
      _listenStudents(stops);
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  // Stream realtime — badge trạng thái tự đổi khi học sinh quẹt thẻ,
  // tài xế không cần bấm refresh. whereIn giới hạn 30 giá trị (đủ cho
  // số trạm của 1 tài xế).
  void _listenStudents(List<({String id, String name, int order})> stops) {
    _studentsSub?.cancel();
    if (stops.isEmpty) {
      if (mounted) setState(() { _stopGroups = []; _loading = false; });
      return;
    }
    _studentsSub = FirebaseFirestore.instance
        .collection('students')
        .where('busStopId', whereIn: stops.map((s) => s.id).toList())
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      final all = snap.docs.map(_StudentItem.fromDoc).toList();
      final groups = stops.map((stop) {
        final students = all
            .where((s) => s.busStopId == stop.id)
            .toList()
          ..sort((a, b) => a.name.compareTo(b.name));
        return _StopGroup(
          stopName: stop.name,
          order:    stop.order,
          students: students,
        );
      }).toList();
      setState(() { _stopGroups = groups; _loading = false; });
    }, onError: (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    });
  }

  List<_StudentItem> get _allStudents =>
      _stopGroups.expand((g) => g.students).toList();

  int get _absentCount    => _allStudents.where((s) => s.attendanceStatus == 'absent').length;
  int get _boardedCount   => _allStudents.where((s) => s.attendanceStatus == 'boarded' || s.attendanceStatus == 'arrived').length;
  int get _notBoardedCount => _allStudents.where((s) => s.attendanceStatus == 'not_boarded').length;
  int get _activeCount    => _allStudents.length - _absentCount;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trang chủ'),
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _loadData,
          ),
        ],
      ),
      backgroundColor: AppColors.bg,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off_rounded,
                size: 48, color: AppColors.textHint),
            const SizedBox(height: 16),
            Text('Không tải được thông tin',
                style: GoogleFonts.dmSans(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMain)),
            const SizedBox(height: 12),
            ElevatedButton(
                onPressed: _loadData, child: const Text('Thử lại')),
          ],
        ),
      ),
    );
  }

  Widget _buildContent() {
    final driver = _driver!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Driver info card
        AppCard(
          child: Row(
            children: [
              _DriverAvatar(imageData: driver.imageData, name: driver.name),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(driver.name,
                        style: GoogleFonts.dmSans(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 3),
                    Text('Tài xế xe buýt',
                        style: GoogleFonts.dmSans(
                            fontSize: 12, color: AppColors.textSub)),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.location_on_rounded,
                            size: 14, color: AppColors.accent),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(driver.busStopName,
                              style: GoogleFonts.dmSans(
                                  fontSize: 12,
                                  color: AppColors.accent,
                                  fontWeight: FontWeight.w500),
                              overflow: TextOverflow.ellipsis),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Summary row
        Row(
          children: [
            Expanded(
              child: _SummaryCard(
                count: _activeCount,
                label: 'Cần đón hôm nay',
                icon: Icons.people_rounded,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _SummaryCard(
                count: _boardedCount,
                label: 'Đã lên xe',
                icon: Icons.check_circle_rounded,
                color: AppColors.present,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _SummaryCard(
                count: _notBoardedCount,
                label: 'Chưa lên xe',
                icon: Icons.pending_rounded,
                color: AppColors.pending,
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),

        const SectionTitle('DANH SÁCH HỌC SINH'),
        if (_stopGroups.isEmpty || _allStudents.isEmpty)
          AppCard(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: Text('Không có học sinh tại các trạm này',
                    style: GoogleFonts.dmSans(
                        fontSize: 13, color: AppColors.textSub)),
              ),
            ),
          )
        else
          ..._stopGroups.map((group) {
            if (group.students.isEmpty) return const SizedBox.shrink();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Stop header
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 8, top: 4),
                  child: Row(
                    children: [
                      Container(
                        width: 22, height: 22,
                        decoration: const BoxDecoration(
                          color: AppColors.primary,
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: Text('${group.order}',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(group.stopName,
                          style: GoogleFonts.dmSans(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textMain)),
                      const SizedBox(width: 6),
                      Text('(${group.students.length} hs)',
                          style: GoogleFonts.dmSans(
                              fontSize: 12, color: AppColors.textSub)),
                    ],
                  ),
                ),
                AppCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: List.generate(group.students.length, (i) {
                      final student = group.students[i];
                      final isLast  = i == group.students.length - 1;
                      return Column(
                        children: [
                          _StudentRow(student: student),
                          if (!isLast)
                            const Divider(
                                height: 1, indent: 70, color: AppColors.border),
                        ],
                      );
                    }),
                  ),
                ),
                const SizedBox(height: 12),
              ],
            );
          }),
        const SizedBox(height: 80),
      ],
    );
  }
}

// ── Sub-widgets ───────────────────────────────────────

class _DriverAvatar extends StatelessWidget {
  final String? imageData;
  final String name;

  const _DriverAvatar({this.imageData, required this.name});

  @override
  Widget build(BuildContext context) {
    if (imageData != null && imageData!.isNotEmpty) {
      try {
        final bytes = base64Decode(
            imageData!.contains(',') ? imageData!.split(',').last : imageData!);
        return ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: Image.memory(bytes,
              width: 56, height: 56, fit: BoxFit.cover),
        );
      } catch (_) {}
    }
    return StudentAvatar(name: name, size: 56);
  }
}

class _SummaryCard extends StatelessWidget {
  final int count;
  final String label;
  final IconData icon;
  final Color color;

  const _SummaryCard({
    required this.count,
    required this.label,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(height: 8),
          Text('$count',
              style: GoogleFonts.dmSans(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: color)),
          const SizedBox(height: 2),
          Text(label,
              style: GoogleFonts.dmSans(
                  fontSize: 11, color: AppColors.textSub)),
        ],
      ),
    );
  }
}

class _StudentRow extends StatelessWidget {
  final _StudentItem student;

  const _StudentRow({required this.student});

  static const _statusLabel = {
    'not_boarded': 'Chưa lên xe',
    'boarded':     'Đã lên xe',
    'arrived':     'Đã đến trường',
    'absent':      'Nghỉ học',
  };

  static const _statusColor = {
    'not_boarded': AppColors.pending,
    'boarded':     AppColors.present,
    'arrived':     AppColors.present,
    'absent':      AppColors.absent,
  };

  static const _statusBg = {
    'not_boarded': AppColors.pendingSurface,
    'boarded':     AppColors.presentSurface,
    'arrived':     AppColors.presentSurface,
    'absent':      AppColors.absentSurface,
  };

  @override
  Widget build(BuildContext context) {
    final status = student.attendanceStatus;
    final label  = _statusLabel[status] ?? status;
    final color  = _statusColor[status] ?? AppColors.textSub;
    final bg     = _statusBg[status] ?? AppColors.bg;

    Widget avatar;
    if (student.imageData != null && student.imageData!.isNotEmpty) {
      try {
        final raw = student.imageData!;
        final bytes = base64Decode(
            raw.contains(',') ? raw.split(',').last : raw);
        avatar = ClipRRect(
          borderRadius: BorderRadius.circular(22),
          child: Image.memory(bytes,
              width: 44, height: 44, fit: BoxFit.cover),
        );
      } catch (_) {
        avatar = StudentAvatar(name: student.name, size: 44);
      }
    } else {
      avatar = StudentAvatar(name: student.name, size: 44);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          avatar,
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(student.name,
                    style: GoogleFonts.dmSans(
                        fontSize: 14, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text('Lớp ${student.className}',
                    style: GoogleFonts.dmSans(
                        fontSize: 12, color: AppColors.textSub)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(label,
                style: GoogleFonts.dmSans(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: color)),
          ),
        ],
      ),
    );
  }
}
