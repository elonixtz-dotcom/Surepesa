import 'api_client.dart';

class AppNotification {
  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.read,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        read: json['read'] as bool? ?? false,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      );

  final String id;
  final String title;
  final String body;
  final bool read;
  final DateTime createdAt;
}

/// In-app notifications behind the bell icon (/v1/me/notifications).
class NotificationsApi {
  NotificationsApi(this._api);

  final ApiClient _api;

  Future<List<AppNotification>> list() async {
    final data = await _api.get('/v1/me/notifications');
    return (data['notifications'] as List<dynamic>)
        .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> markAllRead() => _api.post('/v1/me/notifications/read-all', const {});
}
