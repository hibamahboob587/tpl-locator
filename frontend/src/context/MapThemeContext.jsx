import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "map_theme";

const MapThemeContext = createContext(null);

export function MapThemeProvider({ children }) {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {}
  }, []);

  const setMapTheme = useCallback((next) => {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setMapTheme(theme === "dark" ? "light" : "dark");
  }, [setMapTheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme: setMapTheme, toggleTheme }),
    [theme, setMapTheme, toggleTheme]
  );

  return <MapThemeContext.Provider value={value}>{children}</MapThemeContext.Provider>;
}

export function useMapTheme() {
  const ctx = useContext(MapThemeContext);
  if (!ctx) throw new Error("useMapTheme must be used inside a MapThemeProvider");
  return ctx;
}
