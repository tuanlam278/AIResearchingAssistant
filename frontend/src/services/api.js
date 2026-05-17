/**
 * FE1 + FE2: Toàn bộ HTTP calls tới backend đều đi qua file này.
 * Không gọi fetch/axios trực tiếp trong components.
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: BASE_URL,
});

function normalizeError(err) {
  if (axios.isAxiosError(err)) {
    const apiError = err.response?.data?.error;
    const message =
      apiError?.message || err.message || "Không thể kết nối server";
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

export async function uploadDocument(file, onProgress) {
  const formData = new FormData();
  formData.append("file", file);

  return unwrapRequest(() =>
    api.post("/api/documents/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    }),
  );
}

export async function getDocuments() {
  return unwrapRequest(() => api.get("/api/documents"));
}

export async function deleteDocument(docId) {
  return unwrapRequest(() => api.delete(`/api/documents/${docId}`));
}

export async function summarizeDocument(docId) {
  return unwrapRequest(() => api.post(`/api/documents/${docId}/summarize`));
}

export async function sendResearchQuery({ docId, question, chatHistory = [] }) {
  return unwrapRequest(() =>
    api.post("/api/chat/ask", {
      doc_id: docId,
      question,
      chat_history: chatHistory,
    }),
  );
}

// Backward compatible alias for existing usages.
export async function askQuestion(docId, question, chatHistory = []) {
  return sendResearchQuery({ docId, question, chatHistory });
}
