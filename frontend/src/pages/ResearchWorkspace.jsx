import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB || 50);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.rtf";
const EXTENSIONS = new Set(["pdf", "docx", "doc", "txt", "md", "rtf"]);
const LEFT_COLLAPSED_KEY = "notebookWorkspaceLeftCollapsed";
const RIGHT_COLLAPSED_KEY = "notebookWorkspaceRightCollapsed";
const LEFT_WIDTH_KEY = "notebookWorkspaceLeftWidth";
const RIGHT_WIDTH_KEY = "notebookWorkspaceRightWidth";
const RIGHT_TAB_KEY = "notebookWorkspaceRightTab";
const LEFT_TAB_KEY = "notebookWorkspaceLeftTab";
const LAST_SESSION_KEY = "researchWorkspace:lastActiveSessionId";

const PROMPT_GROUPS = [
  { group: "Hiểu tài liệu", prompts: ["Tóm tắt ý chính của tài liệu đã chọn", "Liệt kê luận điểm chính kèm nguồn", "Giải thích thuật ngữ quan trọng"] },
  { group: "Phương pháp", prompts: ["Phân tích phương pháp nghiên cứu trong tài liệu", "Nêu giả định chính của phương pháp"] },
  { group: "Kết quả", prompts: ["Kết quả chính và bằng chứng hỗ trợ là gì?", "Kết quả nào quan trọng nhất?"] },
  { group: "Hạn chế", prompts: ["Nêu hạn chế và rủi ro diễn giải", "Nguồn nào cần kiểm chứng thêm?"] },
  { group: "So sánh", prompts: ["So sánh ngắn các tài liệu đang chọn trong phiên", "Các tài liệu bổ sung hoặc mâu thuẫn nhau ở đâu?"] },
  { group: "Viết lại / Outline", prompts: ["Tạo outline bài viết dựa trên nguồn đã chọn", "Viết lại câu trả lời thành văn phong học thuật"] },
];

function useStored(key, initial, parser = (value) => value) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key);
    if (raw == null) return initial;
    try { return parser(raw); } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, String(value)); }, [key, value]);
  return [value, setValue];
}

function normalizeDocument(doc = {}) {
  const id = String(doc.id || doc.doc_id || "");
  const rawStatus = doc.processing_status || doc.status || (doc.chunk_count ? "ready" : "uploaded");
  const status = rawStatus === "error" ? "failed" : rawStatus;
  const isReady = status === "ready" || doc.is_vector_ready === true || doc.status === "ready";
  return {
    ...doc,
    id,
    doc_id: id,
    filename: doc.filename || doc.title || "Tài liệu",
    file_type: doc.file_type || "file",
    processing_status: isReady ? "ready" : status,
    processing_error: doc.processing_error || doc.error || doc.message || null,
    is_vector_ready: isReady,
    chunk_count: Number(doc.chunk_count || 0),
    page_count: Number(doc.page_count || 0),
  };
}
function citationTitle(c = {}) { return String(c.document_title || c.filename || c.title || "").trim(); }
function citationSnippet(c = {}) { return String(c.snippet || c.summary || c.content || "").trim(); }
function citationPage(c = {}) {
  const start = c.page_start ?? c.page ?? c.page_number;
  const end = c.page_end;
  if (!start) return c.section || c.location || "Không rõ trang";
  return end && end !== start ? `Trang ${start}-${end}` : `Trang ${start}`;
}
function isValidCitation(c = {}) {
  return Boolean(citationTitle(c)) && Boolean(citationSnippet(c) || c.page_start || c.page || c.section || c.score != null || c.relevance != null);
}
function normalizeCitations(items = []) {
  return (Array.isArray(items) ? items : []).map((c, index) => ({
    ...c,
    citation_index: c.citation_index || c.index || index + 1,
    chunk_id: c.chunk_id || c.id || c.citation_id,
    document_id: c.document_id || c.doc_id,
    document_title: citationTitle(c),
    snippet: citationSnippet(c),
    page_start: c.page_start ?? c.page ?? c.page_number,
    page_end: c.page_end ?? c.page ?? c.page_number,
    score: c.score ?? c.relevance ?? c.confidence,
  })).filter(isValidCitation);
}
function scoreText(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "—";
  return n <= 1 ? `${Math.round(n * 100)}%` : `${Math.round(n)}%`;
}
function formatTime(value) {
  if (!value) return "Vừa cập nhật";
  try { return new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }); } catch { return "Vừa cập nhật"; }
}
function normalizeAnswerText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}
function noteTitle(content = "") {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").slice(0, 10).join(" ").slice(0, 90) : "Ghi chú mới";
}
function noteContentFromMessage(message, citations) {
  const sourceLines = normalizeCitations(citations).map((c) => `- [${c.citation_index}] ${citationTitle(c)} — ${citationPage(c)}${c.chunk_id ? ` — chunk ${c.chunk_id}` : ""}`);
  return `${message.content || ""}${sourceLines.length ? `\n\n## Nguồn\n${sourceLines.join("\n")}` : ""}`;
}
function noteIsStarred(note = {}) {
  return Boolean(note.is_starred ?? note.metadata?.is_starred);
}
function sortPinnedFirst(items = []) {
  return [...items].sort((a, b) => {
    if (Boolean(a.is_starred) !== Boolean(b.is_starred)) return a.is_starred ? -1 : 1;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
}
function buildFlashcardMarkdown(cards = []) {
  return cards.map((card, index) => `### Flashcard ${index + 1}\n\n**Front:** ${card.front || ""}\n\n**Back:** ${card.back || ""}`).join("\n\n---\n\n");
}
function buildQuizMarkdown(questions = [], title = "Quiz từ tài liệu") {
  return [`# ${title}`, ...questions.map((q, index) => `## Câu ${index + 1}: ${q.question || ""}\n\nĐáp án: ${q.answer || q.blank_answer || q.sample_answer || ""}\n\nGiải thích: ${q.explanation || ""}`)].join("\n\n");
}
function flashcardsFromNote(note) {
  const fromMetadata = note?.metadata?.flashcards;
  if (Array.isArray(fromMetadata)) return fromMetadata;
  try { const parsed = JSON.parse(note?.content || "[]"); return Array.isArray(parsed) ? parsed : (parsed.flashcards || []); } catch { return []; }
}
function quizFromNote(note) {
  const quiz = note?.metadata?.quiz || note?.metadata;
  if (Array.isArray(quiz?.questions)) return quiz.questions;
  try { const parsed = JSON.parse(note?.content || "{}"); return parsed.questions || []; } catch { return []; }
}
function buildDiagnostics(citations = [], diagnostics = null) {
  if (diagnostics) return diagnostics;
  const valid = normalizeCitations(citations);
  const scores = valid.map((c) => Number(c.score)).filter(Number.isFinite);
  return { top_score: scores.length ? Math.max(...scores) : null, chunks_used: valid.length, selected_document_ids_used: [...new Set(valid.map((c) => c.document_id).filter(Boolean))], retrieval_mode: "vector", is_out_of_scope: false, warning: null };
}
function contribution(citations = []) {
  const counts = new Map();
  normalizeCitations(citations).forEach((c) => {
    const key = c.document_id || citationTitle(c);
    if (!key) return;
    const item = counts.get(key) || { key, label: citationTitle(c), count: 0 };
    item.count += 1;
    counts.set(key, item);
  });
  const total = [...counts.values()].reduce((sum, item) => sum + item.count, 0);
  return [...counts.values()].sort((a, b) => b.count - a.count).map((item) => ({ ...item, percent: total ? Math.round((item.count / total) * 100) : 0 }));
}

function Styles() {
  return <style>{`
    .rw-page{height:100vh;min-height:720px;display:flex;flex-direction:column;overflow:hidden;background:#0f0d0a;color:#e8e0d0;font-family:'DM Sans',system-ui,sans-serif}.rw-topbar{height:58px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(15,13,10,.94)}.rw-title h1{font:600 18px Georgia,serif;margin:0}.rw-title p{margin:2px 0 0;color:#9a9080;font-size:12px}.rw-shell{flex:1;display:flex;min-height:0;overflow:hidden}.rw-panel{min-height:0;background:rgba(255,255,255,.025);border-right:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column}.rw-right{border-left:1px solid rgba(255,255,255,.07);border-right:0}.rw-center{flex:1;min-width:420px;display:flex;flex-direction:column;min-height:0;background:radial-gradient(circle at top,rgba(196,164,100,.05),transparent 42%)}.rw-chat-head{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;gap:10px}.rw-soft-btn,.rw-primary,.rw-danger,.rw-icon-btn{border:1px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(255,255,255,.045);color:#d4cfc8;padding:7px 10px;cursor:pointer;font-size:12px}.rw-primary{border:0;background:linear-gradient(135deg,#c4a464,#8a6a30);color:#19140d;font-weight:800}.rw-danger{color:#fecaca;border-color:rgba(248,113,113,.35)}.rw-soft-btn.is-starred{border-color:rgba(243,200,95,.55);background:linear-gradient(135deg,rgba(243,200,95,.24),rgba(196,164,100,.16));color:#ffe7a3;font-weight:800;box-shadow:0 0 0 1px rgba(243,200,95,.12) inset}.rw-icon-btn{width:34px;height:34px;padding:0;display:grid;place-items:center}.rw-tabs,.rw-left-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.07)}.rw-tab{flex:1;border:0;background:transparent;color:#9a9080;padding:11px 8px;cursor:pointer;border-bottom:2px solid transparent}.rw-tab.active{color:#f4d28a;border-bottom-color:#c4a464}.rw-resizer{width:6px;cursor:col-resize;flex-shrink:0}.rw-resizer:hover{background:rgba(196,164,100,.2)}.rw-reopen{width:42px;border-right:1px solid rgba(255,255,255,.07);display:flex;justify-content:center;padding-top:12px}.rw-right-reopen{border-left:1px solid rgba(255,255,255,.07);border-right:0}.rw-scroll{overflow:auto;min-height:0}.rw-chip{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);color:#a99f90;border-radius:999px;padding:5px 9px;font-size:12px;cursor:pointer}.rw-chip.active{border-color:rgba(196,164,100,.45);color:#f4d28a;background:rgba(196,164,100,.12)}.rw-warning{border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.1);color:#f8d18a;border-radius:10px;padding:8px 10px;font-size:12px}.rw-error{border:1px solid rgba(248,113,113,.35);background:rgba(248,113,113,.1);color:#fecaca;border-radius:10px;padding:8px 10px;font-size:12px}.rw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.rw-upload{border:1px dashed rgba(196,164,100,.35);border-radius:12px;padding:10px;text-align:center;cursor:pointer;background:rgba(196,164,100,.045)}.rw-doc-tools,.rw-quick-tools{padding:12px 14px;display:grid;gap:10px;border-bottom:1px solid rgba(255,255,255,.06)}.rw-doc-list{padding:12px;display:grid;gap:10px}.rw-study-card{display:grid;gap:12px}.rw-study-card .rw-primary{width:100%;justify-content:center;padding:11px 12px;margin-top:2px}.rw-doc,.rw-card{border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);padding:10px}.rw-session-card{cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease}.rw-card.rw-session-card:hover,.rw-card.rw-session-card:focus-visible{border-color:rgba(196,164,100,.35);background:rgba(196,164,100,.075);transform:translateY(-1px);outline:none}.rw-card.rw-session-card.active{border-color:rgba(196,164,100,.48);background:rgba(196,164,100,.105)}.rw-doc-top{display:flex;gap:8px;align-items:flex-start}.rw-doc-title,.rw-card-title{font-weight:800;font-size:13px;word-break:break-word}.rw-meta{display:flex;gap:8px;flex-wrap:wrap;color:#8d8274;font-size:11px;margin-top:5px}.rw-status-line{height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;margin-top:8px}.rw-status-fill{height:100%;background:linear-gradient(90deg,#8a6a30,#c4a464);border-radius:99px}.rw-chat-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.rw-session-name{font-weight:800}.rw-doc-pill{font-size:12px;color:#9a9080;margin-top:2px}.rw-mode-segment{display:flex;border:1px solid rgba(196,164,100,.28);border-radius:999px;overflow:hidden}.rw-mode-segment button{border:0;background:transparent;color:#9a9080;padding:7px 10px;cursor:pointer}.rw-mode-segment button.active{background:rgba(196,164,100,.18);color:#f4d28a}.rw-messages{flex:1;padding:18px;overflow:auto}.rw-empty{max-width:760px;margin:30px auto;text-align:center;color:#9a9080}.rw-prompts{margin-top:18px;text-align:left;display:grid;gap:10px}.rw-prompt-group{border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;background:rgba(255,255,255,.025)}.rw-prompt-title{font-size:12px;color:#f4d28a;margin-bottom:8px}.rw-prompt-buttons{display:flex;gap:8px;flex-wrap:wrap}.rw-message{display:flex;gap:10px;max-width:920px;margin:0 auto 14px}.rw-message.user{justify-content:flex-end}.rw-bubble{border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:12px 14px;max-width:min(760px,88%);background:rgba(255,255,255,.045);line-height:1.55}.rw-message.user .rw-bubble{background:rgba(196,164,100,.16);border-color:rgba(196,164,100,.24);color:#fff2d2}.rw-message-loading .rw-bubble{min-width:min(420px,82%);background:linear-gradient(135deg,rgba(255,255,255,.055),rgba(196,164,100,.045));border-color:rgba(196,164,100,.16)}.rw-loading-copy{margin:0 0 10px;color:#d9c89f;font-size:13px;font-weight:800}.rw-loading-lines{display:grid;gap:7px}.rw-loading-lines span{height:8px;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(196,164,100,.22),rgba(255,255,255,.06));background-size:220% 100%;animation:rwShimmer 1.15s ease-in-out infinite}.rw-loading-lines span:nth-child(2){width:78%}.rw-loading-lines span:nth-child(3){width:54%}@keyframes rwShimmer{0%{background-position:120% 0}100%{background-position:-120% 0}}.rw-avatar{width:30px;height:30px;border-radius:10px;background:rgba(196,164,100,.16);display:grid;place-items:center;color:#f4d28a;flex-shrink:0}.rw-bubble-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.rw-citation-btn{border:1px solid rgba(196,164,100,.35);background:rgba(196,164,100,.1);color:#f4d28a;border-radius:999px;padding:2px 8px;cursor:pointer;margin:0 2px}.rw-input-area{position:sticky;bottom:0;border-top:1px solid rgba(255,255,255,.08);background:rgba(15,13,10,.96);padding:12px 16px}.rw-textarea-wrap{display:flex;gap:10px;align-items:flex-end}.rw-textarea{flex:1;min-height:54px;max-height:180px;resize:vertical;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.045);color:#f4efe7;padding:12px;outline:none}.rw-hint,.rw-muted{margin:6px 0 0;color:#8d8274;font-size:11px}.rw-stage{color:#f4d28a;font-size:13px;margin:10px auto;max-width:920px}.rw-diagnostics,.rw-contribution{max-width:920px;margin:10px auto 14px;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;background:rgba(255,255,255,.025)}.rw-bars{display:grid;gap:6px;margin-top:8px}.rw-bar-row{display:grid;grid-template-columns:minmax(120px,1fr) 2fr 42px;gap:8px;align-items:center;font-size:12px}.rw-bar-track{height:8px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden}.rw-bar-fill{height:100%;background:linear-gradient(90deg,#c4a464,#f4d28a)}.rw-diag-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;color:#b8ad9d;font-size:12px}.rw-right-content{flex:1;overflow:auto;padding:12px}.rw-card{display:block;width:100%;text-align:left;color:inherit;cursor:pointer;margin-bottom:10px}.rw-snippet{font-size:12px;color:#cfc6b9;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.rw-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:80;display:flex;align-items:center;justify-content:center;padding:22px}.rw-modal{width:min(760px,100%);max-height:86vh;overflow:auto;background:#17130f;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px}.rw-modal h2{margin:0 0 8px}.rw-modal textarea,.rw-modal input{width:100%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);color:#f4efe7;border-radius:10px;padding:9px}.rw-mobile-tabs{display:none}.rw-toast{position:fixed;right:18px;bottom:18px;z-index:90;border-radius:12px;padding:12px 14px;background:#1f1a14;border:1px solid rgba(255,255,255,.12)}.rw-toast.success{color:#bbf7d0;border-color:rgba(74,222,128,.4)}.rw-toast.error{color:#fecaca;border-color:rgba(248,113,113,.45)}.rw-md p{margin:.35rem 0}.rw-md ul,.rw-md ol{padding-left:1.2rem}.rw-md code{background:rgba(255,255,255,.08);padding:1px 4px;border-radius:4px}.rw-md a{color:#f4d28a}button:disabled{opacity:.45;cursor:not-allowed}.rw-soft-btn{background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.025));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}.rw-soft-btn:hover,.rw-icon-btn:hover{border-color:rgba(196,164,100,.35);color:#f4d28a;background:rgba(196,164,100,.09)}.rw-danger:hover{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.55)}.rw-tab{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}.rw-tab:hover{color:#ead9b0;background:rgba(196,164,100,.055)}.rw-card:hover,.rw-doc:hover{border-color:rgba(196,164,100,.22);background:rgba(196,164,100,.045)}.rw-citation-wrap{position:relative;display:inline-flex}.rw-citation-popover{position:absolute;left:0;bottom:calc(100% + 8px);width:min(280px,80vw);z-index:20;border:1px solid rgba(196,164,100,.35);border-radius:12px;background:#1b160f;box-shadow:0 12px 32px rgba(0,0,0,.38);padding:10px;color:#e8e0d0;font-size:12px;line-height:1.45}.rw-star-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(243,200,95,.42);border-radius:999px;padding:4px 8px;background:rgba(243,200,95,.12);color:#f6d56f;font-size:11px;font-weight:700}.rw-range-row{display:grid;gap:10px;margin:4px 0 8px}.rw-range-row strong{color:#f4d28a}.rw-range-row input{width:100%;accent-color:#c4a464}.rw-range-row input[type="range"]{-webkit-appearance:none;height:8px;border-radius:999px;background:linear-gradient(90deg,#c4a464,#5f4a24);outline:none}.rw-range-row input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#f4d28a;border:2px solid #2a2117;box-shadow:0 0 0 4px rgba(196,164,100,.16);cursor:pointer}.rw-range-row input[type="range"]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#f4d28a;border:2px solid #2a2117;box-shadow:0 0 0 4px rgba(196,164,100,.16);cursor:pointer}.rw-flashcard-stage{text-align:center}.rw-flashcard-card{min-height:220px;border:1px solid rgba(196,164,100,.28);border-radius:18px;background:linear-gradient(145deg,rgba(196,164,100,.13),rgba(255,255,255,.035));display:grid;place-items:center;padding:24px;cursor:pointer;transition:transform .18s,background .18s}.rw-flashcard-card:hover{transform:translateY(-2px)}.rw-flashcard-card.back{background:linear-gradient(145deg,rgba(94,165,196,.14),rgba(255,255,255,.035))}.rw-flashcard-card p{font-size:18px;line-height:1.6}.rw-quiz-choice{width:100%;display:flex;gap:10px;text-align:left;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035);color:#e8e0d0;padding:10px;cursor:pointer;margin-top:8px}.rw-quiz-choice.selected{border-color:rgba(196,164,100,.5);background:rgba(196,164,100,.1)}.rw-quiz-choice.correct{border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.1)}.rw-quiz-choice.wrong{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.1)}.rw-quiz-feedback{margin-top:12px;border:1px solid rgba(196,164,100,.18);border-radius:12px;padding:10px;background:rgba(255,255,255,.035)}
    @media(max-width:900px){.rw-page{height:auto;min-height:100vh;overflow:auto}.rw-topbar{height:auto;padding:12px;align-items:flex-start;flex-direction:column}.rw-shell{display:block;overflow:visible}.rw-panel,.rw-center{width:100%!important;min-width:0;display:none;height:calc(100vh - 132px)}.rw-panel.mobile-active,.rw-center.mobile-active{display:flex}.rw-resizer,.rw-reopen{display:none}.rw-mobile-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);background:#14110d}.rw-mobile-tabs button{flex:1;border:0;background:transparent;color:#9a9080;padding:11px 4px}.rw-mobile-tabs button.active{color:#f4d28a;border-bottom:2px solid #c4a464}.rw-bar-row,.rw-diag-grid{grid-template-columns:1fr}.rw-chat-actions{justify-content:flex-start}}
  `}</style>;
}

function Modal({ title, children, onClose }) {
  if (!children) return null;
  return <div className="rw-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
    <div className="rw-modal rw-scroll" onClick={(event) => event.stopPropagation()}>
      <div className="rw-row" style={{ justifyContent: "space-between", marginBottom: 10 }}><h2>{title}</h2><button className="rw-icon-btn" type="button" aria-label="Đóng" onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>;
}

function LibraryLinkModal({ open, query, onQuery, results, loading, onSearch, onLink, onClose }) {
  if (!open) return null;
  return <Modal title="Link tài liệu từ Thư viện cộng đồng" onClose={onClose}>
    <p className="rw-muted">Tìm tài liệu đã được duyệt/vector-ready trong thư viện, sau đó link vào notebook hiện tại.</p>
    <div className="rw-row" style={{ margin: "12px 0" }}><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Nhập tên tài liệu, tác giả, tag..." onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }} /><button className="rw-primary" type="button" onClick={onSearch} disabled={loading}>{loading ? "Đang tìm" : "Tìm"}</button></div>
    {results.length === 0 && <div className="rw-warning">Chưa có kết quả. Hãy nhập từ khóa rồi bấm Tìm.</div>}
    {results.map((doc) => <div className="rw-card" key={doc.id || doc.document_id}><div className="rw-row" style={{ justifyContent: "space-between" }}><div><div className="rw-card-title">{doc.title || doc.filename}</div><div className="rw-meta"><span>{doc.authors || doc.uploader_name || "Thư viện"}</span><span>{doc.page_count || 0} trang</span><span>{doc.is_vector_ready ? "Vector ready" : "Chưa ready"}</span></div></div><button className="rw-primary" type="button" disabled={!doc.is_vector_ready} onClick={() => onLink(doc.id || doc.document_id)}>Link</button></div><p className="rw-snippet">{doc.description || doc.abstract || doc.summary || "Không có mô tả."}</p></div>)}
  </Modal>;
}

function DocumentsPanel({ documents, selectedDocumentIds, onToggleDocument, onSelectAllReady, onCreateSession, onUpload, uploadProgress, uploadError, onDismissUploadError, loadingDocuments, leftTab, onLeftTab, onPrompt, onGenerateFlashcards, onGenerateQuiz, quickLoading, onOpenLibrary, onDeleteDocument, flashcardCount, onFlashcardCount, quizCount, onQuizCount }) {
  const fileInputRef = useRef(null);
  const [showMorePrompts, setShowMorePrompts] = useState(false);
  const visibleGroups = showMorePrompts ? PROMPT_GROUPS : PROMPT_GROUPS.slice(0, 3);
  return <>
    <div className="rw-left-tabs"><button className={`rw-tab ${leftTab === "documents" ? "active" : ""}`} type="button" onClick={() => onLeftTab("documents")}>Tài liệu</button><button className={`rw-tab ${leftTab === "quick" ? "active" : ""}`} type="button" onClick={() => onLeftTab("quick")}>Tính năng nhanh</button></div>
    {leftTab === "documents" ? <>
      <div className="rw-doc-tools">
        <label className="rw-upload" title="Upload thêm tài liệu vào notebook"><input ref={fileInputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => onUpload?.([...e.target.files])} /><strong>＋ Tải tài liệu</strong><br/><small>PDF, DOCX, TXT, MD · tối đa {MAX_UPLOAD_MB}MB/file</small></label>
        {uploadProgress > 0 && uploadProgress < 100 && <div><div className="rw-status-line"><div className="rw-status-fill" style={{ width: `${uploadProgress}%` }} /></div><div className="rw-meta"><span>Đang upload {uploadProgress}%</span></div></div>}
        {uploadError && <div className="rw-error"><div className="rw-row" style={{ justifyContent: "space-between" }}><span>⚠ {uploadError}</span><button className="rw-icon-btn" type="button" aria-label="Tắt thông báo lỗi upload" onClick={onDismissUploadError}>×</button></div></div>}
        <button type="button" className="rw-soft-btn" title="Tìm và link tài liệu từ Thư viện cộng đồng" onClick={onOpenLibrary}>Link từ Thư viện cộng đồng</button>
        <div className="rw-row"><button className="rw-soft-btn" type="button" title="Chọn toàn bộ tài liệu sẵn sàng" onClick={onSelectAllReady}>Chọn tất cả</button><button type="button" className="rw-primary" disabled={!selectedDocumentIds.length} title="Tạo phiên nghiên cứu mới từ tài liệu đã chọn" onClick={onCreateSession}>Tạo phiên mới từ {selectedDocumentIds.length} tài liệu</button></div>
      </div>
      <div className="rw-doc-list rw-scroll">
        {loadingDocuments && <div className="rw-warning">Đang tải tài liệu...</div>}
        {!loadingDocuments && documents.length === 0 && <div className="rw-warning">Notebook chưa có tài liệu. Hãy tải lên hoặc link từ thư viện.</div>}
        {documents.map((doc) => {
          const ready = doc.processing_status === "ready";
          const failed = doc.processing_status === "failed";
          const stepIndex = Math.max(1, ["uploaded", "parsing", "chunking", "embedding", "ready"].indexOf(doc.processing_status) + 1);
          const percent = ready ? 100 : failed ? 100 : Math.round((stepIndex / 5) * 100);
          return <div key={doc.id} className="rw-doc">
            <div className="rw-doc-top"><input type="checkbox" checked={selectedDocumentIds.includes(doc.id)} disabled={!ready} onChange={() => onToggleDocument(doc.id)} aria-label={`Chọn tài liệu ${doc.filename}`} title={ready ? "Cập nhật ngay tài liệu tham chiếu của phiên hiện tại" : "Tài liệu chưa sẵn sàng"} /><div style={{ flex: 1 }}><div className="rw-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}><div className="rw-doc-title">{doc.filename}</div><button className="rw-icon-btn rw-danger" type="button" aria-label={`Xóa tài liệu ${doc.filename}`} title="Xóa tài liệu khỏi notebook" onClick={() => onDeleteDocument(doc)}>🗑</button></div><div className="rw-meta"><span>{doc.file_type}</span><span>{doc.page_count} trang</span><span>{doc.chunk_count} chunks</span><span>{doc.is_vector_ready ? "Vector ready" : "Vector chưa sẵn sàng"}</span></div></div></div>
            <div className="rw-status-line"><div className="rw-status-fill" style={{ width: `${percent}%`, background: failed ? "#d86b5e" : undefined }} /></div>
            <div className="rw-meta"><span>{ready ? "Sẵn sàng cho RAG" : failed ? "Xử lý lỗi" : "Đang xử lý tài liệu"}</span></div>
            {failed && <div className="rw-error" style={{ marginTop: 8 }}>Lỗi xử lý: {doc.processing_error || "Không rõ lý do"}</div>}
          </div>;
        })}
      </div>
    </> : <div className="rw-quick-tools rw-scroll">
      <p className="rw-muted">Các action dưới đây chỉ chạy khi bạn bấm. Prompt nhanh sẽ điền vào ô chat, không tự gọi AI.</p>
      {visibleGroups.map((group) => <div className="rw-prompt-group" key={group.group}><div className="rw-prompt-title">{group.group}</div><div className="rw-prompt-buttons">{group.prompts.map((prompt) => <button className="rw-chip" type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}</button>)}</div></div>)}
      <button className="rw-soft-btn" type="button" onClick={() => setShowMorePrompts(!showMorePrompts)}>{showMorePrompts ? "Thu gọn prompt" : "Xem thêm prompt"}</button>
      <div className="rw-card rw-study-card"><div className="rw-card-title">Flashcard</div><p className="rw-muted">Chọn số lượng 1–5, sau đó tạo bộ flashcard có thể lật Front/Back.</p><label className="rw-range-row">Số flashcards: <strong>{flashcardCount}/5</strong><input type="range" min="1" max="5" value={flashcardCount} onChange={(e) => onFlashcardCount(Number(e.target.value))} /></label><button className="rw-primary" type="button" disabled={quickLoading} onClick={onGenerateFlashcards}>{quickLoading ? "Đang tạo..." : "Tạo flashcard"}</button></div>
      <div className="rw-card rw-study-card"><div className="rw-card-title">Quiz</div><p className="rw-muted">Chọn số lượng 1–5, làm quiz A/B/C/D và xem giải thích ngay dưới đáp án.</p><label className="rw-range-row">Số câu hỏi: <strong>{quizCount}/5</strong><input type="range" min="1" max="5" value={quizCount} onChange={(e) => onQuizCount(Number(e.target.value))} /></label><button className="rw-primary" type="button" disabled={quickLoading} onClick={onGenerateQuiz}>{quickLoading ? "Đang tạo..." : "Tạo quiz"}</button></div>
    </div>}
  </>;
}

function CitationBadge({ citation, children, onCitationClick }) {
  const [hovered, setHovered] = useState(false);
  return <span className="rw-citation-wrap" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <button type="button" className="rw-citation-btn" aria-label={`Xem nguồn trích dẫn ${citation.citation_index}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onCitationClick?.(citation); }}>{children}</button>
    {hovered && <span className="rw-citation-popover" role="tooltip"><strong>{citationTitle(citation)}</strong><br/><span>{citationPage(citation)} · Score {scoreText(citation.score)}</span>{citation.snippet && <><br/><span>{citation.snippet.slice(0, 180)}</span></>}</span>}
  </span>;
}

function MarkdownWithCitations({ content, citations, onCitationClick }) {
  const map = useMemo(() => new Map(normalizeCitations(citations).map((c) => [String(c.citation_index), c])), [citations]);
  const markdown = String(content || "").replace(/\[(\d+)\]/g, (_, index) => `[${index}](citation:${index})`);
  return <ReactMarkdown className="rw-md" skipHtml components={{ a: ({ href = "", children }) => {
    if (href.startsWith("citation:")) {
      const key = href.replace("citation:", "");
      const citation = map.get(key);
      if (!citation) return <span>{children}</span>;
      return <CitationBadge citation={citation} onCitationClick={onCitationClick}>{children}</CitationBadge>;
    }
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  } }}>{markdown}</ReactMarkdown>;
}

function ContributionDiagnostics({ citations, diagnostics }) {
  const items = contribution(citations);
  const diag = buildDiagnostics(citations, diagnostics);
  return <><div className="rw-contribution"><strong>Đóng góp tài liệu</strong>{items.length ? <><p className="rw-muted">Dựa nhiều nhất vào: <strong>{items[0].label}</strong></p><div className="rw-bars">{items.map((item) => <div className="rw-bar-row" key={item.key}><span>{item.label}</span><div className="rw-bar-track"><div className="rw-bar-fill" style={{ width: `${item.percent}%` }} /></div><strong>{item.percent}%</strong></div>)}</div></> : <p className="rw-muted">Chưa có nguồn đủ metadata.</p>}</div><div className="rw-diagnostics"><strong>Chẩn đoán truy xuất</strong><div className="rw-diag-grid"><span>Điểm cao nhất: {scoreText(diag.top_score)}</span><span>Chunks dùng: {diag.chunks_used ?? 0}</span><span>Tài liệu dùng: {(diag.selected_document_ids_used || []).length}</span><span>Chế độ: {diag.retrieval_mode || "vector"}</span></div>{(diag.warning || diag.is_out_of_scope) && <div className="rw-warning" style={{ marginTop: 8 }}>⚠ {diag.warning || "Độ liên quan thấp, cần kiểm chứng nguồn."}</div>}</div></>;
}

function ChatPanel({ messages, input, onInput, onSubmit, loading, loadingLabel, historyLoading, selectedDocuments, session, onClear, onExport, onRegenerate, onCopy, onSaveNote, savedMessageIds, savingNoteId, onShowSources, diagnostics, mode, onModeChange, onPrompt, showAllPrompts, setShowAllPrompts }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, historyLoading]);
  const visibleGroups = showAllPrompts ? PROMPT_GROUPS : PROMPT_GROUPS.slice(0, 3);
  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } };
  return <><div className="rw-chat-head"><div><div className="rw-session-name">Đang ở phiên: {session?.title || "Chưa chọn phiên"}</div><div className="rw-doc-pill">Tài liệu tham chiếu: {selectedDocuments.length ? selectedDocuments.map((d) => d.filename).join(", ") : "Chưa chọn"}</div></div><div className="rw-chat-actions"><div className="rw-mode-segment" aria-label="Chế độ truy xuất"><button className={mode === "strict" ? "active" : ""} type="button" title="Chỉ trả lời khi nguồn đủ liên quan" onClick={() => onModeChange("strict")}>Chặt chẽ</button><button className={mode === "exploratory" ? "active" : ""} type="button" title="Cho phép trả lời rộng hơn kèm cảnh báo" onClick={() => onModeChange("exploratory")}>Khám phá</button></div><button className="rw-soft-btn" type="button" onClick={onExport} disabled={!session?.id}>Export</button><button className="rw-soft-btn" type="button" onClick={onClear} disabled={!session?.id || loading || historyLoading}>Xóa chat</button></div></div><div className="rw-messages rw-scroll">
    {!historyLoading && messages.length === 0 && <div className="rw-empty"><h2>Research Workspace</h2><p>Chọn tài liệu, mở/tạo phiên, rồi đặt câu hỏi. Prompt nhanh chỉ điền vào input khi bấm.</p><div className="rw-prompts">{visibleGroups.map((group) => <div className="rw-prompt-group" key={group.group}><div className="rw-prompt-title">{group.group}</div><div className="rw-prompt-buttons">{group.prompts.slice(0, showAllPrompts ? 3 : 1).map((prompt) => <button className="rw-chip" type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}</button>)}</div></div>)}<button className="rw-soft-btn" type="button" onClick={() => setShowAllPrompts(!showAllPrompts)}>{showAllPrompts ? "Thu gọn" : "Xem thêm"}</button></div></div>}
    {messages.map((msg, index) => { const citations = normalizeCitations(msg.citations); const isAssistant = msg.role === "assistant"; const id = msg.id || `${msg.role}-${index}`; return <div className={`rw-message ${msg.role}`} key={id}>{isAssistant && <div className="rw-avatar">✦</div>}<div className="rw-bubble">{msg.warning && <div className="rw-warning">⚠ {msg.warning}</div>}{isAssistant ? <MarkdownWithCitations content={msg.content} citations={citations} onCitationClick={onShowSources} /> : <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>}{isAssistant && !msg.streaming && <div className="rw-bubble-actions"><button className="rw-soft-btn" type="button" disabled={savedMessageIds.has(id) || savingNoteId === id} onClick={() => onSaveNote(msg)}>{savedMessageIds.has(id) ? "Đã lưu" : "Lưu note"}</button><button className="rw-soft-btn" type="button" onClick={() => onCopy(msg)}>Copy</button><button className="rw-soft-btn" type="button" disabled={!citations.length} onClick={() => onShowSources(citations[0])}>Nguồn</button><button className="rw-soft-btn" type="button" onClick={() => onRegenerate(index)}>Tạo lại</button></div>}{isAssistant && citations.length > 0 && index === messages.length - 1 && <ContributionDiagnostics citations={citations} diagnostics={msg.retrieval_diagnostics || diagnostics} />}</div></div>; })}
    {historyLoading && <div className="rw-message assistant rw-message-loading" role="status" aria-live="polite"><div className="rw-avatar">✦</div><div className="rw-bubble"><p className="rw-loading-copy">Đang tải lịch sử trò chuyện cũ…</p><div className="rw-loading-lines" aria-hidden="true"><span /><span /><span /></div></div></div>}
    {loading && <div className="rw-stage">● {loadingLabel || "Đang truy xuất nguồn..."}</div>}<div ref={bottomRef} /></div><div className="rw-input-area"><div className="rw-textarea-wrap"><textarea className="rw-textarea rw-scroll" value={input} onChange={(e) => onInput(e.target.value)} onKeyDown={handleKey} placeholder="Đặt câu hỏi về tài liệu..." disabled={loading || historyLoading} maxLength={1000} /><button className="rw-primary" type="button" onClick={onSubmit} disabled={!input.trim() || loading || historyLoading}>{historyLoading ? "Đang tải" : loading ? "Đang gửi" : "Gửi"}</button></div><p className="rw-hint">Enter gửi · Shift+Enter xuống dòng · đổi tab/panel không gọi AI.</p></div></>;
}

function SourcesPanel({ citations, invalidCount, diagnostics }) {
  const [detail, setDetail] = useState(null);
  const valid = normalizeCitations(citations);
  return <div className="rw-right-content rw-scroll">{invalidCount > 0 && <div className="rw-warning">{invalidCount} nguồn thiếu metadata nên không render badge.</div>}{!valid.length && <div className="rw-warning">Chưa có citations đủ metadata từ câu trả lời hiện tại.</div>}{valid.map((c) => <button type="button" className="rw-card" key={`${c.citation_index}-${c.chunk_id || c.document_title}`} onClick={() => setDetail(c)}><div className="rw-card-title">[{c.citation_index}] {citationTitle(c)}</div><div className="rw-meta"><span>{citationPage(c)}</span><span>Score {scoreText(c.score)}</span>{c.chunk_id && <span>chunk {c.chunk_id}</span>}</div><p className="rw-snippet">{c.snippet || "Không có snippet."}</p></button>)}{diagnostics && <div className="rw-diagnostics"><strong>Chẩn đoán</strong><div className="rw-diag-grid"><span>Điểm cao nhất: {scoreText(diagnostics.top_score)}</span><span>Chunks: {diagnostics.chunks_used ?? valid.length}</span><span>Docs: {(diagnostics.selected_document_ids_used || []).length}</span><span>Mode: {diagnostics.retrieval_mode || "vector"}</span></div></div>}<Modal title="Chi tiết nguồn" onClose={() => setDetail(null)}>{detail && <><div className="rw-card-title">[{detail.citation_index}] {citationTitle(detail)}</div><div className="rw-meta"><span>{citationPage(detail)}</span>{detail.section && <span>{detail.section}</span>}<span>Score {scoreText(detail.score)}</span>{detail.chunk_id && <span>chunk {detail.chunk_id}</span>}</div><p style={{ whiteSpace: "pre-wrap" }}>{detail.snippet || "Backend chưa trả snippet chi tiết hơn."}</p><button className="rw-soft-btn" type="button" onClick={() => navigator.clipboard?.writeText(`Hỏi tiếp về nguồn [${detail.citation_index}]: ${detail.snippet || citationTitle(detail)}`)}>Copy prompt hỏi tiếp</button></>}</Modal></div>;
}

function NotesPanel({ notes, loading, filter, onFilter, onSaveEdit, onDelete, onExportMarkdown, onCitation, onOpenFlashcards, onOpenQuiz, onToggleStar }) {
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "" });
  const filtered = notes.filter((note) => filter === "all" ? true : filter === "with-citation" ? normalizeCitations(note.citations).length > 0 : (note.note_type || "text") === filter);
  const sortedNotes = [...filtered].sort((a, b) => {
    if (noteIsStarred(a) !== noteIsStarred(b)) return noteIsStarred(a) ? -1 : 1;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
  const openDetail = (note) => {
    if ((note.note_type || "") === "flashcards") { const cards = flashcardsFromNote(note); if (cards.length) { onOpenFlashcards?.({ title: note.title || "Flashcards", flashcards: cards, warning: null, saved: true }); return; } }
    if ((note.note_type || "") === "quiz") { const questions = quizFromNote(note); if (questions.length) { onOpenQuiz?.({ title: note.title || "Quiz", questions, warning: null, saved: true }); return; } }
    setDetail(note); setEditing(false); setDraft({ title: note.title || "", content: note.content || "" });
  };
  const saveDetail = async () => {
    if (!detail?.id) return;
    await onSaveEdit(detail.id, draft);
    setDetail((prev) => prev ? { ...prev, ...draft } : prev);
    setEditing(false);
  };
  return <div className="rw-right-content rw-scroll">
    <div className="rw-row" style={{ marginBottom: 10 }}>{[["all","Tất cả"],["text","Text"],["flashcards","Flashcard"],["quiz","Quiz"],["with-citation","Có nguồn"]].map(([key, label]) => <button key={key} className={`rw-chip ${filter === key ? "active" : ""}`} type="button" onClick={() => onFilter(key)}>{label}</button>)}</div>
    <button className="rw-soft-btn" type="button" onClick={onExportMarkdown} disabled={!notes.length}>Export Markdown</button>
    {loading && <div className="rw-warning">Đang tải notes...</div>}
    {!loading && !filtered.length && <div className="rw-warning">Chưa có ghi chú phù hợp.</div>}
    {sortedNotes.map((note) => <button type="button" className={`rw-card ${noteIsStarred(note) ? "is-starred" : ""}`} key={note.id} onClick={() => openDetail(note)}>
      <div className="rw-row" style={{ justifyContent: "space-between" }}><div className="rw-card-title">{noteIsStarred(note) ? "★ " : ""}{note.title || "Ghi chú"}</div><button className={`rw-soft-btn ${noteIsStarred(note) ? "is-starred" : ""}`} type="button" onClick={(e) => { e.stopPropagation(); onToggleStar?.(note); }} aria-label={noteIsStarred(note) ? "Bỏ đánh dấu sao ghi chú" : "Đánh dấu sao ghi chú"}>{noteIsStarred(note) ? "★ Đã sao" : "☆ Sao"}</button></div>
      <p className="rw-snippet">{note.content}</p>
      <div className="rw-meta"><span>{note.note_type || "text"}</span><span>{formatTime(note.updated_at || note.created_at)}</span>{normalizeCitations(note.citations).length > 0 && <span>{normalizeCitations(note.citations).length} nguồn</span>}</div>
    </button>)}
    <Modal title="Chi tiết ghi chú" onClose={() => setDetail(null)}>{detail && <>
      {editing ? <div style={{ display: "grid", gap: 10 }}><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Tên ghi chú" /><textarea rows={12} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="Nội dung ghi chú" /><div className="rw-row"><button className="rw-primary" type="button" onClick={saveDetail}>Lưu</button><button className="rw-soft-btn" type="button" onClick={() => setEditing(false)}>Hủy</button><span className="rw-muted">Chỉ sửa note trong modal này.</span></div></div> : <><div className="rw-row" style={{ justifyContent: "space-between" }}><h3>{detail.title || "Ghi chú"}</h3><div className="rw-row"><button className={`rw-soft-btn ${noteIsStarred(detail) ? "is-starred" : ""}`} type="button" onClick={() => { const nextStarred = !noteIsStarred(detail); onToggleStar?.(detail); setDetail((prev) => prev ? { ...prev, is_starred: nextStarred, metadata: { ...(prev.metadata || {}), is_starred: nextStarred } } : prev); }}>{noteIsStarred(detail) ? "★ Đã sao" : "☆ Sao"}</button><button className="rw-soft-btn" type="button" onClick={() => setEditing(true)}>Sửa</button><button className="rw-danger" type="button" onClick={() => onDelete(detail.id)}>Xóa</button></div></div><MarkdownWithCitations content={detail.content} citations={detail.citations} onCitationClick={onCitation} />{normalizeCitations(detail.citations).length > 0 && <div><h3>Nguồn</h3>{normalizeCitations(detail.citations).map((c) => <button className="rw-card" type="button" key={c.citation_index} onClick={() => onCitation(c)}><div className="rw-card-title">[{c.citation_index}] {citationTitle(c)}</div><p className="rw-snippet">{c.snippet}</p></button>)}</div>}</>}
    </>}</Modal>
  </div>;
}

function SessionsPanel({ sessions, activeSessionId, documents, onOpen, onCreate, onRename, onStar, onDelete, loading }) {
  const [renameId, setRenameId] = useState(null);
  const [title, setTitle] = useState("");
  const docMap = useMemo(() => new Map(documents.map((d) => [d.id, d.filename])), [documents]);
  const sortedSessions = sortPinnedFirst(sessions);
  const stop = (event) => event.stopPropagation();

  return <div className="rw-right-content rw-scroll"><button className="rw-primary" type="button" onClick={onCreate}>Thêm phiên trò chuyện mới</button>{loading && <div className="rw-warning" style={{ marginTop: 10 }}>Đang tải phiên...</div>}{sortedSessions.map((s) => { const names = (s.selected_document_ids || []).map((id) => docMap.get(String(id))).filter(Boolean); const isActive = activeSessionId === s.id; return <div className={`rw-card rw-session-card ${isActive ? "active" : ""}`} key={s.id} role="button" tabIndex={0} onClick={() => onOpen(s)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(s); } }}>{renameId === s.id ? <div style={{ display: "grid", gap: 8 }} onClick={stop}><input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onRename(s.id, title); setRenameId(null); } if (e.key === "Escape") setRenameId(null); }} autoFocus /><div className="rw-row"><button className="rw-primary" type="button" onClick={() => { onRename(s.id, title); setRenameId(null); }}>Lưu</button><button className="rw-soft-btn" type="button" onClick={() => setRenameId(null)}>Hủy</button></div></div> : <><div className="rw-row" style={{ justifyContent: "space-between" }}><div className="rw-card-title">{isActive ? "● " : ""}{s.title || "Phiên nghiên cứu"}</div><button className={`rw-soft-btn ${s.is_starred ? "is-starred" : ""}`} type="button" onClick={(event) => { event.stopPropagation(); onStar(s); }}>{s.is_starred ? "★ Đã ghim" : "☆ Ghim"}</button></div><div className="rw-meta"><span>{formatTime(s.updated_at || s.created_at)}</span><span>{names.length || (s.selected_document_ids || []).length} tài liệu</span></div><p className="rw-snippet">{names.join(", ") || "Không có tên tài liệu trong cache"}</p><div className="rw-row"><button className="rw-soft-btn" type="button" onClick={(event) => { event.stopPropagation(); setRenameId(s.id); setTitle(s.title || ""); }}>Rename</button><button className="rw-danger" type="button" onClick={(event) => { event.stopPropagation(); onDelete(s.id); }}>Delete</button></div></>}</div>; })}</div>;
}

function FlashcardModal({ data, onClose, onSave, saving }) {
  const cards = Array.isArray(data?.flashcards) ? data.flashcards.slice(0, 5) : [];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[index] || {};
  if (!data || !cards.length) return null;
  const go = (next) => { setIndex(next); setFlipped(false); };
  return <Modal title={data.title || "Flashcards"} onClose={onClose}>
    {data.warning && <div className="rw-warning">⚠ {data.warning}</div>}
    <div className="rw-flashcard-stage">
      <div className={`rw-flashcard-card ${flipped ? "back" : "front"}`} role="button" tabIndex={0} onClick={() => setFlipped((v) => !v)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFlipped((v) => !v); }}>
        <div><div className="rw-muted">{flipped ? "Back" : "Front"}</div><p>{flipped ? card.back : card.front}</p></div>
      </div>
      <p className="rw-muted">Bấm vào thẻ để lật Front/Back.</p>
      <div className="rw-row" style={{ justifyContent: "center" }}><button className="rw-soft-btn" type="button" onClick={() => go(Math.max(0, index - 1))} disabled={index === 0}>← Trước</button><button className="rw-primary" type="button" onClick={() => setFlipped((v) => !v)}>Lật thẻ</button><button className="rw-soft-btn" type="button" onClick={() => go(Math.min(cards.length - 1, index + 1))} disabled={index === cards.length - 1}>Tiếp →</button></div>
      <div className="rw-row" style={{ justifyContent: "space-between", marginTop: 10 }}><p className="rw-muted">{index + 1}/{cards.length} · tối đa 5 flashcard</p>{!data.saved && <button className="rw-primary" type="button" onClick={() => onSave?.(data)} disabled={saving}>{saving ? "Đang lưu..." : "Thêm vào ghi chú"}</button>}</div>
    </div>
  </Modal>;
}

function QuizModal({ data, onClose, onSave, saving }) {
  const questions = Array.isArray(data?.questions) ? data.questions.slice(0, 5) : [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState({});
  if (!data || !questions.length) return null;
  const current = questions[index] || {};
  const key = current.id || String(index);
  const currentAnswer = answers[key] || "";
  const isChecked = Boolean(checked[key]);
  const choices = current.choices || [];
  const isObjective = choices.length > 0 || ["multiple_choice", "true_false"].includes(current.type);
  const normalizedCorrect = normalizeAnswerText(current.answer || current.blank_answer || current.sample_answer || "");
  const correct = isObjective ? currentAnswer === current.answer : normalizeAnswerText(currentAnswer) === normalizedCorrect;
  const selectAnswer = (value) => { if (!isChecked) setAnswers((prev) => ({ ...prev, [key]: value })); };
  const feedback = isChecked ? <div className="rw-quiz-feedback"><strong className={correct ? "ok" : "bad"}>{correct ? "Đúng" : "Chưa đúng"}</strong><p>Đáp án đúng: <b>{current.answer || current.blank_answer || current.sample_answer}</b></p>{current.explanation && <p>{current.explanation}</p>}{current.choice_explanations && <div>{Object.entries(current.choice_explanations).map(([choiceKey, text]) => <p key={choiceKey}><b>{choiceKey}:</b> {text}</p>)}</div>}</div> : null;
  return <Modal title={data.title || "Quiz"} onClose={onClose}>
    {data.warning && <div className="rw-warning">⚠ {data.warning}</div>}
    <div className="rw-meta"><span>Câu {index + 1}/{questions.length}</span><span>Tối đa 5 câu hỏi</span></div>
    <h3>{current.question}</h3>
    {isObjective ? <div>{choices.map((choice) => { const isCorrectChoice = isChecked && choice.key === current.answer; const isWrongChoice = isChecked && currentAnswer === choice.key && choice.key !== current.answer; return <button type="button" key={choice.key} className={`rw-quiz-choice ${currentAnswer === choice.key ? "selected" : ""} ${isCorrectChoice ? "correct" : ""} ${isWrongChoice ? "wrong" : ""}`} onClick={() => selectAnswer(choice.key)}><strong>{choice.key}</strong><span>{choice.text}</span></button>; })}</div> : <textarea className="rw-textarea" rows={4} value={currentAnswer} disabled={isChecked} onChange={(e) => selectAnswer(e.target.value)} placeholder="Nhập đáp án của bạn..." />}
    <div className="rw-row" style={{ marginTop: 12 }}><button className="rw-primary" type="button" onClick={() => setChecked((prev) => ({ ...prev, [key]: true }))} disabled={isChecked || (!currentAnswer && isObjective)}>Hiện kết quả</button><button className="rw-soft-btn" type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>← Câu trước</button><button className="rw-soft-btn" type="button" onClick={() => setIndex(Math.min(questions.length - 1, index + 1))} disabled={index === questions.length - 1}>Câu tiếp →</button></div>
    {feedback}
    {!data.saved && <div className="rw-row" style={{ justifyContent: "flex-end", marginTop: 12 }}><button className="rw-primary" type="button" onClick={() => onSave?.(data)} disabled={saving}>{saving ? "Đang lưu..." : "Thêm vào ghi chú"}</button></div>}
  </Modal>;
}


export default function ResearchWorkspace() {
  const { notebookId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useAuth();
  const [notebookName, setNotebookName] = useState("Notebook");
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(() => location.state?.selectedDocumentIds || []);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(() => location.state?.researchSession || null);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState(location.state?.prefillQuestion || "");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [toast, setToast] = useState(null);
  const [leftTab, setLeftTab] = useStored(LEFT_TAB_KEY, "documents");
  const [rightTab, setRightTab] = useStored(RIGHT_TAB_KEY, "notes");
  const [leftCollapsed, setLeftCollapsed] = useStored(LEFT_COLLAPSED_KEY, false, (v) => v === "true");
  const [rightCollapsed, setRightCollapsed] = useStored(RIGHT_COLLAPSED_KEY, false, (v) => v === "true");
  const [leftWidth, setLeftWidth] = useStored(LEFT_WIDTH_KEY, 320, Number);
  const [rightWidth, setRightWidth] = useStored(RIGHT_WIDTH_KEY, 380, Number);
  const [mobileTab, setMobileTab] = useState("chat");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingSessionMessages, setLoadingSessionMessages] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [currentCitations, setCurrentCitations] = useState([]);
  const [invalidCitationCount, setInvalidCitationCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState(null);
  const [savedMessageIds, setSavedMessageIds] = useState(new Set());
  const [savingNoteId, setSavingNoteId] = useState(null);
  const [noteFilter, setNoteFilter] = useState("all");
  const [retrievalMode, setRetrievalMode] = useState("strict");
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryResults, setLibraryResults] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);
  const [flashcardCount, setFlashcardCount] = useState(5);
  const [quizCount, setQuizCount] = useState(3);
  const [flashcardModal, setFlashcardModal] = useState(null);
  const [quizModal, setQuizModal] = useState(null);
  const [savingStudyNote, setSavingStudyNote] = useState(false);
  const requestRef = useRef(null);
  const autosaveRef = useRef(null);
  const selectedDocuments = useMemo(() => documents.filter((d) => selectedDocumentIds.includes(d.id)), [documents, selectedDocumentIds]);
  const readyDocuments = useMemo(() => documents.filter((d) => d.processing_status === "ready"), [documents]);
  const activeSessionId = activeSession?.id;
  const showToast = (type, message) => setToast({ type, message });
  useEffect(() => { if (!toast) return undefined; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id); }, [toast]);

  const loadDocuments = async () => {
    if (!token || !notebookId) return;
    setLoadingDocuments(true);
    try { const result = await api.getNotebookDocuments(notebookId, token); const docs = (result?.documents || []).map(normalizeDocument); setDocuments(docs); setSelectedDocumentIds((prev) => prev.length ? prev.filter((id) => docs.some((d) => d.id === id && d.processing_status === "ready")) : docs.filter((d) => d.processing_status === "ready").map((d) => d.id)); } catch (err) { showToast("error", err.message || "Không thể tải tài liệu."); } finally { setLoadingDocuments(false); }
  };
  const loadNotes = async (sessionId) => {
    if (!sessionId) { setNotes([]); setSavedMessageIds(new Set()); return; }
    setLoadingNotes(true);
    try { const result = await api.getWorkspaceNotes(notebookId, token, { research_session_id: sessionId }); const fetched = result?.notes || []; setNotes(fetched); setSavedMessageIds(new Set(fetched.map((n) => n.source_message_id).filter(Boolean))); } catch (err) { showToast("error", err.message || "Không thể tải notes."); } finally { setLoadingNotes(false); }
  };
  const openSession = async (session, loadMessages = true) => {
    setActiveSession(session); localStorage.setItem(`${LAST_SESSION_KEY}:${notebookId}`, session.id); setSelectedDocumentIds((session.selected_document_ids || []).map(String));
    if (!loadMessages) { loadNotes(session.id); return; }
    setLoadingSessionMessages(true); setMessages([]); setCurrentCitations([]); setDiagnostics(null);
    try { const result = await api.getResearchSessionMessages(session.id, token); const loaded = (result?.messages || []).map((m) => ({ ...m, citations: normalizeCitations(m.citations), retrieval_diagnostics: m.retrieval_diagnostics || buildDiagnostics(m.citations) })); setActiveSession(result?.session || session); setMessages(loaded); const last = [...loaded].reverse().find((m) => m.role === "assistant"); setCurrentCitations(normalizeCitations(last?.citations || [])); setDiagnostics(last?.retrieval_diagnostics || buildDiagnostics(last?.citations || [])); const fetchedNotes = result?.notes || []; setNotes(fetchedNotes); setSavedMessageIds(new Set(fetchedNotes.map((n) => n.source_message_id).filter(Boolean))); setRightTab("sessions"); } catch (err) { showToast("error", err.message || "Không thể mở phiên."); } finally { setLoadingSessionMessages(false); }
  };
  const loadSessions = async () => {
    if (!token || !notebookId) return;
    setLoadingSessions(true);
    try { const result = await api.getResearchSessions(notebookId, token); const fetched = result?.sessions || []; setSessions(fetched); const targetId = location.state?.researchSessionId || location.state?.researchSession?.id || localStorage.getItem(`${LAST_SESSION_KEY}:${notebookId}`); const target = fetched.find((s) => s.id === targetId) || fetched[0]; if (!activeSession && target) openSession(target, true); } catch (err) { showToast("error", err.message || "Không thể tải phiên."); } finally { setLoadingSessions(false); }
  };
  const loadNotebookName = async () => { try { const result = await api.getNotebooks(token); const item = (result?.notebooks || []).find((n) => String(n.notebook_id) === String(notebookId)); if (item?.name) setNotebookName(item.name); } catch {} };
  useEffect(() => { loadNotebookName(); loadDocuments(); loadSessions(); return () => requestRef.current?.abort?.(); }, [token, notebookId]);

  const createSession = async () => { if (!selectedDocumentIds.length) return showToast("error", "Chọn ít nhất một tài liệu ready."); try { const result = await api.createResearchSession(notebookId, selectedDocumentIds, token); const session = result?.session; setSessions((prev) => [session, ...prev].filter(Boolean)); setMessages([]); setCurrentCitations([]); setDiagnostics(null); await openSession(session, false); showToast("success", "Đã tạo phiên mới."); } catch (err) { showToast("error", err.message || "Không thể tạo phiên."); } };
  const updateActiveSessionDocuments = async (nextIds) => {
    setSelectedDocumentIds(nextIds);
    if (!activeSession?.id) return;
    try { const result = await api.updateResearchSession(activeSession.id, { selected_document_ids: nextIds }, token); const session = result?.session || { ...activeSession, selected_document_ids: nextIds }; setActiveSession(session); setSessions((prev) => prev.map((s) => s.id === session.id ? session : s)); showToast("success", "Đã cập nhật tài liệu tham chiếu của phiên."); } catch (err) { showToast("error", err.message || "Không thể cập nhật tài liệu phiên."); }
  };
  const toggleDocument = (docId) => { const next = selectedDocumentIds.includes(docId) ? selectedDocumentIds.filter((id) => id !== docId) : [...selectedDocumentIds, docId]; updateActiveSessionDocuments(next); };
  const deleteDocument = async (doc) => {
    if (!doc?.id) return;
    if (!window.confirm(`Xóa tài liệu "${doc.filename}" khỏi notebook?`)) return;
    try {
      await api.deleteDocument(doc.id, token);
      const nextIds = selectedDocumentIds.filter((id) => id !== doc.id);
      setDocuments((prev) => prev.filter((item) => item.id !== doc.id));
      if (selectedDocumentIds.includes(doc.id)) await updateActiveSessionDocuments(nextIds);
      showToast("success", "Đã xóa tài liệu.");
    } catch (err) {
      showToast("error", err.message || "Không thể xóa tài liệu.");
    }
  };
  const handleUpload = async (files) => {
    setUploadError(""); const valid = files.filter((file) => { const ext = file.name.split(".").pop()?.toLowerCase(); if (!EXTENSIONS.has(ext)) { setUploadError(`Không hỗ trợ ${file.name}`); return false; } if (file.size > MAX_UPLOAD_BYTES) { setUploadError(`${file.name} vượt quá ${MAX_UPLOAD_MB}MB`); return false; } return true; }); if (!valid.length) return;
    setUploadProgress(1); try { const result = await api.uploadDocuments(notebookId, valid, token, setUploadProgress); const uploaded = (result?.uploaded || []).map(normalizeDocument); showToast("success", "Upload hoàn tất."); await loadDocuments(); if (activeSession?.id && uploaded.length) { const next = [...new Set([...selectedDocumentIds, ...uploaded.filter((d) => d.processing_status === "ready").map((d) => d.id)])]; await updateActiveSessionDocuments(next); } } catch (err) { setUploadError(err.message || "Upload thất bại."); } finally { setTimeout(() => setUploadProgress(0), 800); }
  };
  const searchLibrary = async () => { setLibraryLoading(true); try { const result = await api.listSystemLibraryDocuments({ q: libraryQuery, search: libraryQuery, limit: 12 }, token); setLibraryResults(result?.documents || result?.items || []); } catch (err) { showToast("error", err.message || "Không thể tìm thư viện."); } finally { setLibraryLoading(false); } };
  const linkLibraryDocument = async (id) => { try { await api.linkSystemDocumentToNotebook(notebookId, id, token); setLibraryOpen(false); showToast("success", "Đã link tài liệu từ thư viện."); await loadDocuments(); } catch (err) { showToast("error", err.message || "Không thể link tài liệu."); } };

  const startChat = async ({ question, regenerateIndex = null }) => {
    if (!question.trim() || loading) return; if (!activeSession) return showToast("error", "Hãy tạo hoặc mở phiên nghiên cứu trước."); if (!selectedDocumentIds.length) return showToast("error", "Chọn ít nhất một tài liệu.");
    const controller = new AbortController(); requestRef.current = controller; const userMessage = regenerateIndex == null ? { id: crypto.randomUUID?.() || `${Date.now()}-user`, role: "user", content: question } : null; const assistantId = crypto.randomUUID?.() || `${Date.now()}-assistant`;
    setInput(""); setLoading(true); setLoadingLabel("Đang truy xuất nguồn…"); setDiagnostics(null); setInvalidCitationCount(0); if (userMessage) setMessages((prev) => [...prev, userMessage]); else setMessages((prev) => prev.map((m, i) => i === regenerateIndex ? { ...m, content: "", citations: [], streaming: true } : m));
    let full = ""; let streamCitations = []; let streamWarning = null; let streamDiagnostics = null; const history = messages.filter((m, i) => regenerateIndex == null || i < regenerateIndex).filter((m) => m.role !== "system").map(({ role, content }) => ({ role, content }));
    try { await api.streamResearchQuery({ notebookId, question, chatHistory: history, selectedDocumentIds, researchSessionId: activeSession.id, citationThreshold: retrievalMode === "strict" ? 0.45 : 0 }, token, { onStatus: (_s, msg) => setLoadingLabel(msg || "Đang xử lý…"), onSources: (sources) => { streamCitations = normalizeCitations(sources); setCurrentCitations(streamCitations); setInvalidCitationCount(Math.max(0, (Array.isArray(sources) ? sources.length : 0) - streamCitations.length)); setRightTab("sources"); }, onDiagnostics: (diag) => { streamDiagnostics = diag; setDiagnostics(diag); }, onWarning: (warning) => { streamWarning = warning; }, onToken: (chunk) => { full += chunk; const partial = { id: assistantId, role: "assistant", content: full, citations: streamCitations, warning: streamWarning, retrieval_diagnostics: streamDiagnostics, streaming: true }; setMessages((prev) => regenerateIndex == null ? [...prev.filter((m) => m.id !== assistantId), partial] : prev.map((m, i) => i === regenerateIndex ? partial : m)); } }, { signal: controller.signal }); setLoadingLabel("Đang lưu phiên…"); const finalMsg = { id: assistantId, role: "assistant", content: full, citations: streamCitations, warning: streamWarning, retrieval_diagnostics: streamDiagnostics || buildDiagnostics(streamCitations) }; setMessages((prev) => regenerateIndex == null ? [...prev.filter((m) => m.id !== assistantId), finalMsg] : prev.map((m, i) => i === regenerateIndex ? finalMsg : m)); setDiagnostics(finalMsg.retrieval_diagnostics); setCurrentCitations(streamCitations); } catch (err) { showToast("error", err.message || "Không thể gọi RAG."); } finally { setLoading(false); setLoadingLabel(""); requestRef.current = null; }
  };
  const handleSubmit = () => startChat({ question: input });
  const handleRegenerate = (idx) => { const user = [...messages].slice(0, idx).reverse().find((m) => m.role === "user"); if (!user) return showToast("error", "Không tìm thấy câu hỏi trước đó."); startChat({ question: user.content, regenerateIndex: idx }); };
  const showSources = (citation) => { if (citation && !currentCitations.length) setCurrentCitations([citation]); setRightTab("sources"); setMobileTab("sources"); };
  const saveNote = async (msg) => { const id = msg.id || `${msg.role}-${String(msg.content || "").slice(0, 24)}`; if (savedMessageIds.has(id)) return; setSavingNoteId(id); try { const citations = normalizeCitations(msg.citations); const result = await api.createWorkspaceNote(notebookId, { title: noteTitle(msg.content), content: noteContentFromMessage(msg, citations), citations, source_message_id: id, research_session_id: activeSession?.id, note_type: "text", metadata: { saved_from: "research_workspace" } }, token); const note = result?.note; if (note) setNotes((prev) => [note, ...prev]); setSavedMessageIds((prev) => new Set([...prev, id])); showToast("success", "Đã lưu vào notes."); } catch (err) { showToast("error", err.message || "Không thể lưu note."); } finally { setSavingNoteId(null); } };
  const saveEdit = async (noteId, overrideDraft) => { try { const result = await api.updateNote(noteId, { title: overrideDraft.title || "Ghi chú", content: overrideDraft.content }, token); const note = result?.note; setNotes((prev) => prev.map((n) => n.id === noteId ? (note || { ...n, ...overrideDraft }) : n)); } catch (err) { showToast("error", err.message || "Không thể lưu note."); } };
  const toggleNoteStar = async (note) => {
    if (!note?.id) return;
    const nextStarred = !noteIsStarred(note);
    const nextMetadata = { ...(note.metadata || {}), is_starred: nextStarred };
    const optimistic = { ...note, metadata: nextMetadata, is_starred: nextStarred, updated_at: new Date().toISOString() };
    setNotes((prev) => prev.map((n) => n.id === note.id ? optimistic : n));
    try {
      const result = await api.updateNote(note.id, { metadata: nextMetadata }, token);
      const updated = result?.data?.note || result?.note || optimistic;
      setNotes((prev) => prev.map((n) => n.id === note.id ? { ...n, ...updated, metadata: updated.metadata || nextMetadata, is_starred: noteIsStarred(updated) } : n));
    } catch (err) {
      setNotes((prev) => prev.map((n) => n.id === note.id ? note : n));
      showToast("error", err.message || "Không thể đánh dấu sao ghi chú.");
    }
  };
  const exportMarkdown = () => { const md = [`# Notes - ${activeSession?.title || notebookName}`, ...notes.map((n) => `\n## ${n.title || "Ghi chú"}\n\n${n.content || ""}`)].join("\n"); const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" })); const a = document.createElement("a"); a.href = url; a.download = `${notebookName}-notes.md`; a.click(); URL.revokeObjectURL(url); };
  const saveStudyNote = async (data, type) => {
    if (!data || savingStudyNote) return;
    setSavingStudyNote(true);
    try {
      const isFlashcards = type === "flashcards";
      const payload = isFlashcards
        ? { title: data.title || "Flashcards", content: buildFlashcardMarkdown(data.flashcards || []), note_type: "flashcards", metadata: { flashcards: data.flashcards || [] }, citations: [], research_session_id: activeSession?.id }
        : { title: data.title || "Quiz", content: buildQuizMarkdown(data.questions || [], data.title || "Quiz"), note_type: "quiz", metadata: { quiz: { title: data.title || "Quiz", questions: data.questions || [] } }, citations: [], research_session_id: activeSession?.id };
      const result = await api.createWorkspaceNote(notebookId, payload, token);
      if (result?.note) setNotes((prev) => [result.note, ...prev]);
      if (isFlashcards) setFlashcardModal(null); else setQuizModal(null);
      showToast("success", "Đã thêm vào ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể lưu vào ghi chú.");
    } finally {
      setSavingStudyNote(false);
    }
  };
  const generateFlashcards = async () => { if (!activeSession?.id || !selectedDocumentIds.length) return showToast("error", "Cần phiên và tài liệu đã chọn."); setQuickLoading(true); try { const result = await api.generateFlashcards(activeSession.id, { selected_document_ids: selectedDocumentIds, count: Math.max(1, Math.min(flashcardCount, 5)) }, token); setFlashcardModal({ title: "Flashcards từ tài liệu", flashcards: (result?.flashcards || []).slice(0, 5), warning: result?.warning }); } catch (err) { showToast("error", err.message || "Không thể tạo flashcard."); } finally { setQuickLoading(false); } };
  const generateQuiz = async () => { if (!activeSession?.id || !selectedDocumentIds.length) return showToast("error", "Cần phiên và tài liệu đã chọn."); setQuickLoading(true); try { const result = await api.generateQuiz(activeSession.id, { selected_document_ids: selectedDocumentIds, count: Math.max(1, Math.min(quizCount, 5)), question_type: "multiple_choice" }, token); setQuizModal({ title: "Quiz từ tài liệu", questions: (result?.quiz?.questions || result?.questions || []).slice(0, 5), warning: result?.warning }); } catch (err) { showToast("error", err.message || "Không thể tạo quiz."); } finally { setQuickLoading(false); } };
  const resize = (side, event) => { const startX = event.clientX; const start = side === "left" ? leftWidth : rightWidth; const set = side === "left" ? setLeftWidth : setRightWidth; const onMove = (e) => set(Math.min(side === "left" ? 520 : 560, Math.max(side === "left" ? 260 : 300, side === "left" ? start + e.clientX - startX : start - (e.clientX - startX)))); const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); }; document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); };

  return <div className="rw-page"><Styles /><div className="rw-topbar"><div className="rw-row"><button className="rw-soft-btn" type="button" onClick={() => navigate("/notebook")}>← Quay lại Notebook</button><div className="rw-title"><h1>Research Workspace · {notebookName}</h1><p>Tạo notebook vẫn ở trang danh sách; khi vào notebook sẽ làm việc trong workspace này.</p></div></div><div className="rw-row"><button className="rw-soft-btn" type="button" aria-label="Ẩn hiện panel trái" onClick={() => setLeftCollapsed(!leftCollapsed)}>{leftCollapsed ? "Mở Tài liệu" : "Ẩn Tài liệu"}</button><button className="rw-soft-btn" type="button" aria-label="Ẩn hiện panel phải" onClick={() => setRightCollapsed(!rightCollapsed)}>{rightCollapsed ? "Mở Ghi chú/Nguồn" : "Ẩn Ghi chú/Nguồn"}</button></div></div><div className="rw-mobile-tabs">{[["documents", "Tài liệu"], ["chat", "Chat"], ["notes", "Ghi chú"], ["sources", "Nguồn"]].map(([key, label]) => <button key={key} type="button" className={mobileTab === key ? "active" : ""} onClick={() => { setMobileTab(key); if (["notes", "sources"].includes(key)) setRightTab(key); }}>{label}</button>)}</div><div className="rw-shell">
    {leftCollapsed ? <div className="rw-reopen"><button className="rw-icon-btn" type="button" onClick={() => setLeftCollapsed(false)}>📄</button></div> : <><aside className={`rw-panel ${mobileTab === "documents" ? "mobile-active" : ""}`} style={{ width: leftWidth }}><DocumentsPanel documents={documents} selectedDocumentIds={selectedDocumentIds} onToggleDocument={toggleDocument} onSelectAllReady={() => updateActiveSessionDocuments(readyDocuments.map((d) => d.id))} onCreateSession={createSession} onUpload={handleUpload} uploadProgress={uploadProgress} uploadError={uploadError} onDismissUploadError={() => setUploadError("")} loadingDocuments={loadingDocuments} leftTab={leftTab} onLeftTab={setLeftTab} onPrompt={(p) => { setInput(p); setMobileTab("chat"); }} onGenerateFlashcards={generateFlashcards} onGenerateQuiz={generateQuiz} quickLoading={quickLoading} flashcardCount={flashcardCount} onFlashcardCount={setFlashcardCount} quizCount={quizCount} onQuizCount={setQuizCount} onOpenLibrary={() => setLibraryOpen(true)} onDeleteDocument={deleteDocument} /></aside><div className="rw-resizer" role="separator" aria-label="Resize panel tài liệu" onMouseDown={(e) => resize("left", e)} /></>}
    <main className={`rw-center ${mobileTab === "chat" ? "mobile-active" : ""}`}><ChatPanel messages={messages} input={input} onInput={setInput} onSubmit={handleSubmit} loading={loading} loadingLabel={loadingLabel} historyLoading={loadingSessionMessages} selectedDocuments={selectedDocuments} session={activeSession} onClear={async () => { if (!activeSession?.id || !window.confirm("Xóa lịch sử chat phiên này?")) return; await api.clearResearchSessionMessages(activeSession.id, token); setMessages([]); setCurrentCitations([]); }} onExport={async () => { if (!activeSession?.id) return; const response = await api.exportResearchSessionDocx(activeSession.id, token); const url = URL.createObjectURL(new Blob([response.data])); const a = document.createElement("a"); a.href = url; a.download = `${activeSession.title || "research-session"}.docx`; a.click(); URL.revokeObjectURL(url); }} onRegenerate={handleRegenerate} onCopy={(msg) => navigator.clipboard?.writeText(msg.content || "").then(() => showToast("success", "Đã copy."))} onSaveNote={saveNote} savedMessageIds={savedMessageIds} savingNoteId={savingNoteId} onShowSources={showSources} diagnostics={diagnostics} mode={retrievalMode} onModeChange={setRetrievalMode} onPrompt={(p) => setInput(p)} showAllPrompts={showAllPrompts} setShowAllPrompts={setShowAllPrompts} /></main>
    {rightCollapsed ? <div className="rw-reopen rw-right-reopen"><button className="rw-icon-btn" type="button" onClick={() => setRightCollapsed(false)}>☰</button></div> : <><div className="rw-resizer" role="separator" aria-label="Resize panel phải" onMouseDown={(e) => resize("right", e)} /><aside className={`rw-panel rw-right ${["notes", "sources"].includes(mobileTab) ? "mobile-active" : ""}`} style={{ width: rightWidth }}><div className="rw-tabs"><button className={`rw-tab ${rightTab === "notes" ? "active" : ""}`} type="button" onClick={() => setRightTab("notes")}>Ghi chú</button><button className={`rw-tab ${rightTab === "sources" ? "active" : ""}`} type="button" onClick={() => setRightTab("sources")}>Nguồn</button><button className={`rw-tab ${rightTab === "sessions" ? "active" : ""}`} type="button" onClick={() => setRightTab("sessions")}>Phiên</button></div>{rightTab === "notes" && <NotesPanel notes={notes} loading={loadingNotes} filter={noteFilter} onFilter={setNoteFilter} onSaveEdit={saveEdit} onDelete={async (id) => { if (window.confirm("Xóa ghi chú này?")) { await api.deleteNote(id, token); setNotes((prev) => prev.filter((n) => n.id !== id)); } }} onExportMarkdown={exportMarkdown} onCitation={showSources} onOpenFlashcards={setFlashcardModal} onOpenQuiz={setQuizModal} onToggleStar={toggleNoteStar} />}{rightTab === "sources" && <SourcesPanel citations={currentCitations} invalidCount={invalidCitationCount} diagnostics={diagnostics} />}{rightTab === "sessions" && <SessionsPanel sessions={sessions} activeSessionId={activeSessionId} documents={documents} loading={loadingSessions} onOpen={openSession} onCreate={createSession} onRename={async (id, title) => { const result = await api.updateResearchSession(id, { title }, token); const session = result?.session; setSessions((prev) => prev.map((s) => s.id === id ? (session || { ...s, title }) : s)); if (activeSessionId === id) setActiveSession(session || { ...activeSession, title }); }} onStar={async (session) => { const result = await api.updateResearchSession(session.id, { is_starred: !session.is_starred }, token); setSessions((prev) => prev.map((s) => s.id === session.id ? (result?.session || { ...s, is_starred: !s.is_starred }) : s)); }} onDelete={async (id) => { if (!window.confirm("Xóa phiên này?")) return; await api.deleteResearchSession(id, token); setSessions((prev) => prev.filter((s) => s.id !== id)); if (activeSessionId === id) { setActiveSession(null); setMessages([]); setCurrentCitations([]); } }} />}</aside></>}
  </div><LibraryLinkModal open={libraryOpen} query={libraryQuery} onQuery={setLibraryQuery} results={libraryResults} loading={libraryLoading} onSearch={searchLibrary} onLink={linkLibraryDocument} onClose={() => setLibraryOpen(false)} /><FlashcardModal data={flashcardModal} onClose={() => setFlashcardModal(null)} onSave={(data) => saveStudyNote(data, "flashcards")} saving={savingStudyNote} /><QuizModal data={quizModal} onClose={() => setQuizModal(null)} onSave={(data) => saveStudyNote(data, "quiz")} saving={savingStudyNote} />{toast && <div className={`rw-toast ${toast.type}`}>{toast.message}</div>}</div>;
}
