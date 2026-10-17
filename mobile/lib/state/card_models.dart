import 'payment_models.dart';

/// A prepaid virtual card. Never carries the full card number or CVV: those come only from
/// [CardDetails], fetched after a PIN check and kept on screen briefly.
class VirtualCard {
  VirtualCard({
    required this.id,
    required this.nickname,
    required this.status,
    required this.brand,
    required this.last4,
    required this.expiry,
    required this.currency,
    required this.balance,
    required this.perTransactionLimit,
    required this.failureReason,
  });

  factory VirtualCard.fromJson(Map<String, dynamic> j) => VirtualCard(
        id: j['id'] as String,
        nickname: j['nickname'] as String,
        status: j['status'] as String,
        brand: j['brand'] as String,
        last4: j['last4'] as String?,
        expiry: j['expiry'] as String?,
        currency: j['currency'] as String,
        balance: Money.fromJson(j['balance'] as Map<String, dynamic>),
        perTransactionLimit: j['perTransactionLimit'] == null ? null : Money.fromJson(j['perTransactionLimit'] as Map<String, dynamic>),
        failureReason: j['failureReason'] as String?,
      );

  final String id;
  final String nickname;

  /// REQUESTED, ACTIVE, FROZEN, CLOSED, FAILED
  final String status;
  final String brand;
  final String? last4;

  /// "MM/YY"
  final String? expiry;
  final String currency;
  final Money balance;
  final Money? perTransactionLimit;
  final String? failureReason;

  bool get isActive => status == 'ACTIVE';
  bool get isFrozen => status == 'FROZEN';
  bool get isOpen => status == 'ACTIVE' || status == 'FROZEN';
  bool get isClosed => status == 'CLOSED';
  String get masked => '•••• ${last4 ?? '----'}';
}

/// Shown once after the PIN; never stored on the device.
sealed class CardDetails {
  const CardDetails();
  factory CardDetails.fromJson(Map<String, dynamic> j) => j['kind'] == 'DETAILS'
      ? RevealedNumbers(
          pan: j['pan'] as String,
          cvv: j['cvv'] as String,
          expiryMonth: j['expiryMonth'] as int,
          expiryYear: j['expiryYear'] as int,
          holderName: j['holderName'] as String,
        )
      : DeliveredByIssuer(message: j['message'] as String);
}

class RevealedNumbers extends CardDetails {
  const RevealedNumbers({required this.pan, required this.cvv, required this.expiryMonth, required this.expiryYear, required this.holderName});
  final String pan;
  final String cvv;
  final int expiryMonth;
  final int expiryYear;
  final String holderName;

  /// "4000 0012 3456 7890"
  String get grouped => [for (var i = 0; i < pan.length; i += 4) pan.substring(i, i + 4 > pan.length ? pan.length : i + 4)].join(' ');
  String get expiry => '${expiryMonth.toString().padLeft(2, '0')}/${expiryYear.toString().substring(2)}';
}

/// The issuer sent the details to the customer directly (e.g. a secure SMS link).
class DeliveredByIssuer extends CardDetails {
  const DeliveredByIssuer({required this.message});
  final String message;
}

class CardPage {
  CardPage(this.card, this.transactions);
  final VirtualCard card;
  final List<Receipt> transactions;
}
