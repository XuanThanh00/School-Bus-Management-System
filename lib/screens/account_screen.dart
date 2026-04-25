import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/app_theme.dart';
import '../widgets/shared_widgets.dart';
import 'login_screen.dart';

// ── Model ─────────────────────────────────────────────

class _AccountData {
  final String parentName;
  final String studentName;
  final String className;
  final String dateOfBirth;
  final String phone;

  const _AccountData({
    required this.parentName,
    required this.studentName,
    required this.className,
    required this.dateOfBirth,
    required this.phone,
  });

  // Format: 0901234567 → 0901 234 567
  String get phoneDisplay {
    if (phone.length == 10) {
      return '${phone.substring(0, 4)} ${phone.substring(4, 7)} ${phone.substring(7)}';
    }
    return phone;
  }
}

// ── Screen ────────────────────────────────────────────

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  _AccountData? _data;
  String? _parentDocId;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception('Chưa đăng nhập');

      final fs = FirebaseFirestore.instance;

      final parentSnap = await fs
          .collection('parents')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();

      if (parentSnap.docs.isEmpty) throw Exception('Không tìm thấy phụ huynh');

      final parentDoc  = parentSnap.docs.first;
      final parentData = parentDoc.data();
      _parentDocId = parentDoc.id;
      final studentIds = List<String>.from(parentData['studentIds'] ?? []);

      String studentName = '';
      String className = '';
      String dateOfBirth = '';

      if (studentIds.isNotEmpty) {
        final studentSnap = await fs
            .collection('students')
            .where('studentId', isEqualTo: studentIds.first)
            .limit(1)
            .get();
        if (studentSnap.docs.isNotEmpty) {
          final s = studentSnap.docs.first.data();
          studentName  = s['name']?.toString() ?? '';
          className    = s['class']?.toString() ?? '';
          dateOfBirth  = s['dateOfBirth']?.toString() ?? '';
        }
      }

      if (mounted) {
        setState(() {
          _data = _AccountData(
            parentName:  parentData['displayName']?.toString() ?? '',
            phone:       parentData['phone']?.toString() ?? '',
            studentName: studentName,
            className:   className,
            dateOfBirth: dateOfBirth,
          );
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tài khoản'),
        automaticallyImplyLeading: false,
      ),
      backgroundColor: AppColors.bg,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _data == null
          ? _buildError()
          : _buildContent(context),
    );
  }

  Widget _buildError() {
    return Center(
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
            onPressed: () {
              _loadData();
            },
            child: const Text('Thử lại'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final data = _data!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        AppCard(
          child: Column(
            children: [
              Row(
                children: [
                  StudentAvatar(name: data.parentName, size: 56),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(data.parentName,
                            style: GoogleFonts.dmSans(
                                fontSize: 16, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text('Phụ huynh của ${data.studentName}',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: AppColors.textSub)),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.primarySurface,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text('Lớp ${data.className}',
                        style: GoogleFonts.dmSans(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.primary)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Divider(height: 1, color: AppColors.border),
              const SizedBox(height: 16),
              InfoRow(label: 'Số điện thoại', value: data.phoneDisplay),
              const Divider(height: 16, color: AppColors.border),
              InfoRow(label: 'Học sinh', value: data.studentName),
              const Divider(height: 16, color: AppColors.border),
              InfoRow(label: 'Lớp', value: data.className),
              const Divider(height: 16, color: AppColors.border),
              InfoRow(label: 'Ngày sinh', value: data.dateOfBirth),
            ],
          ),
        ),
        const SizedBox(height: 20),

        const SectionTitle('CÀI ĐẶT'),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _SettingTile(
                icon: Icons.notifications_outlined,
                iconColor: AppColors.primary,
                title: 'Thông báo',
                subtitle: 'Bật/tắt thông báo điểm danh',
                onTap: () {},
              ),
              const Divider(height: 1, indent: 56, color: AppColors.border),
              _SettingTile(
                icon: Icons.lock_outline_rounded,
                iconColor: AppColors.pending,
                title: 'Đổi mật khẩu',
                subtitle: 'Thay đổi mật khẩu đăng nhập',
                onTap: () => _showChangePassword(context),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        const SectionTitle('THÔNG TIN ỨNG DỤNG'),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _SettingTile(
                icon: Icons.info_outline_rounded,
                iconColor: AppColors.textSub,
                title: 'Phiên bản',
                subtitle: '1.0.0',
                showArrow: false,
              ),
              const Divider(height: 1, indent: 56, color: AppColors.border),
              _SettingTile(
                icon: Icons.school_rounded,
                iconColor: AppColors.textSub,
                title: 'Trường',
                subtitle: 'HCMUTE – ĐH Sư phạm Kỹ thuật TP.HCM',
                showArrow: false,
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        OutlinedButton.icon(
          onPressed: () => _confirmLogout(context),
          icon: const Icon(Icons.logout_rounded,
              size: 18, color: AppColors.absent),
          label: Text('Đăng xuất',
              style: GoogleFonts.dmSans(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: AppColors.absent)),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(double.infinity, 48),
            side: const BorderSide(color: AppColors.absent),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 80),
      ],
    );
  }

  // ── Change password ───────────────────────────────────

  void _showChangePassword(BuildContext context) {
    final oldPassCtrl = TextEditingController();
    final newPassCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    bool obscureOld = true;
    bool obscureNew = true;
    bool loading = false;
    String? error;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
              24, 20, 24,
              MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                    width: 36, height: 4,
                    decoration: BoxDecoration(
                        color: AppColors.border,
                        borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(height: 20),
              Text('Đổi mật khẩu',
                  style: GoogleFonts.dmSans(
                      fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 20),

              // Current password
              Text('Mật khẩu hiện tại',
                  style: GoogleFonts.dmSans(
                      fontSize: 13, fontWeight: FontWeight.w500)),
              const SizedBox(height: 6),
              TextFormField(
                controller: oldPassCtrl,
                obscureText: obscureOld,
                style: GoogleFonts.dmSans(fontSize: 14),
                decoration: InputDecoration(
                  hintText: '••••••••',
                  suffixIcon: IconButton(
                    icon: Icon(
                      obscureOld
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      size: 20, color: AppColors.textSub,
                    ),
                    onPressed: () =>
                        setSheetState(() => obscureOld = !obscureOld),
                  ),
                ),
              ),
              const SizedBox(height: 14),

              // New password
              Text('Mật khẩu mới',
                  style: GoogleFonts.dmSans(
                      fontSize: 13, fontWeight: FontWeight.w500)),
              const SizedBox(height: 6),
              TextFormField(
                controller: newPassCtrl,
                obscureText: obscureNew,
                style: GoogleFonts.dmSans(fontSize: 14),
                decoration: InputDecoration(
                  hintText: '••••••••',
                  suffixIcon: IconButton(
                    icon: Icon(
                      obscureNew
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      size: 20, color: AppColors.textSub,
                    ),
                    onPressed: () =>
                        setSheetState(() => obscureNew = !obscureNew),
                  ),
                ),
              ),
              const SizedBox(height: 14),

              // Confirm new password
              Text('Xác nhận mật khẩu mới',
                  style: GoogleFonts.dmSans(
                      fontSize: 13, fontWeight: FontWeight.w500)),
              const SizedBox(height: 6),
              TextFormField(
                controller: confirmCtrl,
                obscureText: true,
                style: GoogleFonts.dmSans(fontSize: 14),
                decoration: const InputDecoration(hintText: '••••••••'),
              ),

              if (error != null) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.absentSurface,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline,
                          size: 16, color: AppColors.absent),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(error!,
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: AppColors.absent)),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: loading
                    ? null
                    : () async {
                  final oldPass = oldPassCtrl.text.trim();
                  final newPass = newPassCtrl.text.trim();
                  final confirm = confirmCtrl.text.trim();

                  if (oldPass.isEmpty ||
                      newPass.isEmpty ||
                      confirm.isEmpty) {
                    setSheetState(
                            () => error = 'Vui lòng điền đầy đủ thông tin');
                    return;
                  }
                  if (newPass.length < 6) {
                    setSheetState(() =>
                    error = 'Mật khẩu mới phải ít nhất 6 ký tự');
                    return;
                  }
                  if (newPass != confirm) {
                    setSheetState(
                            () => error = 'Mật khẩu xác nhận không khớp');
                    return;
                  }

                  setSheetState(() { loading = true; error = null; });

                  try {
                    final user = FirebaseAuth.instance.currentUser!;
                    final cred = EmailAuthProvider.credential(
                      email: user.email!,
                      password: oldPass,
                    );
                    await user.reauthenticateWithCredential(cred);
                    await user.updatePassword(newPass);

                    // Sync new password to Firestore
                    if (_parentDocId != null) {
                      await FirebaseFirestore.instance
                          .collection('parents')
                          .doc(_parentDocId)
                          .update({'defaultPassword': newPass});
                    }

                    if (ctx.mounted) {
                      Navigator.pop(ctx);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Đổi mật khẩu thành công!',
                              style: GoogleFonts.dmSans(
                                  color: Colors.white)),
                          backgroundColor: AppColors.present,
                          behavior: SnackBarBehavior.floating,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ),
                      );
                    }
                  } on FirebaseAuthException catch (e) {
                    setSheetState(() {
                      loading = false;
                      error = switch (e.code) {
                        'wrong-password' => 'Mật khẩu hiện tại không đúng',
                        'weak-password' => 'Mật khẩu mới quá yếu',
                        'too-many-requests' => 'Thử lại sau ít phút',
                        _ => 'Đổi mật khẩu thất bại. Thử lại!',
                      };
                    });
                  } catch (e) {
                    setSheetState(() {
                      loading = false;
                      error = 'Đã có lỗi xảy ra. Thử lại!';
                    });
                  }
                },
                child: loading
                    ? const SizedBox(
                    height: 20, width: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                    : const Text('Xác nhận đổi mật khẩu'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Logout ────────────────────────────────────────────

  void _confirmLogout(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 36, height: 4,
                decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 20),
            Text('Đăng xuất?',
                style: GoogleFonts.dmSans(
                    fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(
                'Bạn sẽ cần đăng nhập lại để xem thông tin điểm danh.',
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(
                    fontSize: 13, color: AppColors.textSub)),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () async {
                Navigator.pop(context);
                final prefs = await SharedPreferences.getInstance();
                await prefs.setBool('remember_me', false);
                await FirebaseAuth.instance.signOut();
                if (context.mounted) {
                  Navigator.of(context).pushAndRemoveUntil(
                    PageRouteBuilder(
                      pageBuilder: (_, a, __) => const LoginScreen(),
                      transitionsBuilder: (_, a, __, child) =>
                          FadeTransition(opacity: a, child: child),
                      transitionDuration:
                      const Duration(milliseconds: 400),
                    ),
                        (_) => false,
                  );
                }
              },
              style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.absent),
              child: const Text('Đăng xuất'),
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text('Huỷ',
                  style:
                  GoogleFonts.dmSans(color: AppColors.textSub)),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Setting Tile ──────────────────────────────────────

class _SettingTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final bool showArrow;

  const _SettingTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    this.onTap,
    this.showArrow = true,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: iconColor),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: GoogleFonts.dmSans(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textMain)),
                  Text(subtitle,
                      style: GoogleFonts.dmSans(
                          fontSize: 12, color: AppColors.textSub)),
                ],
              ),
            ),
            if (showArrow)
              const Icon(Icons.chevron_right_rounded,
                  color: AppColors.textHint, size: 20),
          ],
        ),
      ),
    );
  }
}