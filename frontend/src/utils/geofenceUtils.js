// Shared geofence utilities — used by FencePage and HomePage

export function pointInPolygon([lat, lng], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInArea(point, coords) {
  if (!coords?.length) return false;
  if (Array.isArray(coords[0][0])) return coords.some((poly) => pointInPolygon(point, poly));
  return pointInPolygon(point, coords);
}

export function parseKMLText(kmlText) {
  const xmlDoc = new DOMParser().parseFromString(kmlText, "text/xml");
  const areas  = [];
  const ln = (el) => el.localName || el.tagName.split(":").pop();
  function directName(el) {
    for (const child of el.children) if (ln(child) === "name") return child.textContent.trim();
    return "";
  }
  function getCoords(mark) {
    for (const el of mark.getElementsByTagName("*")) {
      if (ln(el) === "coordinates") {
        const coords = el.textContent.trim().split(/\s+/).filter((s) => s.includes(","))
          .map((c) => { const [lng, lat] = c.split(",").map(Number); return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]; })
          .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));
        return coords.length >= 3 ? coords : null;
      }
    }
    return null;
  }
  const allFolders  = Array.from(xmlDoc.getElementsByTagName("Folder"));
  const zoneFolders = allFolders.filter((f) => Array.from(f.children).some((c) => {
    if (ln(c) !== "Placemark") return false;
    for (const el of c.getElementsByTagName("*")) if (ln(el) === "coordinates") return true;
    return false;
  }));
  if (zoneFolders.length > 0) {
    const parentMap = new Map();
    zoneFolders.forEach((zone) => {
      const p = zone.parentElement;
      if (!parentMap.has(p)) parentMap.set(p, []);
      parentMap.get(p).push(zone);
    });
    parentMap.forEach((zones, parent) => {
      const pt = ln(parent);
      if (pt === "Document" || pt === "kml") return;
      if (zones.length > 1) {
        const areaName  = directName(parent) || "Unnamed Area";
        const allCoords = [];
        zones.forEach((zone) => { for (const mark of zone.getElementsByTagName("Placemark")) { const c = getCoords(mark); if (c) allCoords.push(c); } });
        if (!allCoords.length) return;
        areas.push({ id: `area_${areas.length}_${areaName}`, name: areaName, tehsil: "Areas", type: "", ucNo: `${zones.length} zones`, district: "", coords: allCoords });
      } else {
        const folder = zones[0];
        for (const mark of Array.from(folder.children)) {
          if (ln(mark) !== "Placemark") continue;
          const c = getCoords(mark);
          if (!c) continue;
          const name = directName(mark) || "Unnamed";
          areas.push({ id: `area_${areas.length}_${name}`, name, tehsil: directName(folder) || "Areas", type: "", ucNo: "", district: "", coords: [c] });
        }
      }
    });
  }
  return areas;
}
