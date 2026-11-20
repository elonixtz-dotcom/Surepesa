import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'pay/pay_widgets.dart';

/// Collects the customer's ID details and a photo of the document, then creates a
/// KYC submission and uploads the photo. Review happens on the SurePesa side.
class KycSubmitScreen extends StatefulWidget {
  const KycSubmitScreen({super.key});

  @override
  State<KycSubmitScreen> createState() => _KycSubmitScreenState();
}

class _KycSubmitScreenState extends State<KycSubmitScreen> {
  final _form = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _idNumber = TextEditingController();
  String _idType = 'NATIONAL_ID';
  XFile? _photo;
  bool _busy = false;
  String? _error;

  static const _idTypes = {
    'NATIONAL_ID': 'National ID (NIDA)',
    'PASSPORT': 'Passport',
    'DRIVING_LICENSE': 'Driving licence',
    'VOTER_ID': 'Voter ID',
  };

  @override
  void initState() {
    super.initState();
    _fullName.text = AppScope.read(context).me?.displayName ?? '';
  }

  @override
  void dispose() {
    _fullName.dispose();
    _idNumber.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    try {
      final photo = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000, imageQuality: 85);
      if (photo != null && mounted) setState(() => _photo = photo);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  String _mimeType(XFile file) {
    final name = file.name.toLowerCase();
    return name.endsWith('.png') ? 'image/png' : 'image/jpeg';
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final photo = _photo;
    if (photo == null) {
      setState(() => _error = 'Add a clear photo of your ID document');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final kyc = AppScope.read(context).kyc;
      final submissionId = await kyc.createSubmission(
        fullName: _fullName.text.trim(),
        idType: _idType,
        idNumber: _idNumber.text.trim(),
      );
      final bytes = await photo.readAsBytes();
      await kyc.uploadDocument(submissionId, _idType, bytes, _mimeType(photo));
      if (!mounted) return;
      await AppScope.read(context).refresh();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Documents sent — we will review them shortly.')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PayScaffold(
      title: 'Verify your identity',
      bottom: BusyButton(label: 'Submit for review', busy: _busy, onPressed: _submit),
      children: [
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _fullName,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Full name', helperText: 'Exactly as on your ID'),
                validator: (v) => (v == null || v.trim().length < 3) ? 'Enter your full name' : null,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: _idType,
                decoration: const InputDecoration(labelText: 'ID document'),
                items: [for (final e in _idTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                onChanged: (v) => setState(() => _idType = v ?? _idType),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _idNumber,
                decoration: const InputDecoration(labelText: 'ID number'),
                validator: (v) => (v == null || v.trim().length < 4) ? 'Enter the number on the document' : null,
              ),
              const SizedBox(height: 20),
              const SectionHeader(title: 'Photo of the document'),
              const SizedBox(height: 8),
              SpCard(
                onTap: _busy ? null : _pickPhoto,
                child: Row(
                  children: [
                    const IconChip(icon: Icons.add_a_photo_outlined),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _photo == null
                            ? 'Tap to choose a photo (JPEG or PNG, up to 5 MB)'
                            : _photo!.name,
                        style: TextStyle(
                          color: _photo == null ? SpColors.ink2 : SpColors.ink,
                          fontWeight: _photo == null ? FontWeight.w500 : FontWeight.w700,
                        ),
                      ),
                    ),
                    if (_photo != null) const Icon(Icons.check_circle_rounded, color: SpColors.teal),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              const InfoNotice(
                icon: Icons.lock_outline_rounded,
                tone: PillTone.neutral,
                text: 'Photos are stored privately and used only to verify your identity.',
              ),
              InlineError(_error),
            ],
          ),
        ),
      ],
    );
  }
}
