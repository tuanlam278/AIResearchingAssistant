/**
 * Toàn bộ HTTP calls tới backend đều đi qua file này.
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const axiosInstance = axios.create({ baseURL: BASE_URL });

function normalizeError(err) {
  if (axios.isAxiosError(err)) {
    const apiError = err.response?.data?.error;
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

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

export const api = {
  // ── AUTH ──────────────────────────────────────────────────────────────────
  login: (email, password) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/login", { email, password })),

  register: (email, password) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/register", { email, password })),

  logout: (token) =>
    unwrapRequest(() => axiosInstance.post("/api/auth/logout", {}, { headers: authHeader(token) })),

  // ── NOTEBOOKS ─────────────────────────────────────────────────────────────
  getNotebooks: (token) =>
    unwrapRequest(() => axiosInstance.get("/api/notebooks", { headers: authHeader(token) })),

  createNotebook: (name, token) =>
    unwrapRequest(() => axiosInstance.post("/api/notebooks", { name }, { headers: authHeader(token) })),

  deleteNotebook: (notebookId, token) =>
    unwrapRequest(() => axiosInstance.delete(`/api/notebooks/${notebookId}`, { headers: authHeader(token) })),

  // ── DOCUMENTS TRONG NOTEBOOK ──────────────────────────────────────────────
  getNotebookDocuments: (notebookId, token) =>
    unwrapRequest(() =>
      axiosInstance.get(`/api/notebooks/${notebookId}/documents`, { headers: authHeader(token) })
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

  // ── CHAT ─────────────────────────────────────────────────────────────────
  sendResearchQuery: ({ notebookId, question, chatHistory = [] }, token) =>
    unwrapRequest(() =>
      axiosInstance.post(
        "/api/chat/ask",
        { notebook_id: notebookId, question, chat_history: chatHistory },
        { headers: authHeader(token) }
      )
    ),
  streamResearchQuery: async ({ notebookId, question, chatHistory = [] }, token, callbacks) => {
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
      }),
    });

    if (!response.ok) throw new Error("Stream request failed");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "sources") callbacks.onSources?.(event.sources);
          if (event.type === "token")   callbacks.onToken?.(event.content);
          if (event.type === "done")    callbacks.onDone?.();
          if (event.type === "error")   callbacks.onError?.(event.message);
        } catch {}
      }
    }
  },
};