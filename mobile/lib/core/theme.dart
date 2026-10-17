import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// "Ledger": the SurePesa visual system (see the SurePesa app design canvas).
///
/// Warm system shared with the merchant portal: white cards on a cream ground, one red-orange
/// accent (solid on controls, a gradient on the balance card and logo), warm near-black text.
/// Status colours always come with words, never colour alone. Token names predate the palette.
class SpColors {
  // Accent (named teal for history). Dark enough for bold white text on buttons.
  static const teal = Color(0xFFD9480F);
  static const tealDark = Color(0xFFB8460A);
  static const tealLight = Color(0xFFFFD9C2); // accent on dark and gradient surfaces
  static const mint = Color(0xFFFDEBE0); // accent tint: icon chips, focus ring
  static const mintSoft = ground; // legacy name: the app background

  // Neutrals.
  static const ink = Color(0xFF1D140E); // text, and dark surfaces (unlock, cards)
  static const ink2 = Color(0xFF5A4A3F); // secondary text, labels
  static const inkMuted = Color(0xFF7A6A5E); // captions
  static const inkSurface = Color(0x2EFFFFFF); // raised elements on dark or gradient surfaces
  static const inkMutedOnDark = Color(0xFFFFE6D6);
  static const ground = Color(0xFFFBF7F3);
  static const surface = Colors.white;
  static const line = Color(0xFFF3EBE4); // row dividers
  static const border = Color(0xFFE6D8CD); // control borders

  // Status: text colour and its soft background.
  static const positive = Color(0xFF127A4B);
  static const positiveSoft = Color(0xFFE3F4EA);
  static const warning = Color(0xFF9A5B00);
  static const warningSoft = Color(0xFFFDF1DC);
  static const negative = Color(0xFFB42318);
  static const negativeSoft = Color(0xFFFDECEA);
  static const info = Color(0xFF23409A);
  static const infoSoft = Color(0xFFE8EEFB);

  /// The brand gradient: primary hero surfaces only (balance card, logo, the Send action).
  static const brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFE03A1E), Color(0xFFF57C12)],
  );

  static const cardGradient = brandGradient;
  static const backgroundGradient = LinearGradient(colors: [ground, ground]);
}

/// Shared shapes and spacing.
class SpRadii {
  static const control = 14.0;
  static const card = 18.0;
  static const hero = 22.0;
}

const _tabular = [FontFeature.tabularFigures()];

/// Money amounts: tabular figures so columns of numbers line up.
TextStyle moneyStyle({double size = 15, FontWeight weight = FontWeight.w800, Color color = SpColors.ink}) =>
    TextStyle(fontSize: size, fontWeight: weight, color: color, fontFeatures: _tabular, letterSpacing: size >= 28 ? -0.6 : 0);

/// Transaction references (SPX-…, rail references).
TextStyle referenceStyle({double size = 13, Color color = SpColors.ink}) =>
    GoogleFonts.ibmPlexMono(fontSize: size, fontWeight: FontWeight.w500, color: color);

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: SpColors.teal,
      primary: SpColors.teal,
      onPrimary: Colors.white,
      surface: SpColors.surface,
      onSurface: SpColors.ink,
      error: SpColors.negative,
    ),
    scaffoldBackgroundColor: SpColors.ground,
    splashFactory: InkSparkle.splashFactory,
  );
  // Inter for reading, Bricolage Grotesque for headings, as in the merchant portal.
  final body = GoogleFonts.interTextTheme(base.textTheme);
  TextStyle? display(TextStyle? s) => GoogleFonts.bricolageGrotesque(textStyle: s, fontWeight: FontWeight.w700);
  final text = body
      .copyWith(
        displayLarge: display(body.displayLarge),
        displayMedium: display(body.displayMedium),
        displaySmall: display(body.displaySmall),
        headlineLarge: display(body.headlineLarge),
        headlineMedium: display(body.headlineMedium),
        headlineSmall: display(body.headlineSmall),
      )
      .apply(bodyColor: SpColors.ink, displayColor: SpColors.ink);
  OutlineInputBorder outline(Color color, [double width = 1.5]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(SpRadii.control),
        borderSide: BorderSide(color: color, width: width),
      );
  final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(SpRadii.control));
  final buttonText = text.titleSmall?.copyWith(fontWeight: FontWeight.w700, fontSize: 16);

  return base.copyWith(
    textTheme: text,
    appBarTheme: AppBarTheme(
      backgroundColor: SpColors.ground,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      foregroundColor: SpColors.ink,
      centerTitle: false,
      titleTextStyle: text.titleMedium?.copyWith(fontWeight: FontWeight.w700, fontSize: 16),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SpColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      labelStyle: const TextStyle(color: SpColors.ink2, fontWeight: FontWeight.w600),
      floatingLabelStyle: const TextStyle(color: SpColors.teal, fontWeight: FontWeight.w700),
      hintStyle: const TextStyle(color: SpColors.inkMuted),
      helperStyle: const TextStyle(color: SpColors.inkMuted, fontSize: 12),
      prefixStyle: const TextStyle(color: SpColors.ink2, fontWeight: FontWeight.w700, fontSize: 16),
      border: outline(SpColors.border),
      enabledBorder: outline(SpColors.border),
      focusedBorder: outline(SpColors.teal, 2),
      errorBorder: outline(SpColors.negative),
      focusedErrorBorder: outline(SpColors.negative, 2),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: SpColors.teal,
        foregroundColor: Colors.white,
        disabledBackgroundColor: SpColors.teal.withValues(alpha: 0.35),
        disabledForegroundColor: Colors.white,
        minimumSize: const Size.fromHeight(56),
        shape: buttonShape,
        textStyle: buttonText,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: SpColors.ink,
        backgroundColor: SpColors.surface,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: SpColors.border, width: 1.5),
        shape: buttonShape,
        textStyle: buttonText?.copyWith(fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: SpColors.teal,
        textStyle: text.titleSmall?.copyWith(fontWeight: FontWeight.w700, fontSize: 14),
      ),
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: SpColors.teal,
      titleTextStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: SpColors.ink),
      subtitleTextStyle: TextStyle(fontSize: 12, color: SpColors.inkMuted),
    ),
    dividerTheme: const DividerThemeData(color: SpColors.line, thickness: 1, space: 1),
    switchTheme: SwitchThemeData(
      thumbColor: const WidgetStatePropertyAll(Colors.white),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? SpColors.teal : SpColors.border),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        selectedBackgroundColor: SpColors.ink,
        selectedForegroundColor: Colors.white,
        foregroundColor: SpColors.ink,
        side: const BorderSide(color: SpColors.border, width: 1.5),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    chipTheme: const ChipThemeData(
      backgroundColor: SpColors.surface,
      side: BorderSide(color: SpColors.border, width: 1.5),
      shape: StadiumBorder(),
      labelStyle: TextStyle(fontWeight: FontWeight.w700, color: SpColors.ink, fontSize: 13),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: SpColors.ink,
      contentTextStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: SpColors.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: SpColors.border,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: SpColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: SpColors.teal),
  );
}
