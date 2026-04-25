import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

// Must be top-level for background isolate
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // System tray notification is shown automatically by FCM for background/killed state.
  // Data-only messages can be processed here if needed.
}

class NotificationService {
  static final _messaging         = FirebaseMessaging.instance;
  static final _localNotifications = FlutterLocalNotificationsPlugin();

  static const _channelId   = 'bus_attend_channel';
  static const _channelName = 'Thông báo xe buýt';

  static Future<void> init(String parentDocId) async {
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;

    await _setupLocalNotifications();

    final token = await _messaging.getToken();
    if (token != null) await _saveToken(parentDocId, token);

    _messaging.onTokenRefresh.listen((t) => _saveToken(parentDocId, t));

    // Show heads-up banner while app is in foreground
    FirebaseMessaging.onMessage.listen((message) {
      final n = message.notification;
      if (n == null) return;
      _localNotifications.show(
        n.hashCode,
        n.title,
        n.body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            _channelId,
            _channelName,
            importance: Importance.high,
            priority:   Priority.high,
            icon:       '@mipmap/ic_launcher',
          ),
        ),
      );
    });
  }

  static Future<void> _setupLocalNotifications() async {
    const init = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    await _localNotifications.initialize(init);

    const channel = AndroidNotificationChannel(
      _channelId,
      _channelName,
      importance: Importance.high,
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
  }

  static Future<void> _saveToken(String parentDocId, String token) async {
    await FirebaseFirestore.instance
        .collection('parents')
        .doc(parentDocId)
        .update({'fcmToken': token});
  }
}
