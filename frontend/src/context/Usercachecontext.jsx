import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useCityTag } from "../hooks/useCityTag.js";
import { useAuth } from "./AuthContext.jsx";

const UserCacheContext = createContext(null);

export function UserCacheProvider({ children }) {
  const { adminGetUsers } = useCityTag();
  const { user, isAdmin } = useAuth();

  const [users, setUsers]             = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [lastFetched, setLastFetched] = useState(null);

  const adminGetUsersRef = useRef(adminGetUsers);
  useEffect(() => { adminGetUsersRef.current = adminGetUsers; }, [adminGetUsers]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminGetUsersRef.current();
      setUsers(Array.isArray(data) ? data : []);
      setLastFetched(Date.now());
    } catch (err) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  // Prefetch as soon as admin is authenticated; clear on logout
  useEffect(() => {
    if (user && isAdmin) fetchUsers();
    else { setUsers([]); setLastFetched(null); setError(""); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user, isAdmin]);

  return (
    <UserCacheContext.Provider value={{ users, loading, error, refresh: fetchUsers, lastFetched }}>
      {children}
    </UserCacheContext.Provider>
  );
}

export function useUserCache() {
  const ctx = useContext(UserCacheContext);
  if (!ctx) throw new Error("useUserCache must be used inside UserCacheProvider");
  return ctx;
}