class WalletSummary {
  WalletSummary({
    required this.id,
    required this.currency,
    required this.balance,
    required this.status,
  });

  factory WalletSummary.fromJson(Map<String, dynamic> j) => WalletSummary(
        id: j['id'] as String,
        currency: j['currency'] as String,
        balance: j['balance'] as String,
        status: j['status'] as String,
      );

  final String id;
  final String currency;

  /// Decimal string from the API, e.g. "245000.00". Never parsed into a double.
  final String balance;
  final String status;
}

class Me {
  Me({
    required this.id,
    required this.email,
    required this.phoneNumber,
    required this.status,
    required this.kycStatus,
    required this.firstName,
    required this.lastName,
    required this.wallets,
  });

  factory Me.fromJson(Map<String, dynamic> j) {
    final profile = j['profile'] as Map<String, dynamic>?;
    return Me(
      id: j['id'] as String,
      email: j['email'] as String?,
      phoneNumber: j['phoneNumber'] as String?,
      status: j['status'] as String,
      kycStatus: j['kycStatus'] as String,
      firstName: profile?['firstName'] as String?,
      lastName: profile?['lastName'] as String?,
      wallets: (j['wallets'] as List<dynamic>)
          .map((w) => WalletSummary.fromJson(w as Map<String, dynamic>))
          .toList(),
    );
  }

  final String id;
  final String? email;
  final String? phoneNumber;
  final String status;
  final String kycStatus;
  final String? firstName;
  final String? lastName;
  final List<WalletSummary> wallets;

  bool get needsOnboarding => phoneNumber == null || firstName == null;
  bool get isVerified => kycStatus == 'APPROVED';
  String get displayName => [firstName, lastName].whereType<String>().join(' ');

  WalletSummary? walletIn(String currency) {
    for (final w in wallets) {
      if (w.currency == currency) return w;
    }
    return null;
  }
}
