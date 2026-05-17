import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import HomePage from './pages/HomePage';
import ResearchPage from './pages/ResearchPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Component "Bảo vệ": Kiểm tra xem user có vé (token) chưa. 
// Chưa có thì sút ra ngoài trang Login.
const ProtectedRoute = ({ children }) => {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

export default function App() {
  return (
    // Phải bọc AuthProvider ở ngoài cùng thì toàn app mới dùng được token
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ---- Các trang ai cũng vào được (Public) ---- */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* ---- Các trang phải đăng nhập mới vào được (Protected) ---- */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/research/:docId" 
            element={
              <ProtectedRoute>
                <ResearchPage />
              </ProtectedRoute>
            } 
          />

          {/* Nếu user gõ bậy bạ một link không tồn tại thì tự động đá về Trang chủ */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}