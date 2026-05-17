import { Trash2, FileText, ChevronRight } from 'lucide-react';

export default function DocumentList({ documents, onSelect, onDelete }) {
  // Trạng thái trống (Empty State) nhìn cho xịn thay vì thẻ <p> cùi bắp
  if (!documents || documents.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
        <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Chưa có tài liệu nào.</p>
        <p className="text-sm text-gray-400 mt-1">Hãy kéo thả file PDF ở khung phía trên nhé!</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {documents.map((doc) => (
        <li
          key={doc.doc_id}
          // Biến cả cái khối này thành thẻ có thể click để navigate
          onClick={() => onSelect(doc.doc_id)}
          className="group flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
        >
          {/* Cột trái: Icon và Thông tin tài liệu */}
          <div className="flex items-start space-x-4 overflow-hidden">
            <div className="bg-blue-50 p-3 rounded-lg text-blue-600 flex-shrink-0">
              <FileText size={24} />
            </div>
            
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-900 truncate" title={doc.filename}>
                {doc.filename}
              </h3>
              
              <div className="flex items-center text-xs text-gray-500 mt-1 space-x-2">
                <span className="bg-gray-100 px-2 py-0.5 rounded">
                  {doc.page_count} trang
                </span>
                <span>•</span>
                <span>{doc.chunk_count} chunks</span>
                {/* Format ngày tháng đàng hoàng dựa theo created_at từ API */}
                <span>•</span>
                <span>{new Date(doc.created_at).toLocaleDateString('vi-VN')}</span>
              </div>
            </div>
          </div>

          {/* Cột phải: Các nút hành động */}
          <div className="flex items-center space-x-1 pl-4 flex-shrink-0">
            <button
              onClick={(e) => {
                // QUAN TRỌNG: Ngăn chặn event nổi bọt lên thẻ li
                e.stopPropagation(); 
                onDelete(doc.doc_id);
              }}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Xóa tài liệu"
            >
              <Trash2 size={18} />
            </button>
            
            {/* Icon mũi tên chỉ hiện ra hoặc đổi màu khi hover vào cả cục (group-hover) */}
            <ChevronRight 
              size={20} 
              className="text-gray-300 group-hover:text-blue-500 transition-colors ml-2" 
            />
          </div>
        </li>
      ))}
    </ul>
  );
}