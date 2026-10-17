import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/theme.dart';
import 'screens/auth_screen.dart';
import 'screens/home_shell.dart';
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
      AppStage.ready => const HomeShell(),
    };
    return AnimatedSwitcher(duration: const Duration(milliseconds: 250), child: screen);
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: SpColors.ink,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SurePesaLogo(size: 30, onDark: true),
            SizedBox(height: 28),
            SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: SpColors.inkMutedOnDark)),
          ],
        ),
      ),
    );
  }
}
