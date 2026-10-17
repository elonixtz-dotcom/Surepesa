import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Flat ground behind every screen (the Ledger look has no gradient washes).
class GradientBackground extends StatelessWidget {
  const GradientBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ColoredBox(color: SpColors.ground, child: child);
}

/// The SurePesa wordmark: a solid teal monogram and the name.
class SurePesaLogo extends StatelessWidget {
  const SurePesaLogo({super.key, this.size = 26, this.onDark = false});

  final double size;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size * 1.38,
          height: size * 1.38,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: SpColors.teal, borderRadius: BorderRadius.circular(size * 0.38)),
          child: Text('S', style: TextStyle(color: Colors.white, fontSize: size * 0.72, fontWeight: FontWeight.w800)),
        ),
        SizedBox(width: size * 0.4),
        Text(
          'SurePesa',
          style: TextStyle(
            fontSize: size * 0.75,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.4,
            color: onDark ? Colors.white : SpColors.ink,
          ),
        ),
      ],
    );
  }
}

/// White rounded card on the grey ground.
class SpCard extends StatelessWidget {
  const SpCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: SpColors.surface,
      borderRadius: BorderRadius.circular(SpRadii.card),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
    );
  }
}

/// A heading above a group: either a bold title with an optional action, or (with [caps]) the
/// small uppercase label used for grouped lists ("TODAY", "SECURITY").
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.action, this.onAction, this.caps = false});

  final String title;
  final String? action;
  final VoidCallback? onAction;
  final bool caps;

  @override
  Widget build(BuildContext context) {
    final style = caps
        ? const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.7, color: SpColors.inkMuted)
        : const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: SpColors.ink);
    return Row(
      children: [
        Expanded(child: Text(caps ? title.toUpperCase() : title, style: style)),
        if (action != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(minimumSize: const Size(44, 36), padding: const EdgeInsets.symmetric(horizontal: 6)),
            child: Text(action!),
          ),
      ],
    );
  }
}

/// Rounded-square icon button (back, notifications, close). 44 px touch target.
class CircleIconButton extends StatelessWidget {
  const CircleIconButton({super.key, required this.icon, this.onPressed, this.badge = false, this.tooltip});

  final IconData icon;
  final VoidCallback? onPressed;
  final bool badge;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Material(
          color: SpColors.surface,
          borderRadius: BorderRadius.circular(SpRadii.control),
          child: IconButton(
            icon: Icon(icon, size: 22),
            color: SpColors.ink,
            tooltip: tooltip,
            constraints: const BoxConstraints.tightFor(width: 44, height: 44),
            onPressed: onPressed,
          ),
        ),
        if (badge)
          Positioned(
            right: 11,
            top: 10,
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: SpColors.negative,
                shape: BoxShape.circle,
                border: Border.all(color: SpColors.surface, width: 2),
              ),
            ),
          ),
      ],
    );
  }
}

/// Initials in a rounded square ("NS"), for people and merchants.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({super.key, required this.name, this.size = 40, this.onDark = false});

  final String? name;
  final double size;
  final bool onDark;

  static String initialsOf(String? name) {
    final words = (name ?? '').trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
    final s = words.map((w) => w[0].toUpperCase()).join();
    return s.isEmpty ? '·' : s;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: onDark ? SpColors.ink : SpColors.line,
        borderRadius: BorderRadius.circular(size * 0.32),
      ),
      child: Text(
        initialsOf(name),
        style: TextStyle(
          fontSize: size * 0.32,
          fontWeight: FontWeight.w800,
          color: onDark ? SpColors.tealLight : SpColors.ink2,
        ),
      ),
    );
  }
}

/// Soft-coloured icon chip used at the start of list rows.
class IconChip extends StatelessWidget {
  const IconChip({super.key, required this.icon, this.color = SpColors.teal, this.background = SpColors.mint, this.size = 38});

  final IconData icon;
  final Color color;
  final Color background;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(size * 0.32)),
        child: Icon(icon, color: color, size: size * 0.5),
      );
}

enum PillTone { positive, warning, negative, neutral, info }

/// Status in words, on a soft background ("Completed", "In progress").
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.tone, this.icon});

  final String label;
  final PillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (tone) {
      PillTone.positive => (SpColors.positive, SpColors.positiveSoft),
      PillTone.warning => (SpColors.warning, SpColors.warningSoft),
      PillTone.negative => (SpColors.negative, SpColors.negativeSoft),
      PillTone.info => (SpColors.info, SpColors.infoSoft),
      PillTone.neutral => (SpColors.ink2, SpColors.line),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)],
        Text(label, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w800)),
      ]),
    );
  }
}

/// An informative box that says what to do, never alarming: info, warning or security.
class InfoNotice extends StatelessWidget {
  const InfoNotice({super.key, required this.text, this.icon = Icons.info_outline_rounded, this.tone = PillTone.info});

  final String text;
  final IconData icon;
  final PillTone tone;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (tone) {
      PillTone.warning => (SpColors.warning, SpColors.warningSoft),
      PillTone.negative => (SpColors.negative, SpColors.negativeSoft),
      PillTone.positive => (SpColors.positive, SpColors.positiveSoft),
      PillTone.neutral => (SpColors.ink2, SpColors.surface),
      PillTone.info => (SpColors.info, SpColors.infoSoft),
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SpRadii.control)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: tone == PillTone.neutral ? SpColors.teal : fg),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: TextStyle(color: fg, fontSize: 13, height: 1.45))),
      ]),
    );
  }
}

/// The fixed reassurance line on sign-in and security screens.
class SecurityNote extends StatelessWidget {
  const SecurityNote({super.key});

  @override
  Widget build(BuildContext context) => const InfoNotice(
        icon: Icons.shield_outlined,
        tone: PillTone.neutral,
        text: 'SurePesa will never ask for your password or PIN by phone, SMS or email.',
      );
}

void showComingSoon(BuildContext context, String feature) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text('$feature is coming in the next release.')));
}

void showError(BuildContext context, Object error) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(error.toString()), backgroundColor: SpColors.negative));
}
