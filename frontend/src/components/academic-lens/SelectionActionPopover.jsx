import { useLayoutEffect, useRef, useState } from 'react';
import { Languages, Search, Sparkles, WandSparkles } from 'lucide-react';

const GAP = 12;
const VIEWPORT_PADDING = 12;

export default function SelectionActionPopover({ selection, onAction }) {
  const popoverRef = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!selection?.text || !selection.rect) return;
    const popoverBox = popoverRef.current?.getBoundingClientRect();
    const width = popoverBox?.width || 250;
    const height = popoverBox?.height || 54;
    const rect = selection.rect;
    const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, maxLeft));
    let top = rect.top - height - GAP;
    if (top < VIEWPORT_PADDING) top = rect.bottom + GAP;
    setPosition({ left, top });
  }, [selection]);

  if (!selection?.text) return null;
  const words = selection.text.trim().split(/\s+/).filter(Boolean).length;
  const shortActions = [
    { key: 'term', label: 'Giải thích thuật ngữ', icon: Sparkles, prompt: 'Hãy giải thích thuật ngữ này.' },
    { key: 'translate', label: 'Dịch thuật', icon: Languages, prompt: 'Hãy dịch cụm từ này sang tiếng Việt.' },
    { key: 'web', label: 'Tìm kiếm Web', icon: Search, prompt: 'Hãy tìm kiếm web độc lập về cụm từ này.', web: true },
  ];
  const longActions = [
    { key: 'summary', label: 'Tóm tắt', icon: WandSparkles, prompt: 'Hãy tóm tắt đoạn này.' },
    { key: 'translate_paragraph', label: 'Dịch đoạn này', icon: Languages, prompt: 'Hãy dịch đoạn này sang tiếng Việt.' },
    { key: 'deep', label: 'Phân tích sâu', icon: Sparkles, prompt: 'Hãy phân tích sâu đoạn này, nêu luận điểm chính và hàm ý học thuật.' },
  ];
  const actions = words <= 2 ? shortActions : longActions;

  return (
    <div ref={popoverRef} className="al-selection-popover" style={position || { left: -9999, top: -9999 }}>
      {actions.map(({ key, label, icon: Icon, prompt, web }) => (
        <button key={key} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAction({ prompt, web })}>
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
