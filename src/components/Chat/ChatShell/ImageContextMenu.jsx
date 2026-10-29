import React from 'react';
import { Download } from 'lucide-react';
import './ImageContextMenu.css';

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
const MENU_WIDTH = 136;
const MENU_HEIGHT = 38;

const deriveImageFileName = (src = '', fallbackName = '') => {
  const fallback = String(fallbackName || '').trim();
  try {
    const parsed = new URL(src, 'file://');
    const lastSegment = decodeURIComponent(parsed.pathname || '').split('/').pop() || '';
    if (IMAGE_EXT_PATTERN.test(lastSegment)) return lastSegment;
  } catch (_error) {
    // ignore unparseable src and fall back to the preview file name
  }
  if (IMAGE_EXT_PATTERN.test(fallback)) return fallback;
  return '';
};

const fallbackDownloadImage = (src, fileName) => {
  const link = document.createElement('a');
  link.href = src;
  if (fileName) link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const clampMenuPosition = (x, y) => ({
  x: Math.min(Math.max(x, 8), Math.max(window.innerWidth - MENU_WIDTH - 8, 8)),
  y: Math.min(Math.max(y, 8), Math.max(window.innerHeight - MENU_HEIGHT - 8, 8))
});

const ImageContextMenu = ({ state, onClose, onDownload }) => {
  const open = Boolean(state?.visible && state?.src);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleClose = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && event.target?.closest?.('.chat-image-context-menu')) return;
      onClose?.();
    };
    window.addEventListener('mousedown', handleClose);
    window.addEventListener('keydown', handleClose);
    window.addEventListener('blur', handleClose);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('mousedown', handleClose);
      window.removeEventListener('keydown', handleClose);
      window.removeEventListener('blur', handleClose);
      window.removeEventListener('resize', handleClose);
    };
  }, [open, onClose]);

  if (!open) return null;

  const position = clampMenuPosition(Number(state.x) || 0, Number(state.y) || 0);
  const handleDownloadClick = () => {
    const fileName = deriveImageFileName(state.src, state.fileName);
    if (typeof onDownload === 'function') {
      onDownload({ src: state.src, fileName });
    } else {
      fallbackDownloadImage(state.src, fileName);
    }
    onClose?.();
  };

  return (
    <div
      className="chat-image-context-menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="chat-image-context-menu__item" onClick={handleDownloadClick}>
        <Download size={13} strokeWidth={2.2} />
        <span>下载图片</span>
      </button>
    </div>
  );
};

export default ImageContextMenu;
