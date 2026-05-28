import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0d0a; }

  .nbp-page {
    min-height: 100vh;
    background: #0f0d0a;
    background-image: radial-gradient(ellipse 60% 50% at 50% 0%, rgba(196,164,100,0.06) 0%, transparent 60%);
    font-family: 'DM Sans', sans-serif;
    color: #d4cfc8;
    padding-bottom: 60px;
  }

  /* Header */
  .nbp-header {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 28px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(15,13,10,0.85);
    backdrop-filter: blur(12px);
    position: sticky; top: 0; z-index: 10;
  }
  .nbp-back {
    display: flex; align-items: center; gap: 6px;
    color: #8a8070; text-decoration: none;
    font-size: 13px; font-weight: 500;
    padding: 6px 10px; border-radius: 8px;
    transition: color 0.2s, background 0.2s;
    white-space: nowrap;
  }
  .nbp-back:hover { color: #c4a464; background: rgba(196,164,100,0.08); }
  .nbp-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.08); flex-shrink: 0; }
  .nbp-title {
    font-family: 'Lora', Georgia, serif;
    font-size: 16px; font-weight: 600;
    color: #e8e0d0; flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nbp-research-btn {
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(135deg, #c4a464, #8a6a30);
    border: none; border-radius: 9px;
    padding: 8px 16px;
    color: #1a1510; font-size: 13px; font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    cursor: pointer; white-space: nowrap;
    box-shadow: 0 3px 12px rgba(196,164,100,0.25);
    transition: opacity 0.2s, transform 0.15s;
  }
  .nbp-research-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .nbp-research-btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }

  /* Content */
  .nbp-content { max-width: 760px; margin: 0 auto; padding: 36px 24px 0; }

  .nbp-section {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 20px;
  }
  .nbp-section-title {
    font-family: 'Lora', Georgia, serif;
    font-size: 14px; font-weight: 600;
    color: #9a9080; margin-bottom: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  .nbp-section-title::after {
    content: ''; flex: 1; height: 1px;
    background: rgba(255,255,255,0.06);
  }

  /* Upload zone */
  .nbp-dropzone {
    border: 2px dashed rgba(255,255,255,0.1);
    border-radius: 14px;
    padding: 32px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: rgba(255,255,255,0.01);
  }
  .nbp-dropzone.dragging {
    border-color: rgba(196,164,100,0.5);
    background: rgba(196,164,100,0.05);
  }
  .nbp-dropzone.has-error {
    border-color: rgba(200,80,80,0.3);
    background: rgba(200,80,80,0.03);
  }
  .nbp-dropzone-icon { font-size: 34px; opacity: 0.35; margin-bottom: 10px; }
  .nbp-dropzone-text { font-size: 14px; color: #8a8070; margin-bottom: 4px; }
  .nbp-dropzone-text span { color: #c4a464; font-weight: 600; }
  .nbp-dropzone-hint { font-size: 11px; color: #4a4030; }

  /* Selected files list */
  .nbp-selected-files {
    margin-top: 14px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .nbp-file-chip {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px;
    background: rgba(196,164,100,0.07);
    border: 1px solid rgba(196,164,100,0.15);
    border-radius: 10px;
  }
  .nbp-file-chip-name {
    flex: 1; font-size: 13px; color: #c4a464;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nbp-file-chip-size { font-size: 11px; color: #6a6050; flex-shrink: 0; }
  .nbp-file-chip-remove {
    background: none; border: none; cursor: pointer;
    color: #6a6050; font-size: 15px; padding: 2px;
    transition: color 0.2s; flex-shrink: 0;
    display: flex; align-items: center;
  }
  .nbp-file-chip-remove:hover { color: #e07878; }

  /* Progress bar */
  .nbp-progress-wrap {
    margin-top: 14px;
    background: rgba(255,255,255,0.05);
    border-radius: 99px; height: 4px; overflow: hidden;
  }
  .nbp-progress-bar {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #c4a464, #8a6a30);
    transition: width 0.3s;
  }

  /* Upload actions */
  .nbp-upload-actions {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 14px; gap: 10px;
  }
  .nbp-upload-error {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: #e07878; flex: 1;
  }
  .nbp-upload-btn {
    display: flex; align-items: center; gap: 7px;
    background: linear-gradient(135deg, #c4a464, #8a6a30);
    border: none; border-radius: 9px;
    padding: 9px 18px;
    color: #1a1510; font-size: 13px; font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    cursor: pointer; white-space: nowrap;
    box-shadow: 0 3px 12px rgba(196,164,100,0.2);
    transition: opacity 0.2s, transform 0.15s;
  }
  .nbp-upload-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .nbp-upload-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  /* Upload results */
  .nbp-upload-result {
    margin-top: 12px;
    border-radius: 10px; padding: 12px 14px;
    font-size: 13px;
  }
  .nbp-upload-result.success {
    background: rgba(80,180,80,0.08);
    border: 1px solid rgba(80,180,80,0.2);
    color: #78c878;
  }
  .nbp-upload-result.partial {
    background: rgba(200,160,80,0.08);
    border: 1px solid rgba(200,160,80,0.2);
    color: #c4a464;
  }

  /* Document list */
  .nbp-docs-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }
  .nbp-docs-count {
    font-size: 12px; padding: 3px 10px;
    background: rgba(196,164,100,0.1);
    border: 1px solid rgba(196,164,100,0.15);
    border-radius: 99px; color: #c4a464;
  }

  .nbp-doc-item {
    display: flex; align-items: center; gap: 14px;
    padding: 13px 15px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px; margin-bottom: 8px;
    transition: border-color 0.2s, background 0.2s;
  }
  .nbp-doc-item:hover {
    border-color: rgba(196,164,100,0.25);
    background: rgba(196,164,100,0.03);
  }
  .nbp-doc-icon {
    width: 38px; height: 38px; border-radius: 9px; flex-shrink: 0;
    background: rgba(196,164,100,0.1);
    border: 1px solid rgba(196,164,100,0.15);
    display: flex; align-items: center; justify-content: center; font-size: 17px;
  }
  .nbp-doc-info { flex: 1; overflow: hidden; }
  .nbp-doc-name {
    font-family: 'Lora', Georgia, serif; font-weight: 600;
    font-size: 13px; color: #e8e0d0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    margin-bottom: 4px;
  }
  .nbp-doc-tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .nbp-doc-tag {
    font-size: 11px; padding: 2px 8px; border-radius: 99px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    color: #6a6050;
  }
  .nbp-doc-delete {
    width: 30px; height: 30px; border-radius: 7px; border: none;
    background: transparent; cursor: pointer; color: #4a4030;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: color 0.2s, background 0.2s; flex-shrink: 0;
  }
  .nbp-doc-delete:hover { color: #e07878; background: rgba(200,80,80,0.08); }

  /* Empty */
  .nbp-empty {
    text-align: center; padding: 40px 20px;
    border: 2px dashed rgba(255,255,255,0.06);
    border-radius: 14px;
  }
  .nbp-empty-icon { font-size: 32px; opacity: 0.25; margin-bottom: 10px; }
  .nbp-empty-text { font-family: 'Lora', Georgia, serif; font-size: 14px; color: #5a5040; margin-bottom: 4px; }
  .nbp-empty-sub { font-size: 12px; color: #3a3020; }

  /* Loading */
  .nbp-loading {
    display: flex; align-items: center; justify-content: center;
    gap: 10px; padding: 40px;
    color: #4a4030; font-family: 'Lora', Georgia, serif;
    font-style: italic; font-size: 13px;
  }
  .nbp-spinner {
    width: 17px; height: 17px;
    border: 2px solid rgba(196,164,100,0.15);
    border-top-color: #c4a464;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
`;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function NotebookPage() {
  const { notebookId } = useParams();
  const navigate = useNavigate();
  const { token, logoutContext } = useAuth();
  const fileInputRef = useRef(null);

  const [notebookName, setNotebookName] = useState('Notebook');
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');

  const fetchDocuments = async () => {
    if (!token) return;
    setLoadingDocs(true);
    try {
      const result = await api.getNotebookDocuments(notebookId, token);
      setDocuments(result.documents ?? []);
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') { logoutContext(); return; }
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    // Lấy tên notebook từ localStorage nếu có (được set ở NotebooksPage khi navigate)
    const saved = sessionStorage.getItem(`nb_name_${notebookId}`);
    if (saved) setNotebookName(saved);
    fetchDocuments();
  }, [notebookId, token]);

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileInput = (e) => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const addFiles = (newFiles) => {
    setUploadResult(null); setUploadError('');
    const pdfs = newFiles.filter(f => f.type === 'application/pdf');
    const invalid = newFiles.length - pdfs.length;
    if (invalid > 0) setUploadError(`${invalid} file không phải PDF đã bị bỏ qua.`);

    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const added = pdfs.filter(f => !existing.has(f.name));
      return [...prev, ...added];
    });
  };

  const removeFile = (name) => setSelectedFiles(prev => prev.filter(f => f.name !== name));

  // ── Upload ───────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!selectedFiles.length || uploading) return;
    setUploading(true); setProgress(0); setUploadResult(null); setUploadError('');

    try {
      const result = await api.uploadDocuments(notebookId, selectedFiles, token, setProgress);
      setUploadResult(result);
      setSelectedFiles([]);
      await fetchDocuments();
    } catch (err) {
      setUploadError(err.message || 'Upload thất bại, vui lòng thử lại.');
    } finally {
      setUploading(false); setProgress(0);
    }
  };

  // ── Delete doc ───────────────────────────────────────────────────────────
  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Xóa tài liệu này?')) return;
    try {
      await api.deleteDocument(docId, token);
      setDocuments(prev => prev.filter(d => d.doc_id !== docId));
    } catch {
      alert('Xóa thất bại!');
    }
  };

  const canResearch = documents.length > 0;

  return (
    <>
      <style>{STYLES}</style>

      <div className="nbp-page">
        {/* Header */}
        <header className="nbp-header">
          <Link to="/" className="nbp-back">← Notebooks</Link>
          <div className="nbp-divider" />
          <h1 className="nbp-title">{notebookName}</h1>
          <button
            className="nbp-research-btn"
            disabled={!canResearch}
            onClick={() => navigate(`/research/${notebookId}`)}
            title={canResearch ? 'Bắt đầu hỏi đáp' : 'Cần có ít nhất 1 tài liệu'}
          >
            ✦ Bắt đầu nghiên cứu
          </button>
        </header>

        <div className="nbp-content">

          {/* Upload section */}
          <div className="nbp-section">
            <h2 className="nbp-section-title">Thêm tài liệu</h2>

            {/* Drop zone */}
            <div
              className={`nbp-dropzone ${isDragging ? 'dragging' : ''} ${uploadError ? 'has-error' : ''}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileInput}
                disabled={uploading}
              />
              {uploading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 28, opacity: 0.5 }}>⏳</div>
                  <p style={{ fontSize: 13, color: '#c4a464', fontStyle: 'italic', fontFamily: "'Lora', Georgia, serif" }}>
                    Đang xử lý {selectedFiles.length} file...
                  </p>
                </div>
              ) : (
                <>
                  <div className="nbp-dropzone-icon">📄</div>
                  <p className="nbp-dropzone-text">
                    <span>Chọn file</span> hoặc kéo thả PDF vào đây
                  </p>
                  <p className="nbp-dropzone-hint">Hỗ trợ nhiều file · PDF · Tối đa 20MB/file</p>
                </>
              )}
            </div>

            {/* Progress */}
            {uploading && (
              <div className="nbp-progress-wrap">
                <div className="nbp-progress-bar" style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Selected files */}
            {selectedFiles.length > 0 && !uploading && (
              <div className="nbp-selected-files">
                {selectedFiles.map(f => (
                  <div key={f.name} className="nbp-file-chip">
                    <span style={{ fontSize: 15 }}>📄</span>
                    <span className="nbp-file-chip-name">{f.name}</span>
                    <span className="nbp-file-chip-size">{formatBytes(f.size)}</span>
                    <button className="nbp-file-chip-remove" onClick={() => removeFile(f.name)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Actions row */}
            {(selectedFiles.length > 0 || uploadError || uploadResult) && (
              <div className="nbp-upload-actions">
                <div className="nbp-upload-error">
                  {uploadError && <span>⚠ {uploadError}</span>}
                </div>
                {selectedFiles.length > 0 && !uploading && (
                  <button className="nbp-upload-btn" onClick={handleUpload}>
                    ↑ Upload {selectedFiles.length} file
                  </button>
                )}
              </div>
            )}

            {/* Upload result */}
            {uploadResult && (
              <div className={`nbp-upload-result ${uploadResult.failed?.length > 0 ? 'partial' : 'success'}`}>
                {uploadResult.failed?.length === 0
                  ? `✓ Upload thành công ${uploadResult.uploaded?.length} file.`
                  : `✓ ${uploadResult.uploaded?.length} file thành công · ✕ ${uploadResult.failed?.length} file thất bại`
                }
              </div>
            )}
          </div>

          {/* Documents section */}
          <div className="nbp-section">
            <div className="nbp-docs-header">
              <h2 className="nbp-section-title" style={{ margin: 0, flex: 1 }}>
                Tài liệu trong notebook
              </h2>
              {documents.length > 0 && (
                <span className="nbp-docs-count">{documents.length} file</span>
              )}
            </div>

            {loadingDocs ? (
              <div className="nbp-loading">
                <div className="nbp-spinner" /> Đang tải...
              </div>
            ) : documents.length === 0 ? (
              <div className="nbp-empty">
                <div className="nbp-empty-icon">📚</div>
                <p className="nbp-empty-text">Chưa có tài liệu nào.</p>
                <p className="nbp-empty-sub">Upload PDF ở trên để bắt đầu.</p>
              </div>
            ) : (
              documents.map(doc => (
                <div key={doc.doc_id} className="nbp-doc-item">
                  <div className="nbp-doc-icon">📄</div>
                  <div className="nbp-doc-info">
                    <p className="nbp-doc-name">{doc.filename}</p>
                    <div className="nbp-doc-tags">
                      {[
                        `${doc.page_count} trang`,
                        `${doc.chunk_count} chunks`,
                        new Date(doc.created_at).toLocaleDateString('vi-VN'),
                      ].map((tag, i) => (
                        <span key={i} className="nbp-doc-tag">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    className="nbp-doc-delete"
                    onClick={() => handleDeleteDoc(doc.doc_id)}
                    title="Xóa tài liệu"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>

        </div>
      </div>
    </>
  );
}