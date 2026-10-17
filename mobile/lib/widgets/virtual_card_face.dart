import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/card_models.dart';

/// The card as it looks in the app. With [details] it shows the full number and CVV
/// (only ever passed in right after a PIN check).
class VirtualCardFace extends StatelessWidget {
  const VirtualCardFace({super.key, required this.card, this.details, this.compact = false});

  final VirtualCard card;
  final RevealedNumbers? details;
  final bool compact;

  static const _gradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [SpColors.ink, SpColors.inkSurface, Color(0xFF0E4A4A)],
  );

  @override
  Widget build(BuildContext context) {
    final muted = card.isClosed || card.status == 'FAILED';
    final number = details?.grouped ?? '••••  ••••  ••••  ${card.last4 ?? '----'}';
    return AspectRatio(
      aspectRatio: 1.586, // ISO/IEC 7810 ID-1, the shape of a bank card
      child: ClipRRect(
        borderRadius: BorderRadius.circular(compact ? 16 : 20),
        child: Stack(
          fit: StackFit.expand,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(gradient: muted ? null : _gradient, color: muted ? SpColors.inkMuted : null),
            ),
            // Soft light sweep so the card reads as a physical object, not a flat box.
            Positioned(
              right: -60,
              top: -80,
              child: Container(
                width: 220,
                height: 220,
                decoration: BoxDecoration(shape: BoxShape.circle, color: SpColors.tealLight.withValues(alpha: 0.08)),
              ),
            ),
            Padding(
              padding: EdgeInsets.all(compact ? 16 : 20),
              child: DefaultTextStyle(
                style: const TextStyle(color: Colors.white),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(card.nickname,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontWeight: FontWeight.w700, fontSize: compact ? 14 : 16)),
                        ),
                        const Text('SurePesa', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.2, color: SpColors.tealLight)),
                      ],
                    ),
                    const Spacer(),
                    Text(
                      number,
                      style: TextStyle(
                        fontSize: compact ? 16 : 20,
                        fontFamily: referenceStyle().fontFamily,
                        fontWeight: FontWeight.w500,
                        letterSpacing: details != null ? 1.6 : 1.2,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    SizedBox(height: compact ? 10 : 14),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        _Field(label: 'Expires', value: details?.expiry ?? card.expiry ?? '--/--'),
                        if (details != null) ...[
                          const SizedBox(width: 22),
                          _Field(label: 'CVV', value: details!.cvv),
                        ],
                        const Spacer(),
                        Text(card.brand == 'MASTERCARD' ? 'mastercard' : 'VISA',
                            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, fontStyle: FontStyle.italic, letterSpacing: 0.5)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            if (card.isFrozen) const _Frosted(),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: TextStyle(fontSize: 9, letterSpacing: 0.8, color: Colors.white.withValues(alpha: 0.7))),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontFeatures: [FontFeature.tabularFigures()])),
        ],
      );
}

class _Frosted extends StatelessWidget {
  const _Frosted();

  @override
  Widget build(BuildContext context) => Container(
        color: SpColors.infoSoft.withValues(alpha: 0.6),
        alignment: Alignment.center,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999)),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.ac_unit_rounded, size: 16, color: SpColors.info),
            SizedBox(width: 6),
            Text('Frozen', style: TextStyle(fontWeight: FontWeight.w700, color: SpColors.ink)),
          ]),
        ),
      );
}
