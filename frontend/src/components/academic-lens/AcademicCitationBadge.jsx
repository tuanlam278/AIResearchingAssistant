import { useState } from 'react';

const BLOCK_LABELS = {
  table: 'Bảng',
  equation: 'Công thức',
  paragraph: 'Đoạn văn',
  heading: 'Heading',
  figure_caption: 'Chú thích hình',
  unknown: 'Không rõ',
};

function pageLabel(citation) {
  if (!citation?.page_start) return 'Trang không rõ';
  return citation.page_end && citation.page_end !== citation.page_start ? `tr. ${citation.page_start}-${citation.page_end}` : `tr. ${citation.page_start}`;
}

function blockLabel(citation) {
  const type = citation?.block_type || citation?.block_types?.[0] || 'paragraph';
  return BLOCK_LABELS[type] || type;
}

function snippetClass(citation) {
  const markdown = citation?.markdown || citation?.snippet || '';
  return markdown.includes('| ---') || markdown.includes('|---') ? 'is-markdown-table' : '';
}

export default function AcademicCitationBadge({ citation, index, onSelect }) {
  const [open, setOpen] = useState(false);
  if (!citation?.snippet || !citation?.page_start || citation?.score === undefined || citation?.score === null) return null;
  const label = blockLabel(citation);
  const snippet = citation.markdown || citation.snippet;
  return (
    <span className="al-citation-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="al-citation-badge" onClick={() => { setOpen((value) => !value); onSelect?.(citation); }} aria-label={`Mở citation ${index + 1}`}>[{index + 1}] <span>{label}</span></button>
      {open && (
        <span className="al-citation-popover">
          <strong>{citation.title || 'Tài liệu'}</strong>
          <em>{pageLabel(citation)} · {citation.section || 'Không rõ section'} · {label}{citation.source ? ` · ${citation.source}` : ''} · score {Number(citation.score).toFixed(2)}</em>
          <pre className={snippetClass(citation)}>{snippet}</pre>
          <small>Click badge để nhảy tới viewer hoặc ghim snippet nguồn.</small>
        </span>
      )}
    </span>
  );
}
