import { useCallback, useEffect, useRef, useState } from 'react';

export function useCustomChatModels() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.customChatModels;
    const reload = () => {
      const request = ++generation.current;
      setLoading(true);
      return Promise.resolve().then(() => {
        if (!api) throw new Error('Custom models unavailable');
        return api.list();
      }).then((items) => {
        if (!cancelled && request === generation.current) {
          setModels(items);
          setError('');
        }
      }).catch(() => {
        if (!cancelled && request === generation.current) {
          setError('无法读取自定义模型配置，请检查系统安全存储后重启应用。');
        }
      }).finally(() => {
        if (!cancelled && request === generation.current) setLoading(false);
      });
    };
    // Subscribe before the initial read so a settings save cannot be missed.
    const unsubscribe = api?.onChanged?.(reload);
    void reload();
    return () => {
      cancelled = true;
      ++generation.current;
      unsubscribe?.();
    };
  }, []);
  const save = useCallback(async (items) => {
    if (loading || error) throw new Error(error || '正在读取配置，请稍后重试。');
    const saved = await window.electronAPI.customChatModels.save(items);
    // A change notification may already have started a read: it must not
    // overwrite the authoritative save result with an older snapshot.
    ++generation.current;
    setModels(saved);
    setLoading(false);
    return saved;
  }, [loading, error]);
  return { models, loading, error, save };
}
