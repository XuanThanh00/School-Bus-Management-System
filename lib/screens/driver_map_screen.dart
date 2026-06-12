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
  final int order;

  const _StopData({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    required this.order,
  });

  LatLng get latLng => LatLng(lat, lng);
}

class _SchoolData {
  final double lat;
  final double lng;
  final String name;

  const _SchoolData({required this.lat, required this.lng, required this.name});

  factory _SchoolData.fromMap(Map<String, dynamic> d) => _SchoolData(
        lat:  (d['lat']  as num?)?.toDouble() ?? 10.8503,
        lng:  (d['lng']  as num?)?.toDouble() ?? 106.7717,
        name: d['name']?.toString() ?? 'Trường học',
      );

  LatLng get latLng => LatLng(lat, lng);
}

class _OsrmResult {
  final List<LatLng> points;
  final double durationSec;
  const _OsrmResult({required this.points, required this.durationSec});
}

// ── Encoded Polyline (Google format) ─────────────────
// Nén List<LatLng> thành 1 ASCII string, giảm ~80% dung lượng so với array tọa độ.

String _encodePolyline(List<LatLng> points) {
  final buf = StringBuffer();
  int prevLat = 0, prevLng = 0;
  for (final p in points) {
    final lat = (p.latitude  * 1e5).round();
    final lng = (p.longitude * 1e5).round();
    _encodeChunk(buf, lat - prevLat);
    _encodeChunk(buf, lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return buf.toString();
}

void _encodeChunk(StringBuffer buf, int value) {
  var v = value < 0 ? ~(value << 1) : (value << 1);
  while (v >= 0x20) {
    buf.writeCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  buf.writeCharCode(v + 63);
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

  Position?        _myPos;
  List<_StopData>  _stops        = [];
  _SchoolData?     _school;
  int              _currentIdx   = 0;   // index trong _stops đang hướng tới

  List<LatLng>     _route        = [];  // tuyến còn lại: myPos → stops[_currentIdx:] → school
  LatLng?          _lastFetchPos;
  double?          _osrmDurationSec;

  bool _loadingStops  = true;
  bool _loadingSchool = true;
  bool _permissionDenied = false;
  bool _routeFetching    = false;
  bool _autoFollow       = true;  // false khi user đang kéo/zoom tự do

  DateTime? _lastGpsPush;

  // 50m — coi như đã đến trạm
  static const _arrivalRadiusM = 50.0;

  bool        get _loading       => _loadingStops || _loadingSchool;
  bool        get _allStopsDone  => _currentIdx >= _stops.length;
  _StopData?  get _nextStop      => _allStopsDone ? null : _stops[_currentIdx];

  LatLng get _myLatLng {
    if (_myPos != null) return LatLng(_myPos!.latitude, _myPos!.longitude);
    if (_stops.isNotEmpty) return _stops.first.latLng;
    return const LatLng(10.8503, 106.7717);
  }

  double get _speedKmh => max(0, _myPos?.speed ?? 0) * 3.6;
  bool   get _isMoving => _speedKmh >= 2;

  String get _distToNext {
    if (_myPos == null) return '--';
    final target = _allStopsDone ? _school?.latLng : _nextStop?.latLng;
    if (target == null) return '--';
    final km = _haversineKm(
        _myPos!.latitude, _myPos!.longitude, target.latitude, target.longitude);
    return km < 1
        ? '${(km * 1000).round()} m'
        : '${km.toStringAsFixed(1)} km';
  }

  String get _etaToNext {
    if (_myPos == null) return '--:--';
    double seconds;
    if (_osrmDurationSec != null) {
      seconds = _osrmDurationSec!;
    } else {
      final speed = _speedKmh;
      if (speed < 1) return '--:--';
      final target = _allStopsDone ? _school?.latLng : _nextStop?.latLng;
      if (target == null) return '--:--';
      final km = _haversineKm(
          _myPos!.latitude, _myPos!.longitude, target.latitude, target.longitude);
      seconds = (km / speed) * 3600;
    }
    final eta = DateTime.now().add(Duration(seconds: seconds.round()));
    return '${eta.hour.toString().padLeft(2, '0')}:${eta.minute.toString().padLeft(2, '0')}';
  }

  // ── Lifecycle ─────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _loadSchool();
    _loadDriverStops();
    _initLocation();
  }

  @override
  void dispose() {
    _posSub?.cancel();
    super.dispose();
  }

  // ── Location ──────────────────────────────────────────

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
        distanceFilter: 0,
      ),
    ).listen(_onPosition);
  }

  void _onPosition(Position pos) {
    if (!mounted) return;
    setState(() => _myPos = pos);

    if (_autoFollow) {
      try {
        _mapController.move(_myLatLng, _mapController.camera.zoom);
      } catch (_) {}
    }

    _checkArrival(pos);

    // Re-fetch route nếu di chuyển >150m so với lần fetch trước
    final cur = LatLng(pos.latitude, pos.longitude);
    final last = _lastFetchPos;
    final moved = last == null ||
        _haversineKm(cur.latitude, cur.longitude,
                last.latitude, last.longitude) * 1000 > 150;
    if (moved && !_routeFetching) _fetchRoutes();

    // Push GPS mỗi 5 giây
    final now = DateTime.now();
    if (_lastGpsPush == null || now.difference(_lastGpsPush!).inSeconds >= 5) {
      _lastGpsPush = now;
      _pushGps(pos);
    }
  }

  void _checkArrival(Position pos) {
    if (_stops.isEmpty || _currentIdx >= _stops.length) return;
    final target = _stops[_currentIdx];
    final distM = _haversineKm(
            pos.latitude, pos.longitude, target.lat, target.lng) *
        1000;
    if (distM <= _arrivalRadiusM) {
      setState(() {
        _currentIdx++;
        _osrmDurationSec = null;
        _lastFetchPos    = null; // force re-fetch với waypoints mới
      });
      _fetchRoutes(); // _pushRoute() được gọi bên trong _fetchRoutes()
    }
  }

  void _pushRoute() {
    if (_route.isEmpty) return;
    FirebaseDatabase.instance.ref('bus/route').set({
      'polyline':       _encodePolyline(_route),
      'currentStopIdx': _currentIdx,
      'updatedAt':      ServerValue.timestamp,
      'stops': _stops
          .asMap()
          .entries
          .map((e) => {
                'name':  e.value.name,
                'lat':   e.value.lat,
                'lng':   e.value.lng,
                'order': e.value.order,
                'done':  e.key < _currentIdx,
              })
          .toList(),
    });
  }

  void _pushGps(Position pos) {
    FirebaseDatabase.instance.ref('bus/gps').set({
      'lat':       pos.latitude,
      'lng':       pos.longitude,
      'speed':     double.parse(_speedKmh.toStringAsFixed(1)),
      'isActive':  _speedKmh >= 5.0,
      'updatedAt': ServerValue.timestamp,
      'source':    'driver',
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

  Future<void> _loadDriverStops() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        setState(() => _loadingStops = false);
        return;
      }

      final fs = FirebaseFirestore.instance;
      final driverSnap = await fs
          .collection('drivers')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();
      if (driverSnap.docs.isEmpty) {
        setState(() => _loadingStops = false);
        return;
      }

      final driverData = driverSnap.docs.first.data();
      final stopIds = (driverData['busStopIds'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          [];

      if (stopIds.isEmpty) {
        setState(() => _loadingStops = false);
        return;
      }

      // Load tất cả stop docs song song
      final snapshots = await Future.wait(
        stopIds.map((id) => fs.collection('busStops').doc(id).get()),
      );

      final loaded = <_StopData>[];
      for (final snap in snapshots) {
        if (!snap.exists) continue;
        final d   = snap.data()!;
        final loc = d['location'] as Map<String, dynamic>? ?? {};
        loaded.add(_StopData(
          id:    snap.id,
          name:  d['name']?.toString() ?? '',
          lat:   (loc['lat'] as num?)?.toDouble() ?? 0.0,
          lng:   (loc['lng'] as num?)?.toDouble() ?? 0.0,
          order: (d['order'] as num?)?.toInt() ?? 0,
        ));
      }

      // Sắp xếp theo order tăng dần
      loaded.sort((a, b) => a.order.compareTo(b.order));

      if (mounted) {
        setState(() {
          _stops        = loaded;
          _loadingStops = false;
        });
        if (_myPos != null) _fetchRoutes();
      }
    } catch (_) {
      if (mounted) setState(() => _loadingStops = false);
    }
  }

  // ── OSRM routing ──────────────────────────────────────

  Future<void> _fetchRoutes() async {
    if (_myPos == null) return;
    setState(() => _routeFetching = true);

    // Waypoints: vị trí hiện tại → các trạm còn lại → trường
    final waypoints = <LatLng>[
      LatLng(_myPos!.latitude, _myPos!.longitude),
      for (int i = _currentIdx; i < _stops.length; i++) _stops[i].latLng,
      if (_school != null) _school!.latLng,
    ];

    if (waypoints.length >= 2) {
      final result = await _osrmRoute(waypoints);
      if (mounted) {
        setState(() {
          _route           = result?.points ?? waypoints;
          _osrmDurationSec = result?.durationSec;
          _lastFetchPos    = LatLng(_myPos!.latitude, _myPos!.longitude);
        });
      }
    }

    if (mounted) setState(() => _routeFetching = false);
    _pushRoute();
  }

  Future<_OsrmResult?> _osrmRoute(List<LatLng> waypoints) async {
    if (waypoints.length < 2) return null;
    try {
      final coords =
          waypoints.map((p) => '${p.longitude},${p.latitude}').join(';');
      final uri = Uri.parse(
          'http://router.project-osrm.org/route/v1/driving/$coords'
          '?geometries=geojson&overview=full');
      final response =
          await http.get(uri).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return null;

      final json   = jsonDecode(response.body) as Map<String, dynamic>;
      if (json['code'] != 'Ok') return null;
      final routes = json['routes'] as List;
      if (routes.isEmpty) return null;

      final route    = routes.first as Map<String, dynamic>;
      final coords_  = (route['geometry'] as Map)['coordinates'] as List;
      final points   = coords_
          .map((c) =>
              LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()))
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

  // ── Map ───────────────────────────────────────────────

  Widget _buildMap() {
    return Stack(
      children: [
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: _myLatLng,
            initialZoom: 13,
            minZoom: 10,
            maxZoom: 18,
            onPositionChanged: (_, hasGesture) {
              if (hasGesture && _autoFollow) {
                setState(() => _autoFollow = false);
              }
            },
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.school_bus_app',
            ),

            // Tuyến đường còn lại
            if (_route.isNotEmpty)
              PolylineLayer(polylines: [
                Polyline(
                  points:            _route,
                  color:             AppColors.accent,
                  strokeWidth:       5,
                  borderColor:       Colors.white,
                  borderStrokeWidth: 1.5,
                ),
              ]),

            // School marker
            if (_school != null)
              MarkerLayer(markers: [
                Marker(
                  point:  _school!.latLng,
                  width:  36,
                  height: 36,
                  child: Container(
                    decoration: BoxDecoration(
                      color:  AppColors.present,
                      shape:  BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: const Icon(Icons.school_rounded,
                        color: Colors.white, size: 18),
                  ),
                ),
              ]),

            // Stop markers — hiển thị tất cả trạm, phân biệt đã qua / đang đến / sắp đến
            if (_stops.isNotEmpty)
              MarkerLayer(
                markers: _stops.asMap().entries.map((entry) {
                  final i    = entry.key;
                  final stop = entry.value;
                  final isDone    = i < _currentIdx;
                  final isCurrent = i == _currentIdx;

                  final Color bg = isDone
                      ? AppColors.textHint
                      : isCurrent
                          ? AppColors.accent
                          : AppColors.primary;

                  return Marker(
                    point:  stop.latLng,
                    width:  38,
                    height: 38,
                    child: Container(
                      decoration: BoxDecoration(
                        color:  bg,
                        shape:  BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                        boxShadow: isCurrent
                            ? [
                                BoxShadow(
                                  color:       AppColors.accent.withValues(alpha: 0.5),
                                  blurRadius:  8,
                                  spreadRadius: 2,
                                ),
                              ]
                            : null,
                      ),
                      child: Center(
                        child: isDone
                            ? const Icon(Icons.check_rounded,
                                color: Colors.white, size: 16)
                            : Text(
                                '${stop.order}',
                                style: const TextStyle(
                                  color:      Colors.white,
                                  fontSize:   14,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                      ),
                    ),
                  );
                }).toList(),
              ),

            // My location marker
            if (_myPos != null)
              MarkerLayer(markers: [
                Marker(
                  point:  _myLatLng,
                  width:  52,
                  height: 52,
                  child: Container(
                    decoration: BoxDecoration(
                      color:  AppColors.primary,
                      shape:  BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2.5),
                      boxShadow: [
                        BoxShadow(
                          color:       AppColors.primary.withValues(alpha: 0.4),
                          blurRadius:  10,
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
                                  fontSize:   17,
                                  fontWeight: FontWeight.w600,
                                  color:      Colors.white)),
                          Text(
                            _allStopsDone
                                ? 'Đang về trường'
                                : 'Tiếp theo: ${_nextStop?.name ?? '...'}',
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                color: Colors.white.withValues(alpha: 0.75)),
                          ),
                        ],
                      ),
                    ),
                    // GPS status badge
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color:         Colors.white.withValues(alpha: 0.2),
                        borderRadius:  BorderRadius.circular(20),
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
                                fontSize:   12,
                                color:      Colors.white,
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

        // Recenter button — chỉ hiện khi _autoFollow đã tắt
        if (!_autoFollow)
          Positioned(
            bottom: 12, right: 12,
            child: FloatingActionButton.small(
              backgroundColor: AppColors.primary,
              onPressed: () {
                setState(() => _autoFollow = true);
                _mapController.move(_myLatLng, 13);
              },
              child: const Icon(Icons.my_location_rounded,
                  color: Colors.white, size: 20),
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
                color:        Colors.white,
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
                        strokeWidth: 2, color: AppColors.accent),
                  ),
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

  // ── Panel ─────────────────────────────────────────────

  Widget _buildPanel() {
    if (_loading && _myPos == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Speed / status
        AppCard(
          child: Row(
            children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(
                  color:         AppColors.primarySurface,
                  borderRadius:  BorderRadius.circular(10),
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

        // Next destination ETA
        AppCard(
          child: Column(
            children: [
              InfoRow(
                label: _allStopsDone ? 'Về trường' : 'Trạm tiếp theo',
                value: _allStopsDone
                    ? (_school?.name ?? 'Trường học')
                    : (_nextStop?.name ?? '...'),
              ),
              const Divider(height: 16, color: AppColors.border),
              InfoRow(label: 'Khoảng cách', value: _distToNext),
              const Divider(height: 16, color: AppColors.border),
              InfoRow(label: 'Dự kiến đến', value: _etaToNext),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Stop progress list
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Lộ trình hôm nay',
                  style: GoogleFonts.dmSans(
                      fontSize:   12,
                      fontWeight: FontWeight.w600,
                      color:      AppColors.textSub)),
              const SizedBox(height: 12),
              ..._stops.asMap().entries.map((entry) {
                final i    = entry.key;
                final stop = entry.value;
                return _StopProgressRow(
                  label:     stop.name,
                  order:     stop.order,
                  isDone:    i < _currentIdx,
                  isCurrent: i == _currentIdx,
                  isLast:    false,
                );
              }),
              // Trường là điểm cuối
              _StopProgressRow(
                label:     _school?.name ?? 'Trường học',
                order:     -1, // -1 → dùng icon school
                isDone:    _allStopsDone,
                isCurrent: _allStopsDone,
                isLast:    true,
              ),
            ],
          ),
        ),
        const SizedBox(height: 80),
      ],
    );
  }

  // ── Permission denied ─────────────────────────────────

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
}

// ── Stop progress row ─────────────────────────────────

class _StopProgressRow extends StatelessWidget {
  final String label;
  final int    order;
  final bool   isDone;
  final bool   isCurrent;
  final bool   isLast; // true → đây là trường, dùng icon school

  const _StopProgressRow({
    required this.label,
    required this.order,
    required this.isDone,
    required this.isCurrent,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    final Color dotColor = isDone
        ? AppColors.present
        : isCurrent
            ? AppColors.accent
            : AppColors.border;

    final Color textColor = isDone
        ? AppColors.textSub
        : isCurrent
            ? AppColors.textMain
            : AppColors.textSub;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          // Dot / icon
          Container(
            width: 28, height: 28,
            decoration: BoxDecoration(
              color: isDone || isCurrent
                  ? dotColor.withValues(alpha: 0.12)
                  : Colors.transparent,
              shape:  BoxShape.circle,
              border: Border.all(
                  color: dotColor, width: isDone || isCurrent ? 2 : 1.5),
            ),
            child: Center(
              child: isLast
                  ? Icon(Icons.school_rounded,
                      size: 14,
                      color: isDone ? AppColors.present : AppColors.textHint)
                  : isDone
                      ? const Icon(Icons.check_rounded,
                          size: 14, color: AppColors.present)
                      : Text(
                          '$order',
                          style: GoogleFonts.dmSans(
                              fontSize:   12,
                              fontWeight: FontWeight.w700,
                              color:      isCurrent
                                  ? AppColors.accent
                                  : AppColors.textSub),
                        ),
            ),
          ),
          const SizedBox(width: 10),

          // Label
          Expanded(
            child: Text(
              label,
              style: GoogleFonts.dmSans(
                fontSize:   13,
                fontWeight: isCurrent ? FontWeight.w600 : FontWeight.w400,
                color:      textColor,
                decoration: isDone && !isLast
                    ? TextDecoration.lineThrough
                    : null,
              ),
            ),
          ),

          // Badge
          if (isCurrent)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: (isLast ? AppColors.present : AppColors.accent)
                    .withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                'Tiếp theo',
                style: GoogleFonts.dmSans(
                    fontSize:   10,
                    color:      isLast ? AppColors.present : AppColors.accent,
                    fontWeight: FontWeight.w600),
              ),
            ),
        ],
      ),
    );
  }
}
