/**
 * Auth Context: stores Supabase access token + current user for the app.
 * Token is persisted in localStorage so refreshes keep the session.
 */
import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext();
const TOKEN_KEY = 'ai-research-access-token';
const USER_KEY = 'ai-research-user';

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
