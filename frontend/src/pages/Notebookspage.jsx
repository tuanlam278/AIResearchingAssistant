import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0d0a; }

  .nb-page {
    min-height: 100vh;
    background: #0f0d0a;
    background-image: radial-gradient(ellipse 60% 50% at 50% 0%, rgba(196,164,100,0.06) 0%, transparent 60%);
    font-family: 'DM Sans', sans-serif;
    color: #d4cfc8;
    padding-bottom: 60px;
  }

  /* Content */
  .nb-content { max-width: 760px; margin: 0 auto; padding: 40px 24px 0; }

  .nb-header-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px;
  }
  .nb-heading {
    font-family: 'Lora', Georgia, serif;
    font-size: 22px; font-weight: 600; color: #e8e0d0;
  }
  .nb-heading-sub { font-size: 13px; color: #5a5040; margin-top: 4px; font-style: italic; }

  /* Create button */
  .nb-create-btn {
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(135deg, #c4a464, #8a6a30);
    border: none; border-radius: 10px;
    padding: 10px 18px;
    color: #1a1510; font-size: 13px; font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(196,164,100,0.25);
    transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
    white-space: nowrap;
  }
  .nb-create-btn:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(196,164,100,0.35); }
  .nb-error { border: 1px solid rgba(224,120,120,0.2); background: rgba(224,120,120,0.08); color: #e07878; border-radius: 10px; padding: 10px 12px; font-size: 12px; margin-bottom: 14px; }

  /* Modal */
  .nb-modal-overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    animation: fadeIn 0.2s ease;
  }
  .nb-modal {
    width: 100%; max-width: 420px;
    background: #1a1710;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 18px;
    padding: 32px;
    animation: slideUp 0.25s cubic-bezier(.22,1,.36,1);
  }
  .nb-modal-title {
    font-family: 'Lora', Georgia, serif;
    font-size: 18px; font-weight: 600;
    color: #e8e0d0; margin-bottom: 20px;
  }
  .nb-modal-input {
    width: 100%;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 10px; padding: 11px 14px;
    color: #d4cfc8; font-size: 14px;
    font-family: 'DM Sans', sans-serif;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    margin-bottom: 16px;
  }
  .nb-modal-input::placeholder { color: #3a3020; }
  .nb-modal-input:focus { border-color: rgba(196,164,100,0.4); box-shadow: 0 0 0 3px rgba(196,164,100,0.07); }
  .nb-modal-actions { display: flex; gap: 10px; }
  .nb-modal-cancel {
    flex: 1; padding: 10px; border-radius: 9px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    color: #8a8070; font-size: 13px; font-weight: 500;
    font-family: 'DM Sans', sans-serif;
    cursor: pointer; transition: background 0.2s;
  }
  .nb-modal-cancel:hover { background: rgba(255,255,255,0.07); }
  .nb-modal-confirm {
    flex: 1; padding: 10px; border-radius: 9px;
    background: linear-gradient(135deg, #c4a464, #8a6a30);
    border: none; color: #1a1510;
    font-size: 13px; font-weight: 600;
    font-family: 'DM Sans', sans-serif;
    cursor: pointer; transition: opacity 0.2s;
  }
  .nb-modal-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
  .nb-modal-confirm:not(:disabled):hover { opacity: 0.9; }

  /* Notebook cards */
  .nb-grid { display: flex; flex-direction: column; gap: 12px; }

  .nb-card {
    display: flex; align-items: center; gap: 16px;
    padding: 18px 20px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px; cursor: pointer;
    transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  }
  .nb-card:hover {
    border-color: rgba(196,164,100,0.3);
    background: rgba(196,164,100,0.04);
    box-shadow: 0 4px 24px rgba(0,0,0,0.25);
  }
  .nb-card-icon {
    width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
    background: rgba(196,164,100,0.1);
    border: 1px solid rgba(196,164,100,0.15);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
  }
  .nb-card-info { flex: 1; overflow: hidden; }
  .nb-card-name {
    font-family: 'Lora', Georgia, serif; font-weight: 600;
    font-size: 15px; color: #e8e0d0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    margin-bottom: 5px;
  }
  .nb-card-meta { font-size: 12px; color: #5a5040; }
  .nb-card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .nb-action-btn {
    width: 32px; height: 32px; border-radius: 8px; border: none;
    background: transparent; cursor: pointer; color: #4a4030;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; transition: color 0.2s, background 0.2s;
  }
  .nb-action-btn:hover { color: #c4a464; background: rgba(196,164,100,0.08); }
  .nb-action-btn.is-starred { color: #f3c85f; background: rgba(243,200,95,0.1); }
  .nb-delete-btn:hover { color: #e07878; background: rgba(200,80,80,0.08); }
  .nb-arrow { color: #3a3020; font-size: 18px; }

  /* Empty state */
  .nb-empty {
    text-align: center; padding: 60px 20px;
    border: 2px dashed rgba(255,255,255,0.06);
    border-radius: 16px;
  }
  .nb-empty-icon { font-size: 40px; opacity: 0.25; margin-bottom: 14px; }
  .nb-empty-title { font-family: 'Lora', Georgia, serif; font-size: 16px; color: #5a5040; margin-bottom: 6px; }
  .nb-empty-sub { font-size: 13px; color: #3a3020; }

  /* Loading */
  .nb-loading {
    display: flex; align-items: center; justify-content: center;
    gap: 10px; padding: 60px;
    color: #4a4030; font-family: 'Lora', Georgia, serif;
    font-style: italic; font-size: 13px;
  }
  .nb-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(196,164,100,0.15);
    border-top-color: #c4a464;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

export default function NotebooksPage() {
  const navigate = useNavigate();
  const rememberWorkspacePath = (path) => localStorage.setItem('researchWorkspace:lastPath', path);
  const { token, logoutContext } = useAuth();

  const [notebooks, setNotebooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pageError, setPageError] = useState('');

  const fetchNotebooks = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await api.getNotebooks(token);
      setNotebooks(result.notebooks ?? []);
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') logoutContext();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    rememberWorkspacePath('/notebook');
    fetchNotebooks();
  }, [token]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setPageError('');
    try {
      const result = await api.createNotebook(name, token);
      setShowModal(false);
      setNewName('');
      sessionStorage.setItem(`nb_name_${result.notebook_id}`, name); // ← thêm dòng này
      rememberWorkspacePath(`/notebooks/${result.notebook_id}`);
      navigate(`/notebooks/${result.notebook_id}`);
    } catch {
      setPageError('Tạo notebook thất bại, vui lòng thử lại.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, notebookId) => {
    e.stopPropagation();
    if (!window.confirm('Xóa notebook này sẽ xóa toàn bộ tài liệu bên trong. Tiếp tục?')) return;
    setPageError('');
    try {
      await api.deleteNotebook(notebookId, token);
      setNotebooks(prev => prev.filter(n => n.notebook_id !== notebookId));
    } catch {
      setPageError('Xóa notebook thất bại.');
    }
  };

  const toggleNotebookStar = async (e, nb) => {
    e.stopPropagation();
    const previous = Boolean(nb.is_starred);
    setNotebooks((prev) => prev.map((item) => (item.notebook_id === nb.notebook_id ? { ...item, is_starred: !previous } : item)));
    try {
      const result = await api.updateNotebook(nb.notebook_id, { is_starred: !previous }, token);
      if (result?.notebook) {
        setNotebooks((prev) => prev.map((item) => (item.notebook_id === nb.notebook_id ? result.notebook : item)));
      }
    } catch {
      setNotebooks((prev) => prev.map((item) => (item.notebook_id === nb.notebook_id ? nb : item)));
    }
  };

  const sortedNotebooks = [...notebooks].sort((a, b) => {
    if (Boolean(a.is_starred) !== Boolean(b.is_starred)) return a.is_starred ? -1 : 1;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  const openModal = () => { setNewName(''); setShowModal(true); };

  return (
    <>
      <style>{STYLES}</style>

      <div className="nb-page">
        {/* Content */}
        <div className="nb-content">
          <div className="nb-header-row">
            <div>
              <h1 className="nb-heading">Notebooks của bạn</h1>
              <p className="nb-heading-sub">Mỗi notebook chứa các tài liệu PDF để nghiên cứu cùng nhau</p>
            </div>
            <button className="nb-create-btn" onClick={openModal}>
              + Notebook mới
            </button>
          </div>

          {pageError && <div className="nb-error">⚠ {pageError}</div>}

          {loading ? (
            <div className="nb-loading">
              <div className="nb-spinner" />
              Đang tải...
            </div>
          ) : notebooks.length === 0 ? (
            <div className="nb-empty">
              <div className="nb-empty-icon">📓</div>
              <p className="nb-empty-title">Chưa có notebook nào.</p>
              <p className="nb-empty-sub">Nhấn "Notebook mới" để bắt đầu.</p>
            </div>
          ) : (
            <div className="nb-grid">
              {sortedNotebooks.map(nb => (
                <div
                  key={nb.notebook_id}
                  className="nb-card"
                  onClick={() => {
                    sessionStorage.setItem(`nb_name_${nb.notebook_id}`, nb.name); // ← thêm dòng này
                    rememberWorkspacePath(`/notebooks/${nb.notebook_id}`);
                    navigate(`/notebooks/${nb.notebook_id}`);
                  }}
                >
                  <div className="nb-card-icon">📓</div>
                  <div className="nb-card-info">
                    <p className="nb-card-name">{nb.name}</p>
                    <p className="nb-card-meta">
                      {new Date(nb.created_at).toLocaleDateString('vi-VN', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                      })}
                    </p>
                  </div>
                  <div className="nb-card-actions">
                    <button
                      className={`nb-action-btn ${nb.is_starred ? 'is-starred' : ''}`}
                      onClick={(e) => toggleNotebookStar(e, nb)}
                      aria-label={nb.is_starred ? 'Bỏ đánh dấu notebook quan trọng' : 'Đánh dấu notebook quan trọng'}
                      title={nb.is_starred ? 'Bỏ đánh dấu quan trọng' : 'Đánh dấu quan trọng'}
                    >
                      {nb.is_starred ? '★' : '☆'}
                    </button>
                    <button
                      className="nb-action-btn nb-delete-btn"
                      onClick={(e) => handleDelete(e, nb.notebook_id)}
                      title="Xóa notebook"
                    >
                      🗑
                    </button>
                    <span className="nb-arrow">›</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal tạo notebook */}
      {showModal && (
        <div className="nb-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="nb-modal" onClick={e => e.stopPropagation()}>
            <h2 className="nb-modal-title">Tạo notebook mới</h2>
            <input
              className="nb-modal-input"
              type="text"
              placeholder="Tên notebook, ví dụ: Transformer Papers"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
              maxLength={200}
            />
            <div className="nb-modal-actions">
              <button className="nb-modal-cancel" onClick={() => setShowModal(false)}>Hủy</button>
              <button
                className="nb-modal-confirm"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
              >
                {creating ? 'Đang tạo...' : 'Tạo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}