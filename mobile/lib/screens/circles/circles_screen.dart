import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../state/app_state.dart';
import '../../state/circle_models.dart';
import '../../widgets/common.dart';
import '../pay/pay_widgets.dart';
import 'circle_detail_screen.dart';

/// Circles ★ home: your circles, pending invitations, and the create flow.
/// Circles track goals and contributions — they never hold members' money.
class CirclesScreen extends StatefulWidget {
  const CirclesScreen({super.key});

  @override
  State<CirclesScreen> createState() => _CirclesScreenState();
}

class _CirclesScreenState extends State<CirclesScreen> {
  List<CircleSummary>? _circles;
  List<CircleInvitationView> _invitations = [];
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final api = AppScope.read(context).circles;
      final results = await Future.wait([api.list(), api.myInvitations()]);
      if (mounted) {
        setState(() {
          _circles = results[0] as List<CircleSummary>;
          _invitations = results[1] as List<CircleInvitationView>;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _answer(CircleInvitationView inv, bool accept) async {
    try {
      final api = AppScope.read(context).circles;
      await (accept ? api.acceptInvitation(inv.token) : api.declineInvitation(inv.token));
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Circles')),
      body: GradientBackground(
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
              children: [
                const InfoNotice(
                  text: 'Circles track goals and contributions together. Money stays in each member’s own account — SurePesa never holds Circle funds.',
                ),
                const SizedBox(height: 16),
                if (_invitations.isNotEmpty) ...[
                  const SectionHeader(title: 'Invitations'),
                  const SizedBox(height: 8),
                  for (final inv in _invitations)
                    SpCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(inv.circleName ?? 'A Circle', style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text('Invited by ${inv.inviterName ?? 'a SurePesa user'}',
                              style: const TextStyle(color: SpColors.ink2, fontSize: 12.5)),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () => _answer(inv, false),
                                  child: const Text('Decline'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: FilledButton(
                                  onPressed: () => _answer(inv, true),
                                  child: const Text('Join'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 16),
                ],
                if (_error != null)
                  InfoNotice(tone: PillTone.negative, text: _error.toString())
                else if (_circles == null)
                  const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
                else if (_circles!.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: Center(child: Text('No circles yet — start one', style: TextStyle(color: SpColors.ink2))),
                  )
                else
                  for (final c in _circles!) ...[
                    SpCard(
                      onTap: () => Navigator.of(context)
                          .push(MaterialPageRoute<void>(builder: (_) => CircleDetailScreen(circleId: c.id)))
                          .then((_) => _load()),
                      child: Row(
                        children: [
                          IconChip(
                            icon: switch (c.type) {
                              'FAMILY' => Icons.family_restroom_rounded,
                              'STUDENT' => Icons.school_rounded,
                              'VIKOBA' => Icons.groups_rounded,
                              'FRIENDS' => Icons.diversity_3_rounded,
                              _ => Icons.circle_outlined,
                            },
                            background: SpColors.mint,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text('${c.memberCount} members · ${c.myRole.toLowerCase()}',
                                    style: const TextStyle(color: SpColors.ink2, fontSize: 12.5)),
                              ],
                            ),
                          ),
                          if (c.status != 'ACTIVE') const StatusPill(label: 'Archived', tone: PillTone.neutral),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => const CreateCircleScreen()))
            .then((_) => _load()),
        icon: const Icon(Icons.add_rounded),
        label: const Text('New circle'),
      ),
    );
  }
}

/// Creates a Circle on one of the templates (Family / Student / Vikoba / Friends / Custom).
class CreateCircleScreen extends StatefulWidget {
  const CreateCircleScreen({super.key});

  @override
  State<CreateCircleScreen> createState() => _CreateCircleScreenState();
}

class _CreateCircleScreenState extends State<CreateCircleScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _purpose = TextEditingController();
  final _target = TextEditingController();
  String _type = 'FAMILY';
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _purpose.dispose();
    _target.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final circle = await AppScope.read(context).circles.create(
            name: _name.text.trim(),
            type: _type,
            purpose: _purpose.text.trim(),
            targetAmountMinor: _target.text.trim().isEmpty ? null : toMinorUnitsString(_target.text),
          );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => CircleDetailScreen(circleId: circle.id)),
      );
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PayScaffold(
      title: 'Start a Circle',
      bottom: BusyButton(label: 'Create circle', busy: _busy, onPressed: _submit),
      children: [
        const InfoNotice(text: 'Pick a template — it only changes labels and defaults. Every Circle tracks goals and contributions the same way.'),
        const SizedBox(height: 20),
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'FAMILY', label: Text('Family')),
                  ButtonSegment(value: 'STUDENT', label: Text('Student')),
                  ButtonSegment(value: 'VIKOBA', label: Text('Vikoba')),
                ],
                selected: {_type},
                onSelectionChanged: (s) => setState(() => _type = s.first),
              ),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'FRIENDS', label: Text('Friends')),
                  ButtonSegment(value: 'CUSTOM', label: Text('Custom')),
                ],
                selected: {_type},
                onSelectionChanged: (s) => setState(() => _type = s.first),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Circle name'),
                validator: (v) => (v == null || v.trim().length < 2) ? 'Give the circle a name' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _purpose,
                decoration: const InputDecoration(labelText: 'Purpose (optional)'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _target,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Overall target (TZS, optional)'),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return null;
                  return toMinorUnitsString(v) == null ? 'Enter a valid amount' : null;
                },
              ),
            ],
          ),
        ),
      ],
    );
  }
}
