/**
 * FE1 implement: Auth Context
 * Lưu token + user, chia sẻ cho toàn bộ app.
 * Wrap <App /> bằng <AuthProvider> trong main.jsx.
 */
import { createContext, useState, useContext } from 'react';

// 1. Khởi tạo Context
const AuthContext = createContext();

// 2. Tạo Provider để bọc toàn bộ App
export const AuthProvider = ({ children }) => {
  // Lưu trữ trạng thái xác thực trên RAM (biến state)
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isReady, setIsReady] = useState(false);

  // Hàm được gọi khi LoginPage.jsx đăng nhập thành công
  const loginContext = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setIsReady(true);
  };

  // Hàm được gọi khi bấm nút Đăng xuất ở HomePage.jsx hoặc khi token hết hạn (lỗi 401)
  const logoutContext = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, isReady, loginContext, logoutContext }}>
      {children}
    </AuthContext.Provider>
  );
};

// 3. Custom hook để các component con gọi ra xài cho gọn (thay vì phải import useContext và AuthContext lắt nhắt)
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth phải được sử dụng bên trong AuthProvider");
  }
  return context;
};