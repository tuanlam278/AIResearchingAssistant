import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, Trash2, UploadCloud, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const STYLES = `
  .admin-page { min-height: 100vh; padding: 32px clamp(18px, 4vw, 48px); background: linear-gradient(180deg, #0f0d0a, #15120e); color: #efe6d8; font-family: 'Lora', Georgia, serif; }
  .admin-hero, .admin-panel, .admin-list { border: 1px solid rgba(255,255,255,.08); border-radius: 24px; background: rgba(255,255,255,.035); box-shadow: 0 24px 80px rgba(0,0,0,.28); }
  .admin-hero { padding: clamp(24px, 4vw, 38px); margin-bottom: 22px; }
  .admin-hero h1 { margin: 0 0 10px; font-size: clamp(30px, 5vw, 52px); }
  .admin-hero p { margin: 0; max-width: 780px; color: #a79b8a; line-height: 1.7; }
  .admin-grid { display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 20px; align-items: start; }
  .admin-panel, .admin-list { padding: 20px; }
  .admin-panel h2, .admin-list h2 { margin: 0 0 14px; font-size: 20px; }
  .admin-drop { display: grid; place-items: center; gap: 6px; min-height: 170px; border: 1px dashed rgba(212,182,111,.5); border-radius: 18px; padding: 24px; text-align: center; background: rgba(0,0,0,.18); color: #bfb4a3; cursor: pointer; overflow-wrap: anywhere; }
  .admin-drop.is-active { border-color: #f2d48b; background: rgba(212,182,111,.1); }
  .admin-file { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,.055); color: #efe6d8; }
  .admin-file button { flex: 0 0 auto; border: 0; border-radius: 10px; width: 30px; height: 30px; color: #ffb4b4; background: rgba(255,100,100,.1); cursor: pointer; }
  .admin-drop strong { display: block; color: #f2d48b; margin: 10px 0 6px; }
  .admin-field { display: grid; gap: 7px; margin-top: 14px; color: #bfb4a3; font-size: 13px; }
  .admin-field input { border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: rgba(8,7,5,.65); color: #eee6d8; padding: 11px 12px; outline: none; }
  .admin-button { width: 100%; margin-top: 16px; border: 0; border-radius: 14px; padding: 12px 16px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #d4b66f, #8a6a30); color: #18130d; font-weight: 800; cursor: pointer; }
  .admin-button:disabled { opacity: .45; cursor: not-allowed; }
  .admin-progress { margin-top: 12px; height: 7px; background: rgba(255,255,255,.08); border-radius: 999px; overflow: hidden; }
  .admin-progress span { display: block; height: 100%; background: linear-gradient(90deg,#72bf82,#d4b66f); transition: width .2s; }
  .admin-stages { display: grid; gap: 8px; margin-top: 14px; }
  .admin-stage { display: flex; align-items: center; gap: 8px; color: #746b5d; font-size: 12px; }
  .admin-stage.is-active { color: #f2d48b; }
  .admin-stage.is-done { color: #8fe09e; }
  .admin-status { margin-top: 12px; display: flex; align-items: flex-start; gap: 8px; color: #d7c494; font-size: 13px; line-height: 1.5; }
  .admin-status.is-error { color: #ff9a9a; }
  .admin-table { display: grid; gap: 12px; }
  .admin-doc { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 14px; border-radius: 16px; background: rgba(0,0,0,.18); border: 1px solid rgba(255,255,255,.07); }
  .admin-doc h3 { display:flex; align-items:center; gap:8px; margin: 0 0 6px; font-size: 16px; }
  .admin-doc p { margin: 6px 0; color: #a79b8a; line-height: 1.55; }
  .admin-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #8f8474; font-size: 12px; }
  .admin-tag { color: #f2d48b; background: rgba(212,182,111,.12); padding: 4px 8px; border-radius: 999px; }
  .admin-delete { border: 1px solid rgba(255,120,120,.2); color: #ff9a9a; background: rgba(255,80,80,.08); border-radius: 12px; width: 38px; height: 38px; cursor: pointer; }
  .admin-empty { color: #8f8474; padding: 18px; text-align: center; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin .8s linear infinite; }
  @media (max-width: 980px) { .admin-grid { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .admin-page { padding: 20px 14px; } .admin-panel, .admin-list { padding: 16px; } .admin-doc { grid-template-columns: 1fr; } .admin-delete { justify-self: end; } }
`;

export default function AdminPage() {
  const { token } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: '', category: '', tags: '' });
  const [status, setStatus] = useState('ready');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  const fetchDocuments = useCallback(async () => {
    if (!token) return;
    try {
      const result = await api.listAdminSystemDocuments(token);
      setDocuments(result?.documents || []);
    } catch (err) {
      setMessage(err.message || 'Không thể tải danh sách tài liệu hệ thống.');
    }
  }, [token]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const importStages = [
    { id: 'selected', label: file ? 'File đã chọn' : 'Chưa chọn file' },
    { id: 'uploading', label: 'Đang upload' },
    { id: 'parsing', label: 'Đang đọc tài liệu' },
    { id: 'metadata', label: 'Đang tạo metadata' },
    { id: 'indexing', label: 'Đang lưu/vectorize' },
    { id: 'success', label: 'Thành công' },
  ];

  const getStageState = (stageId) => {
    const order = ['selected', 'uploading', 'parsing', 'metadata', 'indexing', 'success'];
    const current = status === 'ready' ? (file ? 'selected' : '') : status;
    const stageIndex = order.indexOf(stageId);
    const currentIndex = order.indexOf(current);
    if (stageIndex < currentIndex) return 'is-done';
    if (stageIndex === currentIndex) return 'is-active';
    return '';
  };

  const selectFile = (nextFile) => {
    setFile(nextFile || null);
    setStatus('ready');
    setMessage(nextFile ? 'File đã chọn. Sẵn sàng import vào Thư viện.' : '');
  };

  const handleImport = async (event) => {
    event.preventDefault();
    if (!file) {
      setStatus('failed');
      setMessage('Vui lòng chọn tài liệu để import.');
      return;
    }
    setProgress(0);
    setStatus('uploading');
    setMessage('Đang upload tài liệu...');
    try {
      const result = await api.importSystemDocument({ ...form, file }, token, (value) => {
        setProgress(value);
        if (value >= 100) setStatus('parsing');
      });
      setStatus('metadata');
      setMessage('Đang tạo metadata và lưu/vectorize tài liệu...');
      await fetchDocuments();
      setStatus('indexing');
      const document = result?.document;
      if (document) setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
      setFile(null);
      setForm({ title: '', category: '', tags: '' });
      setStatus('success');
      setMessage('Import thành công: file gốc đã được lưu, tài liệu đã parse, tạo metadata và vectorize.');
    } catch (err) {
      setStatus('failed');
      setMessage(err.message || 'Import tài liệu thất bại.');
    } finally {
      setProgress(0);
    }
  };

  const handleDelete = async (documentId) => {
    if (!window.confirm('Xoá tài liệu hệ thống này?')) return;
    try {
      await api.deleteAdminSystemDocument(documentId, token);
      setDocuments((current) => current.filter((doc) => doc.id !== documentId));
    } catch (err) {
      setMessage(err.message || 'Không thể xoá tài liệu.');
    }
  };

  const busy = ['uploading', 'parsing', 'metadata', 'indexing'].includes(status);

  return (
    <div className="admin-page">
      <style>{STYLES}</style>
      <section className="admin-hero">
        <h1>Quản trị Thư viện Hệ thống</h1>
        <p>Import tài liệu để người dùng có thể tìm kiếm và tải xuống file gốc từ Thư viện Hệ thống.</p>
      </section>

      <div className="admin-grid">
        <form className="admin-panel" onSubmit={handleImport}>
          <h2>Import tài liệu</h2>
          <label className={`admin-drop ${dragActive ? 'is-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); selectFile(event.dataTransfer.files?.[0] || null); }}>
            <UploadCloud size={32} />
            <strong>Kéo thả file hoặc chọn file</strong>
            {file ? <span className="admin-file"><span>{file.name}</span><button type="button" onClick={(event) => { event.preventDefault(); selectFile(null); }} aria-label="Bỏ file đã chọn"><X size={15} /></button></span> : <span>Hỗ trợ PDF, DOCX, TXT, MD</span>}
            <input type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(event) => selectFile(event.target.files?.[0] || null)} />
          </label>
          <label className="admin-field">Title override<input value={form.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="Để trống sẽ dùng tên file" /></label>
          <label className="admin-field">Category override<input value={form.category} onChange={(event) => updateForm('category', event.target.value)} placeholder="Để trống để AI tự phân loại" /></label>
          <label className="admin-field">Tags override<input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} placeholder="pháp luật, doanh nghiệp" /></label>
          <button type="submit" className="admin-button" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <UploadCloud size={16} />} Import vào Thư viện</button>
          <div className="admin-stages">{importStages.map((stage) => <span key={stage.id} className={`admin-stage ${getStageState(stage.id)}`}><CheckCircle2 size={13} /> {stage.label}</span>)}</div>
          {progress > 0 && <div className="admin-progress"><span style={{ width: `${progress}%` }} /></div>}
          {message && <div className={`admin-status ${status === 'failed' ? 'is-error' : ''}`}>{status === 'failed' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {message}</div>}
        </form>

        <section className="admin-list">
          <h2>Tài liệu đã import</h2>
          <div className="admin-table">
            {documents.length === 0 ? <div className="admin-empty">Chưa có tài liệu hệ thống.</div> : documents.map((doc) => (
              <article className="admin-doc" key={doc.id}>
                <div>
                  <h3><FileText size={18} /> {doc.title}</h3>
                  <div className="admin-meta">
                    <span>{doc.filename}</span><span>•</span><span>{doc.file_type}</span><span>•</span><span>{doc.category || 'Khác'}</span><span>•</span><span>{doc.can_download ? 'có file gốc' : 'thiếu file gốc'}</span><span>•</span><span>{doc.is_vector_ready ? 'vector ready' : 'processing'}</span><span>•</span><span>{doc.created_at ? new Date(doc.created_at).toLocaleString('vi-VN') : '—'}</span>
                  </div>
                  <p>{doc.summary || 'Chưa có summary.'}</p>
                  <div className="admin-meta">{(doc.tags || []).map((tag) => <span key={tag} className="admin-tag">#{tag}</span>)}</div>
                </div>
                <button type="button" className="admin-delete" onClick={() => handleDelete(doc.id)} title="Xoá tài liệu"><Trash2 size={16} /></button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
