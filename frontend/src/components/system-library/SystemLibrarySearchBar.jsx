import { Search, Loader2 } from 'lucide-react';

export default function SystemLibrarySearchBar({ value, onChange, onSubmit, loading }) {
  return (
    <form className="sl-search" onSubmit={onSubmit}>
      <Search size={22} className="sl-search__icon" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Tìm tài liệu bằng AI, ví dụ: thủ tục mở công ty"
        aria-label="Tìm kiếm ngữ nghĩa trong Thư viện Hệ thống"
      />
      <button type="submit" className="sl-search__button" disabled={loading}>
        {loading ? <Loader2 size={16} className="sl-spin" /> : 'Tìm bằng AI'}
      </button>
    </form>
  );
}
