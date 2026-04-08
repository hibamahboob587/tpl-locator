import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MapView from "../components/MapView.jsx";
import DeviceSidebar from "../components/Devicesidebar.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import "./MapViewPage.css";

function isDuplicate(p1, p2) {
  if (!p1 || !p2) return false;
  const ts  = (p) => p?.timestamp ?? p?.time ?? p?.locTime;
  const lat = (p) => p?.lat ?? p?.latitude ?? p?.gpsLat ?? p?.wgLat;
  const lng = (p) => p?.lng ?? p?.lon ?? p?.longitude ?? p?.gpsLng ?? p?.wgLng;
  return lat(p1) === lat(p2) && lng(p1) === lng(p2) && ts(p1) === ts(p2);
}

function safe(v) { return v == null || v === "" ? "—" : String(v); }
function formatTs(point) {
  const ts = point?.timestamp ?? point?.time ?? point?.locTime;
  if (!ts) return "—";
  try { const d = new Date(ts); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString(); }
  catch { return "—"; }
}

export default function MapViewPage() {
  const [searchParams] = useSearchParams();
  const { getLatestLocation } = useCityTag();

  const [sn, setSn]                   = useState(searchParams.get("device") || "");
  const [label, setLabel]             = useState("");
  const [latest, setLatest]           = useState(null);
  const [trajectory, setTrajectory]   = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalSec, setIntervalSec] = useState(15);
  const [geocodeLabel, setGeocodeLabel] = useState("");
  const intervalRef = useRef(null);

  const refresh = useCallback(async (target) => {
    const dev = target ?? sn;
    if (!dev) return;
    setLoading(true);
    setError("");
    try {
      const res   = await getLatestLocation(dev);
      const point = res?.latest ?? res ?? null;
      setLatest(point);
      setLastUpdated(new Date());
      if (point) {
        setTrajectory((prev) => {
          if (isDuplicate(prev[prev.length - 1], point)) return prev;
          const next = [...prev, point];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    } catch (err) {
      setError(err.message || "Failed to fetch location");
    } finally {
      setLoading(false);
    }
  }, [sn, getLatestLocation]);

  useEffect(() => {
    clearInterval(intervalRef.current);
    if (autoRefresh && sn) {
      intervalRef.current = setInterval(() => refresh(), intervalSec * 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, intervalSec, sn, refresh]);

  const handleSelectDevice = (device) => {
    const newSn    = typeof device === "string" ? device : (device?.sn ?? device?.serialNumber ?? "");
    const newLabel = typeof device === "string" ? "" : (device?.assignedUser ?? "");
    setSn(newSn);
    setLabel(newLabel);
    setLatest(null);
    setTrajectory([]);
    setError("");
    refresh(newSn);
  };

  const latestWithOffset = useMemo(() => {
    if (!latest) return null;
    return latest;
  }, [latest]);

  const lat = latest?.lat ?? latest?.latitude ?? latest?.gpsLat ?? latest?.wgLat;
  const lng = latest?.lng ?? latest?.lon ?? latest?.longitude ?? latest?.gpsLng ?? latest?.wgLng;

  // Reverse geocode latest position for the info strip landmark label
  useEffect(() => {
    if (lat == null || lng == null) { setGeocodeLabel(""); return; }
    let cancelled = false;
    import("../utils/reverseGeocode.js").then(({ reverseGeocode }) =>
      reverseGeocode(Number(lat), Number(lng))
    ).then((result) => {
      if (cancelled) return;
      if (result?.primary) {
        setGeocodeLabel(result.secondary ? `${result.primary} — ${result.secondary}` : result.primary);
      } else {
        setGeocodeLabel("");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [lat, lng]);

  return (
    <div className="mv-page">

      <div className="mv-topbar">
        <div className="mv-topbar-left">
          <span className="mv-topbar-label">Map View</span>
          {sn && <span className="mv-topbar-sn">{label || sn}</span>}
          {label && <span className="mv-topbar-sn" style={{ color: '#71717a', fontFamily: 'monospace', fontSize: 11 }}>{sn}</span>}
          {sn && (
            <span className={`mv-pill ${latest ? "pill-online" : "pill-searching"}`}>
              <span className="mv-pill-dot" />
              {loading ? "Fetching…" : latest ? "Live" : "Searching…"}
            </span>
          )}
          {lastUpdated && <span className="mv-pill pill-time">Updated {lastUpdated.toLocaleTimeString()}</span>}
        </div>

        <div className="mv-topbar-right">
          <label className="mv-toggle-label">
            <button className={`mv-toggle ${autoRefresh ? "on" : "off"}`} onClick={() => setAutoRefresh(v => !v)}>
              <span className="mv-toggle-knob" />
            </button>
            Auto-refresh
          </label>
          <input
            type="number" className="mv-interval-input"
            value={intervalSec} min={5} max={300}
            disabled={!autoRefresh}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
          />
          <span className="mv-unit">sec</span>
          <button className="mv-refresh-btn" onClick={() => refresh()} disabled={loading || !sn}>
            <svg viewBox="0 0 20 20" fill="currentColor" className={loading ? "mv-spin" : ""}>
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mv-error">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          {error}
          <button className="mv-error-close" onClick={() => setError("")}>✕</button>
        </div>
      )}

      <div className="mv-body">
        <DeviceSidebar selectedSn={sn} onSelect={handleSelectDevice} />

        <div className="mv-map-area">
          <div className="mv-map-wrap">
            <MapView sn={sn} label={label} latest={latestWithOffset} trajectory={[]} playbackPoint={null} />
          </div>

          {sn && (
            <div className="mv-info-strip">
              <div className="mv-info-item" style={{ flex: 1 }}>
                <span className="mv-info-label">Landmark</span>
                <span className="mv-info-val">{geocodeLabel || (lat != null ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : "—")}</span>
              </div>
              <div className="mv-info-sep" />
              <div className="mv-info-item">
                <span className="mv-info-label">Last seen</span>
                <span className="mv-info-val">{formatTs(latestWithOffset)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}