import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/models.dart';

/// Concept "Solara": the balance surface as frosted glass over a slow aurora of brand light.
/// The deep espresso base keeps the Ledger palette's warmth; the red-orange glow is the same
/// brand gradient, freed from flat surfaces. Numbers stay tabular and trustworthy.
class AuroraBalanceCard extends StatefulWidget {
  const AuroraBalanceCard({super.key, required this.me, required this.wallet});

  final Me me;
  final WalletSummary? wallet;

  @override
  State<AuroraBalanceCard> createState() => _AuroraBalanceCardState();
}

class _AuroraBalanceCardState extends State<AuroraBalanceCard> with SingleTickerProviderStateMixin {
  late final AnimationController _drift =
      AnimationController(vsync: this, duration: const Duration(seconds: 16))..repeat();
  bool _hidden = false;

  @override
  void dispose() {
    _drift.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wallet = widget.wallet;
    final amount = splitAmount(wallet?.balance ?? '0.00');
    final phone = maskPhone(widget.me.phoneNumber);

    return Semantics(
      container: true,
      label: _hidden ? 'Balance hidden' : 'Available balance ${wallet?.currency ?? 'TZS'} ${amount.whole}${amount.fraction}',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(26),
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF2A1409), Color(0xFF140A05)],
            ),
          ),
          child: Stack(
            children: [
              // The aurora: three slow-drifting brand lights under the frost.
              AnimatedBuilder(
                animation: _drift,
                builder: (context, _) {
                  final t = _drift.value * 2 * math.pi;
                  return Stack(
                    children: [
                      _blob(Alignment(-0.95 + 0.28 * math.sin(t), -1.0 + 0.22 * math.cos(t * 0.8)), const Color(0xFFF57C12), 230, 0.60),
                      _blob(Alignment(1.0 + 0.22 * math.cos(t * 0.7), -0.35 + 0.30 * math.sin(t)), const Color(0xFFE03A1E), 210, 0.50),
                      _blob(Alignment(0.05 + 0.32 * math.sin(t * 0.6), 1.15), const Color(0xFFFFB25E), 190, 0.38),
                    ],
                  );
                },
              ),
              // The frost.
              BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 42, sigmaY: 42),
                child: Container(color: Colors.white.withValues(alpha: 0.035)),
              ),
              // Top-light edge, so the glass reads as glass.
              IgnorePointer(
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(26),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.white.withValues(alpha: 0.10), Colors.transparent],
                      stops: const [0.0, 0.4],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text('Available balance', style: TextStyle(color: Color(0xB3FFE6D6), fontSize: 13)),
                        ),
                        Material(
                          color: Colors.white.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(10),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(10),
                            onTap: () => setState(() => _hidden = !_hidden),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              child: Text(
                                _hidden ? 'Show' : 'Hide',
                                style: const TextStyle(color: Color(0xFFFFE6D6), fontSize: 12, fontWeight: FontWeight.w700),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    FittedBox(
                      alignment: Alignment.centerLeft,
                      fit: BoxFit.scaleDown,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            wallet?.currency ?? 'TZS',
                            style: const TextStyle(color: SpColors.tealLight, fontSize: 15, fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _hidden ? '••••••' : '${amount.whole}${amount.fraction}',
                            style: moneyStyle(size: 36, color: Colors.white).copyWith(
                              shadows: [const Shadow(color: Color(0x59F57C12), blurRadius: 24)],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            phone == null ? 'SurePesa wallet' : 'Wallet $phone',
                            style: const TextStyle(color: Color(0xB3FFE6D6), fontSize: 12),
                          ),
                        ),
                        Icon(widget.me.isVerified ? Icons.verified_rounded : Icons.shield_outlined,
                            size: 15, color: widget.me.isVerified ? const Color(0xFF7BE3A8) : Colors.white),
                        const SizedBox(width: 4),
                        Text(
                          widget.me.isVerified ? 'Verified' : 'Not verified',
                          style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _blob(Alignment alignment, Color color, double radius, double opacity) {
    return Align(
      alignment: alignment,
      child: Container(
        width: radius,
        height: radius,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color.withValues(alpha: opacity), color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}
