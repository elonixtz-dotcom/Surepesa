import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../core/config.dart';

class AuthException implements Exception {
  AuthException(this.message, {this.sessionExpired = false});
  final String message;
  final bool sessionExpired;
  @override
  String toString() => message;
}

/// Talks to Neon Auth (Managed Better Auth) over its REST endpoints.
///
/// Sign-in returns a long-lived session cookie, which is kept in the device's secure
/// storage. API calls use a short-lived (15 min) JWT minted from that session via
/// `/token`. The JWT is cached in memory and refreshed shortly before it expires.
class AuthService {
  AuthService({FlutterSecureStorage? storage, http.Client? client})
      : _storage = storage ?? const FlutterSecureStorage(),
        _http = client ?? http.Client();

  static const _cookieKey = 'neon_auth_session_cookie';
  static final _sessionCookie = RegExp(r'(__Secure-neon-auth\.[A-Za-z0-9_.\-]+)=([^;,\s]+)');

  final FlutterSecureStorage _storage;
  final http.Client _http;
  String? _cookie;
  String? _jwt;
  DateTime? _jwtExpiresAt;

  Uri _uri(String path) => Uri.parse('${AppConfig.authBaseUrl}/$path');

  /// Restores a session saved on a previous launch.
  Future<bool> restore() async {
    _cookie = await _storage.read(key: _cookieKey);
    return _cookie != null;
  }

  Future<void> signUp({required String name, required String email, required String password}) =>
      _authenticate('sign-up/email', {'name': name, 'email': email, 'password': password});

  Future<void> signIn({required String email, required String password}) =>
      _authenticate('sign-in/email', {'email': email, 'password': password});

  Future<void> _authenticate(String path, Map<String, String> body) async {
    final res = await _http
        .post(_uri(path), headers: {'Content-Type': 'application/json'}, body: jsonEncode(body))
        .timeout(const Duration(seconds: 30));
    if (res.statusCode != 200) throw AuthException(_errorMessage(res));

    // package:http joins repeated Set-Cookie headers with commas; pick out Neon Auth cookies.
    final matches = _sessionCookie.allMatches(res.headers['set-cookie'] ?? '');
    if (matches.isEmpty) {
      throw AuthException('Signed in, but no session was returned. Please try again.');
    }
    _cookie = matches.map((m) => '${m.group(1)}=${m.group(2)}').join('; ');
    _jwt = null;
    await _storage.write(key: _cookieKey, value: _cookie);
  }

  /// A valid JWT for the SurePesa API.
  Future<String> accessToken() async {
    final now = DateTime.now();
    if (_jwt != null && _jwtExpiresAt!.isAfter(now.add(const Duration(seconds: 60)))) return _jwt!;
    if (_cookie == null) throw AuthException('Please sign in', sessionExpired: true);

    final res = await _http
        .get(_uri('token'), headers: {'Cookie': _cookie!})
        .timeout(const Duration(seconds: 30));
    final token = res.statusCode == 200
        ? (jsonDecode(res.body) as Map<String, dynamic>)['token'] as String?
        : null;
    if (token == null) {
      await _clear();
      throw AuthException('Your session has expired. Please sign in again.', sessionExpired: true);
    }
    _jwt = token;
    _jwtExpiresAt = _expiryOf(token);
    return token;
  }

  Future<void> signOut() async {
    final cookie = _cookie;
    await _clear();
    if (cookie == null) return;
    // Best effort: Better Auth requires a trusted Origin for sign-out; localhost is pre-approved.
    try {
      await _http
          .post(
            _uri('sign-out'),
            headers: {
              'Cookie': cookie,
              'Origin': 'http://localhost',
              'Content-Type': 'application/json',
            },
            body: '{}',
          )
          .timeout(const Duration(seconds: 10));
    } catch (_) {}
  }

  Future<void> _clear() async {
    _cookie = null;
    _jwt = null;
    _jwtExpiresAt = null;
    await _storage.delete(key: _cookieKey);
  }

  static DateTime _expiryOf(String jwt) {
    try {
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(jwt.split('.')[1]))));
      return DateTime.fromMillisecondsSinceEpoch((payload['exp'] as int) * 1000);
    } catch (_) {
      return DateTime.now().add(const Duration(minutes: 5));
    }
  }

  static String _errorMessage(http.Response res) {
    try {
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final message = body['message'] as String?;
      if (message != null && message.isNotEmpty) return message;
    } catch (_) {}
    return 'Something went wrong (${res.statusCode}). Please try again.';
  }
}
