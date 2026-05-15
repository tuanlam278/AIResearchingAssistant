/**
 * FE1 implement: Trang chủ
 * - Hiển thị DocumentUploader
 * - Hiển thị DocumentList
 * - Khi click vào document → navigate tới /research/:docId
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DocumentUploader from '../components/DocumentUploader'
import DocumentList from '../components/DocumentList'
import { getDocuments, deleteDocument } from '../services/api'

export default function HomePage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchDocuments = async () => {
    try {
      const result = await getDocuments()
      setDocuments(result.documents)
    } catch (err) {
      console.error('Failed to fetch documents:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDocuments()
  }, [])

  const handleUploadSuccess = (doc) => {
    setDocuments((prev) => [doc, ...prev])
  }

  const handleDelete = async (docId) => {
    try {
      await deleteDocument(docId)
      setDocuments((prev) => prev.filter((d) => d.doc_id !== docId))
    } catch (err) {
      alert('Xóa thất bại: ' + err.message)
    }
  }

  const handleSelectDoc = (docId) => {
    navigate(`/research/${docId}`)
  }

  return (
    <div>
      <h1>AI Research Assistant</h1>
      <DocumentUploader onSuccess={handleUploadSuccess} />
      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <DocumentList
          documents={documents}
          onSelect={handleSelectDoc}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
