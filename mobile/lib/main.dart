import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/theme.dart';
import 'screens/auth_screen.dart';
import 'screens/home_shell.dart';
import 'screens/onboarding_screen.dart';
import 'screens/pay/set_pin_screen.dart';
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

class SurePesaApp extends StatelessWidget {
  const SurePesaApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'SurePesa',
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
      body: GradientBackground(
        child: Center(child: SurePesaLogo(size: 30)),
      ),
    );
  }
}
