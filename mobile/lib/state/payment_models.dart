/// Shapes returned by the payments API (/v1/payments, /v1/transactions, /v1/payment-methods).
/// Amounts stay as the server's strings: `value` is a decimal string, `formatted` is for display.
library;

class Money {
  const Money({required this.value, required this.formatted});

  factory Money.fromJson(Map<String, dynamic> j) =>
      Money(value: j['value'] as String, formatted: j['formatted'] as String);

  final String value;
  final String formatted;
}

/// Who the money goes to (or comes from), as the rail or SurePesa has them registered.
class Party {
  const Party({this.name, this.account});

  factory Party.fromJson(Map<String, dynamic> j) =>
      Party(name: j['name'] as String?, account: j['account'] as String?);

  final String? name;

  /// Masked phone number ("+255 71* *** 678"), merchant code, or linked account mask.
  final String? account;
}

/// The four payment flows, with the `type` the quote endpoint expects.
enum PayFlow {
  send('P2P_TRANSFER', '/v1/payments/send', 'Send money'),
  merchant('MERCHANT_PAYMENT', '/v1/payments/merchant', 'Pay merchant'),
  withdraw('WITHDRAWAL', '/v1/payments/withdraw', 'Withdraw'),
  deposit('DEPOSIT', '/v1/payments/deposit', 'Add money');

  const PayFlow(this.quoteType, this.path, this.title);

  final String quoteType;
  final String path;
  final String title;

  bool get usesLinkedAccount => this == withdraw || this == deposit;
}

/// What the customer is about to pay: the fields shared by the quote and the payment call.
class PaymentRequest {
  const PaymentRequest({
    required this.flow,
    required this.amount,
    this.recipientPhone,
    this.merchantCode,
    this.paymentMethodId,
  });

  final PayFlow flow;

  /// Decimal string as typed, e.g. "25000".
  final String amount;
  final String? recipientPhone;
  final String? merchantCode;
  final String? paymentMethodId;

  Map<String, dynamic> toJson() => {
        'amount': amount,
        if (recipientPhone != null) 'recipientPhone': recipientPhone,
        if (merchantCode != null) 'merchantCode': merchantCode,
        if (paymentMethodId != null) 'paymentMethodId': paymentMethodId,
      };
}

class Quote {
  Quote({
    required this.type,
    required this.recipient,
    required this.amount,
    required this.fee,
    required this.total,
    required this.currency,
    required this.requiresPin,
    required this.sufficientBalance,
    this.notice,
  });

  factory Quote.fromJson(Map<String, dynamic> j) => Quote(
        type: j['type'] as String,
        recipient: Party.fromJson(j['recipient'] as Map<String, dynamic>),
        amount: Money.fromJson(j['amount'] as Map<String, dynamic>),
        fee: Money.fromJson(j['fee'] as Map<String, dynamic>),
        total: Money.fromJson(j['total'] as Map<String, dynamic>),
        currency: j['currency'] as String,
        requiresPin: j['requiresPin'] as bool,
        sufficientBalance: j['sufficientBalance'] as bool,
        notice: j['notice'] as String?,
      );

  final String type;
  final Party recipient;
  final Money amount;
  final Money fee;
  final Money total;
  final String currency;
  final bool requiresPin;
  final bool sufficientBalance;
  final String? notice;
}

class RailRef {
  const RailRef({required this.name, this.reference});

  factory RailRef.fromJson(Map<String, dynamic> j) =>
      RailRef(name: j['name'] as String, reference: j['reference'] as String?);

  /// "M-Pesa", "Airtel Money"...
  final String name;

  /// The rail's own reference: what the customer quotes to that network's support.
  final String? reference;
}

/// The in-app receipt (backend/src/services/receipt.service.ts `presentReceipt`).
class Receipt {
  Receipt({
    required this.reference,
    required this.type,
    required this.status,
    required this.statusText,
    required this.isFinal,
    required this.direction,
    required this.amount,
    required this.fee,
    required this.total,
    required this.currency,
    required this.createdAt,
    this.counterparty,
    this.description,
    this.rail,
    this.relatedTo,
    this.refunded,
    this.completedAt,
  });

  factory Receipt.fromJson(Map<String, dynamic> j) => Receipt(
        reference: j['reference'] as String,
        type: j['type'] as String,
        status: j['status'] as String,
        statusText: j['statusText'] as String,
        isFinal: j['final'] as bool,
        direction: j['direction'] as String,
        amount: Money.fromJson(j['amount'] as Map<String, dynamic>),
        fee: Money.fromJson(j['fee'] as Map<String, dynamic>),
        total: Money.fromJson(j['total'] as Map<String, dynamic>),
        currency: j['currency'] as String,
        counterparty: j['counterparty'] == null ? null : Party.fromJson(j['counterparty'] as Map<String, dynamic>),
        description: j['description'] as String?,
        rail: j['rail'] == null ? null : RailRef.fromJson(j['rail'] as Map<String, dynamic>),
        relatedTo: j['relatedTo'] as String?,
        refunded: j['refunded'] == null ? null : Money.fromJson(j['refunded'] as Map<String, dynamic>),
        createdAt: DateTime.parse(j['createdAt'] as String).toLocal(),
        completedAt: j['completedAt'] == null ? null : DateTime.parse(j['completedAt'] as String).toLocal(),
      );

  /// Our reference, e.g. "SPX…".
  final String reference;
  final String type;
  final String status;

  /// Plain-language status from the server ("Completed", "Sending to your M-Pesa account").
  final String statusText;

  /// False while the rail is still working (PENDING / PROCESSING): keep polling.
  final bool isFinal;

  /// "IN" or "OUT" from the viewer's side.
  final String direction;
  final Money amount;
  final Money fee;
  final Money total;
  final String currency;
  final Party? counterparty;
  final String? description;
  final RailRef? rail;
  final String? relatedTo;
  final Money? refunded;
  final DateTime createdAt;
  final DateTime? completedAt;

  bool get isIncoming => direction == 'IN';
  bool get succeeded => status == 'SUCCESS';
  bool get failed => status == 'FAILED' || status == 'CANCELLED';

  String get typeLabel => switch (type) {
        'P2P_TRANSFER' => isIncoming ? 'Money received' : 'Money sent',
        'MERCHANT_PAYMENT' => isIncoming ? 'Payment received' : 'Merchant payment',
        'WITHDRAWAL' => 'Withdrawal',
        'DEPOSIT' => 'Deposit',
        'REFUND' => 'Refund',
        'REVERSAL' => 'Reversal',
        _ => type.replaceAll('_', ' ').toLowerCase(),
      };
}

class ReceiptPage {
  ReceiptPage({required this.items, this.next});

  factory ReceiptPage.fromJson(Map<String, dynamic> j) => ReceiptPage(
        items: (j['items'] as List<dynamic>).map((e) => Receipt.fromJson(e as Map<String, dynamic>)).toList(),
        next: j['next'] as String?,
      );

  final List<Receipt> items;

  /// Pass back as `before` for the next page; null on the last page.
  final String? next;
}

/// A linked mobile-money account.
class PaymentMethod {
  PaymentMethod({
    required this.id,
    required this.provider,
    required this.providerName,
    required this.maskedNumber,
    required this.status,
    required this.isDefault,
    this.label,
    this.accountName,
  });

  factory PaymentMethod.fromJson(Map<String, dynamic> j) => PaymentMethod(
        id: j['id'] as String,
        provider: j['provider'] as String,
        providerName: j['providerName'] as String,
        label: j['label'] as String?,
        accountName: j['accountName'] as String?,
        maskedNumber: j['maskedNumber'] as String,
        status: j['status'] as String,
        isDefault: j['isDefault'] as bool,
      );

  final String id;
  final String provider;
  final String providerName;
  final String? label;

  /// The name the rail has registered for this number.
  final String? accountName;
  final String maskedNumber;
  final String status;
  final bool isDefault;
}

/// Mobile-money rails a customer can link (POST /v1/payment-methods `provider`).
const mobileMoneyProviders = [
  ('MPESA_TZ', 'M-Pesa'),
  ('AIRTEL_TZ', 'Airtel Money'),
  ('YAS_TZ', 'Mixx by Yas'),
  ('HALOPESA', 'HaloPesa'),
];
