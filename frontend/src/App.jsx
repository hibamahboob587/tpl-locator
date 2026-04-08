// frontend/src/App.jsx
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Login from "./pages/Login.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { MapThemeProvider } from "./context/MapThemeContext.jsx";
import { BindCacheProvider } from "./context/BindCacheContext.jsx";

import Layout from "./components/Layout.jsx";
import HomePage from "./pages/HomePage.jsx";
import DevicesPage from "./pages/DevicesPage.jsx";
import TrajectoryPage from "./pages/TrajectoryPage.jsx";
import MapViewPage from "./pages/MapViewPage.jsx";
import PlaybackPage from "./pages/PlaybackPage.jsx";
import ReportPage from "./pages/ReportPage.jsx";
import FencePage from "./pages/Fencepage.jsx";
import FieldStaffDashboard from "./pages/FieldStaffDashboard.jsx";

function ProtectedRoute({ children }) {
  const { accessToken } = useAuth();
  if (!accessToken) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Signup is now handled inside the login page toggle */}
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <BindCacheProvider>
            <MapThemeProvider>
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/Homepage" replace />} />
                  <Route path="/Homepage" element={<HomePage />} />
                  <Route path="/devices" element={<DevicesPage />} />
                  <Route path="/trajectory" element={<TrajectoryPage />} />
                  <Route path="/mapview" element={<MapViewPage />} />
                  <Route path="/playback" element={<PlaybackPage />} />
                  <Route path="/fence" element={<FencePage />} />
                  <Route path="/report" element={<ReportPage />} />
                  <Route path="/field-staff-dashboard" element={<FieldStaffDashboard />} />
                  <Route path="*" element={<Navigate to="/Homepage" replace />} />
                </Routes>
              </Layout>
            </MapThemeProvider>
            </BindCacheProvider>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}