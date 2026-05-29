import { Download, FileText, X } from 'lucide-react';

const formatDate = (value) => {
  if (!value) return 'Chưa có thông tin';
  try { return new Date(value).toLocaleString('vi-VN'); } catch { return 'Chưa có thông tin'; }
};

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return 'Chưa có thông tin';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex += 1; }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return <div className="sl-modal__row"><span>{label}</span><strong>{value}</strong></div>;
}

export default function SystemDocumentDetailModal({ document, onClose, onDownload, downloading }) {
  if (!document) return null;
  const title = document.title || document.filename || 'Tài liệu hệ thống';
  const summary = document.description || document.summary || document.ai_summary || 'Chưa có thông tin';

  return (
    <div className="sl-modal-overlay" role="presentation" onClick={onClose}>
      <section className="sl-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết ${title}`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="sl-modal__close" onClick={onClose} aria-label="Đóng chi tiết tài liệu"><X size={18} /></button>
        <header className="sl-modal__header">
          <span className="sl-modal__icon"><FileText size={22} /></span>
          <div>
            <p>Chi tiết tài liệu</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="sl-modal__content">
          <section className="sl-modal__section">
            <h3>Mô tả / tóm tắt</h3>
            <p>{summary}</p>
          </section>
          <section className="sl-modal__section">
            <h3>Metadata</h3>
            <div className="sl-modal__grid">
              <DetailRow label="Tên file" value={document.filename || 'Chưa có thông tin'} />
              <DetailRow label="Định dạng" value={document.file_type || document.mime_type || 'Chưa có thông tin'} />
              <DetailRow label="Ngày đăng" value={formatDate(document.created_at)} />
              <DetailRow label="Ngày cập nhật" value={formatDate(document.updated_at)} />
              <DetailRow label="Thể loại" value={document.category || document.subject_area || 'Chưa có thông tin'} />
              <DetailRow label="Số trang" value={document.page_count ?? 'Chưa có thông tin'} />
              <DetailRow label="Số từ" value={document.word_count ?? 'Chưa có thông tin'} />
              <DetailRow label="Kích thước" value={formatFileSize(document.file_size)} />
              <DetailRow label="MIME type" value={document.mime_type || 'Chưa có thông tin'} />
            </div>
          </section>
          <section className="sl-modal__section">
            <h3>Tag</h3>
            <div className="sl-card__tags">
              {(document.tags || []).length ? document.tags.map((tag) => <span key={tag} className="sl-tag">#{tag}</span>) : <span className="sl-modal__muted">Chưa có thông tin</span>}
            </div>
          </section>
        </div>
        <footer className="sl-modal__footer">
          <button type="button" className="sl-download-btn" onClick={() => onDownload(document)} disabled={downloading || !document.can_download}>
            <Download size={16} /> {downloading ? 'Đang tải tài liệu...' : 'Download'}
          </button>
        </footer>
      </section>
    </div>
  );
}
