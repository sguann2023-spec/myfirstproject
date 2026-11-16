import { useCallback, useEffect, useRef, useState } from 'react';
import { electronStore } from '../../../shared/electronStore';
import { getPresetReferenceRoot, loadPresetReferencePage } from './presetReferences';

export function usePresetReferences(open, query) {
  const [folder, setFolder] = useState(() => electronStore.get('presetFolder'));
  const [page, setPage] = useState({ items: [], hasMore: false, loading: false, error: '' });
  const generation = useRef(0);
  const pending = useRef(false);
  const offset = useRef(0);
  const root = getPresetReferenceRoot(folder, window.require('path'));

  useEffect(() => electronStore.onDidChange('presetFolder', (value) => setFolder(value)), []);

  const requestPage = useCallback(async (currentGeneration, start) => {
    if (pending.current) return;
    pending.current = true;
    setPage((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const result = await loadPresetReferencePage(
        (dir, options) => window.api.file.listDirectory(dir, options), root, query, start
      );
      if (generation.current !== currentGeneration) return;
      offset.current = start + result.items.length;
      setPage((previous) => ({
        items: start === 0 ? result.items : [...previous.items, ...result.items],
        hasMore: result.hasMore,
        loading: false,
        error: '',
      }));
    } catch (error) {
      if (generation.current !== currentGeneration) return;
      setPage((previous) => ({ ...previous, loading: false, error: '加载剪映预设失败，请重试' }));
    } finally {
      if (generation.current === currentGeneration) pending.current = false;
    }
  }, [root, query]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    pending.current = false;
    offset.current = 0;
    setPage({ items: [], hasMore: false, loading: Boolean(open && root), error: '' });
    if (!open || !root) return undefined;
    const timer = setTimeout(() => { void requestPage(currentGeneration, 0); }, query ? 200 : 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [open, root, query, requestPage]);

  const loadMore = useCallback(() => {
    if (open && root) void requestPage(generation.current, offset.current);
  }, [open, root, requestPage]);

  return { ...page, root, loadMore };
}
