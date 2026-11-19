import '../state/pushbill_models.dart';
import 'api_client.dart';
import 'payments_api.dart';

/// PushBill ★ endpoints (/v1/pushbills). Money moves only in [authorize], after the call.
class PushBillApi {
  PushBillApi(this._api);

  final ApiClient _api;

  Future<PushBillSession> create({
    required String destinationKind,
    required String destination,
    required String payerPhone,
    required String amount,
    String? note,
  }) async =>
      PushBillSession.fromJson(await _api.post('/v1/pushbills', {
        'destinationKind': destinationKind,
        'destination': destination,
        'payerPhone': payerPhone,
        'amount': amount,
        if (note != null && note.isNotEmpty) 'note': note,
      }, headers: {'Idempotency-Key': newIdempotencyKey()}));

  Future<PushBillPage> list({String? before, int limit = 20}) async => PushBillPage.fromJson(
        await _api.get('/v1/pushbills', query: {'limit': '$limit', if (before != null) 'before': before}),
      );

  Future<PushBillSession> get(String id) async =>
      PushBillSession.fromJson(await _api.get('/v1/pushbills/${Uri.encodeComponent(id)}'));

  Future<PushBillSession> accept(String id) async =>
      PushBillSession.fromJson(await _api.post('/v1/pushbills/${Uri.encodeComponent(id)}/accept', const {}));

  Future<PushBillSession> decline(String id) async =>
      PushBillSession.fromJson(await _api.post('/v1/pushbills/${Uri.encodeComponent(id)}/decline', const {}));

  Future<PushBillSession> cancel(String id) async =>
      PushBillSession.fromJson(await _api.post('/v1/pushbills/${Uri.encodeComponent(id)}/cancel', const {}));

  Future<PushBillSession> startCall(String id) async =>
      PushBillSession.fromJson(await _api.post('/v1/pushbills/${Uri.encodeComponent(id)}/call', const {}));

  Future<PushBillSession> confirm(String id, {required String result, String method = 'IN_APP'}) async =>
      PushBillSession.fromJson(await _api.post('/v1/pushbills/${Uri.encodeComponent(id)}/confirm', {
        'result': result,
        'method': method,
      }));

  /// The payer's authorisation, after the call. Keep the same [idempotencyKey] across retries.
  Future<PushBillSession> authorize(String id, {required String pin, required String idempotencyKey}) async =>
      PushBillSession.fromJson(await _api.post(
        '/v1/pushbills/${Uri.encodeComponent(id)}/authorize',
        {'pin': pin},
        headers: {'Idempotency-Key': idempotencyKey},
      ));
}
