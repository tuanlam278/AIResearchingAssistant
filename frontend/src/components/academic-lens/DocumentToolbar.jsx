import { Camera, MessageSquareText, NotebookTabs, RotateCcw } from 'lucide-react';

export default function DocumentToolbar({ layoutMode = 'reading', notepadCollapsed = false, chatCollapsed = false, onToggleSnip, onOpenNotepad, onOpenChat, onLayoutModeChange, onResetLayout }) {
  return (
    <div className="al-toolbar">
      <div>
        <span className="al-eyebrow">Workspace tools</span>
        <h2>Chế độ đọc</h2>
      </div>
      <div className="al-toolbar-actions">
        <div className="al-mode-switcher" aria-label="Layout modes">
          {[
            ['reading', 'Đọc'],
            ['chat', 'Chat'],
            ['note', 'Ghi chú'],
          ].map(([mode, label]) => (
            <button key={mode} type="button" className={layoutMode === mode ? 'active' : ''} onClick={() => onLayoutModeChange?.(mode)} title={`Chuyển sang ${label} mode`}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={onToggleSnip}><Camera size={16} /> Chụp ảnh</button>
        {chatCollapsed && <button type="button" onClick={onOpenChat} title="Mở AI ChatBox"><MessageSquareText size={16} /> Mở Chat</button>}
        {notepadCollapsed && <button type="button" onClick={onOpenNotepad} title="Mở ghi chú"><NotebookTabs size={16} /> Mở ghi chú</button>}
        <button type="button" onClick={onResetLayout} title="Đặt lại bố cục"><RotateCcw size={16} /> Reset layout</button>
      </div>
    </div>
  );
}
