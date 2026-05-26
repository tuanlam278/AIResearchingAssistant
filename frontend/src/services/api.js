/**
 * FE1 + FE2: Toàn bộ HTTP calls tới backend đều đi qua file này.
 * Đã tích hợp Header Authorization (Token) và Auth APIs.
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const axiosInstance = axios.create({
  baseURL: BASE_URL,
});

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

// Bọc tất cả vào một object `api` để tương thích với các file UI đã viết
export const api = {
  // ================= AUTH API (Không cần token) =================
  login: (email, password) => {
    return unwrapRequest(() => axiosInstance.post("/api/auth/login", { email, password }));
  },

  register: (email, password) => {
    return unwrapRequest(() => axiosInstance.post("/api/auth/register", { email, password }));
  },

  logout: (token) => {
    return unwrapRequest(() => axiosInstance.post("/api/auth/logout", {}, {
      headers: { Authorization: `Bearer ${token}` }
    }));
  },

  // ================= DOCUMENTS & CHAT API (Bắt buộc có token) =================
  getDocuments: (token) => {
    return unwrapRequest(() => axiosInstance.get("/api/documents", {
      headers: { Authorization: `Bearer ${token}` }
    }));
  },

  uploadDocument: (file, token, onProgress) => {
    const formData = new FormData();
    formData.append("file", file);

    return unwrapRequest(() =>
      axiosInstance.post("/api/documents/upload", formData, {
        headers: { 
          //"Content-Type": "multipart/form-data",
          "Authorization": `Bearer ${token}`
        },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded * 100) / e.total));
          }
        },
      })
    );
  },

  deleteDocument: (docId, token) => {
    return unwrapRequest(() => axiosInstance.delete(`/api/documents/${docId}`, {
      headers: { Authorization: `Bearer ${token}` }
    }));
  },

  summarizeDocument: (docId, token) => {
    return unwrapRequest(() => axiosInstance.post(`/api/documents/${docId}/summarize`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    }));
  },

  sendResearchQuery: ({ docId, question, chatHistory = [] }, token) => {
    return unwrapRequest(() =>
      axiosInstance.post("/api/chat/ask", {
        doc_id: docId,
        question,
        chat_history: chatHistory,
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
    );
  }
};

