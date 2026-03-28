import React, { useState } from "react";
import { useDeviceCache } from "../context/DeviceCacheContext.jsx";
import tplLogo from "../assets/tpl.png";
import "./DeviceSidebar.css";

function formatDateTime(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return null; }
}

export default function DeviceSidebar({ selectedSn, onSelect }) {
  const { devices, loading, error, refresh } = useDeviceCache();
  const [search, setSearch] = useState("");

  const filtered = devices.filter((d) => {
    const sn     = (d.sn ?? "").toLowerCase();
    const client = (d.client ?? "").toLowerCase();
    const user   = (d.assigned_user_name ?? d.assignedUser ?? "").toLowerCase();
    const term   = search.toLowerCase();
    return sn.includes(term) || client.includes(term) || user.includes(term);
  });

  const online  = devices.filter((d) => d.status === "online").length;
  const offline = devices.length - online;

  return (
    <div className="dsb-sidebar">

      <div className="dsb-header">
        <div className="dsb-title">
          Devices
          <span className="dsb-count">{devices.length}</span>
        </div>
        <div className="dsb-stats">
          <span className="dsb-stat online">● {online} online</span>
          <span className="dsb-stat offline">● {offline} offline</span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          title="Refresh devices"
          style={{
            marginLeft: "auto", background: "none", border: "none",
            color: loading ? "#3f3f46" : "#71717a",
            cursor: loading ? "not-allowed" : "pointer",
            padding: "4px", borderRadius: 4,
            display: "flex", alignItems: "center",
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.color = "#fca5a5"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = loading ? "#3f3f46" : "#71717a"; }}
        >
          <svg
            viewBox="0 0 20 20" fill="currentColor" width={14} height={14}
            style={{ animation: loading ? "dsb-spin 0.8s linear infinite" : "none" }}
          >
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
          </svg>
        </button>
      </div>

      <div className="dsb-search-wrap">
        <svg className="dsb-search-icon" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
        </svg>
        <input
          className="dsb-search"
          placeholder="Search SN, client, user…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && <button className="dsb-search-clear" onClick={() => setSearch("")}>✕</button>}
      </div>

      <div className="dsb-list">

        {loading && (
          <div className="dsb-state" style={{ flexDirection: "column", gap: 10 }}>
            <style>{`
              @keyframes tpl-pulse {
                0%   { opacity: 0.15; transform: scale(0.95); }
                50%  { opacity: 0.7;  transform: scale(1.02); }
                100% { opacity: 0.15; transform: scale(0.95); }
              }
            `}</style>
            <img
              src={tplLogo}
              alt="Loading"
              style={{
                width: 48,
                height: "auto",
                filter: "brightness(0) invert(1)",
                animation: "tpl-pulse 1.6s ease-in-out infinite",
              }}
            />
            <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Loading devices…
            </span>
          </div>
        )}

        {!loading && error && (
          <div className="dsb-state dsb-error">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="dsb-state">No devices found</div>
        )}

        {!loading && !error && filtered.map((d) => {
          const sn           = d.sn ?? "unknown";
          const status       = d.status ?? "offline";
          const client       = d.client ?? null;
          const assignedUser = d.assigned_user_name ?? d.assignedUser ?? null;
          const battery      = d.batteryLevel ?? d.battery ?? null;
          const bindTime     = formatDateTime(d.bindTime);
          const isBound      = !!assignedUser;
          const isSelected   = sn === selectedSn;

          return (
            <button
              key={sn}
              className={`dsb-item ${isSelected ? "selected" : ""}`}
              onClick={() => onSelect(d)}
            >
              <div className={`dsb-icon ${status === "online" ? "icon-online" : "icon-offline"}`}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                </svg>
              </div>

              <div className="dsb-info">
                <div className="dsb-sn">{assignedUser || sn}</div>
                {assignedUser && (
                  <div className="dsb-client" style={{ fontFamily: "monospace", fontSize: 10, opacity: 0.6 }}>
                    {sn}
                  </div>
                )}
                {client && <div className="dsb-client">{client}</div>}
                {!isBound && (
                  <div style={{ fontSize: 9, color: "#52525b", marginTop: 2, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Unbound
                  </div>
                )}
                {isBound && bindTime && (
                  <div style={{ fontSize: 9, color: "#52525b", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width={8} height={8}>
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
                    </svg>
                    Bound {bindTime}
                  </div>
                )}
              </div>

              <div className="dsb-right">
                <span className={`dsb-dot ${status === "online" ? "dot-online" : "dot-offline"}`} />
                {battery != null && <span className="dsb-battery">{battery}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}