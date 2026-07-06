import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../theme/app_theme.dart';
import '../utils/route_geometry.dart';
import '../widgets/shared_widgets.dart';

// Màu highlight trạm đón/trả của con — nổi bật, không trùng màu tuyến/trạm
const _childColor = Color(0xFFE91E63);

// ── Models ────────────────────────────────────────────

class _GpsData {
  final double lat;
  final double lng;
  final double speed; // km/h
  final bool   reachedDestination;
  final String routeFromName;
  final String routeToName;

  const _GpsData({
    required this.lat,
    required this.lng,
    required this.speed,
    this.reachedDestination = false,
    this.routeFromName = '',
    this.routeToName   = '',
  });

  factory _GpsData.fromMap(Map map) => _GpsData(
    lat:   (map['lat'] as num).toDouble(),
    lng:   (map['lng'] as num).toDouble(),
    speed: (map['speed'] as num?)?.toDouble() ?? 0.0,
    reachedDestination: map['reachedDestination'] as bool?   ?? false,
    routeFromName:      map['routeFromName']      as String? ?? '',
    routeToName:        map['routeToName']        as String? ?? '',
  );
}

class _StopData {
  final String id;
  final String name;
  final double lat;
  final double lng;
  final int order;
  final bool done; // đã đi qua — theo dữ liệu tài xế đẩy lên bus/route

  const _StopData({
    required this.id,
    required this.name,
    required this.lat,
    required this.lng,
    required this.order,
    this.done = false,
  });

  LatLng get latLng => LatLng(lat, lng);
}

// ── Decode Google Encoded Polyline ───────────────────

List<LatLng> _decodePolyline(String encoded) {
  final points = <LatLng>[];
  int index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    int shift = 0, result = 0, b;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
    points.add(LatLng(lat / 1e5, lng / 1e5));
  }
  return points;
}

// ── Haversine distance (km) ───────────────────────────

double _haversineKm(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371.0;
  final dLat = (lat2 - lat1) * pi / 180;
  final dLng = (lng2 - lng1) * pi / 180;
  final a = sin(dLat / 2) * sin(dLat / 2) +
      cos(lat1 * pi / 180) *
          cos(lat2 * pi / 180) *
          sin(dLng / 2) *
          sin(dLng / 2);
  final c = 2 * atan2(sqrt(a), sqrt(1 - a));
  return r * c;
}

// ── School model ──────────────────────────────────────

class _SchoolData {
  final double lat;
  final double lng;
  final String name;
  final String address;

  const _SchoolData({
    required this.lat,
    required this.lng,
    required this.name,
    required this.address,
  });

  factory _SchoolData.fromMap(Map<String, dynamic> d) => _SchoolData(
    lat: (d['lat'] as num?)?.toDouble() ?? 10.8503,
    lng: (d['lng'] as num?)?.toDouble() ?? 106.7717,
    name: d['name']?.toString() ?? 'HCMUTE',
    address: d['address']?.toString() ?? '',
  );
}

// ── Screen ────────────────────────────────────────────

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final _mapController = MapController();
  StreamSubscription? _gpsSub;
  StreamSubscription? _routeSub;
  _GpsData?       _gps;
  _SchoolData?    _school;
  List<_StopData> _stops       = []; // theo đúng thứ tự tài xế đang chạy (từ bus/route)
  List<LatLng>    _routePoints = []; // decoded OSRM polyline từ bus/route
  String          _session        = 'morning';
  int             _currentStopIdx = 0;
  String          _childStopId    = ''; // busStopId của con → highlight trạm đón/trả
  String          _childName      = '';
  bool _loadingGps    = true;
  bool _loadingRoute  = true;
  bool _loadingSchool = true;
  bool _autoFollow    = true; // false khi phụ huynh tự kéo/zoom bản đồ

  // Route quá 1h không được tài xế cập nhật = chuyến đã kết thúc → ẩn
  static const _routeMaxAgeMs = 60 * 60 * 1000;
  int    _routeUpdatedAtMs = 0;
  Timer? _staleTimer;

  bool get _loading => _loadingGps || _loadingRoute || _loadingSchool;

  bool get _isAfternoonSession => _session == 'afternoon';

  int get _childStopIdx => _childStopId.isEmpty
      ? -1
      : _stops.indexWhere((s) => s.id == _childStopId);

  _StopData? get _childStop {
    final i = _childStopIdx;
    return i < 0 ? null : _stops[i];
  }

  double get _schoolLat => _school?.lat ?? 10.8503;
  double get _schoolLng => _school?.lng ?? 106.7717;

  LatLng get _busPosition => _gps != null
      ? LatLng(_gps!.lat, _gps!.lng)
      : LatLng(_schoolLat, _schoolLng);

  // ETA to school based on distance + speed
  String get _computedEta {
    final gps = _gps;
    if (gps == null) return '--:--';
    final speed = gps.speed;
    if (speed < 1) return '--:--';

    final distKm = _haversineKm(gps.lat, gps.lng, _schoolLat, _schoolLng);
    final hours = distKm / speed;
    final totalMinutes = (hours * 60).round();

    final now = DateTime.now();
    final eta = now.add(Duration(minutes: totalMinutes));
    return '${eta.hour.toString().padLeft(2, '0')}:${eta.minute.toString().padLeft(2, '0')}';
  }

  // Distance to school (km)
  String get _distanceToSchool {
    final gps = _gps;
    if (gps == null) return '--';
    final km = _haversineKm(gps.lat, gps.lng, _schoolLat, _schoolLng);
    if (km < 1) return '${(km * 1000).round()} m';
    return '${km.toStringAsFixed(1)} km';
  }

  // Remaining time (minutes)
  String get _minutesLeft {
    final gps = _gps;
    if (gps == null) return '--';
    final speed = gps.speed;
    if (speed < 1) return '--';
    final distKm = _haversineKm(gps.lat, gps.lng, _schoolLat, _schoolLng);
    final minutes = ((distKm / speed) * 60).round();
    return '~$minutes phút';
  }

  @override
  void initState() {
    super.initState();
    _loadSchool();
    _loadChildStop();
    _listenGps();
    _listenRoute();
    // RTDB chỉ bắn event khi dữ liệu đổi — route có thể trở nên cũ
    // trong lúc app đang mở, nên kiểm tra định kỳ để ẩn
    _staleTimer = Timer.periodic(
        const Duration(minutes: 5), (_) => _hideRouteIfStale());
  }

  @override
  void dispose() {
    _gpsSub?.cancel();
    _routeSub?.cancel();
    _staleTimer?.cancel();
    super.dispose();
  }

  void _hideRouteIfStale() {
    if (_routeUpdatedAtMs == 0 || !mounted) return;
    final age = DateTime.now().millisecondsSinceEpoch - _routeUpdatedAtMs;
    if (age > _routeMaxAgeMs) {
      setState(() {
        _routePoints      = [];
        _stops            = [];
        _routeUpdatedAtMs = 0;
      });
    }
  }

  Future<void> _loadSchool() async {
    try {
      final doc = await FirebaseFirestore.instance
          .collection('systemConfig')
          .doc('school')
          .get();
      if (mounted) {
        setState(() {
          if (doc.exists) {
            _school = _SchoolData.fromMap(
                doc.data() as Map<String, dynamic>);
          }
          _loadingSchool = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingSchool = false);
    }
  }

  // Trạm của con: parents(email) → studentIds.first → students.busStopId
  Future<void> _loadChildStop() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;
      final fs = FirebaseFirestore.instance;
      final parentSnap = await fs
          .collection('parents')
          .where('email', isEqualTo: user.email)
          .limit(1)
          .get();
      if (parentSnap.docs.isEmpty) return;
      final studentIds =
          List<String>.from(parentSnap.docs.first.data()['studentIds'] ?? []);
      if (studentIds.isEmpty) return;
      final studentSnap = await fs
          .collection('students')
          .where('studentId', isEqualTo: studentIds.first)
          .limit(1)
          .get();
      if (studentSnap.docs.isEmpty) return;
      final d = studentSnap.docs.first.data();
      if (mounted) {
        setState(() {
          _childStopId = d['busStopId']?.toString() ?? '';
          _childName   = d['name']?.toString() ?? '';
        });
      }
    } catch (_) {}
  }

  // Nguồn duy nhất về lộ trình là bus/route do app tài xế đẩy lên.
  // Stops trong đó đã theo đúng thứ tự chạy thực tế (buổi chiều = đảo ngược),
  // nên phía phụ huynh không cần biết logic sáng/chiều.
  void _listenRoute() {
    _routeSub = FirebaseDatabase.instance
        .ref('bus/route')
        .onValue
        .listen((event) {
      if (!mounted) return;
      var points      = <LatLng>[];
      var stops       = <_StopData>[];
      var session     = 'morning';
      var currentIdx  = 0;
      var updatedAtMs = 0;
      final v = event.snapshot.value;
      if (v is Map) {
        try {
          final data      = Map.from(v);
          final updatedAt = (data['updatedAt'] as num?)?.toInt() ?? 0;
          final ageMs     =
              DateTime.now().millisecondsSinceEpoch - updatedAt;
          // Route quá 1h không cập nhật = chuyến đã kết thúc → bỏ qua,
          // không hiển thị tuyến/trạm cũ cho phụ huynh
          if (ageMs > _routeMaxAgeMs) throw Exception('stale route');
          updatedAtMs = updatedAt;
          final encoded = data['polyline']?.toString() ?? '';
          if (encoded.isNotEmpty) points = _decodePolyline(encoded);
          session    = data['session']?.toString() ?? 'morning';
          currentIdx = (data['currentStopIdx'] as num?)?.toInt() ?? 0;
          final rawStops = data['stops'];
          if (rawStops is List) {
            for (final raw in rawStops) {
              if (raw is! Map) continue;
              final m = Map.from(raw);
              stops.add(_StopData(
                id:    m['id']?.toString() ?? '',
                name:  m['name']?.toString() ?? '',
                lat:   (m['lat'] as num?)?.toDouble() ?? 0.0,
                lng:   (m['lng'] as num?)?.toDouble() ?? 0.0,
                order: (m['order'] as num?)?.toInt() ?? 0,
                done:  m['done'] == true,
              ));
            }
          }
        } catch (_) {}
      }
      setState(() {
        _routePoints      = points;
        _stops            = stops;
        _session          = session;
        _currentStopIdx   = currentIdx;
        _routeUpdatedAtMs = updatedAtMs;
        _loadingRoute     = false;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loadingRoute = false);
    });
  }

  void _listenGps() {
    _gpsSub = FirebaseDatabase.instance
        .ref('bus/gps')
        .onValue
        .listen(
          (event) {
        if (!mounted) return;
        if (event.snapshot.exists && event.snapshot.value != null) {
          try {
            final data =
            _GpsData.fromMap(Map.from(event.snapshot.value as Map));
            setState(() { _gps = data; _loadingGps = false; });
            if (_autoFollow) {
              try {
                _mapController.move(_busPosition, _mapController.camera.zoom);
              } catch (_) {}
            }
          } catch (_) {
            if (mounted) setState(() => _loadingGps = false);
          }
        } else {
          if (mounted) setState(() => _loadingGps = false);
        }
      },
      onError: (_) {
        if (mounted) setState(() => _loadingGps = false);
      },
    );
  }

  // Nearest stop by Haversine distance
  _StopData? get _nearestStop {
    final gps = _gps;
    if (gps == null || _stops.isEmpty) return null;
    return _stops.reduce((a, b) {
      final da = _haversineKm(gps.lat, gps.lng, a.lat, a.lng);
      final db = _haversineKm(gps.lat, gps.lng, b.lat, b.lng);
      return da <= db ? a : b;
    });
  }

  // Stop the bus is currently at (within 5 m)
  _StopData? get _arrivedStop {
    final gps = _gps;
    if (gps == null || _stops.isEmpty) return null;
    for (final stop in _stops) {
      if (_haversineKm(gps.lat, gps.lng, stop.lat, stop.lng) * 1000 <= 5) {
        return stop;
      }
    }
    return null;
  }

  // Khoảng cách + ETA từ xe đến trạm của con
  String get _distToChildStop {
    final gps  = _gps;
    final stop = _childStop;
    if (gps == null || stop == null) return '--';
    final km = _haversineKm(gps.lat, gps.lng, stop.lat, stop.lng);
    return km < 1 ? '${(km * 1000).round()} m' : '${km.toStringAsFixed(1)} km';
  }

  String get _etaToChildStop {
    final gps  = _gps;
    final stop = _childStop;
    if (gps == null || stop == null || gps.speed < 1) return '--:--';
    final km  = _haversineKm(gps.lat, gps.lng, stop.lat, stop.lng);
    final eta = DateTime.now()
        .add(Duration(minutes: ((km / gps.speed) * 60).round()));
    return '${eta.hour.toString().padLeft(2, '0')}:${eta.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    // Offset tuyến sang phải theo hướng đi để 2 chiều đi/về tách vệt;
    // màu theo buổi do tài xế đẩy lên (xanh = sáng đón, cam = chiều trả)
    final drawRoute = offsetPolyline(_routePoints);
    final lineColor = sessionColor(_isAfternoonSession);

    return Scaffold(
      body: Column(
        children: [
          // Map 55%
          Expanded(
            flex: 55,
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: _busPosition,
                    initialZoom: 14,
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
                      urlTemplate:
                      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.example.school_bus_app',
                    ),

                    // Tuyến thực từ tài xế (bus/route) + mũi tên chỉ hướng
                    // Fallback về đường thẳng nối trạm nếu chưa có polyline
                    if (drawRoute.isNotEmpty) ...[
                      PolylineLayer(polylines: [
                        Polyline(
                          points:            drawRoute,
                          color:             lineColor,
                          strokeWidth:       4,
                          borderColor:       Colors.white,
                          borderStrokeWidth: 1,
                        ),
                      ]),
                      MarkerLayer(
                          markers: buildArrowMarkers(drawRoute, lineColor)),
                    ] else if (_stops.isNotEmpty)
                      PolylineLayer(polylines: [
                        Polyline(
                          points:  _stops.map((s) => s.latLng).toList(),
                          color:   lineColor.withValues(alpha: 0.4),
                          strokeWidth: 3,
                          pattern: StrokePattern.dashed(segments: const [10, 5]),
                        ),
                      ]),

                    // School marker
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: LatLng(_schoolLat, _schoolLng),
                          width: 36,
                          height: 36,
                          child: Container(
                            decoration: BoxDecoration(
                              color: AppColors.present,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                            child: const Icon(Icons.school_rounded,
                                color: Colors.white, size: 18),
                          ),
                        ),
                      ],
                    ),

                    // Stop markers — theo route thực của tài xế;
                    // trạm đón/trả của con highlight màu hồng riêng
                    if (_stops.isNotEmpty)
                      MarkerLayer(
                        markers: _stops.asMap().entries.map((entry) {
                          final i    = entry.key;
                          final stop = entry.value;
                          final isDone    = stop.done;
                          final isCurrent = i == _currentStopIdx;
                          final isChild   = stop.id.isNotEmpty &&
                              stop.id == _childStopId;

                          if (isChild) {
                            return Marker(
                              point:  stop.latLng,
                              width:  38,
                              height: 38,
                              child: Container(
                                decoration: BoxDecoration(
                                  color: isDone
                                      ? AppColors.present
                                      : _childColor,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                      color: Colors.white, width: 2.5),
                                  boxShadow: [
                                    BoxShadow(
                                      color: _childColor.withValues(alpha: 0.5),
                                      blurRadius:   8,
                                      spreadRadius: 2,
                                    ),
                                  ],
                                ),
                                child: Icon(
                                  isDone
                                      ? Icons.check_rounded
                                      : Icons.escalator_warning_rounded,
                                  size: 20,
                                  color: Colors.white,
                                ),
                              ),
                            );
                          }

                          return Marker(
                            point: stop.latLng,
                            width: 28,
                            height: 28,
                            child: Container(
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: isDone
                                    ? AppColors.present
                                    : isCurrent
                                    ? AppColors.primary
                                    : Colors.white,
                                border: Border.all(
                                  color: isCurrent
                                      ? AppColors.primary
                                      : AppColors.present,
                                  width: 2.5,
                                ),
                              ),
                              child: isCurrent
                                  ? const Icon(Icons.circle,
                                  size: 10, color: Colors.white)
                                  : isDone
                                  ? const Icon(Icons.check,
                                  size: 14, color: Colors.white)
                                  : null,
                            ),
                          );
                        }).toList(),
                      ),

                    // Bus marker
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: _busPosition,
                          width: 52,
                          height: 52,
                          child: GestureDetector(
                            onTap: () => _showBusInfo(context),
                            child: Container(
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(
                                    color: Colors.white, width: 2.5),
                                boxShadow: [
                                  BoxShadow(
                                    color: AppColors.primary.withValues(alpha:0.4),
                                    blurRadius: 10,
                                    spreadRadius: 2,
                                  ),
                                ],
                              ),
                              child: const Icon(Icons.directions_bus_rounded,
                                  color: Colors.white, size: 26),
                            ),
                          ),
                        ),
                      ],
                    ),
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
                                  Text('Theo dõi xe buýt',
                                      style: GoogleFonts.dmSans(
                                          fontSize: 17,
                                          fontWeight: FontWeight.w600,
                                          color: Colors.white)),
                                  Text(
                                      _isAfternoonSession
                                          ? 'Chuyến chiều · Trả học sinh'
                                          : 'Chuyến sáng · Đón học sinh',
                                      style: GoogleFonts.dmSans(
                                          fontSize: 12,
                                          color: Colors.white.withValues(alpha:0.75))),
                                ],
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha:0.2),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 7, height: 7,
                                    decoration: BoxDecoration(
                                      color: _loading
                                          ? AppColors.pending
                                          : AppColors.present,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                  const SizedBox(width: 5),
                                  Text(
                                    _loading ? 'Đang tải...' : 'Đang chạy',
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

                // Recenter on bus button
                Positioned(
                  bottom: 12, right: 12,
                  child: FloatingActionButton.small(
                    backgroundColor: Colors.white,
                    onPressed: () {
                      setState(() => _autoFollow = true);
                      _mapController.move(_busPosition, 15);
                    },
                    child: const Icon(Icons.my_location_rounded,
                        color: AppColors.primary, size: 20),
                  ),
                ),
              ],
            ),
          ),

          // Info panel
          Expanded(
            flex: 45,
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _gps == null
                ? Center(
              child: Text('Không có dữ liệu GPS',
                  style: GoogleFonts.dmSans(
                      fontSize: 13, color: AppColors.textSub)),
            )
                : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Trạm đón/trả của con — thông tin quan trọng nhất với phụ huynh
                if (_childStop != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: AppCard(
                      child: Row(
                        children: [
                          Container(
                            width: 36, height: 36,
                            decoration: BoxDecoration(
                              color: (_childStop!.done
                                      ? AppColors.present
                                      : _childColor)
                                  .withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Icon(
                              _childStop!.done
                                  ? Icons.where_to_vote_rounded
                                  : Icons.escalator_warning_rounded,
                              color: _childStop!.done
                                  ? AppColors.present
                                  : _childColor,
                              size: 18,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _isAfternoonSession
                                      ? 'Điểm trả${_childName.isNotEmpty ? ' bé $_childName' : ' của bé'}'
                                      : 'Điểm đón${_childName.isNotEmpty ? ' bé $_childName' : ' của bé'}',
                                  style: GoogleFonts.dmSans(
                                      fontSize: 11,
                                      color: AppColors.textSub),
                                ),
                                Text(
                                  _childStop!.name,
                                  style: GoogleFonts.dmSans(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600),
                                ),
                              ],
                            ),
                          ),
                          if (_childStop!.done)
                            Text('Xe đã qua',
                                style: GoogleFonts.dmSans(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.present))
                          else
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(_distToChildStop,
                                    style: GoogleFonts.dmSans(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w700,
                                        color: _childColor)),
                                Text('Dự kiến $_etaToChildStop',
                                    style: GoogleFonts.dmSans(
                                        fontSize: 11,
                                        color: AppColors.textSub)),
                              ],
                            ),
                        ],
                      ),
                    ),
                  ),

                // Route banner — shown when Pi sends route info
                if (_gps != null && _gps!.routeToName.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: AppCard(
                      child: Row(
                        children: [
                          Icon(
                            _gps!.reachedDestination
                                ? Icons.where_to_vote_rounded
                                : Icons.navigation_rounded,
                            size: 18,
                            color: _gps!.reachedDestination
                                ? AppColors.present
                                : AppColors.primary,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _gps!.reachedDestination
                                  ? 'Xe đã đến ${_gps!.routeToName}'
                                  : (_gps!.routeFromName.isNotEmpty
                                      ? '${_gps!.routeFromName} → ${_gps!.routeToName}'
                                      : 'Đang đến ${_gps!.routeToName}'),
                              style: GoogleFonts.dmSans(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: _gps!.reachedDestination
                                    ? AppColors.present
                                    : AppColors.textMain,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                // ETA + speed + distance
                AppCard(
                  child: Row(
                    children: [
                      // ETA
                      Expanded(
                        child: Column(
                          crossAxisAlignment:
                          CrossAxisAlignment.start,
                          children: [
                            Text('Dự kiến đến trường',
                                style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: AppColors.textSub)),
                            Text(_computedEta,
                                style: GoogleFonts.dmSans(
                                    fontSize: 24,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.primary)),
                            Text(_minutesLeft,
                                style: GoogleFonts.dmSans(
                                    fontSize: 12,
                                    color: AppColors.textSub)),
                          ],
                        ),
                      ),
                      Container(
                          width: 1,
                          height: 52,
                          color: AppColors.border),
                      const SizedBox(width: 16),
                      // Speed
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Icon(Icons.speed_rounded,
                              color: AppColors.textSub, size: 18),
                          const SizedBox(height: 4),
                          Text(
                            '${_gps!.speed.toStringAsFixed(0)} km/h',
                            style: GoogleFonts.dmSans(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textMain),
                          ),
                          Text('Tốc độ',
                              style: GoogleFonts.dmSans(
                                  fontSize: 11,
                                  color: AppColors.textSub)),
                        ],
                      ),
                      const SizedBox(width: 16),
                      Container(
                          width: 1,
                          height: 52,
                          color: AppColors.border),
                      const SizedBox(width: 16),
                      // Distance
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Icon(Icons.straighten_rounded,
                              color: AppColors.textSub, size: 18),
                          const SizedBox(height: 4),
                          Text(
                            _distanceToSchool,
                            style: GoogleFonts.dmSans(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textMain),
                          ),
                          Text('Còn lại',
                              style: GoogleFonts.dmSans(
                                  fontSize: 11,
                                  color: AppColors.textSub)),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // Nearest / current stop
                if (_nearestStop != null)
                  AppCard(
                    child: Row(
                      children: [
                        Container(
                          width: 36, height: 36,
                          decoration: BoxDecoration(
                            color: (_arrivedStop != null
                                    ? AppColors.present
                                    : AppColors.accent)
                                .withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Icon(
                            _arrivedStop != null
                                ? Icons.where_to_vote_rounded
                                : Icons.location_on_rounded,
                            color: _arrivedStop != null
                                ? AppColors.present
                                : AppColors.accent,
                            size: 18,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _arrivedStop != null
                                    ? 'Xe đang dừng tại'
                                    : 'Trạm gần nhất',
                                style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: AppColors.textSub),
                              ),
                              Text(
                                (_arrivedStop ?? _nearestStop)!.name,
                                style: GoogleFonts.dmSans(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 16),

                const SectionTitle('CÁC TRẠM DỪNG'),
                AppCard(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 8),
                  child: _stops.isEmpty
                      ? Padding(
                          padding:
                              const EdgeInsets.symmetric(vertical: 12),
                          child: Text(
                            'Chưa có lộ trình — tài xế chưa bắt đầu chuyến.',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: AppColors.textSub),
                          ),
                        )
                      : Column(
                    children: [
                      ...List.generate(_stops.length, (i) {
                      final stop      = _stops[i];
                      final isDone    = stop.done;
                      final isCurrent = i == _currentStopIdx;
                      final isChild   =
                          stop.id.isNotEmpty && stop.id == _childStopId;
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Column(
                            children: [
                              const SizedBox(height: 14),
                              Container(
                                width: 14, height: 14,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: isDone
                                      ? AppColors.present
                                      : isCurrent
                                      ? AppColors.primary
                                      : isChild
                                      ? _childColor
                                      : AppColors.border,
                                  border: Border.all(
                                    color: isDone
                                        ? AppColors.present
                                        : isCurrent
                                        ? AppColors.primary
                                        : isChild
                                        ? _childColor
                                        : AppColors.textHint,
                                    width: 2,
                                  ),
                                ),
                                child: isCurrent
                                    ? const Center(
                                    child: Icon(Icons.circle,
                                        size: 6,
                                        color: Colors.white))
                                    : null,
                              ),
                              // Connector luôn hiện — dòng cuối là trường
                              Container(
                                  width: 2,
                                  height: 36,
                                  color: isDone
                                      ? AppColors.present
                                      .withValues(alpha:0.4)
                                      : AppColors.border),
                            ],
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: GestureDetector(
                              onTap: () =>
                                  _mapController.move(stop.latLng, 16),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                    vertical: 8),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Text(stop.name,
                                          style: GoogleFonts.dmSans(
                                            fontSize: 13,
                                            fontWeight: isCurrent || isChild
                                                ? FontWeight.w600
                                                : FontWeight.w400,
                                            color: isCurrent
                                                ? AppColors.primary
                                                : isDone
                                                ? AppColors.textMain
                                                : AppColors.textSub,
                                          )),
                                    ),
                                    if (isDone)
                                      const Icon(
                                          Icons.check_circle_rounded,
                                          size: 16,
                                          color: AppColors.present),
                                    if (isCurrent)
                                      Container(
                                        padding: const EdgeInsets
                                            .symmetric(
                                            horizontal: 8,
                                            vertical: 2),
                                        decoration: BoxDecoration(
                                          color: AppColors.primarySurface,
                                          borderRadius:
                                          BorderRadius.circular(10),
                                        ),
                                        child: Text('Xe đang ở đây',
                                            style: GoogleFonts.dmSans(
                                                fontSize: 10,
                                                fontWeight:
                                                FontWeight.w600,
                                                color:
                                                AppColors.primary)),
                                      ),
                                    if (isChild)
                                      Padding(
                                        padding: const EdgeInsets.only(
                                            left: 4),
                                        child: Container(
                                          padding: const EdgeInsets
                                              .symmetric(
                                              horizontal: 8,
                                              vertical: 2),
                                          decoration: BoxDecoration(
                                            color: _childColor
                                                .withValues(alpha: 0.1),
                                            borderRadius:
                                            BorderRadius.circular(10),
                                          ),
                                          child: Text(
                                              _isAfternoonSession
                                                  ? 'Trả bé'
                                                  : 'Đón bé',
                                              style: GoogleFonts.dmSans(
                                                  fontSize: 10,
                                                  fontWeight:
                                                  FontWeight.w600,
                                                  color: _childColor)),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      );
                    }),
                      // Trường — điểm cuối của cả buổi sáng lẫn buổi chiều
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Column(
                            children: [
                              const SizedBox(height: 14),
                              Container(
                                width: 14, height: 14,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: _currentStopIdx >= _stops.length
                                      ? AppColors.primary
                                      : AppColors.border,
                                  border: Border.all(
                                    color:
                                        _currentStopIdx >= _stops.length
                                            ? AppColors.primary
                                            : AppColors.textHint,
                                    width: 2,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  vertical: 8),
                              child: Row(
                                children: [
                                  const Icon(Icons.school_rounded,
                                      size: 16,
                                      color: AppColors.present),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      _school?.name ?? 'Trường học',
                                      style: GoogleFonts.dmSans(
                                        fontSize: 13,
                                        fontWeight: _currentStopIdx >=
                                                _stops.length
                                            ? FontWeight.w600
                                            : FontWeight.w400,
                                        color: _currentStopIdx >=
                                                _stops.length
                                            ? AppColors.primary
                                            : AppColors.textSub,
                                      ),
                                    ),
                                  ),
                                  if (_currentStopIdx >= _stops.length)
                                    Container(
                                      padding: const EdgeInsets
                                          .symmetric(
                                          horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(
                                        color:
                                            AppColors.primarySurface,
                                        borderRadius:
                                            BorderRadius.circular(10),
                                      ),
                                      child: Text('Xe đang đến',
                                          style: GoogleFonts.dmSans(
                                              fontSize: 10,
                                              fontWeight:
                                                  FontWeight.w600,
                                              color:
                                                  AppColors.primary)),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 80),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showBusInfo(BuildContext context) {
    if (_gps == null) return;
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 36, height: 4,
                decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 16),
            Row(
              children: [
                Container(
                  width: 48, height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.primarySurface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.directions_bus_rounded,
                      color: AppColors.primary, size: 26),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text('Tuyến 01  ·  ${_school?.name ?? 'HCMUTE'}',
                      style: GoogleFonts.dmSans(
                          fontSize: 16, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 16),
            InfoRow(
              label: _arrivedStop != null ? 'Đang dừng tại' : 'Trạm gần nhất',
              value: (_arrivedStop ?? _nearestStop)?.name ?? '--',
            ),
            const Divider(height: 16, color: AppColors.border),
            InfoRow(label: 'Tốc độ hiện tại',
                value: '${_gps!.speed.toStringAsFixed(0)} km/h'),
            const Divider(height: 16, color: AppColors.border),
            InfoRow(label: 'Còn cách trường', value: _distanceToSchool),
            const Divider(height: 16, color: AppColors.border),
            InfoRow(label: 'Dự kiến đến', value: '$_computedEta ($_minutesLeft)'),
          ],
        ),
      ),
    );
  }
}