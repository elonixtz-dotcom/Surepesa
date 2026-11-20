import '../state/escrow_models.dart';
import 'api_client.dart';
import 'payments_api.dart';

/// Escrow ★ endpoints (/v1/escrow). Money moves only on funding (buyer's PIN) and on an
/// authorised release/refund; held funds are unreachable by any other endpoint.
class EscrowApi {
  EscrowApi(this._api);

  final ApiClient _api;

  Future<EscrowCaseView> create({
    required String sellerPhone,
    required String itemDescription,
    required String amountMinor,
    int? deliveryDays,
    int? inspectionDays,
  }) async =>
      EscrowCaseView.fromJson(await _api.post('/v1/escrow/cases', {
        'sellerPhone': sellerPhone,
        'itemDescription': itemDescription,
        'amount': amountMinor,
        if (deliveryDays != null) 'deliveryDays': deliveryDays,
        if (inspectionDays != null) 'inspectionDays': inspectionDays,
      }, headers: {'Idempotency-Key': newIdempotencyKey()}));

  Future<List<EscrowCaseView>> list() async {
    final data = await _api.get('/v1/escrow/cases');
    return (data['items'] as List<dynamic>)
        .map((e) => EscrowCaseView.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<EscrowDetail> get(String id) async =>
      EscrowDetail.fromJson(await _api.get('/v1/escrow/cases/${Uri.encodeComponent(id)}'));

  Future<EscrowCaseView> acceptTerms(String id) => _post(id, 'accept-terms');
  Future<EscrowCaseView> decline(String id) => _post(id, 'decline');
  Future<EscrowCaseView> cancel(String id) => _post(id, 'cancel');
  Future<EscrowCaseView> startFulfilment(String id) => _post(id, 'fulfilment');
  Future<EscrowCaseView> markDelivered(String id) => _post(id, 'delivered');
  Future<EscrowCaseView> confirmReceipt(String id) => _post(id, 'confirm-receipt');
  Future<EscrowCaseView> agreeRefund(String id) => _post(id, 'refund');

  Future<EscrowCaseView> fund(String id, {required String pin}) async =>
      EscrowCaseView.fromJson(await _api.post(
        '/v1/escrow/cases/${Uri.encodeComponent(id)}/funding-intents',
        {'pin': pin},
        headers: {'Idempotency-Key': newIdempotencyKey()},
      ));

  Future<void> addEvidence(String id, {String type = 'NOTE', String? note}) =>
      _api.post('/v1/escrow/cases/${Uri.encodeComponent(id)}/evidence', {
        'type': type,
        if (note != null && note.isNotEmpty) 'note': note,
      });

  Future<void> openDispute(String id, {required String reason, required String requestedOutcome}) =>
      _api.post('/v1/escrow/cases/${Uri.encodeComponent(id)}/disputes', {
        'reason': reason,
        'requestedOutcome': requestedOutcome,
      });

  Future<EscrowCaseView> _post(String id, String action) async =>
      EscrowCaseView.fromJson(await _api.post('/v1/escrow/cases/${Uri.encodeComponent(id)}/$action', const {}));
}
