import '../state/borderless_models.dart';
import 'api_client.dart';
import 'payments_api.dart';

/// Borderless endpoints (/v1/borderless): corridors, FX quotes, cross-border transfers.
class BorderlessApi {
  BorderlessApi(this._api);

  final ApiClient _api;

  Future<List<Corridor>> corridors() async {
    final data = await _api.get('/v1/borderless/corridors');
    return (data['items'] as List<dynamic>)
        .map((e) => Corridor.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<FxQuoteView> quote({required String corridorId, required String sourceAmountMinor}) async =>
      FxQuoteView.fromJson(await _api.post('/v1/borderless/quotes', {
        'corridorId': corridorId,
        'sourceAmount': sourceAmountMinor,
      }));

  Future<FxQuoteView> acceptQuote(String quoteId) async =>
      FxQuoteView.fromJson(await _api.post('/v1/borderless/quotes/${Uri.encodeComponent(quoteId)}/accept', const {}));

  Future<TransferView> send({
    required String quoteId,
    required String recipientPhone,
    required String pin,
  }) async =>
      TransferView.fromJson(await _api.post('/v1/borderless/transfers', {
        'quoteId': quoteId,
        'recipientPhone': recipientPhone,
        'pin': pin,
      }, headers: {'Idempotency-Key': newIdempotencyKey()}));

  Future<List<TransferView>> transfers() async {
    final data = await _api.get('/v1/borderless/transfers');
    return (data['items'] as List<dynamic>)
        .map((e) => TransferView.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
