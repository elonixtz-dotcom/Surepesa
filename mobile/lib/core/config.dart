/// Build-time configuration. Override with --dart-define, e.g.
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.20:4000
class AppConfig {
  /// SurePesa API. The default reaches the host machine from the Android emulator.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );

  /// Neon Auth (Managed Better Auth) endpoint for this Neon branch.
  static const authBaseUrl = String.fromEnvironment(
    'NEON_AUTH_BASE_URL',
    defaultValue:
        'https://ep-ancient-butterfly-b5reknnr.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth',
  );
}
