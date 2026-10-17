import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

/// Identity verification (KYC): where the customer stands and what verifying unlocks.
class VerifyScreen extends StatelessWidget {
  const VerifyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final me = AppScope.of(context).me!;
    final status = me.kycStatus; // NOT_STARTED, PENDING, APPROVED, REJECTED
    final idDone = status == 'PENDING' || status == 'APPROVED';

    return Scaffold(
      appBar: AppBar(title: const Text('Verify your identity')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Text(
              switch (status) {
                'APPROVED' => 'Your identity is verified',
                'PENDING' => 'We are reviewing your documents',
                'REJECTED' => 'We need a clearer document',
                _ => 'Three steps to unlock sending money',
              },
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.4, height: 1.2),
            ),
            const SizedBox(height: 8),
            Text(
              switch (status) {
                'APPROVED' => 'You can send money, pay merchants, withdraw and create virtual cards.',
                'PENDING' => 'This usually takes less than one working day. We will notify you.',
                'REJECTED' => 'Your last submission could not be accepted. Upload a new photo of your National ID.',
                _ => 'Tanzanian payment rules require us to confirm who you are. It takes about 5 minutes.',
              },
              style: const TextStyle(fontSize: 14, color: SpColors.ink2, height: 1.5),
            ),
            const SizedBox(height: 20),
            const _Step(n: 1, title: 'Personal details', subtitle: 'Name and mobile number confirmed', state: _StepState.done),
            const SizedBox(height: 10),
            _Step(
              n: 2,
              title: 'National ID (NIDA)',
              subtitle: 'Photo of the front and back',
              state: idDone ? _StepState.done : _StepState.next,
            ),
            const SizedBox(height: 10),
            _Step(
              n: 3,
              title: 'Review by SurePesa',
              subtitle: status == 'PENDING' ? 'In review' : 'Usually within one working day',
              state: status == 'APPROVED' ? _StepState.done : (status == 'PENDING' ? _StepState.next : _StepState.todo),
            ),
            const SizedBox(height: 18),
            const SpCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('What verification unlocks', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: SpColors.ink2)),
                  SizedBox(height: 10),
                  _Unlock(icon: Icons.north_east_rounded, text: 'Send money and pay merchants'),
                  _Unlock(icon: Icons.credit_card_rounded, text: 'Create virtual cards for online payments'),
                  _Unlock(icon: Icons.account_balance_outlined, text: 'Withdraw to mobile money'),
                ],
              ),
            ),
            const SizedBox(height: 18),
            const InfoNotice(
              icon: Icons.lock_outline_rounded,
              tone: PillTone.neutral,
              text: 'Your documents are stored privately and used only to verify your identity.',
            ),
            const SizedBox(height: 18),
            if (status == 'NOT_STARTED' || status == 'REJECTED')
              FilledButton(
                onPressed: () => showComingSoon(context, 'Document upload'),
                child: const Text('Continue with National ID'),
              ),
          ],
        ),
      ),
    );
  }
}

enum _StepState { done, next, todo }

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.title, required this.subtitle, required this.state});

  final int n;
  final String title;
  final String subtitle;
  final _StepState state;

  @override
  Widget build(BuildContext context) {
    final marker = switch (state) {
      _StepState.done => Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(color: SpColors.positive, shape: BoxShape.circle),
          child: const Icon(Icons.check_rounded, color: Colors.white, size: 18),
        ),
      _ => Container(
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: state == _StepState.next ? SpColors.teal : SpColors.border, width: 2),
          ),
          child: Text('$n',
              style: TextStyle(fontWeight: FontWeight.w800, color: state == _StepState.next ? SpColors.teal : SpColors.inkMuted)),
        ),
    };
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: SpColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: state == _StepState.next ? Border.all(color: SpColors.teal, width: 2) : null,
      ),
      child: Row(children: [
        marker,
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            Text(subtitle, style: const TextStyle(fontSize: 13, color: SpColors.inkMuted)),
          ]),
        ),
        Text(
          switch (state) { _StepState.done => 'Done', _StepState.next => 'Next', _StepState.todo => '' },
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: state == _StepState.done ? SpColors.positive : SpColors.teal),
        ),
      ]),
    );
  }
}

class _Unlock extends StatelessWidget {
  const _Unlock({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [
          Icon(icon, size: 18, color: SpColors.teal),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 14))),
        ]),
      );
}
