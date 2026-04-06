import { useState, useEffect } from 'react';
import { parseKMLText } from '../utils/geofenceUtils.js';

/**
 * Loads and parses /areas.kml (same source as FencePage).
 * Returns { areas, kmlLoading } where areas is the parsed array from parseKMLText.
 */
export function useKmlAreas() {
  const [areas, setAreas]         = useState([]);
  const [kmlLoading, setKmlLoading] = useState(true);

  useEffect(() => {
    fetch('/areas.kml')
      .then(r => r.text())
      .then(text => setAreas(parseKMLText(text)))
      .catch(err => console.error('KML load error:', err))
      .finally(() => setKmlLoading(false));
  }, []);

  return { areas, kmlLoading };
}
