import { BookmarkCheck, RefreshCw } from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'title_az', label: 'Tên A-Z' },
  { value: 'title_za', label: 'Tên Z-A' },
  { value: 'vote_highest', label: 'Đánh giá cao nhất' },
  { value: 'citation_highest', label: 'Trích dẫn nhiều nhất' },
  { value: 'download_highest', label: 'Tải nhiều nhất' },
];

export default function SystemLibraryToolbar({ total, bookmarksOnly, onToggleBookmarksOnly, sort = 'newest', onSortChange, hasQuery }) {
  const options = hasQuery ? [...SORT_OPTIONS, { value: 'semantic_relevance', label: 'Liên quan ngữ nghĩa' }] : SORT_OPTIONS;
  return (
    <div className="sl-toolbar">
      <div><strong>{total}</strong> tài liệu phù hợp</div>
      <div className="sl-toolbar__actions">
        <select value={sort} onChange={(event) => onSortChange?.(event.target.value)} aria-label="Sắp xếp tài liệu">
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" className={`sl-toolbar-btn ${bookmarksOnly ? 'is-active' : ''}`} onClick={onToggleBookmarksOnly}>
          {bookmarksOnly ? <BookmarkCheck size={16} /> : <RefreshCw size={16} />} {bookmarksOnly ? 'Đang xem đã ghim' : 'Chỉ tài liệu đã ghim'}
        </button>
      </div>
    </div>
  );
}
