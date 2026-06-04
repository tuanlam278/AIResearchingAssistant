import { ExternalLink, FileText } from 'lucide-react';

const compact = (value) => new Intl.NumberFormat('vi-VN', { notation: Number(value) >= 1000 ? 'compact' : 'standard' }).format(Number(value) || 0);

export default function OpenAlexPaperCard({ paper, onOpenDetails, onImport, importing }) {
  const title = paper.title || 'Paper chưa có tiêu đề';
  const authors = (paper.authors || []).slice(0, 3).join(', ') || 'Không rõ tác giả';
  const summary = paper.summary || paper.abstract || 'Chưa có mô tả.';
  const url = paper.doi ? `https://doi.org/${paper.doi}` : (paper.landing_page_url || paper.openalex_url || paper.url);

  return (
    <article className="sl-card sl-paper-card">
      <div className="sl-card__header">
        <div className="sl-card__file-icon"><FileText size={20} /></div>
        <span className="sl-badge">OpenAlex</span>
      </div>
      <div className="sl-card__body">
        <div className="sl-card__badges">
          <span className="sl-badge">{paper.year || 'Không rõ năm'}</span>
          {paper.venue && <span className="sl-badge">{paper.venue}</span>}
          {paper.pdf_url ? <span className="sl-badge">Open access PDF</span> : <span className="sl-badge is-warning">Metadata only nếu import</span>}
        </div>
        <h3>{title}</h3>
        <p>{summary}</p>
        <div className="sl-card__meta"><span>{authors}</span></div>
        <div className="sl-card__metrics"><span>{compact(paper.citation_count)} trích dẫn</span>{paper.doi && <span>DOI: {paper.doi}</span>}</div>
        <div className="sl-card__tags">
          {(paper.tags || paper.concepts || []).slice(0, 3).map((tag) => <span key={tag} className="sl-tag">#{tag}</span>)}
        </div>
      </div>
      <div className="sl-card__footer">
        {url && <a className="sl-more-link" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Mở nguồn</a>}
        <button type="button" className="sl-more-link" onClick={() => onOpenDetails(paper)}>Xem thêm</button>
        <button type="button" className="sl-upload-btn" onClick={() => onImport(paper)} disabled={importing}>{importing ? "Đang import..." : "Import vào thư viện"}</button>
      </div>
    </article>
  );
}
