import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { useCityTag } from '../hooks/useCityTag.js';
import { useKmlAreas } from '../hooks/useKmlAreas.js';
import AreaSelector from '../components/AreaSelector.jsx';
import TPLLoader from '../components/TPLLoader.jsx';
import { reverseGeocode } from '../utils/reverseGeocode.js';
import { pointInArea } from '../utils/geofenceUtils.js';
import './FieldStaffDashboard.css';

mapboxgl.accessToken =
  import.meta.env?.VITE_MAPBOX_TOKEN || process.env?.REACT_APP_MAPBOX_TOKEN || '';

// ─── SVG Rank Badge ───────────────────────────────────────────────────────────
const RANK_COLORS = ['#f59e0b', '#94a3b8', '#cd7c4a', '#9ca3af', '#9ca3af'];

function RankBadge({ rank }) {
  const color = RANK_COLORS[rank - 1] ?? '#9ca3af';
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" style={{ flexShrink: 0 }}>
      <circle
        cx={13} cy={13} r={11.5}
        fill={`${color}18`}
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.5}
      />
      {rank === 1 && (
        <path d="M8 17 L8 12 L10.5 14.5 L13 10 L15.5 14.5 L18 12 L18 17 Z"
          fill={color} opacity={0.9} />
      )}
      {rank === 2 && (
        <polygon
          points="13,8 14.2,11.5 18,11.5 15,13.7 16.2,17.2 13,15 9.8,17.2 11,13.7 8,11.5 11.8,11.5"
          fill={color} opacity={0.85} />
      )}
      {rank === 3 && (
        <polygon
          points="13,9 13.9,11.7 16.8,11.7 14.5,13.3 15.4,16 13,14.4 10.6,16 11.5,13.3 9.2,11.7 12.1,11.7"
          fill={color} opacity={0.8} />
      )}
      {rank > 3 && (
        <text x={13} y={17.5} textAnchor="middle" fontSize={11} fontWeight="800"
          fill={color} fontFamily="'JetBrains Mono',monospace">
          {rank}
        </text>
      )}
    </svg>
  );
}

// ─── Map Section ──────────────────────────────────────────────────────────────
function MapSection({ filteredDevices, mapContainerRef }) {
  const mapRef     = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [74.3587, 31.5204],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Call resize once the map has loaded so Mapbox measures the container correctly
    map.on('load', () => map.resize());

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    const withCoords = filteredDevices.filter(
      d => d.latitude != null && d.longitude != null
    );
    if (!withCoords.length) return;
    withCoords.forEach(device => {
      const color  = device.isOnline ? '#22c55e' : '#ef4444';
      const marker = new mapboxgl.Marker({ color, scale: 0.85 })
        .setLngLat([device.longitude, device.latitude])
        .setPopup(
          new mapboxgl.Popup({ closeButton: false }).setHTML(`
            <div style="font-family:'Nunito',sans-serif;padding:4px 2px;min-width:160px;">
              <div style="font-weight:700;font-size:13px;color:#f9fafb;margin-bottom:4px;">
                ${device.name || device.sn}
              </div>
              <div style="font-size:12px;color:#d1d5db;margin-bottom:2px;">
                ${device.assignedUser || 'Unassigned'}
              </div>
              <div style="font-size:11px;color:#9ca3af;">
                ${device.region || 'No region'}
                ${device.location ? ' › ' + device.location : ''}
                ${device.zone    ? ' › ' + device.zone    : ''}
              </div>
            </div>
          `)
        )
        .addTo(map);
      markersRef.current.push(marker);
    });
    const bounds = new mapboxgl.LngLatBounds();
    withCoords.forEach(d => bounds.extend([d.longitude, d.latitude]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
  }, [filteredDevices]);

  // The wrapper div below is the key fix: it stretches to fill .fsd-map-card
  // via the CSS rule `.fsd-map-card > * { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }`
  return (
    <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={mapContainerRef} className="fsd-map-container" />
    </div>
  );
}

// ─── Top 5 Active Staff ───────────────────────────────────────────────────────
function TopStaffPanel({ devices }) {
  const topStaff = useMemo(() => {
    const userMap = new Map();
    devices.forEach(d => {
      if (!d.assignedUser) return;
      if (!userMap.has(d.assignedUser)) {
        userMap.set(d.assignedUser, { name: d.assignedUser, onlineCount: 0, totalCount: 0 });
      }
      const entry = userMap.get(d.assignedUser);
      entry.totalCount++;
      if (d.isOnline) entry.onlineCount++;
    });
    return [...userMap.values()]
      .sort((a, b) =>
        b.onlineCount !== a.onlineCount
          ? b.onlineCount - a.onlineCount
          : b.totalCount - a.totalCount
      )
      .slice(0, 5);
  }, [devices]);

  return (
    <div className="fsd-top-staff">
      <div className="fsd-card-header">
        <span className="fsd-card-title">Top 5 Active Staff</span>
        <span className="fsd-record-count">{topStaff.length} staff</span>
      </div>
      <div className="fsd-staff-list">
        {topStaff.length === 0 ? (
          <p className="fsd-empty-msg">No staff data available</p>
        ) : (
          topStaff.map((staff, index) => (
            <div key={staff.name} className="fsd-staff-item">
              <RankBadge rank={index + 1} />
              <div className="fsd-staff-info">
                <div className="fsd-staff-name">{staff.name}</div>
                <div className="fsd-staff-time">
                  {staff.onlineCount > 0
                    ? <span style={{ color: '#4ade80', fontWeight: 600 }}>● {staff.onlineCount} online</span>
                    : <span style={{ color: '#6b7280' }}>Offline</span>
                  }
                </div>
              </div>
              <div className="fsd-staff-total">
                {staff.totalCount} device{staff.totalCount !== 1 ? 's' : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Zone Table ───────────────────────────────────────────────────────────────
function ZoneTable({ devices, locationCache }) {
  return (
    <div className="fsd-zone-table-container">
      <div className="fsd-card-header">
        <span className="fsd-card-title">Staff Zone Activity</span>
        <span className="fsd-record-count">{devices.length} records</span>
      </div>
      <div className="fsd-table-wrapper">
        <table className="fsd-zone-table">
          <thead>
            <tr>
              <th>User Name</th>
              <th>Locator</th>
              <th>Area / Location</th>
              <th>Status</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan="5" className="fsd-empty-row">No data available</td>
              </tr>
            ) : (
              devices.map((device, index) => {
                const geocoded  = locationCache[device.sn];
                const fallback  =
                  device.location ||
                  [device.region, device.zone].filter(Boolean).join(' › ') ||
                  null;
                const hasCoords = device.latitude != null && device.longitude != null;

                let locationCell;
                if (geocoded) {
                  locationCell = geocoded;
                } else if (hasCoords) {
                  locationCell = (
                    <span style={{ color: '#6b7280', fontStyle: 'italic', fontSize: 11 }}>
                      Locating…
                    </span>
                  );
                } else {
                  locationCell = fallback || '—';
                }

                return (
                  <tr key={`${device.sn}-${index}`}>
                    <td style={{ fontWeight: 700, color: '#f9fafb' }}>
                      {device.assignedUser || 'Unassigned'}
                    </td>
                    <td>{device.name || device.sn}</td>
                    <td>{locationCell}</td>
                    <td>
                      <span className={device.isOnline ? 'fsd-badge-online' : 'fsd-badge-offline'}>
                        {device.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="fsd-col-lastseen">
                      {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FieldStaffDashboard() {
  const { getFieldStaffLiveDevices } = useCityTag();
  const mapContainerRef = useRef(null);
  const navigate        = useNavigate();
  const { areas, kmlLoading } = useKmlAreas();

  const [devices,        setDevices]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [dateFrom,       setDateFrom]       = useState('');
  const [dateTo,         setDateTo]         = useState('');

  // Reverse-geocode cache: { [sn]: "Primary, Secondary" }
  const [locationCache,  setLocationCache]  = useState({});
  const geocodingInFlight = useRef(new Set());

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getFieldStaffLiveDevices();
      setDevices(data);
    } catch (err) {
      setError(err.message || 'Failed to load field staff data');
    } finally {
      setLoading(false);
    }
  }, [getFieldStaffLiveDevices]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // ── Resolve selected area ─────────────────────────────────────────────────
  const selectedArea = useMemo(
    () => areas.find(a => a.id === selectedAreaId) ?? null,
    [areas, selectedAreaId]
  );

  // ── Filtered devices ──────────────────────────────────────────────────────
  const filteredDevices = useMemo(() => {
    let list = devices;
    if (selectedArea) {
      list = list.filter(d => {
        if (d.latitude == null || d.longitude == null) return false;
        return pointInArea([d.latitude, d.longitude], selectedArea.coords);
      });
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter(d => d.lastSeen && new Date(d.lastSeen) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(d => d.lastSeen && new Date(d.lastSeen) <= to);
    }
    return list;
  }, [devices, selectedArea, dateFrom, dateTo]);

  // ── Reverse geocode visible devices ──────────────────────────────────────
  useEffect(() => {
    const pending = filteredDevices.filter(
      d =>
        d.latitude  != null &&
        d.longitude != null &&
        !locationCache[d.sn] &&
        !geocodingInFlight.current.has(d.sn)
    );
    if (!pending.length) return;
    pending.forEach(device => {
      geocodingInFlight.current.add(device.sn);
      reverseGeocode(device.latitude, device.longitude)
        .then(result => {
          if (!result) return;
          const label = result.primary + (result.secondary ? `, ${result.secondary}` : '');
          setLocationCache(prev => ({ ...prev, [device.sn]: label }));
        })
        .catch(() => {})
        .finally(() => { geocodingInFlight.current.delete(device.sn); });
    });
  }, [filteredDevices]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fsd-loading">
        <TPLLoader label="Loading Field Staff Dashboard…" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="fsd-loading">
        <p style={{ color: '#f87171', fontSize: 14 }}>{error}</p>
        <button className="fsd-back-btn" onClick={fetchDevices} style={{ marginTop: 12 }}>
          Retry
        </button>
      </div>
    );
  }

  const onlineCount = devices.filter(d => d.isOnline).length;

  return (
    <div className="fsd-dashboard">

      {/* ── Header ── */}
      <div className="fsd-header">
        <div className="fsd-header-left">
          <button className="fsd-back-btn" onClick={() => navigate('/Homepage')}>
            ‹ Back
          </button>
          <div className="fsd-header-text">
            <h1 className="fsd-title">Field Staff Dashboard</h1>
            <p className="fsd-subtitle">
              <span className="fsd-online-dot" />
              {onlineCount} of {devices.length} locators online
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="fsd-filters-bar">
          <div className="fsd-area-selector-wrapper">
            <AreaSelector
              value={selectedAreaId}
              onChange={setSelectedAreaId}
              areas={areas}
              loading={kmlLoading}
            />
          </div>

          <div className="fsd-filter-group">
            <label className="fsd-filter-label">
              Date From {dateFrom && <span className="fsd-filter-hist-badge">Historical</span>}
            </label>
            <input
              type="date"
              className="fsd-filter-select fsd-filter-date"
              value={dateFrom}
              max={dateTo || undefined}
              onClick={e => { try { e.target.showPicker(); } catch {} }}
              onChange={e => setDateFrom(e.target.value)}
            />
          </div>

          <div className="fsd-filter-group">
            <label className="fsd-filter-label">
              Date To {dateTo && <span className="fsd-filter-hist-badge">Historical</span>}
            </label>
            <input
              type="date"
              className="fsd-filter-select fsd-filter-date"
              value={dateTo}
              min={dateFrom || undefined}
              onClick={e => { try { e.target.showPicker(); } catch {} }}
              onChange={e => setDateTo(e.target.value)}
            />
          </div>

          {(dateFrom || dateTo) && (
            <button
              className="fsd-filter-live-btn"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
            >
              ✕ Clear Dates
            </button>
          )}
        </div>
      </div>

      {/* ── Top Layout: Map (55%) | Side Column (45%) ── */}
      <div className="fsd-top-layout">

        {/* Left — Map */}
        <div className="fsd-map-card">
          <MapSection
            filteredDevices={filteredDevices}
            mapContainerRef={mapContainerRef}
          />
        </div>

        {/* Right — Top Staff + Zone Table stacked at equal height */}
        <div className="fsd-side-cards">
          <div className="fsd-side-card">
            <TopStaffPanel devices={filteredDevices} />
          </div>
          <div className="fsd-table-card">
            <ZoneTable devices={filteredDevices} locationCache={locationCache} />
          </div>
        </div>

      </div>

    </div>
  );
}