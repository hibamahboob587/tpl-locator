import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { useCityTag } from '../hooks/useCityTag.js';
import { useKmlAreas } from '../hooks/useKmlAreas.js';
import AreaSelector from '../components/AreaSelector.jsx';
import './FieldStaffDashboard.css';

mapboxgl.accessToken = import.meta.env?.VITE_MAPBOX_TOKEN || process.env?.REACT_APP_MAPBOX_TOKEN || '';


// ─── Map Section ─────────────────────────────────────────────────────────────
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
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    const withCoords = filteredDevices.filter(d => d.latitude != null && d.longitude != null);
    if (!withCoords.length) return;
    withCoords.forEach(device => {
      const color  = device.isOnline ? '#22c55e' : '#ef4444';
      const marker = new mapboxgl.Marker({ color, scale: 0.85 })
        .setLngLat([device.longitude, device.latitude])
        .setPopup(
          new mapboxgl.Popup({ closeButton: false }).setHTML(`
            <div style="font-family:'Nunito',sans-serif;padding:4px 2px;min-width:160px;">
              <div style="font-weight:700;font-size:13px;color:#f9fafb;margin-bottom:4px;">${device.name || device.sn}</div>
              <div style="font-size:12px;color:#d1d5db;margin-bottom:2px;">${device.assignedUser || 'Unassigned'}</div>
              <div style="font-size:11px;color:#9ca3af;">${device.region || 'No region'}${device.location ? ' › ' + device.location : ''}${device.zone ? ' › ' + device.zone : ''}</div>
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

  return <div ref={mapContainerRef} className="fsd-map-container" />;
}


// ─── Top 5 Staff ─────────────────────────────────────────────────────────────
function TopStaffPanel({ devices }) {
  const topStaff = useMemo(() => {
    const seen = new Set();
    return devices
      .filter(d => {
        if (!d.assignedUser || seen.has(d.assignedUser)) return false;
        seen.add(d.assignedUser);
        return true;
      })
      .sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0))
      .slice(0, 5);
  }, [devices]);

  const rankLabels = ['🥇', '🥈', '🥉', '4', '5'];

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
            <div key={staff.assignedUser} className="fsd-staff-item">
              <div className={`fsd-staff-rank ${index === 0 ? 'fsd-staff-rank-gold' : ''}`}>
                {rankLabels[index]}
              </div>
              <div className="fsd-staff-info">
                <div className="fsd-staff-name">{staff.assignedUser}</div>
                <div className="fsd-staff-time">
                  {staff.isOnline
                    ? <span style={{ color: '#4ade80', fontWeight: 600 }}>● Online</span>
                    : <span style={{ color: '#6b7280' }}>Offline</span>
                  }
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}


// ─── Zone Table ───────────────────────────────────────────────────────────────
function ZoneTable({ devices }) {
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
              <th>Coordinates</th>
              <th>Status</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan="6" className="fsd-empty-row">No data available</td>
              </tr>
            ) : (
              devices.map((device, index) => {
                const areaLocation =
                  device.location ||
                  [device.region, device.zone].filter(Boolean).join(' › ') ||
                  '—';
                const coordinates = device.latitude && device.longitude
                  ? `${device.latitude.toFixed(6)}, ${device.longitude.toFixed(6)}`
                  : '—';
                return (
                  <tr key={`${device.sn}-${index}`}>
                    <td style={{ fontWeight: 700, color: '#f9fafb' }}>{device.assignedUser || 'Unassigned'}</td>
                    <td>{device.name || device.sn}</td>
                    <td>{areaLocation}</td>
                    <td className="fsd-col-coordinates">
                      {coordinates !== '—' ? (
                        <a
                          href={`https://www.google.com/maps?q=${device.latitude},${device.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="fsd-coord-link"
                        >
                          {coordinates}
                        </a>
                      ) : '—'}
                    </td>
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

  const [devices, setDevices]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState(null);
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

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

  const filteredDevices = useMemo(() => {
    let list = devices;
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
  }, [devices, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="fsd-loading">
        <div className="fsd-spinner" />
        <p style={{ fontSize: 14, fontWeight: 600 }}>Loading Field Staff Dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fsd-loading">
        <p style={{ color: '#f87171', fontSize: 14 }}>{error}</p>
        <button className="fsd-back-btn" onClick={fetchDevices} style={{ marginTop: 12 }}>Retry</button>
      </div>
    );
  }

  const onlineCount = devices.filter(d => d.isOnline).length;

  return (
    <div className="fsd-dashboard">

      {/* ── Header ── */}
      <div className="fsd-header">
        <div className="fsd-header-left">
          <button className="fsd-back-btn" onClick={() => navigate('/Homepage')}>‹ Back</button>
          <div className="fsd-header-text">
            <h1 className="fsd-title">Field Staff Dashboard</h1>
            <p className="fsd-subtitle">
              <span className="fsd-online-dot" />
              {onlineCount} of {devices.length} locators online
            </p>
          </div>
        </div>

        <div className="fsd-filters-bar">
          <div className="area-selector-wrapper">
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
            <button className="fsd-filter-live-btn" onClick={() => { setDateFrom(''); setDateTo(''); }}>
              ✕ Clear Dates
            </button>
          )}
        </div>
      </div>

      {/* ── Top Layout: Map (2fr) | Side Column (1fr) ── */}
      <div className="fsd-top-layout">

        {/* Left — Map */}
        <div className="fsd-map-card">
          <MapSection filteredDevices={filteredDevices} mapContainerRef={mapContainerRef} />
        </div>

        {/* Right — Top Staff + Zone Table stacked */}
        <div className="fsd-side-cards">

          <div className="fsd-side-card">
            <TopStaffPanel devices={filteredDevices} />
          </div>

          <div className="fsd-table-card">
            <ZoneTable devices={filteredDevices} />
          </div>

        </div>
      </div>

    </div>
  );
}
