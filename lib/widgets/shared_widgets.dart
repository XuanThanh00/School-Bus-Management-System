import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../mock/mock_data.dart';

// ── Status Badge ─────────────────────────────────────

class StatusBadge extends StatelessWidget {
  final AttendanceStatus status;
  const StatusBadge(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final (label, bg, fg) = switch (status) {
      AttendanceStatus.present       => ('Đã đến',       AppColors.presentSurface, AppColors.present),
      AttendanceStatus.absent        => ('Vắng mặt',     AppColors.absentSurface,  AppColors.absent),
      AttendanceStatus.onBus         => ('Đang trên xe', AppColors.pendingSurface, AppColors.pending),
      AttendanceStatus.waiting       => ('Chờ lên xe',   AppColors.primarySurface, AppColors.primary),
      AttendanceStatus.holiday       => ('Không đi học', const Color(0xFFEEEEEE),  AppColors.textSub),
      AttendanceStatus.approvedLeave => ('Nghỉ có phép', AppColors.presentSurface, AppColors.present),
      AttendanceStatus.pendingLeave  => ('Chờ duyệt',    AppColors.pendingSurface, AppColors.pending),
      AttendanceStatus.error         => ('Lỗi dữ liệu',  AppColors.absentSurface,  AppColors.absent),
      AttendanceStatus.unknown       => ('Chưa rõ',      const Color(0xFFEEEEEE),  AppColors.textSub),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(label,
          style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
    );
  }
}

// ── Leave Status Badge ────────────────────────────────

class LeaveStatusBadge extends StatelessWidget {
  final LeaveStatus status;
  const LeaveStatusBadge(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final (label, bg, fg) = switch (status) {
      LeaveStatus.approved => ('Đã duyệt', AppColors.presentSurface, AppColors.present),
      LeaveStatus.pending  => ('Chờ duyệt', AppColors.pendingSurface, AppColors.pending),
      LeaveStatus.rejected => ('Từ chối',   AppColors.absentSurface,  AppColors.absent),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(label,
          style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
    );
  }
}

// ── Avatar ───────────────────────────────────────────

class StudentAvatar extends StatelessWidget {
  final String name;
  final double size;
  const StudentAvatar({super.key, required this.name, this.size = 52});

  String get _initials {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return '?';
    final parts = trimmed.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length >= 2) {
      return '${parts[parts.length - 2][0]}${parts.last[0]}'.toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size, height: size,
      decoration: BoxDecoration(
        color: AppColors.primarySurface,
        borderRadius: BorderRadius.circular(size / 2),
        border: Border.all(color: AppColors.primary.withOpacity(0.2), width: 1.5),
      ),
      child: Center(
        child: Text(
          _initials,
          style: GoogleFonts.dmSans(
            fontSize: size * 0.32, fontWeight: FontWeight.w700, color: AppColors.primary,
          ),
        ),
      ),
    );
  }
}

// ── Section Title ─────────────────────────────────────

class SectionTitle extends StatelessWidget {
  final String title;
  const SectionTitle(this.title, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(title,
          style: GoogleFonts.dmSans(
              fontSize: 13, fontWeight: FontWeight.w600,
              color: AppColors.textSub, letterSpacing: 0.3)),
    );
  }
}

// ── App Card ─────────────────────────────────────────

class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;

  const AppCard({super.key, required this.child, this.padding, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: padding ?? const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: child,
        ),
      ),
    );
  }
}

// ── Info Row ─────────────────────────────────────────

class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const InfoRow({super.key, required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: GoogleFonts.dmSans(fontSize: 13, color: AppColors.textSub)),
          ),
          Expanded(
            child: Text(value,
                style: GoogleFonts.dmSans(
                  fontSize: 13, fontWeight: FontWeight.w500,
                  color: valueColor ?? AppColors.textMain,
                )),
          ),
        ],
      ),
    );
  }
}