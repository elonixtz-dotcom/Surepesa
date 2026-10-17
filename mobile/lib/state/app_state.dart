import 'package:flutter/widgets.dart';

import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/cards_api.dart';
import '../services/payments_api.dart';
import 'models.dart';

enum AppStage { starting, signedOut, onboarding, setPin, locked, ready }

/// App-wide session state: who is signed in and their SurePesa account.
class AppState extends ChangeNotifier {
  AppState({AuthService? auth}) : auth = auth ?? AuthService() {
    api = ApiClient(this.auth);
    payments = PaymentsApi(api);
    cards = CardsApi(api);
  }

  final AuthService auth;
  late final ApiClient api;
  late final PaymentsApi payments;
  late final CardsApi cards;

  AppStage stage = AppStage.starting;
  Me? me;

  /// A restored session opens locked; so does returning after [relockAfter] in the background.
  static const relockAfter = Duration(minutes: 2);
  bool _locked = false;
  DateTime? _backgroundedAt;

  /// Bumped whenever money moves, so lists of receipts know to reload.
  int activityVersion = 0;

  Future<void> start() async {
    if (await auth.restore()) {
      _locked = true;
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

  /// Unlocks with the transaction PIN; throws the server's WRONG_PIN / PIN_LOCKED.
  Future<void> unlock(String pin) async {
    await payments.verifyPin(pin);
    _locked = false;
    if (me != null) _applyMe(me!);
  }

  /// Called from the app lifecycle: lock again after a while in the background.
  void backgrounded() => _backgroundedAt = DateTime.now();

  void resumed() {
    final since = _backgroundedAt;
    _backgroundedAt = null;
    if (since == null || stage != AppStage.ready) return;
    if (DateTime.now().difference(since) >= relockAfter) {
      _locked = true;
      _setStage(AppStage.locked);
    }
  }

  Future<void> signOut() async {
    await auth.signOut();
    _locked = false;
    me = null;
    _setStage(AppStage.signedOut);
  }

  void _applyMe(Me value) {
    me = value;
    _setStage(switch (value) {
      Me(needsOnboarding: true) => AppStage.onboarding,
      Me(hasPin: false) => AppStage.setPin,
      _ when _locked => AppStage.locked,
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
