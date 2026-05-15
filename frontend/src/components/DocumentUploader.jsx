/**
 * FE1 implement
 * Props:
 *   onSuccess: (doc: DocumentResponse) => void
 */
import { useState, useRef } from 'react'
import { uploadDocument } from '../services/api'

export default function DocumentUploader({ onSuccess }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const inputRef = useRef()

  const handleFile = async (file) => {
    if (!file) return
    if (!file.name.endsWith('.pdf')) {
      setError('Chỉ chấp nhận file PDF')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('File quá lớn, tối đa 20MB')
      return
    }

    setError(null)
    setUploading(true)
    setProgress(0)

    try {
      const doc = await uploadDocument(file, setProgress)
      onSuccess?.(doc)
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Upload thất bại'
      setError(msg)
    } finally {
      setUploading(false)
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        onChange={(e) => handleFile(e.target.files[0])}
        disabled={uploading}
      />

      {/* TODO: FE1 thêm drag-and-drop */}

      {uploading && (
        <div>
          <progress value={progress} max={100} />
          <span>{progress}% — Đang xử lý, vui lòng chờ...</span>
        </div>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
