import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginUser } from '../services/authService';
import { addLog } from '../services/logService';
import EmailIcon from '@mui/icons-material/Email';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

// Bus icon
const BusIllustration = () => (
  <svg viewBox="0 0 360 300" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: 340 }}>
    {/* Decorative bg circles */}
    <circle cx="310" cy="35"  r="22" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="2.5"/>
    <circle cx="42"  cy="55"  r="9"  fill="rgba(255,255,255,.18)"/>
    <circle cx="330" cy="190" r="13" fill="rgba(255,255,255,.12)"/>
    <circle cx="20"  cy="200" r="7"  fill="rgba(255,255,255,.14)"/>

    {/* Wavy line top */}
    <path d="M20 110 Q60 90 100 110 Q140 130 180 110 Q220 90 260 110" stroke="rgba(255,255,255,.25)" strokeWidth="2" fill="none"/>
    {/* Wavy line bottom */}
    <path d="M60 255 Q100 240 140 255 Q180 270 220 255 Q260 240 300 255" stroke="rgba(255,255,255,.2)" strokeWidth="2" fill="none"/>

    {/* Road */}
    <rect x="0" y="262" width="360" height="38" rx="0" fill="rgba(0,0,0,.15)"/>
    {/* Road dashes */}
    {[30,90,150,210,270,330].map((x) => (
      <rect key={x} x={x} y="278" width="40" height="7" rx="4" fill="rgba(255,255,255,.2)"/>
    ))}

    {/* Bus body */}
    <rect x="50"  y="155" width="260" height="108" rx="18" fill="white" opacity=".93"/>
    {/* Bus front cab */}
    <rect x="288" y="163" width="35"  height="100" rx="14" fill="white" opacity=".85"/>

    {/* Side stripe */}
    <rect x="50"  y="213" width="272" height="9"   rx="0" fill="#BFDBFE" opacity=".55"/>

    {/* Windows */}
    {[72,130,188].map((x) => (
      <rect key={x} x={x} y="170" width="46" height="34" rx="8" fill="#93C5FD" opacity=".85"/>
    ))}

    {/* Headlight */}
    <rect x="296" y="172" width="20" height="13" rx="5" fill="#FCD34D"/>
    {/* Front grill */}
    <rect x="296" y="220" width="20" height="6"  rx="3" fill="#BFDBFE" opacity=".6"/>

    {/* Door */}
    <rect x="270" y="195" width="20" height="52" rx="5" fill="#BFDBFE" opacity=".75"/>
    <circle cx="280" cy="221" r="3" fill="rgba(0,82,204,.4)"/>

    {/* Wheels */}
    {[110, 255].map((cx) => (
      <g key={cx}>
        <circle cx={cx} cy="264" r="22" fill="#1E3A8A"/>
        <circle cx={cx} cy="264" r="13" fill="rgba(255,255,255,.22)"/>
        <circle cx={cx} cy="264" r="5"  fill="rgba(255,255,255,.35)"/>
      </g>
    ))}

    {/* Bus stop sign */}
    <rect x="18" y="100" width="36" height="42" rx="6" fill="rgba(255,255,255,.22)"/>
    <rect x="33" y="142" width="6"  height="32" fill="rgba(255,255,255,.22)"/>

    {/* Student figure */}
    <circle cx="30" cy="190" r="11"  fill="rgba(255,255,255,.7)"/>
    <rect x="23"  cy="201" width="14" height="28" rx="5" fill="rgba(255,255,255,.5)" y="201"/>

    {/* Clock */}
    <circle cx="336" cy="75" r="26" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="2.5"/>
    <line x1="336" y1="75" x2="336" y2="58"  stroke="rgba(255,255,255,.55)" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="336" y1="75" x2="350" y2="82"  stroke="rgba(255,255,255,.55)" strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="336" cy="75" r="3" fill="rgba(255,255,255,.55)"/>
  </svg>
);

const LoginPage = () => {
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await loginUser(email, password);
      await addLog(user.uid, 'Đăng nhập');
      navigate('/dashboard');
    } catch {
      setError('Email hoặc mật khẩu không đúng');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">

        {/* ── Left: illustration ── */}
        <div className="auth-left">
          <div className="auth-left-brand">
            <div className="auth-left-logo"><img src="/logo/front-of-bus.png" alt="BusAttend" /></div>
            <span className="auth-left-appname">BusAttend</span>
          </div>
          <BusIllustration />
         
        </div>

        {/* ── Right: form ── */}
        <div className="auth-right">
          <h2 className="auth-v2-title" style={{ textAlign: "center" }}>ĐĂNG NHẬP</h2>
          <p className="auth-v2-sub"></p>

          {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="auth-v2-field">
              <span className="auth-v2-icon"><EmailIcon /></span>
              <input
                className="auth-v2-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email quản trị"
                required
                autoComplete="email"
              />
            </div>

            <div className="auth-v2-field">
              <span className="auth-v2-icon"><LockIcon /></span>
              <input
                className="auth-v2-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                required
                autoComplete="current-password"
              />
              <button type="button" className="auth-v2-eye" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </button>
            </div>

            <button className="auth-v2-btn" type="submit" disabled={loading}>
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>

          <p className="auth-v2-footer">
            Chưa có tài khoản?{' '}
            <Link to="/register">Đăng ký ngay</Link>
          </p>
        </div>

      </div>
    </div>
  );
};

export default LoginPage;
