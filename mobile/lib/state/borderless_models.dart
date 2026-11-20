/// Borderless models (blueprint §7): corridors, FX quotes, cross-border transfers.
library;

class Corridor {
  Corridor({
    required this.id,
    required this.originCountry,
    required this.destinationCountry,
    required this.sourceCurrency,
    required this.destinationCurrency,
    required this.providerName,
    required this.minAmountMinor,
    required this.maxAmountMinor,
  });

  final String id;
  final String originCountry;
  final String destinationCountry;
  final String sourceCurrency;
  final String destinationCurrency;
  final String providerName;
  final String minAmountMinor;
  final String maxAmountMinor;

  factory Corridor.fromJson(Map<String, dynamic> j) => Corridor(
        id: j['id'] as String,
        originCountry: j['originCountry'] as String,
        destinationCountry: j['destinationCountry'] as String,
        sourceCurrency: j['sourceCurrency'] as String,
        destinationCurrency: j['destinationCurrency'] as String,
        providerName: j['providerName'] as String,
        minAmountMinor: j['minAmountMinor'] as String,
        maxAmountMinor: j['maxAmountMinor'] as String,
      );
}

class FxQuoteView {
  FxQuoteView({
    required this.id,
    required this.corridorId,
    required this.sourceAmountMinor,
    required this.sourceCurrency,
    required this.destinationAmountMinor,
    required this.destinationCurrency,
    required this.rate,
    required this.feeMinor,
    required this.status,
    required this.expiresAt,
  });

  final String id;
  final String corridorId;
  final String sourceAmountMinor;
  final String sourceCurrency;
  final String destinationAmountMinor;
  final String destinationCurrency;
  final String rate;
  final String feeMinor;
  final String status;
  final DateTime expiresAt;

  factory FxQuoteView.fromJson(Map<String, dynamic> j) => FxQuoteView(
        id: j['id'] as String,
        corridorId: j['corridorId'] as String,
        sourceAmountMinor: j['sourceAmountMinor'] as String,
        sourceCurrency: j['sourceCurrency'] as String,
        destinationAmountMinor: j['destinationAmountMinor'] as String,
        destinationCurrency: j['destinationCurrency'] as String,
        rate: j['rate'] as String,
        feeMinor: j['feeMinor'] as String? ?? '0',
        status: j['status'] as String,
        expiresAt: DateTime.parse(j['expiresAt'] as String),
      );
}

class TransferView {
  TransferView({
    required this.id,
    required this.reference,
    required this.status,
    required this.role,
    required this.recipientCountry,
    required this.createdAt,
    this.sourceAmountMinor,
    this.sourceCurrency,
    this.destinationAmountMinor,
    this.destinationCurrency,
    this.feeMinor,
  });

  final String id;
  final String reference;
  final String status;
  final String role; // SENDER or RECIPIENT
  final String recipientCountry;
  final DateTime createdAt;
  final String? sourceAmountMinor;
  final String? sourceCurrency;
  final String? destinationAmountMinor;
  final String? destinationCurrency;
  final String? feeMinor;

  factory TransferView.fromJson(Map<String, dynamic> j) => TransferView(
        id: j['id'] as String,
        reference: j['reference'] as String,
        status: j['status'] as String,
        role: j['role'] as String,
        recipientCountry: j['recipientCountry'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        sourceAmountMinor: j['sourceAmountMinor'] as String?,
        sourceCurrency: j['sourceCurrency'] as String?,
        destinationAmountMinor: j['destinationAmountMinor'] as String?,
        destinationCurrency: j['destinationCurrency'] as String?,
        feeMinor: j['feeMinor'] as String?,
      );
}
