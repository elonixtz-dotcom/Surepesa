import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Soft mint backdrop used behind every screen.
class GradientBackground extends StatelessWidget {
  const GradientBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: SpColors.backgroundGradient),
      child: child,
    );
  }
}

class SurePesaLogo extends StatelessWidget {
  const SurePesaLogo({super.key, this.size = 26});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size * 1.4,
          height: size * 1.4,
          decoration: BoxDecoration(
            gradient: SpColors.cardGradient,
            borderRadius: BorderRadius.circular(size * 0.45),
          ),
          child: Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: size * 0.8),
        ),
        SizedBox(width: size * 0.4),
        Text.rich(
          TextSpan(children: [
            const TextSpan(text: 'Sure', style: TextStyle(color: SpColors.ink)),
            const TextSpan(text: 'Pesa', style: TextStyle(color: SpColors.teal)),
          ]),
          style: TextStyle(fontSize: size, fontWeight: FontWeight.w800, letterSpacing: -0.5),
        ),
      ],
    );
  }
}

/// White rounded card with a faint teal border, as used throughout the design.
class SpCard extends StatelessWidget {
  const SpCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFD9F0EC)),
          ),
          child: child,
        ),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.action, this.onAction});

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ),
        if (action != null)
          GestureDetector(
            onTap: onAction,
            child: Text(action!, style: const TextStyle(color: SpColors.teal, fontWeight: FontWeight.w600, fontSize: 13)),
          ),
      ],
    );
  }
}

/// Circular icon button with a soft border (bell, back, more...).
class CircleIconButton extends StatelessWidget {
  const CircleIconButton({super.key, required this.icon, this.onPressed, this.badge = false});

  final IconData icon;
  final VoidCallback? onPressed;
  final bool badge;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Material(
          color: Colors.white,
          shape: const CircleBorder(side: BorderSide(color: Color(0xFFD9F0EC))),
          child: IconButton(icon: Icon(icon, size: 22), color: SpColors.ink, onPressed: onPressed),
        ),
        if (badge)
          Positioned(
            right: 10,
            top: 10,
            child: Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(color: SpColors.teal, shape: BoxShape.circle),
            ),
          ),
      ],
    );
  }
}

void showComingSoon(BuildContext context, String feature) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text('$feature is coming in the next milestone.'),
      behavior: SnackBarBehavior.floating,
    ));
}

void showError(BuildContext context, Object error) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(error.toString()),
      backgroundColor: SpColors.negative,
      behavior: SnackBarBehavior.floating,
    ));
}
