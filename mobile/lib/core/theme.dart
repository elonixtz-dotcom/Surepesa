import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// SurePesa palette: soft mint surfaces with teal accents.
class SpColors {
  static const teal = Color(0xFF1BB5A5);
  static const tealDark = Color(0xFF0E8C83);
  static const tealLight = Color(0xFF7FE0D3);
  static const mint = Color(0xFFE6F7F4);
  static const mintSoft = Color(0xFFF3FBFA);
  static const ink = Color(0xFF0F2E2C);
  static const inkMuted = Color(0xFF5B7472);
  static const positive = Color(0xFF12A150);
  static const negative = Color(0xFFD64545);

  static const cardGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF9BE8DD), Color(0xFF3CC3B3), Color(0xFF1BA898)],
  );

  static const backgroundGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFFDDF5F1), Color(0xFFF6FCFB)],
  );
}

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: SpColors.teal,
      primary: SpColors.teal,
      surface: Colors.white,
    ),
    scaffoldBackgroundColor: SpColors.mintSoft,
  );
  final text = GoogleFonts.plusJakartaSansTextTheme(base.textTheme).apply(
    bodyColor: SpColors.ink,
    displayColor: SpColors.ink,
  );
  return base.copyWith(
    textTheme: text,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: SpColors.ink,
      titleTextStyle: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFD5EEEA)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: SpColors.teal, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: SpColors.teal,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: text.titleSmall?.copyWith(fontWeight: FontWeight.w700),
      ),
    ),
  );
}
