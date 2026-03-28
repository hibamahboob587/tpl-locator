import React from "react";
import { useMapTheme } from "../context/MapThemeContext.jsx";

export default function MapThemeToggle() {
  const { theme, toggleTheme } = useMapTheme();
  const isDark = theme === "dark";

  return (
    <div
      title={isDark ? "Switch maps to light" : "Switch maps to dark"}
      style={{ position: "relative", width: 60, height: 30 }}
    >
      <label
        style={{
          position: "absolute",
          width: "100%",
          height: 30,
          backgroundColor: isDark ? "#28292c" : "#d8dbe0",
          borderRadius: 15,
          cursor: "pointer",
          border: `2px solid ${isDark ? "#28292c" : "#d8dbe0"}`,
          boxSizing: "border-box",
          transition: "background-color 0.3s, border-color 0.3s",
        }}
      >
        <input
          type="checkbox"
          checked={!isDark}
          onChange={toggleTheme}
          style={{ display: "none" }}
        />

        {/* Slider track */}
        <span
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            borderRadius: 15,
            backgroundColor: isDark ? "#28292c" : "#d8dbe0",
            transition: "background-color 0.3s",
          }}
        />

        {/* Sliding knob */}
        <span
          style={{
            position: "absolute",
            top: 5,
            left: 5,
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: "#28292c",
            boxShadow: isDark ? "inset 7px -2px 0px 0px #d8dbe0" : "none",
            transform: isDark ? "translateX(0)" : "translateX(30px)",
            transition: "transform 0.3s, box-shadow 0.3s",
          }}
        />
      </label>
    </div>
  );
}