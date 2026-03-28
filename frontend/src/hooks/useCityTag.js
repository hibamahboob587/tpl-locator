// frontend/src/hooks/useCityTag.js

import { useCallback } from "react";
import { useAuth } from "../context/AuthContext.jsx";

const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "");

async function apiFetch(path, { method = "GET", body } = {}, accessToken) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const url = `${API_BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (networkErr) {
    throw new Error(networkErr.message === "Failed to fetch"
      ? "Network error. Start the backend (e.g. uvicorn app.main:app --reload --port 8000)"
      : networkErr.message);
  }

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const message = typeof payload === "string" ? payload : payload?.detail || payload?.error || "Request failed";
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export function useCityTag() {
  const { accessToken, isAdmin } = useAuth();

  const login = useCallback(
    async ({ email, password }) =>
      apiFetch("/api/login", { method: "POST", body: { email, password, uid: "" } }, null), []
  );

  const adminLogin = useCallback(
    async ({ email, password, uid }) =>
      apiFetch("/api/login", { method: "POST", body: { email, password, uid: (uid || "").trim() } }, null), []
  );

  const signup = useCallback(
    async ({ email, password, name }) =>
      apiFetch("/api/register", { method: "POST", body: { email, password, name: name || "" } }, null), []
  );

  const getDevices = useCallback(
    async () => apiFetch(isAdmin ? "/api/admin/devices" : "/api/devices", {}, accessToken),
    [accessToken, isAdmin]
  );

  // User bind — hits /api/devices (user endpoint)
  const bindDevice = useCallback(
    async ({ sn, label, client }) =>
      apiFetch("/api/devices", { method: "POST", body: { sn, name: label, client: client || "" } }, accessToken),
    [accessToken]
  );

  const bindDeviceByEmail = useCallback(
    async ({ sn, email, name = "", client = "" }) =>
      apiFetch(
        "/api/devices",
        { method: "POST", body: { sn, email: email || undefined, user_id: undefined, name, client } },
        accessToken
      ),
    [accessToken]
  );

  const unbindDevice = useCallback(
    async (sn) => apiFetch(`/api/devices/${encodeURIComponent(sn)}`, { method: "DELETE" }, accessToken),
    [accessToken]
  );

  const adminUnbindDevice = useCallback(
    async (sn) => apiFetch(`/api/admin/devices/${encodeURIComponent(sn)}/unassign`, { method: "DELETE" }, accessToken),
    [accessToken]
  );

  const getUsers = useCallback(
    async () => apiFetch("/api/users", {}, accessToken), [accessToken]
  );

  const adminGetUsers = useCallback(
    async () => apiFetch("/api/admin/users", {}, accessToken), [accessToken]
  );

  const adminCreateUser = useCallback(
    async ({ email, password, name }) =>
      apiFetch("/api/admin/users", { method: "POST", body: { email, password, name } }, accessToken),
    [accessToken]
  );

  // Admin assigns a device to a user via unified endpoint.
  const adminAssignDeviceToUser = useCallback(
    async (userId, sn, { name = "", client = "" } = {}) =>
      apiFetch(
        "/api/devices",
        { method: "POST", body: { sn, user_id: userId, name, client } },
        accessToken
      ),
    [accessToken]
  );

  // Admin unassigns by SN via unified endpoint.
  const adminUnassignDeviceFromUser = useCallback(
    async (_userId, sn) =>
      apiFetch(`/api/devices/${encodeURIComponent(sn)}`, { method: "DELETE" }, accessToken),
    [accessToken]
  );

  // Admin deletes a user (also unassigns all their devices via backend)
  const adminDeleteUser = useCallback(
    async (userId) =>
      apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" }, accessToken),
    [accessToken]
  );

  const adminUpdateUser = useCallback(
    async (userId, { name, password } = {}) =>
      apiFetch(
        `/api/admin/users/${encodeURIComponent(userId)}`,
        { method: "PUT", body: { name, password } },
        accessToken
      ),
    [accessToken]
  );

  const adminUpdateDevice = useCallback(
    async (sn, { name, client, region } = {}) =>
      apiFetch(
        `/api/admin/devices/${encodeURIComponent(sn)}`,
        { method: "PUT", body: { name, client, region } },
        accessToken
      ),
    [accessToken]
  );

  const searchDevice = useCallback(
    async (sn) => apiFetch(`/api/admin/devices/search/${encodeURIComponent(sn)}`, {}, accessToken),
    [accessToken]
  );

  const getLatestLocation = useCallback(
    async (sn) => apiFetch(`/api/location/${encodeURIComponent(sn)}`, {}, accessToken),
    [accessToken]
  );

  const getTrajectory = useCallback(
    async (sn, start, end) => {
      const params = new URLSearchParams({
        start: start instanceof Date ? start.toISOString() : start,
        end:   end   instanceof Date ? end.toISOString()   : end,
      });
      return apiFetch(`/api/devices/${encodeURIComponent(sn)}/trajectory?${params}`, {}, accessToken);
    }, [accessToken]
  );

  const getPlayback = useCallback(
    async (sn, start, end) => {
      const params = new URLSearchParams({
        start: start instanceof Date ? start.toISOString() : start,
        end:   end   instanceof Date ? end.toISOString()   : end,
      });
      return apiFetch(`/api/devices/${encodeURIComponent(sn)}/playback?${params}`, {}, accessToken);
    }, [accessToken]
  );

  return {
    login, adminLogin, signup,
    getDevices, getUsers, adminGetUsers, adminCreateUser,
    adminAssignDeviceToUser, adminUnassignDeviceFromUser, adminDeleteUser, adminUpdateUser,
    adminUpdateDevice,
    bindDevice, bindDeviceByEmail, unbindDevice, adminUnbindDevice,
    searchDevice, getLatestLocation, getTrajectory, getPlayback,
  };
}