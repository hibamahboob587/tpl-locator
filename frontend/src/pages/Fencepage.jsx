import React, { useState, useCallback, useEffect, useRef, useMemo, Component } from "react";
import tplLogo from "../assets/tpl.png";

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", background: "#fff", color: "#dc2626" }}>
          <h2 style={{ marginBottom: 12 }}>FencePage crashed</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#111" }}>
            {this.state.error?.message}{"\n\n"}{this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

import {
  MapContainer, TileLayer, CircleMarker, Polygon, Tooltip, useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useDeviceCache } from "../context/DeviceCacheContext.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import { useMapTheme } from "../context/MapThemeContext.jsx";
import "./FencePage.css";

const MAPBOX_TOKEN =
  import.meta.env?.VITE_MAPBOX_TOKEN || "";

if (!MAPBOX_TOKEN) console.warn("Add VITE_MAPBOX_TOKEN to your .env file.");

// ─── Helpers ──────────────────────────────────────────────────────────────────
import { pointInPolygon, pointInArea, parseKMLText } from "../utils/geofenceUtils.js";

function centroid(coords) {
  const flat = Array.isArray(coords[0][0]) ? coords.flat() : coords;
  if (!flat?.length) return [30.9, 74.2];
  return [flat.reduce((s, c) => s + c[0], 0) / flat.length, flat.reduce((s, c) => s + c[1], 0) / flat.length];
}

function boundsOf(coords) {
  const flat = Array.isArray(coords[0][0]) ? coords.flat() : coords;
  const lats = flat.map((c) => c[0]);
  const lngs = flat.map((c) => c[1]);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}

function todayStr() { return new Date().toISOString().split("T")[0]; }

function formatTime(val) {
  if (!val) return "";
  try {
    const d = new Date(val);
    return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return ""; }
}

function localDateStr(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalMins = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

const DEVICE_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#a855f7", "#06b6d4", "#f97316", "#84cc16",
  "#ec4899", "#14b8a6",
];

// parseKMLText is imported from geofenceUtils.js above

// ─── Auto-fit map ─────────────────────────────────────────────────────────────
function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (!coords?.length) return;
    try { map.fitBounds(boundsOf(coords), { padding: [40, 40] }); } catch {}
  }, [coords, map]);
  return null;
}

// ─── Device Dropdown ──────────────────────────────────────────────────────────
// Now shows which areas each device has data in (deviceAreaMap), and highlights
// devices that have points in the currently selected area.
function DeviceDropdown({ devices, selectedSns, onChange, deviceAreaMap, selectedAreaId, areas }) {
  const [open, setOpen]         = useState(false);
  const [search, setSearch]     = useState("");
  const [menuStyle, setMenuStyle] = useState({});
  const triggerRef = useRef(null);
  const wrapRef    = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setMenuStyle({ position: "fixed", top: r.bottom + 6, left: r.left, minWidth: Math.max(r.width, 260), zIndex: 9999 });
    }
    setOpen((v) => !v);
  };

  const filtered = useMemo(() =>
    devices.filter((d) => {
      const label = (d.assigned_user_name || d.assignedUser || d.sn || "").toLowerCase();
      return label.includes(search.toLowerCase()) || d.sn?.toLowerCase().includes(search.toLowerCase());
    }), [devices, search]);

  const toggleAll = () => onChange(selectedSns.length === devices.length ? [] : devices.map((d) => d.sn));
  const toggle    = (sn) => onChange(selectedSns.includes(sn) ? selectedSns.filter((s) => s !== sn) : [...selectedSns, sn]);

  // Devices that have points inside the currently selected area
  const devicesInSelectedArea = selectedAreaId ? (Object.entries(deviceAreaMap)
    .filter(([, areaIds]) => areaIds.includes(selectedAreaId))
    .map(([sn]) => sn)) : [];

  // "Select devices in this area" helper
  const selectDevicesInArea = () => {
    if (devicesInSelectedArea.length) onChange(devicesInSelectedArea);
    setOpen(false);
  };

  const label = selectedSns.length === 0 ? "Select devices"
    : selectedSns.length === 1 ? (devices.find((d) => d.sn === selectedSns[0])?.assigned_user_name || selectedSns[0])
    : `${selectedSns.length} devices selected`;

  return (
    <div className="fp-dd-wrap" ref={wrapRef}>
      <button ref={triggerRef} className={`fp-dd-trigger${open ? " open" : ""}`} onClick={handleToggle}>
        <svg className="fp-dd-icon" viewBox="0 0 20 20" fill="currentColor">
          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a4 4 0 00-.5-1.93A5.98 5.98 0 0118 18v1h-2zM4.5 15.07A4 4 0 004 17v1H2v-1a5.98 5.98 0 012.5-4.93z"/>
        </svg>
        <span className="fp-dd-label">{label}</span>
        {selectedSns.length > 0 && <span className="fp-dd-badge">{selectedSns.length}</span>}
        <svg className={`fp-dd-caret${open ? " rotated" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div className="fp-dd-menu" style={menuStyle}>
          <div className="fp-dd-search-wrap">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input className="fp-dd-search" placeholder="Search devices…" value={search}
              onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>

          {/* Quick-select: devices in selected area */}
          {selectedAreaId && devicesInSelectedArea.length > 0 && (
            <div className="fp-dd-area-hint" onClick={selectDevicesInArea}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
              </svg>
              Select {devicesInSelectedArea.length} device{devicesInSelectedArea.length !== 1 ? "s" : ""} in this area
            </div>
          )}

          <div className="fp-dd-select-all" onClick={toggleAll}>
            <span className={`fp-cb${selectedSns.length === devices.length ? " checked" : selectedSns.length > 0 ? " indeterminate" : ""}`} />
            <span>Select all</span>
            <span className="fp-dd-count">{devices.length}</span>
          </div>

          <div className="fp-dd-list">
            {filtered.length === 0 && <div className="fp-dd-empty">No devices found</div>}
            {filtered.map((d) => {
              const checked         = selectedSns.includes(d.sn);
              const color           = DEVICE_COLORS[devices.indexOf(d) % DEVICE_COLORS.length];
              const name            = d.assigned_user_name || d.assignedUser || d.sn;
              const areaIds         = deviceAreaMap[d.sn] ?? [];
              const inSelectedArea  = selectedAreaId && areaIds.includes(selectedAreaId);
              const areaNames       = areaIds.map((id) => areas.find((a) => a.id === id)?.name).filter(Boolean);

              return (
                <div key={d.sn} className={`fp-dd-item${checked ? " checked" : ""}${inSelectedArea ? " fp-dd-item-highlight" : ""}`}
                  onClick={() => toggle(d.sn)}>
                  <span className={`fp-cb${checked ? " checked" : ""}`} />
                  <span className="fp-dd-dot" style={{ background: color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="fp-dd-name">{name}</span>
                    {d.sn !== name && <span className="fp-dd-sn">{d.sn}</span>}
                    {areaNames.length > 0 && (
                      <div className="fp-dd-areas">
                        {areaNames.slice(0, 3).map((an) => (
                          <span key={an} className={`fp-dd-area-tag${an === areas.find(a => a.id === selectedAreaId)?.name ? " fp-dd-area-tag-active" : ""}`}>
                            {an}
                          </span>
                        ))}
                        {areaNames.length > 3 && <span className="fp-dd-area-tag">+{areaNames.length - 3}</span>}
                      </div>
                    )}
                  </div>
                  {inSelectedArea && (
                    <span title="Has points in selected area" style={{ fontSize: 9, color: "#4ade80", flexShrink: 0 }}>●</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function FencePageInner() {
  const { devices }     = useDeviceCache();
  const { getPlayback } = useCityTag();
  const { theme: mapTheme } = useMapTheme();

  const [selectedSns, setSelectedSns] = useState([]);
  const [areas, setAreas]             = useState([]);
  const [kmlLoading, setKmlLoading]   = useState(true);
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [areaSearch, setAreaSearch]         = useState("");

  useEffect(() => {
    fetch("/areas.kml")
      .then((res) => res.text())
      .then((kmlText) => setAreas(parseKMLText(kmlText)))
      .catch((err) => console.error("KML load error:", err))
      .finally(() => setKmlLoading(false));
  }, []);

  const [startDate, setStartDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate]     = useState(todayStr());
  const [endTime, setEndTime]     = useState("23:59");

  const [devicePoints, setDevicePoints] = useState({});
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState("");

  const selectedArea = areas.find((a) => a.id === selectedAreaId) ?? null;

  const filteredAreas = useMemo(() =>
    areas.filter((a) => a.name.toLowerCase().includes(areaSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
  [areas, areaSearch]);

  // ── Load points ────────────────────────────────────────────────────────────
  const loadPoints = useCallback(async () => {
    if (!selectedSns.length) { setLoadError("Select at least one device"); return; }
    if (!selectedArea)       { setLoadError("Select a fence area from the sidebar first"); return; }

    setLoading(true); setLoadError(""); setDevicePoints({});

    const start = new Date(`${startDate}T${startTime}:00`);
    const end   = new Date(`${endDate}T${endTime}:59`);
    if (start >= end) { setLoadError("Start must be before end"); setLoading(false); return; }

    const results = await Promise.allSettled(
      selectedSns.map(async (sn) => {
        const res = await getPlayback(sn, start, end);
        const raw = Array.isArray(res) ? res : (res?.points ?? []);
        const pts = raw.map((p) => ({
          lat: Number(p.lat ?? p.latitude  ?? p.gpsLat ?? p.wgLat),
          lng: Number(p.lng ?? p.longitude ?? p.gpsLng ?? p.wgLng),
          ts:  p.timestamp ?? p.time ?? p.locTime ?? null,
        })).filter((p) => !isNaN(p.lat) && !isNaN(p.lng));
        return { sn, pts };
      })
    );

    const next = {};
    results.forEach((r) => { if (r.status === "fulfilled") next[r.value.sn] = r.value.pts; });
    setDevicePoints(next);
    setLoading(false);
  }, [selectedSns, selectedArea, startDate, startTime, endDate, endTime, getPlayback]);

  // ── rangePoints / insidePoints ─────────────────────────────────────────────
  const rangePoints = useMemo(() => {
    if (!selectedArea) return {};
    const rangeStart = new Date(`${startDate}T${startTime}:00`);
    const rangeEnd   = new Date(`${endDate}T${endTime}:59`);
    const result = {};
    Object.entries(devicePoints).forEach(([sn, pts]) => {
      result[sn] = pts.filter((p) => {
        if (!p.ts) return true;
        const d = new Date(p.ts);
        if (isNaN(d)) return true;
        return d >= rangeStart && d <= rangeEnd;
      });
    });
    return result;
  }, [devicePoints, selectedArea, startDate, startTime, endDate, endTime]);

  const insidePoints = useMemo(() => {
    if (!selectedArea) return {};
    const result = {};
    Object.entries(rangePoints).forEach(([sn, pts]) => {
      result[sn] = pts.filter((p) => pointInArea([p.lat, p.lng], selectedArea.coords));
    });
    return result;
  }, [rangePoints, selectedArea]);

  // ── Bidirectional maps ─────────────────────────────────────────────────────
  // deviceAreaMap: { sn → [areaId, ...] }  — which areas each device has points in
  // areaDeviceMap: { areaId → [sn, ...] }  — which devices have points in each area
  const { deviceAreaMap, areaDeviceMap } = useMemo(() => {
    const devArea = {};   // sn → Set<areaId>
    const areaDev = {};   // areaId → Set<sn>

    if (!Object.keys(devicePoints).length) return { deviceAreaMap: {}, areaDeviceMap: {} };

    Object.entries(devicePoints).forEach(([sn, pts]) => {
      pts.forEach((p) => {
        areas.forEach((area) => {
          if (pointInArea([p.lat, p.lng], area.coords)) {
            if (!devArea[sn]) devArea[sn] = new Set();
            devArea[sn].add(area.id);
            if (!areaDev[area.id]) areaDev[area.id] = new Set();
            areaDev[area.id].add(sn);
          }
        });
      });
    });

    // Convert Sets to arrays
    const deviceAreaMap = Object.fromEntries(Object.entries(devArea).map(([k, v]) => [k, [...v]]));
    const areaDeviceMap = Object.fromEntries(Object.entries(areaDev).map(([k, v]) => [k, [...v]]));
    return { deviceAreaMap, areaDeviceMap };
  }, [devicePoints, areas]);

  // ── Per-day durations ──────────────────────────────────────────────────────
  const perDayDurations = useMemo(() => {
    if (!selectedArea) return [];
    const dayMap = {};
    Object.values(insidePoints).forEach((pts) => {
      pts.forEach((p) => {
        if (!p.ts) return;
        const dt  = new Date(p.ts);
        if (isNaN(dt)) return;
        const key = localDateStr(dt);
        if (!dayMap[key]) dayMap[key] = [];
        dayMap[key].push(dt);
      });
    });
    return Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, times]) => {
        times.sort((a, b) => a - b);
        return { date, durationMs: times[times.length - 1] - times[0], pointCount: times.length };
      });
  }, [insidePoints, selectedArea]);

  const totalDurationMs = useMemo(() => perDayDurations.reduce((s, d) => s + d.durationMs, 0), [perDayDurations]);
  const totalInside     = useMemo(() => Object.values(insidePoints).reduce((s, pts) => s + pts.length, 0), [insidePoints]);
  const totalLoaded     = useMemo(() => Object.values(rangePoints).reduce((s, pts) => s + pts.length, 0), [rangePoints]);

  // ── Per-area stats for polygon tooltips ───────────────────────────────────
  const areaStats = useMemo(() => {
    if (!Object.keys(devicePoints).length) return {};
    const stats = {};
    areas.forEach((area) => {
      const allInside = [];
      Object.values(devicePoints).forEach((pts) => {
        pts.forEach((p) => { if (pointInArea([p.lat, p.lng], area.coords)) allInside.push(p); });
      });
      if (!allInside.length) return;
      const dayMap = {};
      allInside.forEach((p) => {
        if (!p.ts) return;
        const dt = new Date(p.ts);
        if (isNaN(dt)) return;
        const key = localDateStr(dt);
        if (!dayMap[key]) dayMap[key] = [];
        dayMap[key].push(dt);
      });
      const days = Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, times]) => { times.sort((a, b) => a - b); return { date, durationMs: times[times.length - 1] - times[0], pointCount: times.length }; });
      stats[area.id] = { pointCount: allInside.length, totalMs: days.reduce((s, d) => s + d.durationMs, 0), days };
    });
    return stats;
  }, [areas, devicePoints]);

  const deviceColorMap = useMemo(() => {
    const map = {};
    devices.forEach((d, i) => { map[d.sn] = DEVICE_COLORS[i % DEVICE_COLORS.length]; });
    return map;
  }, [devices]);

  // When an area is selected, pre-select region-assigned devices first,
  // then fall back to data-driven areaDeviceMap if no assigned devices found.
  const handleAreaSelect = useCallback((areaId) => {
    const isDeselecting = areaId === selectedAreaId;
    setSelectedAreaId(isDeselecting ? null : areaId);
    setDevicePoints({});
    if (!isDeselecting) {
      const areaName = areas.find((a) => a.id === areaId)?.name ?? "";
      const regionDevices = devices
        .filter((d) => d.region?.toLowerCase() === areaName.toLowerCase())
        .map((d) => d.sn);
      if (regionDevices.length > 0) {
        setSelectedSns(regionDevices);
      } else if (areaDeviceMap[areaId]?.length) {
        // Fallback: auto-select devices that have points in this area
        setSelectedSns(areaDeviceMap[areaId]);
      }
    }
  }, [selectedAreaId, areaDeviceMap, areas, devices]);

  // D1: When a single device is selected, auto-select its assigned region area in the sidebar
  useEffect(() => {
    if (selectedSns.length !== 1 || !areas.length) return;
    const dev = devices.find((d) => d.sn === selectedSns[0]);
    if (!dev?.region) return;
    const match = areas.find((a) => a.name.toLowerCase() === dev.region.toLowerCase());
    if (match && match.id !== selectedAreaId) {
      setSelectedAreaId(match.id);
      setDevicePoints({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSns, areas]);

  const mapCenter = selectedArea ? centroid(selectedArea.coords) : [30.9, 74.2];

  // Areas that have data for currently selected devices
  const activeAreaIds = useMemo(() => new Set(
    selectedSns.flatMap((sn) => deviceAreaMap[sn] ?? [])
  ), [selectedSns, deviceAreaMap]);

  return (
    <div className="fp-page">

      {/* ── Top bar ── */}
      <div className="fp-topbar">
        <div className="fp-topbar-left">
          <span className="fp-topbar-label">Geofencing</span>
          {selectedArea && (
            <span className="fp-topbar-area">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10a1 1 0 100-2 1 1 0 000 2z"/>
              </svg>
              {selectedArea.name}
              {selectedArea.ucNo && <span className="fp-topbar-tehsil">{selectedArea.ucNo}</span>}
            </span>
          )}
          {/* Show how many areas selected devices span */}
          {activeAreaIds.size > 0 && (
            <span className="fp-topbar-area" style={{ color: "#60a5fa", borderColor: "rgba(59,130,246,0.3)" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              {activeAreaIds.size} area{activeAreaIds.size !== 1 ? "s" : ""} with data
            </span>
          )}
        </div>

        <div className="fp-topbar-right">
          <DeviceDropdown
            devices={devices}
            selectedSns={selectedSns}
            onChange={setSelectedSns}
            deviceAreaMap={deviceAreaMap}
            selectedAreaId={selectedAreaId}
            areas={areas}
          />

          <div className="fp-date-group">
            <label>Start</label>
            <div className="fp-date-btn" onClick={(e) => e.currentTarget.querySelector("input[type=date]").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              <span>{startDate}</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="fp-date-btn" onClick={(e) => e.currentTarget.querySelector("input[type=time]").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>{startTime}</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          <div className="fp-date-group">
            <label>End</label>
            <div className="fp-date-btn" onClick={(e) => e.currentTarget.querySelector("input[type=date]").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              <span>{endDate}</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="fp-date-btn" onClick={(e) => e.currentTarget.querySelector("input[type=time]").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>{endTime}</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <button className="fp-btn-load" onClick={loadPoints}
            disabled={!selectedSns.length || !selectedArea || loading}>
            {loading ? <><span className="fp-spinner" /> Loading…</> : "Load Points"}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="fp-error">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          {loadError}
          <button className="fp-error-close" onClick={() => setLoadError("")}>✕</button>
        </div>
      )}

      <div className="fp-body">

        {/* ── Sidebar ── */}
        <aside className="fp-sidebar">
          <div className="fp-sidebar-header">
            <div className="fp-sidebar-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10a1 1 0 100-2 1 1 0 000 2z"/>
              </svg>
              Areas
              <span className="fp-sidebar-count">{areas.length}</span>
            </div>
            <div className="fp-search-wrap">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input className="fp-search" placeholder="Search areas…" value={areaSearch}
                onChange={(e) => setAreaSearch(e.target.value)} />
            </div>
          </div>

          {selectedArea && totalLoaded > 0 && (
            <div className="fp-area-stats">
              <div className="fp-astat green">
                <span className="fp-astat-val">{totalInside}</span>
                <span className="fp-astat-lbl">Inside</span>
              </div>
              <div className="fp-astat dim">
                <span className="fp-astat-val">{totalLoaded - totalInside}</span>
                <span className="fp-astat-lbl">Outside</span>
              </div>
              <div className="fp-astat">
                <span className="fp-astat-val">{totalLoaded}</span>
                <span className="fp-astat-lbl">Total</span>
              </div>
            </div>
          )}

          {perDayDurations.length > 0 && (
            <div className="fp-duration-box">
              <div className="fp-duration-header">
                <h4>Duration (inside)</h4>
                <span className="fp-duration-total">
                  Total: <strong>{formatDuration(totalDurationMs)}</strong>
                  <span className="fp-duration-days"> · {perDayDurations.length} day{perDayDurations.length > 1 ? "s" : ""}</span>
                </span>
              </div>
              <div className="fp-duration-table">
                <div className="fp-duration-thead"><span>Date</span><span>Duration</span><span>Pts</span></div>
                {perDayDurations.map((row) => (
                  <div key={row.date} className="fp-duration-row">
                    <span className="fp-dr-date">{row.date}</span>
                    <span className="fp-dr-dur">
                      <span className="fp-dr-bar" style={{ width: `${Math.min(100, (row.durationMs / (totalDurationMs || 1)) * 100 * perDayDurations.length)}%` }} />
                      {formatDuration(row.durationMs)}
                    </span>
                    <span className="fp-dr-pts">{row.pointCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="fp-area-list">
            {areas.length === 0 ? (
              <div className="fp-no-areas">
                {kmlLoading ? (
                  <>
                    <style>{`@keyframes tpl-pulse { 0%{opacity:0.15;transform:scale(0.95)} 50%{opacity:0.7;transform:scale(1.02)} 100%{opacity:0.15;transform:scale(0.95)} }`}</style>
                    <img src={tplLogo} alt="Loading" style={{ width: 48, height: "auto", filter: "brightness(0) invert(1)", animation: "tpl-pulse 1.6s ease-in-out infinite" }} />
                    <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Loading areas…</span>
                  </>
                ) : <p>No areas available</p>}
              </div>
            ) : filteredAreas.length === 0 ? (
              <div className="fp-no-results">No areas match "{areaSearch}"</div>
            ) : filteredAreas.map((area) => {
              const isSelected    = area.id === selectedAreaId;
              const insideCnt     = isSelected ? totalInside : null;
              // How many of the currently selected devices have data in this area
              const devsInArea    = (areaDeviceMap[area.id] ?? []).filter((sn) => selectedSns.includes(sn)).length;
              const hasData       = activeAreaIds.has(area.id);
              // How many devices are assigned to this area via device.region (metadata)
              const assignedCount = devices.filter((d) =>
                d.region?.toLowerCase() === area.name.toLowerCase()
              ).length;

              return (
                <div key={area.id}
                  className={`fp-area-item${isSelected ? " active" : ""}${hasData && !isSelected ? " fp-area-item-hasdata" : ""}`}
                  onClick={() => handleAreaSelect(area.id)}>
                  <div className="fp-area-name">
                    {area.name}
                    {hasData && !isSelected && (
                      <span className="fp-area-data-dot" title="Selected devices have data here" />
                    )}
                  </div>
                  <div className="fp-area-meta">
                    {area.ucNo && <span className="fp-area-type">{area.ucNo}</span>}
                    {assignedCount > 0 && (
                      <span className="fp-area-dev-count" style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.3)" }} title="Devices assigned to this region">
                        {assignedCount} assigned
                      </span>
                    )}
                    {devsInArea > 0 && (
                      <span className="fp-area-dev-count">{devsInArea} device{devsInArea !== 1 ? "s" : ""}</span>
                    )}
                    {insideCnt !== null && totalLoaded > 0 && (
                      <span className="fp-area-inside">{insideCnt} pts inside</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {areas.length > 0 && (
            <div className="fp-sidebar-footer">
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{areas.length} areas loaded</span>
            </div>
          )}
        </aside>

        {/* ── Map ── */}
        <div className="fp-map-wrap">

          {(!selectedArea || !selectedSns.length) && (
            <div className="fp-map-overlay">
              {kmlLoading ? (
                <>
                  <style>{`@keyframes tpl-pulse { 0%{opacity:0.15;transform:scale(0.95)} 50%{opacity:0.7;transform:scale(1.02)} 100%{opacity:0.15;transform:scale(0.95)} }`}</style>
                  <img src={tplLogo} alt="Loading" style={{ width: 48, height: "auto", filter: "brightness(0) invert(1)", animation: "tpl-pulse 1.6s ease-in-out infinite" }} />
                  <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.08em", textTransform: "uppercase" }}>Loading areas…</span>
                </>
              ) : (
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 10, textAlign: "center", pointerEvents: "none" }}>
                  <div style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", border: "1px solid #2d2d2d", borderRadius: 14, padding: "20px 32px", maxWidth: 270 }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>📍</div>
                    <div style={{ color: "#737373", fontSize: 14, fontWeight: 600 }}>Select a device and an area to get started</div>
                  </div>
                </div>
              )}
            </div>
          )}

          <MapContainer center={mapCenter} zoom={11} style={{ width: "100%", height: "100%" }}
            dragging scrollWheelZoom doubleClickZoom boxZoom={false} keyboard zoomControl>

            <TileLayer
              url={`https://api.mapbox.com/styles/v1/mapbox/${mapTheme === "dark" ? "dark-v11" : "light-v11"}/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`}
              attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a>'
              tileSize={512} zoomOffset={-1}
            />

            {selectedArea && <FitBounds coords={selectedArea.coords} />}

            {areas.map((area) => {
              const polyList    = Array.isArray(area.coords[0][0]) ? area.coords : [area.coords];
              const isSelected  = area.id === selectedAreaId;
              const isActive    = activeAreaIds.has(area.id);  // selected devices have data here
              const stat        = areaStats[area.id];
              const devsInArea  = areaDeviceMap[area.id] ?? [];

              return polyList.map((poly, pi) => (
                <Polygon key={`${area.id}-${pi}`} positions={poly}
                  pathOptions={
                    isSelected
                      ? { color: "#991b1b", fillColor: "#ef4444", fillOpacity: 0.18, weight: 2.5 }
                      : isActive
                        ? { color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.12, weight: 1.8, dashArray: undefined }
                        : { color: "#64748b", fillColor: "#64748b", fillOpacity: 0.04, weight: 0.8, dashArray: "4 4" }
                  }
                >
                  {pi === 0 && (
                    <Tooltip sticky>
                      <span style={{ fontSize: 11, lineHeight: 1.7 }}>
                        <strong style={{ fontSize: 12 }}>{area.name}</strong>
                        {devsInArea.length > 0 && (
                          <>
                            <br />
                            <span style={{ color: "#3b82f6" }}>
                              {devsInArea.length} device{devsInArea.length !== 1 ? "s" : ""} with data here
                            </span>
                          </>
                        )}
                        {stat ? (
                          <>
                            <br />
                            <span style={{ color: "#16a34a" }}>● {stat.pointCount} pts inside</span>
                            {"  "}
                            <strong>{formatDuration(stat.totalMs)}</strong>
                            {stat.days.length > 0 && stat.days.map((day) => (
                              <span key={day.date} style={{ display: "block", paddingLeft: 4, color: "#374151", fontSize: 10.5 }}>
                                {day.date} — <strong>{formatDuration(day.durationMs)}</strong> ({day.pointCount} pts)
                              </span>
                            ))}
                          </>
                        ) : (
                          <><br /><span style={{ color: "#9ca3af" }}>No points in this area</span></>
                        )}
                      </span>
                    </Tooltip>
                  )}
                </Polygon>
              ));
            })}

            {selectedArea && Object.entries(rangePoints).map(([sn, pts]) => {
              const color     = deviceColorMap[sn] || "#60a5fa";
              const insideSet = new Set((insidePoints[sn] || []).map((p) => `${p.lat}|${p.lng}|${p.ts}`));
              return pts.map((p, i) => {
                const isInside = insideSet.has(`${p.lat}|${p.lng}|${p.ts}`);
                return (
                  <CircleMarker key={`${sn}-${i}`} center={[p.lat, p.lng]}
                    radius={isInside ? 6 : 5}
                    pathOptions={{ color: "transparent", fillColor: isInside ? color : "#334155", fillOpacity: isInside ? 1 : 0.75 }}>
                    {p.ts && (
                      <Tooltip>
                        <span style={{ fontSize: 11 }}>
                          <strong>{devices.find((d) => d.sn === sn)?.assigned_user_name || sn}</strong>
                          <br />{formatTime(p.ts)}
                          <br /><span style={{ color: isInside ? "#16a34a" : "#94a3b8" }}>{isInside ? "● inside" : "○ outside"}</span>
                        </span>
                      </Tooltip>
                    )}
                  </CircleMarker>
                );
              });
            })}
          </MapContainer>

          {selectedArea && totalLoaded > 0 && (
            <div className="fp-legend">
              {selectedSns.map((sn) => {
                const allPts    = rangePoints[sn] || [];
                if (!allPts.length) return null;
                const insidePts = insidePoints[sn] || [];
                const color     = deviceColorMap[sn] || "#60a5fa";
                const name      = devices.find((d) => d.sn === sn)?.assigned_user_name || sn;
                const areaCount = (deviceAreaMap[sn] ?? []).length;
                return (
                  <div key={sn} className="fp-legend-item">
                    <span className="fp-legend-dot" style={{ background: color }} />
                    <span className="fp-legend-name">{name}</span>
                    {areaCount > 0 && <span className="fp-legend-count" style={{ color: "#60a5fa" }}>{areaCount} area{areaCount !== 1 ? "s" : ""}</span>}
                    <span className="fp-legend-count fp-legend-inside">{insidePts.length} in</span>
                    <span className="fp-legend-count">{allPts.length} total</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FencePage() {
  return <ErrorBoundary><FencePageInner /></ErrorBoundary>;
}