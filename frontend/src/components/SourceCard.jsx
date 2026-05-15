/**
 * FE2 implement: Hiển thị một chunk nguồn tham khảo
 * Props:
 *   source: { chunk_id, content, page, score }
 */
export default function SourceCard({ source }) {
  return (
    <div style={{ border: '1px solid #ccc', padding: 8, margin: 4 }}>
      <small>Trang {source.page} · Độ liên quan: {Math.round(source.score * 100)}%</small>
      <p style={{ fontSize: 12 }}>{source.content}</p>
    </div>
  )
}
