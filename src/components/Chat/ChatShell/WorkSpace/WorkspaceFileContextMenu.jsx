import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen, MessageSquarePlus } from 'lucide-react';
import './WorkspaceFileContextMenu.css';

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

export default function WorkspaceFileContextMenu({ state, onClose, onAddToChat }) {
  const { t } = useTranslation();
  const menuRef = React.useRef(null);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });

  React.useLayoutEffect(() => {
    if (!state || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setPosition({
      x: Math.max(0, Math.min(state.x, window.innerWidth - width - 8)),
      y: Math.max(0, Math.min(state.y, window.innerHeight - height - 8)),
    });
    menuRef.current.querySelector('button')?.focus();
  }, [state]);

  React.useEffect(() => {
    if (!state) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape' && event.key !== 'Tab') return;
      if (event.type === 'mousedown' && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [state, onClose]);

  if (!state) return null;
  const run = (action) => {
    onClose();
    action?.();
  };
  return createPortal(
    <div ref={menuRef} role="menu" className="workspace-file-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menuRef.current.querySelectorAll('button'));
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}>
      <button type="button" role="menuitem" onClick={() => run(state.onOpen)}>
        <FileText size={13} strokeWidth={2.2} />
        <span>{t('workspaceFileMenu.open')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => window.api.file.showInFolder(state.absolutePath))}>
        <FolderOpen size={13} strokeWidth={2.2} />
        <span>{t(isWindows ? 'workspaceFileMenu.revealWindows' : 'workspaceFileMenu.revealMac')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => onAddToChat?.({ rootPath: state.rootPath, node: state.node }))}>
        <MessageSquarePlus size={13} strokeWidth={2.2} />
        <span>{t('workspaceFileMenu.addToChat')}</span>
      </button>
    </div>, document.body
  );
}
