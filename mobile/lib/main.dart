import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/theme.dart';
import 'screens/auth_screen.dart';
// Everything after sign-in (home, payments, cards, profile) is a separate download on the web,
// so the sign-in screen appears sooner. It starts downloading as soon as the first frame shows.
import 'screens/home_shell.dart' deferred as shell;
import 'screens/onboarding_screen.dart';
import 'screens/pay/set_pin_screen.dart';
import 'screens/unlock_screen.dart';
import 'state/app_state.dart';
import 'widgets/common.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.dark.copyWith(
    statusBarColor: Colors.transparent,
  ));
  final state = AppState()..start();
  runApp(SurePesaApp(state: state));
}

class SurePesaApp extends StatefulWidget {
  const SurePesaApp({super.key, required this.state});

  final AppState state;

  @override
  State<SurePesaApp> createState() => _SurePesaAppState();
}

class _SurePesaAppState extends State<SurePesaApp> with WidgetsBindingObserver {
  AppState get state => widget.state;
  final _navigator = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    state.addListener(_onStage);
    // Fetch the signed-in app while the customer is still on the sign-in screen.
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadShell().ignore());
  }

  @override
  void dispose() {
    state.removeListener(_onStage);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Locking or signing out closes whatever was open above the home screen (receipts,
  /// card details, PIN sheets), so nothing stays visible behind the lock.
  void _onStage() {
    if (state.stage == AppStage.locked || state.stage == AppStage.signedOut) {
      _navigator.currentState?.popUntil((r) => r.isFirst);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.hidden) state.backgrounded();
    if (s == AppLifecycleState.resumed) state.resumed();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'SurePesa',
        navigatorKey: _navigator,
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const _Root(),
      ),
    );
  }
}

/// Chooses the top-level screen from the session stage.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final stage = AppScope.of(context).stage;
    final Widget screen = switch (stage) {
      AppStage.starting => const _Splash(),
      AppStage.signedOut => const AuthScreen(),
      AppStage.onboarding => const OnboardingScreen(),
      AppStage.setPin => const SetPinScreen(),
      AppStage.locked => const UnlockScreen(),
      AppStage.ready => const _Shell(),
    };
    return AnimatedSwitcher(duration: const Duration(milliseconds: 250), child: screen);
  }
}

Future<void>? _shellLoading;
Future<void> _loadShell() => _shellLoading ??= shell.loadLibrary();

/// The signed-in app, once its code has arrived (immediately on mobile; on the web it was
/// already fetched in the background while the customer signed in).
class _Shell extends StatelessWidget {
  const _Shell();

  @override
  Widget build(BuildContext context) => FutureBuilder<void>(
        future: _loadShell(),
        builder: (context, snap) => snap.connectionState == ConnectionState.done && !snap.hasError
            ? shell.HomeShell()
            : snap.hasError
                ? const _ShellError()
                : const _Splash(),
      );
}

class _ShellError extends StatelessWidget {
  const _ShellError();

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: SpColors.ground,
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('SurePesa could not finish loading.', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(height: 6),
              const Text('Check your connection and try again.', style: TextStyle(color: SpColors.ink2)),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () {
                  _shellLoading = null;
                  AppScope.read(context).paymentMade();
                },
                child: const Text('Try again'),
              ),
            ]),
          ),
        ),
      );
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: SpColors.ground,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SurePesaLogo(size: 28),
            SizedBox(height: 28),
            SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: SpColors.teal)),
          ],
        ),
      ),
    );
  }
}
