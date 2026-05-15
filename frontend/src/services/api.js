/**
 * FE1 + FE2: Toàn bộ HTTP calls tới backend đều đi qua file này.
 * Không gọi fetch/axios trực tiếp trong components.
 */
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: BASE_URL,
})

// ── Documents API (FE1) ────────────────────────────────────

/**
 * Upload file PDF
 * @param {File} file
 * @param {function} onProgress - callback(percent: number)
 * @returns {Promise<{doc_id, filename, chunk_count, page_count, created_at, status}>}
 */
export async function uploadDocument(file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await api.post('/api/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  })
  return data.data
}

/**
 * Lấy danh sách tài liệu
 * @returns {Promise<{documents: [], total: number}>}
 */
export async function getDocuments() {
  const { data } = await api.get('/api/documents')
  return data.data
}

/**
 * Xóa tài liệu
 * @param {string} docId
 */
export async function deleteDocument(docId) {
  const { data } = await api.delete(`/api/documents/${docId}`)
  return data.data
}

/**
 * Tóm tắt tài liệu
 * @param {string} docId
 * @returns {Promise<{summary, key_contributions, doc_id}>}
 */
export async function summarizeDocument(docId) {
  const { data } = await api.post(`/api/documents/${docId}/summarize`)
  return data.data
}

// ── Chat API (FE2) ─────────────────────────────────────────

/**
 * Hỏi đáp (non-streaming)
 * @param {string} docId
 * @param {string} question
 * @param {Array<{role, content}>} chatHistory
 * @returns {Promise<{answer, sources, tokens_used}>}
 */
export async function askQuestion(docId, question, chatHistory = []) {
  const { data } = await api.post('/api/chat/ask', {
    doc_id: docId,
    question,
    chat_history: chatHistory,
  })
  return data.data
}

/**
 * Hỏi đáp với streaming (SSE)
 * @param {string} docId
 * @param {string} question
 * @param {Array} chatHistory
 * @param {object} callbacks - { onSources, onToken, onDone, onError }
 */
export function askQuestionStream(docId, question, chatHistory = [], callbacks = {}) {
  const { onSources, onToken, onDone, onError } = callbacks

  fetch(`${BASE_URL}/api/chat/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id: docId, question, chat_history: chatHistory }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json()
        onError?.(err.error)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'sources') onSources?.(event.sources)
            if (event.type === 'token') onToken?.(event.content)
            if (event.type === 'done') onDone?.()
          } catch {
            // ignore malformed lines
          }
        }
      }
    })
    .catch((err) => onError?.(err))
}
