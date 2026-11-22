import 'package:flutter/material.dart';

import '../core/theme.dart';

/// The "Solara" hero zone: a deep-espresso stage with two faint, static brand glows,
/// rounded off where it melts into the warm Ledger content below. Use at the top of
/// tab screens; [title] renders the big on-dark heading with optional [trailing].
class SolaraHero extends StatelessWidget {
  const SolaraHero({super.key, this.title, this.trailing, this.child, this.padding = const EdgeInsets.fromLTRB(20, 16, 20, 24)});

  final String? title;
  final Widget? trailing;
  final Widget? child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: SpColors.nightGradient,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32)),
        child: Stack(
          children: [
            // Static aurora accents — the home card carries the motion; these only tint.
            const Positioned(
              top: -70,
              right: -40,
              child: _Glow(color: Color(0xFFF57C12), radius: 220, opacity: 0.30),
            ),
            const Positioned(
              bottom: -90,
              left: -60,
              child: _Glow(color: Color(0xFFE03A1E), radius: 200, opacity: 0.22),
            ),
            Padding(
              padding: padding,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (title != null)
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title!,
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.4,
                                  color: SpColors.onNight,
                                ),
                          ),
                        ),
                        if (trailing != null) trailing!,
                      ],
                    ),
                  if (child != null) child!,
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.color, required this.radius, required this.opacity});

  final Color color;
  final double radius;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: radius,
      height: radius,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [color.withValues(alpha: opacity), color.withValues(alpha: 0)]),
      ),
    );
  }
}

/// A text field dressed for the night surface: frosted fill, soft border, warm hints.
class SolaraGlassField extends StatelessWidget {
  const SolaraGlassField({
    super.key,
    required this.controller,
    this.hint,
    this.prefixIcon = Icons.search_rounded,
    this.onChanged,
    this.textInputAction,
  });

  final TextEditingController controller;
  final String? hint;
  final IconData prefixIcon;
  final ValueChanged<String>? onChanged;
  final TextInputAction? textInputAction;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: textInputAction,
      style: const TextStyle(color: SpColors.onNight, fontSize: 14, fontWeight: FontWeight.w600),
      cursorColor: SpColors.tealLight,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0x80FFE6D6), fontWeight: FontWeight.w500),
        prefixIcon: Icon(prefixIcon, color: const Color(0xB3FFE6D6)),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear search',
                icon: const Icon(Icons.close_rounded, color: Color(0xB3FFE6D6)),
                onPressed: () {
                  controller.clear();
                  onChanged?.call('');
                },
              ),
        filled: true,
        fillColor: SpColors.glass,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: _border(),
        enabledBorder: _border(),
        focusedBorder: _border(const Color(0x66F57C12), 1.5),
      ),
    );
  }

  OutlineInputBorder _border([Color color = SpColors.glassBorder, double width = 1]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(SpRadii.control),
        borderSide: BorderSide(color: color, width: width),
      );
}
