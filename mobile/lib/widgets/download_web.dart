// Web implementation: triggers a browser download via a Blob URL.
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;

void downloadText(String filename, String content) {
  final blob = html.Blob([content], 'text/csv');
  final url = html.Url.createObjectUrlFromBlob(blob);
  html.AnchorElement(href: url)
    ..setAttribute('download', filename)
    ..click();
  html.Url.revokeObjectUrl(url);
}
