/// PushBill ★ models (blueprint §6). A session is a request for another SurePesa user to pay
/// a merchant/agent, authorised only after a bridged call and explicit confirmations.
library;

enum PushBillDestinationKind { qrCode, merchantCode, agentNumber }

class PushBillSession {
  PushBillSession({
    required this.id,
    required this.reference,
    required this.state,
    required this.role,
    required this.destinationKind,
    required this.destinationLabel,
    required this.amountValue,
    required this.amountFormatted,
    required this.note,
    required this.expiresAt,
    required this.paidTransactionId,
    required this.createdAt,
  });

  final String id;
  final String reference;
  final String state;

  /// REQUESTER or PAYER — from the viewer's perspective.
  final String role;
  final String destinationKind;
  final String? destinationLabel;
  final String amountValue;
  final String amountFormatted;
  final String? note;
  final DateTime expiresAt;
  final String? paidTransactionId;
  final DateTime createdAt;

  bool get isPayer => role == 'PAYER';
  bool get isTerminal => const {
        'PAID',
        'DECLINED',
        'NO_ANSWER',
        'CALL_FAILED',
        'MISMATCH',
        'EXPIRED',
        'CANCELLED',
        'PAYMENT_FAILED',
      }.contains(state);

  factory PushBillSession.fromJson(Map<String, dynamic> json) {
    final destination = json['destination'] as Map<String, dynamic>? ?? const {};
    final amount = json['amount'] as Map<String, dynamic>? ?? const {};
    return PushBillSession(
      id: json['id'] as String,
      reference: json['reference'] as String,
      state: json['state'] as String,
      role: json['role'] as String,
      destinationKind: destination['kind'] as String? ?? 'MERCHANT_CODE',
      destinationLabel: destination['label'] as String?,
      amountValue: amount['value']?.toString() ?? '0',
      amountFormatted: amount['formatted']?.toString() ?? '',
      note: json['note'] as String?,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      paidTransactionId: json['paidTransactionId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}

class PushBillPage {
  PushBillPage({required this.items, required this.next});

  final List<PushBillSession> items;

  /// Pass as `before` to fetch the next page; null when the list is exhausted.
  final String? next;

  factory PushBillPage.fromJson(Map<String, dynamic> json) => PushBillPage(
        items: (json['items'] as List<dynamic>)
            .map((e) => PushBillSession.fromJson(e as Map<String, dynamic>))
            .toList(),
        next: json['next'] as String?,
      );
}
