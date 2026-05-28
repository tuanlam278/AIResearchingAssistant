import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import NotebooksPage from './pages/Notebookspage';
import NotebookPage from './pages/Notebookpage';
import ResearchPage from './pages/ResearchPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

const ProtectedRoute = ({ children }) => {
  const { token, isReady } = useAuth();
  if (!isReady && !token) return <Navigate to="/login" replace />;
  if (isReady && !token) return <Navigate to="/login" replace />;
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>

          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <NotebooksPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notebooks/:notebookId"
            element={
              <ProtectedRoute>
                <NotebookPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/research/:notebookId"
            element={
              <ProtectedRoute>
                <ResearchPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" />} />

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}