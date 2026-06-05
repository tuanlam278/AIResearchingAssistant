/**
 * Auth Context: stores Supabase access token + current user for the app.
 * Token is persisted in localStorage so refreshes keep the session.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../services/api';

const AuthContext = createContext();
const TOKEN_KEY = 'ai-research-access-token';
const USER_KEY = 'ai-research-user';
const FORCE_LOGOUT_MESSAGE_KEY = 'ai-research-force-logout-message';
const LOGOUT_MARKER_KEY = 'ai-research-logged-out';
const APP_SESSION_KEYS = [
  'academicLens:session',
  'academicLens:lastPath',
  'researchWorkspace:lastPath',
];
const APP_SESSION_PREFIXES = ['academic-lens-note:', 'nb_name_'];
const CROSS_ANALYSIS_DRAFT_KEY = 'cross-analysis-current-draft-v1';

function clearStoredWorkSessionData() {
  APP_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem(CROSS_ANALYSIS_DRAFT_KEY);
  sessionStorage.removeItem(CROSS_ANALYSIS_DRAFT_KEY);

  [localStorage, sessionStorage].forEach((storage) => {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key && APP_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  });

  window.dispatchEvent(new CustomEvent('auth:clear-session-data'));
}

function storedUserId() {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return saved?.id || saved?.user_id || saved?.email || null;
  } catch {
    return null;
  }
}

function userIdentity(userData) {
  return userData?.id || userData?.user_id || userData?.email || null;
}

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    const logoutMarker = localStorage.getItem(LOGOUT_MARKER_KEY);
    if (logoutMarker) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setIsReady(true);
      return;
    }
    if (savedToken) setToken(savedToken);
    if (savedUser) {
      try { setUser(JSON.parse(savedUser)); } catch { localStorage.removeItem(USER_KEY); }
    }
    setIsReady(true);
  }, []);

  useEffect(() => {
    const forceLogout = (event) => {
      const message = event?.detail?.message || 'Tài khoản của bạn đã bị vô hiệu hóa hoặc không tồn tại.';
      setToken(null);
      setUser(null);
      clearStoredWorkSessionData();
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.setItem(FORCE_LOGOUT_MESSAGE_KEY, message);
      localStorage.setItem(LOGOUT_MARKER_KEY, String(Date.now()));
      if (window.location.pathname !== '/login') window.location.href = '/login';
    };
    window.addEventListener('auth:force-logout', forceLogout);
    return () => window.removeEventListener('auth:force-logout', forceLogout);
  }, []);

  useEffect(() => {
    if (!token || !isReady) return;
    let cancelled = false;
    api.me(token)
      .then((resp) => {
        if (!cancelled && resp?.user && !localStorage.getItem(LOGOUT_MARKER_KEY)) {
          setUser(resp.user);
          localStorage.setItem(USER_KEY, JSON.stringify(resp.user));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, isReady]);

  const loginContext = (newToken, userData) => {
    const previousUserId = storedUserId();
    const nextUserId = userIdentity(userData);
    if (previousUserId && nextUserId && previousUserId !== nextUserId) clearStoredWorkSessionData();
    setToken(newToken);
    setUser(userData);
    localStorage.removeItem(LOGOUT_MARKER_KEY);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData || null));
    setIsReady(true);
  };

  const updateUserContext = (userData) => {
    setUser(userData);
    localStorage.setItem(USER_KEY, JSON.stringify(userData || null));
  };

  const logoutContext = () => {
    setToken(null);
    setUser(null);
    clearStoredWorkSessionData();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.setItem(LOGOUT_MARKER_KEY, String(Date.now()));
  };

  return (
    <AuthContext.Provider value={{ token, user, isReady, loginContext, logoutContext, updateUserContext }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth phải được sử dụng bên trong AuthProvider');
  return context;
};
