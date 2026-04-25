import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../theme/app_theme.dart';
import '../widgets/shared_widgets.dart';

// ── Models ────────────────────────────────────────────

class _GpsData {
  final double lat;
  final double lng;
  final double speed; // km/h

  const _GpsData({
    required this.lat,
    required this.lng,
    required this.speed,
  });

  factory _GpsData.fromMap(Map map) => _GpsData(
    lat: (map['lat'] as num).toDouble(),
    lng: (map['lng'] as num).toDouble(),
    speed: (map['speed'] as num?)?.toDouble() ?? 0.0,
  );
}

class _StopData {
  final String name;
  final double lat;
  final double lng;
  final int order;

  const _StopData({
    required this.name,
    required this.lat,
    required this.lng,
    required this.order,
  });

  LatLng get latLng => LatLng(lat, lng);
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
  _GpsData? _gps;
  _SchoolData? _school;
  List<_StopData> _stops = [];
  bool _loadingGps = true;
  bool _loadingStops = true;
  bool _loadingSchool = true;

  bool get _loading => _loadingGps || _loadingStops || _loadingSchool;

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
    _loadStops();
    _listenGps();
  }

  @override
  void dispose() {
    _gpsSub?.cancel();
    super.dispose();
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

  Future<void> _loadStops() async {
    try {
      final snap = await FirebaseFirestore.instance
          .collection('busStops')
          .where('isActive', isEqualTo: true)
          .get();
      final stops = snap.docs.map((doc) {
        final d   = doc.data();
        final loc = d['location'] as Map<String, dynamic>? ?? {};
        return _StopData(
          name:  d['name']?.toString() ?? '',
          lat:   (loc['lat'] as num?)?.toDouble() ?? 0.0,
          lng:   (loc['lng'] as num?)?.toDouble() ?? 0.0,
          order: (d['order'] as num?)?.toInt() ?? 0,
        );
      }).toList()
        ..sort((a, b) => a.order.compareTo(b.order));
      if (mounted) setState(() { _stops = stops; _loadingStops = false; });
    } catch (_) {
      if (mounted) setState(() => _loadingStops = false);
    }
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
            try {
              _mapController.move(_busPosition, _mapController.camera.zoom);
            } catch (_) {}
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

  bool _isDone(_StopData stop) {
    final ref = _arrivedStop ?? _nearestStop;
    if (ref == null) return false;
    return stop.order < ref.order;
  }

  bool _isCurrent(_StopData stop) {
    return stop == _arrivedStop;
  }

  @override
  Widget build(BuildContext context) {
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
                  ),
                  children: [
                    TileLayer(
                      urlTemplate:
                      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.example.school_bus_app',
                    ),

                    // Stop route polyline
                    if (_stops.isNotEmpty)
                      PolylineLayer(
                        polylines: [
                          Polyline(
                            points: _stops.map((s) => s.latLng).toList(),
                            color: AppColors.primary.withValues(alpha:0.6),
                            strokeWidth: 4,
                            pattern: StrokePattern.dashed(segments: [10, 5]),
                          ),
                        ],
                      ),

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

                    // Stop markers
                    if (_stops.isNotEmpty)
                      MarkerLayer(
                        markers: _stops.map((stop) {
                          final isDone = _isDone(stop);
                          final isCurrent = _isCurrent(stop);
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
                                  Text('Tuyến 01  ·  ${_school?.name ?? 'HCMUTE'}',
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
                    onPressed: () => _mapController.move(_busPosition, 15),
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
                  child: Column(
                    children: List.generate(_stops.length, (i) {
                      final stop = _stops[i];
                      final isLast = i == _stops.length - 1;
                      final isDone = _isDone(stop);
                      final isCurrent = _isCurrent(stop);
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
                                      : AppColors.border,
                                  border: Border.all(
                                    color: isDone
                                        ? AppColors.present
                                        : isCurrent
                                        ? AppColors.primary
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
                              if (!isLast)
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
                                            fontWeight: isCurrent
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
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      );
                    }),
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