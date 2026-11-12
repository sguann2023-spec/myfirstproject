import { useEffect, useState } from 'react';

// 官方模型禁用偏好：设置页写入、主窗口订阅，保证聊天选择器即时隐藏被禁用的模型。
export function useOfficialModelPrefs() {
  const [disabledModelIds, setDisabledModelIds] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.officialChatModels;
    const reload = () => Promise.resolve()
      .then(() => api?.getPrefs?.())
      .then((prefs) => {
        if (!cancelled && Array.isArray(prefs?.disabledModelIds)) setDisabledModelIds(prefs.disabledModelIds);
      })
      .catch(() => {
        // 读取失败时保持全部启用，避免误隐藏模型。
      });
    const unsubscribe = api?.onChanged?.(reload);
    void reload();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return disabledModelIds;
}