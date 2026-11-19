import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Plain screen frame for the payment flow: back button, title, mint backdrop.
class PayScaffold extends StatelessWidget {
  const PayScaffold({super.key, required this.title, required this.children, this.bottom});

  final String title;
  final List<Widget> children;

  /// Pinned under the scrolling content (usually the primary button).
  final Widget? bottom;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      extendBodyBehindAppBar: true,
      body: GradientBackground(
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 20), children: children),
              ),
              if (bottom != null) Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), child: bottom),
            ],
          ),
        ),
      ),
    );
  }
}

/// Filled button that shows a spinner while [busy].
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
          : Text(label),
    );
  }
}

/// Obscured 4–6 digit PIN input.
class PinField extends StatelessWidget {
  const PinField({
    super.key,
    required this.controller,
    this.hint = 'PIN',
    this.autofocus = false,
    this.enabled = true,
    this.validator,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String hint;
  final bool autofocus;
  final bool enabled;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      autofocus: autofocus,
      enabled: enabled,
      obscureText: true,
      obscuringCharacter: '●',
      keyboardType: TextInputType.number,
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 22, letterSpacing: 10, fontWeight: FontWeight.w700),
      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
      decoration: InputDecoration(hintText: hint, hintStyle: const TextStyle(fontSize: 15, letterSpacing: 0)),
      validator: validator,
      onFieldSubmitted: onSubmitted,
    );
  }
}

String? validatePinFormat(String? v) =>
    RegExp(r'^\d{4,6}$').hasMatch(v ?? '') ? null : 'Your PIN must be 4 to 6 digits';

/// Label on the left, value on the right; used on confirmation and receipt screens.
class DetailRow extends StatelessWidget {
  const DetailRow({super.key, required this.label, required this.value, this.sub, this.bold = false, this.onCopy, this.mono = false});

  final String label;
  final String value;
  final String? sub;
  final bool bold;

  /// References (SPX-…) use the monospace style.
  final bool mono;

  /// When set, a copy icon appears next to the value.
  final VoidCallback? onCopy;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(color: SpColors.inkMuted, fontSize: 13))),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  value,
                  textAlign: TextAlign.end,
                  style: mono
                      ? referenceStyle()
                      : bold
                          ? moneyStyle(size: 17)
                          : const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, fontFeatures: [FontFeature.tabularFigures()]),
                ),
                if (sub != null)
                  Text(sub!, textAlign: TextAlign.end, style: const TextStyle(color: SpColors.inkMuted, fontSize: 12)),
              ],
            ),
          ),
          if (onCopy != null)
            InkResponse(
              onTap: onCopy,
              radius: 18,
              child: const Padding(
                padding: EdgeInsets.only(left: 8, top: 1),
                child: Icon(Icons.copy_rounded, size: 16, color: SpColors.ink2),
              ),
            ),
        ],
      ),
    );
  }
}

/// Coloured notice box: warnings (insufficient balance) and info (deposit prompt).
class NoticeBox extends StatelessWidget {
  const NoticeBox({super.key, required this.text, this.warning = false});

  final String text;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    return InfoNotice(
      text: text,
      tone: warning ? PillTone.negative : PillTone.info,
      icon: warning ? Icons.error_outline_rounded : Icons.info_outline_rounded,
    );
  }
}

/// Inline error text under a form, in the server's words.
class InlineError extends StatelessWidget {
  const InlineError(this.message, {super.key});

  final String? message;

  @override
  Widget build(BuildContext context) {
    if (message == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: SpColors.negative, fontWeight: FontWeight.w600)),
    );
  }
}

void copyToClipboard(BuildContext context, String value) {
  Clipboard.setData(ClipboardData(text: value));
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text('Copied $value'), behavior: SnackBarBehavior.floating));
}
