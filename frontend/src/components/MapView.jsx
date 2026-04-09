// MapView.jsx — displays the Mapbox map, current location marker, and trajectory line.
// Popup dark theme is handled by global style.css (.mapboxgl-popup-* overrides)

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMapTheme } from "../context/MapThemeContext.jsx";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

function extractCoords(point) {
  if (!point || typeof point !== "object") return null;
  const lat = point.lat ?? point.latitude ?? point.gpsLat ?? point.wgLat ?? point.wg84Lat ?? point.gcjLat;
  const lng = point.lng ?? point.lon ?? point.longitude ?? point.gpsLng ?? point.wgLng ?? point.wg84Lng ?? point.gcjLng;
  const latNum = Number(lat), lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) return null;
  return { lat: latNum, lng: lngNum };
}

function safe(v) { return v == null || v === "" ? "—" : String(v); }

function formatTimestamp(point) {
  const ts = point?.timestamp ?? point?.time ?? point?.locTime;
  if (!ts) return "—";
  try { const d = new Date(ts); return isNaN(d.getTime()) ? safe(ts) : d.toLocaleString(); }
  catch { return safe(ts); }
}

function formatTimestampRaw(ts) {
  if (!ts) return "—";
  try { const d = new Date(ts); return isNaN(d.getTime()) ? safe(ts) : d.toLocaleString(); }
  catch { return safe(ts); }
}

import { reverseGeocode, buildAddressLine } from "../utils/reverseGeocode.js";

// Simple in-memory cache so hovering the same point twice doesn't re-fetch
const geocodeCache = new Map();

async function geocodeCached(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const result = await reverseGeocode(lat, lng);
  geocodeCache.set(key, result);
  return result;
}

function createLocationMarkerEl() {
  const el = document.createElement("div");
  el.style.cssText = "width:40px;height:40px;cursor:pointer;";
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <circle cx="20" cy="20" r="8" fill="#800000" stroke="#ffffff" stroke-width="2" filter="url(#glow)"/>
      <circle cx="20" cy="20" r="3" fill="#ffffff" opacity="0.8"/>
      <circle cx="20" cy="20" r="2" fill="#800000"/>
    </svg>`;
  return el;
}

function buildPopupHtml({ displayName, label, sn, coords, currentPoint, geocode }) {
  const primary     = geocode?.primary ?? null;
  const secondary   = geocode?.secondary ?? null;
  const isSpecific  = geocode?.isSpecific ?? false;
  const addressLine = geocode?.address ?? buildAddressLine(geocode?.hierarchy) ?? null;

  let locationContent, locationLabel;

  if (primary && isSpecific) {
    locationLabel   = "Landmark";
    locationContent =
      `<span style="color:#e5e5e5;font-weight:600;">${safe(primary)}</span>` +
      (secondary ? `<br/><span style="color:#a3a3a3;font-size:11px;">${safe(secondary)}</span>` : "") +
      (addressLine && addressLine !== primary && addressLine !== secondary
        ? `<br/><span style="color:#71717a;font-size:10px;">${safe(addressLine)}</span>` : "");
  } else if (primary) {
    locationLabel   = "Area";
    locationContent =
      `<span style="color:#e5e5e5;font-weight:600;">Near ${safe(primary)}</span>` +
      (secondary ? `<br/><span style="color:#a3a3a3;font-size:11px;">${safe(secondary)}</span>` : "");
  } else {
    locationLabel   = "Location";
    locationContent =
      `<span style="color:#a3a3a3;">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</span>`;
  }

  return `
    <div style="font-family:ui-sans-serif;font-size:12px;min-width:210px;color:#e5e5e5;">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px;padding-bottom:8px;border-bottom:1px solid #2d2d2d;color:#fca5a5;letter-spacing:.02em;">
        ${safe(displayName)}
      </div>
      ${label && label !== sn ? `
      <div style="margin-bottom:8px;color:#555;font-size:11px;font-family:'JetBrains Mono',monospace;">
        ${safe(sn)}
      </div>` : ""}
      <div style="margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16">
            <path fill="#7a1515" fill-rule="evenodd" d="M12.5 6a4.47 4.47 0 0 1-.883 2.677L8 13.5L4.383 8.677A4.5 4.5 0 1 1 12.5 6ZM14 6c0 1.34-.439 2.576-1.18 3.574L8.937 14.75L8 16l-.938-1.25L3.18 9.574A6 6 0 1 1 14 6ZM8 8a2 2 0 1 0 0-4a2 2 0 0 0 0 4Z" clip-rule="evenodd"/>
          </svg>
          <span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">${locationLabel}</span>
        </div>
        <div style="padding-left:16px;">
          ${locationContent}
          <br/><span style="color:#555;font-size:10px;font-family:'JetBrains Mono',monospace;">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</span>
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 432 432">
            <path fill="#7a1515" d="M213.5 3q88.5 0 151 62.5T427 216t-62.5 150.5t-151 62.5t-151-62.5T0 216T62.5 65.5T213.5 3zm0 384q70.5 0 120.5-50t50-121t-50-121t-120.5-50T93 95T43 216t50 121t120.5 50zM224 109v112l96 57l-16 27l-112-68V109h32z"/>
          </svg>
          <span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Time</span>
        </div>
        <div style="padding-left:16px;">
          <span style="color:#e5e5e5;">${formatTimestamp(currentPoint)}</span>
        </div>
      </div>
    </div>`;
}

// Popup for trajectory/playback point dots — shows a "Loading…" spinner until
// the reverse geocode resolves, then updates in-place.
function buildPointPopupHtml({ displayName, sn, coords, timestamp, geocode, loading }) {
  const primary     = geocode?.primary ?? null;
  const secondary   = geocode?.secondary ?? null;
  const isSpecific  = geocode?.isSpecific ?? false;
  const addressLine = geocode?.address ?? buildAddressLine(geocode?.hierarchy) ?? null;

  let locationContent, locationLabel;

  if (loading || !geocode) {
    locationLabel   = "Location";
    locationContent = `<span style="color:#555;font-size:11px;">Resolving address…</span>`;
  } else if (primary && isSpecific) {
    locationLabel   = "Landmark";
    locationContent =
      `<span style="color:#e5e5e5;font-weight:600;">${safe(primary)}</span>` +
      (secondary ? `<br/><span style="color:#a3a3a3;font-size:11px;">${safe(secondary)}</span>` : "") +
      (addressLine && addressLine !== primary && addressLine !== secondary
        ? `<br/><span style="color:#71717a;font-size:10px;">${safe(addressLine)}</span>` : "");
  } else if (primary) {
    locationLabel   = "Area";
    locationContent =
      `<span style="color:#e5e5e5;font-weight:600;">Near ${safe(primary)}</span>` +
      (secondary ? `<br/><span style="color:#a3a3a3;font-size:11px;">${safe(secondary)}</span>` : "");
  } else {
    locationLabel   = "Location";
    locationContent = `<span style="color:#a3a3a3;">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</span>`;
  }

  return `
    <div style="font-family:ui-sans-serif;font-size:12px;min-width:200px;color:#e5e5e5;">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px;padding-bottom:8px;border-bottom:1px solid #2d2d2d;color:#fca5a5;letter-spacing:.02em;">
        ${safe(displayName)}
      </div>
      <div style="margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16">
            <path fill="#7a1515" fill-rule="evenodd" d="M12.5 6a4.47 4.47 0 0 1-.883 2.677L8 13.5L4.383 8.677A4.5 4.5 0 1 1 12.5 6ZM14 6c0 1.34-.439 2.576-1.18 3.574L8.937 14.75L8 16l-.938-1.25L3.18 9.574A6 6 0 1 1 14 6ZM8 8a2 2 0 1 0 0-4a2 2 0 0 0 0 4Z" clip-rule="evenodd"/>
          </svg>
          <span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">${locationLabel}</span>
        </div>
        <div style="padding-left:16px;">
          ${locationContent}
          <br/><span style="color:#555;font-size:10px;font-family:'JetBrains Mono',monospace;">${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}</span>
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 432 432">
            <path fill="#7a1515" d="M213.5 3q88.5 0 151 62.5T427 216t-62.5 150.5t-151 62.5t-151-62.5T0 216T62.5 65.5T213.5 3zm0 384q70.5 0 120.5-50t50-121t-50-121t-120.5-50T93 95T43 216t50 121t120.5 50zM224 109v112l96 57l-16 27l-112-68V109h32z"/>
          </svg>
          <span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Time</span>
        </div>
        <div style="padding-left:16px;">
          <span style="color:#e5e5e5;">${formatTimestampRaw(timestamp)}</span>
        </div>
      </div>
    </div>`;
}

// showLine = true (default) draws the route line; false = points only (PlaybackPage)
export default function MapView({ sn, label, latest, trajectory = [], playbackPoint, showLine = true }) {
  const { theme: mapTheme } = useMapTheme();
  const containerRef    = useRef(null);
  const mapRef          = useRef(null);
  const markerRef       = useRef(null);
  const popupRef        = useRef(null);       // main marker popup
  const trajPopupRef    = useRef(null);       // trajectory dot popup
  const prevIsPlayback  = useRef(false);
  // Stable refs so mousemove handler always reads the latest values without
  // needing to be re-created (avoids the stale-closure / listener-leak bugs)
  const displayNameRef  = useRef("");
  const snRef           = useRef("");
  const cancelGeocodeRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [geocode, setGeocode]     = useState(null);

  const currentPoint = playbackPoint || latest;
  const coords       = useMemo(() => extractCoords(currentPoint), [currentPoint]);
  const displayName  = label || sn;
  const isPlayback   = !!playbackPoint;

  // Keep stable refs in sync so the mousemove handler always has fresh values
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);
  useEffect(() => { snRef.current = sn; }, [sn]);

  /* ── REVERSE GEOCODE when coords change ──────── */
  useEffect(() => {
    if (!coords) { setGeocode(null); return; }
    setGeocode(null);
    let cancelled = false;
    geocodeCached(coords.lat, coords.lng).then((result) => {
      if (!cancelled) setGeocode(result);
    });
    return () => { cancelled = true; };
  }, [coords?.lat, coords?.lng]);

  /* ── MAP INIT ─────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: `mapbox://styles/mapbox/${mapTheme === "dark" ? "dark-v11" : "light-v11"}`,
      center: [67.0011, 24.8607],
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.FullscreenControl(), "top-right");
    map.on("load", () => setMapLoaded(true));
    mapRef.current = map;
    return () => {
      try {
        if (trajPopupRef.current) { trajPopupRef.current.remove(); trajPopupRef.current = null; }
        if (popupRef.current)     { popupRef.current.remove();     popupRef.current     = null; }
        if (markerRef.current)    { markerRef.current.remove();    markerRef.current    = null; }
        map.remove();
      } catch {}
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Store current map state before style change
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    
    // Change style and set up restoration
    map.setStyle(`mapbox://styles/mapbox/${mapTheme === "dark" ? "dark-v11" : "light-v11"}`);
    
    // When style loads, restore map view and trigger data restoration
    const onStyleLoad = () => {
      setMapLoaded(false); // Reset to force re-add all layers
      setTimeout(() => setMapLoaded(true), 50); // Small delay to ensure style is fully loaded
      // Restore map view
      map.jumpTo({ center: currentCenter, zoom: currentZoom });
    };
    
    map.on('style.load', onStyleLoad);
    
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [mapTheme]);

  /* ── CUSTOM LOCATION LABELS ───────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (map.getSource("custom-locations")) return;

    import("../utils/Customlocations.json").then(({ default: locations }) => {
      if (map.getSource("custom-locations")) return;

      map.addSource("custom-locations", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: locations.map((loc) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [loc.lng, loc.lat] },
            properties: { name: loc.name },
          })),
        },
      });

      map.addLayer({
        id:      "custom-locations-labels",
        type:    "symbol",
        source:  "custom-locations",
        minzoom: 15,
        layout: {
          "text-field":         ["get", "name"],
          "text-font":          ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size":          11,
          "text-anchor":        "top",
          "text-offset":        [0, 0.4],
          "text-max-width":     12,
          "text-allow-overlap": false,
          "symbol-avoid-edges": true,
        },
        paint: {
          "text-color":      "#fbbf24",
          "text-halo-color": "#000000",
          "text-halo-width": 1.5,
          "text-opacity": [
            "interpolate", ["linear"], ["zoom"],
            15, 0,
            16, 1,
          ],
        },
      });
    }).catch(() => {});
  }, [mapLoaded, mapTheme]); // Add mapTheme dependency

  /* ── MARKER ───────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!coords) {
      if (trajPopupRef.current) { trajPopupRef.current.remove(); trajPopupRef.current = null; }
      if (popupRef.current)     { popupRef.current.remove();     popupRef.current     = null; }
      if (markerRef.current)    { markerRef.current.remove();    markerRef.current    = null; }
      prevIsPlayback.current = false;
      return;
    }

    const popupHtml = buildPopupHtml({ displayName, label, sn, coords, currentPoint, geocode });

    if (popupRef.current) popupRef.current.remove();
    popupRef.current = new mapboxgl.Popup({
      offset: 25, closeButton: false, closeOnClick: false,
    }).setHTML(popupHtml);

    const modeChanged = prevIsPlayback.current !== isPlayback;
    if (modeChanged && markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    prevIsPlayback.current = isPlayback;

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: "#800000", scale: 1.3 })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);

      const markerEl = markerRef.current.getElement();
      markerEl.style.cursor = "pointer";
      markerEl.addEventListener("mouseenter", () => {
        // Close any open trajectory dot popup first
        trajPopupRef.current?.remove();
        popupRef.current?.setLngLat(markerRef.current.getLngLat()).addTo(map);
      });
      markerEl.addEventListener("mouseleave", () => {
        popupRef.current?.remove();
      });
    } else {
      markerRef.current.setLngLat([coords.lng, coords.lat]);
      if (popupRef.current?.isOpen()) {
        popupRef.current.setHTML(popupHtml).setLngLat([coords.lng, coords.lat]);
      }
    }

    map.flyTo({ center: [coords.lng, coords.lat], zoom: 15, essential: true, duration: 1000 });
  }, [coords, currentPoint, sn, displayName, label, isPlayback, geocode, mapTheme]); // Add mapTheme dependency

  /* ── TRAJECTORY LINE + POINTS ─────────────────── */
  // The mousemove handler is attached ONCE on map load and reads trajectory
  // data via queryRenderedFeatures. This avoids the stale-closure bug where
  // layer-specific onMouseEnter/onMouseLeave functions defined with `const`
  // inside a useEffect can't be properly removed when the effect re-runs
  // (because `map.off(event, layer, fn)` requires the exact same fn reference).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // ── Stable mousemove handler — attached once, never re-created ────────
    const onMouseMove = async (e) => {
      if (!map.getLayer("route-points")) return;

      const features = map.queryRenderedFeatures(e.point, { layers: ["route-points"] });

      if (!features.length) {
        // Not hovering a point — close dot popup and restore cursor
        if (trajPopupRef.current) {
          cancelGeocodeRef.current = true;
          trajPopupRef.current.remove();
          trajPopupRef.current = null;
        }
        map.getCanvas().style.cursor = "";
        return;
      }

      map.getCanvas().style.cursor = "pointer";

      const props = features[0].properties;
      const lat   = Number(props.lat);
      const lng   = Number(props.lng);
      const ts    = props.timestamp || null;

      // If already showing a popup for this exact point, do nothing
      if (
        trajPopupRef.current?.isOpen() &&
        trajPopupRef.current._lngLat?.lng === lng &&
        trajPopupRef.current._lngLat?.lat === lat
      ) return;

      // Close main marker popup
      popupRef.current?.remove();

      // Show placeholder immediately
      if (trajPopupRef.current) trajPopupRef.current.remove();
      trajPopupRef.current = new mapboxgl.Popup({
        offset: 14, closeButton: false, closeOnClick: false,
      })
        .setLngLat([lng, lat])
        .setHTML(buildPointPopupHtml({
          displayName: displayNameRef.current,
          sn: snRef.current,
          coords: { lat, lng },
          timestamp: ts,
          geocode: null,
          loading: true,
        }))
        .addTo(map);

      // Async geocode — update popup in-place when resolved
      cancelGeocodeRef.current = false;
      const result = await geocodeCached(lat, lng);
      if (cancelGeocodeRef.current) return;
      if (trajPopupRef.current?.isOpen()) {
        trajPopupRef.current.setHTML(buildPointPopupHtml({
          displayName: displayNameRef.current,
          sn: snRef.current,
          coords: { lat, lng },
          timestamp: ts,
          geocode: result,
          loading: false,
        }));
      }
    };

    map.on("mousemove", onMouseMove);
    return () => {
      map.off("mousemove", onMouseMove);
    };
  // Only run once when map is ready — handler reads live data via refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded]);

  // Separate effect: update GeoJSON sources whenever trajectory changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const removeLayers = () => {
      if (map.getLayer("route-points"))       map.removeLayer("route-points");
      if (map.getLayer("route-line-outline")) map.removeLayer("route-line-outline");
      if (map.getLayer("route-line"))         map.removeLayer("route-line");
      if (map.getSource("route-points"))      map.removeSource("route-points");
      if (map.getSource("route"))             map.removeSource("route");
    };

    if (trajectory.length < 2) {
      removeLayers();
      return;
    }

    const enrichedPoints = trajectory
      .map((pt, i) => {
        const c = extractCoords(pt);
        if (!c) return null;
        const ts = pt?.timestamp ?? pt?.time ?? pt?.locTime ?? null;
        return { coords: c, timestamp: ts, index: i };
      })
      .filter(Boolean);

    if (enrichedPoints.length < 2) return;

    const lineCoords = enrichedPoints.map((p) => [p.coords.lng, p.coords.lat]);

    const lineGeojson = {
      type: "Feature", properties: {},
      geometry: { type: "LineString", coordinates: lineCoords },
    };

    // Embed lat/lng/timestamp as properties so queryRenderedFeatures can read them
    const pointsGeojson = {
      type: "FeatureCollection",
      features: enrichedPoints.map((p) => ({
        type: "Feature",
        properties: {
          lat:       p.coords.lat,
          lng:       p.coords.lng,
          timestamp: p.timestamp ? String(p.timestamp) : "",
          index:     p.index,
        },
        geometry: { type: "Point", coordinates: [p.coords.lng, p.coords.lat] },
      })),
    };

    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: lineGeojson });
      map.addSource("route-points", { type: "geojson", data: pointsGeojson });

      if (showLine) {
        map.addLayer({
          id: "route-line-outline", type: "line", source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.25 },
        });
        map.addLayer({
          id: "route-line", type: "line", source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#dc2626", "line-width": 3, "line-opacity": 0.9 },
        });
      }

      map.addLayer({
        id: "route-points", type: "circle", source: "route-points",
        paint: {
          "circle-radius":       6,   // slightly larger hit area (was 5)
          "circle-color":        "#dc2626",
          "circle-opacity":      1,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    } else {
      map.getSource("route")?.setData(lineGeojson);
      map.getSource("route-points")?.setData(pointsGeojson);
    }
  }, [trajectory, mapLoaded, showLine, mapTheme]); // Add mapTheme dependency

  /* ── UI ───────────────────────────────────────── */
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>

      {!import.meta.env.VITE_MAPBOX_TOKEN && (
        <div style={{ position:"absolute", top:0, left:0, right:0, zIndex:20, padding:"10px 16px", background:"rgba(127,29,29,0.95)", fontSize:12, color:"#fca5a5", display:"flex", gap:8 }}>
          ⚠️ <strong>Missing VITE_MAPBOX_TOKEN</strong> — add it to your <code>.env</code> file.
        </div>
      )}

      {!sn && (
        <div style={{
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.75)",   // darker overlay
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            textAlign: "center",
            pointerEvents: "none"
          }}>
            <div style={{
              background: "rgba(0,0,0,0.9)",   // darker inner box
              backdropFilter: "blur(10px)",
              border: "1px solid #1f1f1f",
              borderRadius: 14,
              padding: "24px 36px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.6)"
            }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>📍</div>
              <div style={{ color: "#a3a3a3", fontSize: 14, fontWeight: 600 }}>
                Select a device from the sidebar
              </div>
            </div>
          </div>
      )}

      {sn && !coords && !playbackPoint && (
        <div style={{ position:"absolute", top:12, left:"50%", transform:"translateX(-50%)", zIndex:10 }}>
          <div style={{ background:"rgba(0,0,0,0.75)", backdropFilter:"blur(6px)", border:"1px solid #2d2d2d", borderRadius:8, padding:"7px 16px", fontSize:12, color:"#a3a3a3", display:"flex", gap:8, alignItems:"center", whiteSpace:"nowrap" }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:"#f59e0b", display:"inline-block", animation:"pulse 1.5s infinite" }} />
            Waiting for GPS — {displayName}
          </div>
        </div>
      )}

      {playbackPoint && (
        <div style={{ position:"absolute", top:12, left:12, zIndex:10, background:"rgba(245,158,11,0.9)", color:"white", padding:"6px 12px", borderRadius:8, fontSize:11, fontWeight:700, display:"flex", alignItems:"center", gap:6, boxShadow:"0 2px 8px rgba(0,0,0,0.4)" }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background:"white", display:"inline-block" }} />
          PLAYBACK — {displayName}
        </div>
      )}

      {trajectory.length > 0 && (
        <div style={{ position:"absolute", bottom:32, left:12, zIndex:10, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)", padding:"6px 12px", borderRadius:8, fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:6, color:"#fca5a5", border:"1px solid rgba(127,29,29,0.4)" }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:"#dc2626", display:"inline-block" }} />
          {trajectory.length} pts
        </div>
      )}

      <div ref={containerRef} style={{ width:"100%", height:"100%" }} />
    </div>
  );
}