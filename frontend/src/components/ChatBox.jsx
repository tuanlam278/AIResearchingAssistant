/**
 * FE2 implement: Component hỏi đáp chính
 * Props:
 *   docId: string
 */
import { useState, useRef, useEffect } from 'react'
import { askQuestionStream } from '../services/api'
import SourceCard from './SourceCard'

export default function ChatBox({ docId }) {
  const [messages, setMessages] = useState([])   // [{role, content, sources?}]
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Chat history để gửi lên backend (chỉ role + content, không có sources)
  const getChatHistory = () =>
    messages.map(({ role, content }) => ({ role, content }))

  const handleSend = () => {
    if (!input.trim() || loading) return

    const question = input.trim()
    setInput('')

    // Thêm user message
    setMessages((prev) => [...prev, { role: 'user', content: question }])

    // Placeholder cho assistant message
    setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: [] }])

    setLoading(true)

    askQuestionStream(docId, question, getChatHistory(), {
      onSources: (sources) => {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], sources }
          return updated
        })
      },
      onToken: (token) => {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + token,
          }
          return updated
        })
      },
      onDone: () => setLoading(false),
      onError: (err) => {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: `❌ Lỗi: ${err?.message || 'Không thể kết nối server'}`,
          }
          return updated
        })
        setLoading(false)
      },
    })
  }

  return (
    <div>
      {/* Messages */}
      <div style={{ minHeight: 300, overflowY: 'auto' }}>
        {messages.map((msg, i) => (
          <div key={i}>
            <strong>{msg.role === 'user' ? 'Bạn' : 'Trợ lý'}:</strong>
            <p>{msg.content}{msg.role === 'assistant' && loading && i === messages.length - 1 && '▌'}</p>
            {msg.sources?.length > 0 && (
              <div>
                <small>Nguồn tham khảo:</small>
                {msg.sources.map((src) => (
                  <SourceCard key={src.chunk_id} source={src} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Đặt câu hỏi về tài liệu..."
          disabled={loading}
          maxLength={1000}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? 'Đang trả lời...' : 'Gửi'}
        </button>
      </div>
    </div>
  )
}
