import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ref, set } from 'firebase/database';
import { rtdb } from '../firebase';
import { listenToBusStops } from '../services/busStopService';
import { listenToSchoolConfig, DEFAULT_SCHOOL } from '../services/schoolConfigService';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import MapIcon from '@mui/icons-material/Map';

const GPS_PATH = 'bus/gps';
const ROUTE_STEPS = 28;

const makeRoutePoints = (from, to, steps = ROUTE_STEPS) => {
  if (!from || !to) return [];
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    return {
      lat: from.lat + (to.lat - from.lat) * progress,
      lng: from.lng + (to.lng - from.lng) * progress,
    };
  });
};

const formatTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) : '--';

const GpsDemoPage = ({ embedded = false }) => {
  const [running, setRunning] = useState(true);
  const [lastPayload, setLastPayload] = useState(null);
  const [writeError, setWriteError] = useState('');
  const [busStops, setBusStops] = useState([]);
  const [school, setSchool] = useState(DEFAULT_SCHOOL);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('school');
  const indexRef = useRef(0);
  const timerRef = useRef(null);
  const lastPayloadRef = useRef(null);
  const routePointsRef = useRef([]);
  const fromPointRef = useRef(null);
  const toPointRef = useRef(null);

  const gpsRef = useMemo(() => ref(rtdb, GPS_PATH), []);

  useEffect(() => {
    const unsubStops = listenToBusStops((data) => {
      const activeStops = data
        .filter((stop) => stop.isActive !== false && stop.location?.lat && stop.location?.lng)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      setBusStops(activeStops);
      setFromId((current) => current || activeStops[0]?.id || '');
    });
    const unsubSchool = listenToSchoolConfig(setSchool);

    return () => {
      unsubStops();
      unsubSchool();
    };
  }, []);

  const routeOptions = useMemo(() => {
    const stops = busStops.map((stop) => ({
      id: stop.id,
      label: `${stop.order ? `${stop.order}. ` : ''}${stop.name}`,
      lat: stop.location.lat,
      lng: stop.location.lng,
      type: 'stop',
    }));
    return [
      ...stops,
      {
        id: 'school',
        label: `Trường - ${school.name}`,
        lat: school.lat,
        lng: school.lng,
        type: 'school',
      },
    ];
  }, [busStops, school]);

  const fromPoint = useMemo(
    () => routeOptions.find((option) => option.id === fromId) || null,
    [routeOptions, fromId],
  );

  const toPoint = useMemo(
    () => routeOptions.find((option) => option.id === toId) || null,
    [routeOptions, toId],
  );

  const routePoints = useMemo(
    () => makeRoutePoints(fromPoint, toPoint),
    [fromPoint, toPoint],
  );

  useEffect(() => {
    routePointsRef.current = routePoints;
    fromPointRef.current = fromPoint;
    toPointRef.current = toPoint;
  }, [routePoints, fromPoint, toPoint]);

  useEffect(() => {
    if (!routeOptions.length) return;
    if (fromId && fromId === toId) {
      const fallback = routeOptions.find((option) => option.id === 'school' && option.id !== fromId)
        || routeOptions.find((option) => option.id !== fromId);
      if (fallback) setToId(fallback.id);
    }
  }, [fromId, toId, routeOptions]);

  const resetRoute = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    indexRef.current = 0;
    setLastPayload(null);
    lastPayloadRef.current = null;
    setRunning(false);
  };

  const handleFromChange = (value) => {
    setFromId(value);
    resetRoute();
  };

  const handleToChange = (value) => {
    setToId(value);
    resetRoute();
  };

  const writePoint = async () => {
    const points = routePointsRef.current;
    const from = fromPointRef.current;
    const to = toPointRef.current;
    if (!points.length || !from || !to) return;
    const routeIndex = Math.min(indexRef.current, points.length - 1);
    const point = points[routeIndex];
    const reachedDestination = routeIndex === points.length - 1;
    const payload = {
      lat: point.lat,
      lng: point.lng,
      speed: 25 + ((indexRef.current * 3) % 14),
      accuracy: 6,
      isActive: !reachedDestination,
      source: 'web-gps-demo',
      deviceId: 'demo-bus-01',
      routeFromId: from.id,
      routeFromName: from.label,
      routeToId: to.id,
      routeToName: to.label,
      reachedDestination,
      updatedAt: Date.now(),
    };

    await set(gpsRef, payload);
    lastPayloadRef.current = payload;
    setLastPayload(payload);
    setWriteError('');

    if (reachedDestination) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setRunning(false);
      return;
    }

    indexRef.current += 1;
  };

  useEffect(() => {
    if (!running) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      return undefined;
    }

    writePoint().catch((err) => setWriteError(err.message || 'Không ghi được GPS demo'));
    timerRef.current = setInterval(() => {
      writePoint().catch((err) => setWriteError(err.message || 'Không ghi được GPS demo'));
    }, 1200);

    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      const latest = lastPayloadRef.current;
      if (!latest) return;
      set(gpsRef, {
        ...latest,
        isActive: false,
        updatedAt: Date.now(),
      }).catch(() => {});
    };
  }, [gpsRef]);

  return (
    <div className={`gps-demo-page ${embedded ? 'embedded' : ''}`}>
      <header className="gps-demo-header">
        <div>
          <div className="gps-demo-kicker">
            <DirectionsBusIcon />
            RTDB writer
          </div>
          <h1>Demo GPS xe buýt</h1>
          <p>
            Chọn trạm gốc và nơi tới, trang này ghi trực tiếp vào <code>bus/gps</code>. Sau đó mở Bản đồ để xem xe chạy.
          </p>
        </div>
        <div className="gps-demo-actions">
          <button
            className={`btn ${running ? 'btn-outline' : 'btn-primary'}`}
            onClick={() => setRunning((v) => !v)}
          >
            {running ? <StopIcon /> : <PlayArrowIcon />}
            {running ? 'Dừng ghi GPS' : 'Chạy demo GPS'}
          </button>
          <Link className="btn btn-primary" to="/dashboard">
            <MapIcon />
            Về dashboard
          </Link>
        </div>
      </header>

      {writeError && <div className="alert alert-error gps-demo-alert">{writeError}</div>}

      <section className="gps-demo-route-panel">
        <div className="gps-demo-route-field">
          <label>Đi từ</label>
          <select value={fromId} onChange={(e) => handleFromChange(e.target.value)}>
            {!busStops.length && <option value="">Chưa có trạm xe</option>}
            {busStops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.order ? `${stop.order}. ` : ''}{stop.name}
              </option>
            ))}
          </select>
        </div>

        <div className="gps-demo-route-field">
          <label>Đến</label>
          <select value={toId} onChange={(e) => handleToChange(e.target.value)}>
            {routeOptions
              .filter((option) => option.id !== fromId)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
          </select>
        </div>

        <div className="gps-demo-route-summary">
          <span>Tuyến demo</span>
          <strong>
            {fromPoint?.label || 'Chưa chọn trạm'} → {toPoint?.label || 'Chưa chọn điểm đến'}
          </strong>
        </div>
      </section>

      <section className="gps-demo-grid">
        <div className="gps-demo-card live">
          <span>Trạng thái</span>
          <strong>{running ? 'Đang ghi bus/gps' : lastPayload?.reachedDestination ? 'Đã đến điểm đến' : 'Đã dừng'}</strong>
        </div>
        <div className="gps-demo-card">
          <span>Latitude</span>
          <strong>{lastPayload ? lastPayload.lat.toFixed(6) : '--'}</strong>
        </div>
        <div className="gps-demo-card">
          <span>Longitude</span>
          <strong>{lastPayload ? lastPayload.lng.toFixed(6) : '--'}</strong>
        </div>
        <div className="gps-demo-card">
          <span>Tốc độ</span>
          <strong>{lastPayload ? `${lastPayload.speed} km/h` : '--'}</strong>
        </div>
        <div className="gps-demo-card">
          <span>Cập nhật</span>
          <strong>{formatTime(lastPayload?.updatedAt)}</strong>
        </div>
        <div className="gps-demo-card">
          <span>RTDB path</span>
          <strong>{GPS_PATH}</strong>
        </div>
        <div className="gps-demo-card">
          <span>Điểm đi</span>
          <strong>{lastPayload?.routeFromName || fromPoint?.label || '--'}</strong>
        </div>
        <div className="gps-demo-card">
          <span>Điểm đến</span>
          <strong>{lastPayload?.routeToName || toPoint?.label || '--'}</strong>
        </div>
      </section>

      <section className="gps-demo-steps">
        <h2>Cách test</h2>
        <ol>
          <li>Chọn trạm gốc và nơi tới, ví dụ Trạm 1 → Trường.</li>
          <li>Bấm Chạy demo GPS nếu trang đang dừng.</li>
          <li>Chuyển sang mục Bản đồ để xem marker xe di chuyển theo RTDB.</li>
          <li>Khi GPS đến điểm cuối, demo tự dừng và ghi xe dừng.</li>
        </ol>
      </section>
    </div>
  );
};

export default GpsDemoPage;
