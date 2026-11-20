import 'api_client.dart';

/// Identity verification (/v1/kyc). A submission holds the ID details; document
/// photos are uploaded to it as raw JPEG/PNG bytes and reviewed by SurePesa.
class KycApi {
  KycApi(this._api);

  final ApiClient _api;

  Future<String> createSubmission({
    required String fullName,
    required String idType,
    required String idNumber,
    DateTime? dateOfBirth,
  }) async {
    final data = await _api.post('/v1/kyc/submissions', {
      'fullName': fullName,
      'idType': idType,
      'idNumber': idNumber,
      if (dateOfBirth != null) 'dateOfBirth': dateOfBirth.toIso8601String(),
    });
    return data['id'] as String;
  }

  Future<void> uploadDocument(String submissionId, String type, List<int> bytes, String mimeType) =>
      _api.putBytes('/v1/kyc/submissions/${Uri.encodeComponent(submissionId)}/documents/$type', bytes, mimeType);
}
