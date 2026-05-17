/**
 * FE1 implement
 * Props:
 *   onSuccess: (doc: DocumentResponse) => void
 */
import { useState, useRef } from 'react';
import { UploadCloud, Loader2, FileWarning } from 'lucide-react';
import { api } from '../services/api';

// Nhận thêm props token
export default function DocumentUploader({ onSuccess, token }) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) processFile(files[0]);
  };
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
  };
  const handleAreaClick = () => { if (!loading) fileInputRef.current.click(); };

  const processFile = async (file) => {
    if (!token) {
      setError("Vui lòng đăng nhập để upload tài liệu.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Truyền file và token vào hàm API
      await api.uploadDocument(file, token);
      if (onSuccess) onSuccess();
    } catch (err) {
      // Thêm xử lý lỗi xác thực
      if (err.message === "UNAUTHORIZED") {
        setError("Phiên đăng nhập hết hạn. Vui lòng tải lại trang hoặc đăng nhập lại.");
      } else if (err.message === "FILE_TOO_LARGE") {
        setError("Dung lượng file vượt quá 20MB."); //
      } else if (err.message === "INVALID_FILE_TYPE") {
        setError("Hệ thống chỉ chấp nhận định dạng file PDF."); //
      } else {
        setError("Có lỗi xảy ra khi xử lý tài liệu. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full">
      <div
        onClick={handleAreaClick} onDragOver={handleDragOver}
        onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center w-full p-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragging ? 'border-blue-500 bg-blue-50' : error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <input
          ref={fileInputRef} type="file" className="hidden"
          accept="application/pdf" onChange={handleFileChange} disabled={loading}
        />
        {loading ? (
          <div className="flex flex-col items-center space-y-3 text-blue-600">
            <Loader2 className="h-10 w-10 animate-spin" />
            <p className="font-medium text-sm">Đang tải và xử lý tài liệu (có thể mất vài giây)...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-2">
            <UploadCloud className={`h-12 w-12 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
            <div className="text-center">
              <p className="text-base font-medium text-gray-700">
                <span className="text-blue-600">Click để upload</span> hoặc kéo thả file vào đây
              </p>
              <p className="text-xs text-gray-500 mt-1">Chỉ hỗ trợ PDF (Tối đa 20MB)</p>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3 flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded-lg text-sm">
          <FileWarning size={18} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}