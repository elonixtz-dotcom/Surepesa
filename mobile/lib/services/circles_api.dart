import '../state/circle_models.dart';
import 'api_client.dart';

/// Circles ★ endpoints (/v1/circles). Circles track goals and contributions; they
/// never hold or move members' money.
class CirclesApi {
  CirclesApi(this._api);

  final ApiClient _api;

  Future<List<CircleSummary>> list() async {
    final data = await _api.get('/v1/circles');
    return (data['items'] as List<dynamic>)
        .map((e) => CircleSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<CircleInvitationView>> myInvitations() async {
    final data = await _api.get('/v1/circles/invitations');
    return (data['items'] as List<dynamic>)
        .map((e) => CircleInvitationView.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> acceptInvitation(String token) =>
      _api.post('/v1/circles/invitations/${Uri.encodeComponent(token)}/accept', const {});

  Future<void> declineInvitation(String token) =>
      _api.post('/v1/circles/invitations/${Uri.encodeComponent(token)}/decline', const {});

  Future<CircleSummary> create({
    required String name,
    required String type,
    String? purpose,
    String? targetAmountMinor,
    String? targetDate,
  }) async =>
      CircleSummary.fromJson(await _api.post('/v1/circles', {
        'name': name,
        'type': type,
        if (purpose != null && purpose.isNotEmpty) 'purpose': purpose,
        if (targetAmountMinor != null) 'targetAmount': targetAmountMinor,
        if (targetDate != null) 'targetDate': targetDate,
      }));

  Future<CircleDetail> get(String id) async =>
      CircleDetail.fromJson(await _api.get('/v1/circles/${Uri.encodeComponent(id)}'));

  Future<CircleProgress> progress(String id) async =>
      CircleProgress.fromJson(await _api.get('/v1/circles/${Uri.encodeComponent(id)}/progress'));

  Future<void> invite(String id, String inviteePhone) =>
      _api.post('/v1/circles/${Uri.encodeComponent(id)}/invitations', {'inviteePhone': inviteePhone});

  Future<void> addGoal(
    String id, {
    required String title,
    required String targetAmountMinor,
    String? dueDate,
    String? expectedPerMemberMinor,
    String? frequency,
  }) =>
      _api.post('/v1/circles/${Uri.encodeComponent(id)}/goals', {
        'title': title,
        'targetAmount': targetAmountMinor,
        if (dueDate != null) 'dueDate': dueDate,
        if (expectedPerMemberMinor != null) 'expectedPerMember': expectedPerMemberMinor,
        if (frequency != null) 'frequency': frequency,
      });

  Future<String> contribute(
    String id, {
    required String amountMinor,
    String? goalId,
    String? note,
    String? externalRef,
  }) async {
    final data = await _api.post('/v1/circles/${Uri.encodeComponent(id)}/contributions', {
      'amount': amountMinor,
      if (goalId != null) 'goalId': goalId,
      if (note != null && note.isNotEmpty) 'note': note,
      if (externalRef != null && externalRef.isNotEmpty) 'externalRef': externalRef,
    });
    return data['verification'] as String? ?? 'UNVERIFIED';
  }

  Future<void> leave(String id) => _api.post('/v1/circles/${Uri.encodeComponent(id)}/leave', const {});

  Future<void> setMemberRole(String id, String userId, String role) =>
      _api.post('/v1/circles/${Uri.encodeComponent(id)}/members/${Uri.encodeComponent(userId)}/role', {'role': role});

  Future<void> removeMember(String id, String userId) =>
      _api.post('/v1/circles/${Uri.encodeComponent(id)}/members/${Uri.encodeComponent(userId)}/remove', const {});

  Future<void> archive(String id) =>
      _api.patch('/v1/circles/${Uri.encodeComponent(id)}', {'archive': true}).then((_) {});
}
