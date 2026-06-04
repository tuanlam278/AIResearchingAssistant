import { Bookmark, Database, Download, FileCode, FileText } from "lucide-react";

const formatNumber = (value) =>
  new Intl.NumberFormat("vi-VN", { notation: Number(value) >= 1000 ? "compact" : "standard" }).format(Number(value) || 0);

const formatDate = (value) => {
  if (!value) return "Chưa rõ ngày";
  try { return new Date(value).toLocaleDateString("vi-VN"); } catch { return "Chưa rõ ngày"; }
};

const sourceLabels = { system: "Hệ thống", community: "Cộng đồng", internet: "Internet" };
const statusLabels = {
  pending_review: "Chờ duyệt",
  published: "Đã public",
  rejected: "Bị từ chối",
  needs_changes: "Cần chỉnh sửa",
  hidden: "Đã ẩn",
  processing: "Đang xử lý",
};
const accessLabels = {
  full_text_indexed: "Full text indexed",
  metadata_only: "Metadata only",
  open_access_pdf: "Open access PDF",
  external_link_only: "External link only",
};

export default function SystemDocumentCard({
  document,
  onToggleBookmark,
  onToggleTag,
  onOpenDetails,
  onDownload,
  downloading,
  bookmarkLoading,
  showModeration = false,
  onEdit,
  onDelete,
  onResubmit,
  actionLoading,
}) {
  const title = document.title || document.filename || "Tài liệu chưa có tiêu đề";
  const summary = document.summary || document.ai_summary || document.description || "Chưa có summary.";
  const sourceLabel = document.source_label || sourceLabels[document.source_type] || "Hệ thống";
  const reviewStatus = document.review_status || String(document.status || "published").toLowerCase();
  const isBookmarked = document.bookmarked_by_current_user || document.bookmark?.is_bookmarked;
  const accessBadge = document.access_badge || (document.full_text_indexed ? "full_text_indexed" : document.metadata_only ? "metadata_only" : document.downloadable ? "open_access_pdf" : "external_link_only");

  return (
    <article className="sl-card">
      <div className="sl-card__header">
        <div className="sl-card__file-icon"><FileText size={20} /></div>
        <button
          type="button"
          className={`sl-bookmark ${isBookmarked ? "is-bookmarked" : ""}`}
          onClick={() => onToggleBookmark(document)}
          disabled={bookmarkLoading}
          aria-label={isBookmarked ? "Bỏ ghim tài liệu" : "Ghim tài liệu"}
          title={isBookmarked ? "Bạn đã ghim" : "Ghim tài liệu"}
        >
          <Bookmark size={18} fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="sl-card__body">
        <div className="sl-card__badges">
          <span className="sl-badge sl-badge--source">Nguồn: {sourceLabel}</span>
          <span className="sl-badge sl-badge--file">{document.file_type || "FILE"}</span>
          <span className={`sl-badge sl-badge--access ${document.metadata_only ? "is-warning" : ""}`}>{accessLabels[accessBadge] || accessLabels.external_link_only}</span>
          {showModeration && <span className="sl-badge sl-badge--status">{statusLabels[reviewStatus] || reviewStatus}</span>}
        </div>
        <h3>{title}</h3>
        <p>{summary}</p>
        {document.source_type === "internet" && (
          <div className="sl-card__paper-meta">
            {[document.year, (document.authors || []).slice(0, 2).join(", "), document.venue, document.doi ? `DOI: ${document.doi}` : ""].filter(Boolean).join(" · ")}
          </div>
        )}
        <div className="sl-card__meta">
          <span>Người đăng: <strong>{document.uploader_name || document.uploader?.name || "Hệ thống"}</strong></span>
          <span>Cập nhật: <strong>{formatDate(document.updated_at || document.created_at)}</strong></span>
        </div>
        {showModeration && (document.status_reason || document.admin_feedback) && (
          <div className="sl-card__feedback">Phản hồi: {document.admin_feedback || document.status_reason}</div>
        )}
        <div className="sl-card__flags">
          <span className={document.full_text_indexed ? "is-on" : ""}><FileText size={13} /> AI-ready</span>
          <span className={document.has_pdf ? "is-on" : ""}><FileText size={13} /> PDF</span>
          <span className={document.has_code ? "is-on" : ""}><FileCode size={13} /> Code</span>
          <span className={document.has_data ? "is-on" : ""}><Database size={13} /> Data</span>
        </div>
        <div className="sl-card__metrics">
          <span>{formatNumber(document.citation_count)} trích dẫn</span>
          <span>{formatNumber(document.download_count)} lượt tải</span>
          {document.my_rating && <span>Bạn đã đánh giá: {document.my_rating}/5</span>}
        </div>
        <div className="sl-card__tags">
          {(document.tags || []).slice(0, 3).map((tag) => (
            <button key={tag} type="button" className="sl-tag" onClick={() => onToggleTag(tag)}>#{tag}</button>
          ))}
          {(document.tags || []).length > 3 && <span className="sl-more-tags">+{document.tags.length - 3}</span>}
        </div>
      </div>
      <div className="sl-card__footer">
        <button type="button" className="sl-download-btn" onClick={() => onDownload(document)} disabled={downloading || !document.downloadable} title={document.downloadable ? "Tải file hợp lệ" : "Tài liệu này chỉ có link ngoài/metadata"}>
          <Download size={16} /> {downloading ? "Đang tải..." : "Download"}
        </button>
        <button type="button" className="sl-more-link" onClick={() => onOpenDetails(document)}>Xem thêm</button>
      </div>
      {showModeration && (
        <div className="sl-card__owner-actions">
          <button type="button" onClick={() => onEdit?.(document)} disabled={actionLoading}>Sửa metadata</button>
          <button type="button" onClick={() => onResubmit?.(document)} disabled={actionLoading || !["rejected", "needs_changes", "hidden"].includes(reviewStatus)}>Gửi duyệt lại</button>
          <button type="button" onClick={() => onDelete?.(document)} disabled={actionLoading}>Xóa</button>
        </div>
      )}
    </article>
  );
}
