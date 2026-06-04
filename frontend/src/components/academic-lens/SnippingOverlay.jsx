import { useRef, useState } from 'react';

function rectFromPoints(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

function drawTextCrop(text, selectionRect) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(1400, Math.max(360, Math.round(selectionRect.width * window.devicePixelRatio)));
  canvas.height = Math.min(1000, Math.max(220, Math.round(selectionRect.height * window.devicePixelRatio)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15120d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#efe6d4';
  ctx.font = '18px Georgia';
  ctx.fillText('Ảnh dựng từ vùng văn bản đã chọn', 18, 32);
  ctx.strokeStyle = '#d4b66f';
  ctx.strokeRect(10, 48, canvas.width - 20, canvas.height - 58);
  ctx.fillStyle = '#ded4c4';
  ctx.font = '15px sans-serif';
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ');
  const maxWidth = canvas.width - 40;
  let line = '';
  let y = 78;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth) {
      ctx.fillText(line, 20, y);
      line = word;
      y += 23;
      if (y > canvas.height - 22) break;
    } else {
      line = testLine;
    }
  }
  if (line && y <= canvas.height - 22) ctx.fillText(line, 20, y);
  return canvas.toDataURL('image/png');
}

function captureTextFallback(target, drag) {
  const textDoc = target?.querySelector?.('.al-text-doc');
  if (!textDoc) return null;
  const text = textDoc.innerText || textDoc.textContent || '';
  if (!text.trim()) return null;
  return {
    dataUrl: drawTextCrop(text.slice(0, 3500), drag),
    warning: 'Trình duyệt không cho phép chụp pixel trực tiếp nếu không dùng thư viện/screen-capture. Ảnh này được dựng từ văn bản thật trong reader, không phải pixel gốc. PDF/iframe cần PDF.js/canvas để crop chính xác.',
  };
}

export default function SnippingOverlay({ active, targetRef, onCancel, onCapture }) {
  const [drag, setDrag] = useState(null);
  const originRef = useRef(null);
  if (!active) return null;

  const handlePointerDown = (event) => {
    if (event.target.closest('button')) return;
    originRef.current = { x: event.clientX, y: event.clientY };
    setDrag(rectFromPoints(originRef.current, originRef.current));
  };
  const handlePointerMove = (event) => {
    if (!originRef.current) return;
    setDrag(rectFromPoints(originRef.current, { x: event.clientX, y: event.clientY }));
  };
  const handlePointerUp = () => {
    if (!drag || drag.width < 12 || drag.height < 12) {
      originRef.current = null;
      setDrag(null);
      return;
    }
    const target = targetRef.current;
    const targetBox = target?.getBoundingClientRect();
    const relativeRect = targetBox ? { ...drag, left: drag.left - targetBox.left + target.scrollLeft, top: drag.top - targetBox.top + target.scrollTop } : drag;
    const hasPdfFrame = Boolean(target?.querySelector?.('iframe'));
    if (hasPdfFrame) {
      onCapture({ rect: relativeRect, error: 'Không thể chụp trực tiếp vùng PDF khi đang dùng iframe. Hãy bật chế độ PDF.js viewer/canvas hoặc dùng ảnh/document text; UI không gửi crop PDF giả tới Vision API.' });
    } else {
      const textCapture = captureTextFallback(target, drag);
      if (textCapture?.dataUrl) {
        onCapture({ ...textCapture, rect: relativeRect, mimeType: 'image/png' });
      } else {
        onCapture({ rect: relativeRect, error: 'Không tìm thấy nội dung ảnh/văn bản có thể chụp trong vùng chọn. Tính năng phân tích ảnh cần nguồn ảnh thật hoặc backend render tài liệu sang ảnh.' });
      }
    }
    originRef.current = null;
    setDrag(null);
  };

  return (
    <div className="al-snipping-overlay" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
      <button type="button" className="al-snipping-cancel" onClick={(event) => { event.stopPropagation(); onCancel(); }}>Huỷ chụp</button>
      <div className="al-snipping-help">Kéo chuột quanh biểu đồ, công thức hoặc vùng nội dung cần hỏi AI.</div>
      {drag && <div className="al-snipping-box" style={drag} />}
    </div>
  );
}
