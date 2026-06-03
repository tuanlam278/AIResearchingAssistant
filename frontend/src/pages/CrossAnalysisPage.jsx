import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Columns, Download, FileText, GitCompare, Info, Loader2, Merge, MessageSquare, Save, Search, UploadCloud, Trash2, WandSparkles, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const CRITERIA = [
  { key: 'problem_motivation', label: 'Vấn đề & Động lực nghiên cứu', hint: 'Mục tiêu, giả định và động lực nghiên cứu.' },
  { key: 'methodology', label: 'Phương pháp tiếp cận', hint: 'Thuật toán, kiến trúc, tính mới và chi phí.' },
  { key: 'datasets_experimental_setup', label: 'Dữ liệu & Thiết lập thực nghiệm', hint: 'Datasets, baselines, metrics và fairness.' },
  { key: 'results_tradeoffs', label: 'Kết quả & Đánh đổi', hint: 'Điều kiện thắng, ablation, tốc độ và độ chính xác.' },
  { key: 'scalability_limitations', label: 'Khả năng mở rộng & Hạn chế', hint: 'Ứng dụng thực tiễn, rủi ro production, future work.' },
  { key: 'contribution', label: 'Đóng góp chính', hint: 'Đóng góp, giá trị mới và phạm vi ảnh hưởng.' },
  { key: 'clarity', label: 'Độ rõ ràng', hint: 'Cấu trúc trình bày và mức độ dễ đọc.' },
  { key: 'relevance', label: 'Mức độ liên quan', hint: 'Mức độ phù hợp với mục tiêu đọc.' },
  { key: 'practical_value', label: 'Giá trị thực tiễn', hint: 'Khả năng ứng dụng và tác động thực tế.' },
  { key: 'limitations', label: 'Hạn chế', hint: 'Điểm yếu và rủi ro diễn giải.' },
  { key: 'complexity', label: 'Độ phức tạp', hint: 'Compute, bộ nhớ, latency và tài nguyên.' },
  { key: 'dependencies', label: 'Phụ thuộc kỹ thuật', hint: 'Thư viện, dữ liệu, mô hình, hạ tầng.' },
  { key: 'deployment_risk', label: 'Rủi ro triển khai', hint: 'Rủi ro production, bảo mật và vận hành.' },
  { key: 'scalability', label: 'Khả năng mở rộng', hint: 'Mở rộng dữ liệu, người dùng và hạ tầng.' },
  { key: 'cost', label: 'Chi phí', hint: 'Compute, vận hành, nhân lực và hạ tầng.' },
  { key: 'research_gap', label: 'Khoảng trống nghiên cứu', hint: 'Gap trong literature và câu hỏi mở.' },
  { key: 'novelty', label: 'Tính mới', hint: 'Đóng góp mới và khác biệt.' },
  { key: 'assumptions', label: 'Giả định', hint: 'Điều kiện và tiền đề áp dụng.' },
  { key: 'disagreement', label: 'Điểm bất đồng', hint: 'Các nhận định hoặc kết quả không thống nhất.' },
  { key: 'future_work', label: 'Hướng nghiên cứu tiếp theo', hint: 'Future work và mở rộng.' },
];

const PRESETS = [
  { key: 'academic', label: 'So sánh học thuật', criteria: ['problem_motivation', 'methodology', 'datasets_experimental_setup', 'results_tradeoffs', 'scalability_limitations'] },
  { key: 'reading_choice', label: 'Chọn tài liệu nên đọc', criteria: ['contribution', 'clarity', 'relevance', 'practical_value', 'limitations'] },
  { key: 'technical_deployment', label: 'Triển khai kỹ thuật', criteria: ['complexity', 'dependencies', 'deployment_risk', 'scalability', 'cost'] },
  { key: 'literature_review', label: 'Viết literature review', criteria: ['research_gap', 'novelty', 'assumptions', 'disagreement', 'future_work'] },
  { key: 'custom', label: 'Custom', criteria: [] },
];

const STYLES = `
  .ca-page { min-height: 100vh; padding: 30px clamp(18px, 3vw, 42px) 60px; background: radial-gradient(ellipse at 44% 0%, rgba(196,164,100,0.12), transparent 44%), #0f0d0a; color: #e8dfd0; font-family: 'Lora', Georgia, serif; }
  .ca-page button, .ca-page input, .ca-page textarea { font-family: inherit; }
  .ca-hero { border: 1px solid rgba(255,255,255,.08); border-radius: 28px; padding: clamp(22px, 4vw, 38px); background: radial-gradient(circle at 84% 20%, rgba(112,88,42,.32), transparent 30%), linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); box-shadow: 0 28px 90px rgba(0,0,0,.32); }
  .ca-eyebrow { display: inline-flex; align-items: center; gap: 8px; color: #d8bd77; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .ca-hero h1 { margin: 12px 0 10px; font-size: clamp(30px, 5vw, 54px); line-height: 1.04; color: #f3ebdc; }
  .ca-hero p { max-width: 840px; color: #a99e8e; line-height: 1.7; }
  .ca-section { margin-top: 20px; border: 1px solid rgba(255,255,255,.08); border-radius: 24px; background: rgba(255,255,255,.035); box-shadow: 0 20px 70px rgba(0,0,0,.24); padding: 18px; }
  .ca-section-title { display:flex; align-items:center; gap: 10px; margin: 0 0 14px; color:#f2d48b; font-size: 18px; }
  .ca-picker-grid, .ca-split { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
  .ca-slot, .ca-doc-panel { border: 1px solid rgba(255,255,255,.08); border-radius: 20px; background: rgba(0,0,0,.18); padding: 16px; min-height: 190px; }
  .ca-slot { display:flex; flex-direction:column; height:100%; }
  .ca-slot-content { flex:1; min-height:0; }
  .ca-slot-actions { margin-top:auto; padding-top:14px; }
  .ca-slot-head { display:flex; align-items:center; justify-content: space-between; gap:12px; color:#d8caa8; }
  .ca-slot-label { display:flex; align-items:center; gap:8px; font-weight: 800; color:#f3ebdc; }
  .ca-doc-title { margin: 14px 0 8px; font-size: 18px; color:#f3ebdc; }
  .ca-muted { color:#928777; font-size: 13px; line-height: 1.6; }
  .ca-actions { display:flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  .ca-btn { border:0; border-radius: 14px; padding: 11px 15px; display:inline-flex; align-items:center; justify-content:center; gap:8px; background: rgba(255,255,255,.06); color:#d8caa8; cursor:pointer; border:1px solid rgba(255,255,255,.08); }
  .ca-btn:hover { color:#f5db98; border-color: rgba(196,164,100,.25); }
  .ca-btn.primary { background: linear-gradient(135deg, #d4b66f, #8a6a30); color:#18130d; font-weight:900; border:0; }
  .ca-btn.danger { color:#ffb4a8; }
  .ca-btn:disabled { opacity:.45; cursor:not-allowed; }
  .ca-warning { margin-top: 12px; border: 1px solid rgba(224,120,120,.24); background: rgba(224,120,120,.08); color:#f0b5aa; border-radius: 15px; padding: 11px 13px; display:flex; gap:8px; align-items:flex-start; }
  .ca-collapse-text { margin: 10px 0 0; }
  .ca-collapse-text__body { margin:0; }
  .ca-link-btn { border:0; background:transparent; color:#f2d48b; padding:4px 0; font-weight:800; cursor:pointer; }
  .ca-selected-criteria { margin-top:14px; border:1px solid rgba(212,182,111,.18); background:rgba(212,182,111,.07); border-radius:16px; padding:12px; }
  .ca-selected-criteria ul { display:flex; flex-wrap:wrap; gap:8px; padding:0; margin:8px 0 0; list-style:none; }
  .ca-selected-criteria li { border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:6px 10px; background:rgba(0,0,0,.16); color:#d8cfc0; font-size:12px; }
  .ca-criteria { display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: repeat(4, auto); gap:10px; margin-top:14px; }
  .ca-criterion { display:flex; gap:10px; align-items:flex-start; padding: 12px; border-radius:16px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.14); cursor:pointer; }
  .ca-criterion input { margin-top:3px; accent-color:#d4b66f; }
  .ca-criterion strong { display:block; color:#f0e5d5; font-size:13px; }
  .ca-criterion span { display:block; color:#8d8374; font-size:12px; margin-top:4px; line-height:1.45; }
  .ca-toolbar { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; }
  .ca-table-wrap { overflow:auto; max-height: 520px; border-radius:18px; border:1px solid rgba(255,255,255,.08); }
  .ca-table { width:100%; border-collapse:collapse; min-width:920px; background: rgba(0,0,0,.16); }
  .ca-table th, .ca-table td { padding: 13px 14px; border-bottom:1px solid rgba(255,255,255,.07); text-align:left; vertical-align:top; color:#d8cfc0; line-height:1.55; }
  .ca-table th { position:sticky; top:0; background:#1a160f; color:#f2d48b; z-index:1; }
  .ca-confidence { white-space:nowrap; color:#9fd0aa; font-weight:800; }
  .ca-confidence.unknown { color:#c5b8a6; font-weight:700; white-space:normal; }

  .ca-confidence-head { display:inline-flex; align-items:center; gap:6px; position:relative; }
  .ca-info { display:inline-flex; align-items:center; color:#d8bd77; cursor:help; }
  .ca-info-tip { position:absolute; right:0; top:calc(100% + 8px); width:min(340px, 70vw); opacity:0; pointer-events:none; transform:translateY(-4px); transition:opacity .15s ease, transform .15s ease; padding:10px 12px; border:1px solid rgba(196,164,100,.24); border-radius:12px; background:#17130d; color:#d8cfc0; box-shadow:0 14px 36px rgba(0,0,0,.36); font-size:12px; line-height:1.5; z-index:3; white-space:normal; }
  .ca-confidence-head:hover .ca-info-tip, .ca-confidence-head:focus-within .ca-info-tip { opacity:1; transform:translateY(0); }
  .ca-doc-panel { min-height: 72vh; height: min(82vh, 920px); overflow:hidden; display:flex; flex-direction:column; gap:12px; padding:0; }
  .ca-doc-panel__header { padding:16px 16px 0; }
  .ca-doc-panel h3 { margin: 0 0 8px; color:#f3ebdc; }
  .ca-doc-panel__body { flex:1; min-height:0; overflow:auto; padding:0 16px 16px; }
  .ca-text-preview-label { display:inline-flex; align-items:center; gap:6px; width:max-content; margin:0 0 12px; border:1px solid rgba(196,164,100,.22); background:rgba(196,164,100,.08); color:#f2d48b; border-radius:999px; padding:6px 10px; font-size:12px; font-weight:800; }
  .ca-text-preview { white-space:pre-wrap; line-height:1.72; color:#ded4c4; }
  .ca-chat-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
  .ca-pdf-viewer { flex:1; min-height:0; display:flex; flex-direction:column; border-top:1px solid rgba(255,255,255,.07); background:#111; }
  .ca-pdf-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding:10px 12px; background:rgba(255,255,255,.045); border-bottom:1px solid rgba(255,255,255,.07); }
  .ca-pdf-frame { flex:1; width:100%; min-height:620px; border:0; background:#1d1d1d; }
  .ca-pdf-state { flex:1; display:grid; place-items:center; min-height:360px; padding:18px; text-align:center; }
  .ca-snippet { margin-top: 12px; padding: 12px; border-radius:15px; background:rgba(255,255,255,.045); color:#bfb4a3; line-height:1.6; font-size:13px; }
  .ca-chat-log { display:grid; gap:10px; max-height: 360px; overflow:auto; padding-right:4px; }
  .ca-message { border-radius:16px; padding:12px 14px; line-height:1.6; white-space:pre-wrap; }
  .ca-message.user { margin-left:auto; max-width:80%; background:rgba(212,182,111,.16); color:#f4e7ca; }
  .ca-message.assistant { background:rgba(255,255,255,.045); color:#d8cfc0; }
  .ca-chat-form { display:grid; grid-template-columns: 1fr auto; gap:10px; margin-top:12px; }
  .ca-chat-form textarea, .ca-modal-search { width:100%; border:1px solid rgba(255,255,255,.09); background:rgba(0,0,0,.22); color:#eee6d8; border-radius:15px; padding:12px; outline:none; resize:vertical; }
  .ca-result-box { margin-top:14px; border:1px solid rgba(196,164,100,.18); background:rgba(196,164,100,.07); border-radius:18px; padding:14px; color:#d8cfc0; line-height:1.6; }
  .ca-modal-backdrop { position:fixed; inset:0; z-index:90; background:rgba(0,0,0,.7); backdrop-filter: blur(5px); display:grid; place-items:center; padding:20px; }
  .ca-modal { width:min(880px, 100%); max-height:85vh; overflow:auto; border:1px solid rgba(255,255,255,.1); border-radius:24px; background:#17130e; padding:18px; box-shadow: 0 30px 100px rgba(0,0,0,.55); }
  .ca-modal-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .ca-modal-list { display:grid; gap:10px; margin-top:12px; }
  .ca-modal-doc { text-align:left; border:1px solid rgba(255,255,255,.08); border-radius:16px; background:rgba(255,255,255,.035); padding:12px; color:#d8cfc0; cursor:pointer; }
  .ca-modal-doc:hover { border-color:rgba(196,164,100,.28); }

  .ca-preset-grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:14px; }
  .ca-preset { text-align:left; border:1px solid rgba(255,255,255,.08); border-radius:16px; background:rgba(0,0,0,.14); color:#d8cfc0; padding:12px; cursor:pointer; }
  .ca-preset.active { border-color:rgba(212,182,111,.45); background:rgba(212,182,111,.12); color:#f2d48b; }
  .ca-filters { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:12px 0; }
  .ca-select { border:1px solid rgba(255,255,255,.09); background:#17130e; color:#eee6d8; border-radius:12px; padding:9px 11px; }
  .ca-status { display:inline-flex; border-radius:999px; padding:4px 9px; font-size:11px; font-weight:900; border:1px solid rgba(255,255,255,.1); color:#f2d48b; background:rgba(196,164,100,.08); }
  .ca-expand-btn { padding:6px 8px; border-radius:10px; }
  .ca-expanded { background:rgba(0,0,0,.2); }
  .ca-evidence-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
  .ca-evidence-card { border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:12px; background:rgba(255,255,255,.035); }
  .ca-evidence-card h4 { margin:0 0 8px; color:#f2d48b; }
  .ca-evidence-item { margin-top:9px; padding-top:9px; border-top:1px solid rgba(255,255,255,.07); }
  .ca-evidence-meta { color:#d8bd77; font-size:12px; font-weight:800; }
  .ca-row-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  .ca-mini-btn { border-radius:999px; padding:7px 10px; font-size:12px; }
  .ca-quick { border:1px solid rgba(104,185,132,.2); background:rgba(104,185,132,.07); border-radius:18px; padding:14px; margin:12px 0; color:#d8cfc0; }
  .ca-quick h3 { margin:0 0 8px; color:#aee0bb; }
  .ca-quick-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
  .ca-sessions { margin-top:14px; border-top:1px solid rgba(255,255,255,.08); padding-top:12px; }
  .ca-session-list { display:grid; gap:8px; margin-top:8px; }
  .ca-session-row { display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:stretch; }
  .ca-session { text-align:left; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.035); color:#d8cfc0; border-radius:12px; padding:9px; cursor:pointer; }
  .ca-session-delete { padding:9px 11px; border-radius:12px; }
  .ca-chat-context { margin:0 0 10px; border:1px solid rgba(212,182,111,.25); background:rgba(212,182,111,.08); color:#f2d48b; border-radius:14px; padding:10px; display:flex; justify-content:space-between; gap:10px; }
  @media (max-width: 1100px) { .ca-criteria { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows:auto; } }
  @media (max-width: 900px) { .ca-picker-grid, .ca-split, .ca-evidence-grid { grid-template-columns: 1fr; } .ca-chat-form { grid-template-columns: 1fr; } .ca-criteria { grid-template-columns: 1fr; } .ca-session-row { grid-template-columns: 1fr; } }
`;

function sourceLabel(doc) {
  if (!doc) return 'Chưa chọn';
  return doc.source_type === 'system_library' ? 'Thư viện Hệ thống' : 'File upload tạm';
}

function isPdfDocument(doc) {
  const fileType = String(doc?.file_type || '').toLowerCase();
  const filename = String(doc?.filename || doc?.title || '').toLowerCase();
  return fileType.includes('pdf') || filename.endsWith('.pdf');
}

function documentExtension(doc) {
  const fileType = String(doc?.file_type || '').toLowerCase();
  const filename = String(doc?.filename || doc?.title || '').toLowerCase();
  if (fileType.includes('docx') || filename.endsWith('.docx')) return 'docx';
  if (fileType.includes('markdown') || fileType === 'md' || filename.endsWith('.md')) return 'md';
  if (fileType.includes('text') || fileType === 'txt' || filename.endsWith('.txt')) return 'txt';
  return fileType || filename.split('.').pop() || 'file';
}

const CRITERION_LABELS = {
  problem_motivation: 'Vấn đề & Động lực nghiên cứu',
  methodology: 'Phương pháp tiếp cận',
  datasets_experiments: 'Dữ liệu & Thiết lập thực nghiệm',
  contribution: 'Đóng góp chính',
  clarity: 'Độ rõ ràng',
  relevance: 'Mức độ liên quan',
  practical_value: 'Giá trị thực tiễn',
  dependencies: 'Phụ thuộc kỹ thuật',
  deployment_risk: 'Rủi ro triển khai',
  scalability: 'Khả năng mở rộng',
  cost: 'Chi phí',
  research_gap: 'Khoảng trống nghiên cứu',
  assumptions: 'Giả định',
  disagreement: 'Điểm bất đồng',
  future_work: 'Hướng nghiên cứu tiếp theo',
  datasets_experimental_setup: 'Dữ liệu & Thiết lập thực nghiệm',
  results_tradeoffs: 'Kết quả & Đánh đổi',
  scalability_limitations: 'Khả năng mở rộng & Hạn chế',
  novelty: 'Tính mới',
  complexity: 'Chi phí tính toán / Độ phức tạp',
  baselines_metrics: 'Baseline & Chỉ số đánh giá',
  practical_application: 'Khả năng ứng dụng thực tế',
  limitations: 'Hạn chế',
};

function mapCriterionLabel(criterion = '', explicitLabel = '') {
  if (explicitLabel) return explicitLabel;
  const key = String(criterion || '').trim();
  if (!key) return 'Tiêu chí chưa đặt tên';
  if (CRITERION_LABELS[key]) return CRITERION_LABELS[key];
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatConfidence(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 'Chưa đủ dữ liệu';
  const percent = confidence >= 0 && confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(Math.max(0, Math.min(percent, 100)))}%`;
}

function confidenceTitle(row = {}) {
  const basis = row.confidence_basis || {};
  if (basis.reason) return basis.reason;
  if (typeof row.confidence === 'number' && Number.isFinite(row.confidence)) {
    const score = typeof basis.avg_score === 'number' ? ` và điểm truy xuất trung bình ${basis.avg_score.toFixed(2)}` : '';
    return `Dựa trên ${basis.evidence_count_a || 0} bằng chứng A và ${basis.evidence_count_b || 0} bằng chứng B${score}.`;
  }
  return 'Chưa đủ dữ liệu nguồn để ước tính.';
}

function previewTextFromDocument(doc) {
  const snippets = (doc?.snippets || []).map((snippet) => snippet.content).filter(Boolean).join('\n\n');
  return doc?.extracted_text || doc?.preview_text || snippets || doc?.summary || '';
}

function revokePreviewUrl(doc) {
  if (doc?.preview_url && doc?.preview_url_owner === 'cross-analysis') {
    URL.revokeObjectURL(doc.preview_url);
  }
}

function toDocumentRef(doc) {
  if (!doc) return null;
  return { id: doc.id, source_type: doc.source_type, title: doc.title, filename: doc.filename, file_type: doc.file_type };
}

const CROSS_ANALYSIS_DRAFT_KEY = 'cross-analysis-current-draft-v1';
let crossAnalysisMemoryDraft = null;

function stripVolatileDocumentFields(doc) {
  if (!doc) return null;
  const { preview_url: _previewUrl, preview_url_owner: _previewUrlOwner, mime_type: _mimeType, ...rest } = doc;
  return rest;
}

function createSessionTitle(documentA, documentB) {
  return `${documentA?.title || documentA?.filename || 'A'} ↔ ${documentB?.title || documentB?.filename || 'B'}`;
}

function buildCrossAnalysisSessionBody({ documentA, documentB, selectedPreset, selectedCriteria, comparisonResult, chatMessages }) {
  return {
    title: createSessionTitle(documentA, documentB),
    document_a_ref: toDocumentRef(documentA),
    document_b_ref: toDocumentRef(documentB),
    selected_preset: selectedPreset,
    selected_criteria: selectedCriteria,
    comparison_result: comparisonResult,
    chat_history: chatMessages,
  };
}

function hasCrossAnalysisDraftContent(draft) {
  return Boolean(draft?.documentA || draft?.documentB || draft?.comparisonResult || draft?.chatMessages?.length);
}

function sanitizeCrossAnalysisDraft(draft) {
  if (!draft) return null;
  return {
    ...draft,
    documentA: stripVolatileDocumentFields(draft.documentA),
    documentB: stripVolatileDocumentFields(draft.documentB),
  };
}

function loadStoredCrossAnalysisDraft() {
  if (crossAnalysisMemoryDraft) return crossAnalysisMemoryDraft;
  try {
    const raw = window.sessionStorage.getItem(CROSS_ANALYSIS_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeCrossAnalysisDraft(draft) {
  crossAnalysisMemoryDraft = draft;
  try {
    if (hasCrossAnalysisDraftContent(draft)) {
      window.sessionStorage.setItem(CROSS_ANALYSIS_DRAFT_KEY, JSON.stringify(sanitizeCrossAnalysisDraft(draft)));
    } else {
      window.sessionStorage.removeItem(CROSS_ANALYSIS_DRAFT_KEY);
    }
  } catch {
    // Session persistence is best-effort; keep the in-memory draft for same-tab navigation.
  }
}

function sameDocument(a, b) {
  return Boolean(a && b && a.source_type === b.source_type && String(a.id) === String(b.id));
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows) {
  const headers = ['Tiêu chí', 'Tài liệu A', 'Tài liệu B', 'Nhận xét so sánh', 'Độ tin cậy'];
  const lines = [headers.map(escapeCsv).join(','), ...rows.map((row) => [mapCriterionLabel(row.criterion, row.criterion_label), row.document_a, row.document_b, row.analysis, formatConfidence(row.confidence)].map(escapeCsv).join(','))];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cross-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


const STATUS_LABELS = {
  similar: 'Giống nhau',
  different: 'Khác nhau',
  conflict: 'Mâu thuẫn',
  missing_information: 'Thiếu thông tin',
  needs_review: 'Cần kiểm tra',
};

function confidenceBasisText(row = {}) {
  return row.confidence_basis?.reason || confidenceTitle(row);
}

function downloadMarkdown(result, rows) {
  if (!result) return;
  const qc = result.quick_conclusion || {};
  const lines = ['# Đối chiếu Hai Tài liệu', ''];
  if (qc.summary) lines.push('## Kết luận nhanh', '', qc.summary, '');
  const sections = [
    ['Giống nhau', qc.similarities],
    ['Khác nhau chính', qc.key_differences],
    ['Mâu thuẫn đáng chú ý', qc.notable_conflicts],
    ['Điểm cần kiểm chứng', qc.needs_verification],
  ];
  sections.forEach(([title, items]) => {
    if (items?.length) lines.push(`### ${title}`, ...items.map((item) => `- ${item}`), '');
  });
  if (qc.recommended_reading_order) lines.push('### Nên đọc trước', qc.recommended_reading_order, '');
  lines.push('## Bảng so sánh', '', '| Tiêu chí | Tài liệu A | Tài liệu B | Nhận xét | Status | Confidence |', '|---|---|---|---|---|---|');
  rows.forEach((row) => {
    lines.push(`| ${mapCriterionLabel(row.criterion, row.criterion_label)} | ${String(row.document_a || '').replace(/\|/g, '\\|')} | ${String(row.document_b || '').replace(/\|/g, '\\|')} | ${String(row.analysis || '').replace(/\|/g, '\\|')} | ${STATUS_LABELS[row.status] || row.status || ''} | ${formatConfidence(row.confidence)} |`);
  });
  rows.forEach((row) => {
    lines.push('', `## Evidence: ${mapCriterionLabel(row.criterion, row.criterion_label)}`, '', `Confidence basis: ${confidenceBasisText(row)}`, '');
    [['A', row.evidence_a], ['B', row.evidence_b]].forEach(([label, evidence]) => {
      lines.push(`### Tài liệu ${label}`);
      if (!evidence?.length) lines.push('- Không tìm thấy bằng chứng hợp lệ.');
      (evidence || []).forEach((item) => lines.push(`- ${item.document_title || 'Tài liệu'} · trang ${item.page ?? '?'} · ${item.section || 'Không rõ section'} · score ${typeof item.score === 'number' ? item.score.toFixed(2) : 'N/A'}\n  > ${item.snippet || ''}`));
      lines.push('');
    });
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `doi-chieu-hai-tai-lieu-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function CollapsibleText({ children, limit = 260, className = 'ca-muted', label = 'nội dung' }) {
  const [expanded, setExpanded] = useState(false);
  const text = String(children || '').trim();
  if (!text) return null;
  const shouldCollapse = text.length > limit;
  const visibleText = shouldCollapse && !expanded ? `${text.slice(0, limit).trim()}…` : text;
  return (
    <div className="ca-collapse-text">
      <p className={`${className} ca-collapse-text__body`}>{visibleText}</p>
      {shouldCollapse && (
        <button className="ca-link-btn" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? `Thu gọn ${label}` : `Xem thêm ${label}`}
        </button>
      )}
    </div>
  );
}

function DocumentSlot({ label, document, onUpload, onOpenLibrary, onClear, uploading }) {
  const inputRef = useRef(null);
  return (
    <section className="ca-slot">
      <div className="ca-slot-head">
        <span className="ca-slot-label"><FileText size={18} /> {label}</span>
        {document && <button className="ca-btn danger" type="button" onClick={onClear}><X size={15} /> Bỏ chọn</button>}
      </div>
      <div className="ca-slot-content">
        {document ? (
          <>
            <h3 className="ca-doc-title">{document.title || document.filename}</h3>
            <p className="ca-muted">{sourceLabel(document)} · {document.file_type || 'FILE'} · {document.status || (document.is_vector_ready ? 'RAG ready' : 'Đã chọn')}</p>
            {document.summary && <CollapsibleText label="tóm tắt">{document.summary}</CollapsibleText>}
            {Boolean(document.snippets?.length) && (
              <div className="ca-muted">
                <b>Preview:</b>
                <CollapsibleText label="preview" limit={220}>{document.snippets[0].content}</CollapsibleText>
              </div>
            )}
          </>
        ) : (
          <p className="ca-muted" style={{ marginTop: 16 }}>Upload file từ máy hoặc chọn tài liệu đã chuẩn hóa trong Thư viện Hệ thống.</p>
        )}
      </div>
      <div className="ca-actions ca-slot-actions">
        <input ref={inputRef} type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
        <button className="ca-btn" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? <Loader2 size={16} /> : <UploadCloud size={16} />} Upload File</button>
        <button className="ca-btn" type="button" onClick={onOpenLibrary}><Search size={16} /> Chọn từ Thư viện Hệ thống</button>
      </div>
    </section>
  );
}

function SystemDocumentPickerModal({ open, onClose, onSelect }) {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.listSystemLibraryDocuments({ q: query }, token)
      .then((data) => { if (!cancelled) setDocuments(data?.documents || data?.items || []); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Không thể tải Thư viện Hệ thống.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, query, token]);

  if (!open) return null;
  return (
    <div className="ca-modal-backdrop" onClick={onClose}>
      <section className="ca-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ca-modal-head">
          <h2 className="ca-section-title"><Search size={18} /> Chọn từ Thư viện Hệ thống</h2>
          <button className="ca-btn" type="button" onClick={onClose}><X size={16} /> Đóng</button>
        </div>
        <input className="ca-modal-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên, tag, chủ đề..." />
        {error && <div className="ca-warning"><AlertTriangle size={16} /> {error}</div>}
        {loading ? <p className="ca-muted" style={{ marginTop: 12 }}>Đang tải tài liệu...</p> : (
          <div className="ca-modal-list">
            {documents.map((doc) => (
              <button key={doc.id} className="ca-modal-doc" type="button" onClick={() => { onSelect({ ...doc, source_type: 'system_library' }); onClose(); }}>
                <strong>{doc.title || doc.filename}</strong>
                <p className="ca-muted">{doc.category || 'Khác'} · {doc.file_type || 'FILE'} · {doc.is_vector_ready ? 'RAG ready' : 'Chưa vector ready'}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


function QuickConclusionCard({ conclusion }) {
  if (!conclusion) return null;
  const blocks = [
    ['Giống nhau', conclusion.similarities],
    ['Khác nhau chính', conclusion.key_differences],
    ['Mâu thuẫn đáng chú ý', conclusion.notable_conflicts],
    ['Cần kiểm chứng lại', conclusion.needs_verification],
  ];
  return (
    <div className="ca-quick">
      <h3>Kết luận nhanh</h3>
      {conclusion.summary && <p>{conclusion.summary}</p>}
      <div className="ca-quick-grid">
        {blocks.map(([title, items]) => (
          <div key={title}>
            <strong>{title}</strong>
            {items?.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="ca-muted">Chưa có điểm nổi bật.</p>}
          </div>
        ))}
      </div>
      {conclusion.recommended_reading_order && <p><b>Nên đọc trước:</b> {conclusion.recommended_reading_order}</p>}
    </div>
  );
}

function EvidenceList({ title, evidence }) {
  return (
    <div className="ca-evidence-card">
      <h4>{title}</h4>
      {evidence?.length ? evidence.map((item, index) => (
        <div className="ca-evidence-item" key={`${item.document_id}-${item.page}-${index}`}>
          <div className="ca-evidence-meta">{item.document_title} · Trang {item.page} · {item.section || 'Không rõ section'} · Score {typeof item.score === 'number' ? item.score.toFixed(2) : 'N/A'}</div>
          <p>{item.snippet}</p>
        </div>
      )) : <p className="ca-muted">Không tìm thấy bằng chứng hợp lệ cho phía này.</p>}
    </div>
  );
}

function ComparisonTable({ rows, onAskRow }) {
  const [expanded, setExpanded] = useState({});
  if (!rows.length) return <p className="ca-muted">Bảng sẽ xuất hiện ngay dưới phần chọn tài liệu sau khi bấm “Phân tích”.</p>;
  const toggle = (index) => setExpanded((current) => ({ ...current, [index]: !current[index] }));
  const copyRow = (row) => navigator.clipboard?.writeText(JSON.stringify(row, null, 2));
  return (
    <div className="ca-table-wrap">
      <table className="ca-table">
        <thead><tr><th></th><th>Tiêu chí</th><th>Tài liệu A</th><th>Tài liệu B</th><th>Nhận xét so sánh</th><th>Status</th><th><span className="ca-confidence-head">Độ tin cậy <span className="ca-info" tabIndex={0} aria-label="Giải thích độ tin cậy"><Info size={14} /><span className="ca-info-tip" role="tooltip">Độ tin cậy được ước tính dựa trên mức độ liên quan của các đoạn tài liệu được truy xuất, số lượng bằng chứng hỗ trợ và việc hai tài liệu có đủ nguồn đối chiếu hay không. Đây không phải xác suất đúng tuyệt đối.</span></span></span></th></tr></thead>
        <tbody>{rows.map((row, index) => (
          <FragmentRow key={`${row.criterion}-${index}`} row={row} index={index} expanded={Boolean(expanded[index])} onToggle={() => toggle(index)} onAskRow={onAskRow} onCopy={copyRow} />
        ))}</tbody>
      </table>
    </div>
  );
}

function FragmentRow({ row, index, expanded, onToggle, onAskRow, onCopy }) {
  const warnings = row.confidence_basis?.warnings || [];
  return (
    <>
      <tr>
        <td><button className="ca-btn ca-expand-btn" type="button" onClick={onToggle} aria-label="Mở bằng chứng">{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button></td>
        <td>{row.criterion_display}</td><td>{row.document_a}</td><td>{row.document_b}</td><td>{row.analysis}</td><td><span className="ca-status">{STATUS_LABELS[row.status] || row.status || 'Cần kiểm tra'}</span></td><td className={`ca-confidence ${typeof row.confidence === 'number' ? '' : 'unknown'}`} title={confidenceBasisText(row)}>{formatConfidence(row.confidence)}</td>
      </tr>
      {expanded && <tr className="ca-expanded"><td colSpan={7}>
        <div className="ca-evidence-grid"><EvidenceList title="Evidence từ tài liệu A" evidence={row.evidence_a} /><EvidenceList title="Evidence từ tài liệu B" evidence={row.evidence_b} /></div>
        <div className="ca-snippet"><b>Lý do confidence:</b> {confidenceBasisText(row)}{warnings.length ? <ul>{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : null}</div>
        <div className="ca-row-actions">
          <button className="ca-btn ca-mini-btn" type="button" onClick={onToggle}>Xem bằng chứng</button>
          <button className="ca-btn ca-mini-btn" type="button" onClick={() => onAskRow(row, 'Hỏi về dòng này')}>Hỏi về dòng này</button>
          <button className="ca-btn ca-mini-btn" type="button" onClick={() => onAskRow(row, 'Giải thích kỹ hơn dòng này')}>Giải thích kỹ hơn</button>
          <button className="ca-btn ca-mini-btn" type="button" onClick={() => onAskRow(row, 'Tìm bằng chứng thêm cho dòng này')}>Tìm bằng chứng thêm</button>
          <button className="ca-btn ca-mini-btn" type="button" onClick={() => onAskRow(row, 'Viết lại dòng này thành đoạn văn học thuật')}>Viết lại học thuật</button>
          <button className="ca-btn ca-mini-btn" type="button" onClick={() => onAskRow(row, 'Đưa dòng này vào ghi chú')}>Đưa vào ghi chú</button>
          <button className="ca-btn ca-mini-btn" type="button" onClick={() => onCopy(row)}>Copy row</button>
        </div>
      </td></tr>}
    </>
  );
}

function QuickResultPanel({ quickResult }) {
  if (!quickResult) return null;
  const { type, result } = quickResult;
  if (type === 'conflicts') {
    const conflicts = result?.conflicts || [];
    return (
      <div className="ca-result-box">
        <strong>Kết quả tìm mâu thuẫn</strong>
        {!conflicts.length && <p>{result?.message || 'Không tìm thấy mâu thuẫn đáng kể.'}</p>}
        {conflicts.map((item, index) => (
          <div className="ca-snippet" key={`${item.topic}-${index}`}>
            <strong>{item.topic || `Mâu thuẫn ${index + 1}`} · {item.conflict_level || 'unknown'}</strong>
            <p><b>A:</b> {item.document_a_claim || 'Không thấy trong trích đoạn.'}</p>
            <p><b>B:</b> {item.document_b_claim || 'Không thấy trong trích đoạn.'}</p>
            <p>{item.explanation}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="ca-result-box">
      <strong>Bản hợp nhất kiến thức</strong>
      {result?.synthesis && <p>{result.synthesis}</p>}
      {Boolean(result?.key_points?.length) && <ul>{result.key_points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
      {Boolean(result?.keep_from_a?.length) && <p><b>Nên giữ từ A:</b> {result.keep_from_a.join('; ')}</p>}
      {Boolean(result?.keep_from_b?.length) && <p><b>Nên giữ từ B:</b> {result.keep_from_b.join('; ')}</p>}
    </div>
  );
}

function DocumentPreviewPanel({ label, document }) {
  const { token } = useAuth();
  const [viewerUrl, setViewerUrl] = useState(document?.preview_url || '');
  const [viewerFilename, setViewerFilename] = useState(document?.filename || document?.title || 'document.pdf');
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const [previewDoc, setPreviewDoc] = useState(document);

  useEffect(() => {
    let cancelled = false;
    let createdUrl = '';

    setViewerError('');
    setPreviewDoc(document);
    setViewerFilename(document?.filename || document?.title || 'document.pdf');

    if (!document || !isPdfDocument(document)) {
      setViewerUrl('');
      return () => {};
    }

    if (document.preview_url) {
      setViewerUrl(document.preview_url);
      return () => {};
    }

    if (document.source_type !== 'system_library') {
      setViewerUrl('');
      setViewerError('Không tìm thấy blob PDF để hiển thị. Vui lòng upload lại file PDF.');
      return () => {};
    }

    setViewerLoading(true);
    api.fetchSystemDocumentBlob(document.id, token, document.filename || document.title || 'system-document.pdf')
      .then(({ blob, filename, contentType }) => {
        if (cancelled) return;
        if (!String(contentType || blob.type || '').includes('pdf')) {
          setViewerUrl('');
          setViewerError('Tài liệu tải về không phải PDF nên không thể mở bằng PDF viewer.');
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setViewerFilename(filename || document.filename || document.title || 'document.pdf');
        setViewerUrl(createdUrl);
      })
      .catch((err) => {
        if (!cancelled) setViewerError(err.message || 'Không thể tải PDF từ Thư viện Hệ thống.');
      })
      .finally(() => {
        if (!cancelled) setViewerLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [document, token]);

  useEffect(() => {
    let cancelled = false;
    if (!document || document.source_type !== 'system_library') return () => {};
    api.getCrossAnalysisDocumentPreview(document.id, token)
      .then((data) => { if (!cancelled) setPreviewDoc((current) => ({ ...(current || document), ...(data || {}) })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [document, token]);

  const viewerSrc = viewerUrl ? `${viewerUrl}#toolbar=1&navpanes=1&scrollbar=1&view=FitH` : '';

  return (
    <article className="ca-doc-panel">
      <div className="ca-doc-panel__header">
        <h3>Tài liệu {label}: {document?.title || 'Chưa chọn'}</h3>
        <p className="ca-muted">{sourceLabel(document)} · {document?.filename || '—'}</p>
      </div>

      {document && isPdfDocument(document) ? (
        <div className="ca-pdf-viewer">
          <div className="ca-pdf-toolbar">
            <span className="ca-muted">PDF viewer đầy đủ · {viewerFilename}</span>
            <div className="ca-actions" style={{ marginTop: 0 }}>
              {viewerUrl && <a className="ca-btn" href={viewerUrl} target="_blank" rel="noreferrer"><FileText size={15} /> Mở tab mới</a>}
              {viewerUrl && <a className="ca-btn" href={viewerUrl} download={viewerFilename}><Download size={15} /> Tải PDF</a>}
            </div>
          </div>
          {viewerLoading ? (
            <div className="ca-pdf-state"><p className="ca-muted"><Loader2 size={18} /> Đang tải PDF viewer...</p></div>
          ) : viewerError ? (
            <div className="ca-pdf-state"><div className="ca-warning"><AlertTriangle size={17} /> {viewerError}</div></div>
          ) : viewerSrc ? (
            <iframe className="ca-pdf-frame" src={viewerSrc} title={`PDF viewer tài liệu ${label}`} />
          ) : (
            <div className="ca-pdf-state"><p className="ca-muted">Chưa có PDF để hiển thị.</p></div>
          )}
        </div>
      ) : (
        <div className="ca-doc-panel__body">
          {document && ['docx', 'txt', 'md'].includes(documentExtension(document)) && <span className="ca-text-preview-label"><FileText size={14} /> {documentExtension(document).toUpperCase()} preview từ nội dung đã trích xuất</span>}
          {previewTextFromDocument(previewDoc) ? (
            <div className="ca-text-preview">{previewTextFromDocument(previewDoc)}</div>
          ) : (
            <>
              {document?.summary && <div className="ca-snippet"><strong>Tóm tắt:</strong><br />{document.summary}</div>}
              {(document?.snippets || []).map((snippet, index) => <div className="ca-snippet" key={index}><strong>{snippet.section || 'Trích đoạn'} · Trang {snippet.page_number || '?'}</strong><br />{snippet.content}</div>)}
              {!document && <p className="ca-muted">Chọn một tài liệu PDF để xem bằng PDF viewer hoặc tài liệu DOCX/TXT/MD để xem text preview.</p>}
              {document && !isPdfDocument(document) && <p className="ca-muted">Không thể xem trước định dạng này. Bạn vẫn có thể dùng AI để phân tích nội dung đã trích xuất.</p>}
            </>
          )}
        </div>
      )}
    </article>
  );
}


export default function CrossAnalysisPage() {
  const { token } = useAuth();
  const initialDraft = loadStoredCrossAnalysisDraft();
  const [documentA, setDocumentA] = useState(initialDraft?.documentA || null);
  const [documentB, setDocumentB] = useState(initialDraft?.documentB || null);
  const [selectedPreset, setSelectedPreset] = useState(initialDraft?.selectedPreset || 'academic');
  const [selectedCriteria, setSelectedCriteria] = useState(initialDraft?.selectedCriteria || PRESETS[0].criteria);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMode, setSortMode] = useState('default');
  const [selectedRowForChat, setSelectedRowForChat] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(initialDraft?.currentSessionId || null);
  const [comparisonResult, setComparisonResult] = useState(initialDraft?.comparisonResult || null);
  const [quickResult, setQuickResult] = useState(null);
  const [chatMessages, setChatMessages] = useState(initialDraft?.chatMessages || []);
  const [chatInput, setChatInput] = useState('');
  const [activeSlot, setActiveSlot] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const previewUrlsRef = useRef(new Set());

  const setDocumentForSlot = (slot, nextDocument) => {
    const setter = slot === 'A' ? setDocumentA : setDocumentB;
    setter((current) => {
      if (current?.preview_url) previewUrlsRef.current.delete(current.preview_url);
      revokePreviewUrl(current);
      if (nextDocument?.preview_url && nextDocument?.preview_url_owner === 'cross-analysis') {
        previewUrlsRef.current.add(nextDocument.preview_url);
      }
      return nextDocument;
    });
  };

  const tableRows = useMemo(() => {
    const base = (comparisonResult?.comparison_table || []).map((row, index) => ({ ...row, criterion_display: mapCriterionLabel(row.criterion, row.criterion_label), original_index: index }));
    const filtered = statusFilter === 'all' ? base : base.filter((row) => row.status === statusFilter);
    return [...filtered].sort((a, b) => {
      if (sortMode === 'confidence_desc') return (b.confidence ?? -1) - (a.confidence ?? -1);
      if (sortMode === 'confidence_asc') return (a.confidence ?? 999) - (b.confidence ?? 999);
      return a.original_index - b.original_index;
    });
  }, [comparisonResult, statusFilter, sortMode]);
  const canAnalyze = documentA && documentB && !sameDocument(documentA, documentB);
  const sameWarning = sameDocument(documentA, documentB) ? 'Vui lòng chọn hai tài liệu khác nhau để so sánh.' : '';
  const payload = useMemo(() => ({ document_a: toDocumentRef(documentA), document_b: toDocumentRef(documentB) }), [documentA, documentB]);
  const currentDraft = useMemo(() => ({
    documentA,
    documentB,
    selectedPreset,
    selectedCriteria,
    currentSessionId,
    comparisonResult,
    chatMessages,
  }), [documentA, documentB, selectedPreset, selectedCriteria, currentSessionId, comparisonResult, chatMessages]);
  const hasDraftContent = hasCrossAnalysisDraftContent(currentDraft);

  useEffect(() => {
    storeCrossAnalysisDraft(currentDraft);
  }, [currentDraft]);

  useEffect(() => {
    if (!token || !hasDraftContent) return () => {};
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const body = buildCrossAnalysisSessionBody({ documentA, documentB, selectedPreset, selectedCriteria, comparisonResult, chatMessages });
      try {
        const saved = currentSessionId
          ? await api.updateCrossAnalysisSession(currentSessionId, body, token)
          : await api.createCrossAnalysisSession(body, token);
        if (cancelled || !saved) return;
        setCurrentSessionId(saved.id || currentSessionId);
        setSessions((current) => [saved, ...current.filter((item) => item.id !== saved.id)].filter(Boolean).slice(0, 30));
      } catch {
        // Auto-save is best-effort; the same-tab/sessionStorage draft still restores the open page state.
      }
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [token, hasDraftContent, currentSessionId, documentA, documentB, selectedPreset, selectedCriteria, comparisonResult, chatMessages]);

  useEffect(() => {
    let cancelled = false;
    api.listCrossAnalysisSessions(token).then((data) => { if (!cancelled) setSessions(data?.sessions || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  const selectPreset = (presetKey) => {
    setSelectedPreset(presetKey);
    const preset = PRESETS.find((item) => item.key === presetKey);
    if (preset && preset.key !== 'custom') setSelectedCriteria(preset.criteria);
  };

  const uploadForSlot = async (slot, file) => {
    setLoading(`upload-${slot}`);
    setError('');
    let previewUrl = '';
    try {
      previewUrl = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? URL.createObjectURL(file) : '';
      const doc = await api.uploadCrossAnalysisDocument(file, token);
      setDocumentForSlot(slot, {
        ...doc,
        mime_type: file.type,
        preview_url: previewUrl,
        preview_url_owner: previewUrl ? 'cross-analysis' : undefined,
      });
    } catch (err) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError(err.message || 'Upload thất bại.');
    } finally {
      setLoading('');
    }
  };

  const analyze = async () => {
    if (!canAnalyze) return;
    setLoading('compare');
    setError('');
    setQuickResult(null);
    try {
      const result = await api.compareCrossAnalysisDocuments({ ...payload, criteria: selectedCriteria }, token);
      setComparisonResult(result);
      try {
        const body = buildCrossAnalysisSessionBody({ documentA, documentB, selectedPreset, selectedCriteria, comparisonResult: result, chatMessages });
        const saved = currentSessionId ? await api.updateCrossAnalysisSession(currentSessionId, body, token) : await api.createCrossAnalysisSession(body, token);
        setCurrentSessionId(saved?.id || currentSessionId || null);
        setSessions((current) => [saved, ...current.filter((item) => item.id !== saved?.id)].filter(Boolean).slice(0, 30));
      } catch {}
    } catch (err) {
      setError(err.message || 'Không thể phân tích hai tài liệu.');
    } finally {
      setLoading('');
    }
  };

  const runQuickAction = async (type) => {
    if (!canAnalyze) return;
    setLoading(type);
    setError('');
    try {
      const result = type === 'conflicts' ? await api.findCrossAnalysisConflicts(payload, token) : await api.synthesizeCrossAnalysisDocuments(payload, token);
      setQuickResult({ type, result });
    } catch (err) {
      setError(err.message || 'Quick action thất bại.');
    } finally {
      setLoading('');
    }
  };

  const clearChatHistory = async () => {
    if (!chatMessages.length) return;
    if (!window.confirm('Bạn có chắc muốn xoá lịch sử trò chuyện của phiên so sánh này không?')) return;
    setChatMessages([]);
    try { await api.clearCrossAnalysisChat({ ...payload }, token); } catch {}
  };

  const sendChat = async (event) => {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message || !canAnalyze) return;
    const nextHistory = [...chatMessages, { role: 'user', content: message }];
    setChatMessages(nextHistory);
    setChatInput('');
    setLoading('chat');
    try {
      const result = await api.chatCrossAnalysisDocuments({ ...payload, message, chat_history: nextHistory, selected_row: selectedRowForChat }, token);
      setChatMessages((current) => [...current, { role: 'assistant', content: result.answer || 'Không có phản hồi.' }]);
    } catch (err) {
      setChatMessages((current) => [...current, { role: 'assistant', content: err.message || 'Không thể trả lời chat.' }]);
    } finally {
      setLoading('');
    }
  };


  const askAboutRow = (row, message) => {
    setSelectedRowForChat(row);
    setChatInput(message);
    document.querySelector('.ca-chat-form textarea')?.focus();
  };

  const saveSession = async () => {
    if (!hasDraftContent) return;
    setLoading('session');
    try {
      const body = buildCrossAnalysisSessionBody({ documentA, documentB, selectedPreset, selectedCriteria, comparisonResult, chatMessages });
      const saved = currentSessionId ? await api.updateCrossAnalysisSession(currentSessionId, body, token) : await api.createCrossAnalysisSession(body, token);
      setCurrentSessionId(saved?.id || currentSessionId);
      setSessions((current) => [saved, ...current.filter((item) => item.id !== saved?.id)].filter(Boolean).slice(0, 30));
    } catch (err) {
      setError(err.message || 'Không thể lưu phiên so sánh.');
    } finally {
      setLoading('');
    }
  };

  const openSession = (session) => {
    setCurrentSessionId(session.id);
    setDocumentForSlot('A', session.document_a_ref || null);
    setDocumentForSlot('B', session.document_b_ref || null);
    setSelectedPreset(session.selected_preset || 'custom');
    setSelectedCriteria(session.selected_criteria || []);
    setComparisonResult(session.comparison_result || null);
    setChatMessages(session.chat_history || []);
  };

  const deleteSession = async (sessionId) => {
    if (!sessionId) return;
    if (!window.confirm('Bạn có chắc muốn xoá phiên so sánh này không?')) return;
    setLoading(`delete-session-${sessionId}`);
    setError('');
    try {
      await api.deleteCrossAnalysisSession(sessionId, token);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setDocumentForSlot('A', null);
        setDocumentForSlot('B', null);
        setComparisonResult(null);
        setChatMessages([]);
        setQuickResult(null);
      }
    } catch (err) {
      setError(err.message || 'Không thể xoá phiên so sánh.');
    } finally {
      setLoading('');
    }
  };

  return (
    <div className="ca-page">
      <style>{STYLES}</style>
      <section className="ca-hero">
        <span className="ca-eyebrow"><GitCompare size={15} /> Cross-Analysis · two-document RAG</span>
        <h1>Đối chiếu Hai Tài liệu</h1>
        <p>So sánh nội dung, phương pháp, kết quả và bằng chứng giữa hai tài liệu. Đây không phải phân tích correlation thống kê.</p>
      </section>

      <section className="ca-section">
        <h2 className="ca-section-title"><Columns size={20} /> 1. Chọn hai tài liệu</h2>
        <div className="ca-picker-grid">
          <DocumentSlot label="Tài liệu A" document={documentA} uploading={loading === 'upload-A'} onUpload={(file) => uploadForSlot('A', file)} onOpenLibrary={() => setActiveSlot('A')} onClear={() => setDocumentForSlot('A', null)} />
          <DocumentSlot label="Tài liệu B" document={documentB} uploading={loading === 'upload-B'} onUpload={(file) => uploadForSlot('B', file)} onOpenLibrary={() => setActiveSlot('B')} onClear={() => setDocumentForSlot('B', null)} />
        </div>
        <div className="ca-preset-grid">
          {PRESETS.map((preset) => (
            <button key={preset.key} className={`ca-preset ${selectedPreset === preset.key ? 'active' : ''}`} type="button" onClick={() => selectPreset(preset.key)}>
              <strong>{preset.label}</strong><br /><span className="ca-muted">{preset.criteria.length ? `${preset.criteria.length} tiêu chí` : 'Tick tiêu chí thủ công'}</span>
            </button>
          ))}
        </div>
        {selectedPreset === 'custom' ? (
          <div className="ca-criteria" aria-label="Chọn tiêu chí custom theo lưới 4 hàng x 5 cột">
            {CRITERIA.map((criterion) => (
              <label key={criterion.key} className="ca-criterion" title={criterion.hint}>
                <input type="checkbox" checked={selectedCriteria.includes(criterion.key)} onChange={() => { setSelectedPreset('custom'); setSelectedCriteria((current) => current.includes(criterion.key) ? current.filter((key) => key !== criterion.key) : [...current, criterion.key]); }} />
                <span><strong>{criterion.label}</strong><span>{criterion.hint}</span></span>
              </label>
            ))}
          </div>
        ) : (
          <div className="ca-selected-criteria">
            <strong>Tiêu chí đang dùng</strong>
            <p className="ca-muted">Chọn “Custom” nếu muốn hiển thị toàn bộ 20 tiêu chí và tick thủ công.</p>
            <ul>{selectedCriteria.map((key) => <li key={key}>{mapCriterionLabel(key)}</li>)}</ul>
          </div>
        )}
        {(error || sameWarning) && <div className="ca-warning"><AlertTriangle size={17} /> {error || sameWarning}</div>}
        <div className="ca-actions">
          <button className="ca-btn primary" type="button" disabled={!canAnalyze || loading === 'compare'} onClick={analyze}>{loading === 'compare' ? <Loader2 size={17} /> : <GitCompare size={17} />} Phân tích</button>
          <button className="ca-btn" type="button" disabled={!canAnalyze || loading === 'conflicts'} onClick={() => runQuickAction('conflicts')}><AlertTriangle size={17} /> Tìm Điểm Mâu Thuẫn</button>
          <button className="ca-btn" type="button" disabled={!canAnalyze || loading === 'synthesis'} onClick={() => runQuickAction('synthesis')}><Merge size={17} /> Hợp nhất Kiến thức</button>
        </div>
      </section>

      <section className="ca-section">
        <div className="ca-toolbar">
          <h2 className="ca-section-title"><CheckCircle2 size={20} /> 2. Bảng đối chiếu có bằng chứng</h2>
          <div className="ca-actions" style={{ marginTop: 0 }}>
            <button className="ca-btn" type="button" disabled={!hasDraftContent} onClick={saveSession}><Save size={16} /> Lưu phiên</button>
            <button className="ca-btn" type="button" disabled={!tableRows.length} onClick={() => downloadCsv(tableRows)}><Download size={16} /> Xuất CSV</button>
            <button className="ca-btn" type="button" disabled={!comparisonResult} onClick={() => downloadMarkdown(comparisonResult, comparisonResult?.comparison_table || [])}><Download size={16} /> Xuất Markdown</button>
            <button className="ca-btn" type="button" disabled title="Xuất DOCX sẽ được bổ sung sau."><Download size={16} /> DOCX</button>
          </div>
        </div>
        {comparisonResult?.summary && <p className="ca-muted">{comparisonResult.summary}</p>}
        {comparisonResult?.preflight?.warnings?.length ? <div className="ca-warning"><AlertTriangle size={17} /><div><b>Lưu ý trước khi đọc kết quả</b><ul>{comparisonResult.preflight.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div></div> : null}
        <QuickConclusionCard conclusion={comparisonResult?.quick_conclusion} />
        <div className="ca-filters">
          <label className="ca-muted">Trạng thái <select className="ca-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Tất cả</option><option value="similar">Giống nhau</option><option value="different">Khác nhau</option><option value="conflict">Mâu thuẫn</option><option value="missing_information">Thiếu thông tin</option><option value="needs_review">Cần đọc lại nguồn</option></select></label>
          <label className="ca-muted">Sắp xếp <select className="ca-select" value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="default">Theo tiêu chí mặc định</option><option value="confidence_desc">Confidence cao đến thấp</option><option value="confidence_asc">Confidence thấp đến cao</option></select></label>
        </div>
        <ComparisonTable rows={tableRows} onAskRow={askAboutRow} />
        <QuickResultPanel quickResult={quickResult} />
        <div className="ca-sessions">
          <strong>Phiên so sánh gần đây</strong>
          <div className="ca-session-list">
            {sessions.slice(0, 5).map((session) => (
              <div key={session.id} className="ca-session-row">
                <button className="ca-session" type="button" onClick={() => openSession(session)}>
                  {session.title || 'Phiên đối chiếu'}<br /><span className="ca-muted">{session.updated_at || session.created_at}</span>
                </button>
                <button className="ca-btn danger ca-session-delete" type="button" disabled={loading === `delete-session-${session.id}`} onClick={() => deleteSession(session.id)} title="Xoá phiên so sánh">
                  {loading === `delete-session-${session.id}` ? <Loader2 size={16} /> : <Trash2 size={16} />} Xoá
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ca-section">
        <h2 className="ca-section-title"><Columns size={20} /> 3. Split-screen hai tài liệu</h2>
        <div className="ca-split">
          <DocumentPreviewPanel label="A" document={documentA} />
          <DocumentPreviewPanel label="B" document={documentB} />
        </div>
      </section>

      <section className="ca-section">
        <div className="ca-chat-head">
          <h2 className="ca-section-title" style={{ marginBottom: 0 }}><MessageSquare size={20} /> 4. Chat AI theo đúng hai tài liệu</h2>
          <button className="ca-btn danger" type="button" disabled={!chatMessages.length} onClick={clearChatHistory}><Trash2 size={16} /> Xoá lịch sử</button>
        </div>
        {selectedRowForChat && <div className="ca-chat-context"><span>Chat đang hỏi theo dòng: {mapCriterionLabel(selectedRowForChat.criterion, selectedRowForChat.criterion_label)}</span><button className="ca-btn ca-mini-btn" type="button" onClick={() => setSelectedRowForChat(null)}>Bỏ context row</button></div>}
        <div className="ca-chat-log">
          {chatMessages.length === 0 ? <p className="ca-muted">Hỏi AI về điểm giống/khác nhau, lý do mâu thuẫn, hoặc cách kết hợp hai tài liệu.</p> : chatMessages.map((msg, index) => <div key={index} className={`ca-message ${msg.role}`}>{msg.content}</div>)}
        </div>
        <form className="ca-chat-form" onSubmit={sendChat}>
          <textarea rows={3} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ví dụ: Hai tài liệu khác nhau ở giả định nào?" />
          <button className="ca-btn primary" type="submit" disabled={!canAnalyze || loading === 'chat'}>{loading === 'chat' ? <Loader2 size={17} /> : <WandSparkles size={17} />} Gửi</button>
        </form>
      </section>

      <SystemDocumentPickerModal open={Boolean(activeSlot)} onClose={() => setActiveSlot(null)} onSelect={(doc) => setDocumentForSlot(activeSlot, doc)} />
    </div>
  );
}
