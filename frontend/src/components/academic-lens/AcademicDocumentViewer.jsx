import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import SelectionActionPopover from './SelectionActionPopover';
import SnippingOverlay from './SnippingOverlay';

function isPdf(document) {
  const type = String(document?.file_type || '').toLowerCase();
  const name = String(document?.filename || document?.title || '').toLowerCase();
  return type.includes('pdf') || name.endsWith('.pdf');
}

function previewText(document) {
  return document?.extracted_text || document?.preview_text || (document?.snippets || []).map((s) => s.content).filter(Boolean).join('\n\n') || document?.summary || '';
}

export default function AcademicDocumentViewer({ document, snipping, onStopSnipping, onSnip, onSelectionAction, activeCitation }) {
  const viewerRef = useRef(null);
  const citationRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const pdf = isPdf(document);

  useEffect(() => {
    const close = (event) => {
      if (!viewerRef.current?.contains(event.target)) setSelection(null);
    };
    globalThis.document?.addEventListener?.('mousedown', close);
    return () => globalThis.document?.removeEventListener?.('mousedown', close);
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const closeOnScroll = () => setSelection(null);
    viewer.addEventListener('scroll', closeOnScroll, { passive: true });
    return () => viewer.removeEventListener('scroll', closeOnScroll);
  }, []);

  useEffect(() => {
    if (!activeCitation || !viewerRef.current) return;
    citationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (pdf && document?.preview_url && activeCitation.page_start && !previewText(document)) {
      const iframe = viewerRef.current.querySelector('iframe');
      if (iframe) iframe.src = `${document.preview_url}#page=${activeCitation.page_start}&toolbar=1&navpanes=1&scrollbar=1&view=FitH`;
    }
  }, [activeCitation, document, document?.preview_url, pdf]);

  const handleMouseUp = () => {
    const selected = window.getSelection?.();
    const text = selected?.toString().trim();
    if (!text || text.length < 2 || !selected.rangeCount || !viewerRef.current?.contains(selected.anchorNode)) {
      setSelection(null);
      return;
    }
    const rect = selected.getRangeAt(0).getBoundingClientRect();
    setSelection({ text, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } });
  };

  return (
    <section className={`al-viewer app-scrollbar ${snipping ? 'is-snipping' : ''}`} ref={viewerRef} onMouseUp={handleMouseUp}>
      {!document ? (
        <div className="al-empty">
          <FileText size={44} />
          <h3>Chọn hoặc tải tài liệu để bắt đầu đọc với Kính lúp Học thuật.</h3>
          <p>Viewer hỗ trợ PDF bằng trình xem cơ bản của trình duyệt và DOCX/TXT/MD bằng nội dung text đã trích xuất.</p>
        </div>
      ) : previewText(document) ? (
        <article className="al-text-doc">
          <span className="al-doc-kind">{pdf ? 'PDF text mode · selection/citation giống DOCX/MD' : `${String(document.file_type || 'DOC').toUpperCase()} preview từ nội dung đã trích xuất`}</span>
          {pdf && document.preview_url && <a className="al-original-pdf-link" href={document.preview_url} target="_blank" rel="noreferrer">Mở bản PDF gốc trong tab mới</a>}
          <h1>{document.title || document.filename}</h1>
          {activeCitation && <aside ref={citationRef} className="al-source-preview"><strong>Nguồn đang kiểm chứng · tr. {activeCitation.page_start}{activeCitation.page_end && activeCitation.page_end !== activeCitation.page_start ? `-${activeCitation.page_end}` : ''}</strong><span>{activeCitation.section}</span><p>{activeCitation.snippet}</p></aside>}
          <pre>{previewText(document)}</pre>
        </article>
      ) : pdf && document.preview_url ? (
        <>
          <div className="al-viewer-warning"><AlertTriangle size={14} /> PDF này chưa có text trích xuất nên đang dùng iframe fallback. Upload lại hoặc kiểm tra parser để bật PDF text mode cho selection/citation giống DOCX/MD.</div>
          {activeCitation && <aside ref={citationRef} className="al-source-preview"><strong>Nguồn đang kiểm chứng · tr. {activeCitation.page_start}{activeCitation.page_end && activeCitation.page_end !== activeCitation.page_start ? `-${activeCitation.page_end}` : ''}</strong><span>{activeCitation.section}</span><p>{activeCitation.snippet}</p></aside>}
          <iframe className="al-pdf-frame app-scrollbar" src={`${document.preview_url}#toolbar=1&navpanes=1&scrollbar=1&view=FitH`} title={document.title || 'PDF preview'} />
        </>
      ) : (
        <div className="al-empty warning">
          <AlertTriangle size={38} />
          <h3>Không thể xem trước định dạng này.</h3>
          <p>Bạn vẫn có thể dùng AI để phân tích nội dung đã trích xuất nếu backend đã đọc được tài liệu.</p>
        </div>
      )}
      {document?.is_temporary && <div className="al-temp-warning"><AlertTriangle size={14} /> {document.persistence_warning || 'Tài liệu tạm thời, có thể mất khi kết thúc phiên hoặc server restart.'}</div>}
      <SelectionActionPopover selection={selection} onAction={(action) => { onSelectionAction(selection.text, action); setSelection(null); }} />
      <SnippingOverlay active={snipping} targetRef={viewerRef} onCancel={onStopSnipping} onCapture={(payload) => { onSnip(payload); onStopSnipping(); }} />
    </section>
  );
}
