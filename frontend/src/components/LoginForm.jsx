import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCityTag } from "../hooks/useCityTag.js";
import { useAuth } from "../context/AuthContext.jsx";

const MODE = { USER_LOGIN: "user_login", ADMIN_LOGIN: "admin_login", SIGNUP: "signup" };

export default function LoginForm() {
  const navigate = useNavigate();
  const { login, adminLogin, signup } = useCityTag();
  const { loginSuccess } = useAuth();

  const [mode, setMode] = useState(MODE.USER_LOGIN);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = mode === MODE.ADMIN_LOGIN;
  const isSignup = mode === MODE.SIGNUP;
  const isUserLogin = mode === MODE.USER_LOGIN;

  const canSubmit = (() => {
    if (loading) return false;
    if (!email.trim() || !password) return false;
    if (isAdmin && !uid.trim()) return false;
    if (isSignup && (!name.trim() || !confirmPassword || password !== confirmPassword)) return false;
    return true;
  })();

  function switchMode(newMode) {
    setMode(newMode);
    setError("");
    setConfirmPassword("");
    if (newMode !== MODE.ADMIN_LOGIN) setUid("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignup) {
        // 1) Create the user account
        await signup({
          email: email.trim(),
          password,
          name: name.trim(),
        });
        // 2) Log in to obtain JWT + role
        const res = await login({
          email: email.trim(),
          password,
        });
        loginSuccess({
          user: res.user ?? res.admin ?? null,
          accessToken: res.access_token,
          role: res.role ?? "user",
        });
        navigate("/devices");
      } else if (isAdmin) {
        const res = await adminLogin({
          email: email.trim(),
          password,
          uid: uid.trim(),
        });
        loginSuccess({
          user: res.admin ?? res.user ?? null,
          accessToken: res.access_token,
          role: res.role ?? "admin",
        });
        navigate("/devices");
      } else {
        const res = await login({
          email: email.trim(),
          password,
        });
        loginSuccess({
          user: res.user ?? res.admin ?? null,
          accessToken: res.access_token,
          role: res.role ?? "user",
        });
        navigate("/devices");
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const buttonLabel = isSignup
    ? loading ? "Creating Account..." : "Sign Up"
    : loading ? "Logging in..." : "Login";

  return (
    <div>
      {/* ── Admin / User Toggle ── */}
      {!isSignup && (
        <div style={{
          display: "flex",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 10,
          padding: 3,
          marginBottom: 20,
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <button
            type="button"
            onClick={() => switchMode(MODE.USER_LOGIN)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s",
              background: isUserLogin ? "#800000" : "transparent",
              color: isUserLogin ? "#fff" : "rgba(255,255,255,0.45)",
              boxShadow: isUserLogin ? "0 2px 8px rgba(128,0,0,0.3)" : "none",
            }}
          >
            User
          </button>
          <button
            type="button"
            onClick={() => switchMode(MODE.ADMIN_LOGIN)}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              transition: "all 0.2s",
              background: isAdmin ? "#800000" : "transparent",
              color: isAdmin ? "#fff" : "rgba(255,255,255,0.45)",
              boxShadow: isAdmin ? "0 2px 8px rgba(128,0,0,0.3)" : "none",
            }}
          >
            Admin
          </button>
        </div>
      )}

      {/* Signup header back arrow */}
      {isSignup && (
        <button
          type="button"
          onClick={() => switchMode(MODE.USER_LOGIN)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Login
        </button>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Full Name (signup only) */}
        {isSignup && (
          <div>
            <label className="block text-sm font-medium text-white">Full Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white text-slate-900"
              value={name}
              onChange={(e) => setName(e.target.value)}
              type="text"
              placeholder="e.g. John Doe"
              autoComplete="name"
              required
            />
          </div>
        )}
        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-white">Email</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white text-slate-900"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            required
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-white">Password</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white text-slate-900"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />
        </div>

        {/* Confirm Password (signup only) */}
        {isSignup && (
          <div>
            <label className="block text-sm font-medium text-white">Confirm Password</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white text-slate-900"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              required
            />
            {confirmPassword && password !== confirmPassword && (
              <p style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
                Passwords do not match
              </p>
            )}
          </div>
        )}

        {/* UID (admin only) */}
        {isAdmin && (
          <div>
            <label className="block text-sm font-medium text-white">
              UID <span className="text-red-500">*</span>
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white text-slate-900"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              type="text"
              inputMode="numeric"
              required
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-slate-900 text-white py-2.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition"
        >
          {buttonLabel}
        </button>
      </form>

      {/* ── Footer links ── */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        {isUserLogin && (
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
            Don't have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode(MODE.SIGNUP)}
              style={{
                background: "none",
                border: "none",
                color: "#cc4444",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Sign up
            </button>
          </p>
        )}
        {isSignup && (
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode(MODE.USER_LOGIN)}
              style={{
                background: "none",
                border: "none",
                color: "#cc4444",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Login
            </button>
          </p>
        )}
      </div>
    </div>
  );
}