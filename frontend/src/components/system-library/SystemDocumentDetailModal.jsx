import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Star, X } from "lucide-react";

const formatDate = (value) => { if (!value) return "Chưa có thông tin"; try { return new Date(value).toLocaleString("vi-VN"); } catch { return "Chưa có thông tin"; } };
const formatFileSize = (bytes) => { const size = Number(bytes); if (!Number.isFinite(size) || size <= 0) return "Chưa có thông tin"; const units = ["B", "KB", "MB", "GB"]; let value = size; let unitIndex = 0; while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex += 1; } return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`; };
const formatRating = (value) => { const numeric = Number(value); if (!Number.isFinite(numeric) || numeric <= 0) return "0/5"; return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}/5`; };
const sourceLabels = { system: "Hệ thống", community: "Cộng đồng", internet: "Internet / OpenAlex" };
const statusLabels = { pending_review: "Chờ duyệt", published: "Đã public", rejected: "Bị từ chối", needs_changes: "Cần chỉnh sửa", hidden: "Đã ẩn", processing: "Đang xử lý" };

function StarRating({ averageRating, myRating, onRate, isSubmitting }) {
  const [hovered, setHovered] = useState(0);
  const selectedRating = Number(myRating) > 0 ? Number(myRating) : 0;
  const averageStars = Number(averageRating) > 0 ? Math.round(Number(averageRating)) : 0;
  const litStars = hovered || selectedRating || averageStars;
  return <div className="sl-rating__stars" onMouseLeave={() => setHovered(0)}>{[1,2,3,4,5].map((star) => <button key={star} type="button" className={`sl-rating__star ${star <= litStars ? "is-lit" : "is-dim"} ${Number(myRating) === star ? "is-selected" : ""}`} onMouseEnter={() => setHovered(star)} onFocus={() => setHovered(star)} onBlur={() => setHovered(0)} onClick={() => onRate?.(star)} disabled={isSubmitting || !onRate} aria-label={`Đánh giá ${star} sao`}><Star size={24} fill="currentColor" /></button>)}</div>;
}

function DocumentRatingSection({ rating, onRate, loading, submitting, error }) {
  const averageRating = rating?.average_rating ?? rating?.vote_avg ?? rating?.average ?? 0;
  const ratingCount = Math.max(0, Number(rating?.rating_count ?? rating?.vote_count ?? rating?.count ?? 0) || 0);
  const myRating = rating?.my_rating ?? rating?.rating ?? null;
  return <section className={`sl-modal__section sl-rating-section ${submitting ? "is-loading" : ""}`}>
    <div className="sl-rating-section__header"><div><h3>Đánh giá tài liệu</h3><p>Rating cộng đồng nằm ở modal để không nhầm với ghim.</p></div>{(loading || submitting) && <span className="sl-rating__loading"><Loader2 size={16} /> {submitting ? "Đang lưu..." : "Đang tải..."}</span>}</div>
    <div className="sl-rating" aria-live="polite"><StarRating averageRating={averageRating} myRating={myRating} onRate={onRate} isSubmitting={submitting} /><div className="sl-rating__summary"><strong>Điểm trung bình: {formatRating(averageRating)}</strong><span>{ratingCount} lượt đánh giá</span><span className={myRating ? "sl-rating__mine is-rated" : "sl-rating__mine"}>{myRating ? `Bạn đã đánh giá: ${myRating}/5 sao` : "Bấm vào sao để đánh giá tài liệu này"}</span></div></div>
    {error && <p className="sl-rating__error">{error}</p>}
  </section>;
}

function DetailRow({ label, value }) { if (value === null || value === undefined || value === "") return null; return <div className="sl-modal__row"><span>{label}</span><strong>{value}</strong></div>; }

export default function SystemDocumentDetailModal({ document, onClose, onDownload, downloading, rating, ratingLoading, ratingSubmitting, ratingError, onRate }) {
  const [localDocument, setLocalDocument] = useState(document);
  const [activeTab, setActiveTab] = useState("overview");
  useEffect(() => { setLocalDocument(document); setActiveTab("overview"); }, [document]);
  if (!document) return null;
  const current = localDocument || document;
  const title = current.title || current.filename || "Tài liệu";
  const summary = current.description || current.summary || current.ai_summary || "Chưa có thông tin";
  const sourceLabel = current.source_label || sourceLabels[current.source_type] || "Hệ thống";
  const reviewStatus = current.review_status || String(current.status || "published").toLowerCase();
  const metadataOnlyWarning = current.metadata_only || !current.full_text_indexed;
  const tabs = [
    ["overview", "Overview"], ["preview", "Preview"], ["metadata", "Metadata"], ["reviews", "Reviews"],
  ];

  return <div className="sl-modal-overlay" role="presentation" onClick={onClose}>
    <section className="sl-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết ${title}`} onClick={(event) => event.stopPropagation()}>
      <button type="button" className="sl-modal__close" onClick={onClose} aria-label="Đóng chi tiết tài liệu"><X size={18} /></button>
      <header className="sl-modal__header"><span className="sl-modal__icon"><FileText size={22} /></span><div><p>Workspace tài liệu · Nguồn: {sourceLabel}</p><h2>{title}</h2></div></header>
      <nav className="sl-modal__tabs">{tabs.map(([key, label]) => <button key={key} type="button" className={activeTab === key ? "is-active" : ""} onClick={() => setActiveTab(key)}>{label}</button>)}</nav>
      <div className="sl-modal__content">
        {activeTab === "overview" && <><section className="sl-modal__section"><h3>Mô tả / tóm tắt</h3><p>{summary}</p><div className="sl-card__badges"><span className="sl-badge">Nguồn: {sourceLabel}</span><span className="sl-badge">{statusLabels[reviewStatus] || reviewStatus}</span><span className={`sl-badge ${metadataOnlyWarning ? "is-warning" : ""}`}>{current.full_text_indexed ? "Full text indexed" : "Metadata only / chưa index"}</span></div></section><DocumentRatingSection rating={rating || current.rating || current} loading={ratingLoading} submitting={ratingSubmitting} error={ratingError} onRate={onRate} /><section className="sl-modal__section"><h3>Tags</h3><div className="sl-card__tags">{(current.tags || []).length ? current.tags.map((tag) => <span key={tag} className="sl-tag">#{tag}</span>) : <span className="sl-modal__muted">Chưa có thông tin</span>}</div></section></>}
        {activeTab === "preview" && <section className="sl-modal__section"><h3>Preview</h3>{metadataOnlyWarning ? <p className="sl-modal__muted">Tài liệu này hiện chỉ có metadata, chưa có full text để xem trước.</p> : <p>File đã được index. Bản preview inline chưa khả dụng trong phiên bản này; hãy dùng Download để xem file gốc.</p>}</section>}
        {activeTab === "metadata" && <section className="sl-modal__section"><h3>Metadata</h3><div className="sl-modal__grid"><DetailRow label="Tên file" value={current.filename || "Chưa có thông tin"} /><DetailRow label="Định dạng" value={current.file_type || current.mime_type || "Chưa có thông tin"} /><DetailRow label="Category" value={current.category || current.subject_area || "Chưa có thông tin"} /><DetailRow label="Nguồn" value={sourceLabel} /><DetailRow label="Trạng thái" value={statusLabels[reviewStatus] || reviewStatus} /><DetailRow label="Processing" value={current.processing_status || "Chưa có thông tin"} /><DetailRow label="Ngày đăng" value={formatDate(current.created_at)} /><DetailRow label="Ngày cập nhật" value={formatDate(current.updated_at)} /><DetailRow label="Người đăng" value={current.uploader_name || current.uploader?.name || "Hệ thống"} /><DetailRow label="Số trang" value={current.page_count ?? "Chưa có thông tin"} /><DetailRow label="Số từ" value={current.word_count ?? "Chưa có thông tin"} /><DetailRow label="Kích thước" value={formatFileSize(current.file_size)} /><DetailRow label="Authors" value={(current.authors || []).join(", ")} /><DetailRow label="Year" value={current.year} /><DetailRow label="Venue" value={current.venue} /><DetailRow label="DOI" value={current.doi || "Chưa có thông tin"} /><DetailRow label="URL" value={current.external_url || current.download_url || "Chưa có thông tin"} /></div></section>}
        {activeTab === "reviews" && <DocumentRatingSection rating={rating || current.rating || current} loading={ratingLoading} submitting={ratingSubmitting} error={ratingError} onRate={onRate} />}
      </div>
      <footer className="sl-modal__footer"><button type="button" className="sl-download-btn" onClick={() => onDownload(current)} disabled={downloading || !current.downloadable}><Download size={16} /> {downloading ? "Đang tải tài liệu..." : "Download"}</button></footer>
    </section>
  </div>;
}
