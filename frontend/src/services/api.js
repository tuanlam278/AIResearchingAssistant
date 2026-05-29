/**
 * Toàn bộ HTTP calls tới backend đều đi qua file này.
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const axiosInstance = axios.create({ baseURL: BASE_URL });

function normalizeError(err) {
  if (axios.isCancel?.(err) || err?.name === "AbortError" || err?.code === "ERR_CANCELED") {
    const error = new Error("Request aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    return error;
  }

  if (axios.isAxiosError(err)) {
    const apiError = err.response?.data?.error || err.response?.data?.detail;
    const message = apiError?.message || err.message || "Không thể kết nối server";
    const error = new Error(message);
    error.code = apiError?.code || "NETWORK_ERROR";
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
  return asciiMatch?.[1] || "system-document";
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
        if (event.type === "warning") callbacks.onWarning?.(event.warning || event.message || "");
        if (event.type === "suggested_prompts") callbacks.onSuggestedPrompts?.(event.suggested_prompts || []);
        if (event.type === "token") callbacks.onToken?.(event.content || "");
        if (event.type === "done") {
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

  register: (email, password) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/register", { email, password })),

  me: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/auth/me", { headers: authHeader(token) })),

  logout: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/logout", {}, { headers: authHeader(token) })),

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
  uploadDocuments: (notebookId, files, token, onProgress) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
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

  deleteDocument: (docId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/documents/${docId}`, { headers: authHeader(token) })
    ),

  // ── NOTES ────────────────────────────────────────────────────────────────
  getWorkspaceNotes: (workspaceId, token, params = {}) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/workspaces/${workspaceId}/notes`, { params, headers: authHeader(token) })
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
  getResearchSessions: (workspaceId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/workspaces/${workspaceId}/research-sessions`, { headers: authHeader(token) })
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

  getResearchSessionMessages: (sessionId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/research-sessions/${sessionId}/messages`, { headers: authHeader(token) })
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

  bookmarkSystemDocument: (documentId, token) =>
    unwrapRequest(() =>
      axiosInstance.post(`/api/system-library/documents/${documentId}/bookmark`, {}, { headers: authHeader(token) })
    ),

  unbookmarkSystemDocument: (documentId, token) =>
    unwrapRequest(() =>
      axiosInstance.delete(`/api/system-library/documents/${documentId}/bookmark`, { headers: authHeader(token) })
    ),

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

  // ── CHAT ─────────────────────────────────────────────────────────────────
  sendResearchQuery: ({ notebookId, question, chatHistory = [], selectedDocumentIds = [], researchSessionId = null }, token, options = {}) =>
    unwrapRequest(() =>
      axiosInstance.post(
        "/api/chat/ask",
        { notebook_id: notebookId, question, chat_history: chatHistory, selected_document_ids: selectedDocumentIds, research_session_id: researchSessionId },
        { headers: authHeader(token), signal: options.signal }
      )
    ),

  streamResearchQuery: async ({ notebookId, question, chatHistory = [], selectedDocumentIds = [], researchSessionId = null }, token, callbacks = {}, options = {}) => {
    try {
      const response = await fetch(`${BASE_URL}/api/chat/ask/stream`, {
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
        }),
        signal: options.signal,
      });

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
