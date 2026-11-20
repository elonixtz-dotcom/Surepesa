import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/circle_models.dart';
import '../../widgets/common.dart';


/// One Circle: goals with confirmed vs self-reported progress, members, and the
/// organiser actions (invite, goals). Contributions are records — money stays in
/// each member's own wallet.
class CircleDetailScreen extends StatefulWidget {
  const CircleDetailScreen({super.key, required this.circleId});

  final String circleId;

  @override
  State<CircleDetailScreen> createState() => _CircleDetailScreenState();
}

class _CircleDetailScreenState extends State<CircleDetailScreen> {
  CircleDetail? _detail;
  CircleProgress? _progress;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final api = AppScope.read(context).circles;
      final results = await Future.wait([api.get(widget.circleId), api.progress(widget.circleId)]);
      if (mounted) {
        setState(() {
          _detail = results[0] as CircleDetail;
          _progress = results[1] as CircleProgress;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _invite() async {
    final phoneCtl = TextEditingController();
    final phone = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Invite a member'),
        content: TextField(
          controller: phoneCtl,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Phone (+2557…)', hintText: '+255712345678'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, phoneCtl.text.trim()), child: const Text('Invite')),
        ],
      ),
    );
    if (phone == null || phone.isEmpty) return;
    try {
      await AppScope.read(context).circles.invite(widget.circleId, phone);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invitation sent')));
        _load();
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _addGoal() async {
    final title = TextEditingController();
    final target = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New goal'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Goal')),
            TextField(
              controller: target,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Target (TZS)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true) return;
    final minor = toMinorUnitsString(target.text);
    if (title.text.trim().length < 2 || minor == null) {
      if (mounted) showError(context, 'Enter a goal and a valid target amount');
      return;
    }
    try {
      await AppScope.read(context).circles.addGoal(widget.circleId, title: title.text.trim(), targetAmountMinor: minor);
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _contribute(CircleGoal? goal) async {
    final amount = TextEditingController();
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(goal == null ? 'Record a contribution' : 'Contribute to ${goal.title}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: 'Amount (${_detail?.summary.currencyCode ?? 'TZS'})'),
            ),
            TextField(controller: note, decoration: const InputDecoration(labelText: 'Note or receipt ref (optional)')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Record')),
        ],
      ),
    );
    if (ok != true) return;
    final minor = toMinorUnitsString(amount.text);
    if (minor == null) {
      if (mounted) showError(context, 'Enter a valid amount');
      return;
    }
    try {
      final verification = await AppScope.read(context).circles.contribute(
            widget.circleId,
            goalId: goal?.id,
            amountMinor: minor,
            note: note.text.trim(),
            externalRef: note.text.trim().isEmpty ? null : note.text.trim(),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(verification == 'PROVIDER_CONFIRMED' ? 'Contribution confirmed' : 'Recorded as self-reported (unverified)'),
        ));
        _load();
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _leave() async {
    try {
      await AppScope.read(context).circles.leave(widget.circleId);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final progress = _progress;
    return Scaffold(
      appBar: AppBar(
        title: Text(detail?.summary.name ?? 'Circle'),
        actions: [
          if (detail != null && detail.summary.myRole != 'OWNER')
            IconButton(icon: const Icon(Icons.logout_rounded), tooltip: 'Leave circle', onPressed: _leave),
        ],
      ),
      body: GradientBackground(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 110),
              children: [
                if (_error != null)
                  InfoNotice(tone: PillTone.negative, text: _error.toString())
                else if (detail == null || progress == null)
                  const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
                else ...[
                  if (detail.summary.purpose?.isNotEmpty == true)
                    Text(detail.summary.purpose!, style: const TextStyle(color: SpColors.ink2)),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: SpCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Confirmed', style: TextStyle(color: SpColors.ink2, fontSize: 12)),
                              Text(formatMinorUnits(progress.confirmedTotal, progress.currencyCode),
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: SpCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Self-reported', style: TextStyle(color: SpColors.ink2, fontSize: 12)),
                              Text(formatMinorUnits(progress.unverifiedTotal, progress.currencyCode),
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      const Expanded(child: SectionHeader(title: 'Goals')),
                      if (detail.summary.isOrganiser)
                        TextButton.icon(onPressed: _addGoal, icon: const Icon(Icons.add_rounded), label: const Text('Goal')),
                    ],
                  ),
                  if (progress.goals.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text('No goals yet', style: TextStyle(color: SpColors.ink2)),
                    )
                  else
                    for (final g in progress.goals) ...[
                      SpCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(child: Text(g.title, style: const TextStyle(fontWeight: FontWeight.w700))),
                                if (g.status == 'ACHIEVED') const StatusPill(label: 'Achieved', tone: PillTone.positive),
                              ],
                            ),
                            const SizedBox(height: 8),
                            LinearProgressIndicator(value: g.ratio.clamp(0.0, 1.0), minHeight: 8, borderRadius: BorderRadius.circular(4)),
                            const SizedBox(height: 8),
                            Text(
                              '${formatMinorUnits(g.confirmed, progress.currencyCode)} confirmed of ${formatMinorUnits(g.target, progress.currencyCode)}'
                              '${BigInt.parse(g.unverified) > BigInt.zero ? ' · +${formatMinorUnits(g.unverified, progress.currencyCode)} self-reported' : ''}',
                              style: const TextStyle(color: SpColors.ink2, fontSize: 12.5),
                            ),
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                onPressed: () => _contribute(detail.goals.firstWhere((d) => d.id == g.goalId)),
                                icon: const Icon(Icons.add_circle_outline_rounded),
                                label: const Text('Contribute'),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),
                    ],
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Expanded(child: SectionHeader(title: 'Members')),
                      if (detail.summary.isOrganiser)
                        TextButton.icon(onPressed: _invite, icon: const Icon(Icons.person_add_alt_1_rounded), label: const Text('Invite')),
                    ],
                  ),
                  for (final m in progress.members)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: InitialsAvatar(name: m.role),
                      title: Text(m.userId, style: const TextStyle(fontSize: 13)),
                      subtitle: Text(m.role.toLowerCase(), style: const TextStyle(fontSize: 11)),
                      trailing: Text(
                        formatMinorUnits(m.confirmed, progress.currencyCode),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => _contribute(null),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Record a contribution'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
