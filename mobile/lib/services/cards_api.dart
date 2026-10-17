import '../state/card_models.dart';
import '../state/payment_models.dart';
import 'api_client.dart';

/// Virtual cards: /v1/cards. Money-moving and detail-revealing calls take the PIN.
class CardsApi {
  CardsApi(this._api);

  final ApiClient _api;

  Future<(List<VirtualCard>, int)> list() async {
    final data = await _api.get('/v1/cards');
    final items = (data['items'] as List<dynamic>).map((e) => VirtualCard.fromJson(e as Map<String, dynamic>)).toList();
    return (items, data['maxOpenCards'] as int? ?? 3);
  }

  Future<CardPage> get(String id) async {
    final data = await _api.get('/v1/cards/$id');
    return CardPage(
      VirtualCard.fromJson(data['card'] as Map<String, dynamic>),
      (data['transactions'] as List<dynamic>).map((e) => Receipt.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  /// Issues a card. With [initialLoad] the same request also loads it, so it needs a key.
  Future<VirtualCard> create({
    required String nickname,
    required String pin,
    required String idempotencyKey,
    int? validityMonths,
    String? perTransactionLimit,
    String? initialLoad,
  }) async {
    final data = await _api.post(
      '/v1/cards',
      {
        'nickname': nickname,
        'pin': pin,
        if (validityMonths != null) 'validityMonths': validityMonths,
        if (perTransactionLimit != null && perTransactionLimit.isNotEmpty) 'perTransactionLimit': perTransactionLimit,
        if (initialLoad != null && initialLoad.isNotEmpty) 'initialLoad': initialLoad,
      },
      headers: {'Idempotency-Key': idempotencyKey},
    );
    return VirtualCard.fromJson(data['card'] as Map<String, dynamic>);
  }

  Future<Receipt> load(String id, {required String amount, required String pin, required String idempotencyKey}) async => Receipt.fromJson(
        await _api.post('/v1/cards/$id/load', {'amount': amount, 'pin': pin}, headers: {'Idempotency-Key': idempotencyKey}),
      );

  Future<Receipt> unload(String id, {required String amount, required String pin, required String idempotencyKey}) async => Receipt.fromJson(
        await _api.post('/v1/cards/$id/unload', {'amount': amount, 'pin': pin}, headers: {'Idempotency-Key': idempotencyKey}),
      );

  Future<VirtualCard> freeze(String id) async => VirtualCard.fromJson(await _api.post('/v1/cards/$id/freeze', {}));

  Future<VirtualCard> unfreeze(String id, String pin) async => VirtualCard.fromJson(await _api.post('/v1/cards/$id/unfreeze', {'pin': pin}));

  /// Per-purchase limit in TZS; null removes it.
  Future<VirtualCard> setLimit(String id, String? perTransaction) async =>
      VirtualCard.fromJson(await _api.put('/v1/cards/$id/limit', {'perTransaction': perTransaction}));

  Future<CardDetails> reveal(String id, String pin) async => CardDetails.fromJson(await _api.post('/v1/cards/$id/reveal', {'pin': pin}));

  Future<VirtualCard> close(String id, String pin) async => VirtualCard.fromJson(await _api.post('/v1/cards/$id/close', {'pin': pin}));

  /// Development backends only: the simulated issuer "charges" the card.
  Future<Map<String, dynamic>> testPurchase(String id, {required String amount, String merchantName = 'Test Online Store'}) =>
      _api.post('/v1/cards/$id/test-purchase', {'amount': amount, 'merchantName': merchantName});
}
