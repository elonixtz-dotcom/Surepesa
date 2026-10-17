import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

/// Email sign-in / sign-up against Neon Auth.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _signUp = false;
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final app = AppScope.read(context);
    try {
      if (_signUp) {
        await app.signUp(_name.text.trim(), _email.text.trim(), _password.text);
      } else {
        await app.signIn(_email.text.trim(), _password.text);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SpColors.surface,
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: SpColors.ink,
              padding: EdgeInsets.fromLTRB(24, MediaQuery.paddingOf(context).top + 32, 24, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SurePesaLogo(size: 26, onDark: true),
                  const SizedBox(height: 28),
                  Text(
                    _signUp ? 'Create your account' : 'Welcome back',
                    style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.5, height: 1.15),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _signUp
                        ? 'Send money, pay merchants and pay online with virtual cards.'
                        : 'Sign in to send money, pay merchants and manage your cards.',
                    style: const TextStyle(color: SpColors.inkMutedOnDark, fontSize: 15, height: 1.5),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
              child: AutofillGroup(
                child: Form(
                  key: _form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_signUp) ...[
                        TextFormField(
                          controller: _name,
                          textCapitalization: TextCapitalization.words,
                          autofillHints: const [AutofillHints.name],
                          decoration: const InputDecoration(labelText: 'Full name', helperText: 'As on your national ID'),
                          validator: (v) => (v == null || v.trim().length < 2) ? 'Enter your name' : null,
                        ),
                        const SizedBox(height: 16),
                      ],
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(labelText: 'Email'),
                        validator: (v) =>
                            (v == null || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim())) ? 'Enter a valid email address' : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _password,
                        obscureText: _obscure,
                        autofillHints: [_signUp ? AutofillHints.newPassword : AutofillHints.password],
                        decoration: InputDecoration(
                          labelText: 'Password',
                          helperText: _signUp ? 'At least 8 characters. Do not reuse your mobile money PIN.' : null,
                          suffixIcon: TextButton(
                            onPressed: () => setState(() => _obscure = !_obscure),
                            child: Text(_obscure ? 'Show' : 'Hide', style: const TextStyle(color: SpColors.ink2)),
                          ),
                        ),
                        validator: (v) => (v == null || v.length < 8) ? 'Use at least 8 characters' : null,
                        onFieldSubmitted: (_) => _submit(),
                      ),
                      if (!_signUp)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(onPressed: () => showComingSoon(context, 'Password reset'), child: const Text('Forgot password?')),
                        )
                      else
                        const SizedBox(height: 16),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                            : Text(_signUp ? 'Create account' : 'Sign in'),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: _busy ? null : () => setState(() => _signUp = !_signUp),
                        child: Text(_signUp ? 'Already have an account? Sign in' : 'New to SurePesa? Create an account'),
                      ),
                      const SizedBox(height: 16),
                      const SecurityNote(),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
