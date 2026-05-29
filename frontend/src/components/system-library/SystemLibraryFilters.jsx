import { X } from 'lucide-react';

const FILTERS = {
  categories: ['Kinh tế', 'Kỹ thuật', 'Luật', 'Văn học', 'Công nghệ', 'Y học', 'Khác'],
  file_types: ['PDF', 'DOCX', 'TXT', 'MD'],
  updated_ranges: [
    { value: 'week', label: 'Tuần này' },
    { value: 'month', label: 'Tháng này' },
    { value: 'year', label: 'Năm nay' },
  ],
};

function FilterGroup({ title, options, value, onToggle }) {
  return (
    <div className="sl-filter-group">
      <h3>{title}</h3>
      <div className="sl-filter-options">
        {options.map((option) => {
          const item = typeof option === 'string' ? { value: option, label: option } : option;
          const checked = value.includes(item.value);
          return (
            <label key={item.value} className={`sl-filter-chip ${checked ? 'is-active' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(item.value)} />
              <span>{item.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function SystemLibraryFilters({ filters, selectedTags, onToggleFilter, onToggleTag, onClear }) {
  const hasFilters = Object.values(filters).some((items) => items.length > 0) || selectedTags.length > 0;

  return (
    <aside className="sl-filters" aria-label="Bộ lọc thư viện hệ thống">
      <div className="sl-filters__header">
        <div>
          <p>Facet filters</p>
          <strong>Lọc thông minh</strong>
        </div>
        {hasFilters && <button type="button" onClick={onClear} className="sl-link-button">Xóa bộ lọc</button>}
      </div>
      {selectedTags.length > 0 && (
        <div className="sl-filter-group">
          <h3>Tags đang lọc</h3>
          <div className="sl-active-tags">
            {selectedTags.map((tag) => <button key={tag} type="button" className="sl-tag is-selected" onClick={() => onToggleTag(tag)}>#{tag} <X size={12} /></button>)}
          </div>
        </div>
      )}
      <FilterGroup title="Danh mục" options={FILTERS.categories} value={filters.categories} onToggle={(value) => onToggleFilter('categories', value)} />
      <FilterGroup title="Định dạng" options={FILTERS.file_types} value={filters.file_types} onToggle={(value) => onToggleFilter('file_types', value)} />
      <FilterGroup title="Cập nhật" options={FILTERS.updated_ranges} value={filters.updated_ranges} onToggle={(value) => onToggleFilter('updated_ranges', value)} />
    </aside>
  );
}
