import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MapView from "../components/MapView.jsx";
import DeviceSidebar from "../components/Devicesidebar.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import { reverseGeocode } from "../utils/reverseGeocode.js";
import "./TrajectoryPage.css";

function isDuplicate(p1, p2) {
  if (!p1 || !p2) return false;
  const ts  = (p) => p?.timestamp ?? p?.time ?? p?.locTime;
  const lat = (p) => p?.lat ?? p?.latitude ?? p?.gpsLat ?? p?.wgLat;
  const lng = (p) => p?.lng ?? p?.lon ?? p?.longitude ?? p?.gpsLng ?? p?.wgLng;
  return lat(p1) === lat(p2) && lng(p1) === lng(p2) && ts(p1) === ts(p2);
}

function todayStr() { return new Date().toISOString().split("T")[0]; }

function formatDateTime(point) {
  const ts = point?.timestamp ?? point?.time ?? point?.locTime;
  if (!ts) return "—";
  try { const d = new Date(ts); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString(); }
  catch { return "—"; }
}

function extractCoords(point) {
  if (!point || typeof point !== "object") return null;
  const lat = point.lat ?? point.latitude ?? point.gpsLat ?? point.wgLat;
  const lng = point.lng ?? point.lon ?? point.longitude ?? point.gpsLng ?? point.wgLng;
  const latNum = Number(lat), lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  return { lat: latNum, lng: lngNum };
}

function normaliseTrajectoryResponse(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.points)) return data.points;
  if (data.feature?.geometry?.coordinates) {
    const coords     = data.feature.geometry.coordinates;
    const timestamps = data.feature.properties?.timestamps ?? [];
    // Map each [lng, lat] coord to a point object with its timestamp so
    // MapView hover popups can display the time for every trajectory dot.
    return coords.map(([lng, lat], i) => ({
      lng,
      lat,
      timestamp: timestamps[i] ?? null,
    }));
  }
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data.features.flatMap((f) =>
      (f?.geometry?.coordinates ?? []).map(([lng, lat], i) => ({
        lng, lat, timestamp: f?.properties?.timestamps?.[i] ?? null,
      }))
    );
  }
  if (data.geometry?.coordinates) {
    const ts = data.properties?.timestamps ?? [];
    return data.geometry.coordinates.map(([lng, lat], i) => ({ lng, lat, timestamp: ts[i] ?? null }));
  }
  if (Array.isArray(data.coordinates)) {
    return data.coordinates.map(([lng, lat]) => ({ lng, lat }));
  }
  return [];
}

const TIME_SHORTCUTS = [
  { label: "1H",  hours: 1   },
  { label: "3H",  hours: 3   },
  { label: "6H",  hours: 6   },
  { label: "1D",  hours: 24  },
  { label: "7D",  hours: 168 },
];

export default function TrajectoryPage() {
  const [searchParams] = useSearchParams();
  const { getLatestLocation, getTrajectory } = useCityTag();
  const [label, setLabel] = useState("");

  const [sn, setSn]                         = useState(searchParams.get("device") || "");
  const [sessionTraj, setSessionTraj]       = useState([]);
  const [historicalTraj, setHistoricalTraj] = useState([]);
  const [latest, setLatest]                 = useState(null);
  const [mode, setMode]                     = useState("session");

  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate]     = useState(todayStr());
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime]     = useState("23:59");

  const [histLoading, setHistLoading]       = useState(false);
  const [histError, setHistError]           = useState("");
  const [activeShortcut, setActiveShortcut] = useState(null);

  const [startLocation, setStartLocation] = useState(null);
  const [endLocation,   setEndLocation]   = useState(null);

  const liveIntervalRef = useRef(null);

  const refreshLive = useCallback(async (target) => {
    const dev = target ?? sn;
    if (!dev) return;
    try {
      const res   = await getLatestLocation(dev);
      const point = res?.latest ?? res ?? null;
      setLatest(point);
      if (point) {
        setSessionTraj((prev) => {
          if (isDuplicate(prev[prev.length - 1], point)) return prev;
          const next = [...prev, point];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    } catch { /* silent */ }
  }, [sn, getLatestLocation]);

  useEffect(() => {
    clearInterval(liveIntervalRef.current);
    if (sn) liveIntervalRef.current = setInterval(() => refreshLive(), 15000);
    return () => clearInterval(liveIntervalRef.current);
  }, [sn, refreshLive]);

  const handleSelectDevice = (device) => {
    const newSn    = typeof device === "string" ? device : (device?.sn ?? "");
    const newLabel = typeof device === "string" ? "" : (device?.assignedUser ?? "");
    setSn(newSn);
    setLabel(newLabel);
    setSessionTraj([]);
    setHistoricalTraj([]);
    setLatest(null);
    setMode("session");
    setHistError("");
    setActiveShortcut(null);
    setStartLocation(null);
    setEndLocation(null);
    refreshLive(newSn);
  };

  const loadHistorical = async (overrideStart, overrideEnd) => {
    if (!sn) return;
    setHistError("");
    setHistLoading(true);
    try {
      // Picker value IS the UTC value, no offset needed
      const start = overrideStart ?? new Date(`${startDate}T${startTime}:00Z`);
      const end   = overrideEnd   ?? new Date(`${endDate}T${endTime}:59Z`);
      if (start >= end) throw new Error("Start must be before end");
      const res    = await getTrajectory(sn, start, end);
      const points = normaliseTrajectoryResponse(res);
      if (points.length === 0) throw new Error("No data found in that time range");
      setHistoricalTraj(points);
      setMode("historical");
    } catch (err) {
      setHistError(err.message || "Failed to load trajectory");
    } finally {
      setHistLoading(false);
    }
  };

  const handleShortcut = (shortcut) => {
    if (!sn) { setHistError("Select a device first"); return; }
    const now   = new Date();
    const start = new Date(now.getTime() - shortcut.hours * 60 * 60 * 1000);
    const toDateStr = (d) => d.toISOString().split("T")[0];
    const toTimeStr = (d) => d.toTimeString().slice(0, 5);
    setStartDate(toDateStr(start));
    setStartTime(toTimeStr(start));
    setEndDate(toDateStr(now));
    setEndTime(toTimeStr(now));
    setActiveShortcut(shortcut.label);
    // Shortcut passes real Date objects — no PKT adjustment needed
    loadHistorical(start, now);
  };

  const activeTraj   = mode === "historical" ? historicalTraj : sessionTraj;
  const activeLatest = mode === "historical" ? (historicalTraj[historicalTraj.length - 1] ?? null) : latest;

  // Geocode first and last points when trajectory changes
  useEffect(() => {
    setStartLocation(null);
    setEndLocation(null);
    if (activeTraj.length === 0) return;

    const firstCoords = extractCoords(activeTraj[0]);
    const lastCoords  = extractCoords(activeTraj[activeTraj.length - 1]);

    if (firstCoords) {
      reverseGeocode(firstCoords.lat, firstCoords.lng).then((g) => {
        setStartLocation(g?.primary ?? null);
      });
    }
    if (lastCoords && activeTraj.length > 1) {
      reverseGeocode(lastCoords.lat, lastCoords.lng).then((g) => {
        setEndLocation(g?.primary ?? null);
      });
    }
  }, [activeTraj]);

  return (
    <div className="tr-page">

      {/* ── Top bar ────────────────────────────────── */}
      <div className="tr-topbar">
        <div className="tr-topbar-left">
          <span className="tr-topbar-label">Trajectory</span>
          {sn && <span className="tr-topbar-sn">{sn}</span>}
          {sn && (
            <span className={`tr-pill ${latest ? "pill-live" : "pill-dim"}`}>
              <span className="tr-pill-dot" />{latest ? "Live" : "Searching"}
            </span>
          )}
          {activeTraj.length > 0 && (
            <span className="tr-pill pill-maroon">{activeTraj.length} pts</span>
          )}
        </div>

        <div className="tr-topbar-right">
          <div className="tr-shortcuts">
            {TIME_SHORTCUTS.map((shortcut) => (
              <button key={shortcut.label}
                className={`tr-shortcut-btn${activeShortcut === shortcut.label ? " active" : ""}`}
                onClick={() => handleShortcut(shortcut)} disabled={histLoading}>
                {activeShortcut === shortcut.label && histLoading ? <span className="tr-spinner" /> : shortcut.label}
              </button>
            ))}
          </div>
          <div className="tr-date-group">
            <label>Start</label>
            <div className="tr-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              <span>{startDate}</span>
              <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActiveShortcut(null); }} />
            </div>
            <div className="tr-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>{startTime}</span>
              <input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setActiveShortcut(null); }} />
            </div>
          </div>
          <div className="tr-date-group">
            <label>End</label>
            <div className="tr-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              <span>{endDate}</span>
              <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActiveShortcut(null); }} />
            </div>
            <div className="tr-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>{endTime}</span>
              <input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setActiveShortcut(null); }} />
            </div>
          </div>
          <button className="tr-btn-load" onClick={() => loadHistorical()} disabled={!sn || histLoading}>
            {histLoading ? <><span className="tr-spinner" /> Loading…</> : <>Load History</>}
          </button>
          <div className="tr-mode-toggle">
            <button className={`tr-mode-btn ${mode === "session" ? "active" : ""}`} onClick={() => setMode("session")}>
              Session
            </button>
            <button
              className={`tr-mode-btn ${mode === "historical" ? "active" : ""}`}
              onClick={() => setMode("historical")}
              disabled={historicalTraj.length === 0}
              title={historicalTraj.length === 0 ? "Load a date range first" : ""}
            >
              Historical
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {histError && (
        <div className="tr-error">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          {histError}
          <button className="tr-error-close" onClick={() => setHistError("")}>✕</button>
        </div>
      )}

      {/* ── Body ─────────────────────────────────── */}
      <div className="tr-body">
        <DeviceSidebar selectedSn={sn} onSelect={handleSelectDevice} />

        <div className="tr-map-area">
          <div className="tr-map-wrap">
            <MapView sn={sn} label={label} latest={activeLatest} trajectory={activeTraj} playbackPoint={null} />
          </div>

          {sn && (
            <div className="tr-stats-strip">
              <div className="tr-stat-item">
                <span className="tr-stat-label">Source</span>
                <span className="tr-stat-val">{mode === "session" ? "Live session" : "Historical"}</span>
              </div>
              <div className="tr-stat-sep" />
              <div className="tr-stat-item">
                <span className="tr-stat-label">Points</span>
                <span className="tr-stat-val mono">{activeTraj.length}</span>
              </div>
              {activeTraj.length > 0 && (
                <>
                  <div className="tr-stat-sep" />
                  <div className="tr-stat-item">
                    <span className="tr-stat-label">From</span>
                    <span className="tr-stat-val">
                      {startLocation ?? formatDateTime(activeTraj[0])}
                    </span>
                  </div>
                  <div className="tr-stat-sep" />
                  <div className="tr-stat-item">
                    <span className="tr-stat-label">To</span>
                    <span className="tr-stat-val">
                      {endLocation ?? "—"}
                    </span>
                  </div>
                </>
              )}
              <button className="tr-clear-btn" onClick={() => {
                setSessionTraj([]); setHistoricalTraj([]);
                setLatest(null); setMode("session"); setActiveShortcut(null);
                setStartLocation(null); setEndLocation(null);
              }}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}