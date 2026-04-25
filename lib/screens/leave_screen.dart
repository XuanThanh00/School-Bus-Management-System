import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../theme/app_theme.dart';
import '../mock/mock_data.dart';
import '../widgets/shared_widgets.dart';

// ── Model ─────────────────────────────────────────────

class _LeaveRequest {
  final String id;
  final String startDate; // YYYY-MM-DD
  final String reason;
  final LeaveStatus status;
  final Timestamp? createdAt;

  const _LeaveRequest({
    required this.id,
    required this.startDate,
    required this.reason,
    required this.status,
    this.createdAt,
  });

  // Display date as DD/MM/YYYY
  String get dateDisplay {
    final parts = startDate.split('-');
    if (parts.length == 3) return '${parts[2]}/${parts[1]}/${parts[0]}';
    return startDate;
  }

  factory _LeaveRequest.fromDoc(DocumentSnapshot doc) {
    final d = doc.data() as Map<String, dynamic>;
    final s = d['status']?.toString() ?? 'pending';
    return _LeaveRequest(
      id: doc.id,
      startDate: d['startDate']?.toString() ?? '',
      reason: d['reason']?.toString() ?? '',
      status: switch (s) {
        'approved' => LeaveStatus.approved,
        'rejected' => LeaveStatus.rejected,
        _ => LeaveStatus.pending,
      },
      createdAt: d['createdAt'] is Timestamp ? d['createdAt'] as Timestamp : null,
    );
  }
}

// ── Screen ────────────────────────────────────────────

class LeaveScreen extends StatefulWidget {
  const LeaveScreen({super.key});

  @override
  State<LeaveScreen> createState() => _LeaveScreenState();
}

class _LeaveScreenState extends State<LeaveScreen> {
  final _reasonCtrl = TextEditingController();
  DateTime? _selectedDate;
  bool _sending = false;

  // Parent/student data for submitting the request
  String? _parentDocId;
  String? _studentId;
  String? _studentName;

  // Request history
  StreamSubscription? _leaveSub;
  List<_LeaveRequest> _history = [];
  bool _loadingHistory = true;

  @override
  void initState() {
    super.initState();
    _loadParentData();
  }

  @override
  void dispose() {
    _reasonCtrl.dispose();
    _leaveSub?.cancel();
    super.dispose();
  }

  Future<void> _loadParentData() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final fs = FirebaseFirestore.instance;
      final parentSnap = await fs
          .collection('parents')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();

      if (parentSnap.docs.isEmpty) return;

      final parentDoc = parentSnap.docs.first;
      final studentIds = List<String>.from(parentDoc.data()['studentIds'] ?? []);

      String studentName = '';
      String studentId = '';
      if (studentIds.isNotEmpty) {
        final studentSnap = await fs
            .collection('students')
            .where('studentId', isEqualTo: studentIds.first)
            .limit(1)
            .get();
        if (studentSnap.docs.isNotEmpty) {
          final s = studentSnap.docs.first.data();
          studentName = s['name']?.toString() ?? '';
          studentId   = s['studentId']?.toString() ?? '';
        }
      }

      if (mounted) {
        setState(() {
          _parentDocId  = parentDoc.id;
          _studentId    = studentId;
          _studentName  = studentName;
        });
      }

      _startLeaveStream(parentDoc.id);
    } catch (_) {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  void _startLeaveStream(String parentDocId) {
    _leaveSub?.cancel();
    _leaveSub = FirebaseFirestore.instance
        .collection('leaveRequests')
        .where('parentId', isEqualTo: parentDocId)
        .snapshots()
        .listen(
          (snap) {
        if (!mounted) return;
        final list = snap.docs.map(_LeaveRequest.fromDoc).toList()
          ..sort((a, b) {
            final ta = a.createdAt?.seconds ?? 0;
            final tb = b.createdAt?.seconds ?? 0;
            return tb.compareTo(ta); // newest first
          });
        setState(() {
          _history = list;
          _loadingHistory = false;
        });
      },
      onError: (_) {
        if (mounted) setState(() => _loadingHistory = false);
      },
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 30)),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: const ColorScheme.light(primary: AppColors.primary),
        ),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  String get _dateDisplay {
    if (_selectedDate == null) return 'Chọn ngày nghỉ';
    final d = _selectedDate!;
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  Future<void> _submit() async {
    if (_selectedDate == null || _reasonCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Vui lòng điền đầy đủ thông tin',
              style: GoogleFonts.dmSans(color: Colors.white)),
          backgroundColor: AppColors.absent,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
      return;
    }

    setState(() => _sending = true);
    try {
      final d = _selectedDate!;
      final dateStr =
          '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

      await FirebaseFirestore.instance.collection('leaveRequests').add({
        'studentId':   _studentId ?? '',
        'studentName': _studentName ?? '',
        'parentId':    _parentDocId ?? '',
        'startDate':   dateStr,
        'endDate':     dateStr,
        'reason':      _reasonCtrl.text.trim(),
        'status':      'pending',
        'createdAt':   FieldValue.serverTimestamp(),
      });

      if (!mounted) return;
      setState(() {
        _sending = false;
        _reasonCtrl.clear();
        _selectedDate = null;
      });
      _showSuccess();
    } catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gửi thất bại: $e',
              style: GoogleFonts.dmSans(color: Colors.white)),
          backgroundColor: AppColors.absent,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  void _showSuccess() {
    showDialog(
      context: context,
      builder: (_) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 60, height: 60,
                decoration: const BoxDecoration(
                    color: AppColors.presentSurface, shape: BoxShape.circle),
                child: const Icon(Icons.check_rounded,
                    color: AppColors.present, size: 32),
              ),
              const SizedBox(height: 16),
              Text('Gửi thành công!',
                  style: GoogleFonts.dmSans(
                      fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(
                  'Khai báo nghỉ đã được gửi. Bạn sẽ nhận thông báo khi được duyệt.',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.dmSans(
                      fontSize: 13, color: AppColors.textSub)),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Đóng'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Khai báo nghỉ học'),
        automaticallyImplyLeading: false,
      ),
      backgroundColor: AppColors.bg,
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Label('Ngày nghỉ'),
                const SizedBox(height: 8),
                InkWell(
                  onTap: _pickDate,
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.bg,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: _selectedDate != null
                              ? AppColors.primary
                              : AppColors.border),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.calendar_today_rounded,
                            size: 18,
                            color: _selectedDate != null
                                ? AppColors.primary
                                : AppColors.textHint),
                        const SizedBox(width: 10),
                        Text(_dateDisplay,
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              color: _selectedDate != null
                                  ? AppColors.textMain
                                  : AppColors.textHint,
                            )),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                _Label('Lý do nghỉ'),
                const SizedBox(height: 8),
                TextFormField(
                  controller: _reasonCtrl,
                  maxLines: 3,
                  style: GoogleFonts.dmSans(fontSize: 14),
                  decoration: const InputDecoration(
                    hintText: 'Ví dụ: Bé bị ốm, sốt cao...',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 20),

                ElevatedButton(
                  onPressed: _sending ? null : _submit,
                  child: _sending
                      ? const SizedBox(
                          height: 20, width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('Gửi khai báo'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          const SectionTitle('LỊCH SỬ KHAI BÁO'),
          _loadingHistory
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  ))
              : _history.isEmpty
                  ? AppCard(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Center(
                          child: Text('Chưa có khai báo nào',
                              style: GoogleFonts.dmSans(
                                  fontSize: 13, color: AppColors.textSub)),
                        ),
                      ),
                    )
                  : AppCard(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      child: Column(
                        children: _history.map((req) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: Row(
                              children: [
                                Container(
                                  width: 40, height: 40,
                                  decoration: BoxDecoration(
                                    color: AppColors.primarySurface,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Icon(
                                      Icons.description_outlined,
                                      size: 20,
                                      color: AppColors.primary),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(req.dateDisplay,
                                          style: GoogleFonts.dmSans(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w600,
                                              color: AppColors.textMain)),
                                      const SizedBox(height: 2),
                                      Text(req.reason,
                                          style: GoogleFonts.dmSans(
                                              fontSize: 12,
                                              color: AppColors.textSub)),
                                    ],
                                  ),
                                ),
                                LeaveStatusBadge(req.status),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
                    ),
          const SizedBox(height: 80),
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(text,
        style: GoogleFonts.dmSans(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: AppColors.textMain));
  }
}
