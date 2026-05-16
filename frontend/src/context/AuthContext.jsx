/**
 * FE1 implement: Auth Context
 * Lưu token + user, chia sẻ cho toàn bộ app.
 * Wrap <App /> bằng <AuthProvider> trong main.jsx.
 */
import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null)
  const [user, setUser] = useState(null)

  const login = (data) => {
    setToken(data.access_token)
    setUser(data.user)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  const isAuthenticated = !!token

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuthenticated }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
