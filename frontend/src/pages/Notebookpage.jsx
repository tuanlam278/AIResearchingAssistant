import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB || 50);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

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

  /* Summary panel */
  .nbp-summary-grid { display: grid; gap: 14px; }
  .nbp-summary-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
  .nbp-summary-kicker { font-size: 11px; color: #c4a464; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .nbp-summary-title { font-family: 'Lora', Georgia, serif; font-size: 18px; color: #e8e0d0; margin-bottom: 6px; }
  .nbp-summary-sub { font-size: 13px; color: #6a6050; line-height: 1.55; }
  .nbp-summary-status { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 99px; background: rgba(196,164,100,0.1); color: #c4a464; font-size: 12px; white-space: nowrap; }
  .nbp-summary-error { border: 1px solid rgba(224,120,120,0.2); color: #e07878; background: rgba(224,120,120,0.08); border-radius: 10px; padding: 10px 12px; font-size: 12px; }
  .nbp-overall-summary { background: rgba(196,164,100,0.06); border: 1px solid rgba(196,164,100,0.15); border-radius: 13px; padding: 14px; }
  .nbp-overall-summary p { color: #b8ad9c; font-size: 13px; line-height: 1.7; margin: 0; }
  .nbp-key-points { margin-top: 10px; display: grid; gap: 7px; }
  .nbp-key-point { color: #8a8070; font-size: 12px; line-height: 1.5; display: flex; gap: 8px; }
  .nbp-doc-summary-card { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.075); border-radius: 13px; padding: 14px; }
  .nbp-doc-summary-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .nbp-doc-summary-name { font-family: 'Lora', Georgia, serif; color: #d4cfc8; font-size: 14px; font-weight: 600; }
  .nbp-doc-status { font-size: 11px; border-radius: 99px; padding: 2px 8px; background: rgba(80,180,80,0.1); border: 1px solid rgba(80,180,80,0.18); color: #78c878; white-space: nowrap; }
  .nbp-doc-status.failed { color: #e07878; background: rgba(224,120,120,0.08); border-color: rgba(224,120,120,0.2); }
  .nbp-doc-summary-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 9px; }
  .nbp-doc-summary-tags span { font-size: 11px; color: #6a6050; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 99px; padding: 2px 8px; }
  .nbp-doc-summary-text { color: #8a8070; font-size: 12px; line-height: 1.65; margin: 0; }
  .nbp-suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .nbp-suggestion-chip { border: 1px solid rgba(196,164,100,0.18); background: rgba(196,164,100,0.08); color: #c4a464; border-radius: 999px; padding: 8px 11px; cursor: pointer; font-size: 12px; text-align: left; }
  .nbp-suggestion-chip:hover { background: rgba(196,164,100,0.14); border-color: rgba(196,164,100,0.35); }
  .nbp-summary-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }

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

  .nbp-content { max-width: 1160px; }
  .nbp-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
  .nbp-history-panel { position: sticky; top: 82px; }
  .nbp-history-list { display: grid; gap: 10px; }
  .nbp-history-item { width: 100%; text-align: left; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #d4cfc8; border-radius: 12px; padding: 12px; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
  .nbp-history-item:hover { border-color: rgba(196,164,100,0.35); background: rgba(196,164,100,0.07); }
  .nbp-history-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .nbp-history-title { display: block; flex: 1; font-size: 13px; line-height: 1.45; color: #e8e0d0; }
  .nbp-history-time { display: block; margin-top: 6px; color: #6a6050; font-size: 11px; }
  .nbp-history-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .nbp-icon-btn { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.035); color: #7a7060; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: color 0.2s, background 0.2s, border-color 0.2s, transform 0.15s; }
  .nbp-icon-btn:hover { color: #c4a464; border-color: rgba(196,164,100,0.3); background: rgba(196,164,100,0.08); transform: translateY(-1px); }
  .nbp-icon-btn.danger:hover { color: #e07878; border-color: rgba(224,120,120,0.35); background: rgba(224,120,120,0.1); }
  .nbp-star-btn.is-starred { color: #f3c85f; border-color: rgba(243,200,95,0.35); background: rgba(243,200,95,0.1); }
  .nbp-header-star { flex-shrink: 0; }
  .nbp-history-edit { display: flex; flex-direction: column; gap: 8px; }
  .nbp-history-edit input { width: 100%; border: 1px solid rgba(255,255,255,0.09); border-radius: 9px; background: rgba(15,13,10,0.55); color: #d4cfc8; padding: 8px 10px; font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none; }
  .nbp-history-edit-actions { display: flex; justify-content: flex-end; gap: 7px; }
  .nbp-mini-btn { border: none; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
  .nbp-mini-btn.cancel { background: rgba(255,255,255,0.06); color: #8a8070; }
  .nbp-mini-btn.save { background: linear-gradient(135deg, #c4a464, #8a6a30); color: #1a1510; font-weight: 700; }
  .nbp-mini-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .nbp-doc-select { width: 18px; height: 18px; accent-color: #c4a464; flex-shrink: 0; }
  .nbp-select-all { border: 1px solid rgba(196,164,100,0.2); background: rgba(196,164,100,0.08); color: #c4a464; border-radius: 999px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
  .nbp-selected-hint { margin-top: 10px; color: #8a8070; font-size: 12px; }
  @media (max-width: 960px) { .nbp-layout { grid-template-columns: 1fr; } .nbp-history-panel { position: static; } }

  @keyframes spin { to { transform: rotate(360deg); } }
`;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeFilename(name = '') {
  return name.trim().toLowerCase();
}


function DocumentSummaryPanel({ summary, loading, error, selectedDocumentIds, canStartResearch, onStartChat, onQuestionClick }) {
  const documents = summary?.documents || [];
  const suggestions = summary?.suggested_questions || [];
  const keyPoints = summary?.overall_key_points || [];
  const showOverall = documents.length >= 2 && Boolean(summary?.overall_summary);
  if (!loading && !error && documents.length === 0 && !summary?.overall_summary) return null;

  return (
    <div className="nbp-section">
      <div className="nbp-summary-head">
        <div>
          <div className="nbp-summary-kicker">AI đã đọc tài liệu của bạn</div>
          <h2 className="nbp-summary-title">Tổng quan tài liệu</h2>
          <p className="nbp-summary-sub">
            {documents.length > 0
              ? `${documents.length} tài liệu đã sẵn sàng để trò chuyện.`
              : 'Sau khi upload xong, tổng quan và câu hỏi gợi ý sẽ hiển thị tại đây.'}
          </p>
        </div>
        {loading && <span className="nbp-summary-status"><span className="nbp-spinner" /> Đang tạo tóm tắt...</span>}
      </div>

      {error && <div className="nbp-summary-error">⚠ {error}</div>}

      {showOverall && (
        <div className="nbp-overall-summary">
          <p>{summary.overall_summary}</p>
          {keyPoints.length > 0 && (
            <div className="nbp-key-points">
              {keyPoints.map((point, index) => (
                <div key={index} className="nbp-key-point"><span>•</span><span>{point}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {documents.length > 0 && (
        <div className="nbp-summary-grid" style={{ marginTop: 14 }}>
          {documents.map((doc) => {
            const docSummaryMatchesOverall = showOverall && doc.summary?.trim() && doc.summary.trim() === summary.overall_summary?.trim();
            return (
            <div key={doc.id || doc.doc_id || doc.filename} className="nbp-doc-summary-card">
              <div className="nbp-doc-summary-top">
                <div className="nbp-doc-summary-name">{doc.title || doc.filename}</div>
                <span className={`nbp-doc-status ${doc.status === 'failed' ? 'failed' : ''}`}>{doc.status || 'ready'}</span>
              </div>
              <div className="nbp-doc-summary-tags">
                <span>{doc.filename}</span>
                <span>{doc.page_count || 0} trang</span>
                <span>{doc.chunk_count || 0} chunks</span>
              </div>
{doc.summary && !docSummaryMatchesOverall && <p className="nbp-doc-summary-text">{doc.summary}</p>}
              {Array.isArray(doc.key_points) && doc.key_points.length > 0 && (
                <div className="nbp-key-points">
                  {doc.key_points.slice(0, 3).map((point, index) => (
                    <div key={index} className="nbp-key-point"><span>•</span><span>{point}</span></div>
                  ))}
                </div>
              )}
            </div>
          );})}
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          <h3 className="nbp-section-title" style={{ marginTop: 18 }}>Gợi ý câu hỏi</h3>
          <div className="nbp-suggestions">
            {suggestions.map((question, index) => (
              <button key={index} className="nbp-suggestion-chip" onClick={() => onQuestionClick(question)}>
                {question}
              </button>
            ))}
          </div>
        </>
      )}

      {documents.length > 0 && (
        <div className="nbp-summary-actions">
          <button className="nbp-research-btn" disabled={!canStartResearch} onClick={onStartChat}>✦ Bắt đầu trò chuyện ({selectedDocumentIds.length})</button>
        </div>
      )}
    </div>
  );
}

export default function NotebookPage() {
  const { notebookId } = useParams();
  const navigate = useNavigate();
  const { token, logoutContext } = useAuth();
  const fileInputRef = useRef(null);

  const [notebookName, setNotebookName] = useState('Notebook');
  const [notebookStarred, setNotebookStarred] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [summaryData, setSummaryData] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [researchSessions, setResearchSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');

  const fetchDocuments = async () => {
    if (!token) return;
    setLoadingDocs(true);
    try {
      const result = await api.getNotebookDocuments(notebookId, token);
      const nextDocuments = result.documents ?? [];
      const liveIds = new Set(nextDocuments.map((doc) => doc.doc_id));
      setDocuments(nextDocuments);
      setSelectedDocumentIds((prev) => prev.filter((id) => liveIds.has(id)));
      setSummaryData((prev) => {
        if (!prev) return prev;
        if (nextDocuments.length === 0) return null;
        return {
          ...prev,
          documents: (prev.documents || []).filter((doc) => liveIds.has(doc.doc_id || doc.id)),
        };
      });
      return nextDocuments;
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') { logoutContext(); return; }
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadDocumentSummary = async (documentIds = null, { generate = false } = {}) => {
    if (!token) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const result = generate
        ? await api.generateWorkspaceDocumentSummary(notebookId, documentIds, token)
        : await api.getWorkspaceDocumentSummary(notebookId, token);
      setSummaryData(result);
    } catch (err) {
      setSummaryError(err.message || 'Không thể tạo tổng quan tài liệu.');
      if (!summaryData && documents.length > 0) {
        setSummaryData({ documents, overall_summary: '', overall_key_points: [], suggested_questions: [] });
      }
    } finally {
      setSummaryLoading(false);
    }
  };

  const fetchResearchSessions = async () => {
    if (!token) return;
    setSessionsLoading(true);
    try {
      const result = await api.getResearchSessions(notebookId, token);
      setResearchSessions(result.sessions || []);
    } catch (err) {
      console.warn('Không thể tải lịch sử nghiên cứu', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const fetchNotebookMeta = async () => {
    if (!token) return;
    try {
      const result = await api.getNotebooks(token);
      const current = (result.notebooks || []).find((nb) => nb.notebook_id === notebookId);
      if (current) {
        setNotebookName(current.name || 'Notebook');
        setNotebookStarred(Boolean(current.is_starred));
        sessionStorage.setItem(`nb_name_${notebookId}`, current.name || 'Notebook');
      }
    } catch (err) {
      console.warn('Không thể tải metadata notebook', err);
    }
  };

  const goToChat = async (question = '') => {
    const validSelectedIds = selectedDocumentIds.filter((id) => documents.some((doc) => doc.doc_id === id));
    if (validSelectedIds.length === 0) {
      setUploadError('Vui lòng chọn ít nhất một tài liệu để nghiên cứu.');
      return;
    }
    try {
      const result = await api.createResearchSession(notebookId, validSelectedIds, token);
      const session = result.session;
      await fetchResearchSessions();
      navigate(`/research/${notebookId}`, {
        state: {
          prefillQuestion: question,
          suggestedQuestions: summaryData?.suggested_questions || [],
          researchSessionId: session.id,
          researchSession: session,
          selectedDocumentIds: validSelectedIds,
          selectedDocuments: documents.filter((doc) => validSelectedIds.includes(doc.doc_id)),
        },
      });
    } catch (err) {
      setUploadError(err.message || 'Không thể tạo phiên nghiên cứu.');
    }
  };

  const openResearchSession = (session) => {
    navigate(`/research/${notebookId}`, {
      state: {
        researchSessionId: session.id,
        researchSession: session,
        selectedDocumentIds: session.selected_document_ids || [],
        selectedDocuments: documents.filter((doc) => (session.selected_document_ids || []).includes(doc.doc_id)),
        suggestedQuestions: summaryData?.suggested_questions || [],
      },
    });
  };

  useEffect(() => {
    // Lấy tên notebook từ localStorage nếu có (được set ở NotebooksPage khi navigate)
    const saved = sessionStorage.getItem(`nb_name_${notebookId}`);
    if (saved) setNotebookName(saved);
    fetchNotebookMeta();
    fetchDocuments();
    loadDocumentSummary(null, { generate: false });
    fetchResearchSessions();
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
    const tooLarge = pdfs.filter(f => f.size > MAX_UPLOAD_BYTES);
    const validPdfs = pdfs.filter(f => f.size <= MAX_UPLOAD_BYTES);
    const existingNames = new Set(documents.map((doc) => normalizeFilename(doc.filename)));
    const messages = [];
    if (invalid > 0) messages.push(`${invalid} file không phải PDF đã bị bỏ qua.`);
    if (tooLarge.length > 0) messages.push(`${tooLarge.length} file vượt quá ${MAX_UPLOAD_MB}MB đã bị bỏ qua.`);
    if (messages.length > 0) setUploadError(messages.join(' '));

    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => normalizeFilename(f.name)));
      const added = validPdfs.filter(f => {
        const normalized = normalizeFilename(f.name);
        if (existingNames.has(normalized)) {
          messages.push('Tài liệu đã tồn tại trong notebook.');
          return false;
        }
        return !existing.has(normalized);
      });
      if (messages.length > 0) setUploadError(Array.from(new Set(messages)).join(' '));
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
      const uploadedIds = (result.uploaded || []).map(doc => doc.doc_id).filter(Boolean);
      const nextDocuments = await fetchDocuments();
      if (uploadedIds.length > 0) {
        setSelectedDocumentIds((prev) => Array.from(new Set([...prev, ...uploadedIds])));
        const readyIds = (nextDocuments || []).filter((doc) => (doc.status || 'ready') === 'ready').map((doc) => doc.doc_id);
        await loadDocumentSummary(readyIds, { generate: true });
      }
      if ((result.failed || []).length > 0) {
        setUploadError('Upload tài liệu thất bại.');
      }
    } catch (err) {
      setUploadError(err.message || 'Upload tài liệu thất bại.');
    } finally {
      setUploading(false); setProgress(0);
    }
  };

  // ── Delete doc ───────────────────────────────────────────────────────────
  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Xóa tài liệu này?')) return;
    try {
      await api.deleteDocument(docId, token);
      setSelectedDocumentIds(prev => prev.filter(id => id !== docId));
      setSummaryData(prev => prev ? {
        ...prev,
        documents: (prev.documents || []).filter(doc => (doc.doc_id || doc.id) !== docId),
        suggested_questions: [],
        overall_summary: '',
        overall_key_points: [],
      } : prev);
      const nextDocuments = await fetchDocuments();
      if (nextDocuments && nextDocuments.length > 0) {
        await loadDocumentSummary(nextDocuments.map(doc => doc.doc_id), { generate: true });
      } else {
        setSummaryData(null);
      }
      await fetchResearchSessions();
    } catch {
      setUploadError('Xóa tài liệu thất bại.');
    }
  };

  const readyDocuments = documents.filter((doc) => (doc.status || 'ready') === 'ready');
  const readyDocumentIds = new Set(readyDocuments.map((doc) => doc.doc_id));
  const canResearch = selectedDocumentIds.length > 0 && selectedDocumentIds.every((id) => readyDocumentIds.has(id));
  const allReadySelected = readyDocuments.length > 0 && readyDocuments.every((doc) => selectedDocumentIds.includes(doc.doc_id));
  const selectedDocumentNames = documents.filter((doc) => selectedDocumentIds.includes(doc.doc_id)).map((doc) => doc.filename);
  const readySummaryData = readyDocuments.length > 0 && summaryData
    ? {
      ...summaryData,
      documents: (summaryData.documents || []).filter((doc) => readyDocumentIds.has(doc.doc_id || doc.id)),
    }
    : null;
  const sortedResearchSessions = [...researchSessions].sort((a, b) => {
    if (Boolean(a.is_starred) !== Boolean(b.is_starred)) return a.is_starred ? -1 : 1;
    return new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0);
  });

  const toggleDocumentSelection = (docId) => {
    setSelectedDocumentIds((prev) => prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]);
  };

  const toggleSelectAll = () => {
    setSelectedDocumentIds(allReadySelected ? [] : readyDocuments.map((doc) => doc.doc_id));
  };


  const toggleNotebookStar = async () => {
    const previous = notebookStarred;
    setNotebookStarred(!previous);
    try {
      const result = await api.updateNotebook(notebookId, { is_starred: !previous }, token);
      setNotebookStarred(Boolean(result?.notebook?.is_starred));
    } catch (err) {
      setNotebookStarred(previous);
      setUploadError(err.message || 'Không thể cập nhật trạng thái ghim notebook.');
    }
  };

  const updateSessionInList = (updatedSession) => {
    setResearchSessions((prev) => prev.map((session) => (session.id === updatedSession.id ? updatedSession : session)));
  };

  const toggleSessionStar = async (e, session) => {
    e.stopPropagation();
    const previous = Boolean(session.is_starred);
    updateSessionInList({ ...session, is_starred: !previous });
    try {
      const result = await api.updateResearchSession(session.id, { is_starred: !previous }, token);
      if (result?.session) updateSessionInList(result.session);
    } catch (err) {
      updateSessionInList(session);
      setUploadError(err.message || 'Không thể cập nhật trạng thái ghim lịch sử.');
    }
  };

  const startEditSession = (e, session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setSessionTitleDraft(session.title || '');
  };

  const cancelEditSession = (e) => {
    e?.stopPropagation?.();
    setEditingSessionId(null);
    setSessionTitleDraft('');
  };

  const saveSessionTitle = async (e, session) => {
    e.stopPropagation();
    const title = sessionTitleDraft.trim();
    if (!title) {
      setUploadError('Tên lịch sử nghiên cứu không được để trống.');
      return;
    }
    try {
      const result = await api.updateResearchSession(session.id, { title }, token);
      if (result?.session) updateSessionInList(result.session);
      cancelEditSession(e);
    } catch (err) {
      setUploadError(err.message || 'Không thể đổi tên lịch sử nghiên cứu.');
    }
  };

  const deleteResearchSession = async (e, session) => {
    e.stopPropagation();
    if (!window.confirm('Bạn có chắc muốn xoá lịch sử nghiên cứu này không?')) return;
    try {
      await api.deleteResearchSession(session.id, token);
      setResearchSessions((prev) => prev.filter((item) => item.id !== session.id));
      if (editingSessionId === session.id) cancelEditSession(e);
    } catch (err) {
      setUploadError(err.message || 'Không thể xoá lịch sử nghiên cứu.');
    }
  };

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
            type="button"
            className={`nbp-icon-btn nbp-star-btn nbp-header-star ${notebookStarred ? 'is-starred' : ''}`}
            onClick={toggleNotebookStar}
            aria-label={notebookStarred ? 'Bỏ đánh dấu notebook quan trọng' : 'Đánh dấu notebook quan trọng'}
            title={notebookStarred ? 'Bỏ đánh dấu quan trọng' : 'Đánh dấu quan trọng'}
          >
            {notebookStarred ? '★' : '☆'}
          </button>
        </header>

        <div className="nbp-content">
          <div className="nbp-layout">
            <main>

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
                  <p className="nbp-dropzone-hint">Hỗ trợ nhiều file · PDF · Tối đa {MAX_UPLOAD_MB}MB/file</p>
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
                {uploadResult.failed?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                    {uploadResult.failed.map((file) => (
                      <span key={file.filename} style={{ color: '#e07878' }}>
                        {file.filename}: {file.message || file.error || 'Upload thất bại'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DocumentSummaryPanel
            summary={readySummaryData}
            loading={summaryLoading && readyDocuments.length > 0}
            error={summaryError}
            selectedDocumentIds={selectedDocumentIds}
            canStartResearch={canResearch}
            onStartChat={() => goToChat()}
            onQuestionClick={goToChat}
          />

          {/* Documents section */}
          <div className="nbp-section">
            <div className="nbp-docs-header">
              <h2 className="nbp-section-title" style={{ margin: 0, flex: 1 }}>
                Tài liệu trong notebook
              </h2>
              {documents.length > 0 && (
                <>
                  <button className="nbp-select-all" onClick={toggleSelectAll}>{allReadySelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button>
                  <span className="nbp-docs-count">{documents.length} file</span>
                </>
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
                  <input
                    type="checkbox"
                    className="nbp-doc-select"
                    checked={selectedDocumentIds.includes(doc.doc_id)}
                    onChange={() => toggleDocumentSelection(doc.doc_id)}
                    aria-label={`Chọn ${doc.filename} để nghiên cứu`}
                  />
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
            {documents.length > 0 && (
              <p className="nbp-selected-hint">Đã chọn {selectedDocumentIds.length} tài liệu: {selectedDocumentNames.join(', ') || 'chưa chọn tài liệu nào'}.</p>
            )}
          </div>
            </main>

            <aside className="nbp-section nbp-history-panel">
              <h2 className="nbp-section-title">Lịch sử nghiên cứu</h2>
              {sessionsLoading ? (
                <div className="nbp-loading"><div className="nbp-spinner" /> Đang tải...</div>
              ) : researchSessions.length === 0 ? (
                <div className="nbp-empty" style={{ padding: 20 }}>
                  <p className="nbp-empty-text">Chưa có cuộc nghiên cứu nào.</p>
                  <p className="nbp-empty-sub">Tick tài liệu rồi bấm “Bắt đầu nghiên cứu”.</p>
                </div>
              ) : (
                <div className="nbp-history-list">
                  {sortedResearchSessions.map((session) => (
                    <button key={session.id} className="nbp-history-item" onClick={() => openResearchSession(session)}>
                      {editingSessionId === session.id ? (
                        <span className="nbp-history-edit" onClick={(e) => e.stopPropagation()}>
                          <input
                            value={sessionTitleDraft}
                            onChange={(e) => setSessionTitleDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveSessionTitle(e, session);
                              if (e.key === 'Escape') cancelEditSession(e);
                            }}
                            autoFocus
                            maxLength={200}
                          />
                          <span className="nbp-history-edit-actions">
                            <button type="button" className="nbp-mini-btn cancel" onClick={cancelEditSession}>Huỷ</button>
                            <button type="button" className="nbp-mini-btn save" onClick={(e) => saveSessionTitle(e, session)} disabled={!sessionTitleDraft.trim()}>Lưu</button>
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="nbp-history-top">
                            <span className="nbp-history-title">{session.title}</span>
                            <span className="nbp-history-actions">
                              <span
                                role="button"
                                tabIndex={0}
                                className={`nbp-icon-btn nbp-star-btn ${session.is_starred ? 'is-starred' : ''}`}
                                onClick={(e) => toggleSessionStar(e, session)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSessionStar(e, session); }}
                                aria-label={session.is_starred ? 'Bỏ đánh dấu lịch sử quan trọng' : 'Đánh dấu lịch sử quan trọng'}
                                title={session.is_starred ? 'Bỏ đánh dấu quan trọng' : 'Đánh dấu quan trọng'}
                              >{session.is_starred ? '★' : '☆'}</span>
                              <span role="button" tabIndex={0} className="nbp-icon-btn" onClick={(e) => startEditSession(e, session)} aria-label="Sửa tên lịch sử" title="Sửa tên">✎</span>
                              <span role="button" tabIndex={0} className="nbp-icon-btn danger" onClick={(e) => deleteResearchSession(e, session)} aria-label="Xoá lịch sử nghiên cứu" title="Xoá lịch sử">🗑</span>
                            </span>
                          </span>
                          <span className="nbp-history-time">{new Date(session.updated_at || session.created_at).toLocaleString('vi-VN')}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </aside>
          </div>

        </div>
      </div>
    </>
  );
}