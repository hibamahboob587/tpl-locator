import React, { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DeviceSidebar from "../components/Devicesidebar.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import { reverseGeocode } from "../utils/reverseGeocode.js";
import "./ReportPage.css";
import * as XLSX from "xlsx";

function todayStr() { return new Date().toISOString().split("T")[0]; }

function formatTs(point) {
  const ts = point?.timestamp ?? point?.time ?? point?.locTime;
  if (!ts) return "—";
  try { const d = new Date(ts); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString(); }
  catch { return "—"; }
}

function extractCoords(p) {
  if (!p) return null;
  const lat = Number(p.lat ?? p.latitude ?? p.gpsLat ?? p.wgLat ?? p.wg84Lat ?? p.gcjLat);
  const lng = Number(p.lng ?? p.lon ?? p.longitude ?? p.gpsLng ?? p.wgLng ?? p.wg84Lng ?? p.gcjLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function normalisePoints(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.points)) return data.points;
  if (data.feature?.geometry?.coordinates) {
    const coords = data.feature.geometry.coordinates;
    const timestamps = data.feature.properties?.timestamps ?? [];
    return coords.map(([lng, lat], i) => ({ lng, lat, timestamp: timestamps[i] ?? null }));
  }
  if (data.geometry?.coordinates) {
    const ts = data.properties?.timestamps ?? [];
    return data.geometry.coordinates.map(([lng, lat], i) => ({ lng, lat, timestamp: ts[i] ?? null }));
  }
  return [];
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeStats(points) {
  if (points.length === 0) return { totalDist: 0, avgSpeed: 0, maxSpeed: 0, duration: "—", startTime: "—", endTime: "—" };
  let totalDist = 0, maxSpeed = 0;
  const speeds = [];
  for (let i = 1; i < points.length; i++) {
    const c1 = extractCoords(points[i - 1]);
    const c2 = extractCoords(points[i]);
    if (c1 && c2) totalDist += haversineKm(c1.lat, c1.lng, c2.lat, c2.lng);
    const spd = Number(points[i].speed ?? points[i].gpsSpd ?? 0);
    if (Number.isFinite(spd) && spd > 0) { speeds.push(spd); if (spd > maxSpeed) maxSpeed = spd; }
  }
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const tsOf = (p) => { const t = p?.timestamp ?? p?.time ?? p?.locTime; return t ? new Date(t).getTime() : NaN; };
  const t0 = tsOf(points[0]), t1 = tsOf(points[points.length - 1]);
  let duration = "—";
  if (!isNaN(t0) && !isNaN(t1)) {
    const diffMs = Math.abs(t1 - t0);
    const h = Math.floor(diffMs / 3600000), m = Math.floor((diffMs % 3600000) / 60000);
    duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  return { totalDist, avgSpeed: Math.round(avgSpeed * 10) / 10, maxSpeed: Math.round(maxSpeed * 10) / 10, duration, startTime: formatTs(points[0]), endTime: formatTs(points[points.length - 1]) };
}

const TIME_SHORTCUTS = [
  { label: "1H",  hours: 1   },
  { label: "6H",  hours: 6   },
  { label: "1D",  hours: 24  },
  { label: "7D",  hours: 168 },
  { label: "30D", hours: 720 },
];

const CalendarIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
  </svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
  </svg>
);

export default function ReportPage() {
  const [searchParams] = useSearchParams();
  const { getPlayback } = useCityTag();

  const [sn, setSn]     = useState(searchParams.get("device") || "");
  const [label, setLabel] = useState("");

  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate]     = useState(todayStr());
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime]     = useState("23:59");

  const [points, setPoints]                 = useState([]);
  const [geocoded, setGeocoded]             = useState({});
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState("");
  const [activeShortcut, setActiveShortcut] = useState(null);
  const [queryRange, setQueryRange]         = useState({ start: null, end: null });

  const handleSelectDevice = (device) => {
    const newSn    = typeof device === "string" ? device : (device?.sn ?? "");
    const newLabel = typeof device === "string" ? "" : (device?.assignedUser ?? "");
    setSn(newSn);
    setLabel(newLabel);
    setPoints([]);
    setGeocoded({});
    setError("");
    setActiveShortcut(null);
  };

  const geocodePoints = useCallback(async (pts) => {
    const results = {};

    // Deduplicate by coordinate key first — no point hitting the API twice
    // for points that are within ~1m of each other
    const unique = [];
    const seen   = new Set();
    for (const p of pts) {
      const c = extractCoords(p);
      if (!c) continue;
      const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
      if (!seen.has(key)) { seen.add(key); unique.push({ c, key }); }
    }

    // Geocode in small parallel batches to avoid hammering the API
    // Update state after each batch so results appear progressively
    const BATCH = 5;
    for (let i = 0; i < unique.length; i += BATCH) {
      await Promise.all(unique.slice(i, i + BATCH).map(async ({ c, key }) => {
        try {
          const geo = await reverseGeocode(c.lat, c.lng);
          if (geo) results[key] = geo;
        } catch { /* skip */ }
      }));
      setGeocoded({ ...results });
      if (i + BATCH < unique.length) await new Promise(r => setTimeout(r, 200));
    }
  }, []);

  const loadReport = async (overrideStart, overrideEnd) => {
    if (!sn) return;
    setError("");
    setLoading(true);
    try {
      // Picker value IS the UTC value, no offset needed
      const start = overrideStart ?? new Date(`${startDate}T${startTime}:00Z`);
      const end   = overrideEnd   ?? new Date(`${endDate}T${endTime}:59Z`);
      if (start >= end) throw new Error("Start must be before end");
      setQueryRange({ start, end });
      const res = await getPlayback(sn, start, end);
      const pts = normalisePoints(res);
      if (pts.length === 0) throw new Error("No data found in that time range");
      setPoints(pts);
      geocodePoints(pts);
    } catch (err) {
      setError(err.message || "Failed to load report data");
    } finally {
      setLoading(false);
    }
  };

  const handleShortcut = (shortcut) => {
    if (!sn) { setError("Select a device first"); return; }
    const now   = new Date();
    const start = new Date(now.getTime() - shortcut.hours * 60 * 60 * 1000);
    const toDateStr = (d) => d.toISOString().split("T")[0];
    const toTimeStr = (d) => d.toTimeString().slice(0, 5);
    setStartDate(toDateStr(start));
    setStartTime(toTimeStr(start));
    setEndDate(toDateStr(now));
    setEndTime(toTimeStr(now));
    setActiveShortcut(shortcut.label);
    loadReport(start, now);
  };

  const getLocationLabel = (point) => {
    const c = extractCoords(point);
    if (!c) return "—";
    const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
    const geo = geocoded[key];
    if (geo?.primary) return geo.isSpecific ? geo.primary : `Near ${geo.primary}`;
    return `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  };

  const getLocationSecondary = (point) => {
    const c = extractCoords(point);
    if (!c) return "";
    const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
    return geocoded[key]?.secondary ?? "";
  };

  const exportCSV = () => {
    if (points.length === 0) return;

    const deviceName = label || sn;
    const cols = ["#", "Timestamp", "Coordinates", "Landmark"];

    const dataRows = points.map((p, i) => {
      const c        = extractCoords(p);
      const loc      = getLocationLabel(p);
      const sec      = getLocationSecondary(p);
      const ts       = p.timestamp ?? p.time ?? p.locTime ?? "";
      const coords   = c ? `${c.lat}, ${c.lng}` : "";
      const landmark = sec ? `${loc} — ${sec}` : loc;
      return [i + 1, ts, coords, landmark];
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [deviceName, "", "", ""],   // Row 1: STP title
      cols,                        // Row 2: column headers
      ...dataRows,                 // Row 3+: data
    ]);

    // Column widths
    ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 26 }, { wch: 50 }];

    // Merge title row across all 4 columns
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

    // Style helpers
    const titleStyle = {
      font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "7F1D1D" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top:    { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left:   { style: "thin", color: { rgb: "000000" } },
        right:  { style: "thin", color: { rgb: "000000" } },
      },
    };
    const headerStyle = {
      font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "991B1B" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top:    { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left:   { style: "thin", color: { rgb: "000000" } },
        right:  { style: "thin", color: { rgb: "000000" } },
      },
    };
    const cellStyle = (i) => ({
      fill: { fgColor: { rgb: i % 2 === 0 ? "1C1C1C" : "141414" } },
      font: { sz: 10, color: { rgb: "E5E5E5" } },
      alignment: { vertical: "center", wrapText: true },
      border: {
        top:    { style: "thin", color: { rgb: "2D2D2D" } },
        bottom: { style: "thin", color: { rgb: "2D2D2D" } },
        left:   { style: "thin", color: { rgb: "2D2D2D" } },
        right:  { style: "thin", color: { rgb: "2D2D2D" } },
      },
    });

    const colLetters = ["A", "B", "C", "D"];

    // Apply title style
    colLetters.forEach(col => {
      if (!ws[`${col}1`]) ws[`${col}1`] = { v: "", t: "s" };
      ws[`${col}1`].s = titleStyle;
    });

    // Apply header style (row 2)
    colLetters.forEach(col => {
      const cell = ws[`${col}2`];
      if (cell) cell.s = headerStyle;
    });

    // Apply cell styles (rows 3+)
    dataRows.forEach((_, rowIdx) => {
      const excelRow = rowIdx + 3;
      colLetters.forEach(col => {
        const cellRef = `${col}${excelRow}`;
        if (!ws[cellRef]) ws[cellRef] = { v: "", t: "s" };
        ws[cellRef].s = cellStyle(rowIdx);
      });
    });

    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `report_${sn}_${startDate}_${endDate}.xlsx`);
  };

  const stats      = computeStats(points);
  const rangeStart = queryRange.start ? queryRange.start.toLocaleString() : "—";
  const rangeEnd   = queryRange.end   ? queryRange.end.toLocaleString()   : "—";

  return (
    <div className="rp-page">
      <div className="rp-topbar">
        <div className="rp-topbar-left">
          <span className="rp-topbar-label">Report</span>
          {sn && <span className="rp-topbar-sn">{label || sn}</span>}
          {points.length > 0 && <span className="rp-pill rp-pill-count">{points.length} records</span>}
        </div>

        <div className="rp-topbar-right">
          <div className="rp-shortcuts">
            {TIME_SHORTCUTS.map((s) => (
              <button key={s.label}
                className={`rp-shortcut-btn${activeShortcut === s.label ? " active" : ""}`}
                onClick={() => handleShortcut(s)} disabled={loading}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="rp-date-group">
            <label>Start</label>
            <div className="rp-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <CalendarIcon /><span>{startDate}</span>
              <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActiveShortcut(null); }} />
            </div>
            <div className="rp-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <ClockIcon /><span>{startTime}</span>
              <input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setActiveShortcut(null); }} />
            </div>
          </div>

          <div className="rp-date-group">
            <label>End</label>
            <div className="rp-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <CalendarIcon /><span>{endDate}</span>
              <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActiveShortcut(null); }} />
            </div>
            <div className="rp-date-btn" onClick={(e) => e.currentTarget.querySelector("input").showPicker()}>
              <ClockIcon /><span>{endTime}</span>
              <input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setActiveShortcut(null); }} />
            </div>
          </div>

          <button className="rp-btn-load" onClick={() => loadReport()} disabled={!sn || loading}>
            {loading ? <><span className="rp-spinner" /> Loading…</> : "Generate Report"}
          </button>
          <button className="rp-btn-export" onClick={exportCSV} disabled={points.length === 0}>
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
            Export Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="rp-error">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          {error}
          <button className="rp-error-close" onClick={() => setError("")}>✕</button>
        </div>
      )}

      <div className="rp-body">
        <DeviceSidebar selectedSn={sn} onSelect={handleSelectDevice} />

        <div className="rp-main">
          {points.length > 0 ? (
            <>
              <div className="rp-summary">
                <div className="rp-card">
                  <span className="rp-card-label">Total Points</span>
                  <span className="rp-card-val accent">{points.length}</span>
                </div>
                <div className="rp-card">
                  <span className="rp-card-label">Distance</span>
                  <span className="rp-card-val">
                    {stats.totalDist < 1
                      ? `${Math.round(stats.totalDist * 1000)} m`
                      : `${stats.totalDist.toFixed(2)} km`}
                  </span>
                </div>
                <div className="rp-card">
                  <span className="rp-card-label">Duration</span>
                  <span className="rp-card-val">{stats.duration}</span>
                </div>
                <div className="rp-card">
                  <span className="rp-card-label">Start</span>
                  <span className="rp-card-val" style={{ fontSize: 13 }}>{rangeStart}</span>
                </div>
                <div className="rp-card">
                  <span className="rp-card-label">End</span>
                  <span className="rp-card-val" style={{ fontSize: 13 }}>{rangeEnd}</span>
                </div>
              </div>

              <div className="rp-table-wrap">
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Timestamp</th>
                      <th>Landmark</th>
                      <th>Latitude</th>
                      <th>Longitude</th>

                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p, i) => {
                      const c            = extractCoords(p);
                      const primaryLoc   = getLocationLabel(p);
                      const secondaryLoc = getLocationSecondary(p);
                      return (
                        <tr key={i}>
                          <td className="rp-row-idx">{i + 1}</td>
                          <td>{formatTs(p)}</td>
                          <td style={{ color: "#e5e5e5", fontWeight: 500 }}>
                            <div>{primaryLoc}</div>
                            {secondaryLoc && (
                              <div style={{ fontSize: "0.85em", opacity: 0.6, marginTop: 2 }}>
                                {secondaryLoc}
                              </div>
                            )}
                          </td>
                          <td className="mono">{c?.lat?.toFixed(6) ?? "—"}</td>
                          <td className="mono">{c?.lng?.toFixed(6) ?? "—"}</td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rp-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3>Location History Report</h3>
              <p>Select a device, choose a date range, and click "Generate Report" to view the full location history with landmarks, coordinates, and trip statistics.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}