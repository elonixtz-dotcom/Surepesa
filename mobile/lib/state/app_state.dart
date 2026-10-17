import 'package:flutter/widgets.dart';

import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/payments_api.dart';
import 'models.dart';

enum AppStage { starting, signedOut, onboarding, setPin, ready }

/// App-wide session state: who is signed in and their SurePesa account.
class AppState extends ChangeNotifier {
  AppState({AuthService? auth}) : auth = auth ?? AuthService() {
    api = ApiClient(this.auth);
    payments = PaymentsApi(api);
  }

  final AuthService auth;
  late final ApiClient api;
  late final PaymentsApi payments;

  AppStage stage = AppStage.starting;
  Me? me;

  /// Bumped whenever money moves, so lists of receipts know to reload.
  int activityVersion = 0;

  Future<void> start() async {
    if (await auth.restore()) {
      try {
        await refresh();
        return;
      } on AuthException {
        // Saved session is no longer valid: fall through to sign-in.
      } on ApiException {
        // Offline or server error: show sign-in so the user can retry.
      }
    }
    _setStage(AppStage.signedOut);
  }

  Future<void> signIn(String email, String password) async {
    await auth.signIn(email: email, password: password);
    await refresh();
  }

  Future<void> signUp(String name, String email, String password) async {
    await auth.signUp(name: name, email: email, password: password);
    await refresh();
  }

  Future<void> completeOnboarding({
    required String firstName,
    required String lastName,
    required String phoneNumber,
  }) async {
    final data = await api.post('/v1/me/onboarding', {
      'firstName': firstName,
      'lastName': lastName,
      'phoneNumber': phoneNumber,
    });
    _applyMe(Me.fromJson(data));
  }

  /// Reloads the account from the server — the server is the source of truth for balances.
  Future<void> refresh() async {
    try {
      _applyMe(Me.fromJson(await api.get('/v1/me')));
    } on AuthException catch (e) {
      if (e.sessionExpired) _setStage(AppStage.signedOut);
      rethrow;
    }
  }

  /// Sets (or, with [currentPin], changes) the transaction PIN.
  Future<void> setPin(String pin, {String? currentPin}) async {
    await payments.setPin(pin, currentPin: currentPin);
    await refresh();
  }

  /// Call after a payment: reloads the balance and tells history lists to refresh.
  Future<void> paymentMade() async {
    activityVersion++;
    try {
      await refresh();
    } catch (_) {
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    await auth.signOut();
    me = null;
    _setStage(AppStage.signedOut);
  }

  void _applyMe(Me value) {
    me = value;
    _setStage(switch (value) {
      Me(needsOnboarding: true) => AppStage.onboarding,
      Me(hasPin: false) => AppStage.setPin,
      _ => AppStage.ready,
    });
  }

  void _setStage(AppStage value) {
    stage = value;
    notifyListeners();
  }
}

/// Exposes [AppState] to the widget tree and rebuilds dependents when it changes.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child})
      : super(notifier: state);

  static AppState of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  static AppState read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
