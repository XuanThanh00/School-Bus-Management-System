import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'firebase_options.dart';
import 'theme/app_theme.dart';
import 'screens/role_selection_screen.dart';
import 'screens/main_shell.dart';
import 'screens/driver_shell.dart';

@pragma('vm:entry-point')
Future<void> _backgroundHandler(RemoteMessage message) async {}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  FirebaseMessaging.onBackgroundMessage(_backgroundHandler);

  final prefs      = await SharedPreferences.getInstance();
  final rememberMe = prefs.getBool('remember_me') ?? false;
  final user       = FirebaseAuth.instance.currentUser;
  final autoLogin  = rememberMe && user != null;

  final isDriver = autoLogin &&
      (user.email?.startsWith('driver_') ?? false);

  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));
  runApp(BusAttendApp(autoLogin: autoLogin, isDriver: isDriver));
}

class BusAttendApp extends StatelessWidget {
  final bool autoLogin;
  final bool isDriver;
  const BusAttendApp(
      {super.key, required this.autoLogin, required this.isDriver});

  @override
  Widget build(BuildContext context) {
    final Widget home;
    if (!autoLogin) {
      home = const RoleSelectionScreen();
    } else if (isDriver) {
      home = const DriverShell();
    } else {
      home = const MainShell();
    }

    return MaterialApp(
      title: 'BusAttend',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.theme,
      home: home,
    );
  }
}
