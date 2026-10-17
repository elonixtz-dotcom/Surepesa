import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'cards/cards_screen.dart';
import 'history_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';

/// The four main tabs: Home · Activity · Cards · Profile.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

enum ShellTab { home, activity, cards, profile }

/// Lets a screen inside the shell switch tabs ("See all" on Home opens Activity).
class ShellNav extends InheritedWidget {
  const ShellNav({super.key, required this.goTo, required super.child});

  final void Function(ShellTab tab) goTo;

  static void go(BuildContext context, ShellTab tab) =>
      context.getInheritedWidgetOfExactType<ShellNav>()?.goTo(tab);

  @override
  bool updateShouldNotify(ShellNav oldWidget) => false;
}

class _HomeShellState extends State<HomeShell> {
  ShellTab _tab = ShellTab.home;

  static const _pages = [HomeScreen(), HistoryScreen(), CardsScreen(), ProfileScreen()];

  @override
  Widget build(BuildContext context) {
    return ShellNav(
      goTo: (t) => setState(() => _tab = t),
      child: Scaffold(
        body: IndexedStack(index: _tab.index, children: _pages),
        bottomNavigationBar: DecoratedBox(
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0xFFE1E6EE)))),
          child: NavigationBar(
            selectedIndex: _tab.index,
            onDestinationSelected: (i) => setState(() => _tab = ShellTab.values[i]),
            backgroundColor: SpColors.surface,
            surfaceTintColor: Colors.transparent,
            indicatorColor: SpColors.mint,
            height: 68,
            labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
            destinations: const [
              NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded, color: SpColors.teal), label: 'Home'),
              NavigationDestination(icon: Icon(Icons.show_chart_rounded), selectedIcon: Icon(Icons.show_chart_rounded, color: SpColors.teal), label: 'Activity'),
              NavigationDestination(icon: Icon(Icons.credit_card_outlined), selectedIcon: Icon(Icons.credit_card_rounded, color: SpColors.teal), label: 'Cards'),
              NavigationDestination(icon: Icon(Icons.person_outline_rounded), selectedIcon: Icon(Icons.person_rounded, color: SpColors.teal), label: 'Profile'),
            ],
          ),
        ),
      ),
    );
  }
}
