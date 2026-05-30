import { forwardRef, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Download, Eye, Pencil, Save } from 'lucide-react';

const AcademicNotepad = forwardRef(function AcademicNotepad({ value, onChange, onSave }, ref) {
  const [mode, setMode] = useState('edit');
  const filename = useMemo(() => `academic-notepad-${new Date().toISOString().slice(0, 10)}.md`, []);

  const exportMd = () => {
    const blob = new Blob([value || ''], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside ref={ref} className="al-notepad">
      <div className="al-notepad-head">
        <div><strong>Markdown Notepad</strong><span>Luôn hiển thị ở cuối trang và lưu theo tài liệu/session hiện tại</span></div>
        <div className="al-icon-row">
          <button type="button" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>{mode === 'edit' ? <Eye size={15} /> : <Pencil size={15} />}</button>
          <button type="button" onClick={onSave}><Save size={15} /></button>
          <button type="button" onClick={exportMd}><Download size={15} /> .md</button>
          <button type="button" disabled title="Export DOCX sẽ bật khi backend export DOCX được cấu hình cho Academic Lens.">.docx</button>
        </div>
      </div>
      {mode === 'edit' ? (
        <textarea className="app-scrollbar" value={value} onChange={(event) => onChange(event.target.value)} placeholder={'# Ghi chú học thuật\n\n- Ý chính...\n- Trích dẫn...\n\n```\ncode / công thức\n```'} />
      ) : (
        <div className="al-markdown-preview app-scrollbar"><ReactMarkdown>{value || '_Chưa có ghi chú._'}</ReactMarkdown></div>
      )}
    </aside>
  );
});

export default AcademicNotepad;
