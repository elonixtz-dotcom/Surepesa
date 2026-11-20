/// Circles ★ models (blueprint §8). A Circle is a group goal/contribution tracker —
/// it never holds money; confirmed vs self-reported totals are always separate.
library;

class CircleSummary {
  CircleSummary({
    required this.id,
    required this.reference,
    required this.name,
    required this.type,
    required this.status,
    required this.currencyCode,
    required this.myRole,
    required this.memberCount,
    this.purpose,
    this.targetAmountMinor,
  });

  final String id;
  final String reference;
  final String name;
  final String type;
  final String status;
  final String currencyCode;
  final String myRole;
  final int memberCount;
  final String? purpose;
  final String? targetAmountMinor;

  bool get isOrganiser => myRole == 'OWNER' || myRole == 'ADMIN';

  factory CircleSummary.fromJson(Map<String, dynamic> j) => CircleSummary(
        id: j['id'] as String,
        reference: j['reference'] as String,
        name: j['name'] as String,
        type: j['type'] as String,
        status: j['status'] as String,
        currencyCode: j['currencyCode'] as String? ?? 'TZS',
        myRole: j['myRole'] as String? ?? 'MEMBER',
        memberCount: (j['memberCount'] as num?)?.toInt() ?? 0,
        purpose: j['purpose'] as String?,
        targetAmountMinor: j['targetAmountMinor'] as String?,
      );
}

class CircleMemberView {
  CircleMemberView({
    required this.memberId,
    required this.userId,
    required this.role,
    required this.joinedAt,
    this.name,
    this.phone,
  });

  final String memberId;
  final String userId;
  final String role;
  final DateTime joinedAt;
  final String? name;
  final String? phone;

  factory CircleMemberView.fromJson(Map<String, dynamic> j) => CircleMemberView(
        memberId: j['memberId'] as String,
        userId: j['userId'] as String,
        role: j['role'] as String,
        joinedAt: DateTime.parse(j['joinedAt'] as String),
        name: j['name'] as String?,
        phone: j['phone'] as String?,
      );
}

class CircleGoal {
  CircleGoal({
    required this.id,
    required this.title,
    required this.targetAmountMinor,
    required this.status,
    this.dueDate,
    this.expectedPerMemberMinor,
    this.frequency,
  });

  final String id;
  final String title;
  final String targetAmountMinor;
  final String status;
  final DateTime? dueDate;
  final String? expectedPerMemberMinor;
  final String? frequency;

  factory CircleGoal.fromJson(Map<String, dynamic> j) => CircleGoal(
        id: j['id'] as String,
        title: j['title'] as String,
        targetAmountMinor: j['targetAmountMinor'] as String,
        status: j['status'] as String,
        dueDate: j['dueDate'] == null ? null : DateTime.parse(j['dueDate'] as String),
        expectedPerMemberMinor: j['expectedPerMemberMinor'] as String?,
        frequency: j['frequency'] as String?,
      );
}

class CircleDetail {
  CircleDetail({
    required this.summary,
    required this.members,
    required this.goals,
    required this.pendingInvitations,
  });

  final CircleSummary summary;
  final List<CircleMemberView> members;
  final List<CircleGoal> goals;
  final List<CircleInvitationView> pendingInvitations;

  factory CircleDetail.fromJson(Map<String, dynamic> j) => CircleDetail(
        summary: CircleSummary.fromJson(j),
        members: (j['members'] as List<dynamic>? ?? [])
            .map((e) => CircleMemberView.fromJson(e as Map<String, dynamic>))
            .toList(),
        goals: (j['goals'] as List<dynamic>? ?? [])
            .map((e) => CircleGoal.fromJson(e as Map<String, dynamic>))
            .toList(),
        pendingInvitations: (j['pendingInvitations'] as List<dynamic>? ?? [])
            .map((e) => CircleInvitationView.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class CircleInvitationView {
  CircleInvitationView({
    required this.token,
    required this.circleId,
    required this.status,
    required this.expiresAt,
    this.inviteePhone,
    this.circleName,
    this.inviterName,
  });

  final String token;
  final String circleId;
  final String status;
  final DateTime expiresAt;
  final String? inviteePhone;
  final String? circleName;
  final String? inviterName;

  factory CircleInvitationView.fromJson(Map<String, dynamic> j) {
    final circle = j['circle'] as Map<String, dynamic>?;
    return CircleInvitationView(
      token: j['token'] as String,
      circleId: j['circleId'] as String,
      status: j['status'] as String,
      expiresAt: DateTime.parse(j['expiresAt'] as String),
      inviteePhone: j['inviteePhone'] as String?,
      circleName: circle?['name'] as String?,
      inviterName: j['inviterName'] as String?,
    );
  }
}

/// Confirmed vs self-reported progress — never merged.
class CircleProgress {
  CircleProgress({
    required this.currencyCode,
    required this.confirmedTotal,
    required this.unverifiedTotal,
    required this.goals,
    required this.members,
    this.targetAmount,
  });

  final String currencyCode;
  final String confirmedTotal;
  final String unverifiedTotal;
  final List<GoalProgress> goals;
  final List<MemberProgress> members;
  final String? targetAmount;

  factory CircleProgress.fromJson(Map<String, dynamic> j) => CircleProgress(
        currencyCode: j['currencyCode'] as String? ?? 'TZS',
        confirmedTotal: j['confirmedTotal'] as String? ?? '0',
        unverifiedTotal: j['unverifiedTotal'] as String? ?? '0',
        goals: (j['goals'] as List<dynamic>? ?? [])
            .map((e) => GoalProgress.fromJson(e as Map<String, dynamic>))
            .toList(),
        members: (j['members'] as List<dynamic>? ?? [])
            .map((e) => MemberProgress.fromJson(e as Map<String, dynamic>))
            .toList(),
        targetAmount: j['targetAmount'] as String?,
      );
}

class GoalProgress {
  GoalProgress({required this.goalId, required this.title, required this.target, required this.confirmed, required this.unverified, required this.status});
  final String goalId;
  final String title;
  final String target;
  final String confirmed;
  final String unverified;
  final String status;

  double get ratio {
    final t = BigInt.parse(target);
    if (t <= BigInt.zero) return 0;
    final r = (BigInt.parse(confirmed) * BigInt.from(1000)) ~/ t;
    return r.toInt() / 1000;
  }

  factory GoalProgress.fromJson(Map<String, dynamic> j) => GoalProgress(
        goalId: j['goalId'] as String,
        title: j['title'] as String,
        target: j['targetAmount'] as String? ?? '0',
        confirmed: j['confirmed'] as String? ?? '0',
        unverified: j['unverified'] as String? ?? '0',
        status: j['status'] as String? ?? 'ACTIVE',
      );
}

class MemberProgress {
  MemberProgress({required this.memberId, required this.userId, required this.role, required this.confirmed, required this.unverified});
  final String memberId;
  final String userId;
  final String role;
  final String confirmed;
  final String unverified;

  factory MemberProgress.fromJson(Map<String, dynamic> j) => MemberProgress(
        memberId: j['memberId'] as String,
        userId: j['userId'] as String,
        role: j['role'] as String? ?? 'MEMBER',
        confirmed: j['confirmed'] as String? ?? '0',
        unverified: j['unverified'] as String? ?? '0',
      );
}
