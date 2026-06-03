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

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
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
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.setItem(FORCE_LOGOUT_MESSAGE_KEY, message);
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
        if (!cancelled && resp?.user) {
          setUser(resp.user);
          localStorage.setItem(USER_KEY, JSON.stringify(resp.user));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, isReady]);

  const loginContext = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
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
