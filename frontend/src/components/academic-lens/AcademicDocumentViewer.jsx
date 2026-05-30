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

export default function AcademicDocumentViewer({ document, snipping, onStopSnipping, onSnip, onSelectionAction }) {
  const viewerRef = useRef(null);
  const [selection, setSelection] = useState(null);

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
          <p>Viewer hỗ trợ PDF bằng trình xem của trình duyệt và DOCX/TXT/MD bằng nội dung text đã trích xuất.</p>
        </div>
      ) : isPdf(document) && document.preview_url ? (
        <iframe className="al-pdf-frame app-scrollbar" src={`${document.preview_url}#toolbar=1&navpanes=1&scrollbar=1&view=FitH`} title={document.title || 'PDF preview'} />
      ) : previewText(document) ? (
        <article className="al-text-doc">
          <span className="al-doc-kind">{String(document.file_type || 'DOC').toUpperCase()} preview từ nội dung đã trích xuất</span>
          <h1>{document.title || document.filename}</h1>
          <pre>{previewText(document)}</pre>
        </article>
      ) : (
        <div className="al-empty warning">
          <AlertTriangle size={38} />
          <h3>Không thể xem trước định dạng này.</h3>
          <p>Bạn vẫn có thể dùng AI để phân tích nội dung đã trích xuất nếu backend đã đọc được tài liệu.</p>
        </div>
      )}
      <SelectionActionPopover selection={selection} onAction={(action) => { onSelectionAction(selection.text, action); setSelection(null); }} />
      <SnippingOverlay active={snipping} targetRef={viewerRef} onCancel={onStopSnipping} onCapture={(payload) => { onSnip(payload); onStopSnipping(); }} />
    </section>
  );
}
