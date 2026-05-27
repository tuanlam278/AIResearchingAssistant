import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ─── DocumentUploader ─────────────────────────────────────────────────────────
function DocumentUploader({ onSuccess, token }) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const fileInputRef = { current: null };

  const handleDragOver = e => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = e => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = e => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = e => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
  };

  const processFile = async (file) => {
    if (!token) { setError('Vui lòng đăng nhập để upload tài liệu.'); return; }
    if (file.type !== 'application/pdf') { setError('Hệ thống chỉ chấp nhận file PDF.'); return; }
    setError(null); setLoading(true); setProgress(0);

    try {
      await api.uploadDocument(file, token, p => setProgress(p));
      setProgress(100);
      setTimeout(() => { setProgress(null); if (onSuccess) onSuccess(); }, 600);
    } catch (err) {
      if (err.message === 'FILE_TOO_LARGE') setError('Dung lượng file vượt quá 20MB.');
      else if (err.message === 'INVALID_FILE_TYPE') setError('Chỉ hỗ trợ định dạng PDF.');
      else if (err.message === 'UNAUTHORIZED') setError('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
      else setError('Có lỗi xảy ra khi xử lý tài liệu. Vui lòng thử lại.');
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div
        onClick={() => !loading && fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragging ? 'rgba(196,164,100,0.6)' : error ? 'rgba(200,80,80,0.3)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 14,
          padding: '28px 20px',
          textAlign: 'center',
          cursor: loading ? 'default' : 'pointer',
          background: isDragging ? 'rgba(196,164,100,0.05)' : error ? 'rgba(200,80,80,0.04)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.2s',
        }}
      >
        <input
          ref={r => fileInputRef.current = r}
          type="file" accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          disabled={loading}
        />

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28, opacity: 0.6 }}>⏳</div>
            <p style={{ fontSize: 13, color: '#c4a464', fontFamily: "'Lora', Georgia, serif", fontStyle: 'italic' }}>
              Đang xử lý tài liệu...
            </p>
            {progress !== null && (
              <div style={{ width: '100%', maxWidth: 200, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
                <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #c4a464, #8a6a30)', width: `${progress}%`, transition: 'width 0.3s' }} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 32, opacity: 0.4, marginBottom: 4 }}>📄</div>
            <p style={{ fontSize: 14, color: '#8a8070' }}>
              <span style={{ color: '#c4a464', fontWeight: 600 }}>Chọn file</span> hoặc kéo thả PDF vào đây
            </p>
            <p style={{ fontSize: 11, color: '#4a4030' }}>PDF · Tối đa 20MB</p>
          </div>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(200,80,80,0.08)', border: '1px solid rgba(200,80,80,0.15)',
          borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e07878',
        }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

// ─── DocumentList ─────────────────────────────────────────────────────────────
function DocumentList({ documents, onSelect, onDelete }) {
  if (!documents || documents.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '40px 20px',
        border: '2px dashed rgba(255,255,255,0.06)',
        borderRadius: 14, color: '#4a4030',
      }}>
        <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📚</div>
        <p style={{ fontFamily: "'Lora', Georgia, serif", fontStyle: 'italic', fontSize: 14, color: '#5a5040' }}>
          Chưa có tài liệu nào.
        </p>
        <p style={{ fontSize: 12, color: '#3a3020', marginTop: 4 }}>
          Upload PDF ở trên để bắt đầu.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {documents.map(doc => (
        <div
          key={doc.doc_id}
          onClick={() => onSelect(doc.doc_id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12, cursor: 'pointer',
            transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(196,164,100,0.3)';
            e.currentTarget.style.background = 'rgba(196,164,100,0.04)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          {/* Icon */}
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'rgba(196,164,100,0.1)',
            border: '1px solid rgba(196,164,100,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            📄
          </div>

          {/* Info */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <p style={{
              fontFamily: "'Lora', Georgia, serif", fontWeight: 600,
              fontSize: 14, color: '#e8e0d0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: 4,
            }}>
              {doc.filename}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                `${doc.page_count} trang`,
                `${doc.chunk_count} chunks`,
                new Date(doc.created_at).toLocaleDateString('vi-VN'),
              ].map((tag, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 99,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: '#6a6050',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onDelete(doc.doc_id); }}
              title="Xóa"
              style={{
                width: 32, height: 32, borderRadius: 8, border: 'none',
                background: 'transparent', cursor: 'pointer', color: '#4a4030',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, transition: 'color 0.2s, background 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#e07878'; e.currentTarget.style.background = 'rgba(200,80,80,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#4a4030'; e.currentTarget.style.background = 'transparent'; }}
            >
              🗑
            </button>
            <span style={{ color: '#3a3020', fontSize: 16 }}>›</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const { token, user, logoutContext } = useAuth();

  const fetchDocuments = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await api.getDocuments(token);
      setDocuments(result.documents ?? []);
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') logoutContext();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocuments(); }, [token]);

  const handleLogout = async () => {
    try { await api.logout(token); } catch {}
    logoutContext();
    navigate('/login');
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Chắc chắn muốn xóa tài liệu này?')) return;
    try {
      await api.deleteDocument(docId, token);
      setDocuments(prev => prev.filter(d => d.doc_id !== docId));
    } catch {
      alert('Xóa thất bại!');
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #0f0d0a; }

        .home-page {
          min-height: 100vh;
          background: #0f0d0a;
          background-image:
            radial-gradient(ellipse 60% 50% at 50% 0%, rgba(196,164,100,0.06) 0%, transparent 60%);
          font-family: 'DM Sans', sans-serif;
          color: #d4cfc8;
          padding: 0 0 60px;
        }

        /* Navbar */
        .home-nav {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 32px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(15,13,10,0.8);
          backdrop-filter: blur(12px);
          position: sticky; top: 0; z-index: 10;
        }
        .home-nav-logo {
          display: flex; align-items: center; gap: 10px;
        }
        .home-nav-icon {
          width: 34px; height: 34px; border-radius: 9px;
          background: linear-gradient(135deg, #c4a464, #8a6a30);
          display: flex; align-items: center; justify-content: center;
          font-size: 15px;
          box-shadow: 0 2px 10px rgba(196,164,100,0.25);
        }
        .home-nav-title {
          font-family: 'Lora', Georgia, serif;
          font-size: 17px; font-weight: 600; color: #e8e0d0;
        }
        .home-nav-right {
          display: flex; align-items: center; gap: 12px;
        }
        .home-nav-email {
          font-size: 12px; color: #5a5040;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          padding: 5px 12px; border-radius: 99px;
        }
        .home-logout-btn {
          display: flex; align-items: center; gap: 6px;
          background: none; border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px; padding: 6px 12px;
          color: #6a6050; font-size: 13px; cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: color 0.2s, border-color 0.2s, background 0.2s;
        }
        .home-logout-btn:hover {
          color: #e07878; border-color: rgba(200,80,80,0.2);
          background: rgba(200,80,80,0.06);
        }

        /* Content */
        .home-content {
          max-width: 720px; margin: 0 auto;
          padding: 40px 24px 0;
        }

        .home-section {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 20px;
        }

        .home-section-title {
          font-family: 'Lora', Georgia, serif;
          font-size: 15px; font-weight: 600;
          color: #9a9080; margin-bottom: 16px;
          display: flex; align-items: center; gap: 8px;
        }
        .home-section-title::after {
          content: '';
          flex: 1; height: 1px;
          background: rgba(255,255,255,0.06);
        }

        .home-docs-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .home-docs-count {
          font-size: 12px; padding: 3px 10px;
          background: rgba(196,164,100,0.1);
          border: 1px solid rgba(196,164,100,0.15);
          border-radius: 99px; color: #c4a464;
        }

        .home-loading {
          display: flex; align-items: center; justify-content: center;
          gap: 10px; padding: 40px;
          color: #4a4030; font-family: 'Lora', Georgia, serif;
          font-style: italic; font-size: 13px;
        }
        .home-spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(196,164,100,0.15);
          border-top-color: #c4a464;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="home-page">
        {/* Navbar */}
        <nav className="home-nav">
          <div className="home-nav-logo">
            <div className="home-nav-icon">✦</div>
            <span className="home-nav-title">AI Research</span>
          </div>
          <div className="home-nav-right">
            {user?.email && (
              <span className="home-nav-email">{user.email}</span>
            )}
            <button className="home-logout-btn" onClick={handleLogout}>
              ⎋ Đăng xuất
            </button>
          </div>
        </nav>

        {/* Content */}
        <div className="home-content">

          {/* Upload section */}
          <div className="home-section">
            <h2 className="home-section-title">Thêm tài liệu mới</h2>
            <DocumentUploader onSuccess={fetchDocuments} token={token} />
          </div>

          {/* Documents section */}
          <div className="home-section">
            <div className="home-docs-header">
              <h2 className="home-section-title" style={{ margin: 0, flex: 1 }}>
                Tài liệu của bạn
              </h2>
              {documents.length > 0 && (
                <span className="home-docs-count">{documents.length} file</span>
              )}
            </div>

            {loading ? (
              <div className="home-loading">
                <div className="home-spinner" />
                Đang tải danh sách...
              </div>
            ) : (
              <DocumentList
                documents={documents}
                onSelect={docId => navigate(`/research/${docId}`)}
                onDelete={handleDelete}
              />
            )}
          </div>

        </div>
      </div>
    </>
  );
}