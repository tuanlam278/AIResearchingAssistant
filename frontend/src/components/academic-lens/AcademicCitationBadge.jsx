import { useState } from 'react';

function pageLabel(citation) {
  if (!citation?.page_start) return 'Trang không rõ';
  return citation.page_end && citation.page_end !== citation.page_start ? `tr. ${citation.page_start}-${citation.page_end}` : `tr. ${citation.page_start}`;
}

export default function AcademicCitationBadge({ citation, index, onSelect }) {
  const [open, setOpen] = useState(false);
  if (!citation?.snippet || !citation?.page_start || citation?.score === undefined || citation?.score === null) return null;
  return (
    <span className="al-citation-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="al-citation-badge" onClick={() => { setOpen((value) => !value); onSelect?.(citation); }} aria-label={`Mở citation ${index + 1}`}>[{index + 1}]</button>
      {open && (
        <span className="al-citation-popover">
          <strong>{citation.title || 'Tài liệu'}</strong>
          <em>{pageLabel(citation)} · {citation.section || 'Không rõ section'} · score {Number(citation.score).toFixed(2)}</em>
          <span>{citation.snippet}</span>
          <small>Click badge để nhảy tới viewer hoặc ghim snippet nguồn.</small>
        </span>
      )}
    </span>
  );
}
