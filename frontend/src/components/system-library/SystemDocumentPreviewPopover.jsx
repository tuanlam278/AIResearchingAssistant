import { CheckCircle2, Clock3 } from 'lucide-react';

export default function SystemDocumentPreviewPopover({ document }) {
  const summary = document.summary || document.ai_summary || 'Chưa có thông tin';
  return (
    <div className="sl-preview" role="tooltip">
      <div className="sl-preview__topline"><span>{document.file_type || 'Tài liệu'}</span></div>
      <h4>{document.title || document.filename || 'Chưa có tiêu đề'}</h4>
      <p>{summary}</p>
      <dl>
        <div><dt>Độ dài</dt><dd>{document.page_count ?? '—'} trang · {document.word_count ?? '—'} từ</dd></div>
        <div><dt>Danh mục</dt><dd>{document.category || document.subject_area || 'Chưa có thông tin'}</dd></div>
      </dl>
      <div className="sl-preview__status">{document.is_vector_ready ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{document.is_vector_ready ? 'Sẵn sàng cho AI' : 'Đang xử lý vector'}</div>
      <div className="sl-preview__tags">{(document.tags || []).slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}{(document.tags || []).length === 0 && <span>Chưa có tags</span>}</div>
    </div>
  );
}
