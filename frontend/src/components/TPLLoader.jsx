import React from 'react';
import tplLogo from '../assets/tpl.png';

/**
 * Shared TPL branded loading spinner.
 * Used across DevicesTable, FieldStaffDashboard, and any other page that needs
 * a consistent branded loading state.
 *
 * Props:
 *   label  – text shown beneath the logo  (default: "Loading…")
 */
const TPLLoader = ({ label = 'Loading…' }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    gap: 20,
  }}>
    <style>{`
      @keyframes tpl-pulse {
        0%   { opacity: 0.15; transform: scale(0.95); }
        50%  { opacity: 0.70; transform: scale(1.02); }
        100% { opacity: 0.15; transform: scale(0.95); }
      }
    `}</style>
    <img
      src={tplLogo}
      alt="Loading"
      style={{
        width: 110,
        height: 'auto',
        filter: 'brightness(0) invert(1)',
        animation: 'tpl-pulse 1.6s ease-in-out infinite',
      }}
    />
    <span style={{
      color: '#52525b',
      fontSize: 12,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {label}
    </span>
  </div>
);

export default TPLLoader;
