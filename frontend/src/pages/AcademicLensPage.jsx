import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, FileUp, Library, MessageSquareText, NotebookPen, Search, X } from 'lucide-react';
import AcademicChatPanel from '../components/academic-lens/AcademicChatPanel';
import AcademicDocumentViewer from '../components/academic-lens/AcademicDocumentViewer';
import AcademicNotepad from '../components/academic-lens/AcademicNotepad';
import DocumentToolbar from '../components/academic-lens/DocumentToolbar';
import WebContextDrawer from '../components/academic-lens/WebContextDrawer';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

const ACADEMIC_LENS_SESSION_KEY = 'academicLens:session';
const ACADEMIC_LENS_LAST_PATH_KEY = 'academicLens:lastPath';
const ACADEMIC_LENS_LAYOUT_KEY = 'academicLens:layoutPreferences';
const AUTH_USER_KEY = 'ai-research-user';

const DEFAULT_LAYOUT = {
  academicLensLayoutMode: 'reading',
  notepadDock: 'right',
  isNotepadCollapsed: false,
  isChatCollapsed: false,
  viewerWidth: 62,
  rightPanelWidth: 380,
  notepadHeight: 320,
  chatHeight: 420,
};

const MODE_LAYOUTS = {
  reading: { academicLensLayoutMode: 'reading', viewerWidth: 70, notepadDock: 'bottom', isNotepadCollapsed: true, isChatCollapsed: false, notepadHeight: 240, chatHeight: 360 },
  chat: { academicLensLayoutMode: 'chat', viewerWidth: 54, notepadDock: 'right', isNotepadCollapsed: true, isChatCollapsed: false, chatHeight: 560 },
  note: { academicLensLayoutMode: 'note', viewerWidth: 58, notepadDock: 'right', isNotepadCollapsed: false, isChatCollapsed: true, chatHeight: 300, notepadHeight: 360 },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const loadAcademicLensLayout = () => {
  try {
    const saved = { ...DEFAULT_LAYOUT, ...(JSON.parse(localStorage.getItem(ACADEMIC_LENS_LAYOUT_KEY) || '{}') || {}) };
    return { ...saved, academicLensLayoutMode: MODE_LAYOUTS[saved.academicLensLayoutMode] ? saved.academicLensLayoutMode : DEFAULT_LAYOUT.academicLensLayoutMode };
  } catch {
    return DEFAULT_LAYOUT;
  }
};

const loadAcademicLensSession = () => {
  try {
    const session = JSON.parse(localStorage.getItem(ACADEMIC_LENS_SESSION_KEY) || '{}') || {};
    const user = JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
    const currentUserId = user?.id || user?.user_id || user?.email || null;
    return currentUserId && session.owner_user_id === currentUserId ? session : {};
  } catch {
    return {};
  }
};

const STYLES = `
  .al-page { min-height:100vh; padding:24px clamp(14px,2.4vw,34px); background:radial-gradient(ellipse at 35% 0%, rgba(196,164,100,.13), transparent 42%), #0f0d0a; color:#e8dfd0; font-family:'Lora', Georgia, serif; }
  .al-page button, .al-page textarea, .al-page input { font-family:inherit; }
  .al-top-row { display:grid; grid-template-rows:auto auto; gap:0; margin-bottom:16px; border:1px solid rgba(255,255,255,.08); border-radius:26px; overflow:hidden; background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); }
  .al-hero { padding:24px; background:rgba(255,255,255,.015); border-bottom:1px solid rgba(255,255,255,.08); }
  .al-hero h1 { margin:8px 0; font-size:clamp(30px,4.5vw,52px); color:#f3ebdc; }
  .al-hero p, .al-muted { color:#9f9484; line-height:1.65; font-size:13px; }
  .al-eyebrow { color:#d8bd77; font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; }
  .al-layout-shell { display:grid; gap:10px; }
  .al-mobile-tabs { display:none; gap:8px; padding:8px; border:1px solid rgba(255,255,255,.08); border-radius:18px; background:rgba(255,255,255,.035); }
  .al-mobile-tabs button { flex:1; border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.055); color:#d8caa8; border-radius:12px; padding:9px; display:inline-flex; align-items:center; justify-content:center; gap:7px; cursor:pointer; }
  .al-mobile-tabs button.active { background:linear-gradient(135deg,#d4b66f,#8a6a30); color:#18130d; font-weight:900; }
  .al-workspace { display:grid; grid-template-columns:minmax(40%,1fr) minmax(320px,420px); gap:0; align-items:stretch; min-height:640px; }
  .al-workspace.dock-bottom { grid-template-rows:minmax(560px, calc(100vh - 220px)) 10px auto; }
  .al-workspace.dock-right { grid-template-rows:minmax(640px, calc(100vh - 190px)); }
  .al-main { min-width:0; border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); overflow:hidden; display:flex; flex-direction:column; min-height:0; height:100%; }
  .al-right-panel { min-width:320px; min-height:0; display:flex; flex-direction:column; gap:10px; }
  .al-chat-pane, .al-note-pane { min-height:0; height:100%; }
  .al-right-stack { min-height:0; display:grid; grid-template-rows:minmax(240px, var(--chat-height, 420px)) 10px minmax(220px, 1fr); height:100%; }
  .al-right-stack.note-collapsed { grid-template-rows:minmax(240px, 1fr); }
  .al-right-stack.chat-collapsed { grid-template-rows:minmax(220px, 1fr); }
  .al-right-stack.chat-collapsed.note-collapsed { display:grid; place-items:center; }
  .al-collapsed-placeholder { border:1px dashed rgba(255,255,255,.14); border-radius:20px; padding:18px; color:#9f9484; text-align:center; }
  .al-bottom-note { grid-column:1 / -1; min-height:220px; }
  .al-resizer { background:transparent; position:relative; touch-action:none; z-index:20; }
  .al-resizer::after { content:''; position:absolute; border-radius:999px; background:rgba(216,189,119,.22); transition:background .15s ease; }
  .al-resizer:hover::after { background:rgba(216,189,119,.55); }
  .al-resizer.vertical { width:10px; cursor:col-resize; }
  .al-resizer.vertical::after { top:16px; bottom:16px; left:4px; width:2px; }
  .al-resizer.horizontal { height:10px; cursor:row-resize; }
  .al-workspace > .al-resizer.horizontal { grid-column:1 / -1; }
  .al-resizer.horizontal::after { left:16px; right:16px; top:4px; height:2px; }
  .al-floating-note, .al-floating-chat { position:fixed; right:24px; bottom:24px; z-index:130; border:1px solid rgba(196,164,100,.32); background:linear-gradient(135deg,#d4b66f,#8a6a30); color:#18130d; border-radius:999px; padding:11px 14px; display:inline-flex; align-items:center; gap:8px; font-weight:900; box-shadow:0 18px 50px rgba(0,0,0,.4); cursor:pointer; }
  .al-floating-chat { bottom:76px; background:linear-gradient(135deg,#8fc7ff,#4475a0); }
  .al-note-toast { position:fixed; right:24px; bottom:78px; z-index:130; border:1px solid rgba(196,164,100,.24); background:#201810; color:#f2d48b; border-radius:14px; padding:10px 12px; box-shadow:0 18px 50px rgba(0,0,0,.4); }
  .al-document-card { display:flex; flex-direction:row; justify-content:space-between; align-items:center; gap:14px; padding:18px 24px; background:linear-gradient(135deg, rgba(196,164,100,.10), rgba(255,255,255,.025)); }
  .al-document-card-title { min-width:0; }
  .al-document-card h2 { margin:4px 0; color:#f3ebdc; font-size:18px; max-width:100%; overflow-wrap:anywhere; line-height:1.35; }
  .al-document-card p { margin:0; color:#9f9484; font-size:12px; }
  .al-document-card-actions { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:8px; }
  .al-document-card-actions button { border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.055); color:#d8caa8; border-radius:13px; padding:9px 11px; display:inline-flex; align-items:center; gap:7px; cursor:pointer; }
  .al-toolbar { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:12px 16px; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.035); }
  .al-toolbar h2 { margin:4px 0 0; color:#f3ebdc; font-size:16px; }
  .al-toolbar-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; align-items:center; }
  .al-mode-switcher { display:inline-grid; grid-template-columns:repeat(3, 74px); flex:0 0 auto; gap:4px; padding:4px; border:1px solid rgba(255,255,255,.08); border-radius:14px; background:rgba(0,0,0,.14); }
  .al-mode-switcher button { width:74px; justify-content:center; padding:7px 0 !important; border-radius:10px !important; font-size:12px; white-space:nowrap; }
  .al-mode-switcher button.active, .al-toolbar-actions button.is-accent, .al-icon-row button.active { color:#18130d; background:linear-gradient(135deg,#d4b66f,#8a6a30); font-weight:900; }
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
  .al-original-pdf-link { display:inline-flex; margin-left:8px; color:#cfe9ff; font-size:12px; text-decoration:underline; }
  .al-selection-popover { position:fixed; z-index:120; display:flex; gap:6px; flex-wrap:wrap; max-width:250px; padding:8px; background:#211a12; border:1px solid rgba(196,164,100,.25); border-radius:15px; box-shadow:0 16px 55px rgba(0,0,0,.5); }
  .al-selection-popover button { border:0; border-radius:10px; padding:7px 9px; background:rgba(255,255,255,.06); color:#f2d48b; display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; }
  .al-snipping-overlay { position:fixed; inset:0; z-index:110; background:rgba(0,0,0,.42); cursor:crosshair; }
  .al-snipping-box { position:fixed; border:2px dashed #f2d48b; background:rgba(242,212,139,.12); box-shadow:0 0 0 9999px rgba(0,0,0,.35); pointer-events:none; }
  .al-snipping-cancel, .al-snipping-help { position:fixed; z-index:111; left:24px; border-radius:12px; padding:10px 12px; }
  .al-snipping-cancel { top:20px; border:1px solid rgba(255,255,255,.14); background:#201810; color:#f0b5aa; cursor:pointer; }
  .al-snipping-help { top:68px; color:#f3ebdc; background:rgba(32,24,16,.86); }
  .al-chat { border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); display:flex; flex-direction:column; height:100%; min-height:240px; overflow:hidden; }
  .al-chat.is-web { border-color:rgba(129,196,255,.2); background:rgba(80,130,180,.055); }
  .al-chat-title { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:11px 12px 0; }
  .al-chat-title strong { color:#f3ebdc; }
  .al-chat-title span { color:#8e8374; font-size:12px; }
  .al-chat-tabs { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
  .al-chat-tools { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; color:#8e8374; font-size:12px; border-bottom:1px solid rgba(255,255,255,.06); }
  .al-chat-tool-actions { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
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
  .al-notepad { height:100%; min-height:220px; border:1px solid rgba(255,255,255,.08); border-radius:24px; background:rgba(255,255,255,.035); overflow:hidden; scroll-margin-top:24px; display:flex; flex-direction:column; }
  .al-notepad-head { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
  .al-notepad-head strong { display:block; color:#f3ebdc; }
  .al-notepad-head span { display:block; color:#8e8374; font-size:12px; margin-top:3px; }
  .al-icon-row { display:flex; flex-wrap:wrap; gap:6px; }
  .al-notepad textarea { width:100%; flex:1; min-height:220px; overflow:auto; border:0; background:rgba(0,0,0,.18); color:#eee6d8; padding:14px; outline:none; resize:none; font-family:'DM Sans', sans-serif; }
  .al-markdown-preview { flex:1; min-height:220px; padding:18px; color:#ded4c4; line-height:1.7; overflow:auto; }
  .al-library-backdrop { position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.7); display:grid; place-items:center; padding:20px; }
  .al-library-modal { width:min(860px,100%); max-height:84vh; overflow:auto; border:1px solid rgba(255,255,255,.1); background:#17130e; border-radius:24px; padding:16px; }
  .al-library-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
  .al-library-search { width:100%; border:1px solid rgba(255,255,255,.09); background:rgba(0,0,0,.22); color:#eee6d8; border-radius:15px; padding:12px; outline:none; }
  .al-library-list { display:grid; gap:10px; margin-top:12px; }
  .al-library-doc { text-align:left !important; display:block !important; }
  .al-warning { display:flex; gap:8px; align-items:flex-start; color:#f0b5aa; border:1px solid rgba(224,120,120,.24); background:rgba(224,120,120,.08); border-radius:15px; padding:10px; margin-top:10px; }

  .al-feature-error, .al-viewer-warning, .al-temp-warning { display:flex; gap:7px; align-items:flex-start; margin:10px 12px; border:1px solid rgba(224,120,120,.24); background:rgba(224,120,120,.08); color:#f0b5aa; border-radius:14px; padding:9px; font-size:12px; line-height:1.45; }
  .al-temp-warning { position:sticky; bottom:10px; z-index:5; background:rgba(49,31,21,.95); }
  .al-source-preview { margin:12px; border:1px solid rgba(196,164,100,.24); background:rgba(196,164,100,.08); border-radius:16px; padding:12px; color:#ded4c4; }
  .al-source-preview strong, .al-source-preview span { display:block; color:#f2d48b; margin-bottom:5px; }
  .al-source-preview p { margin:0; line-height:1.55; }
  .al-citations-row { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
  .al-citation-wrap { position:relative; display:inline-flex !important; margin:0 !important; color:inherit !important; }
  .al-citation-badge { border:1px solid rgba(196,164,100,.32); background:rgba(196,164,100,.12); color:#f2d48b; border-radius:999px; padding:3px 8px; cursor:pointer; font-weight:900; display:inline-flex; gap:5px; align-items:center; }
  .al-citation-badge span { color:#f9e6b6; font-size:11px; }
  .al-citation-popover { position:absolute; z-index:150; left:0; top:28px; width:min(330px,78vw); display:grid !important; gap:5px !important; border:1px solid rgba(196,164,100,.28); background:#201810; box-shadow:0 18px 60px rgba(0,0,0,.55); border-radius:14px; padding:10px; color:#ded4c4 !important; }
  .al-citation-popover strong { color:#f3ebdc; }
  .al-citation-popover em, .al-citation-popover small { color:#b8ab99; font-style:normal; }
  .al-citation-popover pre, .al-source-preview pre { margin:0; white-space:pre-wrap; overflow:auto; max-height:220px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; background:rgba(0,0,0,.22); border-radius:10px; padding:8px; color:#ded4c4; }
  .al-citation-popover pre.is-markdown-table { white-space:pre; }
  .al-web-used { color:#cfe9ff !important; }
  .al-context-backdrop { position:fixed; inset:0; z-index:160; background:rgba(0,0,0,.58); display:flex; justify-content:flex-end; }
  .al-context-drawer { width:min(430px,100%); height:100%; overflow:auto; background:#17130e; border-left:1px solid rgba(255,255,255,.1); padding:14px; }
  .al-context-head, .al-context-actions, .al-context-title { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .al-context-head { margin-bottom:12px; }
  .al-context-head span { display:block; color:#8e8374; font-size:12px; margin-top:3px; }
  .al-context-head button, .al-context-actions button { border:1px solid rgba(255,255,255,.09); background:rgba(255,255,255,.055); color:#d8caa8; border-radius:11px; padding:7px 9px; display:inline-flex; gap:6px; align-items:center; cursor:pointer; }
  .al-context-list { display:grid; gap:10px; }
  .al-context-list article { border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.04); border-radius:15px; padding:11px; }
  .al-context-list article.is-disabled { opacity:.58; }
  .al-context-list p { color:#ded4c4; font-size:13px; line-height:1.55; max-height:110px; overflow:auto; }
  .al-context-list small { color:#8e8374; }
  @media (max-width:1050px) { .al-workspace { grid-template-columns:minmax(0,1fr) minmax(320px,38vw) !important; } .al-toolbar { align-items:flex-start; flex-direction:column; } .al-toolbar-actions { justify-content:flex-start; } }
  @media (max-width:820px) {
    .al-page { padding:14px 10px; }
    .al-hero, .al-document-card { padding:18px; }
    .al-document-card { flex-direction:column; align-items:stretch; }
    .al-mobile-tabs { display:flex; position:sticky; top:8px; z-index:60; }
    .al-workspace, .al-workspace.dock-bottom, .al-workspace.dock-right { display:block; min-height:0; }
    .al-main, .al-chat, .al-notepad { height:calc(100vh - 190px); min-height:520px; }
    .al-main:not(.mobile-active), .al-right-panel:not(.mobile-active), .al-bottom-note:not(.mobile-active) { display:none; }
    .al-right-panel { min-width:0; }
    .al-chat-pane:not(.mobile-active), .al-note-pane:not(.mobile-active) { display:none; }
    .al-chat-pane.mobile-active, .al-note-pane.mobile-active { display:block; height:100%; }
    .al-right-stack { display:block; height:auto; }
    .al-bottom-note { height:auto !important; }
    .al-right-stack .al-chat, .al-right-stack .al-notepad { height:calc(100vh - 190px); }
    .al-right-stack > .al-resizer, .al-workspace > .al-resizer { display:none; }
    .al-mode-switcher { overflow:auto; max-width:100%; }
    .al-floating-note { right:14px; bottom:14px; }
    .al-floating-chat { right:14px; bottom:66px; }
  }
`;

function DocumentSourceCard({ document, uploading, onUploadClick, onOpenLibrary }) {
  const title = document?.title || document?.filename || 'Chưa chọn tài liệu';
  const detail = document
    ? `${document.source_type === 'system_library' ? 'Thư viện cộng đồng' : document.is_temporary ? 'Tài liệu tạm thời' : 'Tài liệu'} · ${String(document.file_type || 'FILE').toUpperCase()}`
    : 'Upload tài liệu hoặc chọn từ Thư viện cộng đồng để bắt đầu.';
  return (
    <section className="al-document-card">
      <div className="al-document-card-title" title={title}>
        <span className="al-eyebrow">Tài liệu đang đọc</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <div className="al-document-card-actions">
        <button type="button" onClick={onUploadClick} disabled={uploading}><FileUp size={16} /> {uploading ? 'Đang tải...' : 'Upload'}</button>
        <button type="button" onClick={onOpenLibrary}><Library size={16} /> Thư viện cộng đồng</button>
      </div>
    </section>
  );
}

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
  const { token, user } = useAuth();
  const savedSession = useMemo(loadAcademicLensSession, []);
  const savedLayout = useMemo(loadAcademicLensLayout, []);
  const fileInputRef = useRef(null);
  const [document, setDocument] = useState(savedSession.document || null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const notepadRef = useRef(null);
  const [notepad, setNotepad] = useState('');
  const [activeTab, setActiveTab] = useState(savedSession.activeTab || 'document');
  const [messages, setMessages] = useState(Array.isArray(savedSession.messages) ? savedSession.messages : []);
  const [snipping, setSnipping] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [loading, setLoading] = useState({ uploading: false, previewLoading: false, chatSending: false, webSearching: false, visionAnalyzing: false, savingNote: false, libraryLoading: false, contextLoading: false, sessionLoading: false });
  const [errors, setErrors] = useState({});
  const [webContexts, setWebContexts] = useState(Array.isArray(savedSession.webContexts) ? savedSession.webContexts : []);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [contextStorage, setContextStorage] = useState('database');
  const [noteSaveStatus, setNoteSaveStatus] = useState('idle');
  const [noteStorage, setNoteStorage] = useState('database');
  const [activeCitation, setActiveCitation] = useState(null);
  const [sessionId, setSessionId] = useState(savedSession.sessionId || null);
  const [webConfigured, setWebConfigured] = useState(true);
  const [layout, setLayout] = useState(savedLayout);
  const [mobileTab, setMobileTab] = useState('document');
  const [noteToast, setNoteToast] = useState('');

  const docKey = useMemo(() => document?.id ? `academic-lens-note:${document.source_type}:${document.id}` : 'academic-lens-note:draft', [document]);

  useEffect(() => {
    localStorage.setItem(ACADEMIC_LENS_LAST_PATH_KEY, '/academic-lens');
  }, []);

  useEffect(() => {
    localStorage.setItem(ACADEMIC_LENS_SESSION_KEY, JSON.stringify({ owner_user_id: user?.id || user?.user_id || user?.email || null, document, activeTab, messages, webContexts, sessionId }));
  }, [user, document, activeTab, messages, webContexts, sessionId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(ACADEMIC_LENS_LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // Layout preferences are optional and must never block reading/chat/note UX.
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [layout]);

  useEffect(() => {
    if (!noteToast) return undefined;
    const timeout = setTimeout(() => setNoteToast(''), 1800);
    return () => clearTimeout(timeout);
  }, [noteToast]);

  useEffect(() => {
    const clearSession = () => {
      setDocument(null);
      setMessages([]);
      setWebContexts([]);
      setSessionId(null);
      setNotepad('');
      setActiveCitation(null);
      setPendingImage(null);
    };
    window.addEventListener('auth:clear-session-data', clearSession);
    return () => window.removeEventListener('auth:clear-session-data', clearSession);
  }, []);

  const updateLayout = (patch) => setLayout((current) => ({ ...current, ...patch }));

  const applyLayoutMode = (mode) => {
    updateLayout(MODE_LAYOUTS[mode] || MODE_LAYOUTS.reading);
    if (mode === 'note') setMobileTab('notes');
    else if (mode === 'chat') setMobileTab('chat');
    else setMobileTab('document');
  };

  const resetLayout = () => setLayout(DEFAULT_LAYOUT);

  const openNotepad = () => {
    updateLayout({ isNotepadCollapsed: false });
    setMobileTab('notes');
    setTimeout(() => notepadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };

  const openChat = () => {
    updateLayout({ isChatCollapsed: false });
    setMobileTab('chat');
  };

  const startHorizontalResize = (event) => {
    const workspace = event.currentTarget.closest('.al-workspace');
    if (!workspace) return;
    event.preventDefault();
    const bounds = workspace.getBoundingClientRect();
    const onMove = (moveEvent) => {
      const nextViewerWidth = clamp(((moveEvent.clientX - bounds.left) / bounds.width) * 100, 40, 72);
      updateLayout({ viewerWidth: Math.round(nextViewerWidth), rightPanelWidth: Math.round(bounds.width * (1 - nextViewerWidth / 100) - 10) });
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const startRightStackResize = (event) => {
    const stack = event.currentTarget.closest('.al-right-stack');
    if (!stack) return;
    event.preventDefault();
    const bounds = stack.getBoundingClientRect();
    const onMove = (moveEvent) => updateLayout({ chatHeight: Math.round(clamp(moveEvent.clientY - bounds.top, 240, bounds.height - 220)) });
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const startBottomNoteResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = layout.notepadHeight;
    const onMove = (moveEvent) => updateLayout({ notepadHeight: Math.round(clamp(startHeight - (moveEvent.clientY - startY), 220, 520)) });
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const selectDocument = (nextDocument) => {
    setDocument(nextDocument);
    setMessages([]);
    setWebContexts([]);
    setSessionId(null);
    setActiveCitation(null);
    setPendingImage(null);
    setActiveTab('document');
  };

  useEffect(() => {
    let cancelled = false;
    setNotepad(localStorage.getItem(docKey) || '');
    if (!document?.id) return () => { cancelled = true; };
    setLoading((current) => ({ ...current, previewLoading: document.source_type === 'system_library', sessionLoading: true, contextLoading: true }));
    api.getAcademicLensNotepad({ document_id: document.id, session_id: sessionId || undefined }, token)
      .then((data) => { if (!cancelled) { setNotepad(data?.content ?? localStorage.getItem(docKey) ?? ''); setNoteStorage(data?.storage || 'database'); } })
      .catch(() => { if (!cancelled) setNoteStorage('memory_fallback'); });
    api.listAcademicLensSessions({ document_id: document.id }, token)
      .then(async (data) => {
        if (cancelled) return;
        const existing = data?.sessions?.[0];
        if (existing) {
          setSessionId(existing.id);
          const sessionData = await api.getAcademicLensSession(existing.id, token);
          if (!cancelled) setMessages(sessionData?.messages || []);
        } else {
          const created = await api.createAcademicLensSession({ document_id: document.id, title: document.title || document.filename || 'Academic Lens session' }, token);
          if (!cancelled) setSessionId(created?.session?.id || null);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading((current) => ({ ...current, sessionLoading: false })); });
    api.getAcademicLensWebContexts({ document_id: document.id }, token)
      .then((data) => { if (!cancelled) { setWebContexts(data?.contexts || []); setContextStorage(data?.storage || 'database'); } })
      .catch((err) => { if (!cancelled) setErrors((current) => ({ ...current, context: err.message || 'Không thể tải web context.' })); })
      .finally(() => { if (!cancelled) setLoading((current) => ({ ...current, contextLoading: false })); });
    if (document.source_type === 'system_library') {
      api.getAcademicLensDocumentPreview(document.id, token).then((data) => { if (!cancelled) setDocument((current) => ({ ...(current || document), ...(data || {}) })); }).catch((err) => setErrors((current) => ({ ...current, preview: err.message || 'Không thể tải preview.' }))).finally(() => { if (!cancelled) setLoading((current) => ({ ...current, previewLoading: false })); });
    } else {
      setLoading((current) => ({ ...current, previewLoading: false }));
    }
    return () => { cancelled = true; };
  }, [docKey, document?.id, document?.source_type, token]);

  const uploadDocument = async (file) => {
    setLoading((current) => ({ ...current, uploading: true }));
    setErrors((current) => ({ ...current, upload: '' }));
    let previewUrl = '';
    try {
      previewUrl = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? URL.createObjectURL(file) : '';
      const data = await api.uploadAcademicLensDocument(file, token);
      selectDocument({ ...data, preview_url: previewUrl });
    } catch (err) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setErrors((current) => ({ ...current, upload: err.message || 'Không thể upload tài liệu.' }));
    } finally {
      setLoading((current) => ({ ...current, uploading: false }));
    }
  };

  const saveNotepad = async () => {
    localStorage.setItem(docKey, notepad);
    setNoteSaveStatus('saving');
    setLoading((current) => ({ ...current, savingNote: true }));
    try {
      const data = await api.saveAcademicLensNotepad({ document_id: document?.id || 'draft', session_id: sessionId, content: notepad }, token);
      setNoteStorage(data?.storage || 'database');
      setNoteSaveStatus(data?.storage === 'memory_fallback' ? 'error' : 'saved');
    } catch (err) {
      setNoteSaveStatus('error');
      setErrors((current) => ({ ...current, note: err.message || 'Lỗi lưu notepad.' }));
    } finally {
      setLoading((current) => ({ ...current, savingNote: false }));
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (document?.id || notepad) saveNotepad();
    }, 1400);
    return () => clearTimeout(timeout);
  }, [notepad, document?.id, sessionId]);

  const sendChat = async ({ message, tab }) => {
    const mode = tab || activeTab;
    const userMessage = { role: 'user', content: pendingImage ? `${message}\n[Đính kèm ảnh vùng chọn]` : message, mode };
    setMessages((current) => [...current, userMessage]);
    setLoading((current) => ({ ...current, chatSending: mode === 'document', webSearching: mode === 'web', visionAnalyzing: Boolean(pendingImage) }));
    setErrors((current) => ({ ...current, chat: '' }));
    try {
      if (pendingImage) {
        const data = await api.visionAcademicLensChat({ image_data_url: pendingImage.dataUrl, prompt: message, document_id: document?.id }, token);
        const assistant = { role: 'assistant', content: data?.answer || 'Không có phản hồi từ Vision API.', mode: 'vision', citations: data?.citations || [] };
        setMessages((current) => [...current, assistant]);
        if (sessionId) { await api.addAcademicLensSessionMessage(sessionId, userMessage, token); await api.addAcademicLensSessionMessage(sessionId, assistant, token); }
      } else if (mode === 'web') {
        const data = await api.webAcademicLensChat({ message }, token);
        const assistant = { role: 'assistant', content: data?.answer || 'Không có phản hồi.', mode: 'web', citations: data?.citations || [] };
        setMessages((current) => [...current, assistant]);
        if (sessionId) { await api.addAcademicLensSessionMessage(sessionId, userMessage, token); await api.addAcademicLensSessionMessage(sessionId, assistant, token); }
      } else {
        const data = await api.documentAcademicLensChat({ document: document ? { id: document.id, source_type: document.source_type, title: document.title, filename: document.filename, file_type: document.file_type } : null, message, chat_history: messages, enabled_web_context_ids: webContexts.filter((ctx) => ctx.enabled !== false).map((ctx) => ctx.id).filter(Boolean), session_id: sessionId }, token);
        const assistant = { role: 'assistant', content: data?.answer || 'Không có phản hồi.', mode: 'document', citations: data?.citations || [], used_web_context: data?.used_web_context };
        setMessages((current) => [...current, assistant]);
        if (sessionId) { await api.addAcademicLensSessionMessage(sessionId, userMessage, token); await api.addAcademicLensSessionMessage(sessionId, assistant, token); }
        setPendingImage(null);
        return;
      }
    } catch (err) {
      if (mode === 'web' && (err.code === 'WEB_SEARCH_NOT_CONFIGURED' || err.status === 503)) setWebConfigured(false);
      setErrors((current) => ({ ...current, chat: err.message || 'Tính năng này chưa sẵn sàng.' }));
      setMessages((current) => [...current, { role: 'assistant', content: err.message || 'Tính năng này chưa sẵn sàng.', mode, warning: mode === 'web' ? 'Global Web Chat chưa cấu hình; không tạo web result giả.' : '' }]);
    } finally {
      setPendingImage(null);
      setLoading((current) => ({ ...current, chatSending: false, webSearching: false, visionAnalyzing: false }));
    }
  };

  const handleSelectionAction = (text, action) => {
    const prompt = `[Context: "${text}"] ${action.prompt}`;
    setActiveTab(action.web ? 'web' : 'document');
    sendChat({ message: prompt, tab: action.web ? 'web' : 'document' });
  };

  const appendToNotepad = (content) => {
    setNotepad((current) => `${current}${current ? '\n\n' : ''}> AI Answer\n\n${content}`);
    if (layout.isNotepadCollapsed) {
      setNoteToast('Đã thêm vào ghi chú. Bấm “Mở ghi chú” để xem.');
      return;
    }
    setMobileTab('notes');
    setTimeout(() => notepadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };

  const resetChatHistory = () => {
    if (!messages.length) return;
    if (!window.confirm('Xóa lịch sử chat hiện tại? Tài liệu và Notepad vẫn được giữ nguyên.')) return;
    setMessages([]);
    if (sessionId) api.clearAcademicLensSessionMessages(sessionId, token).catch(() => {});
  };

  const scrollToNotepad = openNotepad;

  const addToContext = async (message) => {
    const firstCitation = message.citations?.[0] || {};
    const context = { title: firstCitation.title || 'Web context', url: firstCitation.url, content: message.content, citations: message.citations || [], session_id: sessionId, document_id: document?.id, enabled: true };
    setLoading((current) => ({ ...current, contextLoading: true }));
    try {
      const data = await api.addAcademicLensWebContext(context, token);
      setWebContexts((current) => [data?.context || context, ...current]);
      setContextStorage(data?.storage || 'database');
    } catch (err) {
      setErrors((current) => ({ ...current, context: err.message || 'Không thể thêm web context.' }));
    } finally {
      setLoading((current) => ({ ...current, contextLoading: false }));
    }
  };

  return (
    <div className="al-page">
      <style>{STYLES}</style>
      <div className="al-top-row">
        <section className="al-hero">
          <span className="al-eyebrow">Academic Lens · advanced reading workspace</span>
          <h1>Kính lúp Học thuật</h1>
          <p>Đọc, đánh dấu, chụp vùng nội dung và hỏi AI trực tiếp trên tài liệu học thuật.</p>
        </section>
        <DocumentSourceCard
          document={document}
          uploading={loading.uploading}
          onUploadClick={() => fileInputRef.current?.click()}
          onOpenLibrary={() => setLibraryOpen(true)}
        />
      </div>
      {errors.upload && <div className="al-warning"><AlertTriangle size={16} /> {errors.upload}</div>}
      {errors.preview && <div className="al-warning"><AlertTriangle size={16} /> {errors.preview}</div>}
      <input ref={fileInputRef} type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(event) => event.target.files?.[0] && uploadDocument(event.target.files[0])} />
      <div className="al-layout-shell">
        <div className="al-mobile-tabs" role="tablist" aria-label="Academic Lens mobile panels">
          <button type="button" className={mobileTab === 'document' ? 'active' : ''} onClick={() => setMobileTab('document')}><FileText size={15} /> Tài liệu</button>
          <button type="button" className={mobileTab === 'chat' ? 'active' : ''} onClick={openChat}><MessageSquareText size={15} /> Chat</button>
          <button type="button" className={mobileTab === 'notes' ? 'active' : ''} onClick={openNotepad}><NotebookPen size={15} /> Ghi chú</button>
        </div>
        <div
          className={`al-workspace dock-${layout.notepadDock} mode-${layout.academicLensLayoutMode}`}
          style={{
            gridTemplateColumns: `${layout.viewerWidth}% 10px minmax(320px, 1fr)`,
            '--chat-height': `${layout.chatHeight}px`,
          }}
        >
          <main className={`al-main ${mobileTab === 'document' ? 'mobile-active' : ''}`}>
            <DocumentToolbar
              layoutMode={layout.academicLensLayoutMode}
              notepadCollapsed={layout.isNotepadCollapsed}
              chatCollapsed={layout.isChatCollapsed}
              onToggleSnip={() => setSnipping(true)}
              onOpenNotepad={openNotepad}
              onLayoutModeChange={applyLayoutMode}
              onOpenChat={openChat}
              onResetLayout={resetLayout}
            />
            <AcademicDocumentViewer document={document} snipping={snipping} onStopSnipping={() => setSnipping(false)} onSnip={setPendingImage} onSelectionAction={handleSelectionAction} activeCitation={activeCitation} />
          </main>
          <div className="al-resizer vertical" role="separator" aria-label="Resize viewer and side panel" onPointerDown={startHorizontalResize} />
          {layout.notepadDock === 'right' ? (
            <aside className={`al-right-panel ${mobileTab === 'chat' || mobileTab === 'notes' ? 'mobile-active' : ''}`}>
              <div className={`al-right-stack ${layout.isNotepadCollapsed ? 'note-collapsed' : ''} ${layout.isChatCollapsed ? 'chat-collapsed' : ''}`}>
                {!layout.isChatCollapsed && <div className={`al-chat-pane ${mobileTab === 'chat' ? 'mobile-active' : ''}`}>
                  <AcademicChatPanel activeTab={activeTab} onTabChange={setActiveTab} messages={messages} onSend={sendChat} onReset={resetChatHistory} pendingImage={pendingImage} onClearImage={() => setPendingImage(null)} onAddToNotepad={appendToNotepad} onAddToContext={addToContext} sending={loading.chatSending || loading.webSearching || loading.visionAnalyzing} errors={errors} webConfigured={webConfigured} onOpenContexts={() => setContextDrawerOpen(true)} onCitationSelect={setActiveCitation} onCollapse={() => updateLayout({ isChatCollapsed: true })} />
                </div>}
                {!layout.isChatCollapsed && !layout.isNotepadCollapsed && <div className="al-resizer horizontal" role="separator" aria-label="Resize chat and notes" onPointerDown={startRightStackResize} />}
                {!layout.isNotepadCollapsed && (
                  <div className={`al-note-pane ${mobileTab === 'notes' ? 'mobile-active' : ''}`}>
                    <AcademicNotepad ref={notepadRef} value={notepad} onChange={(value) => { setNoteSaveStatus('idle'); setNotepad(value); }} onSave={saveNotepad} saveStatus={noteSaveStatus} storage={noteStorage} dock={layout.notepadDock} onDockChange={(notepadDock) => updateLayout({ notepadDock, isNotepadCollapsed: false })} onCollapse={() => updateLayout({ isNotepadCollapsed: true })} />
                  </div>
                )}
              </div>
            </aside>
          ) : (
            <aside className={`al-right-panel ${mobileTab === 'chat' ? 'mobile-active' : ''}`}>
              {!layout.isChatCollapsed && <div className={`al-chat-pane ${mobileTab === 'chat' ? 'mobile-active' : ''}`}>
                <AcademicChatPanel activeTab={activeTab} onTabChange={setActiveTab} messages={messages} onSend={sendChat} onReset={resetChatHistory} pendingImage={pendingImage} onClearImage={() => setPendingImage(null)} onAddToNotepad={appendToNotepad} onAddToContext={addToContext} sending={loading.chatSending || loading.webSearching || loading.visionAnalyzing} errors={errors} webConfigured={webConfigured} onOpenContexts={() => setContextDrawerOpen(true)} onCitationSelect={setActiveCitation} onCollapse={() => updateLayout({ isChatCollapsed: true })} />
              </div>}
              {layout.isChatCollapsed && <div className="al-collapsed-placeholder">AI ChatBox đang ẩn. Bấm “Mở Chat” để tiếp tục hỏi Document AI.</div>}
            </aside>
          )}
          {layout.notepadDock === 'bottom' && !layout.isNotepadCollapsed && <div className="al-resizer horizontal" role="separator" aria-label="Resize bottom notes" onPointerDown={startBottomNoteResize} />}
          {layout.notepadDock === 'bottom' && !layout.isNotepadCollapsed && (
            <section className={`al-bottom-note ${mobileTab === 'notes' ? 'mobile-active' : ''}`} style={{ height: `${layout.notepadHeight}px` }}>
              <AcademicNotepad ref={notepadRef} value={notepad} onChange={(value) => { setNoteSaveStatus('idle'); setNotepad(value); }} onSave={saveNotepad} saveStatus={noteSaveStatus} storage={noteStorage} dock={layout.notepadDock} onDockChange={(notepadDock) => updateLayout({ notepadDock, isNotepadCollapsed: false })} onCollapse={() => updateLayout({ isNotepadCollapsed: true })} />
            </section>
          )}
        </div>
      </div>
      {layout.isChatCollapsed && <button type="button" className="al-floating-chat" onClick={openChat} title="Mở Chat"><MessageSquareText size={16} /> Mở Chat</button>}
      {layout.isNotepadCollapsed && <button type="button" className="al-floating-note" onClick={openNotepad} title="Mở ghi chú"><NotebookPen size={16} /> Mở ghi chú</button>}
      {noteToast && <div className="al-note-toast">{noteToast}</div>}
      <WebContextDrawer open={contextDrawerOpen} contexts={webContexts} loading={loading.contextLoading} error={errors.context} storage={contextStorage} onClose={() => setContextDrawerOpen(false)} onToggle={async (ctx, enabled) => { setWebContexts((current) => current.map((item) => item.id === ctx.id ? { ...item, enabled } : item)); if (ctx.id) await api.updateAcademicLensWebContext(ctx.id, { enabled }, token).catch(() => setContextStorage('memory_fallback')); }} onDelete={async (ctx) => { setWebContexts((current) => current.filter((item) => item !== ctx && item.id !== ctx.id)); if (ctx.id) await api.deleteAcademicLensWebContext(ctx.id, token).catch(() => setContextStorage('memory_fallback')); }} />
      <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} onSelect={selectDocument} />
    </div>
  );
}
