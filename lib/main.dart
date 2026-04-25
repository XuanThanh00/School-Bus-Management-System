import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'firebase_options.dart';
import 'theme/app_theme.dart';
import 'screens/login_screen.dart';
import 'screens/main_shell.dart';

@pragma('vm:entry-point')
Future<void> _backgroundHandler(RemoteMessage message) async {}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  FirebaseMessaging.onBackgroundMessage(_backgroundHandler);

  final prefs      = await SharedPreferences.getInstance();
  final rememberMe = prefs.getBool('remember_me') ?? false;
  final autoLogin  = rememberMe && FirebaseAuth.instance.currentUser != null;

  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));
  runApp(BusAttendApp(autoLogin: autoLogin));
}

class BusAttendApp extends StatelessWidget {
  final bool autoLogin;
  const BusAttendApp({super.key, required this.autoLogin});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BusAttend',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.theme,
      home: autoLogin ? const MainShell() : const LoginScreen(),
    );
  }
}
