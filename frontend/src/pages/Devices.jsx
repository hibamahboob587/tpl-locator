import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import DeviceList from "../components/DeviceList.jsx";
import Trajectory from "../components/Trajectory.jsx";
import Playback from "../components/Playback.jsx";
import MapView from "../components/MapView.jsx";
import { useCityTag } from "../hooks/useCityTag.js";
import { useAuth } from "../context/AuthContext.jsx";
import AOS from "aos";
import "aos/dist/aos.css";
import "../pages/Devices.css";
import tplLogo from "../assets/tpl.png";

export default function Devices() {
  const { logout, user } = useAuth();
  const { getDevices } = useCityTag();

  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeView, setActiveView] = useState("home");

  const fileInputRef = useRef(null);

  const [profileData, setProfileData] = useState({
    realName: "TPL Trakker",
    introduction: "163.61.154.14@Sindh-Karachi@Android-15/CityTag-1.9.9"
  });

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      const list = await getDevices();
      setDevices(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    AOS.init({ duration: 1000, once: true });
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setShowProfileModal(false);
    alert("Profile updated successfully!");
  };

  const handleAvatarClick = () => {
    fileInputRef.current.click();
  };

  return (
    <div className="relative min-h-screen bg-slate-50">

      {/* Watermark */}
      <div className="fixed inset-0 pointer-events-none flex items-center justify-center -z-10 overflow-hidden">
        <img
          src={tplLogo}
          alt="Watermark"
          className="w-[80%] md:w-[50%] opacity-50 rotate-12 select-none"
          style={{ mixBlendMode: "multiply" }}
        />
      </div>

      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-[#800000] shadow-md border-b border-red-900">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">

          {/* Left Side */}
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <img
                src={tplLogo}
                alt="TPL Logo"
                className="h-10 w-auto brightness-0 invert"
              />
              <span className="text-white font-bold tracking-wider hidden sm:inline uppercase">
                TPL TRAKKER
              </span>
            </div>

            {/* Navigation Tabs */}
            <div className="hidden md:flex items-center gap-6 text-sm font-semibold text-red-100">
              {["home", "trajectory", "playback", "mapview"].map((view) => (
                <button
                  key={view}
                  onClick={() => setActiveView(view)}
                  className={`pb-1 capitalize transition-all ${
                    activeView === view
                      ? "text-white border-b-2 border-white"
                      : "hover:text-white"
                  }`}
                >
                  {view}
                </button>
              ))}
            </div>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-4">

            {/* Refresh */}
            <button
              onClick={refresh}
              className="text-red-100 hover:text-white transition-colors p-2"
            >
              <span className={loading ? "animate-spin inline-block" : ""}>
                ↻
              </span>
            </button>

            {/* User Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-3 bg-red-900/40 hover:bg-red-900/60 px-3 py-1.5 rounded-lg transition-all border border-red-800/50"
              >
                <div className="text-right hidden md:block">
                  <p className="text-[11px] font-bold text-red-200 uppercase leading-none mb-1">
                    TPL Trakker
                  </p>
                  <p className="text-sm font-semibold text-white leading-none">
                    {user?.email?.split("@")[0]}
                  </p>
                </div>
                <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center text-[#800000] font-bold">
                  {user?.email?.charAt(0).toUpperCase()}
                </div>
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden py-1 z-[60]">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {user?.email}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono mt-1">
                      UID: {user?.uid}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setShowProfileModal(true);
                      setShowDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    👤 Personal Profile
                  </button>

                  <hr className="my-1 border-slate-100" />

                  <button
                    onClick={logout}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 font-semibold flex items-center gap-2"
                  >
                    🚪 Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 py-12">

        {/* Title */}
        <div className="mb-8">
          <h2 className="text-4xl font-black text-slate-900 uppercase">
            {activeView}
          </h2>
          <div className="h-1.5 w-12 bg-[#800000] rounded-full mt-2"></div>
        </div>

        <div className="rounded-[2rem] bg-white shadow-lg border border-slate-100 p-8">

          {error && (
            <div className="text-red-500 mb-4">{error}</div>
          )}

          {activeView === "home" && (
            <DeviceList devices={devices} loading={loading} />
          )}

          {activeView === "trajectory" && (
            <Trajectory devices={devices} />
          )}

          {activeView === "playback" && (
            <Playback devices={devices} />
          )}

          {activeView === "mapview" && (
            <MapView devices={devices} />
          )}

        </div>

        <div className="mt-6">
          <Link
            to="/login"
            className="text-sm font-bold text-[#800000] hover:underline"
          >
            Switch account →
          </Link>
        </div>
      </main>
    </div>
  );
}
