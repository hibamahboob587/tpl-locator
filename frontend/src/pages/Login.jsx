import React, { useEffect } from "react";
import { Navigate } from "react-router-dom";
import LoginForm from "../components/LoginForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import AOS from "aos";
import "aos/dist/aos.css";
import "../pages/Login.css";

import tplLogo from "../assets/tpl.png";

export default function Login() {
  const { accessToken } = useAuth();

  useEffect(() => {
    AOS.init({
      duration: 1000,
      once: true,
      easing: "ease-out-back",
    });
  }, []);

  // Already logged in — redirect to dashboard
  if (accessToken) return <Navigate to="/devices" replace />;

  return (
    <div className="grid-wrapper">
      
      {/* BACKGROUND LAYER */}
      <div className="grid-background">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#800000] opacity-30 blur-[120px] rounded-full" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#800000] opacity-30 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#800000]/10 via-transparent to-[#800000]/10" />
        <div className="absolute inset-0 grid grid-cols-[repeat(auto-fill,40px)] grid-rows-[repeat(auto-fill,40px)] opacity-[0.45]">
          {[...Array(300)].map((_, i) => (
            <div
              key={i}
              className={`w-[40px] h-[40px] ${
                i % 31 === 0 ? "bg-[#800000]" : i % 18 === 0 ? "bg-slate-700" : ""
              }`}
            ></div>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div className="login-content-container">
        
        {/* Branding */}
        <div className="mb-10 text-center" data-aos="fade-down">
          <div className="inline-flex items-center justify-center p-4 bg-white rounded-3xl shadow-sm border border-slate-200 mb-6">
            <img src={tplLogo} alt="TPL Logo" className="h-10 w-auto" />
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase">
            TPL Trakker
          </h1>
          <div className="h-1.5 w-12 bg-[#800000] rounded-full mx-auto mt-4"></div>
        </div>

        {/* Login Card */}
        <div className="card" data-aos="zoom-in" data-aos-delay="200">
          <div className="card2">
            <div className="form-container">
              <p id="heading" className="text-white">Account</p>
              <div className="login-form-content">
                <LoginForm />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 text-center" data-aos="fade-up" data-aos-delay="400">
          <p className="text-[10px] font-bold text-white uppercase tracking-[0.3em]">
            Secure Infrastructure • TPL Trakker
          </p>
        </div>
      </div>
    </div>
  );
}