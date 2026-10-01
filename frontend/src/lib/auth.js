"use client";
// Who is logged in. Wrap the app in <AuthProvider>, then use useAuth().
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { TOKEN_KEY, api, getToken, setToken } from "./api";
import { resetSocket } from "./live";

const AuthContext = createContext(null);

/** The logged-in user, or null. */
async function loadUser() {
  if (!getToken()) return null;
  try {
    return (await api("/me")).user;
  } catch (err) {
    if (err.status === 401) setToken(null); // login expired
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Loads the logged-in user again (e.g. after KYC changes).
  const refresh = useCallback(() => loadUser().then(setUser), []);

  useEffect(() => {
    let active = true;
    loadUser().then((u) => {
      if (!active) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // The login is saved in the browser, so all tabs share it. When another tab
  // logs in, signs up or logs out, reload this tab so it shows that user.
  // Otherwise it would show one person's name with another person's data.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === TOKEN_KEY || e.key === null) window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const login = useCallback((token, u) => {
    setToken(token);
    resetSocket();
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    resetSocket();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

/** Where each role lands after login. */
export function homeFor(user) {
  if (user?.role === "admin") return "/admin";
  if (user?.role === "land_authority") return "/land";
  if (user?.role === "owner") return "/owner";
  return "/portfolio";
}
