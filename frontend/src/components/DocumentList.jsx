/**
 * FE1 implement
 * Props:
 *   documents: DocumentResponse[]
 *   onSelect: (docId: string) => void
 *   onDelete: (docId: string) => void
 */
export default function DocumentList({ documents, onSelect, onDelete }) {
  if (documents.length === 0) {
    return <p>Chưa có tài liệu nào. Hãy upload file PDF.</p>
  }

  return (
    <ul>
      {documents.map((doc) => (
        <li key={doc.doc_id}>
          <span
            onClick={() => onSelect(doc.doc_id)}
            style={{ cursor: 'pointer' }}
          >
            📄 {doc.filename} — {doc.page_count} trang, {doc.chunk_count} chunks
          </span>
          <button onClick={() => onDelete(doc.doc_id)}>Xóa</button>
        </li>
      ))}
    </ul>
  )
}
