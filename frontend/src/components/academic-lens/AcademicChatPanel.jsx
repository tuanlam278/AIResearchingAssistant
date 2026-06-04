import { useState } from 'react';
import { AlertTriangle, BookOpen, Globe2, Image, NotebookPen, PlusCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import AcademicCitationBadge from './AcademicCitationBadge';

const QUICK_PROMPTS = ['Giải thích biểu đồ này', 'Trích xuất số liệu thành bảng', 'Chuyển công thức này sang LaTeX'];

export default function AcademicChatPanel({ activeTab, onTabChange, messages, onSend, onReset, pendingImage, onClearImage, onAddToNotepad, onAddToContext, onOpenContexts, onCitationSelect, onCollapse, sending, errors = {}, webConfigured = true }) {
  const [input, setInput] = useState('');
  const isWeb = activeTab === 'web';
  const submit = (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message && !pendingImage) return;
    onSend({ message: message || (pendingImage ? 'Hãy phân tích ảnh đã chụp.' : ''), tab: activeTab });
    setInput('');
  };

  const handleQuickPrompt = (prompt) => {
    setInput(prompt);
  };

  return (
    <aside className={`al-chat ${isWeb ? 'is-web' : ''}`}>
      <div className="al-chat-title"><strong>{isWeb ? 'Global Web Chat' : 'Document AI'}</strong><span>{isWeb ? 'Nguồn web độc lập, không dùng PDF.' : 'Hỏi đáp dựa trên tài liệu hiện tại.'}</span></div>
      <div className="al-chat-tabs">
        <button type="button" className={activeTab === 'document' ? 'active' : ''} onClick={() => onTabChange('document')}><Sparkles size={15} /> Document AI</button>
        <button type="button" className={activeTab === 'web' ? 'active' : ''} onClick={() => onTabChange('web')}><Globe2 size={15} /> Global Web Chat</button>
      </div>
      <div className="al-chat-tools">
        <span>{messages.length ? `${messages.length} tin nhắn` : 'Chưa có lịch sử chat'}</span>
        <div className="al-chat-tool-actions"><button type="button" onClick={onOpenContexts}><BookOpen size={14} /> Web context</button><button type="button" onClick={onReset} disabled={!messages.length || sending}><RotateCcw size={14} /> Xóa lịch sử</button><button type="button" onClick={onCollapse} title="Ẩn AI ChatBox"><X size={14} /> Ẩn</button></div>
      </div>
      {isWeb && <div className="al-web-note"><Globe2 size={14} /> {webConfigured ? 'Tìm kiếm Web độc lập (không dùng dữ liệu PDF). Câu trả lời thật cần citations/hyperlinks.' : 'Global Web Chat cần cấu hình Web Search API. UI không tạo kết quả giả.'}</div>}
      {errors.chat && <div className="al-feature-error"><AlertTriangle size={13} /> {errors.chat}</div>}
      <div className="al-chat-log app-scrollbar">
        {!messages.length ? <p className="al-muted">{isWeb ? 'Tìm kiếm Web độc lập (Không dùng dữ liệu PDF)...' : 'Hỏi AI dựa trên tài liệu đang đọc...'}</p> : messages.map((msg, index) => (
          <div key={index} className={`al-msg ${msg.role} ${msg.warning ? 'warning' : ''}`}>
            <p>{msg.content}</p>
            {msg.used_web_context && <span className="al-web-used"><Globe2 size={13} /> Câu trả lời có sử dụng ngữ cảnh web bổ sung.</span>}
            {Array.isArray(msg.citations) && msg.citations.length > 0 && (
              <div className="al-citations-row">{msg.citations.map((citation, citationIndex) => <AcademicCitationBadge key={`${citation.chunk_id || citationIndex}-${citationIndex}`} citation={citation} index={citationIndex} onSelect={onCitationSelect} />)}</div>
            )}
            {msg.warning && <span><AlertTriangle size={13} /> {msg.warning}</span>}
            {msg.role === 'assistant' && (
              <div className="al-msg-actions">
                <button type="button" onClick={() => onAddToNotepad(msg.content)}><NotebookPen size={13} /> Add to Notepad</button>
                {msg.mode === 'web' && <button type="button" onClick={() => onAddToContext(msg)} disabled={!msg.citations?.length}><PlusCircle size={13} /> Thêm vào Bối cảnh</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="al-chat-form" onSubmit={submit}>
        {pendingImage && (
          <div className={`al-image-draft ${pendingImage.error ? 'has-error' : ''}`}>
            {pendingImage.dataUrl ? <img src={pendingImage.dataUrl} alt="Vùng ảnh đã chụp" /> : <div className="al-image-placeholder"><Image size={18} /> Chưa có ảnh crop hợp lệ</div>}
            <button type="button" onClick={onClearImage} aria-label="Xóa ảnh chụp"><X size={14} /></button>
            {pendingImage.warning && <p>{pendingImage.warning}</p>}
            {pendingImage.error && <p className="al-image-error"><AlertTriangle size={13} /> {pendingImage.error}</p>}
            {pendingImage.dataUrl && <div>{QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => handleQuickPrompt(prompt)}>{prompt}</button>)}</div>}
          </div>
        )}
        <textarea className="app-scrollbar" rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder={isWeb ? 'Tìm kiếm Web độc lập (Không dùng dữ liệu PDF)...' : 'Hỏi AI dựa trên tài liệu đang đọc...'} />
        <button type="submit" disabled={sending || Boolean(pendingImage?.error) || (isWeb && !webConfigured)}><Send size={16} /> Gửi</button>
      </form>
    </aside>
  );
}
