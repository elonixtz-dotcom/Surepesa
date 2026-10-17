import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import 'auth_service.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;
  @override
  String toString() => message;
}

/// Authenticated JSON client for the SurePesa API.
class ApiClient {
  ApiClient(this._auth, {http.Client? client}) : _http = client ?? http.Client();

  final AuthService _auth;
  final http.Client _http;

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) =>
      _send('POST', path, body);

  Future<Map<String, dynamic>> _send(String method, String path, [Map<String, dynamic>? body]) async {
    final token = await _auth.accessToken();
    final request = http.Request(method, Uri.parse('${AppConfig.apiBaseUrl}$path'))
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
        if (body != null) 'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);

    final http.Response res;
    try {
      res = await http.Response.fromStream(
        await _http.send(request).timeout(const Duration(seconds: 30)),
      );
    } catch (_) {
      throw ApiException(0, 'NETWORK_ERROR', 'Cannot reach SurePesa. Check your connection.');
    }

    final data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      final error = data['error'] as Map<String, dynamic>?;
      throw ApiException(
        res.statusCode,
        error?['code'] as String? ?? 'HTTP_${res.statusCode}',
        error?['message'] as String? ?? 'Request failed',
      );
    }
    return data;
  }
}
