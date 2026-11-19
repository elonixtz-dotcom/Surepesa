import 'dart:math';

import '../state/payment_models.dart';
import 'api_client.dart';

/// A fresh v4 UUID for the Idempotency-Key header.
String newIdempotencyKey() {
  final rnd = Random.secure();
  final b = List<int>.generate(16, (_) => rnd.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// Customer payments: quote, pay, receipts, history and linked accounts.
class PaymentsApi {
  PaymentsApi(this._api);

  final ApiClient _api;

  /// The confirmation screen's data. Moves no money.
  Future<Quote> quote(PaymentRequest request) async => Quote.fromJson(
        await _api.post('/v1/payments/quote', {'type': request.flow.quoteType, ...request.toJson()}),
      );

  /// Makes the payment. Send the same [idempotencyKey] when retrying the same attempt, so a
  /// request that timed out after the server got it returns the original receipt instead of
  /// paying twice. [pin] is ignored for deposits (the customer approves on their phone).
  Future<Receipt> pay(PaymentRequest request, {required String idempotencyKey, String? pin}) async {
    final body = {
      ...request.toJson(),
      if (pin != null && request.flow != PayFlow.deposit) 'pin': pin,
    };
    return Receipt.fromJson(
      await _api.post(request.flow.path, body, headers: {'Idempotency-Key': idempotencyKey}),
    );
  }

  Future<Receipt> receipt(String reference) async =>
      Receipt.fromJson(await _api.get('/v1/transactions/${Uri.encodeComponent(reference)}'));

  Future<ReceiptPage> history({String? before, int limit = 20}) async => ReceiptPage.fromJson(
        await _api.get('/v1/transactions', query: {'limit': '$limit', if (before != null) 'before': before}),
      );

  Future<List<PaymentMethod>> paymentMethods() async {
    final data = await _api.get('/v1/payment-methods');
    return (data['items'] as List<dynamic>).map((e) => PaymentMethod.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Links a mobile-money number. The result carries the rail's registered name.
  Future<PaymentMethod> addPaymentMethod({required String provider, required String phoneNumber, String? label}) async {
    final data = await _api.post('/v1/payment-methods', {
      'provider': provider,
      'phoneNumber': phoneNumber,
      if (label != null && label.isNotEmpty) 'label': label,
    });
    // The create response has no `label`; the list response does.
    return PaymentMethod.fromJson({'label': null, ...data});
  }

  /// Sets the transaction PIN, or changes it when [currentPin] is given.
  Future<void> setPin(String pin, {String? currentPin}) async {
    await _api.put('/v1/me/pin', {'pin': pin, if (currentPin != null) 'currentPin': currentPin});
  }

  /// Checks the PIN to unlock the app. WRONG_PIN and PIN_LOCKED count like a payment would.
  Future<void> verifyPin(String pin) async {
    await _api.post('/v1/me/pin/verify', {'pin': pin});
  }
}
