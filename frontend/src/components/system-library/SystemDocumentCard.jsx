import {
  Bookmark,
  Database,
  Download,
  FileCode,
  FileText,
} from "lucide-react";

const formatNumber = (value) =>
  new Intl.NumberFormat("vi-VN", {
    notation: Number(value) >= 1000 ? "compact" : "standard",
  }).format(Number(value) || 0);
const label = (value) => String(value || "UNKNOWN").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "Chưa rõ ngày";
  try {
    return new Date(value).toLocaleDateString("vi-VN");
  } catch {
    return "Chưa rõ ngày";
  }
};

export default function SystemDocumentCard({
  document,
  onToggleBookmark,
  onToggleTag,
  onOpenDetails,
  onDownload,
  downloading,
}) {
  const title =
    document.title || document.filename || "Tài liệu chưa có tiêu đề";
  const summary =
    document.summary ||
    document.ai_summary ||
    document.description ||
    "Chưa có summary.";

  return (
    <article className="sl-card">
      <div className="sl-card__header">
        <div className="sl-card__file-icon">
          <FileText size={20} />
        </div>
        <button
          type="button"
          className={`sl-bookmark ${document.bookmarked_by_current_user ? "is-bookmarked" : ""}`}
          onClick={() => onToggleBookmark(document)}
          aria-label={
            document.bookmarked_by_current_user
              ? "Bỏ ghim tài liệu"
              : "Ghim tài liệu"
          }
        >
          <Bookmark
            size={18}
            fill={document.bookmarked_by_current_user ? "currentColor" : "none"}
          />
        </button>
      </div>
      <div className="sl-card__body">
        <div className="sl-card__badges">
          <span className="sl-badge sl-badge--file">
            {document.file_type || "FILE"}
          </span>
          <span className="sl-badge">{document.source_type || "SYSTEM_UPLOAD"}</span>
          <span className="sl-badge">{label(document.peer_review_status)}</span>
        </div>
        <h3>{title}</h3>
        <p>{summary}</p>
        <div className="sl-card__meta">
          <span>
            Người đăng: <strong>{document.uploader_name || "Hệ thống"}</strong>
          </span>
          <span>
            Cập nhật: <strong>{formatDate(document.updated_at || document.created_at)}</strong>
          </span>
        </div>
        <div className="sl-card__flags">
          <span className={document.has_pdf ? "is-on" : ""}>
            <FileText size={13} /> PDF
          </span>
          <span className={document.has_code ? "is-on" : ""}>
            <FileCode size={13} /> Code
          </span>
          <span className={document.has_data ? "is-on" : ""}>
            <Database size={13} /> Data
          </span>
        </div>
        <div className="sl-card__metrics">
          <span>{formatNumber(document.citation_count)} trích dẫn</span>
          <span>{formatNumber(document.download_count)} lượt tải</span>
        </div>
        <div className="sl-card__tags">
          {(document.tags || []).slice(0, 3).map((tag) => (
            <button
              key={tag}
              type="button"
              className="sl-tag"
              onClick={() => onToggleTag(tag)}
            >
              #{tag}
            </button>
          ))}
          {(document.tags || []).length > 3 && (
            <span className="sl-more-tags">+{document.tags.length - 3}</span>
          )}
        </div>
      </div>
      <div className="sl-card__footer">
        <button
          type="button"
          className="sl-download-btn"
          onClick={() => onDownload(document)}
          disabled={downloading || !document.can_download}
          title={
            document.can_download
              ? "Tải PDF/file hợp lệ"
              : "Chỉ download khi có Open Access PDF hoặc file upload hợp lệ"
          }
        >
          <Download size={16} /> {downloading ? "Đang tải..." : "Download"}
        </button>
        <button
          type="button"
          className="sl-more-link"
          onClick={() => onOpenDetails(document)}
        >
          Xem thêm
        </button>
      </div>
    </article>
  );
}
