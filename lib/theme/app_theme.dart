import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppColors {
  // Primary — deep blue
  static const primary        = Color(0xFF1A5FBF);
  static const primaryLight   = Color(0xFF3A7FDF);
  static const primarySurface = Color(0xFFE8F0FB);

  // Neutral
  static const bg        = Color(0xFFF5F6FA);
  static const surface   = Color(0xFFFFFFFF);
  static const border    = Color(0xFFE4E8EF);
  static const textMain  = Color(0xFF0F1D35);
  static const textSub   = Color(0xFF7A8BA6);
  static const textHint  = Color(0xFFB0BCCC);

  // Status
  static const present       = Color(0xFF18A96A);
  static const presentSurface= Color(0xFFE6F7F0);
  static const absent        = Color(0xFFE53935);
  static const absentSurface = Color(0xFFFCECEB);
  static const pending       = Color(0xFFF5A623);
  static const pendingSurface= Color(0xFFFEF5E6);

  // Accent
  static const accent = Color(0xFF0ABFBC);
}

class AppTheme {
  static ThemeData get theme => ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AppColors.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.light,
    ),
    textTheme: GoogleFonts.dmSansTextTheme().copyWith(
      displayLarge: GoogleFonts.dmSans(
        fontSize: 28, fontWeight: FontWeight.w700, color: AppColors.textMain, letterSpacing: -0.5,
      ),
      titleLarge: GoogleFonts.dmSans(
        fontSize: 18, fontWeight: FontWeight.w600, color: AppColors.textMain,
      ),
      titleMedium: GoogleFonts.dmSans(
        fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.textMain,
      ),
      bodyLarge: GoogleFonts.dmSans(
        fontSize: 14, fontWeight: FontWeight.w400, color: AppColors.textMain,
      ),
      bodyMedium: GoogleFonts.dmSans(
        fontSize: 13, fontWeight: FontWeight.w400, color: AppColors.textSub,
      ),
      labelSmall: GoogleFonts.dmSans(
        fontSize: 11, fontWeight: FontWeight.w500, color: AppColors.textSub, letterSpacing: 0.3,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.primary,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: GoogleFonts.dmSans(
        fontSize: 17, fontWeight: FontWeight.w600, color: Colors.white,
      ),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: AppColors.surface,
      selectedItemColor: AppColors.primary,
      unselectedItemColor: AppColors.textHint,
      elevation: 0,
      type: BottomNavigationBarType.fixed,
      showSelectedLabels: true,
      showUnselectedLabels: true,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size(double.infinity, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: GoogleFonts.dmSans(fontSize: 15, fontWeight: FontWeight.w600),
        elevation: 0,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.bg,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      hintStyle: GoogleFonts.dmSans(fontSize: 14, color: AppColors.textHint),
      labelStyle: GoogleFonts.dmSans(fontSize: 14, color: AppColors.textSub),
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.border),
      ),
      margin: EdgeInsets.zero,
    ),
  );
}