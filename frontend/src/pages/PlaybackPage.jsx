import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MapView from "../components/MapView.jsx";
import DeviceSidebar from "../components/Devicesidebar.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import "./PlaybackPage.css";


function isDuplicate(p1, p2) {
  if (!p1 || !p2) return false;
  const ts  = (p) => p?.timestamp ?? p?.time ?? p?.locTime;
  const lat = (p) => p?.lat ?? p?.latitude ?? p?.gpsLat ?? p?.wgLat;
  const lng = (p) => p?.lng ?? p?.lon ?? p?.longitude ?? p?.gpsLng ?? p?.wgLng;
  return lat(p1) === lat(p2) && lng(p1) === lng(p2) && ts(p1) === ts(p2);
}

function todayStr() { return new Date().toISOString().split("T")[0]; }

function formatTs(point) {
  const ts = point?.timestamp ?? point?.time ?? point?.locTime;
  if (!ts) return "—";
  try { const d = new Date(ts); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString(); }
  catch { return "—"; }
}

function normalisePlayback(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.points)) return data.points;
  if (data.geometry?.coordinates) {
    const ts = data.properties?.timestamps ?? [];
    return data.geometry.coordinates.map(([lng, lat], i) => ({ lng, lat, timestamp: ts[i] ?? null }));
  }
  return [];
}

const SPEEDS = [
  { label: "Slow",   value: 1500 },
  { label: "Normal", value: 800  },
  { label: "Fast",   value: 300  },
  { label: "Rapid",  value: 100  },
];

const TIME_SHORTCUTS = [
  { label: "1H",  hours: 1   },
  { label: "3H",  hours: 3   },
  { label: "6H",  hours: 6   },
  { label: "1D",  hours: 24  },
  { label: "7D",  hours: 168 },
];

export default function PlaybackPage() {
  const [searchParams] = useSearchParams();
  const { getLatestLocation, getPlayback } = useCityTag();
  const [label, setLabel] = useState("");

  const [sn, setSn]                         = useState(searchParams.get("device") || "");
  const [sessionTraj, setSessionTraj]       = useState([]);
  const [historicalTraj, setHistoricalTraj] = useState([]);
  const [latest, setLatest]                 = useState(null);
  const [dataSource, setDataSource]         = useState("session");
  const [isLiveMode, setIsLiveMode]         = useState(true);

  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate]     = useState(todayStr());
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime]     = useState("23:59");

  const [playbackIndex, setPlaybackIndex]   = useState(0);
  const [playing, setPlaying]               = useState(false);
  const [speed, setSpeed]                   = useState(800);

  const [histLoading, setHistLoading]       = useState(false);
  const [histError, setHistError]           = useState("");
  const [lastUpdated, setLastUpdated]       = useState(null);
  const [activeShortcut, setActiveShortcut] = useState(null);

  const liveIntervalRef = useRef(null);

  const refreshLive = useCallback(async (target) => {
    const dev = target ?? sn;
    if (!dev || !isLiveMode) return;
    try {
      const res   = await getLatestLocation(dev);
      const point = res?.latest ?? res ?? null;
      setLatest(point);
      setLastUpdated(new Date());
      if (point) {
        setSessionTraj((prev) => {
          if (isDuplicate(prev[prev.length - 1], point)) return prev;
          const next = [...prev, point];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    } catch { /* silent */ }
  }, [sn, isLiveMode, getLatestLocation]);

  useEffect(() => {
    clearInterval(liveIntervalRef.current);
    if (sn && isLiveMode) liveIntervalRef.current = setInterval(() => refreshLive(), 15000);
    return () => clearInterval(liveIntervalRef.current);
  }, [sn, isLiveMode, refreshLive]);

  const handleSelectDevice = (device) => {
    const newSn    = typeof device === "string" ? device : (device?.sn ?? "");
    const newLabel = typeof device === "string" ? "" : (device?.assignedUser ?? "");
    setSn(newSn);
    setLabel(newLabel);
    setSessionTraj([]);
    setHistoricalTraj([]);
    setLatest(null);
    setPlaying(false);
    setPlaybackIndex(0);
    setIsLiveMode(true);
    setDataSource("session");
    setHistError("");
    setActiveShortcut(null);
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
      const res    = await getPlayback(sn, start, end);
      const points = normalisePlayback(res);
      if (points.length === 0) throw new Error("No data found in that time range");
      setHistoricalTraj(points);
      setDataSource("historical");
      setPlaying(false);
      setPlaybackIndex(0);
      setIsLiveMode(false);
    } catch (err) {
      setHistError(err.message || "Failed to load playback data");
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
    // Shortcut uses real Date objects — no PKT adjustment needed
    loadHistorical(start, now);
  };

  /* ── Playback engine ──────────────────────────── */
  const trajectory = dataSource === "historical" ? historicalTraj : sessionTraj;

  useEffect(() => {
    if (!playing) return;
    if (playbackIndex >= trajectory.length - 1) {
      setPlaying(false);
      if (dataSource === "session") setIsLiveMode(true);
      return;
    }
    const t = setTimeout(() => setPlaybackIndex((i) => i + 1), speed);
    return () => clearTimeout(t);
  }, [playing, playbackIndex, trajectory.length, speed, dataSource]);

  useEffect(() => { if (playing) setIsLiveMode(false); }, [playing]);

  const playbackPoint = useMemo(() => {
    if (!isLiveMode && playbackIndex < trajectory.length) return trajectory[playbackIndex];
    return null;
  }, [isLiveMode, playbackIndex, trajectory]);

  const handlePlay   = () => {
    if (trajectory.length === 0) { setHistError("No data yet. Collect live points or load historical."); return; }
    if (playbackIndex >= trajectory.length - 1) setPlaybackIndex(0);
    setPlaying(true);
    setIsLiveMode(false);
  };
  const handlePause  = () => setPlaying(false);
  const handleReset  = () => { setPlaybackIndex(0); setPlaying(false); if (dataSource === "session") setIsLiveMode(true); };
  const handleSlider = (e) => { setPlaybackIndex(Number(e.target.value)); setPlaying(false); setIsLiveMode(false); };

  const progress  = trajectory.length > 1 ? Math.round((playbackIndex / (trajectory.length - 1)) * 100) : 0;
  const infoPoint = isLiveMode ? latest : (trajectory[playbackIndex] ?? null);

  return (
    <div className="pb-page">

      {/* ── Top bar ────────────────────────────────── */}
      <div className="pb-topbar">
        <div className="pb-topbar-left">
          <span className="pb-topbar-label">Playback</span>
          {sn && <span className="pb-topbar-sn">{sn}</span>}
          {sn && (
            <span className={`pb-pill ${!isLiveMode ? "pill-playback" : latest ? "pill-live" : "pill-dim"}`}>
              <span className="pb-pill-dot" />
              {!isLiveMode ? "Playback" : latest ? "Live" : "Searching"}
            </span>
          )}
          {lastUpdated && <span className="pb-pill pill-dim">{lastUpdated.toLocaleTimeString()}</span>}
        </div>

        <div className="pb-topbar-right">
          <div className="pb-shortcuts">
            {TIME_SHORTCUTS.map((shortcut) => (
              <button key={shortcut.label}
                className={`pb-shortcut-btn${activeShortcut === shortcut.label ? " active" : ""}`}
                onClick={() => handleShortcut(shortcut)} disabled={histLoading}>
                {activeShortcut === shortcut.label && histLoading ? <span className="pb-spinner" /> : shortcut.label}
              </button>
            ))}
          </div>
          <div className="pb-date-group">
            <label>Start</label>
            <div className="pb-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              <span>{startDate}</span>
              <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActiveShortcut(null); }} />
            </div>
            <div className="pb-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>{startTime}</span>
              <input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setActiveShortcut(null); }} />
            </div>
          </div>
          <div className="pb-date-group">
            <label>End</label>
            <div className="pb-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              <span>{endDate}</span>
              <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActiveShortcut(null); }} />
            </div>
            <div className="pb-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>{endTime}</span>
              <input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setActiveShortcut(null); }} />
            </div>
          </div>
          <button className="pb-btn-load" onClick={() => loadHistorical()} disabled={!sn || histLoading}>
            {histLoading ? <><span className="pb-spinner" /> Loading…</> : <>Load Playback</>}
          </button>
          <select className="pb-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {sn && (
            <div className="pb-source-toggle">
              <button className={`pb-source-btn ${dataSource === "session" ? "active" : ""}`}
                onClick={() => { setDataSource("session"); setPlaying(false); setPlaybackIndex(0); setIsLiveMode(true); }}>
                Session
              </button>
              <button
                className={`pb-source-btn ${dataSource === "historical" ? "active" : ""}`}
                onClick={() => { setDataSource("historical"); setPlaying(false); setPlaybackIndex(0); setIsLiveMode(false); }}
                disabled={historicalTraj.length === 0}
                title={historicalTraj.length === 0 ? "Load a date range first" : ""}
              >Historical</button>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {histError && (
        <div className="pb-error">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          {histError}
          <button className="pb-error-close" onClick={() => setHistError("")}>✕</button>
        </div>
      )}

      {/* ── Body ─────────────────────────────────── */}
      <div className="pb-body">
        <DeviceSidebar selectedSn={sn} onSelect={handleSelectDevice} />

        <div className="pb-main">
          <div className="pb-map-wrap">
            <MapView sn={sn} label={label} latest={latest} trajectory={trajectory} playbackPoint={playbackPoint} showLine={false} />
          </div>

          {/* Playback controls */}
          <div className="pb-controls-strip">
            <div className="pb-engine-btns">
              <button className="pb-play-btn" onClick={playing ? handlePause : handlePlay} disabled={trajectory.length === 0}>
                {playing
                  ? <><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>Pause</>
                  : <><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Play</>
                }
              </button>
              <button className="pb-ctrl-btn" onClick={handleReset}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
                Reset
              </button>
            </div>

            <div className="pb-timeline">
              <div className="pb-timeline-header">
                <span className="pb-tl-label">
                  {trajectory.length === 0
                    ? (sn ? "Collecting points…" : "Select a device")
                    : `${playbackIndex + 1} / ${trajectory.length}`}
                </span>
              </div>
              <input type="range" className="pb-slider"
                min={0} max={Math.max(0, trajectory.length - 1)}
                value={playbackIndex} onChange={handleSlider}
                disabled={trajectory.length === 0}
              />
              <div className="pb-progress-bar">
                <div className="pb-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="pb-point-info">
              <span className="pb-point-label">Time</span>
              <span className="pb-point-val">{formatTs(infoPoint)}</span>
            </div>

            <div className={`pb-mode-badge ${isLiveMode ? "badge-live" : "badge-playback"}`}>
              <span className="badge-dot" />
              {isLiveMode ? "Live" : `Playback · ${SPEEDS.find(o => o.value === speed)?.label}`}
            </div>

            <button className="pb-clear-btn" onClick={() => {
              setSessionTraj([]); setHistoricalTraj([]);
              setLatest(null); setPlaybackIndex(0);
              setPlaying(false); setIsLiveMode(true); setDataSource("session");
              setActiveShortcut(null);
            }}>Clear</button>
          </div>
        </div>
      </div>
    </div>
  );
}