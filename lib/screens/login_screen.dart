import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/app_theme.dart';
import 'main_shell.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with SingleTickerProviderStateMixin {
  final _phoneCtrl = TextEditingController();
  final _passCtrl  = TextEditingController();
  bool _obscure     = true;
  bool _loading     = false;
  bool _rememberMe  = false;
  String? _errorMsg;
  late AnimationController _anim;
  late Animation<double> _fadeIn;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 800));
    _fadeIn = CurvedAnimation(parent: _anim, curve: Curves.easeOut);
    _anim.forward();
  }

  @override
  void dispose() {
    _anim.dispose();
    _phoneCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  String _toEmail(String phone) {
    final cleaned = phone.replaceAll(RegExp(r'\s+'), '');
    return '$cleaned@busattend.app';
  }

  void _login() async {
    final phone = _phoneCtrl.text.trim();
    final pass  = _passCtrl.text.trim();

    if (phone.isEmpty || pass.isEmpty) {
      setState(() => _errorMsg = 'Vui lòng nhập đầy đủ thông tin');
      return;
    }
    setState(() { _loading = true; _errorMsg = null; });

    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: _toEmail(phone),
        password: pass,
      );
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('remember_me', _rememberMe);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          pageBuilder: (_, a, __) => const MainShell(),
          transitionsBuilder: (_, a, __, child) =>
              FadeTransition(opacity: a, child: child),
          transitionDuration: const Duration(milliseconds: 400),
        ),
      );
    } on FirebaseAuthException catch (e) {
      setState(() {
        _errorMsg = switch (e.code) {
          'user-not-found'    => 'Số điện thoại chưa được đăng ký',
          'wrong-password'    => 'Mật khẩu không đúng',
          'invalid-email'     => 'Số điện thoại không hợp lệ',
          'user-disabled'     => 'Tài khoản đã bị vô hiệu hoá',
          'too-many-requests' => 'Thử lại sau ít phút',
          _                   => 'Đăng nhập thất bại. Thử lại!',
        };
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.primary,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              flex: 2,
              child: FadeTransition(
                opacity: _fadeIn,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 72, height: 72,
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Center(child: Text('🚌', style: TextStyle(fontSize: 36))),
                    ),
                    const SizedBox(height: 16),
                    Text('BusAttend',
                        style: GoogleFonts.dmSans(
                          fontSize: 28, fontWeight: FontWeight.w700,
                          color: Colors.white, letterSpacing: -0.5,
                        )),
                    const SizedBox(height: 6),
                    Text('Hệ thống điểm danh xe buýt trường học',
                        style: GoogleFonts.dmSans(
                          fontSize: 13, color: Colors.white.withOpacity(0.75),
                        )),
                  ],
                ),
              ),
            ),

            Expanded(
              flex: 3,
              child: Container(
                decoration: const BoxDecoration(
                  color: AppColors.bg,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                ),
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                child: SingleChildScrollView(
                  child: FadeTransition(
                    opacity: _fadeIn,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Đăng nhập',
                            style: GoogleFonts.dmSans(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.textMain)),
                        const SizedBox(height: 4),
                        Text('Dành cho phụ huynh học sinh',
                            style: GoogleFonts.dmSans(fontSize: 13, color: AppColors.textSub)),
                        const SizedBox(height: 28),

                        Text('Số điện thoại',
                            style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.textMain)),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: _phoneCtrl,
                          keyboardType: TextInputType.phone,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          style: GoogleFonts.dmSans(fontSize: 14),
                          decoration: const InputDecoration(
                            hintText: '0901234567',
                            prefixIcon: Icon(Icons.phone_outlined, size: 20, color: AppColors.textSub),
                          ),
                        ),
                        const SizedBox(height: 16),

                        Text('Mật khẩu',
                            style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.textMain)),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: _passCtrl,
                          obscureText: _obscure,
                          style: GoogleFonts.dmSans(fontSize: 14),
                          decoration: InputDecoration(
                            hintText: '••••••••',
                            prefixIcon: const Icon(Icons.lock_outline, size: 20, color: AppColors.textSub),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                                size: 20, color: AppColors.textSub,
                              ),
                              onPressed: () => setState(() => _obscure = !_obscure),
                            ),
                          ),
                        ),

                        const SizedBox(height: 4),
                        InkWell(
                          onTap: () => setState(() => _rememberMe = !_rememberMe),
                          borderRadius: BorderRadius.circular(8),
                          child: Row(
                            children: [
                              Checkbox(
                                value: _rememberMe,
                                onChanged: (v) => setState(() => _rememberMe = v ?? false),
                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                visualDensity: VisualDensity.compact,
                              ),
                              Text('Ghi nhớ đăng nhập',
                                  style: GoogleFonts.dmSans(
                                      fontSize: 13, color: AppColors.textMain)),
                            ],
                          ),
                        ),

                        if (_errorMsg != null) ...[
                          const SizedBox(height: 10),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppColors.absentSurface,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.error_outline, size: 16, color: AppColors.absent),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(_errorMsg!,
                                      style: GoogleFonts.dmSans(fontSize: 12, color: AppColors.absent)),
                                ),
                              ],
                            ),
                          ),
                        ],

                        const SizedBox(height: 20),
                        ElevatedButton(
                          onPressed: _loading ? null : _login,
                          child: _loading
                              ? const SizedBox(height: 20, width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Text('Đăng nhập'),
                        ),
                        const SizedBox(height: 20),

                        Center(
                          child: Text('Phiên bản 1.0.0  ·  Trường THCS ABC',
                              style: GoogleFonts.dmSans(fontSize: 11, color: AppColors.textHint)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}