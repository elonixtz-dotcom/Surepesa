// Cross-platform text-file download: real on web, no-op elsewhere.
export 'download_stub.dart' if (dart.library.html) 'download_web.dart';
