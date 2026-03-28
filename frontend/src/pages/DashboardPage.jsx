// DashboardPage.jsx
import { useState } from "react";
import DeviceManagement from "./DeviceManagement"; // your FIRST file
import AnalyticsDashboard from "./AnalyticsDashboard"; // your SECOND file

export default function DashboardPage() {
  const [view, setView] = useState("analytics");

  return (
    <div className="dashboard-page">
      <div className="dashboard-toggle">
        <button onClick={() => setView("analytics")}>Analytics</button>
        <button onClick={() => setView("management")}>Management</button>
      </div>

      {view === "analytics" ? <AnalyticsDashboard /> : <DeviceManagement />}
    </div>
  );
}