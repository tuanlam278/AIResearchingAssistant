import { forwardRef, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Download, Eye, PanelBottom, PanelRight, Pencil, Save, X } from 'lucide-react';

const AcademicNotepad = forwardRef(function AcademicNotepad({ value, onChange, onSave, saveStatus = 'idle', storage = 'database', dock = 'right', onDockChange, onCollapse }, ref) {
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
        <div><strong>Ghi chú Markdown</strong><span>{saveStatus === 'saving' ? 'Đang lưu…' : saveStatus === 'saved' ? 'Đã lưu' : saveStatus === 'error' ? 'Lỗi lưu' : 'Autosave sau 1–2 giây idle'}{storage === 'memory_fallback' ? ' · Memory fallback (chưa bền DB)' : ''}</span></div>
        <div className="al-icon-row">
          <button type="button" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')} title={mode === 'edit' ? 'Xem preview Markdown' : 'Sửa ghi chú'}>{mode === 'edit' ? <Eye size={15} /> : <Pencil size={15} />}</button>
          <button type="button" onClick={() => onDockChange?.('right')} className={dock === 'right' ? 'active' : ''} title="Dock phải"><PanelRight size={15} /> Phải</button>
          <button type="button" onClick={() => onDockChange?.('bottom')} className={dock === 'bottom' ? 'active' : ''} title="Dock dưới"><PanelBottom size={15} /> Dưới</button>
          <button type="button" onClick={onSave} title="Lưu ngay"><Save size={15} /></button>
          <button type="button" onClick={exportMd}><Download size={15} /> .md</button>
          <button type="button" onClick={onCollapse} title="Ẩn ghi chú"><X size={15} /> Ẩn</button>
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
