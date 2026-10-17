import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import 'pay_widgets.dart';

/// Sets the transaction PIN (shown after onboarding while `hasPin` is false), or changes it
/// from Profile when [changing] is true.
class SetPinScreen extends StatefulWidget {
  const SetPinScreen({super.key, this.changing = false});

  final bool changing;

  @override
  State<SetPinScreen> createState() => _SetPinScreenState();
}

class _SetPinScreenState extends State<SetPinScreen> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _pin = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _pin.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await AppScope.read(context).setPin(_pin.text, currentPin: widget.changing ? _current.text : null);
      if (!mounted) return;
      if (widget.changing) {
        final messenger = ScaffoldMessenger.of(context);
        Navigator.of(context).pop();
        messenger.showSnackBar(
          const SnackBar(content: Text('Your PIN has been changed'), behavior: SnackBarBehavior.floating),
        );
      }
      // First-time setup: AppState moves to the home screen on its own.
    } on ApiException catch (e) {
      if (!mounted) return;
      // WEAK_PIN, INVALID_PIN_FORMAT, WRONG_PIN (current PIN), PIN_LOCKED: the server's words.
      setState(() {
        _error = e.message;
        if (e.code == 'WEAK_PIN' || e.code == 'INVALID_PIN_FORMAT') {
          _pin.clear();
          _confirm.clear();
        } else if (e.code == 'WRONG_PIN') {
          _current.clear();
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: widget.changing ? const Text('Change PIN') : null,
        actions: [
          if (!widget.changing)
            TextButton(
              onPressed: _busy ? null : () => AppScope.read(context).signOut(),
              child: const Text('Sign out', style: TextStyle(color: SpColors.ink2)),
            ),
        ],
      ),
      extendBodyBehindAppBar: true,
      body: GradientBackground(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: IconChip(icon: Icons.lock_outline_rounded, color: SpColors.teal, background: SpColors.mint, size: 64)),
                  const SizedBox(height: 12),
                  Text(
                    widget.changing ? 'Change your PIN' : 'Create your PIN',
                    textAlign: TextAlign.center,
                    style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'You will enter it to confirm every payment. Use 4 to 6 digits and avoid 1234 or 1111.',
                    textAlign: TextAlign.center,
                    style: text.bodyMedium?.copyWith(color: SpColors.ink2, height: 1.5),
                  ),
                  const SizedBox(height: 28),
                  if (widget.changing) ...[
                    PinField(controller: _current, hint: 'Current PIN', autofocus: true, validator: validatePinFormat),
                    const SizedBox(height: 14),
                  ],
                  PinField(
                    controller: _pin,
                    hint: widget.changing ? 'New PIN' : 'PIN',
                    autofocus: !widget.changing,
                    validator: validatePinFormat,
                  ),
                  const SizedBox(height: 14),
                  PinField(
                    controller: _confirm,
                    hint: 'Enter it again',
                    validator: (v) => v != _pin.text ? 'The PINs do not match' : null,
                    onSubmitted: (_) => _submit(),
                  ),
                  InlineError(_error),
                  const SizedBox(height: 28),
                  BusyButton(label: widget.changing ? 'Change PIN' : 'Set PIN', busy: _busy, onPressed: _submit),
                  const SizedBox(height: 16),
                  const InfoNotice(
                    icon: Icons.shield_outlined,
                    tone: PillTone.neutral,
                    text: 'SurePesa staff will never ask for your PIN. Do not share it with anyone.',
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
