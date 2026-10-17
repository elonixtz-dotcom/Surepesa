import 'package:flutter/foundation.dart';

/// Build-time configuration. Override with --dart-define, e.g.
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.20:4000
///
/// The web build is always served behind rewrites that send /v1 and /auth to the SurePesa API
/// (see web/vercel.json), so in a browser both are same-origin and the Neon Auth session
/// cookie stays first-party.
class AppConfig {
  static const _apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000', // the host machine, from the Android emulator
  );

  static const _authBaseUrl = String.fromEnvironment(
    'NEON_AUTH_BASE_URL',
    defaultValue:
        'https://ep-ancient-butterfly-b5reknnr.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth',
  );

  /// SurePesa API.
  static String get apiBaseUrl => kIsWeb ? Uri.base.origin : _apiBaseUrl;

  /// Neon Auth (Managed Better Auth): direct on mobile, through the API's /auth proxy on the web.
  static String get authBaseUrl => kIsWeb ? '${Uri.base.origin}/auth' : _authBaseUrl;
}
