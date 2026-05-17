/**
 * FE1 implement: Trang chủ
 * - Hiển thị DocumentUploader
 * - Hiển thị DocumentList
 * - Khi click vào document → navigate tới /research/:docId
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DocumentUploader from '../components/DocumentUploader';
import DocumentList from '../components/DocumentList';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Móc token và user từ Context ra
  const { token, user, logoutContext } = useAuth(); 

  const fetchDocuments = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await api.getDocuments(token);
      if (result.success) setDocuments(result.data.documents);
    } catch (err) {
      if (err.message === "UNAUTHORIZED") logoutContext();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [token]);

  const handleLogout = async () => {
    try {
      await api.logout(token);
    } catch (err) {
      console.error("Lỗi đăng xuất server", err);
    } finally {
      logoutContext(); // Xóa token local
      navigate('/login');
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Chắc chắn muốn xóa tài liệu này?')) return;
    try {
      await api.deleteDocument(docId, token);
      setDocuments((prev) => prev.filter((d) => d.doc_id !== docId));
    } catch (err) {
      alert('Xóa thất bại!');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header có thêm nút Đăng xuất */}
        <header className="mb-8 flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">📚 AI Research</h1>
            {user && <p className="text-sm text-gray-500 mt-1">Xin chào, {user.email}</p>}
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition"
          >
            <LogOut size={18} className="mr-2" /> Đăng xuất
          </button>
        </header>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
          <h2 className="text-lg font-semibold mb-4 text-gray-800">Thêm tài liệu mới</h2>
          <DocumentUploader onSuccess={fetchDocuments} token={token} />
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Tài liệu của bạn</h2>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <DocumentList
              documents={documents}
              onSelect={(docId) => navigate(`/research/${docId}`)}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}