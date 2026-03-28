import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useCityTag } from "../hooks/useCityTag.js";
import { useAuth } from "./AuthContext.jsx";

const DeviceCacheContext = createContext(null);

export function DeviceCacheProvider({ children }) {
  const { getDevices } = useCityTag();
  const { user } = useAuth();
  const [devices, setDevices]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [lastFetched, setLastFetched] = useState(null);

  const getDevicesRef = useRef(getDevices);
  useEffect(() => { getDevicesRef.current = getDevices; }, [getDevices]);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getDevicesRef.current();
      const list = Array.isArray(data) ? data : data?.devices ?? [];
      setDevices(list);
      setLastFetched(Date.now());
    } catch (err) {
      setError(err.message || "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, []);

  // Prefetch as soon as the user is authenticated; clear on logout
  useEffect(() => {
    if (user) fetchDevices();
    else { setDevices([]); setLastFetched(null); setError(""); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  return (
    <DeviceCacheContext.Provider value={{ devices, loading, error, refresh: fetchDevices, lastFetched }}>
      {children}
    </DeviceCacheContext.Provider>
  );
}

export function useDeviceCache() {
  const ctx = useContext(DeviceCacheContext);
  if (!ctx) throw new Error("useDeviceCache must be used inside DeviceCacheProvider");
  return ctx;
}