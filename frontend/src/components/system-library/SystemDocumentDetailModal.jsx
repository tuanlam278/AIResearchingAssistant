import { useEffect, useState } from 'react';
import { Download, FileText, Loader2, Star, X } from 'lucide-react';

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

const formatRating = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0/5';
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}/5`;
};

function StarRating({ averageRating, myRating, onRate, isSubmitting }) {
  const [hovered, setHovered] = useState(0);
  const numericAverage = Number(averageRating);
  const numericMine = Number(myRating);
  const selectedRating = Number.isFinite(numericMine) && numericMine > 0 ? numericMine : 0;
  const averageStars = Number.isFinite(numericAverage) && numericAverage > 0 ? Math.max(0, Math.min(5, Math.round(numericAverage))) : 0;
  const litStars = hovered || selectedRating || averageStars;

  return (
    <div className="sl-rating__stars" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= litStars;
        const selected = Number(myRating) === star;
        return (
          <button
            key={star}
            type="button"
            className={`sl-rating__star ${active ? 'is-lit' : 'is-dim'} ${selected ? 'is-selected' : ''}`}
            onMouseEnter={() => setHovered(star)}
            onFocus={() => setHovered(star)}
            onBlur={() => setHovered(0)}
            onClick={() => onRate?.(star)}
            disabled={isSubmitting || !onRate}
            aria-label={`Đánh giá ${star} sao`}
            title={`Đánh giá ${star}/5`}
          >
            <Star size={24} fill="currentColor" />
          </button>
        );
      })}
    </div>
  );
}

function DocumentRatingSection({ rating, onRate, loading, submitting, error }) {
  const averageRating = rating?.average_rating ?? rating?.vote_avg ?? 0;
  const ratingCount = Math.max(0, Number(rating?.rating_count ?? rating?.vote_count ?? 0) || 0);
  const myRating = rating?.my_rating ?? rating?.rating ?? null;

  return (
    <section className={`sl-modal__section sl-rating-section ${submitting ? 'is-loading' : ''}`}>
      <div className="sl-rating-section__header">
        <div>
          <h3>Đánh giá tài liệu</h3>
          <p>Chọn trực tiếp số sao bạn muốn đánh giá cho tài liệu này.</p>
        </div>
        {(loading || submitting) && <span className="sl-rating__loading"><Loader2 size={16} /> {submitting ? 'Đang lưu...' : 'Đang tải...'}</span>}
      </div>
      <div className="sl-rating" aria-live="polite">
        <StarRating averageRating={averageRating} myRating={myRating} onRate={onRate} isSubmitting={submitting} />
        <div className="sl-rating__summary">
          <strong>Điểm trung bình: {formatRating(averageRating)}</strong>
          <span>{ratingCount} lượt đánh giá</span>
          <span className={myRating ? 'sl-rating__mine is-rated' : 'sl-rating__mine'}>
            {myRating ? `Bạn đã đánh giá: ${myRating}/5 sao` : 'Bấm vào sao để đánh giá tài liệu này'}
          </span>
        </div>
      </div>
      {error && <p className="sl-rating__error">{error}</p>}
    </section>
  );
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return <div className="sl-modal__row"><span>{label}</span><strong>{value}</strong></div>;
}

export default function SystemDocumentDetailModal({ document, onClose, onDownload, downloading, rating, ratingLoading, ratingSubmitting, ratingError, onRate }) {
  const [localDocument, setLocalDocument] = useState(document);

  useEffect(() => {
    setLocalDocument(document);
  }, [document]);

  if (!document) return null;
  const current = localDocument || document;
  const title = current.title || current.filename || 'Tài liệu';
  const summary = current.description || current.summary || current.ai_summary || 'Chưa có thông tin';

  return (
    <div className="sl-modal-overlay" role="presentation" onClick={onClose}>
      <section className="sl-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết ${title}`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="sl-modal__close" onClick={onClose} aria-label="Đóng chi tiết tài liệu"><X size={18} /></button>
        <header className="sl-modal__header">
          <span className="sl-modal__icon"><FileText size={22} /></span>
          <div>
            <p>Chi tiết tài liệu cộng đồng</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="sl-modal__content">
          <section className="sl-modal__section">
            <h3>Mô tả / tóm tắt</h3>
            <p>{summary}</p>
          </section>
          <DocumentRatingSection
            rating={rating || current}
            loading={ratingLoading}
            submitting={ratingSubmitting}
            error={ratingError}
            onRate={onRate}
          />
          <section className="sl-modal__section">
            <h3>Metadata</h3>
            <div className="sl-modal__grid">
              <DetailRow label="Tên file" value={current.filename || 'Chưa có thông tin'} />
              <DetailRow label="Định dạng" value={current.file_type || current.mime_type || 'Chưa có thông tin'} />
              <DetailRow label="Ngày đăng" value={formatDate(current.created_at)} />
              <DetailRow label="Ngày cập nhật" value={formatDate(current.updated_at)} />
              <DetailRow label="Thể loại" value={current.category || current.subject_area || 'Chưa có thông tin'} />
              <DetailRow label="Số trang" value={current.page_count ?? 'Chưa có thông tin'} />
              <DetailRow label="Số từ" value={current.word_count ?? 'Chưa có thông tin'} />
              <DetailRow label="Kích thước" value={formatFileSize(current.file_size)} />
              <DetailRow label="MIME type" value={current.mime_type || 'Chưa có thông tin'} />
              <DetailRow label="Người đăng" value={current.uploader_name || 'Hệ thống'} />
              <DetailRow label="Source type" value={current.source_type || 'SYSTEM_UPLOAD'} />
              <DetailRow label="Status" value={current.status || 'PUBLISHED'} />
              <DetailRow label="Peer-review" value={current.peer_review_status || 'UNKNOWN'} />
              <DetailRow label="Access Type" value={current.access_type || 'UNKNOWN'} />
              <DetailRow label="Review Type" value={current.review_type || 'UNKNOWN'} />
              <DetailRow label="Has PDF / Code / Data" value={`${current.has_pdf ? 'PDF' : 'No PDF'} · ${current.has_code ? 'Code' : 'No Code'} · ${current.has_data ? 'Data' : 'No Data'}`} />
              <DetailRow label="Trích dẫn / lượt tải" value={`${current.citation_count || 0} trích dẫn · ${current.download_count || 0} lượt tải`} />
              <DetailRow label="DOI" value={current.doi || 'Chưa có thông tin'} />
              <DetailRow label="URL" value={current.external_url || current.download_url || 'Chưa có thông tin'} />
            </div>
          </section>
          <section className="sl-modal__section">
            <h3>Tag</h3>
            <div className="sl-card__tags">
              {(current.tags || []).length ? current.tags.map((tag) => <span key={tag} className="sl-tag">#{tag}</span>) : <span className="sl-modal__muted">Chưa có thông tin</span>}
            </div>
          </section>
        </div>
        <footer className="sl-modal__footer">
          <button type="button" className="sl-download-btn" onClick={() => onDownload(current)} disabled={downloading || !current.can_download}>
            <Download size={16} /> {downloading ? 'Đang tải tài liệu...' : 'Download'}
          </button>
        </footer>
      </section>
    </div>
  );
}
