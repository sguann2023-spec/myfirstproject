import React from 'react';
import { createPortal } from 'react-dom';
import { Download, FileOutput, FolderOpen, MessageSquarePlus } from 'lucide-react';
import { getArtifactLocalPath } from '../artifactFileTarget';
import './ArtifactContextMenu.css';

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

// Context menu shared by the artifact preview items: media items (video / image /
// audio / document) get save-as, reveal in file manager and add-to-chat; drafts
// get export and add-to-chat.
const ArtifactContextMenu = ({ state, onClose, onSaveAs, onAddToChat, onExport }) => {
  const menuRef = React.useRef(null);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const open = Boolean(state?.visible && state?.item);

  React.useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(state.y, window.innerHeight - height - 8))
    });
    menuRef.current.querySelector('button')?.focus();
  }, [open, state?.x, state?.y]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleClose = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape' && event.key !== 'Tab') return;
      if (event.type === 'mousedown' && menuRef.current?.contains(event.target)) return;
      onClose?.();
    };
    window.addEventListener('mousedown', handleClose);
    window.addEventListener('keydown', handleClose);
    window.addEventListener('blur', handleClose);
    window.addEventListener('resize', handleClose);
    window.addEventListener('scroll', handleClose, true);
    return () => {
      window.removeEventListener('mousedown', handleClose);
      window.removeEventListener('keydown', handleClose);
      window.removeEventListener('blur', handleClose);
      window.removeEventListener('resize', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isDraftMenu = state.kind === 'draft';
  const localPath = isDraftMenu ? '' : getArtifactLocalPath(state.item);
  const run = (action) => {
    onClose?.();
    action?.(state.item);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="产物操作菜单"
      className="artifact-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menuRef.current.querySelectorAll('button'));
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}>
      {isDraftMenu ? (
        <button type="button" role="menuitem" onClick={() => run(onExport)}>
          <FileOutput size={13} strokeWidth={2.2} />
          <span>导出</span>
        </button>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => run(onSaveAs)}>
            <Download size={13} strokeWidth={2.2} />
            <span>另存为</span>
          </button>
          {localPath && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(() => window.api?.file?.showInFolder?.(localPath))}>
              <FolderOpen size={13} strokeWidth={2.2} />
              <span>{isWindows ? '在文件浏览器中打开' : '在Finder中打开'}</span>
            </button>
          )}
        </>
      )}
      <button type="button" role="menuitem" onClick={() => run(onAddToChat)}>
        <MessageSquarePlus size={13} strokeWidth={2.2} />
        <span>添加到聊天</span>
      </button>
    </div>, document.body
  );
};

export default ArtifactContextMenu;
