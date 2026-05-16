import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import 'login_screen.dart';

class RoleSelectionScreen extends StatelessWidget {
  const RoleSelectionScreen({super.key});

  void _goLogin(BuildContext context, String role) {
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (_, a, __) => LoginScreen(role: role),
        transitionsBuilder: (_, a, __, child) =>
            SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(1, 0),
                end: Offset.zero,
              ).animate(CurvedAnimation(parent: a, curve: Curves.easeOut)),
              child: child,
            ),
        transitionDuration: const Duration(milliseconds: 300),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.primary,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Expanded(
              flex: 2,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 72, height: 72,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Center(
                        child: Text('🚌', style: TextStyle(fontSize: 36))),
                  ),
                  const SizedBox(height: 16),
                  Text('BusAttend',
                      style: GoogleFonts.dmSans(
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: -0.5,
                      )),
                  const SizedBox(height: 6),
                  Text('Hệ thống điểm danh xe buýt trường học',
                      style: GoogleFonts.dmSans(
                        fontSize: 13,
                        color: Colors.white.withValues(alpha: 0.75),
                      )),
                ],
              ),
            ),

            // Cards
            Expanded(
              flex: 3,
              child: Container(
                decoration: const BoxDecoration(
                  color: AppColors.bg,
                  borderRadius:
                      BorderRadius.vertical(top: Radius.circular(28)),
                ),
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Đăng nhập với tư cách',
                        style: GoogleFonts.dmSans(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textMain)),
                    const SizedBox(height: 4),
                    Text('Chọn vai trò của bạn để tiếp tục',
                        style: GoogleFonts.dmSans(
                            fontSize: 13, color: AppColors.textSub)),
                    const SizedBox(height: 28),

                    _RoleCard(
                      icon: Icons.family_restroom_rounded,
                      iconColor: AppColors.primary,
                      title: 'Phụ huynh',
                      subtitle: 'Theo dõi điểm danh và vị trí xe của con',
                      onTap: () => _goLogin(context, 'parent'),
                    ),
                    const SizedBox(height: 14),
                    _RoleCard(
                      icon: Icons.directions_bus_rounded,
                      iconColor: AppColors.accent,
                      title: 'Tài xế',
                      subtitle: 'Xem danh sách học sinh và lộ trình xe',
                      onTap: () => _goLogin(context, 'driver'),
                    ),

                    const Spacer(),
                    Center(
                      child: Text('Phiên bản 1.0.0  ·  Trường THCS ABC',
                          style: GoogleFonts.dmSans(
                              fontSize: 11, color: AppColors.textHint)),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _RoleCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: iconColor, size: 26),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: GoogleFonts.dmSans(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textMain)),
                    const SizedBox(height: 3),
                    Text(subtitle,
                        style: GoogleFonts.dmSans(
                            fontSize: 12, color: AppColors.textSub)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded,
                  color: AppColors.textHint, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}
