import { Camera, FileUp, Library, NotebookTabs } from 'lucide-react';

export default function DocumentToolbar({ title, uploading, onUploadClick, onOpenLibrary, onToggleSnip, onScrollToNotepad }) {
  return (
    <div className="al-toolbar">
      <div>
        <span className="al-eyebrow">Kính lúp Học thuật</span>
        <h2>{title || 'Chưa chọn tài liệu'}</h2>
      </div>
      <div className="al-toolbar-actions">
        <button type="button" onClick={onUploadClick} disabled={uploading}><FileUp size={16} /> {uploading ? 'Đang tải...' : 'Upload'}</button>
        <button type="button" onClick={onOpenLibrary}><Library size={16} /> Thư viện</button>
        <button type="button" onClick={onToggleSnip}><Camera size={16} /> Chụp ảnh</button>
        <button type="button" onClick={onScrollToNotepad}><NotebookTabs size={16} /> Notepad</button>
      </div>
    </div>
  );
}
