import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/api_client.dart';
import 'pay_widgets.dart';

/// Asks for the transaction PIN and runs [submit] with it. Stays open on a wrong PIN (showing
/// the attempts the server says are left) and on other errors so the customer can retry; the
/// caller keeps the same Idempotency-Key across those retries. Returns null if dismissed.
Future<T?> showPinSheet<T>(
  BuildContext context, {
  required String summary,
  required Future<T> Function(String pin) submit,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SpRadii.hero))),
    builder: (_) => _PinSheet<T>(summary: summary, submit: submit),
  );
}

class _PinSheet<T> extends StatefulWidget {
  const _PinSheet({required this.summary, required this.submit});

  final String summary;
  final Future<T> Function(String pin) submit;

  @override
  State<_PinSheet<T>> createState() => _PinSheetState<T>();
}

class _PinSheetState<T> extends State<_PinSheet<T>> {
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
      final result = await widget.submit(_pin.text);
      if (mounted) Navigator.of(context).pop(result);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        // WRONG_PIN: "Wrong PIN. 3 attempts left." PIN_LOCKED (423): "Try again in 30 minutes."
        _error = e.message;
        _locked = e.code == 'PIN_LOCKED';
        if (e.code == 'WRONG_PIN') _pin.clear();
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 12, 24, 24 + MediaQuery.of(context).viewInsets.bottom),
      child: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: SpColors.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 18),
            const Center(child: Icon(Icons.lock_outline_rounded, color: SpColors.teal, size: 28)),
            const SizedBox(height: 10),
            const Text('Enter your PIN', textAlign: TextAlign.center, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, letterSpacing: -0.2)),
            const SizedBox(height: 4),
            Text(widget.summary, textAlign: TextAlign.center, style: const TextStyle(color: SpColors.ink2, height: 1.4)),
            const SizedBox(height: 20),
            PinField(
              controller: _pin,
              autofocus: true,
              enabled: !_locked && !_busy,
              validator: validatePinFormat,
              onSubmitted: (_) => _submit(),
            ),
            InlineError(_error),
            const SizedBox(height: 20),
            if (_locked)
              OutlinedButton(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(54)),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Close'),
              )
            else
              BusyButton(label: 'Confirm', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
