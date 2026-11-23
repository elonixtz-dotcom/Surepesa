import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'pay/pay_widgets.dart';

/// "My QR Code": the customer's receive code — their SurePesa number as a scannable QR,
/// with the number itself copyable for chat/SMS. Anyone with the app can pay this number.
class MyQrScreen extends StatelessWidget {
  const MyQrScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final me = AppScope.of(context).me!;
    final phone = me.phoneNumber ?? '';

    return PayScaffold(
      title: 'My QR Code',
      children: [
        const InfoNotice(
          icon: Icons.qr_code_2_rounded,
          tone: PillTone.neutral,
          text: 'Show this code to any SurePesa user to receive money straight into your wallet. It only contains your number — never your PIN.',
        ),
        const SizedBox(height: 18),
        SpCard(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: SpColors.line),
                ),
                child: QrImageView(
                  data: 'surepesa:pay:$phone',
                  version: QrVersions.auto,
                  size: 220,
                  eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: SpColors.ink),
                  dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: SpColors.ink),
                ),
              ),
              const SizedBox(height: 16),
              Text(me.displayName, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              const SizedBox(height: 2),
              Text(maskPhone(phone) ?? phone, style: referenceStyle(size: 14, color: SpColors.ink2)),
            ],
          ),
        ),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          onPressed: () => copyToClipboard(context, phone),
          icon: const Icon(Icons.copy_rounded),
          label: const Text('Copy my number'),
        ),
      ],
    );
  }
}
