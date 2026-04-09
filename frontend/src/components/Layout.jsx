import React, { useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './Layout.css';
import tplLogo from '../assets/tpl.png';
import { useAuth } from '../context/AuthContext.jsx';
import { DeviceCacheProvider } from '../context/DeviceCacheContext.jsx';
import { UserCacheProvider } from '../context/Usercachecontext.jsx';
import MapThemeToggle from './MapThemeToggle.jsx';

// ─── Icon helper ─────────────────────────────────────────────────
const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS = {
  close:  "M18 6L6 18M6 6l12 12",
  user:   "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  eye:    "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z",
  eyeOff: "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22",
  camera: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z",
  check:  "M20 6L9 17l-5-5",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
};

const TABS = [
  { id: "profile",  label: "Profile",  icon: ICONS.user   },
  { id: "security", label: "Security", icon: ICONS.shield },
];

function pwStrength(pw) {
  let s = 0;
  if (pw.length >= 8)           s++;
  if (/[A-Z]/.test(pw))         s++;
  if (/[0-9]/.test(pw))         s++;
  if (/[^A-Za-z0-9]/.test(pw))  s++;
  return s;
}
const STRENGTH_LABEL = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];

function PasswordInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a1a1aa', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          style={{
            width: '100%', background: '#18181b', border: '1px solid #3f3f46',
            borderRadius: 8, padding: '10px 40px 10px 14px', fontSize: 13,
            color: '#fff', outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={e => (e.target.style.borderColor = '#800000')}
          onBlur={e => (e.target.style.borderColor = '#3f3f46')}
        />
        <button type="button" onClick={() => setShow(v => !v)}
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', padding: 0 }}>
          <Icon d={show ? ICONS.eyeOff : ICONS.eye} size={16} />
        </button>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, readOnly }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a1a1aa', marginBottom: 6 }}>
        {label}
      </label>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        style={{
          width: '100%', background: '#18181b', border: '1px solid #3f3f46',
          borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#fff',
          outline: 'none', boxSizing: 'border-box',
          opacity: readOnly ? 0.5 : 1, cursor: readOnly ? 'not-allowed' : 'text',
        }}
        onFocus={e => !readOnly && (e.target.style.borderColor = '#800000')}
        onBlur={e => (e.target.style.borderColor = '#3f3f46')}
      />
    </div>
  );
}

function ProfileSettingsModal({ isOpen, onClose, user, role }) {
  const fileRef = useRef();
  const [tab, setTab]             = useState("profile");
  const [avatarSrc, setAvatar]    = useState(null);
  const [displayName, setName]    = useState(user?.email?.split("@")[0] ?? "User");
  const [phone, setPhone]         = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw]         = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaved, setPwSaved]     = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  if (!isOpen) return null;

  const isAdmin = role === "admin";
  const roleLabel = isAdmin ? "Administrator" : "User";
  const roleBadgeBg = isAdmin ? 'rgba(128,0,0,0.2)' : 'rgba(59,130,246,0.15)';
  const roleBadgeColor = isAdmin ? '#cc4444' : '#60a5fa';
  const roleBadgeBorder = isAdmin ? 'rgba(128,0,0,0.3)' : 'rgba(59,130,246,0.3)';

  const strength  = pwStrength(newPw);
  const pwMatch   = newPw && confirmPw && newPw === confirmPw;
  const canSavePw = currentPw && newPw.length >= 8 && pwMatch;

  const initials = displayName.trim().split(" ")
    .map(w => w[0]).slice(0, 2).join("").toUpperCase();

  function handleAvatar(e) {
    const file = e.target.files?.[0];
    if (file) setAvatar(URL.createObjectURL(file));
  }

  function handleSaveProfile() {
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2500);
  }

  function handleSavePassword() {
    if (!canSavePw) return;
    setPwSaved(true);
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setTimeout(() => setPwSaved(false), 2500);
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, background: '#09090b',
        border: '1px solid #27272a', borderRadius: 16,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid #27272a', background: '#111113',
        }}>
          <div>
            <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: 0 }}>Profile Settings</h2>
            <p style={{ color: '#71717a', fontSize: 12, margin: '2px 0 0' }}>Manage your account preferences</p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
            cursor: 'pointer', color: '#71717a', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#27272a'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71717a'; }}
          >
            <Icon d={ICONS.close} size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #27272a', background: '#0d0d0f' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 20px', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.id ? '#fff' : '#71717a',
              borderBottom: tab === t.id ? '2px solid #800000' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>
              <Icon d={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 24, overflowY: 'auto', maxHeight: '60vh' }}>
          {tab === "profile" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {avatarSrc
                    ? <img src={avatarSrc} alt="avatar" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(128,0,0,0.4)' }} />
                    : <div style={{ width: 72, height: 72, borderRadius: '50%', background: isAdmin ? 'linear-gradient(135deg, #800000, #4a0000)' : 'linear-gradient(135deg, #1e40af, #1e3a5f)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 22, border: `2px solid ${isAdmin ? 'rgba(128,0,0,0.4)' : 'rgba(59,130,246,0.4)'}` }}>{initials}</div>
                  }
                  <button onClick={() => fileRef.current?.click()} style={{ position: 'absolute', bottom: -2, right: -2, width: 24, height: 24, borderRadius: '50%', background: '#800000', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon d={ICONS.camera} size={12} />
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
                </div>
                <div>
                  <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, margin: 0 }}>{displayName}</p>
                  <span style={{ display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 4, background: roleBadgeBg, color: roleBadgeColor, border: `1px solid ${roleBadgeBorder}` }}>{roleLabel}</span>
                </div>
              </div>
              <div style={{ height: 1, background: '#27272a' }} />
              <TextInput label="Display Name" value={displayName} onChange={e => setName(e.target.value)} placeholder="Your name" />
              <TextInput label="Email Address" value={user?.email ?? "—"} readOnly />
              <TextInput label="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+92 300 0000000" />
              <TextInput label="Role" value={roleLabel} readOnly />
              <button onClick={handleSaveProfile} style={{ width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', background: profileSaved ? '#15803d' : '#800000', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background 0.2s' }}>
                {profileSaved ? <><Icon d={ICONS.check} size={15} /> Saved</> : "Save Profile"}
              </button>
            </div>
          )}

          {tab === "security" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(128,0,0,0.1)', border: '1px solid rgba(128,0,0,0.2)' }}>
                <Icon d={ICONS.shield} size={15} />
                <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0, lineHeight: 1.5 }}>Use at least 8 characters with uppercase letters, numbers, and symbols.</p>
              </div>
              <PasswordInput label="Current Password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" />
              <PasswordInput label="New Password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Enter new password" />
              {newPw.length > 0 && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {[1,2,3,4].map(i => (
                      <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: i <= strength ? STRENGTH_COLOR[strength] : '#3f3f46', transition: 'background 0.3s' }} />
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: STRENGTH_COLOR[strength], margin: 0 }}>{STRENGTH_LABEL[strength]}</p>
                </div>
              )}
              <PasswordInput label="Confirm New Password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" />
              {confirmPw && !pwMatch && <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>Passwords do not match</p>}
              {pwSaved && <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e', fontSize: 13 }}><Icon d={ICONS.check} size={15} /> Password updated successfully</div>}
              <button onClick={handleSavePassword} disabled={!canSavePw} style={{ width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', background: canSavePw ? '#800000' : '#27272a', color: canSavePw ? '#fff' : '#52525b', fontWeight: 600, fontSize: 13, cursor: canSavePw ? 'pointer' : 'not-allowed', transition: 'background 0.2s' }}>
                Update Password
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Layout ──────────────────────────────────────────────────────
const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, isAdmin, logout } = useAuth();
  const [showProfileMenu, setShowProfileMenu]         = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Pages where map theme toggle should be hidden
  const hideMapThemePaths = ['/', '/Homepage', '/devices', '/report', '/field-staff-dashboard'];
  const shouldHideMapTheme = hideMapThemePaths.includes(location.pathname);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/Homepage',   label: 'Home'       },
    { path: '/devices',    label: 'Locators'   },
    { path: '/trajectory', label: 'Trajectory' },
    { path: '/mapview',    label: 'Map View'   },
    { path: '/playback',   label: 'Playback'   },
    { path: '/fence',      label: 'Fence'      },
    { path: '/report',     label: 'Report'     },
  ];

  return (
    <DeviceCacheProvider>
      <UserCacheProvider>
        <div className="layout">
          <header className="header">

            <div className="header-left">
              <div className="logo">
                <img src={tplLogo} alt="Trakker Logo" className="logo-img" />
                <span className="logo-text">Trakker</span>
              </div>
              
              {/* Mobile menu toggle button */}
              <button 
                className="mobile-menu-toggle"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle menu"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {mobileMenuOpen ? (
                    <path d="M18 6L6 18M6 6l12 12" />
                  ) : (
                    <>
                      <path d="M3 12h18M3 6h18M3 18h18" />
                    </>
                  )}
                </svg>
              </button>
              
              <nav className={`nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="header-right">
              {!shouldHideMapTheme && <MapThemeToggle />}

              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
                padding: '4px 10px', borderRadius: 6,
                background: isAdmin ? 'rgba(255,255,255,0.15)' : 'rgba(59,130,246,0.2)',
                color: isAdmin ? '#fff' : '#93c5fd',
                border: isAdmin ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(59,130,246,0.3)',
              }}>
                {isAdmin ? 'Admin' : 'User'}
              </span>

              <div className="profile-container" style={{ position: 'relative' }}>
                <button className="profile-btn" onClick={() => setShowProfileMenu(v => !v)}>
                  <div className="profile-avatar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeWidth="2"/>
                      <circle cx="12" cy="7" r="4" strokeWidth="2"/>
                    </svg>
                  </div>
                  <span className="profile-email">{user?.email ?? "Account"}</span>
                  <svg className="dropdown-arrow" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                  </svg>
                </button>

                {showProfileMenu && (
                  <>
                    {/* Transparent backdrop — closes menu when clicking anywhere outside */}
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 98 }}
                      onClick={() => setShowProfileMenu(false)}
                    />
                    <div className="profile-menu" style={{ zIndex: 99 }}>
                      <div
                        className="profile-menu-item"
                        onClick={() => { setShowProfileSettings(true); setShowProfileMenu(false); }}
                      >
                        Profile Settings
                      </div>
                      <div className="profile-menu-divider" />
                      <div className="profile-menu-item logout" onClick={handleLogout}>
                        Logout
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

          </header>

          <main className="main-content">
            {children}
          </main>

          <ProfileSettingsModal
            isOpen={showProfileSettings}
            onClose={() => setShowProfileSettings(false)}
            user={user}
            role={role}
          />
        </div>
      </UserCacheProvider>
    </DeviceCacheProvider>
  );
};

export default Layout;