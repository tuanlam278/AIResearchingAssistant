import { Bookmark } from 'lucide-react';

export default function SystemLibraryToolbar({ total, bookmarksOnly, onToggleBookmarksOnly }) {
  return (
    <div className="sl-toolbar">
      <div>
        <strong>{total}</strong>
        <span> tài liệu phù hợp</span>
      </div>
      <div className="sl-toolbar__actions">
        <button type="button" className={`sl-toolbar-btn ${bookmarksOnly ? 'is-active' : ''}`} onClick={onToggleBookmarksOnly}>
          <Bookmark size={15} /> Đã ghim
        </button>
      </div>
    </div>
  );
}
