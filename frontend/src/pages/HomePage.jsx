import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './HomePage.css';
import { useCityTag } from '../hooks/useCityTag.js';
import { parseKMLText, pointInArea } from '../utils/geofenceUtils.js';

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════════════

const LOCATION_POLL_MS   = 8_000;    // fast live refresh
const TRAJECTORY_POLL_MS = 20_000;   // incremental chart refresh (fast — only fetches delta)
const FETCH_CONCURRENCY  = 10;       // increased from 5

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
  // ── Lahore Division — individual towns ──────────────────────────────
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
  // ── Sheikhupura District ─────────────────────────────────────────────
  { label: 'Sheikhupura District',       value: 'sheikhupura',     areas: ['Sheikhupura','Ferozewala','Kot Abdul Malik','Muridke','Narang','Khanqah Dogran','Safdarabad','Sharaqpur','Farooqabad','Mananwala','Sheikhupura Tehsil','Sharaqpura Tehsil'] },
  // ── Nankana District ─────────────────────────────────────────────────
  { label: 'Nankana District',           value: 'nankana',         areas: ['Nankana Sahib','Warburton','Sangla Hill','Shah Kot','Nankana Sahib Tehsil'] },
  // ── Kasur District ───────────────────────────────────────────────────
  { label: 'Kasur District',             value: 'kasur',           areas: ['Pattoki Tehsil','Chunian Tehsil','Kasur Tehsil','Kasur'] },
  // ── Bahawalpur District ──────────────────────────────────────────────
  { label: 'Bahawalpur District',        value: 'bahawalpur',      areas: ['Bahawalpur Tehsil','Liaquatpur Tehsil','Bahawalpur'] },
];

const CHART_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#6366f1','#f43f5e',
];

// ══════════════════════════════════════════════════════════════════════
// HEADER COMPONENTS
// ══════════════════════════════════════════════════════════════════════

function LiveClock({ isHistorical, selectedDate }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div className="hp-heading-row">
      <div>
        <h1 className="hp-heading-title">Dashboard</h1>
        <p className="hp-heading-sub">
          {isHistorical
            ? `Historical — ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : 'Live monitoring'}
        </p>
      </div>
      <div className="hp-clock">
        <span className="hp-clock-time">{timeStr}</span>
        <span className="hp-clock-date">{dateStr}</span>
      </div>
    </div>
  );
}

function FilterBar({ filters, onChange }) {
  const isHistorical = filters.date !== todayStr();
  return (
    <div className="hp-filter-bar">
      <div className="hp-filter-group">
        <label className="hp-filter-label">Region</label>
        <select className="hp-filter-select" value={filters.region}
          onChange={e => onChange({ ...filters, region: e.target.value, area: 'all' })}>
          <option value="all">All Regions</option>
          {KML_REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div className="hp-filter-group">
        <label className="hp-filter-label">
          Date {isHistorical && <span className="hp-filter-hist-badge">Historical</span>}
        </label>
        <input type="date" className="hp-filter-select hp-filter-date"
          value={filters.date} max={todayStr()}
          onClick={e => { try { e.target.showPicker(); } catch {} }}
          onChange={e => onChange({ ...filters, date: e.target.value })} />
      </div>
      {isHistorical && (
        <button className="hp-filter-live-btn" onClick={() => onChange({ ...filters, date: todayStr() })}>
          ● Back to Live
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// STAT CARD — compact, left accent bar, stacked in a column
// ══════════════════════════════════════════════════════════════════════
function StatCard({ title, value, icon, iconBg, iconColor, accentColor, loading, rate }) {
  return (
    <div className="hp-stat-card">
      <div className="hp-stat-accent" style={{ background: accentColor }} />
      <div className="hp-stat-inner">
        <div>
          <div className="hp-stat-title">{title}</div>
          {loading
            ? <div className="hp-stat-shimmer" />
            : <div className="hp-stat-val" style={{ color: accentColor }}>{value}</div>
          }
          {!loading && rate != null && (
            <div style={{
              fontSize: 9, fontFamily: "'JetBrains Mono',monospace",
              color: rate > 0 ? '#4ade80' : 'var(--text-dim)',
              marginTop: 3, display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <span style={{ fontSize: 8 }}>{rate > 0 ? '▲' : '—'}</span>
              {rate > 0 ? `+${rate} this week` : '0 this week'}
            </div>
          )}
        </div>
        <div className="hp-stat-icon" style={{ background: iconBg, color: iconColor }}>{icon}</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// TOP BAND PANELS
// ══════════════════════════════════════════════════════════════════════

// Top Devices — packet count = activityData[sn].length (real playback points from /playback API)
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

  const PAD_L = 88, PAD_R = 36, PAD_T = 8, PAD_B = 8;
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

            {/* Vertical grid lines */}
            {xTicks.map((f, ti) => {
              const x = PAD_L + f * chartW;
              return (
                <line key={ti} x1={x} x2={x} y1={PAD_T} y2={PAD_T + chartH}
                  stroke="#1f2028" strokeWidth={1} strokeDasharray="3 4" />
              );
            })}
            <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + chartH} stroke="#2e3040" strokeWidth={1} />

            {ranked.map((r, i) => {
              const barW  = Math.max((r.packets / maxP) * chartW, 2);
              const cy    = PAD_T + i * rowH + rowH / 2;
              const isHov = hovered === i;
              const label = (r.name !== r.sn ? r.name : r.sn).replace('CARD-', '');
              const displayLabel = label.length > 11 ? label.slice(0, 10) + '…' : label;

              return (
                <g key={r.sn} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}>
                  {isHov && (
                    <rect x={PAD_L} y={PAD_T + i * rowH} width={chartW} height={rowH}
                      fill="rgba(255,255,255,0.03)" rx={2} />
                  )}
                  <rect x={PAD_L} y={cy - barH / 2} width={barW} height={barH}
                    rx={4} fill={`url(#hbg${i})`}
                    opacity={isHov ? 1 : 0.82}
                    style={{ transition: 'opacity 0.15s' }} />
                  <text x={PAD_L - 6} y={cy + 3.5} textAnchor="end" fontSize={9}
                    fill={isHov ? '#ffffff' : '#d4d4d8'} fontFamily="'JetBrains Mono',monospace"
                    style={{ transition: 'fill 0.15s' }}>
                    {displayLabel}
                  </text>
                  <text x={PAD_L + barW + 5} y={cy + 3.5} textAnchor="start" fontSize={9}
                    fill={colors[i]} fontFamily="'JetBrains Mono',monospace" fontWeight="700">
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

// Top Users — SVG donut showing device count per user
function UserDevicePanel({ devices }) {
  const [hovered, setHovered] = useState(null);
  const colors = ['#4ade80','#60a5fa','#f97316','#fbbf24','#c084fc','#ec4899','#06b6d4'];
  const ini    = n => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '??';

  const { userDevices, slices } = useMemo(() => {
    const map = {};
    devices.forEach(d => {
      const u = d.assignedUser ?? d.client ?? d.name ?? 'Unassigned';
      if (!map[u]) map[u] = [];
      map[u].push(d.sn ?? '');
    });
    const userDevices = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
    const total = userDevices.reduce((s, [, sns]) => s + sns.length, 0);
    if (total === 0) return { userDevices, slices: [] };

    const CX = 85, CY = 85, R = 78, GAP = 1.2;
    const toRad = deg => (deg * Math.PI) / 180;
    let cursor = -90;
    const slices = userDevices.slice(0, 5).map(([user, sns], i) => {
      const count = sns.length;
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
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 320px', maxWidth: 500 }}>
      <div className="hp-card-header">
        <span className="hp-card-title">Users / Department &amp; Devices</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace" }}>
          {devices.length} total
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, padding: '6px 10px 10px' }}>
        {/* Left: pie chart */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <svg width={170} height={170}>
            {slices.length === 0
              ? <circle cx={CX} cy={CY} r={78} fill="#1f2028" strokeDasharray="5 4" />
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
                <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: 'var(--text)',
                  maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.user}
                </span>
                <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: s.color, fontWeight: 700 }}>
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* Right: per-user device list */}
        <div className="hp-dpu-body" style={{ flex: 1, minWidth: 0 }}>
          {userDevices.length === 0
            ? <p className="hp-empty-msg">No devices</p>
            : userDevices.map(([user, sns], i) => {
              const color = colors[i % colors.length];
              return (
                <div key={user} className="hp-dpu-row">
                  <div className="hp-dpu-user-row">
                    <div className="hp-user-avatar" style={{
                      width: 22, height: 22, fontSize: 7,
                      background: `${color}18`, color,
                      border: `1px solid ${color}30`,
                    }}>{ini(user)}</div>
                    <span className="hp-dpu-username">{user}</span>
                    <span className="hp-dpu-count" style={{ color }}>{sns.length}</span>
                  </div>
                  <div className="hp-dpu-chips">
                    {sns.map(sn => (
                      <span key={sn} className="hp-dpu-chip"
                        style={{ borderColor: `${color}35`, color: 'var(--text-muted)' }}>
                        {sn.replace('CARD-', '')}
                      </span>
                    ))}
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
// REGISTRATIONS DONUT — compact pie, each slice = one month
// Source: devices[].bindTime — no extra API call
// ══════════════════════════════════════════════════════════════════════
function RegistrationsDonut({ devices, selectedDate }) {
  const [hovered, setHovered] = useState(null);

  const COLORS = [
    '#6366f1','#f43f5e','#f97316','#facc15',
    '#4ade80','#22d3ee','#e879f9','#60a5fa',
  ];

  const { slices, total } = useMemo(() => {
    // Use the selected date as reference so historical views show the right months
    const now = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date();
    const todayStr = new Date().toISOString().slice(0, 10);
    const isHistorical = selectedDate && selectedDate !== todayStr;

    let months;
    if (isHistorical) {
      // Single bucket: only the month of the selected date
      months = [{
        key:   `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        label: now.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count: 0,
        color: COLORS[0],
      }];
    } else {
      // Rolling 8-month window ending at now
      months = [];
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
          count: 0,
          color: COLORS[i % COLORS.length],
        });
      }
    }

    const map = Object.fromEntries(months.map(m => [m.key, m]));
    devices.forEach(d => {
      // Only count devices that are bound (assigned to a user)
      if (!d.assigned_user_id && !d.user_id) return;
      const raw = d.bindTime ?? d.bound_at ?? d.createdAt ?? null;
      if (!raw) return;
      const dt = new Date(raw);
      if (isNaN(dt)) return;
      // Don't count binds that happened after the selected date
      if (dt > now) return;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (map[key]) map[key].count++;
    });

    const active = months.filter(m => m.count > 0);
    const total  = active.reduce((s, m) => s + m.count, 0);
    if (total === 0) return { slices: months.map(m => ({ ...m, pct: 0, path: '' })), total: 0 };

    // Build arcs
    const CX = 65, CY = 65, R = 54, INNER = 34, GAP = 1.8;
    const toRad = deg => (deg * Math.PI) / 180;
    let cursor  = -90;

    const slices = active.map(m => {
      const deg   = (m.count / total) * (360 - active.length * GAP);
      const start = cursor;
      const end   = start + deg;
      cursor      = end + GAP;

      const large = deg > 180 ? 1 : 0;
      const x1  = CX + R * Math.cos(toRad(start));
      const y1  = CY + R * Math.sin(toRad(start));
      const x2  = CX + R * Math.cos(toRad(end));
      const y2  = CY + R * Math.sin(toRad(end));
      const xi1 = CX + INNER * Math.cos(toRad(start));
      const yi1 = CY + INNER * Math.sin(toRad(start));
      const xi2 = CX + INNER * Math.cos(toRad(end));
      const yi2 = CY + INNER * Math.sin(toRad(end));

      return {
        ...m,
        pct:  m.count / total,
        path: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${INNER} ${INNER} 0 ${large} 0 ${xi1} ${yi1} Z`,
        CX, CY,
      };
    });

    return { slices, total };
  }, [devices]);

  const hovSlice = hovered ? slices.find(s => s.key === hovered) : null;
  const CX = 65, CY = 65;

  return (
    <div className="hp-donut-bare">
      <div className="hp-card-header">
        <span className="hp-card-title">Bound Devices / Month</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace" }}>
          {total} bound
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '10px 12px 12px', flex: 1 }}>

        {/* Donut */}
        <svg width={130} height={130} style={{ flexShrink: 0 }}>
          {/* bg ring */}
          <circle cx={CX} cy={CY} r={44} fill="none" stroke="#1f2028" strokeWidth={20} />

          {total === 0 ? (
            <circle cx={CX} cy={CY} r={44} fill="none"
              stroke="#2e3040" strokeWidth={20} strokeDasharray="5 4" />
          ) : slices.map(s => (
            <path key={s.key} d={s.path}
              fill={s.color}
              opacity={hovered === null ? 0.88 : hovered === s.key ? 1 : 0.18}
              style={{
                cursor: 'pointer',
                transition: 'opacity 0.15s, filter 0.15s',
                filter: hovered === s.key ? `drop-shadow(0 0 5px ${s.color})` : 'none',
              }}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}

          {/* Center text */}
          <text x={CX} y={CY - 5} textAnchor="middle"
            fontSize={hovSlice ? 11 : 14} fontWeight="700"
            fill={hovSlice ? hovSlice.color : '#e8eaf0'}
            fontFamily="'JetBrains Mono',monospace"
            style={{ transition: 'fill 0.15s' }}>
            {hovSlice ? hovSlice.count : total || '—'}
          </text>
          <text x={CX} y={CY + 8} textAnchor="middle"
            fontSize={7} fill="#9ca3af" fontFamily="'JetBrains Mono',monospace">
            {hovSlice ? hovSlice.label : 'devices'}
          </text>
        </svg>

        {/* Legend — horizontal wrap below donut */}
        <div style={{
          width: '100%', display: 'flex',
          flexWrap: 'wrap', gap: '4px 10px',
          justifyContent: 'center',
          maxHeight: 72, overflowY: 'auto',
        }}>
          {slices.map(s => (
            <div key={s.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: 'pointer',
                opacity: hovered === null ? 1 : hovered === s.key ? 1 : 0.3,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{
                width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: s.color,
                boxShadow: hovered === s.key ? `0 0 6px ${s.color}` : 'none',
                transition: 'box-shadow 0.15s',
              }} />
              <span style={{
                fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
                color: 'var(--text)', flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{s.label}</span>
              <span style={{
                fontSize: 9, fontFamily: "'JetBrains Mono',monospace",
                color: s.color, flexShrink: 0, fontWeight: 700,
              }}>{s.count}</span>
            </div>
          ))}
          {total === 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace" }}>
              No bind dates found
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════════════════════════


// Devices Per User — direct map from devices array, capped + scrollable

// ══════════════════════════════════════════════════════════════════════
// ACTIVITY CHART
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
        <span style={{
          fontSize: 10, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
          color: breaches.length > 0 ? '#f97316' : '#4ade80',
        }}>
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
          <span style={{ fontSize: 11, color: '#4ade80' }}>All {totalWithRegion} tracked device{totalWithRegion !== 1 ? 's' : ''} in region</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflowY: 'auto' }}>
          {breaches.map((b, i) => (
            <div key={b.sn} style={{
              padding: '7px 12px', borderBottom: '1px solid #1a1a1f',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f97316', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: '#e4e4e7', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name !== b.sn ? b.name : b.sn}
                  </span>
                </div>
                <span style={{ fontSize: 9, color: '#52525b', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
                  {fmtTs(b.ts)}
                </span>
              </div>
              <div style={{ paddingLeft: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                {b.name !== b.sn && (
                  <span style={{ fontSize: 9, color: '#52525b', fontFamily: "'JetBrains Mono',monospace" }}>{b.sn}</span>
                )}
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
        const h = d.getHours(); // PKT local time
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

  const peakBin = hasData
    ? generalBins.reduce((best, b) => b.count > best.count ? b : best, generalBins[0])
    : null;

  const syncStr = lastSync
    ? lastSync.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const PAD_L = 38, PAD_R = 14, PAD_T = 12, PAD_B = 22;
  const { w: W, h: H } = dims;
  const chartW    = W - PAD_L - PAD_R;
  const chartH    = H - PAD_T - PAD_B;
  const barGroupW = chartW / Math.max(hours.length, 1);
  const barW      = Math.max(barGroupW * 0.72, 2);

  return (
    <div className="hp-activity-card">
      <div className="hp-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="hp-card-title">Device Activity — {selectedDate}</span>
          {loading && <span className="hp-spinner-inline" />}
          {!loading && syncStr && (
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono',monospace" }}>↻ {syncStr}</span>
          )}
          {!loading && hasData && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace" }}>
              {totalPts.toLocaleString()} pts · {Object.keys(activityData).length} dev
              {peakBin?.count > 0 && (
                <span style={{ color: '#f59e0b', marginLeft: 8 }}>▲ peak {fmtHour(peakBin.hour)}:00</span>
              )}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
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
          <svg width={W} height={H} style={{ display: 'block', position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id="bar-grad-default" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#cc2222" />
                <stop offset="100%" stopColor="#800000" />
              </linearGradient>
              <linearGradient id="bar-grad-hover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#aa1111" />
              </linearGradient>
              <linearGradient id="trend-area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(204,34,34,0.3)" />
                <stop offset="100%" stopColor="rgba(204,34,34,0)" />
              </linearGradient>
            </defs>

            {/* Y-axis grid lines (dashed) */}
            {ticks.map(tick => {
              const y = PAD_T + chartH * (1 - (tickMax > 0 ? tick / tickMax : 0));
              return (
                <g key={`t-${tick}`}>
                  <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#1f2028" strokeWidth={1} strokeDasharray="3 4" />
                  <text x={PAD_L - 5} y={y + 3.5} textAnchor="end" fontSize={9} fill="#ffffff" fontFamily="'JetBrains Mono',monospace">{fmtVal(tick)}</text>
                </g>
              );
            })}
            <line x1={PAD_L} x2={PAD_L}     y1={PAD_T} y2={PAD_T + chartH} stroke="#2e3040" strokeWidth={1} />
            <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH} stroke="#2e3040" strokeWidth={1} />

            {/* ── TREND MODE ── */}
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
                  {polyPts && <polyline points={polyPts} fill="none" stroke="#cc2222" strokeWidth={2} strokeLinejoin="round" />}
                  {linePoints.map((p) => {
                    const isHov  = hovered === p.h;
                    const isPeak = peakBin?.hour === p.h && p.count > 0;
                    const showLbl = p.h % 2 === 0;
                    return (
                      <g key={p.h} style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHovered(p.h)}
                        onMouseLeave={() => setHovered(null)}>
                        <rect x={p.x - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH + PAD_B} fill="transparent" />
                        {isHov && <line x1={p.x} x2={p.x} y1={PAD_T} y2={PAD_T + chartH} stroke="#2e3040" strokeWidth={1} strokeDasharray="3 3" />}
                        <circle cx={p.x} cy={p.y} r={isHov || isPeak ? 5 : 3}
                          fill={isPeak ? '#f59e0b' : isHov ? '#ef4444' : '#cc2222'}
                          stroke={isHov ? '#e8eaf0' : 'none'} strokeWidth={1.5}
                          style={{ transition: 'r 0.12s, fill 0.12s' }} />
                        {showLbl && (
                          <text x={p.x} y={H - 5} textAnchor="middle" fontSize={8}
                            fill={isHov ? '#e8eaf0' : '#ffffff'} fontFamily="'JetBrains Mono',monospace">
                            {fmtHour(p.h)}
                          </text>
                        )}
                        {isHov && p.count > 0 && (() => {
                          const tipW = 96, tipH = 38;
                          const tipX = Math.max(PAD_L, Math.min(p.x - tipW / 2, W - PAD_R - tipW));
                          const tipY = Math.max(PAD_T + 2, p.y - tipH - 10);
                          return (
                            <g style={{ pointerEvents: 'none' }}>
                              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6}
                                fill="rgba(7,8,10,0.97)" stroke="#2e3040" strokeWidth={1} />
                              <text x={tipX + tipW/2} y={tipY + 13} textAnchor="middle" fontSize={9} fill="#9ca3af" fontFamily="'JetBrains Mono',monospace">
                                {fmtHour(p.h)}:00 PKT
                              </text>
                              <text x={tipX + tipW/2} y={tipY + 29} textAnchor="middle" fontSize={12} fontWeight="700" fill="#cc2222" fontFamily="'JetBrains Mono',monospace">
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

            {/* ── BAR MODES (general + device) ── */}
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
                    {isHov && (
                      <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH}
                        fill="rgba(255,255,255,0.03)" />
                    )}
                    <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH + PAD_B} fill="transparent" />
                    <rect x={groupX - barW / 2} y={PAD_T + chartH - barH} width={barW} height={barH} rx={3}
                      fill={fill} opacity={isHov || isPeak ? 1 : 0.82}
                      style={{ transition: 'opacity 0.12s' }} />
                    {showLbl && (
                      <text x={groupX} y={H - 5} textAnchor="middle" fontSize={8}
                        fill={isHov ? '#e8eaf0' : '#ffffff'} fontFamily="'JetBrains Mono',monospace">
                        {fmtHour(h)}
                      </text>
                    )}
                    {isHov && (() => {
                      const tipW = 96, tipH = 38;
                      const tipX = Math.max(PAD_L, Math.min(groupX - tipW / 2, W - PAD_R - tipW));
                      const tipY = Math.max(PAD_T + 2, PAD_T + chartH - barH - tipH - 6);
                      return (
                        <g style={{ pointerEvents: 'none' }}>
                          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6}
                            fill="rgba(7,8,10,0.97)" stroke="#2e3040" strokeWidth={1} />
                          <text x={tipX + tipW/2} y={tipY + 13} textAnchor="middle" fontSize={9} fill="#9ca3af" fontFamily="'JetBrains Mono',monospace">
                            {fmtHour(h)}:00 PKT
                          </text>
                          <text x={tipX + tipW/2} y={tipY + 29} textAnchor="middle" fontSize={12} fontWeight="700" fill="#cc2222" fontFamily="'JetBrains Mono',monospace">
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
                  {isHov && (
                    <rect x={groupX - barGroupW / 2} y={PAD_T} width={barGroupW} height={chartH}
                      fill="rgba(255,255,255,0.03)" />
                  )}
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
                    <text x={groupX} y={H - 5} textAnchor="middle" fontSize={8}
                      fill={isHov ? '#e8eaf0' : '#ffffff'} fontFamily="'JetBrains Mono',monospace">
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
                        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={6}
                          fill="rgba(7,8,10,0.97)" stroke="#2e3040" strokeWidth={1} />
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
            <text x={PAD_L + chartW / 2} y={H} textAnchor="middle" fontSize={8} fill="#ffffff" fontFamily="'JetBrains Mono',monospace">
              Hour (PKT)
            </text>
          </svg>
        )}
        {loading && hasData && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
            justifyContent:'center', background:'rgba(7,8,10,0.5)', borderRadius:8, zIndex:5 }}>
            <span className="hp-spinner-inline" style={{ width:18, height:18 }} />
          </div>
        )}
      </div>

      {mode === 'device' && deviceList.length > 0 && (
        <div className="hp-chart-legend">
          {deviceList.map(d => (
            <span key={d.sn} className="hp-chart-legend-item">
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block', flexShrink: 0 }} />
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

  const [filters, setFilters]       = useState({ region: 'all', area: 'all', date: todayStr() });
  const [devices, setDevices]       = useState([]);
  const [devLoading, setDevLoading] = useState(true);
  const [locations, setLocations]   = useState({});
  const [locSync, setLocSync]       = useState(null);
  const [activityData, setActivityData] = useState({});
  const [chartLoading, setChartLoading] = useState(false);
  const [chartMode, setChartMode]       = useState('general');
  const [kmlAreas, setKmlAreas]         = useState([]);

  const isLive       = filters.date === todayStr();
  const locAbortRef      = useRef(null);
  const trajAbortRef     = useRef(null);
  const activitySyncRef  = useRef(null); // ISO string of last activity fetch — enables incremental mode

  // Load KML areas once for region breach detection
  useEffect(() => {
    fetch('/areas.kml')
      .then(r => r.text())
      .then(text => setKmlAreas(parseKMLText(text)))
      .catch(() => {});
  }, []);

  // Compute which devices are outside their assigned region (uses already-polling locations)
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
        return {
          sn:     d.sn,
          name:   d.name ?? d.assignedUser ?? d.sn,
          region: d.region,
          ts:     loc.timestamp ?? loc.time ?? loc.locTime ?? null,
        };
      })
      .filter(Boolean);
  }, [devices, locations, kmlAreas]);

  useEffect(() => {
    let cancelled = false;
    setDevLoading(true);
    getDevices()
      .then(res => { if (cancelled) return; setDevices(Array.isArray(res) ? res : (res?.devices ?? [])); })
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

    // Incremental: only fetch delta since last sync — live only, and only if we already have data
    const useIncremental = incremental && live && !!activitySyncRef.current;
    const start = useIncremental ? new Date(activitySyncRef.current) : dayRange(dateStr, live).start;
    const end   = live ? new Date() : dayRange(dateStr, live).end;
    const snapNow = new Date().toISOString(); // capture before any await

    if (!useIncremental) {
      if (!live) setChartLoading(true); // only show loader for historical, not live
      setActivityData({});
    }

    const fetch1 = (sn) => getPlayback(sn, start, end)
      .then(res => ({ sn, pts: Array.isArray(res?.points) ? res.points : Array.isArray(res) ? res : [] }))
      .catch(() => null);

    let results;
    if (useIncremental) {
      // Tiny delta payloads — fire all in parallel
      const settled = await Promise.allSettled(devices.map(d => fetch1(d.sn ?? '')));
      results = settled.map(r => r.status === 'fulfilled' ? r.value : null);
    } else {
      // Full day — respect concurrency to avoid hammering the backend
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
    activitySyncRef.current = null; // force full fetch on any filter or device change
    fetchActivity(filters.date, isLive, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.date, filters.region, filters.area, devices.length]);

  useEffect(() => {
    if (!isLive || !devices.length) return;
    // Subsequent live polls use incremental mode — only fetch new points since last sync
    const id = setInterval(() => fetchActivity(filters.date, true, true), TRAJECTORY_POLL_MS);
    return () => clearInterval(id);
  }, [isLive, filters.date, devices.length, fetchActivity]);

  // Derive filtered device list from region selector
  const filteredDevices = useMemo(() => {
    if (filters.region === 'all') return devices;
    const entry = KML_REGIONS.find(r => r.value === filters.region);
    if (!entry) return devices;
    const areaSet = new Set(entry.areas.map(a => a.toLowerCase()));
    return devices.filter(d => areaSet.has((d.region ?? '').toLowerCase()));
  }, [devices, filters.region]);

  // Slice activity data to only the filtered devices
  const filteredActivityData = useMemo(() => {
    if (filters.region === 'all') return activityData;
    const snSet = new Set(filteredDevices.map(d => d.sn ?? ''));
    return Object.fromEntries(Object.entries(activityData).filter(([sn]) => snSet.has(sn)));
  }, [activityData, filteredDevices, filters.region]);

  const totalDevices = filteredDevices.length;
  const activeNow = filteredDevices.filter(d => {
    if (d.status === 'online') return true;
    const sn = d.sn ?? '';
    const ts = locations[sn]?.timestamp ?? locations[sn]?.time;
    return ts && (Date.now() - new Date(ts).getTime()) < 30 * 60 * 1000;
  }).length;
  const offlineCount = totalDevices - activeNow;

  // Weekly bind rate — devices bound during the ISO week containing the selected/today date
  const weeklyBinds = useMemo(() => {
    const ref = filters.date ? new Date(filters.date + 'T23:59:59') : new Date();
    // Monday of that week (ISO)
    const day = ref.getDay(); // 0=Sun … 6=Sat
    const diffToMon = (day + 6) % 7;
    const weekStart = new Date(ref);
    weekStart.setDate(ref.getDate() - diffToMon);
    weekStart.setHours(0, 0, 0, 0);
    return filteredDevices.filter(d => {
      const raw = d.bindTime ?? d.bound_at ?? d.createdAt ?? null;
      if (!raw) return false;
      const dt = new Date(raw);
      return !isNaN(dt) && dt >= weekStart && dt <= ref;
    }).length;
  }, [filteredDevices, filters.date]);

  return (
    <div className="hp-page">

      {/* ── Row 1: Header ───────────────────────────────────────── */}
      <div className="hp-top-row">
        <LiveClock isHistorical={!isLive} selectedDate={filters.date} />
        <div className="hp-top-right">
          <FilterBar filters={filters} onChange={setFilters} />
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
        </div>
      </div>

      {/*
        ── Row 2: Top band ─────────────────────────────────────────
        [Stats col] [Top5 Packets] [Top Users] [Packet Gap Detector]
      */}
      <div className="hp-top-band">
        {/* 3 compact stat cards stacked in a narrow column */}
        <div className="hp-stats-col">
          <StatCard
            title="Total Devices" value={totalDevices} loading={devLoading}
            accentColor="#60a5fa"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>}
            iconBg="rgba(59,130,246,0.12)" iconColor="#60a5fa"
            rate={weeklyBinds}
          />
          <StatCard
            title="Active in Zone" value={activeNow} loading={devLoading}
            accentColor="#4ade80"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            iconBg="rgba(22,163,74,0.12)" iconColor="#4ade80"
          />
          <StatCard
            title="Offline / Absent" value={offlineCount} loading={devLoading}
            accentColor="#fca5a5"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>}
            iconBg="rgba(239,68,68,0.12)" iconColor="#fca5a5"
          />
        </div>

        {/* Top Devices, Top Users, Registrations, ZoneStats, DevicesPerUser — all in top band */}
        <TopDevices devices={filteredDevices} activityData={filteredActivityData} />
        <RegistrationsDonut devices={filteredDevices} selectedDate={filters.date} />
        <UserDevicePanel devices={filteredDevices} />
      </div>

      {/*
        ── Row 3: Main ─────────────────────────────────────────────
        [Sidebar: RegionBreachPanel] | [Chart fills rest]
      */}
      <div className="hp-main-row">
        <div className="hp-sidebar">
          <RegionBreachPanel breaches={regionBreaches} totalWithRegion={devices.filter(d => d.region).length} />
        </div>
        <div className="hp-chart-area">
          <ActivityChart
            activityData={filteredActivityData}
            devices={filteredDevices}
            selectedDate={filters.date}
            isLive={isLive}
            mode={chartMode}
            onModeChange={setChartMode}
            loading={chartLoading}
            lastSync={locSync}
          />
        </div>
      </div>

    </div>
  );
}
