# SurePesa mobile (Flutter)

The teal/mint wallet app. Sign-in uses Neon Auth, and account data comes from the SurePesa API.

## First run

This folder holds `lib/` and `test/` only. Generate the platform folders once:

```bash
cd mobile
flutter create --org tz.surepesa --project-name surepesa --platforms android,ios .
flutter pub get
flutter test
```

`flutter create` keeps the existing `lib/` and `test/` files.

### Android: allow the local HTTP API (development only)

The API runs on `http://10.0.2.2:4000` from the emulator. In `android/app/src/main/AndroidManifest.xml`, add this to the `<application>` tag:

```xml
android:usesCleartextTraffic="true"
```

Remove it once the API is served over HTTPS.

### Run

```bash
# Terminal 1: API
cd backend && npm run dev

# Terminal 2: app (Android emulator)
cd mobile && flutter run

# Physical device on the same Wi-Fi: point at your computer's LAN IP
flutter run --dart-define=API_BASE_URL=http://192.168.x.x:4000
```

## How auth works

1. `AuthService` calls Neon Auth `sign-up/email` or `sign-in/email`.
2. The returned session cookie is kept in secure storage (Keychain or Keystore).
3. Before each API call it mints a 15-minute JWT from `/token` and caches it.
4. The API verifies that JWT against Neon Auth's JWKS. The first call creates the SurePesa user, and onboarding adds the name and `+255` phone number.

## Status

| Screen | State |
| --- | --- |
| Sign in / sign up | Live (Neon Auth) |
| Onboarding | Live (`POST /v1/me/onboarding`) |
| Home: greeting, balance card, verification card | Live (`GET /v1/me`), pull to refresh |
| Quick actions, Quick Transfer, Scan, History | UI only until the payment endpoints ship |
| Profile: details, KYC status, sign out | Live |
