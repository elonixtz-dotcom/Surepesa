import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../services/api_client.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'pay/pay_widgets.dart';

/// Shown when a saved session is reopened, or after a while in the background: the
/// transaction PIN unlocks the app. Wrong attempts count towards the same lockout as payments.
class UnlockScreen extends StatefulWidget {
  const UnlockScreen({super.key});

  @override
  State<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends State<UnlockScreen> {
  final _form = GlobalKey<FormState>();
  final _pin = TextEditingController();
  bool _busy = false;
  bool _locked = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).unlock(_pin.text);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _locked = e.code == 'PIN_LOCKED';
        _pin.clear();
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final name = app.me?.displayName;
    return Scaffold(
      backgroundColor: SpColors.ink,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Center(child: SurePesaLogo(size: 22, onDark: true)),
                const SizedBox(height: 48),
                Center(child: InitialsAvatar(name: name, size: 64, onDark: true)),
                const SizedBox(height: 16),
                Text(
                  name == null ? 'Welcome back' : 'Welcome back, ${name.split(' ').first}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: -0.4),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Enter your PIN to unlock SurePesa.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: SpColors.inkMutedOnDark, fontSize: 15),
                ),
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(color: SpColors.surface, borderRadius: BorderRadius.circular(SpRadii.hero)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      PinField(
                        controller: _pin,
                        autofocus: true,
                        enabled: !_locked && !_busy,
                        validator: validatePinFormat,
                        onSubmitted: (_) => _submit(),
                      ),
                      InlineError(_error),
                      const SizedBox(height: 16),
                      BusyButton(label: 'Unlock', busy: _busy, onPressed: _locked ? null : _submit),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: _busy ? null : () => app.signOut(),
                  style: TextButton.styleFrom(foregroundColor: SpColors.inkMutedOnDark),
                  child: Text(name == null ? 'Sign out' : 'Not ${name.split(' ').first}? Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
