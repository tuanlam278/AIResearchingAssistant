import { Bookmark, Download, FileText } from 'lucide-react';

const formatDate = (value) => {
  if (!value) return 'Chưa cập nhật';
  try { return new Date(value).toLocaleDateString('vi-VN'); } catch { return 'Chưa cập nhật'; }
};

export default function SystemDocumentCard({ document, onToggleBookmark, onToggleTag, onOpenDetails, onDownload, downloading }) {
  const title = document.title || document.filename || 'Tài liệu chưa có tiêu đề';
  const summary = document.summary || document.ai_summary || document.description || 'Chưa có summary.';

  return (
    <article className="sl-card">
      <div className="sl-card__header">
        <div className="sl-card__file-icon"><FileText size={20} /></div>
        <button type="button" className={`sl-bookmark ${document.bookmarked_by_current_user ? 'is-bookmarked' : ''}`} onClick={() => onToggleBookmark(document)} aria-label={document.bookmarked_by_current_user ? 'Bỏ ghim tài liệu' : 'Ghim tài liệu'}>
          <Bookmark size={18} fill={document.bookmarked_by_current_user ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="sl-card__body">
        <div className="sl-card__badges">
          {document.is_new && <span className="sl-badge sl-badge--new">Mới</span>}
          <span className="sl-badge sl-badge--file">{document.file_type || 'FILE'}</span>
        </div>
        <h3>{title}</h3>
        <p>{summary}</p>
        <div className="sl-card__meta"><span>{document.category || document.subject_area || 'Khác'}</span><span>•</span><span>{formatDate(document.updated_at || document.created_at)}</span></div>
        <div className="sl-card__tags">
          {(document.tags || []).slice(0, 3).map((tag) => <button key={tag} type="button" className="sl-tag" onClick={() => onToggleTag(tag)}>#{tag}</button>)}
          {(document.tags || []).length > 3 && <span className="sl-more-tags">+{document.tags.length - 3}</span>}
        </div>
      </div>
      <div className="sl-card__footer">
        <button type="button" className="sl-download-btn" onClick={() => onDownload(document)} disabled={downloading || !document.can_download} title={document.can_download ? 'Tải file gốc' : 'Chưa có file để tải'}>
          <Download size={16} /> {downloading ? 'Đang tải...' : 'Download'}
        </button>
        <button type="button" className="sl-more-link" onClick={() => onOpenDetails(document)}>Xem thêm</button>
      </div>
    </article>
  );
}
