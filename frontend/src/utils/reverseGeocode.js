/**
 * Reverse geocoding utilities for POI/address lookup from coordinates.
 * Uses Mapbox Search Box API (primary) and Geocoding v6 (fallback).
 */

import customLocations from "./Customlocations.json";

// ── Custom location lookup ────────────────────────────────────────────────────
const CUSTOM_RADIUS_KM = 0.1; 

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findCustomLocation(lat, lng) {
  let best = null, bestDist = Infinity;
  for (const loc of customLocations) {
    const d = haversineKm(lat, lng, loc.lat, loc.lng);
    if (d < CUSTOM_RADIUS_KM && d < bestDist) { bestDist = d; best = loc; }
  }
  if (!best) return null;
  return {
    primary:    best.name,
    secondary:  null,
    address:    best.name,
    hierarchy:  { street: best.name, neighborhood: null, locality: null, place: null, region: null, country: null },
    isSpecific: true,
    isCustom:   true,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

const GEOCODE_LANGUAGE = typeof import.meta !== "undefined" && import.meta.env?.VITE_GEOCODE_LANGUAGE
  ? import.meta.env.VITE_GEOCODE_LANGUAGE
  : "en";

const geocodeCache = new Map();

/**
 * Build a concise secondary line from hierarchy parts, excluding the primary.
 * e.g. "Gulberg III, Lahore" or "Model Town, Lahore, Punjab"
 */
function buildSecondary(hierarchy, excludePrimary) {
  if (!hierarchy) return null;
  const parts = [
    hierarchy.neighborhood,
    hierarchy.locality,
    hierarchy.place,
    hierarchy.region,
  ].filter((v) => v && v !== excludePrimary);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Extract hierarchy and primary/secondary from Search Box API feature
 */
export function parseSearchBoxFeature(feature) {
  const props = feature?.properties ?? {};
  const ctx = props.context ?? {};
  const hierarchy = {
    street: ctx.street?.name || ctx.address?.street_name || null,
    neighborhood: ctx.neighborhood?.name || null,
    locality: ctx.locality?.name || null,
    place: ctx.place?.name || null,
    region: ctx.region?.name || null,
    country: ctx.country?.name || null,
  };
  const featureType = props.feature_type || "";

  let primary = null;
  let secondary = null;

  if (featureType === "poi") {
    primary = props.name || props.full_address || props.address;
    secondary = buildSecondary(
      { ...hierarchy, neighborhood: hierarchy.street || hierarchy.neighborhood },
      primary
    ) || hierarchy.place;
  } else if (featureType === "address") {
    primary = props.address || props.full_address || props.name;
    secondary = buildSecondary(hierarchy, primary);
  } else if (featureType === "street") {
    primary = hierarchy.street ?? ctx.street?.name ?? props.name;
    secondary = buildSecondary(hierarchy, primary);
  } else if (featureType === "neighborhood") {
    primary = hierarchy.neighborhood ?? props.name;
    secondary = buildSecondary(hierarchy, primary);
  } else if (featureType === "locality") {
    primary = hierarchy.locality ?? props.name;
    secondary = buildSecondary(hierarchy, primary);
  } else if (featureType === "place" || hierarchy.place) {
    primary = hierarchy.place ?? props.name;
    secondary = hierarchy.region ?? hierarchy.country;
  } else if (hierarchy.region) {
    primary = hierarchy.region;
    secondary = hierarchy.country;
  } else if (hierarchy.country) {
    primary = hierarchy.country;
    secondary = null;
  }

  return primary ? { primary, secondary, address: props.full_address || props.address, hierarchy } : null;
}

/**
 * Map Geocoding v6 feature to our shape
 */
export function parseGeocodingV6Feature(feature) {
  const props = feature?.properties ?? {};
  const ctx = props.context ?? {};
  const hierarchy = {
    street: ctx.street?.name ?? ctx.address?.street ?? ctx.address?.name ?? null,
    neighborhood: ctx.neighborhood?.name ?? null,
    locality: ctx.locality?.name ?? null,
    place: ctx.place?.name ?? null,
    region: ctx.region?.name ?? null,
    country: ctx.country?.name ?? null,
  };
  const name = props.name ?? props.address_line1 ?? props.full_address;
  const primary =
    name ??
    hierarchy.street ??
    hierarchy.neighborhood ??
    hierarchy.locality ??
    hierarchy.place ??
    hierarchy.region ??
    hierarchy.country;
  const secondary = buildSecondary(hierarchy, primary);
  return primary ? { primary, secondary, address: props.full_address ?? props.address_line1, hierarchy } : null;
}

/**
 * Build address line from hierarchy (street, neighborhood, locality, place, region, country)
 */
export function buildAddressLine(hierarchy) {
  if (!hierarchy || typeof hierarchy !== "object") return null;
  const parts = [
    hierarchy.street,
    hierarchy.neighborhood,
    hierarchy.locality,
    hierarchy.place,
    hierarchy.region,
    hierarchy.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// Feature types that are specific enough to show as a primary location
const SPECIFIC_TYPES = new Set(["poi", "address", "street", "neighborhood", "locality"]);

/**
 * Fetch Geocoding v6 reverse and parse the best result.
 */
async function fetchV6Reverse(lat, lng, token, fetchFn) {
  const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&language=${GEOCODE_LANGUAGE}&types=address,street,neighborhood,locality,place,region,country&access_token=${token}`;
  const res = await fetchFn(url);
  const data = res.ok ? await res.json() : null;
  const features = data?.features ?? [];

  const v6TypeOrder = ["address", "street", "neighborhood", "locality", "place", "region", "country"];
  for (const type of v6TypeOrder) {
    const match = features.find((f) => (f.properties?.feature_type || "") === type);
    if (match) return parseGeocodingV6Feature(match);
  }
  return features.length > 0 ? parseGeocodingV6Feature(features[0]) : null;
}

/**
 * Merge two geocode results: prefer whichever has a more specific primary,
 * and fill missing hierarchy fields from the other.
 */
function mergeResults(specific, broad) {
  if (!specific && !broad) return null;
  if (!specific) return broad;
  if (!broad) return specific;

  const merged = { ...specific };
  if (broad.hierarchy) {
    merged.hierarchy = { ...merged.hierarchy };
    for (const key of Object.keys(broad.hierarchy)) {
      if (!merged.hierarchy[key] && broad.hierarchy[key]) {
        merged.hierarchy[key] = broad.hierarchy[key];
      }
    }
  }
  if (!merged.address && broad.address) {
    merged.address = broad.address;
  }
  return merged;
}

/**
 * Query Mapbox Tilequery API for the nearest road name from vector tiles.
 * This uses the same data the map renders, so any visible road name will be found.
 * @returns {Promise<string|null>} The road name, or null
 */
async function fetchNearestRoad(lat, lng, token, fetchFn) {
  const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json?radius=100&layers=road&limit=5&geometry=linestring&access_token=${token}`;
  const res = await fetchFn(url);
  const data = res.ok ? await res.json() : null;
  const features = data?.features ?? [];

  // Prefer the closest feature that has a name
  // Features are sorted by distance (tilequery_distance property)
  for (const f of features) {
    const name = f.properties?.name_en || f.properties?.name;
    if (name) return name;
  }
  return null;
}

/**
 * Reverse geocode coordinates to human-readable address/POI.
 *
 * Strategy (3 sources, most-specific wins):
 * 1. Search Box API  — best for POIs and named landmarks
 * 2. Geocoding v6    — best for street-level addresses
 * 3. Tilequery API   — queries map vector tiles for the nearest road name
 *    (covers small towns where geocoding has no street data but the map shows roads)
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} opts - { token?, fetchFn? } for testing
 * @returns {Promise<{primary, secondary, address, hierarchy}|null>}
 */
export async function reverseGeocode(lat, lng, opts = {}) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  // Check custom locations first — instant, no API call
  const custom = findCustomLocation(lat, lng);
  if (custom) { geocodeCache.set(key, custom); return custom; }

  const token = opts.token ?? (typeof import.meta !== "undefined" && import.meta.env?.VITE_MAPBOX_TOKEN);
  const fetchFn = opts.fetchFn ?? (typeof fetch !== "undefined" ? fetch : null);

  if (!token || !fetchFn) {
    geocodeCache.set(key, null);
    return null;
  }

  try {
    // 1. Search Box reverse — request only granular types + POI
    const searchBoxUrl = `https://api.mapbox.com/search/searchbox/v1/reverse?longitude=${lng}&latitude=${lat}&language=${GEOCODE_LANGUAGE}&limit=10&types=poi,address,street,neighborhood,locality&access_token=${token}`;
    const searchBoxRes = await fetchFn(searchBoxUrl);
    const searchBoxData = searchBoxRes.ok ? await searchBoxRes.json() : null;
    const features = searchBoxData?.features ?? [];

    // Pick the most specific Search Box feature
    const sbTypeOrder = ["poi", "address", "street", "neighborhood", "locality"];
    let sbResult = null;
    let sbType = null;
    for (const type of sbTypeOrder) {
      const match = features.find((f) => (f.properties?.feature_type || "") === type);
      if (match) {
        sbResult = parseSearchBoxFeature(match);
        sbType = type;
        break;
      }
    }
    if (!sbResult && features.length > 0) {
      sbResult = parseSearchBoxFeature(features[0]);
      sbType = features[0]?.properties?.feature_type;
    }

    // POIs are already specific (named landmarks) — return immediately
    if (sbResult && sbType === "poi") {
      geocodeCache.set(key, sbResult);
      return sbResult;
    }

    // 2. Always query Geocoding v6 for street-level precision
    const v6Result = await fetchV6Reverse(lat, lng, token, fetchFn);

    // 3. Decide which geocoding result is more specific
    let result = null;
    const sbIsSpecific = sbResult && SPECIFIC_TYPES.has(sbType);
    const v6IsSpecific = v6Result && v6Result.hierarchy?.street;

    if (sbIsSpecific && v6IsSpecific) {
      const sbIsAddr = sbType === "address" || sbType === "street";
      result = sbIsAddr ? mergeResults(sbResult, v6Result) : mergeResults(v6Result, sbResult);
    } else if (sbIsSpecific) {
      result = mergeResults(sbResult, v6Result);
    } else if (v6Result) {
      result = mergeResults(v6Result, sbResult);
    } else {
      result = sbResult;
    }

    // 4. If we still have no street, query Tilequery for the nearest road name.
    //    This covers small towns where geocoding APIs lack street data but the
    //    map tiles contain road names (e.g. "Allabad Road" visible on the map).
    const hasStreet = result?.hierarchy?.street || result?.primary !== result?.hierarchy?.place;
    if (!hasStreet || !result?.hierarchy?.street) {
      try {
        const roadName = await fetchNearestRoad(lat, lng, token, fetchFn);
        if (roadName) {
          if (!result) {
            result = {
              primary: roadName,
              secondary: null,
              address: null,
              hierarchy: { street: roadName, neighborhood: null, locality: null, place: null, region: null, country: null },
            };
          } else {
            result = { ...result, hierarchy: { ...result.hierarchy, street: roadName } };
            // Promote road name to primary if current primary is just a city/town
            const currentPrimary = result.primary;
            const isGeneric = currentPrimary === result.hierarchy.place
              || currentPrimary === result.hierarchy.region
              || currentPrimary === result.hierarchy.country;
            if (isGeneric) {
              result.primary = roadName;
              result.secondary = buildSecondary(result.hierarchy, roadName);
            } else if (!result.secondary || result.secondary === result.hierarchy.region) {
              result.secondary = buildSecondary(result.hierarchy, result.primary);
            }
          }
        }
      } catch {
        // Tilequery is best-effort; don't fail the whole lookup
      }
    }

    // Tag the result so the popup can distinguish landmarks from general areas
    if (result) {
      const h = result.hierarchy ?? {};
      result.isSpecific = !!(h.street || h.neighborhood || h.locality);
    }

    geocodeCache.set(key, result);
    return result;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}