/**
 * FE2 implement: Trang hỏi đáp cho một tài liệu
 * - Nhận docId từ URL params
 * - Hiển thị ChatBox
 */
import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import ChatBox from '../components/ChatBox'

export default function ResearchPage() {
  const { docId } = useParams()

  return (
    <div>
      <Link to="/">← Quay lại</Link>
      <h2>Nghiên cứu tài liệu</h2>
      <ChatBox docId={docId} />
    </div>
  )
}
