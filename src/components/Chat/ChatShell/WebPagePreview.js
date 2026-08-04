import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Plus,
  RefreshCw,
  X
} from 'lucide-react';
import { IpcChannel } from '@shared/IpcChannel';
import './WebPagePreview.css';

const normalizeUrl = (value = '') => String(value || '').trim();
const BLANK_TAB_URL = 'about:blank';
const SEND_TO_MAIN_PREFIX = '__VECTCUT_SEND_TO_MAIN__:';
const HOST_FILE_SELECT_PREFIX = '__VECTCUT_HOST_FILE_SELECT__:';

const createTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const readPreviewTabId = (preview, fallback = 'initial-tab') => String(preview?.tabId || fallback).trim() || fallback;
const getFallbackFaviconUrl = (value = '') => {
  const normalized = normalizeUrl(value);
  if (!normalized || normalized === BLANK_TAB_URL) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return `${parsed.origin}/favicon.ico`;
  } catch (_error) {
    return '';
  }
};

const createPreviewTab = (preview, overrides = {}) => ({
  id: overrides.id || createTabId(),
  previewKey: String(preview?.key || '').trim(),
  title: normalizeUrl(preview?.title) || '新标签页',
  url: normalizeUrl(preview?.url) || BLANK_TAB_URL,
  favicon: overrides.favicon ?? getFallbackFaviconUrl(preview?.url),
  webContentsId: Number(overrides.webContentsId || 0) > 0 ? Number(overrides.webContentsId) : null
});
const buildInitialPreviewTab = (preview) => createPreviewTab(preview, { id: readPreviewTabId(preview) });
const getIpcRenderer = () => {
  try {
    return window?.['electron']?.ipcRenderer || window.require?.('electron')?.ipcRenderer || null;
  } catch (_error) {
    return null;
  }
};

const normalizeAddressInput = (value = '') => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';
  if (normalized === BLANK_TAB_URL) return normalized;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalized)) return normalized;
  return `https://${normalized}`;
};
const isLocalHtmlPreviewUrl = (value = '') => {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'file:' && /\.(html?|HTML?)($|[?#])/.test(parsed.pathname || '');
  } catch (_error) {
    return false;
  }
};

const WebPagePreview = ({ preview, onClose }) => {
  const webviewRef = React.useRef(null);
  const tabsRef = React.useRef(null);
  const webviewReadyRef = React.useRef(false);
  const appliedPreviewKeyRef = React.useRef('');
  const shouldScrollTabsToEndRef = React.useRef(false);
  const [tabs, setTabs] = React.useState(() => [buildInitialPreviewTab(preview)]);
  const [activeTabId, setActiveTabId] = React.useState(() => readPreviewTabId(preview));
  const [addressValue, setAddressValue] = React.useState(() => normalizeUrl(preview?.url) || BLANK_TAB_URL);
  const [loading, setLoading] = React.useState(false);
  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);
  const tabsStateRef = React.useRef([]);
  const activeTabIdRef = React.useRef(readPreviewTabId(preview));
  const activeTab = React.useMemo(
    () => tabs.find((item) => item.id === activeTabId) || tabs[0] || null,
    [activeTabId, tabs]
  );
  const targetUrl = normalizeUrl(activeTab?.url) || BLANK_TAB_URL;

  React.useEffect(() => {
    const initialTab = buildInitialPreviewTab(preview);
    setTabs(() => [initialTab]);
    setActiveTabId(initialTab.id);
    setAddressValue(normalizeUrl(preview?.url) || BLANK_TAB_URL);
    appliedPreviewKeyRef.current = String(preview?.key || '').trim();
    tabsStateRef.current = [initialTab];
    activeTabIdRef.current = initialTab.id;
  }, []);

  React.useEffect(() => {
    tabsStateRef.current = tabs;
  }, [tabs]);

  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const updateActiveTab = React.useCallback((updater) => {
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      const nextChanges = typeof updater === 'function' ? updater(tab) : updater;
      return {
        ...tab,
        ...nextChanges
      };
    }));
  }, [activeTabId]);

  const updateTabById = React.useCallback((tabId, updater) => {
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== tabId) return tab;
      const nextChanges = typeof updater === 'function' ? updater(tab) : updater;
      return {
        ...tab,
        ...nextChanges
      };
    }));
  }, []);

  const readWebviewUrl = React.useCallback((webview) => {
    if (!webviewReadyRef.current || !webview) return '';
    try {
      return normalizeUrl(webview.getURL?.());
    } catch (_error) {
      return '';
    }
  }, []);

  const syncNavigationState = React.useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    if (!webviewReadyRef.current) {
      setCanGoBack(false);
      setCanGoForward(false);
      setAddressValue(targetUrl);
      return;
    }

    try {
      const nextUrl = readWebviewUrl(webview) || targetUrl;
      setCanGoBack(Boolean(webview.canGoBack?.()));
      setCanGoForward(Boolean(webview.canGoForward?.()));
      setAddressValue(nextUrl);
      updateActiveTab({ url: nextUrl });
    } catch (_error) {
      setCanGoBack(false);
      setCanGoForward(false);
      setAddressValue(targetUrl);
    }
  }, [readWebviewUrl, targetUrl, updateActiveTab]);

  const syncActiveTabFavicon = React.useCallback(async (preferredUrl = '') => {
    const webview = webviewRef.current;
    const fallbackFavicon = getFallbackFaviconUrl(preferredUrl || targetUrl);
    if (!webview || !webviewReadyRef.current) {
      updateActiveTab({ favicon: fallbackFavicon });
      return;
    }

    try {
      const pageFavicon = await webview.executeJavaScript(
        `(() => {
          const icon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel*="icon"], link[rel="apple-touch-icon"]');
          return icon?.href || '';
        })()`,
        true
      );
      updateActiveTab({ favicon: normalizeUrl(pageFavicon) || fallbackFavicon });
    } catch (_error) {
      updateActiveTab({ favicon: fallbackFavicon });
    }
  }, [targetUrl, updateActiveTab]);

  const syncWebviewZoomFactor = React.useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || !webviewReadyRef.current) return;
    try {
      const zoomFactor = await window.api?.handleZoomFactor?.(0);
      const nextZoomFactor = Number(zoomFactor) || 1;
      webview.setZoomFactor?.(nextZoomFactor);
    } catch (_error) {
      // ignore zoom sync failures
    }
  }, []);

  const syncPreviewState = React.useCallback(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer?.invoke) return Promise.resolve(null);

    const buildStatePayload = () => {
      let activeWebContentsId = null;
      try {
        const webviewId = webviewRef.current?.getWebContentsId?.();
        if (Number(webviewId) > 0) {
          activeWebContentsId = Number(webviewId);
        }
      } catch (_error) {
        activeWebContentsId = null;
      }

      return {
        visible: true,
        ready: Boolean(activeWebContentsId),
        activeTabId: activeTabIdRef.current || null,
        activeWebContentsId,
        tabs: tabsStateRef.current.map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          isActive: tab.id === activeTabIdRef.current,
          webContentsId: tab.id === activeTabIdRef.current ? activeWebContentsId : null
        }))
      };
    };

    const payload = buildStatePayload();

    return ipcRenderer.invoke(IpcChannel.BrowserPreview_StateSync, payload).catch?.(() => null);
  }, []);

  const waitForLoadResult = React.useCallback((expectedTabId, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const webview = webviewRef.current;
    if (!webview) {
      reject(new Error('浏览器预览尚未初始化'));
      return;
    }

    let settled = false;
    let timeoutHandle;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      webview.removeEventListener('did-stop-loading', handleSuccess);
      webview.removeEventListener('dom-ready', handleSuccess);
      webview.removeEventListener('did-fail-load', handleFail);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const currentUrl = normalizeUrl(readWebviewUrl(webview) || webview.getAttribute?.('src') || '');
      const currentTitle = String(webview.getTitle?.() || '').trim()
        || tabsStateRef.current.find((tab) => tab.id === expectedTabId)?.title
        || currentUrl;
      resolve({
        tabId: expectedTabId,
        currentUrl: currentUrl || BLANK_TAB_URL,
        title: currentTitle || BLANK_TAB_URL
      });
    };

    const handleSuccess = () => {
      void syncPreviewState();
      finish();
    };

    const handleFail = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(String(event?.errorDescription || '页面加载失败')));
    };

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('浏览器预览加载超时'));
    }, timeoutMs);

    webview.addEventListener('did-stop-loading', handleSuccess);
    webview.addEventListener('dom-ready', handleSuccess);
    webview.addEventListener('did-fail-load', handleFail);
  }), [readWebviewUrl, syncPreviewState]);

  React.useEffect(() => {
    const previewKey = String(preview?.key || '').trim();
    const previewUrl = normalizeUrl(preview?.url);
    if (!previewKey || !previewUrl || previewKey === appliedPreviewKeyRef.current) return;

    appliedPreviewKeyRef.current = previewKey;
    const previewTabId = readPreviewTabId(preview, createTabId());
    const hasControllerManagedTab = tabsStateRef.current.some((tab) =>
      String(tab?.previewKey || '').startsWith('mcp-browser:')
    );

    // Controller-driven previews already carry a tabId and will be created by the
    // subsequent BrowserPreview_Command open handler. Here we only reveal/retarget
    // the current preview state to avoid adding the same tab twice.
    if (preview?.tabId) {
      setTabs((prev) => (
        prev.some((tab) => tab.id === previewTabId)
          ? prev.map((tab) => (
              tab.id === previewTabId
                ? {
                    ...tab,
                    previewKey: previewKey || tab.previewKey,
                    url: previewUrl,
                    title: normalizeUrl(preview?.title) || tab.title || previewUrl
                  }
                : tab
            ))
          : prev.map((tab, index) => {
              const shouldAdoptExistingTab = (
                index === 0
                && (
                  tab.id === 'initial-tab'
                  || tab.previewKey === previewKey
                  || normalizeUrl(tab.url) === previewUrl
                )
              );
              if (!shouldAdoptExistingTab) return tab;
              return {
                ...tab,
                id: previewTabId,
                previewKey: previewKey || tab.previewKey,
                url: previewUrl,
                title: normalizeUrl(preview?.title) || tab.title || previewUrl
              };
            })
      ));
      setActiveTabId(previewTabId);
      setAddressValue(previewUrl);
      return;
    }

    // Once MCP browser control has taken over the preview, later chat-derived
    // preview updates (which do not carry a tabId) should not append extra local tabs.
    if (hasControllerManagedTab) {
      return;
    }

    const nextTab = createPreviewTab(preview, { id: previewTabId });
    setTabs((prev) => (
      prev.some((tab) => tab.id === previewTabId)
        ? prev.map((tab) => (
          tab.id === previewTabId
            ? {
              ...tab,
              previewKey: nextTab.previewKey,
              url: nextTab.url,
              title: nextTab.title,
              favicon: nextTab.favicon
            }
            : tab
        ))
        : [...prev, nextTab]
    ));
    setActiveTabId(nextTab.id);
    setAddressValue(nextTab.url);
  }, [preview]);

  React.useEffect(() => {
    void syncPreviewState();
  }, [activeTabId, syncPreviewState, tabs]);

  const navigateToAddress = React.useCallback((value) => {
    const nextUrl = normalizeAddressInput(value);
    if (!nextUrl) return;
    setAddressValue(nextUrl);
    updateActiveTab((tab) => ({
      url: nextUrl,
      title: nextUrl === BLANK_TAB_URL ? (tab?.title || '新标签页') : (tab?.title || nextUrl)
    }));
  }, [updateActiveTab]);

  const handleCreateTab = React.useCallback(() => {
    const nextTab = {
      id: createTabId(),
      previewKey: '',
      title: '新标签页',
      url: BLANK_TAB_URL
    };
    shouldScrollTabsToEndRef.current = true;
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
    setAddressValue(BLANK_TAB_URL);
  }, []);

  const handleCloseTab = React.useCallback((tabId) => {
    setTabs((prev) => {
      if (prev.length <= 1) {
        onClose?.();
        return prev;
      }
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        const closedIndex = prev.findIndex((tab) => tab.id === tabId);
        const fallbackTab = nextTabs[Math.max(0, closedIndex - 1)] || nextTabs[0] || null;
        setActiveTabId(fallbackTab?.id || '');
        setAddressValue(normalizeUrl(fallbackTab?.url) || BLANK_TAB_URL);
      }
      return nextTabs;
    });
  }, [activeTabId, onClose]);

  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return undefined;

    const handleDomReady = () => {
      webviewReadyRef.current = true;
      void (async () => {
        try {
          const runtimeEnv = await window.api?.webview?.primeRuntimeEnv?.();
          const vectcutApiKey = String(runtimeEnv?.VECTCUT_API_KEY || '').trim();
          const sendToMainPrefix = SEND_TO_MAIN_PREFIX;
          const hostFileSelectPrefix = HOST_FILE_SELECT_PREFIX;
          await webview.executeJavaScript(
            `(() => {
              const apiKey = ${JSON.stringify(vectcutApiKey)};
              const sendPrefix = ${JSON.stringify(sendToMainPrefix)};
              const fileSelectPrefix = ${JSON.stringify(hostFileSelectPrefix)};
              const env = Object.freeze({ VECTCUT_API_KEY: apiKey });
              const processShim = Object.freeze({
                env: Object.freeze({ VECTCUT_API_KEY: apiKey })
              });
              window.VECTCUT_API_KEY = apiKey;
              window.__VECTCUT_ENV__ = env;
              window.ENV = env;
              window.process = processShim;
              window.sendTextToMainWindow = (text) => {
                const normalizedText = String(text || '').trim();
                if (!normalizedText) {
                  return Promise.resolve(false);
                }

                console.log(sendPrefix + JSON.stringify({ text: normalizedText }));
                return Promise.resolve(true);
              };

              window.__vectcutHostFileSelectResolvers = new Map();
              window.__vectcutResolveHostFileSelect = (requestId, payload) => {
                const resolver = window.__vectcutHostFileSelectResolvers.get(requestId);
                if (!resolver) {
                  return;
                }
                window.__vectcutHostFileSelectResolvers.delete(requestId);
                resolver(payload);
              };
              window.selectLocalFilesFromHost = (options = {}) => new Promise((resolve) => {
                const requestId = 'host-file-select-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                window.__vectcutHostFileSelectResolvers.set(requestId, resolve);
                console.log(fileSelectPrefix + JSON.stringify({ requestId, options }));
              });

              const tokenEl = document.getElementById('token');
              if (tokenEl && apiKey) {
                tokenEl.value = apiKey;
                const tokenDetails = tokenEl.closest('details');
                if (tokenDetails) {
                  tokenDetails.style.display = 'none';
                }
              }

              window.dispatchEvent(new CustomEvent('vectcut-runtime-env-ready', {
                detail: { VECTCUT_API_KEY: apiKey }
              }));

              return {
                hasApiKey: Boolean(apiKey),
                tokenInputFound: Boolean(tokenEl)
              };
            })()`,
            true
          );
        } catch (_error) {
          // ignore runtime env injection failures
        }
      })();
      try {
        const webviewId = webview.getWebContentsId?.();
        if (webviewId) {
          updateActiveTab({ webContentsId: Number(webviewId) });
          void window.api?.webview?.setSpellCheckEnabled?.(webviewId, false);
        }
      } catch (_error) {
        // ignore webview setup failures
      }
      void syncWebviewZoomFactor();
      syncNavigationState();
      void syncActiveTabFavicon(readWebviewUrl(webview) || targetUrl);
      void syncPreviewState();
    };

    const handleStartLoading = () => {
      setLoading(true);
      syncNavigationState();
    };

    const handleStopLoading = () => {
      setLoading(false);
      syncNavigationState();
      void syncActiveTabFavicon(readWebviewUrl(webview) || targetUrl);
      void syncPreviewState();
    };

    const handleTitleUpdated = (event) => {
      if (event?.title) {
        updateActiveTab({ title: String(event.title).trim() || '新标签页' });
      }
      void syncPreviewState();
    };

    const handleNavigate = (event) => {
      if (event?.url) {
        const nextUrl = normalizeUrl(event.url);
        setAddressValue(nextUrl);
        updateActiveTab({ url: nextUrl, favicon: getFallbackFaviconUrl(nextUrl) });
        void syncActiveTabFavicon(nextUrl);
      }
      syncNavigationState();
      void syncPreviewState();
    };

    const handleFailLoad = () => {
      setLoading(false);
      syncNavigationState();
      void syncPreviewState();
    };

    const handleConsoleMessage = (event) => {
      const message = String(event?.message || '');
      if (!message.startsWith(SEND_TO_MAIN_PREFIX)) {
        if (!message.startsWith(HOST_FILE_SELECT_PREFIX)) {
          return;
        }

        try {
          const payload = JSON.parse(message.slice(HOST_FILE_SELECT_PREFIX.length));
          const requestId = String(payload?.requestId || '').trim();
          if (!requestId) {
            return;
          }

          Promise.resolve(window.api?.file?.select?.(payload?.options || {}))
            .then((selectedFiles) => {
              const responsePayload = JSON.stringify(Array.isArray(selectedFiles) ? selectedFiles : null);
              return webview.executeJavaScript(
                `window.__vectcutResolveHostFileSelect(${JSON.stringify(requestId)}, ${responsePayload});`,
                true
              );
            })
            .catch(() => {
              return webview.executeJavaScript(
                `window.__vectcutResolveHostFileSelect(${JSON.stringify(requestId)}, null);`,
                true
              );
            });
        } catch (_error) {
          // ignore malformed host file select bridge payloads
        }
        return;
      }

      try {
        const payload = JSON.parse(message.slice(SEND_TO_MAIN_PREFIX.length));
        const text = String(payload?.text || '').trim();
        if (!text) {
          return;
        }

        const ipcRenderer = getIpcRenderer();
        void ipcRenderer?.invoke?.(IpcChannel.App_SendTextToMain, text);
      } catch (_error) {
        // ignore malformed console bridge payloads
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('page-title-updated', handleTitleUpdated);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('console-message', handleConsoleMessage);

    return () => {
      const ipcRenderer = getIpcRenderer();
      if (ipcRenderer?.invoke) {
        void ipcRenderer.invoke(IpcChannel.BrowserPreview_StateSync, {
          visible: false,
          ready: false,
          activeTabId: null,
          activeWebContentsId: null,
          tabs: []
        });
      }
      webviewReadyRef.current = false;
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('page-title-updated', handleTitleUpdated);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('console-message', handleConsoleMessage);
    };
  }, [readWebviewUrl, syncActiveTabFavicon, syncNavigationState, syncWebviewZoomFactor, targetUrl, updateActiveTab]);

  React.useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer?.on || !ipcRenderer?.invoke) return undefined;

    const handleBrowserPreviewCommand = async (_event, message = {}) => {
      const requestId = String(message?.requestId || '').trim();
      const command = String(message?.command || '').trim();
      const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
      if (!requestId || !command) return;

      try {
        let result = null;

        if (command === 'open') {
          const tabId = String(payload?.tabId || '').trim() || createTabId();
          const nextUrl = normalizeAddressInput(payload?.url || '');
          if (!nextUrl) throw new Error('缺少有效的 URL');

          const shouldCreateNewTab = Boolean(payload?.newTab) || !tabsStateRef.current.some((tab) => tab.id === tabId);
          if (shouldCreateNewTab) {
            const nextTab = createPreviewTab({
              key: `mcp-browser:${tabId}`,
              url: nextUrl,
              title: String(payload?.title || nextUrl).trim() || nextUrl,
              tabId
            }, { id: tabId });
            setTabs((prev) => [...prev, nextTab]);
            shouldScrollTabsToEndRef.current = true;
          } else {
            updateTabById(tabId, (tab) => ({
              url: nextUrl,
              title: String(payload?.title || tab?.title || nextUrl).trim() || nextUrl
            }));
          }

          setActiveTabId(tabId);
          setAddressValue(nextUrl);
          const webview = webviewRef.current;
          if (!webview) throw new Error('浏览器预览尚未初始化');
          setLoading(true);
          webview.loadURL?.(nextUrl);
          result = await waitForLoadResult(tabId, Number(payload?.timeout || 15000));
        } else if (command === 'switch_tab') {
          const tabId = String(payload?.tabId || '').trim();
          const targetTab = tabsStateRef.current.find((tab) => tab.id === tabId);
          if (!tabId || !targetTab) throw new Error('目标标签页不存在');

          setActiveTabId(tabId);
          setAddressValue(normalizeUrl(targetTab.url) || BLANK_TAB_URL);
          const webview = webviewRef.current;
          if (!webview) throw new Error('浏览器预览尚未初始化');
          const targetTabUrl = normalizeUrl(targetTab.url) || BLANK_TAB_URL;
          const currentUrl = normalizeUrl(readWebviewUrl(webview) || webview.getAttribute?.('src'));
          if (currentUrl !== targetTabUrl) {
            setLoading(true);
            webview.loadURL?.(targetTabUrl);
            result = await waitForLoadResult(tabId, Number(payload?.timeout || 15000));
          } else {
            result = {
              tabId,
              currentUrl: currentUrl || BLANK_TAB_URL,
              title: targetTab.title || currentUrl || BLANK_TAB_URL
            };
          }
        } else if (command === 'get_context') {
          const webview = webviewRef.current;
          const currentUrl = normalizeUrl(
            readWebviewUrl(webview) || webview?.getAttribute?.('src') || targetUrl
          ) || BLANK_TAB_URL;
          let activeWebContentsId = null;
          try {
            const webviewId = webview?.getWebContentsId?.();
            if (Number(webviewId) > 0) {
              activeWebContentsId = Number(webviewId);
            }
          } catch (_error) {
            activeWebContentsId = null;
          }
          result = {
            state: {
              visible: true,
              ready: Boolean(activeWebContentsId),
              activeTabId: activeTabIdRef.current || null,
              activeWebContentsId,
              tabs: tabsStateRef.current.map((tab) => ({
                id: tab.id,
                title: tab.title,
                url: tab.id === activeTabIdRef.current ? currentUrl : tab.url,
                isActive: tab.id === activeTabIdRef.current,
                webContentsId: tab.id === activeTabIdRef.current ? activeWebContentsId : null
              }))
            },
            activeUrl: currentUrl
          };
        } else if (command === 'close_tab') {
          const tabId = String(payload?.tabId || '').trim();
          if (!tabId) throw new Error('缺少 tabId');
          handleCloseTab(tabId);
          result = { closed: tabId };
        } else if (command === 'reset') {
          if (payload?.tabId) {
            const tabId = String(payload.tabId || '').trim();
            if (tabId) {
              handleCloseTab(tabId);
              result = { closed: tabId };
            }
          } else {
            onClose?.();
            result = { reset: true };
          }
        } else {
          throw new Error(`未知浏览器预览命令: ${command}`);
        }

        await ipcRenderer.invoke(IpcChannel.BrowserPreview_CommandResult, {
          requestId,
          ok: true,
          result
        });
      } catch (error) {
        await ipcRenderer.invoke(IpcChannel.BrowserPreview_CommandResult, {
          requestId,
          ok: false,
          error: error?.message || String(error)
        });
      }
    };

    ipcRenderer.on(IpcChannel.BrowserPreview_Command, handleBrowserPreviewCommand);
    return () => {
      ipcRenderer.removeListener(IpcChannel.BrowserPreview_Command, handleBrowserPreviewCommand);
    };
  }, [handleCloseTab, onClose, readWebviewUrl, syncPreviewState, targetUrl, updateTabById, waitForLoadResult]);

  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !targetUrl) return;
    if ((readWebviewUrl(webview) || normalizeUrl(webview.getAttribute?.('src'))) === targetUrl) return;

    setLoading(true);
    webview.src = targetUrl;
  }, [readWebviewUrl, targetUrl]);

  React.useEffect(() => {
    setAddressValue(targetUrl);
  }, [targetUrl]);

  React.useEffect(() => {
    if (!shouldScrollTabsToEndRef.current) return;
    shouldScrollTabsToEndRef.current = false;
    const tabsElement = tabsRef.current;
    if (!tabsElement) return;
    requestAnimationFrame(() => {
      tabsElement.scrollTo({
        left: tabsElement.scrollWidth,
        behavior: 'smooth'
      });
    });
  }, [tabs]);

  const handleOpenInExternalBrowser = React.useCallback(() => {
    if (!targetUrl || targetUrl === BLANK_TAB_URL) return;
    if (isLocalHtmlPreviewUrl(targetUrl)) {
      void window.api?.openLocalHtmlInBrowser?.(targetUrl);
      return;
    }
    void window.api?.openWebsite?.(targetUrl);
  }, [targetUrl]);

  return (
    <div className="chat-web-preview">
      <div className="chat-web-preview__tabbar">
        <div className="chat-web-preview__tabbar-main">
          <div ref={tabsRef} className="chat-web-preview__tabs">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`chat-web-preview__tab ${isActive ? 'is-active' : ''}`.trim()}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    setAddressValue(normalizeUrl(tab.url) || BLANK_TAB_URL);
                  }}
                  title={tab.title || tab.url}>
                  <span className="chat-web-preview__tab-icon" aria-hidden="true">
                    {tab.favicon ? (
                      <img
                        src={tab.favicon}
                        alt=""
                        className="chat-web-preview__tab-icon-image"
                        onError={() => updateTabById(tab.id, { favicon: '' })}
                      />
                    ) : (
                      <Globe size={14} />
                    )}
                  </span>
                  <span className="chat-web-preview__tab-title">{tab.title || '新标签页'}</span>
                  <span
                    className="chat-web-preview__tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    role="button"
                    tabIndex={0}>
                    <X size={12} />
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="chat-web-preview__tab-add"
            onClick={handleCreateTab}
            title="新建标签">
            <Plus size={16} />
          </button>
        </div>
        <button
          type="button"
          className="chat-web-preview__tabbar-close"
          onClick={() => onClose?.()}
          title="关闭">
          <X size={14} />
        </button>
      </div>
      <div className="chat-web-preview__header">
        <div className="chat-web-preview__actions">
          <button
            type="button"
            className="chat-web-preview__action"
            disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack?.()}
            title="后退">
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="chat-web-preview__action"
            disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward?.()}
            title="前进">
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className="chat-web-preview__action"
            onClick={() => webviewRef.current?.reload?.()}
            title="刷新">
            <RefreshCw size={14} className={loading ? 'chat-web-preview__action-icon--spinning' : ''} />
          </button>
        </div>
        <div className="chat-web-preview__address-wrap">
          <input
            type="text"
            className="chat-web-preview__address"
            value={addressValue}
            onChange={(event) => setAddressValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                navigateToAddress(addressValue);
              }
            }}
            placeholder="输入网址"
            spellCheck={false}
          />
        </div>
        <div className="chat-web-preview__actions">
          <button
            type="button"
            className="chat-web-preview__action"
            onClick={handleOpenInExternalBrowser}
            title="外部浏览器打开">
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
      <div className="chat-web-preview__body">
        <webview
          ref={webviewRef}
          className="chat-web-preview__webview"
          allowpopups={'true'}
          partition="persist:webview"
        />
      </div>
    </div>
  );
};

export default WebPagePreview;
