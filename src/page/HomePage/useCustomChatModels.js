import { useCallback, useEffect, useRef, useState } from 'react';

export function useCustomChatModels() {
  const [models, setModels] = useState([]);
  // 供应商分组（含名称/标识/模型），供 composer 的「供应商→模型」两级选择器使用。
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.customChatModels;
    const reload = () => {
      const request = ++generation.current;
      setLoading(true);
      // 供应商列表与模型列表并行读取；旧桥无 listProviders 时容缺为空，不影响模型加载。
      void Promise.resolve().then(() => (api?.listProviders ? api.listProviders() : []))
        .then((items) => {
          if (!cancelled && request === generation.current) setProviders(Array.isArray(items) ? items : []);
        })
        .catch(() => {
          if (!cancelled && request === generation.current) setProviders([]);
        });
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
  return { models, providers, loading, error, save };
}
