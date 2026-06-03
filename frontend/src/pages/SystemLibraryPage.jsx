import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Library,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import SystemLibrarySearchBar from "../components/system-library/SystemLibrarySearchBar";
import SystemLibraryFilters from "../components/system-library/SystemLibraryFilters";
import SystemLibraryToolbar from "../components/system-library/SystemLibraryToolbar";
import SystemDocumentCard from "../components/system-library/SystemDocumentCard";
import SystemDocumentDetailModal from "../components/system-library/SystemDocumentDetailModal";
import OpenAlexPaperCard from "../components/system-library/OpenAlexPaperCard";
import OpenAlexPaperDetailModal from "../components/system-library/OpenAlexPaperDetailModal";

const emptyFilters = {
  peer_review_status: [],
  access_types: [],
  review_types: [],
  source_types: [],
  has_pdf: false,
  has_data: false,
  has_code: false,
  citation_count_enabled: false,
  citation_count_min: "",
  sort: "newest",
};

const STYLES = `
  .sl-page { min-height: 100vh; padding: 24px clamp(14px, 3vw, 42px) 54px; background: radial-gradient(ellipse at 40% 0%, rgba(196,164,100,0.11), transparent 42%), linear-gradient(180deg, #0f0d0a 0%, #12100c 100%); font-family: 'Lora', Georgia, serif; }
  .sl-hero, .sl-upload-panel, .sl-paper-panel { border: 1px solid rgba(255,255,255,0.08); border-radius: 28px; padding: clamp(20px, 4vw, 38px); background: radial-gradient(circle at 80% 20%, rgba(112,88,42,0.3), transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)); box-shadow: 0 30px 90px rgba(0,0,0,0.32); }
  .sl-page button, .sl-page input, .sl-page select { font-family: inherit; display: flex; justify-content: center; align-items: center;}
  .sl-hero__eyebrow { display: inline-flex; align-items: center; gap: 8px; color: #d8bd77; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .sl-hero h1 { margin: 12px 0 10px; color: #f3ebdc; font-size: clamp(28px, 5vw, 50px); line-height: 1.04; }
  .sl-hero p, .sl-upload-panel p, .sl-paper-panel p { max-width: 860px; color: #9f9587; line-height: 1.7; font-size: 15px; }
  .sl-hero__stats, .sl-tabs, .sl-paper-search { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  .sl-tab, .sl-stat { padding: 11px 14px; border-radius: 16px; background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.07); color: #bfb4a3; font-size: 12px; cursor: pointer; }
  .sl-tab.is-active { color: #1a130c; background: #d4b66f; font-weight: 800; }
  .sl-stat strong { color: #f0d089; font-size: 18px; margin-right: 6px; }
  .sl-search, .sl-paper-search { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 10px; border-radius: 20px; background: rgba(8,7,5,0.74); border: 1px solid rgba(255,255,255,0.09); }
  .sl-search { margin-top: 24px; }
  .sl-search__icon { margin-left: 8px; color: #c4a464; }
  .sl-search input, .sl-paper-search input, .sl-upload-form input, .sl-upload-form textarea, .sl-upload-form select, .sl-toolbar select, .sl-citation-filter input, .sl-tag-modal__search input { width: 100%; min-width: 0; border: 1px solid rgba(255,255,255,0.09); outline: none; background: rgba(0,0,0,.2); color: #eee6d8; font-size: 14px; border-radius: 12px; padding: 11px 12px; }
  .sl-search input { border: 0; background: transparent; padding: 0; }
  .sl-search__button, .sl-download-btn, .sl-upload-btn { border: 0; border-radius: 14px; padding: 11px 16px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #d4b66f, #8a6a30); color: #18130d; font-weight: 800; cursor: pointer; text-decoration: none; }
  .sl-toolbar-btn { border: 0; border-radius: 14px; padding: 11px 16px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #d4b66f, #8a6a30); color: #18130d; font-weight: 800; cursor: pointer; text-decoration: none; white-space: nowrap; flex-shrink: 0;}
  .sl-search__button:disabled, .sl-toolbar-btn:disabled, .sl-download-btn:disabled, .sl-upload-btn:disabled { opacity: .42; cursor: not-allowed; }
  .sl-body { display: grid; grid-template-columns: minmax(220px, 290px) 1fr; gap: 20px; margin-top: 22px; align-items: start; }
  .sl-filters, .sl-toolbar, .sl-card, .sl-empty, .sl-error { border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.035); border-radius: 22px; box-shadow: 0 18px 60px rgba(0,0,0,0.24); }
  .sl-filters { position: sticky; top: 18px; padding: 18px; color: #bfb4a3; }
  .sl-filters__header, .sl-card__header { display: flex; justify-content: space-between; gap: 10px; }
  .sl-card__footer { display: flex; justify-content: space-between; gap: 10px; margin-top: auto; }
  .sl-filters__header p { margin: 0 0 2px; color: #746b5d; font-size: 11px; text-transform: uppercase; }
  .sl-filters__header strong, .sl-filter-group h3 { color: #efe6d8; }
  .sl-filter-group { margin-top: 18px; }
  .sl-filter-group h3 { margin: 0 0 10px; font-size: 14px; }
  .sl-filter-group__title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .sl-filter-group__title-row h3 { margin: 0; }
  .sl-filter-options, .sl-active-tags, .sl-card__tags, .sl-card__badges, .sl-card__metrics, .sl-card__flags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .sl-filter-chip { border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 7px 10px; cursor: pointer; color: #a79b8a; font-size: 12px; background: rgba(0,0,0,.12); }
  .sl-filter-chip input { display: none; }
  .sl-filter-chip.is-active { color: #1a130c; background: #d4b66f; }
  .sl-filter-skeleton { min-height: 42px; padding: 12px; border-radius: 14px; color: #f0d089; background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(212,182,111,.15), rgba(255,255,255,.05)); animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: .55; } }
  .sl-link-button, .sl-more-link { border: 0; background: transparent; color: #d4b66f; cursor: pointer; }
  .sl-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 18px; color: #bfb4a3; margin-bottom: 16px; flex-wrap: wrap; }
  .sl-toolbar strong { color: #f2d48b; font-size: 22px; }
  .sl-toolbar__actions { display: flex; gap: 10px; align-items: center; flex-wrap: nowrap; }
  .sl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .sl-card { position: relative; padding: 16px; color: #efe6d8; min-height: 265px; display: flex; flex-direction: column; gap: 14px; transition: border-color .18s, box-shadow .18s; }
  .sl-card:hover { border-color: rgba(212,182,111,.28); box-shadow: 0 24px 75px rgba(0,0,0,.34); }
  .sl-card__file-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 13px; background: rgba(212,182,111,.14); color: #f2d48b; }
  .sl-bookmark { width: 38px; height: 38px; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); background: rgba(0,0,0,.16); color: #d4b66f; display: inline-flex; align-items:center; justify-content:center; cursor:pointer; }
  .sl-card h3 { margin: 8px 0; font-size: 18px; }
  .sl-card p { color: #a99e8f; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; flex-grow: 1; }
  .sl-badge, .sl-tag, .sl-more-tags { font-size: 11px; border-radius: 999px; padding: 5px 8px; background: rgba(212,182,111,.12); color: #d4b66f; border: 1px solid rgba(212,182,111,.16); }
  .sl-tag { cursor: pointer; }
  .sl-card__meta, .sl-card__metrics, .sl-card__flags { color: #8f8474; font-size: 12px; }
  .sl-card__flags span { opacity: .45; display: inline-flex; align-items: center; gap: 4px; }
  .sl-card__flags .is-on { opacity: 1; color: #f0d089; }
  .sl-modal-overlay { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 18px; background: rgba(0,0,0,.62); }
  .sl-tag-modal-overlay { z-index: 90; }
  .sl-modal { width: min(760px, 100%); max-height: min(86vh, 820px); display: flex; flex-direction: column; border: 1px solid rgba(255,255,255,.12); border-radius: 26px; background: #18140f; color: #efe6d8; box-shadow: 0 30px 110px rgba(0,0,0,.55); position: relative; }
  .sl-modal__close { position: absolute; top: 14px; right: 14px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #efe6d8; border-radius: 999px; width: 36px; height: 36px; cursor: pointer; display: flex; justify-content: center; align-items: center;}
  .sl-modal__header { display: flex; gap: 14px; padding: 24px 26px 12px; }
  .sl-modal__header p { margin: 0 0 4px; color: #d4b66f; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
  .sl-modal__header h2 { margin: 0; font-size: clamp(22px, 4vw, 34px); }
  .sl-modal__icon { flex: 0 0 46px; width: 46px; height: 46px; display: grid; place-items: center; border-radius: 16px; background: rgba(212,182,111,.14); color: #f0d089; }
  .sl-modal__content { overflow: auto; padding: 8px 26px 18px; display: grid; gap: 16px; }
  .sl-tag-modal { width: min(720px, 100%); }
  .sl-tag-modal__search { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 16px; color: #d4b66f; background: rgba(0,0,0,.18); }
  .sl-tag-modal__search input { border: 0; background: transparent; padding: 0; }
  .sl-tag-modal__summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #9f9587; font-size: 13px; }
  .sl-tag-modal__summary strong { color: #f0d089; }
  .sl-tag-modal__grid { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-height: 45vh; overflow: auto; padding: 2px; }
  .sl-modal__section { border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 16px; background: rgba(255,255,255,.035); }
  .sl-modal__section h3 { margin: 0 0 10px; font-size: 15px; color: #f0d089; }
  .sl-modal__section p { margin: 0; color: #c6baaa; line-height: 1.7; white-space: pre-wrap; }
  .sl-modal__grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .sl-modal__row { display: grid; gap: 4px; padding: 10px; border-radius: 12px; background: rgba(0,0,0,.18); }
  .sl-modal__row span, .sl-modal__muted { color: #8f8474; font-size: 12px; }
  .sl-modal__row strong { color: #efe6d8; font-size: 13px; overflow-wrap: anywhere; }
  .sl-rating { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: #efe6d8; gap: 64px; justify-content: center; }
  .sl-rating__stars { display: inline-flex; gap: 4px; color: #d4b66f; }
  .sl-rating__stars .is-dim { color: rgba(255,255,255,.22); }

  .sl-rating-section { position: relative;}
  .sl-rating-section.is-loading { opacity:.82; }
  .sl-rating-section__header { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:14px; }
  .sl-rating-section__header h3 { margin-bottom:4px; }
  .sl-rating-section__header p { color:#9f9587; font-size:13px; }
  .sl-rating__stars { display:inline-flex; gap:6px; color:#d4b66f; }
  .sl-rating__star { width:36px; height:36px; padding:0; border:1px solid rgba(255,255,255,.08); border-radius:12px; background:rgba(0,0,0,.16); color:rgba(255,255,255,.24); cursor:pointer; transition: transform .14s ease, color .14s ease, border-color .14s ease, background .14s ease; }
  .sl-rating__star:hover, .sl-rating__star:focus-visible { transform:translateY(-1px) scale(1.04); outline:none; border-color:rgba(240,208,137,.5); }
  .sl-rating__star.is-lit { color:#f5c451; background:rgba(245,196,81,.1); }
  .sl-rating__star.is-selected { border-color:rgba(245,196,81,.72); box-shadow:0 0 0 2px rgba(245,196,81,.12); }
  .sl-rating__star:disabled { cursor:wait; opacity:.72; transform:none; }
  .sl-rating__summary { display:grid; gap:4px; }
  .sl-rating__summary span { color:#9f9587; font-size:13px; }
  .sl-rating__mine { color:#c6baaa !important; }
  .sl-rating__mine.is-rated { color:#86efac !important; }
  .sl-rating__loading { display:inline-flex; align-items:center; gap:6px; color:#f2d48b; font-size:12px; }
  .sl-rating__loading svg { animation: spin .9s linear infinite; }
  .sl-rating__error { margin-top:12px !important; color:#fca5a5 !important; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sl-modal__footer { padding: 16px 26px 24px; display: flex; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,.08); }

  .sl-upload-panel h2 { display:flex; align-items:center; gap:10px; margin:0; color:#f3ebdc; font-size: clamp(22px, 3vw, 30px); }
  .sl-upload-layout { display:grid; grid-template-columns: minmax(0, 1.25fr) minmax(260px, .75fr); gap:18px; margin-top:20px; align-items:center; }
  .sl-upload-form { display:grid; gap:14px; margin:0; }
  .sl-upload-grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; }
  .sl-upload-field { display:grid; gap:7px; color:#cfc5b5; font-size:13px; }
  .sl-upload-field.is-wide { grid-column: 1 / -1; }
  .sl-upload-field span { font-weight:800; color:#efe6d8; }
  .sl-upload-field small { color:#827767; }
  .sl-dropzone { min-height: 170px; border:1.5px dashed rgba(212,182,111,.34); border-radius:22px; background:linear-gradient(135deg, rgba(212,182,111,.10), rgba(255,255,255,.025)); color:#cfc5b5; display:grid; place-items:center; text-align:center; padding:22px; cursor:pointer; transition: border-color .18s, transform .18s, background .18s; }
  .sl-dropzone:hover, .sl-dropzone:focus-within { border-color:rgba(240,208,137,.7); background:linear-gradient(135deg, rgba(212,182,111,.16), rgba(255,255,255,.04)); transform: translateY(-1px); }
  .sl-dropzone input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
  .sl-dropzone__content { display:grid; gap:10px; justify-items:center; }
  .sl-dropzone__icon { width:54px; height:54px; border-radius:18px; display:grid; place-items:center; color:#f0d089; background:rgba(212,182,111,.14); border:1px solid rgba(212,182,111,.24); }
  .sl-dropzone strong { color:#f3ebdc; font-size:16px; }
  .sl-dropzone p { margin:0; max-width:420px; }
  .sl-dropzone.is-selected { border-style:solid; border-color:rgba(74,222,128,.42); background:linear-gradient(135deg, rgba(74,222,128,.1), rgba(212,182,111,.06)); }
  .sl-upload-sidecar { border:1px solid rgba(255,255,255,.08); border-radius:22px; padding:16px; background:rgba(0,0,0,.16); color:#bfb4a3; display:grid; gap:14px; }
  .sl-upload-sidecar h3 { margin:0; color:#f0d089; font-size:15px; }
  .sl-upload-steps { display:grid; gap:9px; margin:0; padding:0; list-style:none; }
  .sl-upload-steps li { display:flex; gap:9px; align-items:center; padding:9px 10px; border-radius:13px; background:rgba(255,255,255,.035); color:#8f8474; font-size:13px; }
  .sl-upload-steps li.is-active { color:#f2d48b; background:rgba(212,182,111,.10); }
  .sl-upload-steps li.is-done { color:#86efac; }
  .sl-upload-progress { height:8px; overflow:hidden; border-radius:999px; background:rgba(255,255,255,.08); }
  .sl-upload-progress span { display:block; height:100%; width:var(--upload-progress, 0%); background:linear-gradient(90deg, #d4b66f, #86efac); transition:width .2s ease; }
  .sl-notice { margin-top:16px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; color:#f2d48b; background:rgba(212,182,111,.1); border:1px solid rgba(212,182,111,.18); border-radius:14px; padding:12px 14px; }
  .sl-notice button { border:0; background:transparent; color:inherit; cursor:pointer; }

  .sl-empty, .sl-error { padding: 16px; color: #a79b8a; text-align: center; display: flex; justify-content: center; align-items: center;}
  .sl-paper-list { display: grid; gap: 12px; margin-top: 18px; }
  .sl-paper-item { border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 14px; background: rgba(0,0,0,.18); color: #efe6d8; }
  .sl-paper-item p { margin: 6px 0; }
  @media (max-width: 900px) { .sl-body, .sl-upload-layout { grid-template-columns: 1fr; } .sl-filters { position: static; } }
  @media (max-width: 640px) { .sl-search, .sl-paper-search { grid-template-columns: auto 1fr; } .sl-search__button, .sl-paper-search button { grid-column: 1 / -1; width: 100%; } .sl-modal__grid, .sl-upload-grid { grid-template-columns: 1fr; } .sl-card__footer { align-items: stretch; flex-direction: column; } }
`;

function toggleInList(list, value) {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}
const canPublish = (user) =>
  user?.role === "admin" ||
  (user?.canPublishDocuments ??
    user?.can_publish_documents ??
    user?.canUploadLibraryDocuments ??
    user?.can_upload_library_documents ??
    true) !== false;

export default function SystemLibraryPage() {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState("community");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedTags, setSelectedTags] = useState([]);
  const [suggestedTags, setSuggestedTags] = useState([]);
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [documentRating, setDocumentRating] = useState(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadCitationThreshold, setUploadCitationThreshold] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [paperQuery, setPaperQuery] = useState("");
  const [paperResults, setPaperResults] = useState([]);
  const [paperLoading, setPaperLoading] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchDocuments = useCallback(async () => {
    if (!token || activeTab === "internet") return;
    setLoading(true);
    setError("");
    try {
      const citationMin = Number(filters.citation_count_min);
      const searchFilters = {
        ...filters,
        tags: selectedTags,
        bookmarked: bookmarksOnly,
        my_documents: activeTab === "my",
      };
      if (filters.citation_count_enabled)
        searchFilters.citation_count_min = Number.isFinite(citationMin)
          ? citationMin
          : 0;
      else delete searchFilters.citation_count_min;
      delete searchFilters.citation_count_enabled;
      const result = await api.searchSystemLibrary(
        { query: debouncedQuery, filters: searchFilters },
        token,
      );
      setDocuments(result?.documents || []);
      setTotal(result?.total || 0);
    } catch (err) {
      setDocuments([]);
      setTotal(0);
      setError(err.message || "Không thể tải Thư viện tài liệu.");
    } finally {
      setLoading(false);
    }
  }, [token, activeTab, debouncedQuery, filters, selectedTags, bookmarksOnly]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);
  useEffect(() => {
    if (token)
      api
        .getSystemLibraryTags(token)
        .then((data) => setSuggestedTags(data?.tags || []))
        .catch(() => setSuggestedTags([]));
  }, [token, documents.length]);

  const stats = useMemo(
    () => ({
      saved: documents.filter((doc) => doc.bookmarked_by_current_user).length,
    }),
    [documents],
  );
  const patchDocument = (documentId, patch) =>
    setDocuments((current) =>
      current.map((doc) =>
        doc.id === documentId ? { ...doc, ...patch } : doc,
      ),
    );

  const handleToggleBookmark = async (document) => {
    const nextValue = !document.bookmarked_by_current_user;
    patchDocument(document.id, { bookmarked_by_current_user: nextValue });
    try {
      if (nextValue) await api.bookmarkSystemDocument(document.id, token);
      else await api.unbookmarkSystemDocument(document.id, token);
    } catch (err) {
      patchDocument(document.id, { bookmarked_by_current_user: !nextValue });
      setNotice(err.message || "Không thể cập nhật danh sách đã ghim.");
    }
  };

  const openDocumentDetails = (document) => {
    setSelectedDocument(document);
    setDocumentRating({
      average_rating: document.average_rating ?? document.vote_avg ?? 0,
      rating_count: document.rating_count ?? document.vote_count ?? 0,
      my_rating: document.my_rating ?? null,
    });
    setRatingError("");
  };

  useEffect(() => {
    if (!selectedDocument?.id || !token) return;
    let isActive = true;
    setRatingLoading(true);
    setRatingError("");
    api
      .getDocumentRating(selectedDocument.id, "community_library", token)
      .then((rating) => {
        if (!isActive) return;
        setDocumentRating(rating);
        patchDocument(selectedDocument.id, {
          vote_avg: rating.average_rating,
          vote_count: rating.rating_count,
          average_rating: rating.average_rating,
          rating_count: rating.rating_count,
          my_rating: rating.my_rating,
        });
      })
      .catch((err) => {
        if (isActive)
          setRatingError(err.message || "Không thể tải đánh giá tài liệu.");
      })
      .finally(() => {
        if (isActive) setRatingLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [selectedDocument?.id, token]);

  const handleRateDocument = async (rating) => {
    if (!selectedDocument?.id) return;
    if (!token) {
      setRatingError("Bạn cần đăng nhập để đánh giá tài liệu.");
      return;
    }
    const previousRating = documentRating;
    const previousMyRating = Number(previousRating?.my_rating || 0);
    const previousCount = Number(previousRating?.rating_count || 0);
    setRatingSubmitting(true);
    setRatingError("");
    setDocumentRating((current) => ({
      ...(current || {}),
      my_rating: rating,
      rating_count: previousMyRating ? previousCount : previousCount + 1,
    }));
    try {
      const result = await api.rateDocument(
        selectedDocument.id,
        { documentType: "community_library", rating },
        token,
      );
      setDocumentRating(result);
      patchDocument(selectedDocument.id, {
        vote_avg: result.average_rating,
        vote_count: result.rating_count,
        average_rating: result.average_rating,
        rating_count: result.rating_count,
        my_rating: result.my_rating,
      });
      setSelectedDocument((current) =>
        current?.id === selectedDocument.id
          ? {
              ...current,
              vote_avg: result.average_rating,
              vote_count: result.rating_count,
              average_rating: result.average_rating,
              rating_count: result.rating_count,
              my_rating: result.my_rating,
            }
          : current,
      );
      setNotice(`Bạn đã đánh giá tài liệu ${result.my_rating}/5 sao.`);
    } catch (err) {
      setDocumentRating(previousRating);
      setRatingError(err.message || "Không thể lưu đánh giá tài liệu.");
    } finally {
      setRatingSubmitting(false);
    }
  };

  const handleDownload = async (document) => {
    if (!document?.id || downloadingId) return;
    setDownloadingId(document.id);
    setNotice("Đang tải tài liệu...");
    try {
      await api.downloadSystemDocument(
        document.id,
        token,
        document.filename || document.title || "library-document",
      );
      setNotice("Đã bắt đầu tải tài liệu.");
      patchDocument(document.id, {
        download_count: (Number(document.download_count) || 0) + 1,
      });
    } catch (err) {
      setNotice(err.message || "Không thể tải tài liệu.");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!canPublish(user)) {
      setNotice(
        "Tài khoản của bạn đã bị tạm khóa quyền đăng tài liệu. Vui lòng liên hệ quản trị viên.",
      );
      return;
    }
    if (!uploadFile) {
      setNotice("Vui lòng chọn file để upload.");
      return;
    }
    setLoading(true);
    setUploadProgress(0);
    setUploadStatus("Đang chuẩn bị tài liệu");
    setNotice("Đang upload và xử lý tài liệu...");
    try {
      setUploadProgress(5);
      setUploadStatus("Đang tải lên");
      const result = await api.uploadCommunityLibraryDocument(
        {
          file: uploadFile,
          title: uploadTitle,
          description: uploadDescription,
          category: uploadCategory,
          tags: uploadTags,
          citationThreshold: uploadCitationThreshold || 0,
        },
        token,
        (progress) => {
          setUploadProgress(progress);
          setUploadStatus(
            progress >= 100
              ? "Đang đọc tài liệu và tạo tag/tóm tắt"
              : "Đang tải lên",
          );
        },
      );
      setUploadFile(null);
      setUploadTitle("");
      setUploadDescription("");
      setUploadCategory("");
      setUploadTags("");
      setUploadCitationThreshold("");
      setUploadProgress(100);
      setUploadStatus("Hoàn tất");
      setNotice(
        result?.document?.status === "PENDING_REVIEW"
          ? "Đã upload tài liệu và đang chờ admin duyệt trước khi public."
          : "Đã upload tài liệu vào Thư viện cộng đồng.",
      );
      setActiveTab("my");
      await fetchDocuments();
    } catch (err) {
      setNotice(err.message || "Không thể upload tài liệu.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaperSearch = async (event) => {
    event.preventDefault();
    if (!paperQuery.trim()) return;
    setPaperLoading(true);
    setPaperResults([]);
    setNotice("Đang tìm paper qua OpenAlex...");
    try {
      const result = await api.searchInternetPapers(
        { query: paperQuery.trim(), provider: "openalex", limit: 20 },
        token,
      );
      setPaperResults(result?.papers || []);
      setNotice("Đã normalize kết quả internet search.");
    } catch (err) {
      setNotice(err.message || "Không thể tìm paper internet.");
    } finally {
      setPaperLoading(false);
    }
  };

  const handleImportPaper = async (paper) => {
    if (!canPublish(user)) {
      setNotice(
        "Tài khoản của bạn đã bị tạm khóa quyền đăng tài liệu. Vui lòng liên hệ quản trị viên.",
      );
      return;
    }
    try {
      await api.importInternetPaperToLibrary(paper, token);
      setNotice("Đã import paper vào thư viện.");
      setActiveTab("community");
      await fetchDocuments();
    } catch (err) {
      setNotice(err.message || "Không thể import paper vào thư viện.");
    }
  };

  return (
    <div className="sl-page">
      <style>{STYLES}</style>
      <section className="sl-hero">
        <span className="sl-hero__eyebrow">
          <Sparkles size={14} /> Community library · Internet paper search
        </span>
        <h1>Thư viện Tài liệu Cộng đồng</h1>
        <p>Upload, xem, lọc, đánh giá và download tài liệu public hợp lệ.</p>
        <div className="sl-tabs">
          <button
            className={`sl-tab ${activeTab === "community" ? "is-active" : ""}`}
            onClick={() => setActiveTab("community")}
          >
            Thư viện cộng đồng
          </button>
          <button
            className={`sl-tab ${activeTab === "my" ? "is-active" : ""}`}
            onClick={() => setActiveTab("my")}
          >
            Tài liệu của tôi
          </button>
          <button
            className={`sl-tab ${activeTab === "internet" ? "is-active" : ""}`}
            onClick={() => setActiveTab("internet")}
          >
            Paper internet search
          </button>
        </div>
        <div className="sl-hero__stats">
          <span className="sl-stat">
            <strong>{total}</strong>tài liệu
          </span>
          <span className="sl-stat">
            <strong>{stats.saved}</strong>đã ghim trong kết quả
          </span>
        </div>
        {activeTab !== "internet" && (
          <SystemLibrarySearchBar
            value={query}
            onChange={setQuery}
            onSubmit={(event) => {
              event.preventDefault();
              setDebouncedQuery(query.trim());
            }}
            loading={loading}
          />
        )}
        {notice && (
          <div className="sl-notice">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Đóng thông báo"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </section>

      {activeTab === "internet" ? (
        <section className="sl-paper-panel" style={{ marginTop: 22 }}>
          <h2>Paper internet search</h2>
          <p>
            Kết quả được normalize về source, externalId, title, abstract,
            authors, year, DOI, URL/PDF URL, citations, Open Access, peer-review
            và asset flags.
          </p>
          <form className="sl-paper-search" onSubmit={handlePaperSearch}>
            <Search className="sl-search__icon" size={18} />
            <input
              value={paperQuery}
              onChange={(event) => setPaperQuery(event.target.value)}
              placeholder="Tìm paper trên OpenAlex..."
            />
            <button className="sl-search__button" disabled={paperLoading}>
              {paperLoading ? "Đang tìm..." : "Search"}
            </button>
          </form>
          {paperLoading ? (
            <div className="sl-empty">Đang search paper...</div>
          ) : paperResults.length === 0 ? (
            <div className="sl-empty">
              <Library size={34} />
              <p>Nhập từ khóa để tìm paper internet.</p>
            </div>
          ) : (
            <div className="sl-grid">
              {paperResults.map((paper) => (
                <OpenAlexPaperCard
                  key={`${paper.source || "OpenAlex"}-${paper.id || paper.externalId}`}
                  paper={paper}
                  onOpenDetails={setSelectedPaper}
                  onImport={handleImportPaper}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="sl-upload-panel" style={{ marginTop: 22 }}>
            <h2>
              <Upload size={20} /> Đóng góp tài liệu cho Thư viện Cộng đồng
            </h2>
            <p>
              {canPublish(user)
                ? "Tải lên tài liệu nghiên cứu để mọi người có thể cùng tìm kiếm và học tập. Tài liệu tải lên cần chờ phê duyệt trước khi public."
                : "Tài khoản của bạn đã bị tạm khóa quyền đăng tài liệu. Vui lòng liên hệ quản trị viên."}
            </p>
            <div className="sl-upload-layout">
              <form className="sl-upload-form" onSubmit={handleUpload}>
                <label
                  className={`sl-dropzone ${uploadFile ? "is-selected" : ""}`}
                >
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    onChange={(event) =>
                      setUploadFile(event.target.files?.[0] || null)
                    }
                  />
                  <span className="sl-dropzone__content">
                    <span className="sl-dropzone__icon">
                      <FileUp size={24} />
                    </span>
                    <strong>
                      {uploadFile
                        ? uploadFile.name
                        : "Kéo thả tài liệu vào đây hoặc bấm để chọn file."}
                    </strong>
                    <p>Hỗ trợ PDF, DOCX, TXT, MD.</p>
                  </span>
                </label>
                <div className="sl-upload-grid">
                  <label className="sl-upload-field">
                    <span>Title</span>
                    <input
                      value={uploadTitle}
                      onChange={(event) => setUploadTitle(event.target.value)}
                      placeholder="Tên tài liệu nghiên cứu"
                    />
                  </label>
                  <label className="sl-upload-field">
                    <span>Category</span>
                    <input
                      value={uploadCategory}
                      onChange={(event) =>
                        setUploadCategory(event.target.value)
                      }
                      placeholder="VD: Machine Learning, Y sinh..."
                    />
                  </label>
                  <label className="sl-upload-field is-wide">
                    <span>Mô tả ngắn</span>
                    <textarea
                      rows={3}
                      value={uploadDescription}
                      onChange={(event) =>
                        setUploadDescription(event.target.value)
                      }
                      placeholder="Tóm tắt ngắn lý do tài liệu này hữu ích cho cộng đồng"
                    />
                  </label>
                  <label className="sl-upload-field">
                    <span>Tags</span>
                    <input
                      value={uploadTags}
                      onChange={(event) => setUploadTags(event.target.value)}
                      placeholder="tags, cách nhau bằng dấu phẩy"
                    />
                  </label>
                  <label className="sl-upload-field">
                    <span>Citation threshold</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={uploadCitationThreshold}
                      onChange={(event) =>
                        setUploadCitationThreshold(event.target.value)
                      }
                      placeholder="Hệ thống mặc định: 0"
                    />
                  </label>
                </div>
                <button
                  className="sl-upload-btn"
                  disabled={loading || !canPublish(user)}
                >
                  {loading ? "Đang xử lý..." : "Tải lên thư viện"}
                </button>
              </form>
              <aside className="sl-upload-sidecar" aria-live="polite">
                <h3>Trạng thái xử lý</h3>
                <div
                  className="sl-upload-progress"
                  style={{ "--upload-progress": `${uploadProgress}%` }}
                >
                  <span />
                </div>
                <ul className="sl-upload-steps">
                  <li className={uploadStatus ? "is-done" : "is-active"}>
                    <CheckCircle2 size={15} /> Chọn file & metadata
                  </li>
                  <li
                    className={
                      loading && uploadStatus.includes("tải")
                        ? "is-active"
                        : uploadProgress >= 100
                          ? "is-done"
                          : ""
                    }
                  >
                    <CheckCircle2 size={15} /> Đang tải lên
                  </li>
                  <li
                    className={
                      loading && uploadStatus.includes("đọc")
                        ? "is-active"
                        : uploadStatus === "Hoàn tất"
                          ? "is-done"
                          : ""
                    }
                  >
                    <CheckCircle2 size={15} /> Đang đọc tài liệu
                  </li>
                  <li
                    className={
                      loading && uploadStatus.includes("tag")
                        ? "is-active"
                        : uploadStatus === "Hoàn tất"
                          ? "is-done"
                          : ""
                    }
                  >
                    <CheckCircle2 size={15} /> Đang tạo tag/tóm tắt
                  </li>
                  <li className={uploadStatus === "Hoàn tất" ? "is-done" : ""}>
                    <CheckCircle2 size={15} /> Hoàn tất
                  </li>
                </ul>
                <p>
                  {uploadStatus ||
                    "Sau khi bấm tải lên, tiến trình sẽ hiển thị tại đây."}
                </p>
              </aside>
            </div>
          </section>
          <div className="sl-body">
            <SystemLibraryFilters
              filters={filters}
              selectedTags={selectedTags}
              suggestedTags={suggestedTags}
              loading={loading}
              onToggleFilter={(group, value) =>
                setFilters((current) => ({
                  ...current,
                  [group]: toggleInList(current[group] || [], value),
                }))
              }
              onToggleTag={(tag) =>
                setSelectedTags((current) => toggleInList(current, tag))
              }
              onBooleanFilter={(key) =>
                setFilters((current) => ({ ...current, [key]: !current[key] }))
              }
              onCitationChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  citation_count_min: value,
                }))
              }
              onClear={() => {
                setFilters(emptyFilters);
                setSelectedTags([]);
                setBookmarksOnly(false);
              }}
            />
            <section className="sl-content">
              <SystemLibraryToolbar
                total={total}
                bookmarksOnly={bookmarksOnly}
                onToggleBookmarksOnly={() =>
                  setBookmarksOnly((value) => !value)
                }
                sort={filters.sort}
                onSortChange={(sort) =>
                  setFilters((current) => ({ ...current, sort }))
                }
                hasQuery={Boolean(debouncedQuery)}
              />
              {error ? (
                <div className="sl-error">
                  <AlertCircle size={30} />
                  <p>{error}</p>
                </div>
              ) : loading ? (
                <div className="sl-grid">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="sl-card sl-filter-skeleton">
                      Đang tải tài liệu...
                    </div>
                  ))}
                </div>
              ) : documents.length === 0 ? (
                <div className="sl-empty">
                  <Library size={34} />
                  <p>
                    {activeTab === "my"
                      ? "Bạn chưa có tài liệu nào phù hợp."
                      : "Chưa có tài liệu cộng đồng phù hợp."}
                  </p>
                </div>
              ) : (
                <div className="sl-grid">
                  {documents.map((document) => (
                    <SystemDocumentCard
                      key={document.id}
                      document={document}
                      onToggleBookmark={handleToggleBookmark}
                      onToggleTag={(tag) =>
                        setSelectedTags((current) => toggleInList(current, tag))
                      }
                      onOpenDetails={openDocumentDetails}
                      onDownload={handleDownload}
                      downloading={downloadingId === document.id}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      <SystemDocumentDetailModal
        document={selectedDocument}
        onClose={() => setSelectedDocument(null)}
        onDownload={handleDownload}
        downloading={downloadingId === selectedDocument?.id}
        rating={documentRating}
        ratingLoading={ratingLoading}
        ratingSubmitting={ratingSubmitting}
        ratingError={ratingError}
        onRate={handleRateDocument}
      />
      <OpenAlexPaperDetailModal
        paper={selectedPaper}
        onClose={() => setSelectedPaper(null)}
        onImport={handleImportPaper}
      />
    </div>
  );
}
