import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";

const FILTERS = {
  source_types: [
    { value: "system", label: "Hệ thống" },
    { value: "community", label: "Cộng đồng" },
    { value: "internet", label: "Internet / OpenAlex" },
  ],
  ai_ready: [
    { value: "vector_ready", label: "Có thể dùng cho AI" },
    { value: "metadata_only", label: "Chưa index / metadata only" },
  ],
  downloadable: [
    { value: "downloadable", label: "Có file tải xuống" },
    { value: "external_only", label: "Chỉ link ngoài" },
  ],
  review_statuses: [
    { value: "pending_review", label: "Pending" },
    { value: "published", label: "Published" },
    { value: "rejected", label: "Rejected" },
    { value: "hidden", label: "Hidden" },
  ],
  peer_review_status: [
    { value: "PEER_REVIEWED", label: "Đã bình duyệt" },
    { value: "PREPRINT", label: "Bản thảo / preprint" },
    { value: "UNKNOWN", label: "Chưa rõ" },
  ],
  access_types: [
    { value: "OPEN_ACCESS", label: "Truy cập mở" },
    { value: "FREE_TO_READ", label: "Đọc miễn phí" },
    { value: "INSTITUTIONAL_ACCESS", label: "Qua tổ chức" },
    { value: "UNKNOWN", label: "Chưa rõ" },
  ],
  review_types: [
    { value: "RESEARCH_ARTICLE", label: "Bài nghiên cứu" },
    { value: "REVIEW", label: "Tổng quan" },
    { value: "SYSTEMATIC_REVIEW", label: "Tổng quan hệ thống" },
    { value: "META_ANALYSIS", label: "Phân tích gộp" },
    { value: "EDITORIAL", label: "Xã luận" },
    { value: "UNKNOWN", label: "Chưa rõ" },
  ],
};

const VISIBLE_TAG_LIMIT = 8;

function FilterGroup({ title, options, value, onToggle }) {
  return (
    <div className="sl-filter-group">
      <h3>{title}</h3>
      <div className="sl-filter-options">
        {options.map((item) => {
          const checked = value.includes(item.value);
          return (
            <label
              key={item.value}
              className={`sl-filter-chip ${checked ? "is-active" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(item.value)}
              />
              <span>{item.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TagChip({ tag, count, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`sl-filter-chip ${selected ? "is-active" : ""}`}
      onClick={() => onToggle(tag)}
    >
      #{tag} <span>({count})</span>
    </button>
  );
}

function TagPickerModal({
  tags,
  selectedTags,
  query,
  onQueryChange,
  onToggleTag,
  onClose,
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTags = normalizedQuery
    ? tags.filter(({ tag }) => tag.toLowerCase().includes(normalizedQuery))
    : tags;

  return createPortal(
    <div
      className="sl-modal-overlay sl-tag-modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="sl-modal sl-tag-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Tất cả tag gợi ý"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="sl-modal__close"
          onClick={onClose}
          aria-label="Đóng danh sách tag"
        >
          <X size={18} />
        </button>
        <header className="sl-modal__header">
          <div>
            <p>Tags gợi ý</p>
            <h2>Tất cả tag</h2>
          </div>
        </header>
        <div className="sl-modal__content">
          <label className="sl-tag-modal__search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Tìm tag theo tên..."
              autoFocus
            />
          </label>
          <div className="sl-tag-modal__summary">
            <span>{filteredTags.length} tag phù hợp</span>
            {selectedTags.length > 0 && (
              <strong>{selectedTags.length} tag đang lọc</strong>
            )}
          </div>
          <div className="sl-tag-modal__grid">
            {filteredTags.length ? (
              filteredTags.map(({ tag, count }) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  count={count}
                  selected={selectedTags.includes(tag)}
                  onToggle={onToggleTag}
                />
              ))
            ) : (
              <span className="sl-modal__muted">
                Không tìm thấy tag phù hợp.
              </span>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function SystemLibraryFilters({
  filters,
  selectedTags,
  suggestedTags = [],
  loading,
  onToggleFilter,
  onToggleTag,
  onBooleanFilter,
  onCitationChange,
  onClear,
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const hasFilters =
    Object.entries(filters).some(([key, value]) => {
      if (key === "sort") return false;
      if (key === "citation_count_min")
        return Boolean(filters.citation_count_enabled) && value !== "";
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }) || selectedTags.length > 0;
  const visibleTags = useMemo(
    () => suggestedTags.slice(0, VISIBLE_TAG_LIMIT),
    [suggestedTags],
  );

  return (
    <aside className="sl-filters" aria-label="Bộ lọc thư viện tài liệu">
      <div className="sl-filters__header">
        <div>
          <p>Bộ lọc cộng đồng</p>
          <strong>Lọc tài liệu</strong>
        </div>
        {hasFilters && (
          <button type="button" onClick={onClear} className="sl-link-button">
            Xóa bộ lọc
          </button>
        )}
      </div>
      {loading && (
        <div className="sl-filter-skeleton" aria-live="polite">
          Đang lọc/search tài liệu...
        </div>
      )}
      <FilterGroup
        title="Nguồn tài liệu"
        options={FILTERS.source_types}
        value={filters.source_types || []}
        onToggle={(value) => onToggleFilter("source_types", value)}
      />
      <div className="sl-filter-group">
        <h3>Category</h3>
        <input
          value={(filters.categories || []).join(", ")}
          onChange={(event) => onToggleFilter("categories_text", event.target.value)}
          placeholder="Nhập category, cách nhau bằng dấu phẩy"
        />
      </div>
      <div className="sl-filter-group">
        <h3>Trạng thái xử lý / AI-ready</h3>
        <div className="sl-filter-options">
          <label className={`sl-filter-chip ${filters.is_vector_ready === true ? "is-active" : ""}`}>
            <input type="checkbox" checked={filters.is_vector_ready === true} onChange={() => onBooleanFilter("is_vector_ready")} />
            <span>Có thể dùng cho AI</span>
          </label>
          <label className={`sl-filter-chip ${filters.is_vector_ready === false ? "is-active" : ""}`}>
            <input type="checkbox" checked={filters.is_vector_ready === false} onChange={() => onBooleanFilter("metadata_only")} />
            <span>Chưa index / metadata only</span>
          </label>
        </div>
      </div>
      <div className="sl-filter-group">
        <h3>Có thể tải xuống</h3>
        <label className={`sl-filter-chip ${filters.downloadable ? "is-active" : ""}`}>
          <input type="checkbox" checked={Boolean(filters.downloadable)} onChange={() => onBooleanFilter("downloadable")} />
          <span>Có file tải xuống</span>
        </label>
      </div>
      <FilterGroup
        title="Trạng thái kiểm duyệt"
        options={FILTERS.review_statuses}
        value={filters.review_statuses || []}
        onToggle={(value) => onToggleFilter("review_statuses", value)}
      />
      <div className="sl-filter-group">
        <div className="sl-filter-group__title-row">
          <h3>Tags gợi ý</h3>
          {suggestedTags.length > VISIBLE_TAG_LIMIT && (
            <button
              type="button"
              className="sl-link-button"
              onClick={() => setShowAllTags(true)}
            >
              Xem thêm ({suggestedTags.length})
            </button>
          )}
        </div>
        <div className="sl-filter-options">
          {visibleTags.length ? (
            visibleTags.map(({ tag, count }) => (
              <TagChip
                key={tag}
                tag={tag}
                count={count}
                selected={selectedTags.includes(tag)}
                onToggle={onToggleTag}
              />
            ))
          ) : (
            <span className="sl-modal__muted">Chưa có tag gợi ý</span>
          )}
        </div>
      </div>
      {selectedTags.length > 0 && (
        <div className="sl-filter-group">
          <h3>Tags đang lọc</h3>
          <div className="sl-active-tags">
            {selectedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="sl-tag is-selected"
                onClick={() => onToggleTag(tag)}
              >
                #{tag} <X size={12} />
              </button>
            ))}
          </div>
        </div>
      )}
      <FilterGroup
        title="Trạng thái bình duyệt"
        options={FILTERS.peer_review_status}
        value={filters.peer_review_status}
        onToggle={(value) => onToggleFilter("peer_review_status", value)}
      />
      <FilterGroup
        title="Kiểu truy cập"
        options={FILTERS.access_types}
        value={filters.access_types}
        onToggle={(value) => onToggleFilter("access_types", value)}
      />
      <FilterGroup
        title="Loại bài viết"
        options={FILTERS.review_types}
        value={filters.review_types}
        onToggle={(value) => onToggleFilter("review_types", value)}
      />
      <div className="sl-filter-group">
        <h3>Tệp / tài nguyên</h3>
        <div className="sl-filter-options">
          {[
            ["has_pdf", "Có PDF"],
            ["has_data", "Có dữ liệu"],
            ["has_code", "Có mã nguồn"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`sl-filter-chip ${filters[key] ? "is-active" : ""}`}
              onClick={() => onBooleanFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="sl-filter-group sl-citation-filter">
        <h3>Lọc theo số trích dẫn</h3>
        <button
          type="button"
          className={`sl-filter-chip ${filters.citation_count_enabled ? "is-active" : ""}`}
          onClick={() => onBooleanFilter("citation_count_enabled")}
        >
          {filters.citation_count_enabled
            ? "Đang lọc citation ≥ ngưỡng"
            : "Không lọc citation"}
        </button>
        <input
          type="number"
          min="0"
          disabled={!filters.citation_count_enabled}
          value={filters.citation_count_min || ""}
          onChange={(event) => onCitationChange(event.target.value)}
          placeholder="Mặc định: 0"
        />
        <p className="sl-modal__muted">
          Khi bật, chỉ hiển thị tài liệu có số trích dẫn lớn hơn hoặc bằng
          ngưỡng đã chọn.
        </p>
      </div>
      {showAllTags && (
        <TagPickerModal
          tags={suggestedTags}
          selectedTags={selectedTags}
          query={tagQuery}
          onQueryChange={setTagQuery}
          onToggleTag={onToggleTag}
          onClose={() => setShowAllTags(false)}
        />
      )}
    </aside>
  );
}
