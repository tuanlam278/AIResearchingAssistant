import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Search, X } from 'lucide-react';
import AcademicChatPanel from '../components/academic-lens/AcademicChatPanel';
import AcademicDocumentViewer from '../components/academic-lens/AcademicDocumentViewer';
import AcademicNotepad from '../components/academic-lens/AcademicNotepad';
import DocumentToolbar from '../components/academic-lens/DocumentToolbar';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

const ACADEMIC_LENS_SESSION_KEY = 'academicLens:session';
const ACADEMIC_LENS_LAST_PATH_KEY = 'academicLens:lastPath';

const loadAcademicLensSession = () => {
  try {
    return JSON.parse(localStorage.getItem(ACADEMIC_LENS_SESSION_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const STYLES = `
  .al-page { min-height:100vh; padding:24px clamp(14px,2.4vw,34px); background:radial-gradient(ellipse at 35% 0%, rgba(196,164,100,.13), transparent 42%), #0f0d0a; color:#e8dfd0; font-family:'Lora', Georgia, serif; }
  .al-page button, .al-page textarea, .al-page input { font-family:inherit; }
  .al-hero { border:1px solid rgba(255,255,255,.08); border-radius:26px; padding:24px; background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); margin-bottom:16px; }
  .al-hero h1 { margin:8px 0; font-size:clamp(30px,4.5vw,52px); color:#f3ebdc; }
  .al-hero p, .al-muted { color:#9f9484; line-height:1.65; font-size:13px; }
  .al-eyebrow { color:#d8bd77; font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
  .al-workspace { display:grid; grid-template-columns:minmax(0,1fr) minmax(330px,390px); gap:14px; align-items:start; }
  .al-main { min-width:0; border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); overflow:hidden; display:flex; flex-direction:column; height:min(82vh,920px); min-height:620px; }
  .al-toolbar { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.035); }
  .al-toolbar h2 { margin:4px 0 0; color:#f3ebdc; font-size:18px; }
  .al-toolbar-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
  .al-toolbar-actions button, .al-chat-form button, .al-chat-tabs button, .al-icon-row button, .al-msg-actions button, .al-library-modal button { border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.055); color:#d8caa8; border-radius:13px; padding:9px 11px; display:inline-flex; align-items:center; gap:7px; cursor:pointer; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .al-viewer { position:relative; flex:1; min-height:0; overflow:auto; background:#12100c; overscroll-behavior:contain; }
  .al-viewer.is-snipping { cursor:crosshair; }
  .al-empty { min-height:58vh; display:grid; place-items:center; align-content:center; gap:10px; text-align:center; padding:30px; color:#9f9484; }
  .al-empty h3 { color:#f3ebdc; margin:0; }
  .al-empty.warning { color:#f0b5aa; }
  .al-pdf-frame { width:100%; height:100%; min-height:620px; border:0; background:#1d1d1d; }
  .al-text-doc { max-width:920px; margin:0 auto; padding:34px clamp(18px,4vw,56px); }
  .al-text-doc h1 { color:#f3ebdc; }
  .al-text-doc pre { white-space:pre-wrap; line-height:1.75; color:#ded4c4; font-family:'DM Sans', sans-serif; }
  .al-doc-kind { display:inline-flex; border:1px solid rgba(196,164,100,.2); background:rgba(196,164,100,.08); color:#f2d48b; border-radius:999px; padding:6px 10px; font-size:12px; font-weight:800; }
  .al-selection-popover { position:fixed; z-index:120; display:flex; gap:6px; flex-wrap:wrap; max-width:250px; padding:8px; background:#211a12; border:1px solid rgba(196,164,100,.25); border-radius:15px; box-shadow:0 16px 55px rgba(0,0,0,.5); }
  .al-selection-popover button { border:0; border-radius:10px; padding:7px 9px; background:rgba(255,255,255,.06); color:#f2d48b; display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; }
  .al-snipping-overlay { position:fixed; inset:0; z-index:110; background:rgba(0,0,0,.42); cursor:crosshair; }
  .al-snipping-box { position:fixed; border:2px dashed #f2d48b; background:rgba(242,212,139,.12); box-shadow:0 0 0 9999px rgba(0,0,0,.35); pointer-events:none; }
  .al-snipping-cancel, .al-snipping-help { position:fixed; z-index:111; left:24px; border-radius:12px; padding:10px 12px; }
  .al-snipping-cancel { top:20px; border:1px solid rgba(255,255,255,.14); background:#201810; color:#f0b5aa; cursor:pointer; }
  .al-snipping-help { top:68px; color:#f3ebdc; background:rgba(32,24,16,.86); }
  .al-chat { border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); display:flex; flex-direction:column; height:min(82vh,920px); min-height:620px; overflow:hidden; }
  .al-chat.is-web { border-color:rgba(129,196,255,.2); background:rgba(80,130,180,.055); }
  .al-chat-tabs { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
  .al-chat-tools { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; color:#8e8374; font-size:12px; border-bottom:1px solid rgba(255,255,255,.06); }
  .al-chat-tools button { border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.045); color:#d8caa8; border-radius:11px; padding:7px 9px; display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
  .al-chat-tabs button.active { color:#18130d; background:linear-gradient(135deg,#d4b66f,#8a6a30); font-weight:900; }
  .al-web-note { margin:10px 12px 0; border:1px solid rgba(129,196,255,.2); background:rgba(129,196,255,.08); color:#cfe9ff; border-radius:14px; padding:10px; display:flex; gap:7px; align-items:center; font-size:12px; }
  .al-chat-log { flex:1; min-height:0; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
  .al-msg { border:1px solid rgba(255,255,255,.08); border-radius:15px; padding:11px; background:rgba(0,0,0,.16); color:#ded4c4; line-height:1.55; }
  .al-msg.user { background:rgba(196,164,100,.09); align-self:flex-end; max-width:88%; }
  .al-msg.warning { border-color:rgba(224,120,120,.25); }
  .al-msg p { margin:0; white-space:pre-wrap; }
  .al-msg span { display:flex; gap:6px; color:#f0b5aa; font-size:12px; margin-top:8px; }
  .al-msg-actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
  .al-msg-actions button { padding:7px 9px; font-size:12px; }
  .al-chat-form { padding:12px; border-top:1px solid rgba(255,255,255,.08); display:grid; gap:9px; }
  .al-chat-form textarea { width:100%; border:1px solid rgba(255,255,255,.09); background:rgba(0,0,0,.22); color:#eee6d8; border-radius:15px; padding:11px; resize:vertical; outline:none; }
  .al-chat-form > button { justify-content:center; background:linear-gradient(135deg,#d4b66f,#8a6a30); color:#18130d; font-weight:900; }
  .al-image-draft { position:relative; border:1px solid rgba(196,164,100,.18); border-radius:15px; padding:10px; background:rgba(196,164,100,.06); }
  .al-image-draft img { max-width:180px; border-radius:10px; display:block; margin-bottom:8px; }
  .al-image-draft p { margin:7px 0; color:#b8ab99; font-size:12px; line-height:1.45; }
  .al-image-draft.has-error { border-color:rgba(224,120,120,.26); background:rgba(224,120,120,.07); }
  .al-image-placeholder { min-height:72px; display:flex; align-items:center; gap:8px; color:#f0b5aa; }
  .al-image-error { display:flex; align-items:flex-start; gap:6px; color:#f0b5aa !important; }
  .al-image-draft > button { position:absolute; top:8px; right:8px; padding:6px; }
  .al-image-draft div { display:flex; flex-wrap:wrap; gap:6px; }
  .al-image-draft div button { font-size:12px; padding:7px 8px; }
  .al-notepad { grid-column:1 / -1; border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); overflow:hidden; scroll-margin-top:24px; }
  .al-notepad-head { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
  .al-notepad-head strong { display:block; color:#f3ebdc; }
  .al-notepad-head span { display:block; color:#8e8374; font-size:12px; margin-top:3px; }
  .al-icon-row { display:flex; flex-wrap:wrap; gap:6px; }
  .al-notepad textarea { width:100%; min-height:260px; max-height:520px; overflow:auto; border:0; background:rgba(0,0,0,.18); color:#eee6d8; padding:14px; outline:none; resize:vertical; font-family:'DM Sans', sans-serif; }
  .al-markdown-preview { min-height:260px; max-height:520px; padding:18px; color:#ded4c4; line-height:1.7; overflow:auto; }
  .al-library-backdrop { position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.7); display:grid; place-items:center; padding:20px; }
  .al-library-modal { width:min(860px,100%); max-height:84vh; overflow:auto; border:1px solid rgba(255,255,255,.1); background:#17130e; border-radius:24px; padding:16px; }
  .al-library-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
  .al-library-search { width:100%; border:1px solid rgba(255,255,255,.09); background:rgba(0,0,0,.22); color:#eee6d8; border-radius:15px; padding:12px; outline:none; }
  .al-library-list { display:grid; gap:10px; margin-top:12px; }
  .al-library-doc { text-align:left !important; display:block !important; }
  .al-warning { display:flex; gap:8px; align-items:flex-start; color:#f0b5aa; border:1px solid rgba(224,120,120,.24); background:rgba(224,120,120,.08); border-radius:15px; padding:10px; margin-top:10px; }
  @media (max-width:1050px) { .al-workspace { grid-template-columns:1fr; } .al-main, .al-chat { height:auto; min-height:520px; } .al-viewer { max-height:72vh; } }
  @media (max-width:720px) { .al-toolbar { align-items:flex-start; flex-direction:column; } .al-toolbar-actions { justify-content:flex-start; } }
`;

function LibraryModal({ open, onClose, onSelect }) {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.listSystemLibraryDocuments({ q: query }, token)
      .then((data) => { if (!cancelled) setDocuments(data?.documents || data?.items || []); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Không thể tải Thư viện Hệ thống.'); });
    return () => { cancelled = true; };
  }, [open, query, token]);
  if (!open) return null;
  return (
    <div className="al-library-backdrop" onClick={onClose}>
      <section className="al-library-modal" onClick={(event) => event.stopPropagation()}>
        <div className="al-library-head"><h2><Search size={18} /> Chọn tài liệu</h2><button type="button" onClick={onClose}><X size={16} /> Đóng</button></div>
        <input className="al-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên, tag, chủ đề..." />
        {error && <div className="al-warning"><AlertTriangle size={16} /> {error}</div>}
        <div className="al-library-list">
          {documents.map((doc) => <button key={doc.id} type="button" className="al-library-doc" onClick={() => { onSelect({ ...doc, source_type: 'system_library' }); onClose(); }}><strong>{doc.title || doc.filename}</strong><p className="al-muted">{doc.category || 'Khác'} · {doc.file_type || 'FILE'}</p></button>)}
        </div>
      </section>
    </div>
  );
}

export default function AcademicLensPage() {
  const { token } = useAuth();
  const savedSession = useMemo(loadAcademicLensSession, []);
  const fileInputRef = useRef(null);
  const [document, setDocument] = useState(savedSession.document || null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const notepadRef = useRef(null);
  const [notepad, setNotepad] = useState('');
  const [activeTab, setActiveTab] = useState(savedSession.activeTab || 'document');
  const [messages, setMessages] = useState(Array.isArray(savedSession.messages) ? savedSession.messages : []);
  const [snipping, setSnipping] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [webContexts, setWebContexts] = useState(Array.isArray(savedSession.webContexts) ? savedSession.webContexts : []);

  const docKey = useMemo(() => document?.id ? `academic-lens-note:${document.source_type}:${document.id}` : 'academic-lens-note:draft', [document]);

  useEffect(() => {
    localStorage.setItem(ACADEMIC_LENS_LAST_PATH_KEY, '/academic-lens');
  }, []);

  useEffect(() => {
    localStorage.setItem(ACADEMIC_LENS_SESSION_KEY, JSON.stringify({ document, activeTab, messages, webContexts }));
  }, [document, activeTab, messages, webContexts]);

  const selectDocument = (nextDocument) => {
    setDocument(nextDocument);
    setMessages([]);
    setWebContexts([]);
    setPendingImage(null);
    setActiveTab('document');
  };

  useEffect(() => {
    setNotepad(localStorage.getItem(docKey) || '');
    if (document?.source_type === 'system_library') {
      api.getAcademicLensDocumentPreview(document.id, token).then((data) => setDocument((current) => ({ ...(current || document), ...(data || {}) }))).catch(() => {});
    }
  }, [docKey, document?.id, document?.source_type, token]);

  const uploadDocument = async (file) => {
    setLoading('upload');
    setError('');
    let previewUrl = '';
    try {
      previewUrl = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? URL.createObjectURL(file) : '';
      const data = await api.uploadAcademicLensDocument(file, token);
      selectDocument({ ...data, preview_url: previewUrl });
    } catch (err) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError(err.message || 'Không thể upload tài liệu.');
    } finally {
      setLoading('');
    }
  };

  const saveNotepad = async () => {
    localStorage.setItem(docKey, notepad);
    try { await api.saveAcademicLensNotepad({ document_id: document?.id || 'draft', content: notepad }, token); } catch {}
  };

  const sendChat = async ({ message, tab }) => {
    const mode = tab || activeTab;
    const userMessage = { role: 'user', content: pendingImage ? `${message}\n[Đính kèm ảnh vùng chọn]` : message, mode };
    setMessages((current) => [...current, userMessage]);
    setLoading('chat');
    try {
      if (pendingImage) {
        const data = await api.visionAcademicLensChat({ image_data_url: pendingImage.dataUrl, prompt: message, document_id: document?.id }, token);
        setMessages((current) => [...current, { role: 'assistant', content: data?.answer || 'Không có phản hồi từ Vision API.', mode: 'vision' }]);
      } else if (mode === 'web') {
        const data = await api.webAcademicLensChat({ message }, token);
        setMessages((current) => [...current, { role: 'assistant', content: data?.answer || 'Không có phản hồi.', mode: 'web', citations: data?.citations || [] }]);
      } else {
        const data = await api.documentAcademicLensChat({ document: document ? { id: document.id, source_type: document.source_type, title: document.title, filename: document.filename, file_type: document.file_type } : null, message, chat_history: messages, extra_contexts: webContexts }, token);
        setMessages((current) => [...current, { role: 'assistant', content: data?.answer || 'Không có phản hồi.', mode: 'document' }]);
        setPendingImage(null);
        return;
      }
    } catch (err) {
      setMessages((current) => [...current, { role: 'assistant', content: err.message || 'Tính năng này chưa sẵn sàng.', mode, warning: mode === 'web' ? 'Câu trả lời này chưa có nguồn kiểm chứng.' : '' }]);
    } finally {
      setPendingImage(null);
      setLoading('');
    }
  };

  const handleSelectionAction = (text, action) => {
    const prompt = `[Context: "${text}"] ${action.prompt}`;
    setActiveTab(action.web ? 'web' : 'document');
    sendChat({ message: prompt, tab: action.web ? 'web' : 'document' });
  };

  const appendToNotepad = (content) => {
    setNotepad((current) => `${current}${current ? '\n\n' : ''}> AI Answer\n\n${content}`);
    setTimeout(() => notepadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const resetChatHistory = () => {
    if (!messages.length) return;
    if (!window.confirm('Xóa lịch sử chat hiện tại? Tài liệu và Notepad vẫn được giữ nguyên.')) return;
    setMessages([]);
  };

  const scrollToNotepad = () => {
    notepadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const addToContext = async (message) => {
    const context = { content: message.content, citations: message.citations || [] };
    setWebContexts((current) => [...current, context]);
    try { await api.addAcademicLensWebContext(context, token); } catch {}
  };

  return (
    <div className="al-page">
      <style>{STYLES}</style>
      <section className="al-hero">
        <span className="al-eyebrow">Academic Lens · advanced reading workspace</span>
        <h1>Kính lúp Học thuật</h1>
        <p>Đọc, đánh dấu, chụp vùng nội dung và hỏi AI trực tiếp trên tài liệu học thuật.</p>
      </section>
      {error && <div className="al-warning"><AlertTriangle size={16} /> {error}</div>}
      <input ref={fileInputRef} type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(event) => event.target.files?.[0] && uploadDocument(event.target.files[0])} />
      <div className="al-workspace">
        <main className="al-main">
          <DocumentToolbar title={document?.title || document?.filename} uploading={loading === 'upload'} onUploadClick={() => fileInputRef.current?.click()} onOpenLibrary={() => setLibraryOpen(true)} onToggleSnip={() => setSnipping(true)} onScrollToNotepad={scrollToNotepad} />
          <AcademicDocumentViewer document={document} snipping={snipping} onStopSnipping={() => setSnipping(false)} onSnip={setPendingImage} onSelectionAction={handleSelectionAction} />
        </main>
        <AcademicChatPanel activeTab={activeTab} onTabChange={setActiveTab} messages={messages} onSend={sendChat} onReset={resetChatHistory} pendingImage={pendingImage} onClearImage={() => setPendingImage(null)} onAddToNotepad={appendToNotepad} onAddToContext={addToContext} sending={loading === 'chat'} />
        <AcademicNotepad ref={notepadRef} value={notepad} onChange={setNotepad} onSave={saveNotepad} />
      </div>
      <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} onSelect={selectDocument} />
    </div>
  );
}
