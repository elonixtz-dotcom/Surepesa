import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import 'auth_service.dart';

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);
  final int status;
  final String code;
  final String message;

  /// True when the request may or may not have reached the server (timeout, dropped connection).
  bool get isNetwork => status == 0;

  @override
  String toString() => message;
}

/// Authenticated JSON client for the SurePesa API.
class ApiClient {
  ApiClient(this._auth, {http.Client? client}) : _http = client ?? http.Client();

  final AuthService _auth;
  final http.Client _http;

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) {
    final uri = Uri.parse(path);
    final withQuery = query == null || query.isEmpty ? path : uri.replace(queryParameters: query).toString();
    return _send('GET', withQuery);
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body, {Map<String, String>? headers}) =>
      _send('POST', path, body, headers);

  Future<Map<String, dynamic>> put(String path, Map<String, dynamic> body) => _send('PUT', path, body);

  Future<Map<String, dynamic>> _send(
    String method,
    String path, [
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  ]) async {
    final token = await _auth.accessToken();
    final request = http.Request(method, Uri.parse('${AppConfig.apiBaseUrl}$path'))
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
        if (body != null) 'Content-Type': 'application/json',
        ...?headers,
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
      final code = error?['code'] as String? ?? 'HTTP_${res.statusCode}';
      var message = error?['message'] as String? ?? 'Request failed';
      // Validation errors say "Invalid request"; the field message is the useful part.
      if (code == 'VALIDATION_ERROR') message = _firstFieldError(error?['details']) ?? message;
      throw ApiException(res.statusCode, code, message);
    }
    return data;
  }

  /// Picks the first message out of a zod `flatten()` result.
  static String? _firstFieldError(Object? details) {
    if (details is! Map<String, dynamic>) return null;
    final fields = details['fieldErrors'];
    if (fields is Map<String, dynamic>) {
      for (final messages in fields.values) {
        if (messages is List && messages.isNotEmpty) return messages.first.toString();
      }
    }
    final form = details['formErrors'];
    if (form is List && form.isNotEmpty) return form.first.toString();
    return null;
  }
}
