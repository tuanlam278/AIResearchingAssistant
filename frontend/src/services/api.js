/**
 * Toàn bộ HTTP calls tới backend đều đi qua file này.
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const axiosInstance = axios.create({ baseURL: BASE_URL });

export const REQUEST_TIMEOUTS = {
  session: 15000,
  chat: 60000,
};

const TIMEOUT_MESSAGE = "Máy chủ phản hồi quá lâu. Vui lòng thử lại sau.";

function timeoutConfig(timeoutMs, options = {}) {
  return {
    timeout: timeoutMs,
    signal: options.signal,
  };
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUTS.session) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const abortFromCaller = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout && error?.name === "AbortError") {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener?.("abort", abortFromCaller);
  }
}


function dataUrlToFile(dataUrl, filename = "academic-lens-crop.png") {
  const [header, base64 = ""] = String(dataUrl || "").split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

function normalizeError(err) {
  if (err?.code === "ECONNABORTED" || err?.message === TIMEOUT_MESSAGE || /timeout/i.test(err?.message || "")) {
    const error = new Error(TIMEOUT_MESSAGE);
    error.name = "TimeoutError";
    error.code = "REQUEST_TIMEOUT";
    return error;
  }

  if (axios.isCancel?.(err) || err?.name === "AbortError" || err?.code === "ERR_CANCELED") {
    const error = new Error(err?.message === TIMEOUT_MESSAGE ? TIMEOUT_MESSAGE : "Request aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    return error;
  }

  if (axios.isAxiosError(err)) {
    const apiError = err.response?.data?.error || err.response?.data?.detail;
    const message = (typeof apiError === "string" ? apiError : apiError?.message) || err.message || "Không thể kết nối server";
    const error = new Error(message);
    error.code = (typeof apiError === "string" ? undefined : apiError?.code) || "NETWORK_ERROR";
    if ((err.response?.status === 401 || err.response?.status === 403) && (error.code === "ACCOUNT_DISABLED" || /vô hiệu hóa|không tồn tại/i.test(message))) {
      window.dispatchEvent(new CustomEvent("auth:force-logout", { detail: { message } }));
    }
    error.status = err.response?.status;
    error.details = err.response?.data;
    return error;
  }
  const fallback = new Error(err?.message || "Đã có lỗi xảy ra");
  fallback.code = "UNKNOWN_ERROR";
  return fallback;
}

async function unwrapRequest(requestFn) {
  try {
    const { data } = await requestFn();
    if (data?.success === false) {
      const error = new Error(data?.error?.message || "Yêu cầu thất bại");
      error.code = data?.error?.code || "API_ERROR";
      error.details = data;
      throw error;
    }
    return data?.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

function parseContentDispositionFilename(header = "") {
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(utf8Match[1]); } catch {}
  }
  const asciiMatch = header.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] || "";
}

async function getBlobResponse(response, fallbackFilename = "document") {
  const blob = new Blob([response.data], { type: response.headers?.["content-type"] || "application/octet-stream" });
  const filename = parseContentDispositionFilename(response.headers?.["content-disposition"] || "") || fallbackFilename;
  return { blob, filename, contentType: blob.type };
}

async function triggerBlobDownload(response, fallbackFilename = "system-document") {
  const blob = new Blob([response.data], { type: response.headers?.["content-type"] || "application/octet-stream" });
  const filename = parseContentDispositionFilename(response.headers?.["content-disposition"] || "") || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

async function readSseStream(response, callbacks = {}) {
  if (!response.body) throw new Error("Trình duyệt không hỗ trợ streaming response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const dataLine = rawEvent
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;

      try {
        const event = JSON.parse(dataLine.slice(6));
        if (event.type === "status") callbacks.onStatus?.(event.status, event.message);
        if (event.type === "sources") callbacks.onSources?.(event.sources || event.citations || [], event.citations || event.sources || []);
        if (event.type === "retrieval_diagnostics") callbacks.onDiagnostics?.(event.retrieval_diagnostics || event.diagnostics || null);
        if (event.type === "warning") callbacks.onWarning?.(event.warning || event.message || "");
        if (event.type === "suggested_prompts") callbacks.onSuggestedPrompts?.(event.suggested_prompts || []);
        if (event.type === "token") callbacks.onToken?.(event.content || "");
        if (event.type === "done") {
          if (event.retrieval_diagnostics || event.diagnostics) callbacks.onDiagnostics?.(event.retrieval_diagnostics || event.diagnostics);
          if (event.warning) callbacks.onWarning?.(event.warning);
          if (event.suggested_prompts) callbacks.onSuggestedPrompts?.(event.suggested_prompts || []);
          callbacks.onDone?.(event);
        }
        if (event.type === "error") callbacks.onError?.(event.message, event);
      } catch (err) {
        console.warn("Không parse được SSE event", err);
      }
    }
  }
}

export const api = {
  // ── AUTH ──────────────────────────────────────────────────────────────────
  login: (email, password) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/login", { email, password })),

  register: (email, password, name) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/register", { email, password, confirm_password: password, name, username: name })),

  me: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/auth/me", { headers: authHeader(token) })),

  logout: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/logout", {}, { headers: authHeader(token) })),


  loginWithGoogle: (credential) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/google", { credential })),

  requestPasswordResetOtp: (email) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/password-reset/request", { email })),

  verifyPasswordResetOtp: (email, otp) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/password-reset/verify", { email, otp })),

  confirmPasswordResetWithOtp: (email, otp, newPassword) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/password-reset/confirm", { email, otp, new_password: newPassword })),

  requestPasswordReset: (email) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/password-reset/request", { email })),

  getProfile: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/profile/me", { headers: authHeader(token) })),

  updateProfile: (payload, token) =>
    unwrapRequest(() => axiosInstance.patch("/api/profile/me", payload, { headers: authHeader(token) })),

  uploadAvatar: (file, token, onProgress) => {
    const formData = new FormData();
    formData.append("avatar", file);
    return unwrapRequest(() => axiosInstance.post("/api/profile/avatar", formData, {
      headers: { ...authHeader(token) },
      onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded * 100) / e.total) : 0),
    }));
  },

  changePassword: (payload, token) =>
    unwrapRequest(() => axiosInstance.post("/api/profile/change-password", payload, { headers: authHeader(token) })),

  enableEmail2fa: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/profile/2fa/email/enable", {}, { headers: authHeader(token) })),

  disableEmail2fa: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/profile/2fa/email/disable", {}, { headers: authHeader(token) })),

  connectGoogle: (credential, token) =>
    unwrapRequest(() => axiosInstance.post("/api/profile/social/google/connect", { credential }, { headers: authHeader(token) })),

  disconnectGoogle: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/profile/social/google/disconnect", {}, { headers: authHeader(token) })),

  updatePreferences: (payload, token) =>
    unwrapRequest(() => axiosInstance.patch("/api/profile/preferences", payload, { headers: authHeader(token) })),

  getProfileActivity: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/profile/activity", { headers: authHeader(token) })),

  deactivateAccount: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/profile/deactivate", {}, { headers: authHeader(token) })),

  deleteAccount: (token) =>
    unwrapRequest(() => axiosInstance.delete("/api/profile/account", { headers: authHeader(token) })),

  // ── NOTEBOOKS ─────────────────────────────────────────────────────────────
  getNotebooks: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/notebooks", { headers: authHeader(token) })),

  createNotebook: (name, token) =>
    unwrapRequest(() => axiosInstance.post("/api/notebooks", { name }, { headers: authHeader(token) })),

  updateNotebook: (notebookId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.patch(`/api/notebooks/${notebookId}`, payload, { headers: authHeader(token) })
    ),

  deleteNotebook: (notebookId, token) =>
    unwrapRequest(() => axiosInstance.delete(`/api/notebooks/${notebookId}`, { headers: authHeader(token) })),

  // ── DOCUMENTS TRONG NOTEBOOK ──────────────────────────────────────────────
  getNotebookDocuments: (notebookId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/notebooks/${notebookId}/documents`, { headers: authHeader(token) })
    ),

  getWorkspaceDocumentSummary: (workspaceId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/workspaces/${workspaceId}/documents/summary`, { headers: authHeader(token) })
    ),

  generateWorkspaceDocumentSummary: (workspaceId, documentIds, token) =>
    unwrapRequest(() =>
      axiosInstance.post(
        `/api/workspaces/${workspaceId}/documents/summary/generate`,
        { document_ids: documentIds },
        { headers: authHeader(token) }
      )
    ),

  // Upload nhiều file cùng lúc vào một notebook
  uploadDocuments: (notebookId, files, token, onProgress, options = {}) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("citation_threshold", Number.isFinite(Number(options.citationThreshold)) ? Number(options.citationThreshold) : 0);
    formData.append("tags", options.tags || "");
    return unwrapRequest(() =>
      axiosInstance.post(`/api/notebooks/${notebookId}/upload`, formData, {
        headers: { ...authHeader(token) },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded * 100) / e.total));
          }
        },
      })
    );
  },

  linkSystemDocumentToNotebook: (notebookId, systemDocumentId, token) =>
    unwrapRequest(() =>
      axiosInstance.post(
        `/api/notebooks/${notebookId}/system-documents`,
        { system_document_id: systemDocumentId },
        { headers: authHeader(token) }
      )
    ),

  deleteDocument: (docId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/documents/${docId}`, { headers: authHeader(token) })
    ),

  // ── NOTES ────────────────────────────────────────────────────────────────
  getWorkspaceNotes: (workspaceId, token, params = {}, options = {}) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/workspaces/${workspaceId}/notes`, {
        params,
        headers: authHeader(token),
        ...timeoutConfig(REQUEST_TIMEOUTS.session, options),
      })
    ),

  getResearchSessionNotes: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/research-sessions/${sessionId}/notes`, { headers: authHeader(token) })
    ),

  createWorkspaceNote: (workspaceId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/workspaces/${workspaceId}/notes`, payload, { headers: authHeader(token) })
    ),

  updateNote: (noteId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.patch(`/api/notes/${noteId}`, payload, { headers: authHeader(token) })
    ),

  deleteNote: (noteId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/notes/${noteId}`, { headers: authHeader(token) })
    ),

  // ── RESEARCH SESSIONS ───────────────────────────────────────────────────────
  getResearchSessions: (workspaceId, token, options = {}) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/workspaces/${workspaceId}/research-sessions`, {
        headers: authHeader(token),
        ...timeoutConfig(REQUEST_TIMEOUTS.session, options),
      })
    ),

  createResearchSession: (workspaceId, selectedDocumentIds, token) =>
    unwrapRequest(() =>
      axiosInstance.post(
        `/api/workspaces/${workspaceId}/research-sessions`,
        { selected_document_ids: selectedDocumentIds },
        { headers: authHeader(token) }
      )
    ),

  updateResearchSession: (sessionId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.patch(`/api/research-sessions/${sessionId}`, payload, { headers: authHeader(token) })
    ),

  deleteResearchSession: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/research-sessions/${sessionId}`, { headers: authHeader(token) })
    ),

  getResearchSessionMessages: (sessionId, token, options = {}) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/research-sessions/${sessionId}/messages`, {
        headers: authHeader(token),
        ...timeoutConfig(REQUEST_TIMEOUTS.session, options),
      })
    ),

  clearResearchSessionMessages: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/research-sessions/${sessionId}/messages`, { headers: authHeader(token) })
    ),

  exportResearchSessionDocx: async (sessionId, token) => {
    try {
      const response = await axiosInstance.get(`/api/research-sessions/${sessionId}/export.docx`, {
        headers: authHeader(token),
        responseType: "blob",
      });
      return response;
    } catch (err) {
      throw normalizeError(err);
    }
  },

  generateFlashcards: (sessionId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/research-sessions/${sessionId}/flashcards/generate`, payload, { headers: authHeader(token) })
    ),

  generateQuiz: (sessionId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/research-sessions/${sessionId}/quizzes/generate`, payload, { headers: authHeader(token) })
    ),

  generateTest: (sessionId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/research-sessions/${sessionId}/tests/generate`, payload, { headers: authHeader(token) })
    ),


  // ── SYSTEM LIBRARY ───────────────────────────────────────────────────────
  // Legacy API name; UI treats this as unified System / Community / Internet library.
  listSystemLibraryDocuments: (params, token) =>
    unwrapRequest(() =>
      axiosInstance.get("/api/system-library/documents", { params, headers: authHeader(token) })
    ),

  searchSystemLibrary: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/system-library/search", payload, { headers: authHeader(token) })
    ),

  getSystemLibraryBookmarks: (token) =>
    unwrapRequest(() =>
      axiosInstance.get("/api/system-library/bookmarks", { headers: authHeader(token) })
    ),

  getSystemLibraryTags: (token, limit = 200) =>
    unwrapRequest(() => axiosInstance.get("/api/system-library/tags", { params: { limit }, headers: authHeader(token) })),

  uploadCommunityLibraryDocument: (payload, token, onProgress) => {
    const formData = new FormData();
    formData.append("file", payload.file);
    formData.append("title", payload.title || "");
    formData.append("description", payload.description || "");
    formData.append("category", payload.category || "");
    formData.append("tags", payload.tags || "");
    formData.append("citation_threshold", Number.isFinite(Number(payload.citationThreshold)) ? Number(payload.citationThreshold) : 0);
    formData.append("copyright_confirmed", payload.copyrightConfirmed ? "true" : "false");
    return unwrapRequest(() =>
      axiosInstance.post("/api/system-library/documents/upload", formData, {
        headers: { ...authHeader(token) },
        onUploadProgress: (event) => {
          if (onProgress && event.total) onProgress(Math.round((event.loaded * 100) / event.total));
        },
      })
    );
  },

  getDocumentRating: (documentId, documentType = "system_library", token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/system-library/documents/${documentId}/rating`, {
        params: { document_type: documentType },
        headers: authHeader(token),
      })
    ),

  rateDocument: (documentId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post(
        `/api/system-library/documents/${documentId}/rating`,
        { document_type: payload.documentType || payload.document_type || "system_library", rating: payload.rating },
        { headers: authHeader(token) }
      )
    ),

  voteSystemDocument: (documentId, rating, token) =>
    unwrapRequest(() => axiosInstance.post(`/api/system-library/documents/${documentId}/vote`, { rating }, { headers: authHeader(token) })),

  searchInternetPapers: (payload, token) =>
    unwrapRequest(() => axiosInstance.post("/api/system-library/papers/search", payload, { headers: authHeader(token) })),

  importInternetPaperToLibrary: (paper, token) =>
    unwrapRequest(() => axiosInstance.post("/api/system-library/papers/import", { paper }, { headers: authHeader(token) })),

  updateMyLibraryDocument: (documentId, payload, token) =>
    unwrapRequest(() => axiosInstance.patch(`/api/system-library/my-documents/${documentId}`, payload, { headers: authHeader(token) })),

  deleteMyLibraryDocument: (documentId, token) =>
    unwrapRequest(() => axiosInstance.delete(`/api/system-library/my-documents/${documentId}`, { headers: authHeader(token) })),

  resubmitMyLibraryDocument: (documentId, token) =>
    unwrapRequest(() => axiosInstance.post(`/api/system-library/my-documents/${documentId}/resubmit`, {}, { headers: authHeader(token) })),

  updateUserLibraryUploadPermission: (userId, payload, token) =>
    unwrapRequest(() => axiosInstance.patch(`/api/admin/users/${userId}/library-upload`, payload, { headers: authHeader(token) })),

  updateUserPublishPermission: (userId, payload, token) =>
    unwrapRequest(() => axiosInstance.patch(`/api/admin/users/${userId}/publish-permission`, payload, { headers: authHeader(token) })),

  updateLibraryDocumentStatus: (documentId, payload, token) =>
    unwrapRequest(() => axiosInstance.patch(`/api/admin/library/documents/${documentId}/status`, payload, { headers: authHeader(token) })),

  bookmarkSystemDocument: (documentId, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/system-library/documents/${documentId}/bookmark`, {}, { headers: authHeader(token) })
    ),

  unbookmarkSystemDocument: (documentId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/system-library/documents/${documentId}/bookmark`, { headers: authHeader(token) })
    ),

  fetchSystemDocumentBlob: async (documentId, token, fallbackFilename = "system-document") => {
    try {
      const response = await axiosInstance.get(`/api/system-library/documents/${documentId}/download`, {
        headers: authHeader(token),
        responseType: "blob",
      });
      return getBlobResponse(response, fallbackFilename);
    } catch (err) {
      throw normalizeError(err);
    }
  },

  downloadSystemDocument: async (documentId, token, fallbackFilename = "system-document") => {
    try {
      const response = await axiosInstance.get(`/api/system-library/documents/${documentId}/download`, {
        headers: authHeader(token),
        responseType: "blob",
      });
      return triggerBlobDownload(response, fallbackFilename);
    } catch (err) {
      throw normalizeError(err);
    }
  },

  importSystemDocument: (payload, token, onProgress) => {
    const formData = new FormData();
    formData.append("file", payload.file);
    formData.append("title", payload.title || "");
    formData.append("category", payload.category || "");
    formData.append("tags", payload.tags || "");
    formData.append("citation_threshold", Number.isFinite(Number(payload.citationThreshold)) ? Number(payload.citationThreshold) : 0);
    return unwrapRequest(() =>
      axiosInstance.post("/api/admin/system-library/import", formData, {
        headers: { ...authHeader(token) },
        onUploadProgress: (event) => {
          if (onProgress && event.total) onProgress(Math.round((event.loaded * 100) / event.total));
        },
      })
    );
  },

  listAdminSystemDocuments: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/admin/system-library/documents", { headers: authHeader(token) })),

  deleteAdminSystemDocument: (documentId, token) =>
    unwrapRequest(() => axiosInstance.delete(`/api/admin/system-library/documents/${documentId}`, { headers: authHeader(token) })),

  linkSystemDocumentToNotebook: (notebookId, systemDocumentId, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/notebooks/${notebookId}/system-documents`, { system_document_id: systemDocumentId }, { headers: authHeader(token) })
    ),

  // ── CROSS ANALYSIS ──────────────────────────────────────────────────────
  uploadCrossAnalysisDocument: (file, token, onProgress) => {
    const formData = new FormData();
    formData.append("file", file);
    return unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/documents/upload", formData, {
        headers: { ...authHeader(token) },
        onUploadProgress: (event) => {
          if (onProgress && event.total) onProgress(Math.round((event.loaded * 100) / event.total));
        },
      })
    );
  },

  compareCrossAnalysisDocuments: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/compare", payload, { headers: authHeader(token) })
    ),

  findCrossAnalysisConflicts: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/conflicts", payload, { headers: authHeader(token) })
    ),

  synthesizeCrossAnalysisDocuments: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/synthesis", payload, { headers: authHeader(token) })
    ),

  chatCrossAnalysisDocuments: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/chat", payload, { headers: authHeader(token) })
    ),

  createCrossAnalysisSession: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/sessions", payload, { headers: authHeader(token) })
    ),

  listCrossAnalysisSessions: (token) =>
    unwrapRequest(() =>
      axiosInstance.get("/api/cross-analysis/sessions", { headers: authHeader(token) })
    ),

  getCrossAnalysisSession: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/cross-analysis/sessions/${sessionId}`, { headers: authHeader(token) })
    ),

  updateCrossAnalysisSession: (sessionId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.patch(`/api/cross-analysis/sessions/${sessionId}`, payload, { headers: authHeader(token) })
    ),

  deleteCrossAnalysisSession: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/cross-analysis/sessions/${sessionId}`, { headers: authHeader(token) })
    ),

  // ── ACADEMIC LENS ──────────────────────────────────────────────────────
  uploadAcademicLensDocument: (file, token, onProgress) => {
    const formData = new FormData();
    formData.append("file", file);
    return unwrapRequest(() =>
      axiosInstance.post("/api/academic-lens/documents/upload", formData, {
        headers: { ...authHeader(token) },
        onUploadProgress: (event) => {
          if (onProgress && event.total) onProgress(Math.round((event.loaded * 100) / event.total));
        },
      })
    );
  },

  getAcademicLensDocumentPreview: (documentId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/academic-lens/documents/${documentId}/preview`, { headers: authHeader(token) })
    ),

  documentAcademicLensChat: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/academic-lens/document-chat", payload, { headers: authHeader(token) })
    ),

  webAcademicLensChat: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/academic-lens/web-chat", payload, { headers: authHeader(token) })
    ),

  visionAcademicLensChat: (payload, token) => {
    const formData = new FormData();
    if (payload?.image instanceof File || payload?.image instanceof Blob) {
      formData.append("image", payload.image, payload.image.name || "academic-lens-crop.png");
    } else if (payload?.image_data_url) {
      formData.append("image", dataUrlToFile(payload.image_data_url));
    }
    formData.append("prompt", payload?.prompt || "");
    if (payload?.document_id) formData.append("document_id", payload.document_id);
    return unwrapRequest(() =>
      axiosInstance.post("/api/academic-lens/vision-chat", formData, { headers: { ...authHeader(token) } })
    );
  },

  getAcademicLensWebContexts: (params = {}, token) =>
    unwrapRequest(() =>
      axiosInstance.get("/api/academic-lens/web-contexts", { params, headers: authHeader(token) })
    ),

  addAcademicLensWebContext: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/academic-lens/web-contexts", payload, { headers: authHeader(token) })
    ),

  updateAcademicLensWebContext: (contextId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.patch(`/api/academic-lens/web-contexts/${contextId}`, payload, { headers: authHeader(token) })
    ),

  deleteAcademicLensWebContext: (contextId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/academic-lens/web-contexts/${contextId}`, { headers: authHeader(token) })
    ),

  getAcademicLensNotepad: (params = {}, token) =>
    unwrapRequest(() =>
      axiosInstance.get("/api/academic-lens/notes", { params, headers: authHeader(token) })
    ),

  saveAcademicLensNotepad: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.put("/api/academic-lens/notes", payload, { headers: authHeader(token) })
    ),

  createAcademicLensSession: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/academic-lens/sessions", payload, { headers: authHeader(token) })
    ),

  listAcademicLensSessions: (params = {}, token) =>
    unwrapRequest(() =>
      axiosInstance.get("/api/academic-lens/sessions", { params, headers: authHeader(token) })
    ),

  getAcademicLensSession: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/academic-lens/sessions/${sessionId}`, { headers: authHeader(token) })
    ),

  addAcademicLensSessionMessage: (sessionId, payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/academic-lens/sessions/${sessionId}/messages`, payload, { headers: authHeader(token) })
    ),

  clearAcademicLensSessionMessages: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/academic-lens/sessions/${sessionId}/messages`, { headers: authHeader(token) })
    ),

  clearCrossAnalysisChat: (payload, token) =>
    unwrapRequest(() =>
      axiosInstance.post("/api/cross-analysis/chat/clear", payload, { headers: authHeader(token) })
    ),

  getCrossAnalysisDocumentPreview: (documentId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/cross-analysis/documents/${documentId}/preview`, { headers: authHeader(token) })
    ),

  // ── CHAT ─────────────────────────────────────────────────────────────────
  sendResearchQuery: ({ notebookId, question, chatHistory = [], selectedDocumentIds = [], researchSessionId = null, citationThreshold = 0 }, token, options = {}) =>
    unwrapRequest(() =>
      axiosInstance.post(
        "/api/chat/ask",
        { notebook_id: notebookId, question, chat_history: chatHistory, selected_document_ids: selectedDocumentIds, research_session_id: researchSessionId, citation_threshold: Number.isFinite(Number(citationThreshold)) ? Number(citationThreshold) : 0 },
        { headers: authHeader(token), signal: options.signal }
      )
    ),

  streamResearchQuery: async ({ notebookId, question, chatHistory = [], selectedDocumentIds = [], researchSessionId = null, citationThreshold = 0 }, token, callbacks = {}, options = {}) => {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/chat/ask/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          notebook_id: notebookId,
          question,
          chat_history: chatHistory,
          selected_document_ids: selectedDocumentIds,
          research_session_id: researchSessionId,
          citation_threshold: Number.isFinite(Number(citationThreshold)) ? Number(citationThreshold) : 0,
        }),
        signal: options.signal,
      }, options.timeoutMs || REQUEST_TIMEOUTS.chat);

      if (!response.ok) {
        let message = "Stream request failed";
        try {
          const body = await response.json();
          message = body?.detail?.message || body?.error?.message || message;
        } catch {}
        throw new Error(message);
      }

      await readSseStream(response, callbacks);
    } catch (err) {
      throw normalizeError(err);
    }
  },

  sendWorkspaceMessage: (workspaceId, payload, options = {}) => {
    const notebookId = workspaceId;
    const question = payload?.message || payload?.question || "";
    const chatHistory = payload?.chat_history || payload?.chatHistory || [];
    const selectedDocumentIds = payload?.selected_document_ids || payload?.selectedDocumentIds || [];
    const researchSessionId = payload?.research_session_id || payload?.researchSessionId || null;

    if (options.stream) {
      return api.streamResearchQuery(
        { notebookId, question, chatHistory, selectedDocumentIds, researchSessionId },
        options.token,
        options.callbacks,
        { signal: options.signal }
      );
    }

    return api.sendResearchQuery(
      { notebookId, question, chatHistory, selectedDocumentIds, researchSessionId },
      options.token,
      { signal: options.signal }
    );
  },
};
