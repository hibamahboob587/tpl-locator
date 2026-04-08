import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './HomePage.css';
import { useCityTag } from '../hooks/useCityTag.js';
import { parseKMLText, pointInArea } from '../utils/geofenceUtils.js';
import { useNavigate } from "react-router-dom";
import { useBindCache } from '../context/BindCacheContext.jsx';

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════════════

const LOCATION_POLL_MS   = 8_000;
const TRAJECTORY_POLL_MS = 20_000;
const FETCH_CONCURRENCY  = 10;

function todayStr() { return new Date().toISOString().slice(0, 10); }

function dayRange(dateStr, isLive) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end   = isLive ? new Date() : new Date(`${dateStr}T23:59:59.999Z`);
  return { start, end };
}

async function pLimit(tasks, limit = 5) {
  const results = new Array(tasks.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try { results[i] = await tasks[i](); } catch { results[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function niceScale(maxVal, tickCount = 5) {
  if (maxVal <= 0) return [0, 1, 2, 3, 4];
  const rawStep  = maxVal / (tickCount - 1);
  const mag      = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= rawStep) ?? mag * 10;
  const niceMax  = Math.ceil(maxVal / niceStep) * niceStep;
  const ticks    = [];
  for (let t = 0; t <= niceMax + niceStep * 0.001; t += niceStep)
    ticks.push(Math.round(t * 10000) / 10000);
  return ticks;
}

const KML_REGIONS = [
  { label: 'Lahore — All Towns',         value: 'lahore_all',      areas: ['Ravi Town','Shalimar Town','Wagha Town','Aziz Bhatti Town','Gulberg Town','DGBT','Samnabad Town','Allama Iqbal Town','Nishter Town'] },
  { label: 'Lahore — Ravi Town',         value: 'ravi_town',       areas: ['Ravi Town'] },
  { label: 'Lahore — Shalimar Town',     value: 'shalimar_town',   areas: ['Shalimar Town'] },
  { label: 'Lahore — Wagha Town',        value: 'wagha_town',      areas: ['Wagha Town'] },
  { label: 'Lahore — Aziz Bhatti Town',  value: 'aziz_bhatti',     areas: ['Aziz Bhatti Town'] },
  { label: 'Lahore — Gulberg Town',      value: 'gulberg',         areas: ['Gulberg Town'] },
  { label: 'Lahore — DGBT',              value: 'dgbt',            areas: ['DGBT'] },
  { label: 'Lahore — Samnabad Town',     value: 'samnabad',        areas: ['Samnabad Town'] },
  { label: 'Lahore — Allama Iqbal Town', value: 'allama_iqbal',    areas: ['Allama Iqbal Town'] },
  { label: 'Lahore — Nishter Town',      value: 'nishter',         areas: ['Nishter Town'] },
  { label: 'Sheikhupura District',       value: 'sheikhupura',     areas: ['Sheikhupura','Ferozewala','Kot Abdul Malik','Muridke','Narang','Khanqah Dogran','Safdarabad','Sharaqpur','Farooqabad','Mananwala','Sheikhupura Tehsil','Sharaqpura Tehsil'] },
  { label: 'Nankana District',           value: 'nankana',         areas: ['Nankana Sahib','Warburton','Sangla Hill','Shah Kot','Nankana Sahib Tehsil'] },
  { label: 'Kasur District',             value: 'kasur',           areas: ['Pattoki Tehsil','Chunian Tehsil','Kasur Tehsil','Kasur'] },
  { label: 'Bahawalpur District',        value: 'bahawalpur',      areas: ['Bahawalpur Tehsil','Liaquatpur Tehsil','Bahawalpur'] },
];

const CHART_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#6366f1','#f43f5e',
];

// ── Relative time formatter ────────────────────────────────────────────
function fmtRelTime(ts) {
  if (!ts) return '—';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (isNaN(diff) || diff < 0) return '—';
    if (diff < 60_000)       return 'Just now';
    if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000)  return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

// ══════════════════════════════════════════════════════════════════════
// HEADER: LiveClock + inline date picker
// ══════════════════════════════════════════════════════════════════════
function LiveClock({ isHistorical, selectedDate, onDateChange }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="hp-header-controls">
      <div className="hp-clock">
        <span className="hp-clock-time">{timeStr}</span>
        <span className="hp-clock-date">{isHistorical ? 'Historical' : dateStr}</span>
      </div>
      <div className="hp-hdr-date-group">
        <label className="hp-hdr-date-label">
          Date {isHistorical && <span className="hp-filter-hist-badge">HIST</span>}
        </label>
        <input
          type="date"
          className="hp-filter-select hp-filter-date"
          value={selectedDate}
          max={todayStr()}
          onClick={e => { try { e.target.showPicker(); } catch {} }}
          onChange={e => onDateChange(e.target.value)}
          style={{ height: 28, fontSize: 11 }}
        />
      </div>
      {isHistorical && (
        <button className="hp-filter-live-btn" onClick={() => onDateChange(todayStr())}
          style={{ height: 28, fontSize: 11, padding: '0 10px' }}>
          ● Live
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// STAT CARD — with optional progress bar
// ══════════════════════════════════════════════════════════════════════
function StatCard({ title, value, icon, iconBg, iconColor, accentColor, loading, rate, progress, subtitle }) {
  const pct = progress != null ? Math.max(0, Math.min(100, isNaN(progress) ? 0 : progress)) : null;
  return (
    <div className="hp-stat-card">
      <div className="hp-stat-accent" style={{ background: accentColor }} />
      <div className="hp-stat-inner">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hp-stat-title">{title}</div>
          {loading
            ? <div className="hp-stat-shimmer" />
            : <div className="hp-stat-val" style={{ color: accentColor }}>{value}</div>
          }
          {!loading && rate != null && rate > 0 && (
            <div className="hp-stat-rate" style={{ color: '#4ade80' }}>
              <span style={{ fontSize: 9 }}>▲</span>
              {`+${rate} this week`}
            </div>
          )}
          {!loading && subtitle && (
            <div className="hp-stat-rate" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {subtitle}
            </div>
          )}
          {!loading && pct != null && (
            <div className="hp-stat-progress-wrap">
              <div className="hp-stat-progress-fill" style={{ width: `${pct}%`, background: accentColor }} />
            </div>
          )}
        </div>
        <div className="hp-stat-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// FIX 3: BATTERY STATUS CARD — bigger donut (90×90), tighter legend
// ══════════════════════════════════════════════════════════════════════
function BatteryStatusCard() {
  const data = [
    { label: 'High',   pct: 68, color: '#22c55e' },
    { label: 'Medium', pct: 22, color: '#f59e0b' },
    { label: 'Low',    pct: 10, color: '#ef4444' },
  ];
  // Bigger donut: 90×90, radius 38
  const CX = 45, CY = 45, R = 38;
  const toRad = deg => (deg * Math.PI) / 180;
  let cursor = -90;
  const slices = data.map(d => {
    const deg   = (d.pct / 100) * 356;
    const start = cursor;
    const end   = start + deg;
    cursor      = end + 1.5;
    const large = deg > 180 ? 1 : 0;
    const x1 = CX + R * Math.cos(toRad(start));
    const y1 = CY + R * Math.sin(toRad(start));
    const x2 = CX + R * Math.cos(toRad(end));
    const y2 = CY + R * Math.sin(toRad(end));
    return { ...d, path: `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z` };
  });

  return (
    <div className="hp-stat-card hp-battery-card">
      <div className="hp-stat-accent" style={{ background: '#22c55e' }} />
      <div className="hp-battery-inner">
        {/* Bigger SVG: 90×90 (was 80×80) — pushed closer to legend */}
        <svg width={90} height={90} style={{ flexShrink: 0 }}>
          {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} opacity={0.92} />)}
          <text x={CX} y={CY + 4} textAnchor="middle" fontSize={9} fontWeight="700"
            fill="rgba(255,255,255,0.65)" fontFamily="'JetBrains Mono',monospace">BAT</text>
        </svg>
        <div className="hp-battery-legend-col">
          <div className="hp-stat-title" style={{ marginBottom: 6 }}>Battery Status</div>
          {data.map(d => (
            <div key={d.label} className="hp-battery-row">
              <span className="hp-battery-dot" style={{ background: d.color }} />
              <span className="hp-battery-lbl">{d.label}</span>
              <span className="hp-battery-pct" style={{ color: d.color }}>{d.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// RECENT ACTIVITY CARD — real device data, sorted by latest seen
// ══════════════════════════════════════════════════════════════════════
function RecentActivityCard({ devices, locations, activityData, isLive }) {
  const rows = useMemo(() => {
    return [...devices]
      .map(d => {
        const sn = d.sn ?? '';
        let lastTs = null;

        if (isLive) {
          // Live: use real-time location data
          const loc = locations?.[sn];
          lastTs = loc?.timestamp ?? loc?.time ?? loc?.locTime
            ?? d.dataRetrievalTime ?? d.last_seen ?? null;
        } else {
          // Historical: derive last seen from the last activity point on that date
          const pts = activityData?.[sn];
          if (pts?.length) {
            const last = pts[pts.length - 1];
            lastTs = last?.timestamp ?? last?.time ?? last?.locTime ?? null;
          }
        }

        const isOnline = isLive
          ? (d.status === 'online' || (lastTs && (Date.now() - new Date(lastTs).getTime()) < 30 * 60_000))
          : !!lastTs; // historical: had any activity on that date = active

        return {
          id:       sn,
          user:     d.assigned_user_name ?? d.assignedUser ?? d.name ?? '—',
          status:   isOnline ? 'online' : 'offline',
          lastSeen: lastTs,
          ts:       lastTs ? new Date(lastTs).getTime() : 0,
        };
      })
      .filter(r => r.id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 10);
  }, [devices, locations, activityData, isLive]);

  const badge = s => s === 'online'
    ? <span className="hp-badge hp-badge-active">● Active</span>
    : <span className="hp-badge hp-badge-offline">● Offline</span>;

  return (
    <div className="hp-card hp-recent-card">
      <div className="hp-card-header">
        <span className="hp-card-title">Recent Activity</span>
        <span className="hp-card-sub">{rows.length} locator{rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="hp-recent-scroll">
        <table className="hp-activity-table">
          <thead>
            <tr>
              <th>Device ID</th>
              <th>User / Label</th>
              <th style={{ width: 130 }}>Status</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '22px 0', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                  No devices loaded
                </td>
              </tr>
            ) : rows.map(row => (
              <tr key={row.id}>
                <td className="hp-act-id">{row.id}</td>
                <td className="hp-act-user">{row.user}</td>
                <td>{badge(row.status)}</td>
                <td className="hp-act-time">{fmtRelTime(row.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// TOP DEVICES — bar chart (packet count)
// ══════════════════════════════════════════════════════════════════════
function TopDevices({ devices, activityData }) {
  const [hovered, setHovered] = useState(null);
  const [dims, setDims]       = useState({ w: 300, h: 180 });
  const wrapRef               = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: Math.max(width, 100), h: Math.max(height, 60) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const ranked = useMemo(() => [...devices]
    .map(d => {
      const sn = d.sn ?? '';
      const packets = activityData[sn]?.length ?? d.packetCount ?? d.packet_count ?? 0;
      return { sn, name: d.name ?? d.assignedUser ?? sn, packets };
    })
    .filter(d => d.sn)
    .sort((a, b) => b.packets - a.packets)
    .slice(0, 5),
  [devices, activityData]);

  const maxP   = ranked[0]?.packets || 1;
  const colors = ['#fbbf24','#a3a3a3','#f97316','#60a5fa','#c084fc'];

  const PAD_L = 88, PAD_R = 48, PAD_T = 8, PAD_B = 8;
  const { w: W, h: H } = dims;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const rowH   = ranked.length > 0 ? chartH / ranked.length : 0;
  const barH   = Math.min(14, rowH * 0.45);
  const xTicks = [0.25, 0.5, 0.75, 1];

  return (
    <div className="hp-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="hp-card-header">
        <span className="hp-card-title">Top 5 by Packets</span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {ranked.length === 0 ? (
          <p className="hp-empty-msg" style={{ padding: '12px' }}>No data</p>
        ) : (
          <svg width={W} height={H} style={{ display: 'block', position: 'absolute', inset: 0 }}>
            <defs>
              {ranked.map((r, i) => (
                <linearGradient key={`hbg${i}`} id={`hbg${i}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={colors[i]} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={colors[i]} stopOpacity="1" />
                </linearGradient>
              ))}
            </defs>
            {xTicks.map((f, ti) => {
              const x = PAD_L + f * chartW;
              return <line key={ti} x1={x} x2={x} y1={PAD_T} y2={PAD_T + chartH} stroke="#dde3ec" strokeWidth={1} strokeDasharray="3 4" />;
            })}
            <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + chartH} stroke="#b8c4d4" strokeWidth={1} />
            {ranked.map((r, i) => {
              const barW  = Math.max((r.packets / maxP) * chartW, 2);
              const cy    = PAD_T + i * rowH + rowH / 2;
              const isHov = hovered === i;
              const label = (r.name !== r.sn ? r.name : r.sn).replace('CARD-', '');
              const displayLabel = label.length > 13 ? label.slice(0, 12) + '…' : label;
              return (
                <g key={r.sn} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}>
                  {isHov && <rect x={PAD_L} y={PAD_T + i * rowH} width={chartW} height={rowH} fill="rgba(153,27,27,0.06)" rx={2} />}
                  <rect x={PAD_L} y={cy - barH / 2} width={barW} height={barH} rx={4} fill={`url(#hbg${i})`} opacity={isHov ? 1 : 0.85} style={{ transition: 'opacity 0.15s' }} />
                  <text x={PAD_L - 6} y={cy + 3.5} textAnchor="end" fontSize={10} fontWeight="600" fill={isHov ? '#fca5a5' : '#8899aa'} fontFamily="'Nunito', sans-serif" style={{ transition: 'fill 0.15s' }}>
                    {displayLabel}
                  </text>
                  <text x={PAD_L + barW + 5} y={cy + 3.5} textAnchor="start" fontSize={9} fill={colors[i]} fontFamily="'JetBrains Mono',monospace" fontWeight="700">
                    {r.packets.toLocaleString()}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// TOP USERS PANEL — progress bar list, derived from devices data
// ══════════════════════════════════════════════════════════════════════
function TopUsersPanel({ devices, activityData, isLive }) {
  const topUsers = useMemo(() => {
    // Historical: only count users whose devices had activity on the selected date
    const activeDevices = isLive
      ? devices
      : devices.filter(d => (activityData?.[d.sn ?? '']?.length ?? 0) > 0);
    const map = {};
    activeDevices.forEach(d => {
      const u = d.assigned_user_name ?? d.assignedUser ?? d.client ?? null;
      if (!u) return;
      map[u] = (map[u] || 0) + 1;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = sorted[0]?.[1] || 1;
    const colors = ['#fbbf24', '#c0c0c0', '#f97316', '#60a5fa', '#c084fc'];
    return sorted.map(([user, count], i) => ({
      user, count, pct: Math.round((count / max) * 100), color: colors[i],
    }));
  }, [devices]);

  // SVG rank badge — no emoji, inline vector
  const RankBadge = ({ rank, color }) => (
    <svg width={26} height={26} viewBox="0 0 26 26" style={{ flexShrink: 0 }}>
      <circle cx={13} cy={13} r={11.5} fill={`${color}18`} stroke={color} strokeWidth={1.5} strokeOpacity={0.45} />
      {rank === 1 && (
        // Crown path for #1
        <path d="M8 17 L8 12 L10.5 14.5 L13 10 L15.5 14.5 L18 12 L18 17 Z"
          fill={color} opacity={0.9} />
      )}
      {rank === 2 && (
        // Star for #2
        <polygon points="13,8 14.2,11.5 18,11.5 15,13.7 16.2,17.2 13,15 9.8,17.2 11,13.7 8,11.5 11.8,11.5"
          fill={color} opacity={0.85} />
      )}
      {rank === 3 && (
        // Smaller star for #3
        <polygon points="13,9 13.9,11.7 16.8,11.7 14.5,13.3 15.4,16 13,14.4 10.6,16 11.5,13.3 9.2,11.7 12.1,11.7"
          fill={color} opacity={0.8} />
      )}
      {rank > 3 && (
        <text x={13} y={17.5} textAnchor="middle" fontSize={11} fontWeight="800"
          fill={color} fontFamily="'JetBrains Mono',monospace">{rank}</text>
      )}
    </svg>
  );

  return (
    <div className="hp-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="hp-card-header">
        <span className="hp-card-title">Top Users</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: "'Nunito',sans-serif" }}>
          by assigned locators
        </span>
      </div>
      <div className="hp-panel-body hp-top-users-body">
        {topUsers.length === 0 ? (
          <p className="hp-empty-msg">No assigned devices</p>
        ) : topUsers.map((u, i) => (
          <div key={u.user} className="hp-rank-row">
            <RankBadge rank={i + 1} color={u.color} />
            <div className="hp-rank-body">
              <div className="hp-rank-header">
                <span className="hp-rank-name">{u.user}</span>
                <span className="hp-rank-count" style={{ color: u.color }}>{u.count}</span>
              </div>
              <div className="hp-progress-track">
                <div className="hp-progress-fill" style={{ width: `${u.pct}%`, background: u.color }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// USER DEVICE PANEL
// ══════════════════════════════════════════════════════════════════════
function UserDevicePanel({ devices }) {
  const [hovered, setHovered] = useState(null);
  const colors = ['#4ade80','#60a5fa','#f97316','#fbbf24','#c084fc','#ec4899','#06b6d4'];
  const ini    = n => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '??';

  const { userDevices, slices } = useMemo(() => {
    const map = {};
    devices.forEach(d => {
      const u = d.assignedUser ?? d.client ?? d.name ?? 'Unassigned';
      if (!map[u]) map[u] = [];
      map[u].push({ sn: d.sn ?? '', name: d.name ?? d.assignedUser ?? d.sn ?? '' });
    });
    const userDevices = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
    const total = userDevices.reduce((s, [, devs]) => s + devs.length, 0);
    if (total === 0) return { userDevices, slices: [] };

    const CX = 85, CY = 85, R = 78, GAP = 1.2;
    const toRad = deg => (deg * Math.PI) / 180;
    let cursor = -90;
    const slices = userDevices.slice(0, 5).map(([user, devs], i) => {
      const count = devs.length;
      const deg   = (count / total) * (360 - Math.min(userDevices.length, 5) * GAP);
      const start = cursor;
      const end   = start + deg;
      cursor      = end + GAP;
      const large = deg > 180 ? 1 : 0;
      const x1 = CX + R * Math.cos(toRad(start));
      const y1 = CY + R * Math.sin(toRad(start));
      const x2 = CX + R * Math.cos(toRad(end));
      const y2 = CY + R * Math.sin(toRad(end));
      const mid = toRad(start + deg / 2);
      return {
        user, count, color: colors[i % colors.length],
        path: `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
        lx: CX + R * 0.62 * Math.cos(mid),
        ly: CY + R * 0.62 * Math.sin(mid),
        pct: Math.round((count / total) * 100),
      };
    });
    return { userDevices, slices };
  }, [devices]);

  const hovSlice = hovered !== null ? slices[hovered] : null;
  const CX = 85, CY = 85;

  return (
    <div className="hp-card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 320px', maxWidth: 500 }}>
      <div className="hp-card-header">
        <span className="hp-card-title">Users / Department &amp; Devices</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Nunito',sans-serif" }}>
          {devices.length} total
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, padding: '6px 10px 10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <svg width={170} height={170}>
            {slices.length === 0
              ? <circle cx={CX} cy={CY} r={78} fill="#1e1e28" strokeDasharray="5 4" />
              : slices.map((s, i) => (
                <path key={s.user} d={s.path}
                  fill={s.color}
                  opacity={hovered === null ? 0.9 : hovered === i ? 1 : 0.25}
                  style={{
                    cursor: 'pointer',
                    transition: 'opacity 0.15s, transform 0.15s',
                    transformOrigin: `${CX}px ${CY}px`,
                    transform: hovered === i ? 'scale(1.04)' : 'scale(1)',
                  }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            {hovSlice && (
              <text x={hovSlice.lx} y={hovSlice.ly + 4} textAnchor="middle"
                fontSize={10} fontWeight="700" fill="#ffffff"
                fontFamily="'JetBrains Mono',monospace" style={{ pointerEvents: 'none' }}>
                {hovSlice.pct}%
              </text>
            )}
          </svg>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 8px', justifyContent: 'center', maxWidth: 170 }}>
            {slices.map((s, i) => (
              <div key={s.user}
                style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  opacity: hovered === null ? 1 : hovered === i ? 1 : 0.3, transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}>
                <div style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: s.color }} />
                <span style={{ fontSize: 10, fontFamily: "'Nunito', sans-serif", color: 'var(--text)', fontWeight: 600,
                  maxWidth: 75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.user}
                </span>
                <span style={{ fontSize: 10, fontFamily: "'Nunito', sans-serif", color: s.color, fontWeight: 700 }}>
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="hp-dpu-body" style={{ flex: 1, minWidth: 0 }}>
          {userDevices.length === 0
            ? <p className="hp-empty-msg">No locators</p>
            : userDevices.map(([user, devs], i) => {
              const color = colors[i % colors.length];
              return (
                <div key={user} className="hp-dpu-row">
                  <div className="hp-dpu-user-row">
                    <div className="hp-user-avatar" style={{
                      width: 20, height: 20, fontSize: 7,
                      background: `${color}18`, color,
                      border: `1px solid ${color}30`,
                    }}>{ini(user)}</div>
                    <span className="hp-dpu-username">{user}</span>
                    <span className="hp-dpu-count" style={{ color }}>{devs.length}</span>
                  </div>
                  <div className="hp-dpu-chips">
                    {devs.map(dev => {
                      const displayName = (dev.name && dev.name !== dev.sn)
                        ? dev.name
                        : dev.sn.replace('CARD-', '');
                      return (
                        <span key={dev.sn} className="hp-dpu-chip"
                          style={{ borderColor: `${color}35`, color: 'var(--text-muted)' }}>
                          {displayName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// BOUND DEVICES CHART
// ══════════════════════════════════════════════════════════════════════
function BoundDevicesChart({ devices, selectedDate }) {
  const [hovered, setHovered]         = useState(null);
  const [dims, setDims]               = useState({ w: 400, h: 140 });
  const [tooltipRect, setTooltipRect] = useState(null);
  const wrapRef = useRef(null);
  const svgRef  = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: Math.max(width, 100), h: Math.max(height, 80) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const { getMergedBindings } = useBindCache();

  const { months, total } = useMemo(() => {
    const now = selectedDate ? new Date(selectedDate + 'T23:59:59') : new Date();
    const months = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count: 0,
      });
    }
    const map = Object.fromEntries(months.map(m => [m.key, m]));
    const allBindings = getMergedBindings(devices);
    allBindings.forEach(bindTime => {
      const dt = new Date(bindTime);
      if (isNaN(dt) || dt > now) return;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (map[key]) map[key].count++;
    });
    const total = months.reduce((s, m) => s + m.count, 0);
    return { months, total };
  }, [devices, selectedDate, getMergedBindings]);

  const { w: W, h: H } = dims;
  const PAD = { top: 12, right: 18, bottom: 28, left: 30 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxCount = Math.max(...months.map(m => m.count), 1);
  const selectedKey = selectedDate ? selectedDate.slice(0, 7) : new Date().toISOString().slice(0, 7);

  const pts = months.map((m, i) => ({
    ...m,
    x: PAD.left + (i / (months.length - 1)) * innerW,
    y: PAD.top + innerH - (m.count / maxCount) * innerH,
  }));

  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
  const area = [
    `${pts[0].x},${PAD.top + innerH}`,
    ...pts.map(p => `${p.x},${p.y}`),
    `${pts[pts.length - 1].x},${PAD.top + innerH}`,
  ].join(' ');

  const handlePointEnter = useCallback((p) => {
    setHovered(p.key);
    setTooltipRect({ x: p.x, y: p.y, label: p.label, count: p.count, key: p.key });
  }, []);

  return (
    <div className="hp-card hp-donut-bare">
      <div className="hp-card-header">
        <span className="hp-card-title">Bound Devices / Month</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Nunito', sans-serif", fontWeight: 600 }}>
          {total} bound
        </span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, position: 'relative', minHeight: 100, overflow: 'visible' }}>
        {total === 0 ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Nunito', sans-serif" }}>No bind dates found</span>
          </div>
        ) : (
          <>
            <svg ref={svgRef} width={W} height={H} style={{ display: 'block', position: 'absolute', inset: 0, overflow: 'visible' }}>
              <defs>
                <linearGradient id="bound-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(153,27,27,0.30)" />
                  <stop offset="100%" stopColor="rgba(153,27,27,0.02)" />
                </linearGradient>
              </defs>
              <polygon points={area} fill="url(#bound-area-grad)" />
              <polyline points={polyline} fill="none" stroke="#991b1b" strokeWidth={2} strokeLinejoin="round" />
              {[...new Set([0, 0.5, 1].map(f => Math.round(f * maxCount)))].map(val => {
                const frac = maxCount > 0 ? val / maxCount : 0;
                const y = PAD.top + innerH - frac * innerH;
                return (
                  <g key={val}>
                    <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="3 3" />
                    <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.45)" fontFamily="'JetBrains Mono',monospace">
                      {val}
                    </text>
                  </g>
                );
              })}
              {pts.map((p, idx) => {
                const isSelected = p.key === selectedKey;
                const isHov      = hovered === p.key;
                return (
                  <g key={p.key}
                    onMouseEnter={() => handlePointEnter(p)}
                    onMouseLeave={() => { setHovered(null); setTooltipRect(null); }}
                    style={{ cursor: 'pointer' }}>
                    <rect x={p.x - 14} y={PAD.top} width={28} height={innerH + PAD.bottom} fill="transparent" />
                    <circle cx={p.x} cy={p.y} r={isHov ? 6 : isSelected ? 5 : 4}
                      fill={isSelected ? '#f59e0b' : '#991b1b'}
                      stroke={isHov ? '#fff' : 'none'} strokeWidth={1.5}
                      style={{ transition: 'r 0.1s' }} />
                    {(idx % 2 === 0 || isSelected) && (
                      <text x={p.x} y={H - 4} textAnchor="middle" fontSize={8}
                        fill={isSelected ? '#f59e0b' : '#64748b'} fontFamily="'JetBrains Mono',monospace">
                        {p.label.split(' ')[0]}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {tooltipRect && (
              <div style={{
                position: 'absolute',
                left: Math.min(Math.max(tooltipRect.x - 30, 2), W - PAD.right - 62),
                top: tooltipRect.y > PAD.top + 50 ? tooltipRect.y - 52 : tooltipRect.y + 14,
                pointerEvents: 'none', zIndex: 9999,
                background: '#1a2535', border: '1px solid #2e3a4e', borderRadius: 6,
                padding: '4px 8px', minWidth: 60, textAlign: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              }}>
                <div style={{ fontSize: 8, color: '#94a3b8', fontFamily: "'JetBrains Mono',monospace" }}>{tooltipRect.label}</div>
                <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{tooltipRect.count}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// REGION BREACH PANEL
// ══════════════════════════════════════════════════════════════════════
function RegionBreachPanel({ breaches, totalWithRegion }) {
  const fmtTs = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return isNaN(d) ? '—' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return '—'; }
  };
  return (
    <div className="hp-card" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div className="hp-card-header">
        <span className="hp-card-title">Region Breaches</span>
        <span style={{ fontSize: 10, fontFamily: "'Nunito',sans-serif", fontWeight: 700, color: breaches.length > 0 ? '#f97316' : '#4ade80' }}>
          {breaches.length > 0 ? `${breaches.length} out` : totalWithRegion > 0 ? '✓ all in' : 'no regions'}
        </span>
      </div>
      {totalWithRegion === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 12px', margin: 0 }}>
          Assign regions to devices to enable breach detection.
        </p>
      ) : breaches.length === 0 ? (
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#4ade80' }}>All {totalWithRegion} tracked locator{totalWithRegion !== 1 ? 's' : ''} in region</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflowY: 'auto' }}>
          {breaches.map((b) => (
            <div key={b.sn} style={{ padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f97316', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name !== b.sn ? b.name : b.sn}
                  </span>
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: "'Nunito',sans-serif", flexShrink: 0 }}>
                  {fmtTs(b.ts)}
                </span>
              </div>
              <div style={{ paddingLeft: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                {b.name !== b.sn && <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: "'Nunito',sans-serif" }}>{b.sn}</span>}
                <span style={{ fontSize: 10, color: '#f97316', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 4, padding: '1px 5px' }}>
                  outside {b.region}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ACTIVITY CHART — FIX 2: unified maroon in gradients
// ══════════════════════════════════════════════════════════════════════
function ActivityChart({ activityData, devices, selectedDate, isLive, mode, onModeChange, loading, lastSync }) {
  const [hovered, setHovered] = useState(null);
  const [dims, setDims]       = useState({ w: 600, h: 240 });
  const wrapRef               = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: Math.max(width, 100), h: Math.max(height, 60) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const maxHour = isLive ? new Date().getHours() : 23;
  const hours   = Array.from({ length: maxHour + 1 }, (_, i) => i);
  const fmtHour = h => String(h).padStart(2, '0');
  const fmtVal  = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

  const deviceList = useMemo(() =>
    devices.filter(d => d.sn).map((d, i) => ({
      sn: d.sn, name: d.name ?? d.assignedUser ?? d.sn,
      color: CHART_COLORS[i % CHART_COLORS.length],
    })), [devices]);

  const { generalBins, deviceBins } = useMemo(() => {
    const devHour = {};
    deviceList.forEach(({ sn }) => {
      devHour[sn] = {};
      (activityData[sn] ?? []).forEach(pt => {
        const ts = pt.timestamp ?? pt.time ?? pt.locTime;
        if (!ts) return;
        const d = new Date(ts);
        if (isNaN(d)) return;
        const h = d.getHours();
        devHour[sn][h] = (devHour[sn][h] || 0) + 1;
      });
    });
    const generalBins = hours.map(h => ({
      hour: h,
      count: Object.values(devHour).reduce((s, hc) => s + (hc[h] ?? 0), 0),
    }));
    const deviceBins = hours.map(h => {
      let cum = 0;
      const segments = deviceList.map(({ sn, color }) => {
        const count = devHour[sn]?.[h] ?? 0;
        const seg   = { sn, color, count, yBottom: cum };
        cum += count;
        return seg;
      });
      return { hour: h, total: cum, segments };
    });
    return { generalBins, deviceBins };
  }, [activityData, deviceList, hours]);

  const maxVal = mode === 'device'
    ? Math.max(...deviceBins.map(b => b.total), 0)
    : Math.max(...generalBins.map(b => b.count), 0);
  const ticks    = niceScale(maxVal || 10);
  const tickMax  = ticks[ticks.length - 1];
  const totalPts = generalBins.reduce((s, b) => s + b.count, 0);
  const hasData  = Object.keys(activityData).length > 0;
  const peakBin  = hasData ? generalBins.reduce((best, b) => b.count > best.count ? b : best, generalBins[0]) : null;
  const syncStr  = lastSync ? lastSync.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

  const PAD_L = 40, PAD_R = 14, PAD_T = 12, PAD_B = 22;
  const { w: W, h: H } = dims;
  const chartW    = W - PAD_L - PAD_R;
  const chartH    = H - PAD_T - PAD_B;
  const barGroupW = chartW / Math.max(hours.length, 1);
  const barW      = Math.max(barGroupW * 0.5, 2);

  return (
    <div className="hp-activity-card">
      <div className="hp-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="hp-card-title">Locator Activity — {selectedDate}</span>
          {loading && <span className="hp-spinner-inline" />}
          {!loading && hasData && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Nunito',sans-serif" }}>
              {totalPts.toLocaleString()} pts · {Object.keys(activityData).length} dev
              {peakBin?.count > 0 && (
                <span style={{ color: '#f59e0b', marginLeft: 6 }}>▲ peak {fmtHour(peakBin.hour)}:00</span>
              )}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button className={`hp-mode-btn${mode === 'general' ? ' active' : ''}`} onClick={() => onModeChange('general')}>Overview</button>
          <button className={`hp-mode-btn${mode === 'device'  ? ' active' : ''}`} onClick={() => onModeChange('device')}>Per Device</button>
          <button className={`hp-mode-btn${mode === 'trend'   ? ' active' : ''}`} onClick={() => onModeChange('trend')}>Trend</button>
        </div>
      </div>

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && !hasData ? (
          <div className="hp-chart-empty">
            <span className="hp-spinner-inline" />
            Fetching {devices.length} devices for {selectedDate}…
          </div>
        ) : !hasData ? (
          <div className="hp-chart-empty">No data for {selectedDate}</div>
        ) : (
          <svg width={W} height={H} style={{ display: 'block', position: 'absolute', inset: 0, overflow: 'visible' }}>
            <defs>
              {/* FIX 2: unified maroon #991b1b in both gradients */}
              <linearGradient id="bar-grad-default" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b91c1c" />
                <stop offset="100%" stopColor="#991b1b" />
              </linearGradient>
              <linearGradient id="bar-grad-hover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dc2626" />
                <stop offset="100%" stopColor="#b91c1c" />
              </linearGradient>
              <linearGradient id="trend-area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(185,28,28,0.35)" />
                <stop offset="100%" stopColor="rgba(185,28,28,0)" />
              </linearGradient>
            </defs>

            {ticks.map(tick => {
              const y = PAD_T + chartH * (1 - (tickMax > 0 ? tick / tickMax : 0));
              return (
                <g key={`t-${tick}`}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#dde3ec" strokeWidth={1} strokeDasharray="3 4" />
                  <text x={PAD_L - 5} y={y + 3.5} textAnchor="end" fontSize={9} fill="#374151" fontFamily="'JetBrains Mono',monospace">{fmtVal(tick)}</text>
                </g>
              );
            })}
            <line x1={PAD_L} x2={PAD_L}     y1={PAD_T} y2={PAD_T + chartH} stroke="#b8c4d4" strokeWidth={1} />
            <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH} stroke="#b8c4d4" strokeWidth={1} />

            {/* TREND MODE */}
            {mode === 'trend' && (() => {
              const linePoints = hours.map((h, i) => {
                const count = generalBins[i]?.count ?? 0;
                const lh    = tickMax > 0 && count > 0 ? (count / tickMax) * chartH : 0;
                return { x: PAD_L + i * barGroupW + barGroupW / 2, y: PAD_T + chartH - lh, h, count };
              });
              const baseline = PAD_T + chartH;
              const areaD = linePoints.length > 1
                ? `M ${linePoints[0].x} ${baseline} L ${linePoints[0].x} ${linePoints[0].y} ${linePoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')} L ${linePoints[linePoints.length - 1].x} ${baseline} Z`
                : '';
              const polyPts = linePoints.map(p => `${p.x},${p.y}`).join(' ');
              return (
                <g>
                  {areaD  && <path d={areaD} fill="url(#trend-area-grad)" />}
                  {polyPts && <polyline points={polyPts} fill="none" stroke="#991b1b" strokeWidth={2} strokeLinejoin="round" />}
                  {linePoints.map((p) => {
                    const isHov  = hovered === p.h;
                    const isPeak = peakBin?.hour === p.h && p.count > 0;
                    const showLbl = p.h % 2 === 0;
                    return (
                      <g key={p.h} style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHovered(p.h)}
                        onMouseLeave={() => setHovered(null)}>
                        <rect x={p.x - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH + PAD_B} fill="transparent" />
                        {isHov && <line x1={p.x} x2={p.x} y1={PAD_T} y2={PAD_T + chartH} stroke="#c0c8d8" strokeWidth={1} strokeDasharray="3 3" />}
                        <circle cx={p.x} cy={p.y} r={isHov || isPeak ? 5 : 3}
                          fill={isPeak ? '#f59e0b' : isHov ? '#dc2626' : '#991b1b'}
                          stroke={isHov ? '#e8eaf0' : 'none'} strokeWidth={1.5}
                          style={{ transition: 'r 0.12s, fill 0.12s' }} />
                        {showLbl && (
                          <text x={p.x} y={H - 5} textAnchor="middle" fontSize={8} fill={isHov ? '#fca5a5' : '#374151'} fontFamily="'JetBrains Mono',monospace">
                            {fmtHour(p.h)}
                          </text>
                        )}
                        {isHov && p.count > 0 && (() => {
                          const tipW = 96, tipH = 38;
                          const tipX = Math.max(PAD_L, Math.min(p.x - tipW / 2, W - PAD_R - tipW));
                          const tipY = Math.max(PAD_T + 2, p.y - tipH - 10);
                          return (
                            <g style={{ pointerEvents: 'none' }}>
                              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="rgba(7,8,10,0.97)" stroke="#2e3040" strokeWidth={1} />
                              <text x={tipX + tipW/2} y={tipY + 13} textAnchor="middle" fontSize={9} fill="#9ca3af" fontFamily="'JetBrains Mono',monospace">
                                {fmtHour(p.h)}:00 PKT
                              </text>
                              <text x={tipX + tipW/2} y={tipY + 29} textAnchor="middle" fontSize={12} fontWeight="700" fill="#b91c1c" fontFamily="'JetBrains Mono',monospace">
                                {p.count.toLocaleString()} pts
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    );
                  })}
                </g>
              );
            })()}

            {/* BAR MODES */}
            {mode !== 'trend' && hours.map((h, i) => {
              const groupX  = PAD_L + i * barGroupW + barGroupW / 2;
              const isHov   = hovered === h;
              const isPeak  = peakBin?.hour === h && (peakBin?.count ?? 0) > 0;
              const showLbl = h % 2 === 0;

              if (mode === 'general') {
                const count = generalBins[i]?.count ?? 0;
                const barH  = tickMax > 0 && count > 0 ? Math.max((count / tickMax) * chartH, 2) : 0;
                const fill  = isPeak ? '#f59e0b' : isHov ? 'url(#bar-grad-hover)' : 'url(#bar-grad-default)';
                return (
                  <g key={h} style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHovered(h)} onMouseLeave={() => setHovered(null)}>
                    {isHov && <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH} fill="rgba(153,27,27,0.06)" />}
                    <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH + PAD_B} fill="transparent" />
                    <rect x={groupX - barW / 2} y={PAD_T + chartH - barH} width={barW} height={barH} rx={3} fill={fill} opacity={isHov || isPeak ? 1 : 0.82} style={{ transition: 'opacity 0.12s' }} />
                    {showLbl && (
                      <text x={groupX} y={H - 5} textAnchor="middle" fontSize={8} fill={isHov ? '#fca5a5' : '#374151'} fontFamily="'JetBrains Mono',monospace">
                        {fmtHour(h)}
                      </text>
                    )}
                    {isHov && (() => {
                      const tipW = 96, tipH = 38;
                      const tipX = Math.max(PAD_L, Math.min(groupX - tipW / 2, W - PAD_R - tipW));
                      const tipY = Math.max(PAD_T + 2, PAD_T + chartH - barH - tipH - 6);
                      return (
                        <g style={{ pointerEvents: 'none' }}>
                          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="rgba(7,8,10,0.97)" stroke="#2e3040" strokeWidth={1} />
                          <text x={tipX + tipW/2} y={tipY + 13} textAnchor="middle" fontSize={9} fill="#9ca3af" fontFamily="'JetBrains Mono',monospace">
                            {fmtHour(h)}:00 PKT
                          </text>
                          <text x={tipX + tipW/2} y={tipY + 29} textAnchor="middle" fontSize={12} fontWeight="700" fill="#b91c1c" fontFamily="'JetBrains Mono',monospace">
                            {count.toLocaleString()} pts
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                );
              }

              const bin       = deviceBins[i];
              const topH      = tickMax > 0 && bin.total > 0 ? (bin.total / tickMax) * chartH : 0;
              const topSegIdx = bin.segments.map((s, si) => s.count > 0 ? si : -1).filter(si => si >= 0).pop() ?? -1;
              return (
                <g key={h} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(h)} onMouseLeave={() => setHovered(null)}>
                  {isHov && <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH} fill="rgba(255,255,255,0.03)" />}
                  <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH + PAD_B} fill="transparent" />
                  {bin.segments.map((seg, si) => {
                    if (!seg.count) return null;
                    const segH  = (seg.count   / tickMax) * chartH;
                    const botH  = (seg.yBottom / tickMax) * chartH;
                    const isTop = si === topSegIdx;
                    return (
                      <rect key={seg.sn}
                        x={groupX - barW / 2} y={PAD_T + chartH - botH - segH}
                        width={barW} height={Math.max(segH, 1)}
                        rx={isTop ? 3 : 0}
                        fill={seg.color} opacity={isHov ? 1 : 0.7}
                        style={{ transition: 'opacity 0.12s' }} />
                    );
                  })}
                  {showLbl && (
                    <text x={groupX} y={H - 5} textAnchor="middle" fontSize={8} fill={isHov ? '#e8eaf0' : '#374151'} fontFamily="'JetBrains Mono',monospace">
                      {fmtHour(h)}
                    </text>
                  )}
                  {isHov && bin.total > 0 && (() => {
                    const activeSegs = bin.segments.filter(s => s.count > 0);
                    const tipW = 156, tipH = 22 + activeSegs.length * 14;
                    const tipX = Math.max(PAD_L, Math.min(groupX - tipW / 2, W - PAD_R - tipW));
                    const tipY = Math.max(PAD_T + 2, PAD_T + chartH - topH - tipH - 6);
                    return (
                      <g style={{ pointerEvents: 'none' }}>
                        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6} fill="rgba(7,8,10,0.97)" stroke="#2e3040" strokeWidth={1} />
                        <text x={tipX + tipW/2} y={tipY + 14} textAnchor="middle" fontSize={9} fill="#9ca3af" fontFamily="'JetBrains Mono',monospace">
                          {fmtHour(h)}:00 PKT — {bin.total.toLocaleString()} total
                        </text>
                        {activeSegs.map((seg, si) => {
                          const nm = (devices.find(d => d.sn === seg.sn)?.name ?? seg.sn).replace('CARD-','');
                          return (
                            <g key={seg.sn}>
                              <rect x={tipX+8}  y={tipY+19+si*14} width={7} height={7} rx={2} fill={seg.color} />
                              <text x={tipX+20} y={tipY+27+si*14} fontSize={9} fill="#ffffff" fontFamily="'JetBrains Mono',monospace">
                                {nm}: {seg.count}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}
                </g>
              );
            })}
            <text x={PAD_L + chartW / 2} y={H} textAnchor="middle" fontSize={8} fill="#374151" fontFamily="'JetBrains Mono',monospace">
              Hour (PKT)
            </text>
          </svg>
        )}
        {loading && hasData && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
            justifyContent:'center', background:'rgba(8,8,12,0.7)', borderRadius:8, zIndex:5 }}>
            <span className="hp-spinner-inline" style={{ width:18, height:18 }} />
          </div>
        )}
      </div>

      {mode === 'device' && deviceList.length > 0 && (
        <div className="hp-chart-legend">
          {deviceList.map(d => (
            <span key={d.sn} className="hp-chart-legend-item">
              <span style={{ width: 7, height: 7, borderRadius: 2, background: d.color, display: 'inline-block', flexShrink: 0 }} />
              {(d.name !== d.sn ? d.name : d.sn).replace('CARD-', '')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════
export default function HomePage() {
  const { getDevices, getLatestLocation, getPlayback } = useCityTag();
  const navigate = useNavigate();
  const { updateFromDevices, countBindsInWindow, getDevicesBoundBy } = useBindCache();

  const [filters, setFilters]           = useState({ region: 'all', area: 'all', areaId: null, date: todayStr() });
  const [devices, setDevices]           = useState([]);
  const [devLoading, setDevLoading]     = useState(true);
  const [locations, setLocations]       = useState({});
  const [locSync, setLocSync]           = useState(null);
  const [activityData, setActivityData] = useState({});
  const [chartLoading, setChartLoading] = useState(false);
  const [chartMode, setChartMode]       = useState('general');
  const [kmlAreas, setKmlAreas]         = useState([]);

  const isLive          = filters.date === todayStr();
  const locAbortRef     = useRef(null);
  const trajAbortRef    = useRef(null);
  const activitySyncRef = useRef(null);

  useEffect(() => {
    fetch('/areas.kml')
      .then(r => r.text())
      .then(text => setKmlAreas(parseKMLText(text)))
      .catch(() => {});
  }, []);

  const regionBreaches = useMemo(() => {
    if (!kmlAreas.length) return [];
    return devices
      .filter(d => d.region)
      .map(d => {
        const area = kmlAreas.find(a => a.name.toLowerCase() === d.region.toLowerCase());
        if (!area) return null;
        const loc = locations[d.sn];
        if (!loc) return null;
        const lat = Number(loc.lat ?? loc.latitude ?? loc.gpsLat ?? loc.wgLat);
        const lng = Number(loc.lng ?? loc.lon ?? loc.longitude ?? loc.gpsLng ?? loc.wgLng);
        if (isNaN(lat) || isNaN(lng)) return null;
        if (pointInArea([lat, lng], area.coords)) return null;
        return { sn: d.sn, name: d.name ?? d.assignedUser ?? d.sn, region: d.region, ts: loc.timestamp ?? loc.time ?? loc.locTime ?? null };
      })
      .filter(Boolean);
  }, [devices, locations, kmlAreas]);

  useEffect(() => {
    let cancelled = false;
    setDevLoading(true);
    getDevices()
      .then(res => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.devices ?? []);
        setDevices(list);
        updateFromDevices(list); // persist bindTimes to cache context + localStorage
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDevLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLocations = useCallback(async () => {
    if (!devices.length) return;
    locAbortRef.current?.abort();
    const ctrl = new AbortController();
    locAbortRef.current = ctrl;
    const tasks = devices.map(d => {
      const sn = d.sn ?? d.serialNumber ?? '';
      if (!sn) return Promise.resolve(null);
      return getLatestLocation(sn)
        .then(res => ({ sn, point: res?.latest ?? res ?? null }))
        .catch(() => null);
    });
    const settled = await Promise.allSettled(tasks);
    if (ctrl.signal.aborted) return;
    const results = settled.map(r => r.status === 'fulfilled' ? r.value : null);
    setLocations(prev => {
      const next = { ...prev };
      results.forEach(r => { if (r) next[r.sn] = r.point; });
      return next;
    });
    setLocSync(new Date());
  }, [devices, getLatestLocation]);

  useEffect(() => { fetchLocations(); }, [fetchLocations]);
  useEffect(() => {
    if (!isLive || !devices.length) return;
    const id = setInterval(fetchLocations, LOCATION_POLL_MS);
    return () => clearInterval(id);
  }, [isLive, devices.length, fetchLocations]);

  const fetchActivity = useCallback(async (dateStr, live, incremental = false) => {
    if (!devices.length) return;
    trajAbortRef.current?.abort();
    const ctrl = new AbortController();
    trajAbortRef.current = ctrl;
    const useIncremental = incremental && live && !!activitySyncRef.current;
    const { start: dayStart, end: dayEnd } = dayRange(dateStr, live);
    const start   = useIncremental ? new Date(activitySyncRef.current) : dayStart;
    const end     = live ? new Date(Date.now() + 2 * 3600 * 1000) : dayEnd;
    const snapNow = new Date().toISOString();
    if (!useIncremental) { setChartLoading(true); setActivityData({}); }
    const fetch1 = (sn) => getPlayback(sn, start, end)
      .then(res => ({ sn, pts: Array.isArray(res?.points) ? res.points : Array.isArray(res) ? res : [] }))
      .catch(() => null);
    let results;
    if (useIncremental) {
      const settled = await Promise.allSettled(devices.map(d => fetch1(d.sn ?? '')));
      results = settled.map(r => r.status === 'fulfilled' ? r.value : null);
    } else {
      results = await pLimit(devices.map(d => () => fetch1(d.sn ?? '')), FETCH_CONCURRENCY);
    }
    if (ctrl.signal.aborted) return;
    activitySyncRef.current = snapNow;
    if (useIncremental) {
      setActivityData(prev => {
        const next = { ...prev };
        results.forEach(r => { if (r?.pts?.length) next[r.sn] = [...(prev[r.sn] ?? []), ...r.pts]; });
        return next;
      });
    } else {
      const map = {};
      results.forEach(r => { if (r?.pts?.length) map[r.sn] = r.pts; });
      setActivityData(map);
      setChartLoading(false);
    }
  }, [devices, getPlayback]);

  useEffect(() => {
    if (!devices.length) return;
    activitySyncRef.current = null;
    fetchActivity(filters.date, isLive, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.date, filters.region, filters.area, devices.length]);

  useEffect(() => {
    if (!isLive || !devices.length) return;
    const id = setInterval(() => fetchActivity(filters.date, true, true), TRAJECTORY_POLL_MS);
    return () => clearInterval(id);
  }, [isLive, filters.date, devices.length, fetchActivity]);

  const filteredDevices = useMemo(() => {
    if (filters.region === 'all') return devices;
    const entry = KML_REGIONS.find(r => r.value === filters.region);
    if (!entry) return devices;
    const areaSet = new Set(entry.areas.map(a => a.toLowerCase()));
    return devices.filter(d => areaSet.has((d.region ?? '').toLowerCase()));
  }, [devices, filters.region]);

  // ── selectedDateTime — end of the selected date (used for all date math) ──
  const selectedDateTime = useMemo(
    () => new Date(filters.date + 'T23:59:59'),
    [filters.date]
  );

  // ── dateFilteredDevices ────────────────────────────────────────────────────
  // Historical: only devices that were bound on or before the selected date.
  // Live: all region-filtered devices (no date restriction).
  const dateFilteredDevices = useMemo(() => {
    if (isLive) return filteredDevices;
    return getDevicesBoundBy(filteredDevices, selectedDateTime);
  }, [isLive, filteredDevices, selectedDateTime, getDevicesBoundBy]);

  // ── Activity filtered to dateFilteredDevices ───────────────────────────────
  const filteredActivityData = useMemo(() => {
    const snSet = new Set(dateFilteredDevices.map(d => d.sn ?? ''));
    return Object.fromEntries(
      Object.entries(activityData).filter(([sn]) => snSet.has(sn))
    );
  }, [activityData, dateFilteredDevices]);

  // ── Stat card values — all scoped to selectedDate ─────────────────────────
  const totalDevices = dateFilteredDevices.length;

  const activeNow = useMemo(() => {
    if (isLive) {
      return dateFilteredDevices.filter(d => {
        if (d.status === 'online') return true;
        const ts = locations[d.sn ?? '']?.timestamp ?? locations[d.sn ?? '']?.time;
        return ts && (Date.now() - new Date(ts).getTime()) < 30 * 60_000;
      }).length;
    }
    // Historical: a device is "active" if it sent any data on the selected date
    return dateFilteredDevices.filter(
      d => (filteredActivityData[d.sn ?? '']?.length ?? 0) > 0
    ).length;
  }, [isLive, dateFilteredDevices, locations, filteredActivityData]);

  const offlineCount = totalDevices - activeNow;

  // ── Weekly binds — 7-day window ending on selectedDate ────────────────────
  const weeklyBinds = useMemo(() => {
    const to   = selectedDateTime;
    const from = new Date(to.getTime() - 7 * 24 * 3600_000);
    return countBindsInWindow(filteredDevices, from, to);
  }, [filteredDevices, selectedDateTime, countBindsInWindow]);

  return (
    <div className="hp-page">

      {/* Header */}
      <div className="hp-top-row">
        <div className="hp-header-left">
          <h1 className="hp-heading-title">TPL TRAKKER — Locator Dashboard</h1>
        </div>
        <div className="hp-top-right">
          <LiveClock
            isHistorical={!isLive}
            selectedDate={filters.date}
            onDateChange={date => setFilters(f => ({ ...f, date }))}
          />
          {isLive && (
            <>
              <button className="hp-refresh-btn" onClick={fetchLocations}>
                <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
                </svg>
                Locations
              </button>
              <button className="hp-refresh-btn" onClick={() => { activitySyncRef.current = null; fetchActivity(filters.date, true, false); }}>
                <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
                </svg>
                Chart
              </button>
            </>
          )}
          <button className="btn-fieldstaff" onClick={() => navigate('/field-staff-dashboard')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Field Staff
          </button>
        </div>
      </div>

      {/* Section 1: 4 stat cards */}
      <div className="hp-stats-row">
        <StatCard
          title="Total Devices" value={totalDevices} loading={devLoading}
          accentColor="#3b82f6"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>}
          iconBg="rgba(59,130,246,0.12)" iconColor="#3b82f6"
          rate={weeklyBinds}
          progress={null}
        />
        <StatCard
          title="Active Locators" value={activeNow} loading={devLoading}
          accentColor="#16a34a"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
          iconBg="rgba(22,163,74,0.12)" iconColor="#16a34a"
          progress={totalDevices > 0 ? (activeNow / totalDevices) * 100 : 0}
          subtitle={!isLive ? `on ${filters.date}` : null}
        />
        <StatCard
          title="Offline / Absent" value={offlineCount} loading={devLoading}
          accentColor="#dc2626"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>}
          iconBg="rgba(220,38,38,0.12)" iconColor="#dc2626"
          progress={totalDevices > 0 ? (offlineCount / totalDevices) * 100 : 0}
          subtitle={!isLive ? `on ${filters.date}` : null}
        />
        <BatteryStatusCard />
      </div>

      {/* Section 2: Users panel + Activity chart */}
      <div className="hp-charts-row">
        <UserDevicePanel devices={dateFilteredDevices} />
        <div className="hp-chart-wide">
          <ActivityChart
            activityData={filteredActivityData}
            devices={dateFilteredDevices}
            selectedDate={filters.date}
            isLive={isLive}
            mode={chartMode}
            onModeChange={setChartMode}
            loading={chartLoading}
            lastSync={locSync}
          />
        </div>
      </div>

      {/* Section 3: Recent Activity — date-scoped */}
      <RecentActivityCard
        devices={dateFilteredDevices}
        locations={locations}
        activityData={filteredActivityData}
        isLive={isLive}
      />

      {/* Section 4: Top Users | Bound Devices */}
      <div className="hp-charts-row hp-charts-row--bottom hp-section4">
        <TopUsersPanel
          devices={dateFilteredDevices}
          activityData={filteredActivityData}
          isLive={isLive}
        />
        <BoundDevicesChart devices={filteredDevices} selectedDate={filters.date} />
      </div>

    </div>
  );
}