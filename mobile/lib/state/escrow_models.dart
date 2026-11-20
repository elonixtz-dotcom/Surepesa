/// Escrow ★ models (blueprint §10). A protected deal whose funds sit in a dedicated
/// escrow holding wallet until the buyer confirms or an authorised dispute resolves.
library;

class EscrowCaseView {
  EscrowCaseView({
    required this.id,
    required this.reference,
    required this.status,
    required this.role,
    required this.itemDescription,
    required this.amountMinor,
    required this.feeMinor,
    required this.currencyCode,
    required this.inspectionDays,
    required this.createdAt,
    this.fundingDeadline,
    this.deliveryDeadline,
    this.deliveredAt,
  });

  final String id;
  final String reference;
  final String status;

  /// BUYER or SELLER — from the viewer's perspective.
  final String role;
  final String itemDescription;
  final String amountMinor;
  final String feeMinor;
  final String currencyCode;
  final int inspectionDays;
  final DateTime createdAt;
  final DateTime? fundingDeadline;
  final DateTime? deliveryDeadline;
  final DateTime? deliveredAt;

  bool get isBuyer => role == 'BUYER';
  bool get isTerminal =>
      const {'RELEASED', 'REFUNDED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'FUNDING_FAILED'}.contains(status);

  factory EscrowCaseView.fromJson(Map<String, dynamic> j) => EscrowCaseView(
        id: j['id'] as String,
        reference: j['reference'] as String,
        status: j['status'] as String,
        role: j['role'] as String,
        itemDescription: j['itemDescription'] as String,
        amountMinor: j['amountMinor'] as String,
        feeMinor: j['feeMinor'] as String? ?? '0',
        currencyCode: j['currencyCode'] as String? ?? 'TZS',
        inspectionDays: (j['inspectionDays'] as num?)?.toInt() ?? 3,
        createdAt: DateTime.parse(j['createdAt'] as String),
        fundingDeadline: j['fundingDeadline'] == null ? null : DateTime.parse(j['fundingDeadline'] as String),
        deliveryDeadline: j['deliveryDeadline'] == null ? null : DateTime.parse(j['deliveryDeadline'] as String),
        deliveredAt: j['deliveredAt'] == null ? null : DateTime.parse(j['deliveredAt'] as String),
      );
}

class EscrowEventView {
  EscrowEventView({required this.action, required this.at, this.note});
  final String action;
  final DateTime at;
  final String? note;

  factory EscrowEventView.fromJson(Map<String, dynamic> j) => EscrowEventView(
        action: j['action'] as String? ?? '',
        at: DateTime.parse(j['at'] as String),
        note: j['note'] as String?,
      );
}

class EscrowDetail extends EscrowCaseView {
  EscrowDetail({
    required super.id,
    required super.reference,
    required super.status,
    required super.role,
    required super.itemDescription,
    required super.amountMinor,
    required super.feeMinor,
    required super.currencyCode,
    required super.inspectionDays,
    required super.createdAt,
    super.fundingDeadline,
    super.deliveryDeadline,
    super.deliveredAt,
    required this.events,
    required this.heldMinor,
  });

  final List<EscrowEventView> events;

  /// Balance of the deal's escrow holding wallet (null until funded).
  final String? heldMinor;

  factory EscrowDetail.fromJson(Map<String, dynamic> j) => EscrowDetail(
        id: j['id'] as String,
        reference: j['reference'] as String,
        status: j['status'] as String,
        role: j['role'] as String,
        itemDescription: j['itemDescription'] as String,
        amountMinor: j['amountMinor'] as String,
        feeMinor: j['feeMinor'] as String? ?? '0',
        currencyCode: j['currencyCode'] as String? ?? 'TZS',
        inspectionDays: (j['inspectionDays'] as num?)?.toInt() ?? 3,
        createdAt: DateTime.parse(j['createdAt'] as String),
        fundingDeadline: j['fundingDeadline'] == null ? null : DateTime.parse(j['fundingDeadline'] as String),
        deliveryDeadline: j['deliveryDeadline'] == null ? null : DateTime.parse(j['deliveryDeadline'] as String),
        deliveredAt: j['deliveredAt'] == null ? null : DateTime.parse(j['deliveredAt'] as String),
        events: (j['events'] as List<dynamic>? ?? [])
            .map((e) => EscrowEventView.fromJson(e as Map<String, dynamic>))
            .toList(),
        heldMinor: (j['escrowWallet'] as Map<String, dynamic>?)?['heldMinor'] as String?,
      );
}
