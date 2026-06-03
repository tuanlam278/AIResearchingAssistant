import { ExternalLink, FileText, X } from 'lucide-react';

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return <div className="sl-modal__row"><span>{label}</span><strong>{Array.isArray(value) ? value.join(', ') : value}</strong></div>;
}

export default function OpenAlexPaperDetailModal({ paper, onClose, onImport }) {
  if (!paper) return null;
  const title = paper.title || 'Paper chưa có tiêu đề';
  const doiUrl = paper.doi ? `https://doi.org/${paper.doi}` : null;
  const openUrl = paper.openalex_url || paper.landing_page_url || paper.url;
  const tags = [...new Set([...(paper.tags || []), ...(paper.concepts || []), ...(paper.keywords || [])])];

  return (
    <div className="sl-modal-overlay" role="presentation" onClick={onClose}>
      <section className="sl-modal" role="dialog" aria-modal="true" aria-label={`Chi tiết ${title}`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="sl-modal__close" onClick={onClose} aria-label="Đóng chi tiết paper"><X size={18} /></button>
        <header className="sl-modal__header">
          <span className="sl-modal__icon"><FileText size={22} /></span>
          <div><p>Chi tiết paper OpenAlex</p><h2>{title}</h2></div>
        </header>
        <div className="sl-modal__content">
          <section className="sl-modal__section"><h3>Abstract / mô tả</h3><p>{paper.abstract || paper.summary || 'Chưa có mô tả.'}</p></section>
          <section className="sl-modal__section"><h3>Metadata</h3><div className="sl-modal__grid">
            <DetailRow label="Tác giả" value={paper.authors || []} />
            <DetailRow label="Năm" value={paper.year || 'Chưa có thông tin'} />
            <DetailRow label="Ngày xuất bản" value={paper.publication_date || 'Chưa có thông tin'} />
            <DetailRow label="Nguồn / venue" value={paper.venue || paper.source || 'Chưa có thông tin'} />
            <DetailRow label="Loại" value={paper.type || 'Chưa có thông tin'} />
            <DetailRow label="DOI" value={paper.doi || 'Chưa có thông tin'} />
            <DetailRow label="OpenAlex" value={paper.openalex_url || 'Chưa có thông tin'} />
            <DetailRow label="Landing page" value={paper.landing_page_url || paper.url || 'Chưa có thông tin'} />
            <DetailRow label="PDF" value={paper.pdf_url || paper.pdfUrl || 'Chưa có PDF'} />
            <DetailRow label="Số trích dẫn" value={paper.citation_count ?? paper.citationCount ?? 0} />
          </div></section>
          <section className="sl-modal__section"><h3>Tags / concepts / keywords</h3><div className="sl-card__tags">{tags.length ? tags.map((tag) => <span key={tag} className="sl-tag">#{tag}</span>) : <span className="sl-modal__muted">Chưa có tag.</span>}</div></section>
        </div>
        <footer className="sl-modal__footer" style={{ gap: 10 }}>
          {doiUrl && <a className="sl-download-btn" href={doiUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Mở DOI</a>}
          {openUrl && <a className="sl-download-btn" href={openUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Mở OpenAlex</a>}
          {paper.pdf_url && <a className="sl-download-btn" href={paper.pdf_url} target="_blank" rel="noreferrer">Mở PDF</a>}
          <button type="button" className="sl-upload-btn" onClick={() => onImport(paper)}>Import vào thư viện</button>
        </footer>
      </section>
    </div>
  );
}
