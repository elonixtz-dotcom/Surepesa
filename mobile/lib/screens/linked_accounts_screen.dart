import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../state/payment_models.dart';
import '../widgets/common.dart';
import 'pay/pay_widgets.dart';

/// Linked mobile-money accounts used to add money and withdraw. Linking one shows the name the
/// rail has registered for the number and asks "Is this you?".
class LinkedAccountsScreen extends StatefulWidget {
  const LinkedAccountsScreen({super.key});

  @override
  State<LinkedAccountsScreen> createState() => _LinkedAccountsScreenState();
}

class _LinkedAccountsScreenState extends State<LinkedAccountsScreen> {
  List<PaymentMethod>? _methods;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final methods = await AppScope.read(context).payments.paymentMethods();
      if (!mounted) return;
      setState(() {
        _methods = methods;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _add() async {
    final added = await showModalBottomSheet<PaymentMethod>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => const _AddAccountSheet(),
    );
    if (!mounted) return;
    if (added == null) return;
    await _load();
    if (!mounted) return;
    final isMe = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Is this you?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${added.providerName} has this number registered to:'),
            const SizedBox(height: 12),
            Text(
              added.accountName ?? 'No name returned',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 0.4),
            ),
            Text(added.maskedNumber, style: const TextStyle(color: SpColors.inkMuted)),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('No')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Yes, that is me'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      duration: Duration(seconds: isMe == true ? 3 : 8),
      content: Text(isMe == true
          ? '${added.providerName} account linked'
          // The API has no way to unlink yet, so the account stays on the list.
          : 'Do not use this account. Contact SurePesa support to remove it.'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final methods = _methods;
    return PayScaffold(
      title: 'Linked accounts',
      bottom: (methods?.length ?? 0) >= 5
          ? null
          : FilledButton.icon(onPressed: _add, icon: const Icon(Icons.add_rounded), label: const Text('Link an account')),
      children: [
        const Text(
          'Mobile money accounts you can add money from and withdraw to. You can link up to 5.',
          style: TextStyle(color: SpColors.inkMuted),
        ),
        const SizedBox(height: 16),
        if (_error != null) InlineError(_error),
        if (methods == null && _error == null)
          const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
        else if (methods != null && methods.isEmpty)
          const SpCard(
            padding: EdgeInsets.symmetric(vertical: 28, horizontal: 16),
            child: Column(
              children: [
                Icon(Icons.phone_android_rounded, size: 36, color: SpColors.tealLight),
                SizedBox(height: 10),
                Text('No linked accounts yet', style: TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
          )
        else if (methods != null)
          for (final m in methods)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SpCard(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: SpColors.mint,
                    child: Icon(Icons.phone_android_rounded, color: SpColors.tealDark),
                  ),
                  title: Text(m.label ?? m.providerName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text([m.accountName, m.maskedNumber].whereType<String>().join('\n')),
                  isThreeLine: m.accountName != null,
                  trailing: m.isDefault
                      ? const Text('Default', style: TextStyle(color: SpColors.teal, fontWeight: FontWeight.w700, fontSize: 12))
                      : null,
                ),
              ),
            ),
      ],
    );
  }
}

class _AddAccountSheet extends StatefulWidget {
  const _AddAccountSheet();

  @override
  State<_AddAccountSheet> createState() => _AddAccountSheetState();
}

class _AddAccountSheetState extends State<_AddAccountSheet> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  String _provider = mobileMoneyProviders.first.$1;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Most people link their own SurePesa number.
    final own = AppScope.read(context).me?.phoneNumber;
    if (own != null && own.startsWith('+255')) _phone.text = own.substring(4);
  }

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final added = await AppScope.read(context).payments.addPaymentMethod(
            provider: _provider,
            phoneNumber: toE164(_phone.text),
          );
      if (mounted) Navigator.of(context).pop(added);
    } catch (e) {
      // ACCOUNT_INVALID, METHOD_EXISTS, TOO_MANY_METHODS: the server's words.
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 20, 24, 24 + MediaQuery.of(context).viewInsets.bottom),
      child: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Link mobile money', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            const Text('Network', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (code, name) in mobileMoneyProviders)
                  ChoiceChip(
                    label: Text(name),
                    selected: _provider == code,
                    selectedColor: SpColors.mint,
                    onSelected: _busy ? null : (_) => setState(() => _provider = code),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(12)],
              decoration: const InputDecoration(labelText: 'Phone number', prefixText: '+255 '),
              validator: (v) => isTzMobile(toE164(v ?? '')) ? null : 'Enter a valid Tanzanian mobile number',
            ),
            InlineError(_error),
            const SizedBox(height: 20),
            BusyButton(label: 'Link account', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
