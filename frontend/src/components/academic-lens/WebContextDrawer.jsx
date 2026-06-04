import { AlertTriangle, ExternalLink, Trash2, X } from 'lucide-react';

export default function WebContextDrawer({ open, contexts, loading, error, storage, onClose, onToggle, onDelete }) {
  if (!open) return null;
  return (
    <div className="al-context-backdrop" onClick={onClose}>
      <aside className="al-context-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="al-context-head">
          <div><strong>Web context</strong><span>Quản lý nguồn web bổ sung đang ảnh hưởng Document AI.</span></div>
          <button type="button" onClick={onClose}><X size={15} /> Đóng</button>
        </div>
        {storage === 'memory_fallback' && <div className="al-warning"><AlertTriangle size={15} /> Web context đang dùng memory fallback vì bảng database chưa sẵn sàng.</div>}
        {error && <div className="al-warning"><AlertTriangle size={15} /> {error}</div>}
        {loading ? <p className="al-muted">Đang tải web context…</p> : !contexts.length ? <p className="al-muted">Chưa có web context nào. Dùng Global Web Chat rồi chọn “Thêm vào Bối cảnh”.</p> : (
          <div className="al-context-list">
            {contexts.map((ctx) => (
              <article key={ctx.id || ctx.content?.slice(0, 40)} className={!ctx.enabled ? 'is-disabled' : ''}>
                <div className="al-context-title"><strong>{ctx.title || 'Web context'}</strong>{ctx.url && <a href={ctx.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a>}</div>
                <p>{ctx.content || ctx.snippet}</p>
                <small>{ctx.created_at ? new Date(ctx.created_at).toLocaleString() : 'Mới thêm'}</small>
                <div className="al-context-actions">
                  <label><input type="checkbox" checked={ctx.enabled !== false} onChange={(event) => onToggle(ctx, event.target.checked)} /> Bật cho Document AI</label>
                  <button type="button" onClick={() => onDelete(ctx)}><Trash2 size={13} /> Xóa</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
