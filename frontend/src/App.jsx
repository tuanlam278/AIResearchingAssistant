import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppShell from './layouts/AppShell';
import NotebooksPage from './pages/Notebookspage';
import NotebookPage from './pages/Notebookpage';
import ResearchPage from './pages/ResearchPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import SystemLibraryPage from './pages/SystemLibraryPage';
import AdminPage from './pages/AdminPage';
import CrossAnalysisPage from './pages/CrossAnalysisPage';
import AcademicLensPage from './pages/AcademicLensPage';
import HomePage from './pages/HomePage';
import ProfilePage from './pages/ProfilePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';

const ProtectedRoute = ({ children }) => {
  const { token, isReady } = useAuth();
  if (!isReady && !token) return <Navigate to="/login" replace />;
  if (isReady && !token) return <Navigate to="/login" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { token, user, isReady } = useAuth();
  if (!isReady && !token) return <Navigate to="/login" replace />;
  if (isReady && !token) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/home" replace />;
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>

          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/notebook" element={<NotebooksPage />} />
            <Route path="/notebooks/:notebookId" element={<NotebookPage />} />
            <Route path="/research/:notebookId" element={<ResearchPage />} />
            <Route path="/academic-lens" element={<AcademicLensPage />} />
            <Route path="/cross-analysis" element={<CrossAnalysisPage />} />
            <Route path="/system-library" element={<SystemLibraryPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/home" />} />

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}