import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../widgets/common.dart';
import 'history_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'services_screen.dart';

/// Bottom navigation: Home · History · [Scan] · Services · Profile.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _pages = [HomeScreen(), HistoryScreen(), ServicesScreen(), ProfileScreen()];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: GradientBackground(child: IndexedStack(index: _index, children: _pages)),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: SizedBox(
        width: 62,
        height: 62,
        child: FloatingActionButton(
          heroTag: 'scan',
          elevation: 4,
          backgroundColor: SpColors.teal,
          foregroundColor: Colors.white,
          shape: const CircleBorder(side: BorderSide(color: Colors.white, width: 4)),
          onPressed: () => showComingSoon(context, 'Scan to pay'),
          child: const Icon(Icons.qr_code_scanner_rounded, size: 28),
        ),
      ),
      bottomNavigationBar: BottomAppBar(
        color: Colors.white,
        elevation: 12,
        shadowColor: Colors.black12,
        shape: const CircularNotchedRectangle(),
        notchMargin: 6,
        height: 68,
        padding: EdgeInsets.zero,
        child: Row(
          children: [
            _NavItem(icon: Icons.home_rounded, label: 'Home', selected: _index == 0, onTap: () => _go(0)),
            _NavItem(icon: Icons.history_rounded, label: 'History', selected: _index == 1, onTap: () => _go(1)),
            const SizedBox(width: 72),
            _NavItem(icon: Icons.grid_view_rounded, label: 'Services', selected: _index == 2, onTap: () => _go(2)),
            _NavItem(icon: Icons.person_outline_rounded, label: 'Profile', selected: _index == 3, onTap: () => _go(3)),
          ],
        ),
      ),
    );
  }

  void _go(int index) => setState(() => _index = index);
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.icon, required this.label, required this.selected, required this.onTap});

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? SpColors.teal : SpColors.inkMuted;
    return Expanded(
      child: InkResponse(
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              decoration: BoxDecoration(
                color: selected ? SpColors.mint : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}
