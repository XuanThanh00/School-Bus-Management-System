import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import '../theme/app_theme.dart';
import '../widgets/shared_widgets.dart';

// ── Models ────────────────────────────────────────────

class _StopData {
  final String id;
  final String name;
  final double lat;
  final double lng;

  const _StopData({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
  });

  LatLng get latLng => LatLng(lat, lng);
}

class _SchoolData {
  final double lat;
  final double lng;
  final String name;

  const _SchoolData(
      {required this.lat, required this.lng, required this.name});

  factory _SchoolData.fromMap(Map<String, dynamic> d) => _SchoolData(
        lat:  (d['lat']  as num?)?.toDouble() ?? 10.8503,
        lng:  (d['lng']  as num?)?.toDouble() ?? 106.7717,
        name: d['name']?.toString() ?? 'Trường học',
      );

  LatLng get latLng => LatLng(lat, lng);
}

// ── Haversine ─────────────────────────────────────────

double _haversineKm(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371.0;
  final dLat = (lat2 - lat1) * pi / 180;
  final dLng = (lng2 - lng1) * pi / 180;
  final a = sin(dLat / 2) * sin(dLat / 2) +
      cos(lat1 * pi / 180) * cos(lat2 * pi / 180) *
          sin(dLng / 2) * sin(dLng / 2);
  return r * 2 * atan2(sqrt(a), sqrt(1 - a));
}

// ── Screen ────────────────────────────────────────────

class DriverMapScreen extends StatefulWidget {
  const DriverMapScreen({super.key});

  @override
  State<DriverMapScreen> createState() => _DriverMapScreenState();
}

class _DriverMapScreenState extends State<DriverMapScreen> {
  final _mapController = MapController();
  StreamSubscription<Position>? _posSub;

  Position?    _myPos;
  _StopData?   _stop;
  _SchoolData? _school;

  List<LatLng> _routeToStop   = [];
  List<LatLng> _routeToSchool = [];
  LatLng?      _lastFetchLatLng; // position at last OSRM fetch
  double?      _osrmDurationSec;  // route duration from OSRM

  bool _loadingStop   = true;
  bool _loadingSchool = true;
  bool _permissionDenied = false;
  bool _routeFetching = false;

  DateTime? _lastGpsPush;

  bool get _loading => _loadingStop || _loadingSchool;

  LatLng get _myLatLng => _myPos != null
      ? LatLng(_myPos!.latitude, _myPos!.longitude)
      : (_stop?.latLng ?? const LatLng(10.8503, 106.7717));

  // Speed from GPS (m/s → km/h), clamp to 0
  double get _speedKmh => max(0, _myPos?.speed ?? 0) * 3.6;

  bool get _isMoving => _speedKmh >= 2;

  String get _distToStop {
    if (_myPos == null || _stop == null) return '--';
    final km = _haversineKm(
        _myPos!.latitude, _myPos!.longitude, _stop!.lat, _stop!.lng);
    return km < 1
        ? '${(km * 1000).round()} m'
        : '${km.toStringAsFixed(1)} km';
  }

  String get _distToSchool {
    if (_myPos == null || _school == null) return '--';
    final km = _haversineKm(
        _myPos!.latitude, _myPos!.longitude, _school!.lat, _school!.lng);
    return km < 1
        ? '${(km * 1000).round()} m'
        : '${km.toStringAsFixed(1)} km';
  }

  String get _etaToStop {
    if (_myPos == null || _stop == null) return '--:--';
    double seconds;
    if (_osrmDurationSec != null) {
      seconds = _osrmDurationSec!;
    } else {
      final speed = _speedKmh;
      if (speed < 1) return '--:--';
      final km = _haversineKm(
          _myPos!.latitude, _myPos!.longitude, _stop!.lat, _stop!.lng);
      seconds = (km / speed) * 3600;
    }
    final eta = DateTime.now().add(Duration(seconds: seconds.round()));
    return '${eta.hour.toString().padLeft(2, '0')}:'
        '${eta.minute.toString().padLeft(2, '0')}';
  }

  @override
  void initState() {
    super.initState();
    _loadSchool();
    _loadDriverStop();
    _initLocation();
  }

  @override
  void dispose() {
    _posSub?.cancel();
    super.dispose();
  }

  // ── Location permission + stream ──────────────────────

  Future<void> _initLocation() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      if (mounted) setState(() => _permissionDenied = true);
      return;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      if (mounted) setState(() => _permissionDenied = true);
      return;
    }

    _posSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20, // cập nhật mỗi 20m
      ),
    ).listen(_onPosition);
  }

  void _onPosition(Position pos) {
    if (!mounted) return;
    setState(() => _myPos = pos);

    // Tự follow map
    try {
      _mapController.move(_myLatLng, _mapController.camera.zoom);
    } catch (_) {}

    // Fetch OSRM nếu chưa có hoặc di chuyển > 150m
    final cur = LatLng(pos.latitude, pos.longitude);
    final lastFetch = _lastFetchLatLng;
    final shouldFetch = lastFetch == null ||
        _haversineKm(cur.latitude, cur.longitude,
                lastFetch.latitude, lastFetch.longitude) *
            1000 >
        150;
    if (shouldFetch && !_routeFetching) _fetchRoutes();

    // Push GPS lên Realtime Database mỗi 10 giây
    final now = DateTime.now();
    if (_lastGpsPush == null ||
        now.difference(_lastGpsPush!).inSeconds >= 5) {
      _lastGpsPush = now;
      _pushGps(pos);
    }
  }

  void _pushGps(Position pos) {
    FirebaseDatabase.instance.ref('bus/gps').update({
      'lat':       pos.latitude,
      'lng':       pos.longitude,
      'speed':     double.parse(_speedKmh.toStringAsFixed(1)),
      'isActive':  _speedKmh >= 5.0,
      'updatedAt': ServerValue.timestamp,
    });
  }

  // ── Firestore loaders ─────────────────────────────────

  Future<void> _loadSchool() async {
    try {
      final doc = await FirebaseFirestore.instance
          .collection('systemConfig')
          .doc('school')
          .get();
      if (mounted) {
        setState(() {
          if (doc.exists) _school = _SchoolData.fromMap(doc.data()!);
          _loadingSchool = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingSchool = false);
    }
  }

  Future<void> _loadDriverStop() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) { setState(() => _loadingStop = false); return; }

      final fs = FirebaseFirestore.instance;
      final driverSnap = await fs
          .collection('drivers')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();
      if (driverSnap.docs.isEmpty) {
        setState(() => _loadingStop = false);
        return;
      }

      final driverData = driverSnap.docs.first.data();
      final busStopId  = driverData['busStopId']?.toString() ?? '';
      if (busStopId.isEmpty) {
        setState(() => _loadingStop = false);
        return;
      }

      final stopDoc = await fs.collection('busStops').doc(busStopId).get();
      if (mounted) {
        setState(() {
          if (stopDoc.exists) {
            final d   = stopDoc.data()!;
            final loc = d['location'] as Map<String, dynamic>? ?? {};
            _stop = _StopData(
              id:   stopDoc.id,
              name: d['name']?.toString() ?? '',
              lat:  (loc['lat'] as num?)?.toDouble() ?? 0.0,
              lng:  (loc['lng'] as num?)?.toDouble() ?? 0.0,
            );
          }
          _loadingStop = false;
        });
        // Fetch route ngay khi có stop + position
        if (_myPos != null) _fetchRoutes();
      }
    } catch (_) {
      if (mounted) setState(() => _loadingStop = false);
    }
  }

  // ── OSRM routing ──────────────────────────────────────

  Future<void> _fetchRoutes() async {
    if (_myPos == null) return;
    setState(() => _routeFetching = true);

    final myLat = _myPos!.latitude;
    final myLng = _myPos!.longitude;

    // Route: current → stop
    if (_stop != null) {
      final toStop = await _osrmRoute(myLat, myLng, _stop!.lat, _stop!.lng);
      if (toStop != null && mounted) {
        setState(() {
          _routeToStop      = toStop.points;
          _osrmDurationSec  = toStop.durationSec;
          _lastFetchLatLng  = LatLng(myLat, myLng);
        });
      } else if (mounted) {
        // fallback: đường thẳng
        setState(() {
          _routeToStop     = [LatLng(myLat, myLng), _stop!.latLng];
          _lastFetchLatLng = LatLng(myLat, myLng);
        });
      }
    }

    // Route: stop → school (tuyến cố định, chỉ cần fetch 1 lần)
    if (_stop != null && _school != null && _routeToSchool.isEmpty) {
      final toSchool = await _osrmRoute(
          _stop!.lat, _stop!.lng, _school!.lat, _school!.lng);
      if (toSchool != null && mounted) {
        setState(() => _routeToSchool = toSchool.points);
      } else if (mounted) {
        setState(() => _routeToSchool = [_stop!.latLng, _school!.latLng]);
      }
    }

    if (mounted) setState(() => _routeFetching = false);
  }

  Future<_OsrmResult?> _osrmRoute(
      double lat1, double lng1, double lat2, double lng2) async {
    try {
      final uri = Uri.parse(
          'http://router.project-osrm.org/route/v1/driving/'
          '$lng1,$lat1;$lng2,$lat2'
          '?geometries=geojson&overview=full');
      final response =
          await http.get(uri).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return null;

      final json    = jsonDecode(response.body) as Map<String, dynamic>;
      if (json['code'] != 'Ok') return null;
      final routes  = json['routes'] as List;
      if (routes.isEmpty) return null;

      final route   = routes.first as Map<String, dynamic>;
      final coords  =
          (route['geometry'] as Map)['coordinates'] as List;
      final points  = coords
          .map((c) => LatLng(
              (c[1] as num).toDouble(), (c[0] as num).toDouble()))
          .toList();
      final duration = (route['duration'] as num).toDouble();
      return _OsrmResult(points: points, durationSec: duration);
    } catch (_) {
      return null;
    }
  }

  // ── Build ─────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    if (_permissionDenied) return _buildPermissionDenied();

    return Scaffold(
      body: Column(
        children: [
          Expanded(flex: 55, child: _buildMap()),
          Expanded(flex: 45, child: _buildPanel()),
        ],
      ),
    );
  }

  Widget _buildPermissionDenied() {
    return Scaffold(
      appBar: AppBar(
          title: const Text('Bản đồ lộ trình'),
          automaticallyImplyLeading: false),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.location_off_rounded,
                  size: 56, color: AppColors.textHint),
              const SizedBox(height: 16),
              Text('Cần quyền truy cập vị trí',
                  style: GoogleFonts.dmSans(
                      fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(
                'Vui lòng cấp quyền vị trí cho ứng dụng trong cài đặt thiết bị.',
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(
                    fontSize: 13, color: AppColors.textSub),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () async {
                  await Geolocator.openAppSettings();
                  setState(() => _permissionDenied = false);
                  _initLocation();
                },
                child: const Text('Mở cài đặt'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMap() {
    return Stack(
      children: [
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: _myLatLng,
            initialZoom: 15,
            minZoom: 10,
            maxZoom: 18,
          ),
          children: [
            TileLayer(
              urlTemplate:
                  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.school_bus_app',
            ),

            // Tuyến stop → school (màu nhạt, nền)
            if (_routeToSchool.isNotEmpty)
              PolylineLayer(polylines: [
                Polyline(
                  points: _routeToSchool,
                  color: AppColors.primary.withValues(alpha: 0.3),
                  strokeWidth: 4,
                  pattern: StrokePattern.dashed(segments: [12, 6]),
                ),
              ]),

            // Tuyến current → stop (màu đậm, chính)
            if (_routeToStop.isNotEmpty)
              PolylineLayer(polylines: [
                Polyline(
                  points: _routeToStop,
                  color: AppColors.accent,
                  strokeWidth: 5,
                  borderColor: Colors.white,
                  borderStrokeWidth: 1.5,
                ),
              ]),

            // School marker
            if (_school != null)
              MarkerLayer(markers: [
                Marker(
                  point: _school!.latLng,
                  width: 36, height: 36,
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.present,
                      shape: BoxShape.circle,
                      border:
                          Border.all(color: Colors.white, width: 2),
                    ),
                    child: const Icon(Icons.school_rounded,
                        color: Colors.white, size: 18),
                  ),
                ),
              ]),

            // Stop marker
            if (_stop != null)
              MarkerLayer(markers: [
                Marker(
                  point: _stop!.latLng,
                  width: 40, height: 40,
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                      border:
                          Border.all(color: Colors.white, width: 2),
                    ),
                    child: const Icon(Icons.location_on_rounded,
                        color: Colors.white, size: 20),
                  ),
                ),
              ]),

            // My location marker
            if (_myPos != null)
              MarkerLayer(markers: [
                Marker(
                  point: _myLatLng,
                  width: 52, height: 52,
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                      border:
                          Border.all(color: Colors.white, width: 2.5),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primary.withValues(alpha: 0.4),
                          blurRadius: 10,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                    child: const Icon(Icons.directions_bus_rounded,
                        color: Colors.white, size: 26),
                  ),
                ),
              ]),
          ],
        ),

        // AppBar overlay
        Positioned(
          top: 0, left: 0, right: 0,
          child: Container(
            color: AppColors.primary,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Bản đồ lộ trình',
                              style: GoogleFonts.dmSans(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white)),
                          Text(
                            _stop != null
                                ? 'Trạm: ${_stop!.name}'
                                : 'Đang tải...',
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                color: Colors.white
                                    .withValues(alpha: 0.75)),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 7, height: 7,
                            decoration: BoxDecoration(
                              color: _myPos == null
                                  ? AppColors.pending
                                  : (_isMoving
                                      ? AppColors.present
                                      : AppColors.textHint),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            _myPos == null
                                ? 'Đang định vị...'
                                : (_isMoving ? 'Đang chạy' : 'Xe dừng'),
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                color: Colors.white,
                                fontWeight: FontWeight.w500),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),

        // Recenter button
        Positioned(
          bottom: 12, right: 12,
          child: FloatingActionButton.small(
            backgroundColor: Colors.white,
            onPressed: () => _mapController.move(_myLatLng, 15),
            child: const Icon(Icons.my_location_rounded,
                color: AppColors.primary, size: 20),
          ),
        ),

        // Route fetching indicator
        if (_routeFetching)
          Positioned(
            bottom: 60, right: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: const [
                  BoxShadow(color: Colors.black12, blurRadius: 6)
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                      width: 12, height: 12,
                      child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.accent)),
                  const SizedBox(width: 6),
                  Text('Tính đường...',
                      style: GoogleFonts.dmSans(
                          fontSize: 11, color: AppColors.textSub)),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildPanel() {
    if (_loading && _myPos == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Status + speed
        AppCard(
          child: Row(
            children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primarySurface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.directions_bus_rounded,
                    color: AppColors.primary, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _isMoving ? 'Xe đang di chuyển' : 'Xe đang dừng',
                      style: GoogleFonts.dmSans(
                          fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      '${_speedKmh.toStringAsFixed(1)} km/h  ·  GPS điện thoại',
                      style: GoogleFonts.dmSans(
                          fontSize: 12, color: AppColors.textSub),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Distance + ETA info
        AppCard(
          child: Column(
            children: [
              if (_stop != null) ...[
                InfoRow(
                  label: 'Cách trạm ${_stop!.name}',
                  value: _distToStop,
                ),
                const Divider(height: 16, color: AppColors.border),
                InfoRow(
                  label: 'Dự kiến đến trạm',
                  value: _etaToStop,
                ),
                const Divider(height: 16, color: AppColors.border),
              ],
              InfoRow(label: 'Cách trường', value: _distToSchool),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Legend
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Chú thích',
                  style: GoogleFonts.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSub)),
              const SizedBox(height: 10),
              _LegendRow(
                  color: AppColors.primary,
                  icon: Icons.directions_bus_rounded,
                  label: 'Vị trí của bạn (GPS)'),
              const SizedBox(height: 8),
              _LegendRow(
                  color: AppColors.accent,
                  icon: Icons.location_on_rounded,
                  label: _stop?.name ?? 'Trạm của bạn'),
              const SizedBox(height: 8),
              _LegendRow(
                  color: AppColors.present,
                  icon: Icons.school_rounded,
                  label: _school?.name ?? 'Trường học'),
            ],
          ),
        ),
        const SizedBox(height: 80),
      ],
    );
  }
}

// ── Helper models ──────────────────────────────────────

class _OsrmResult {
  final List<LatLng> points;
  final double durationSec;
  const _OsrmResult({required this.points, required this.durationSec});
}

// ── Legend widget ─────────────────────────────────────

class _LegendRow extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String label;

  const _LegendRow(
      {required this.color, required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 28, height: 28,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 14, color: color),
        ),
        const SizedBox(width: 10),
        Text(label,
            style: GoogleFonts.dmSans(
                fontSize: 12, color: AppColors.textMain)),
      ],
    );
  }
}
