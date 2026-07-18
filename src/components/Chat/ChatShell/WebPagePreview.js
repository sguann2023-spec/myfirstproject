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
import './WebPagePreview.css';

const normalizeUrl = (value = '') => String(value || '').trim();
const BLANK_TAB_URL = 'about:blank';

const createTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  favicon: overrides.favicon ?? getFallbackFaviconUrl(preview?.url)
});

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
  const [tabs, setTabs] = React.useState(() => [createPreviewTab(preview)]);
  const [activeTabId, setActiveTabId] = React.useState(() => createPreviewTab(preview, { id: 'initial-tab' }).id);
  const [addressValue, setAddressValue] = React.useState(() => normalizeUrl(preview?.url) || BLANK_TAB_URL);
  const [loading, setLoading] = React.useState(false);
  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);
  const activeTab = React.useMemo(
    () => tabs.find((item) => item.id === activeTabId) || tabs[0] || null,
    [activeTabId, tabs]
  );
  const targetUrl = normalizeUrl(activeTab?.url) || BLANK_TAB_URL;

  React.useEffect(() => {
    setTabs(() => [createPreviewTab(preview, { id: 'initial-tab' })]);
    setActiveTabId('initial-tab');
    setAddressValue(normalizeUrl(preview?.url) || BLANK_TAB_URL);
    appliedPreviewKeyRef.current = String(preview?.key || '').trim();
  }, []);

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

  React.useEffect(() => {
    const previewKey = String(preview?.key || '').trim();
    const previewUrl = normalizeUrl(preview?.url);
    if (!previewKey || !previewUrl || previewKey === appliedPreviewKeyRef.current) return;

    const nextTab = createPreviewTab(preview);
    appliedPreviewKeyRef.current = previewKey;
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
    setAddressValue(nextTab.url);
  }, [preview]);

  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return undefined;

    const handleDomReady = () => {
      webviewReadyRef.current = true;
      void (async () => {
        try {
          const runtimeEnv = await window.api?.webview?.primeRuntimeEnv?.();
          const vectcutApiKey = String(runtimeEnv?.VECTCUT_API_KEY || '').trim();
          await webview.executeJavaScript(
            `(() => {
              const apiKey = ${JSON.stringify(vectcutApiKey)};
              const env = Object.freeze({ VECTCUT_API_KEY: apiKey });
              const processShim = Object.freeze({
                env: Object.freeze({ VECTCUT_API_KEY: apiKey })
              });
              window.VECTCUT_API_KEY = apiKey;
              window.__VECTCUT_ENV__ = env;
              window.ENV = env;
              window.process = processShim;

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
          void window.api?.webview?.setSpellCheckEnabled?.(webviewId, false);
        }
      } catch (_error) {
        // ignore webview setup failures
      }
      void syncWebviewZoomFactor();
      syncNavigationState();
      void syncActiveTabFavicon(readWebviewUrl(webview) || targetUrl);
    };

    const handleStartLoading = () => {
      setLoading(true);
      syncNavigationState();
    };

    const handleStopLoading = () => {
      setLoading(false);
      syncNavigationState();
      void syncActiveTabFavicon(readWebviewUrl(webview) || targetUrl);
    };

    const handleTitleUpdated = (event) => {
      if (event?.title) {
        updateActiveTab({ title: String(event.title).trim() || '新标签页' });
      }
    };

    const handleNavigate = (event) => {
      if (event?.url) {
        const nextUrl = normalizeUrl(event.url);
        setAddressValue(nextUrl);
        updateActiveTab({ url: nextUrl, favicon: getFallbackFaviconUrl(nextUrl) });
        void syncActiveTabFavicon(nextUrl);
      }
      syncNavigationState();
    };

    const handleFailLoad = () => {
      setLoading(false);
      syncNavigationState();
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('page-title-updated', handleTitleUpdated);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('did-fail-load', handleFailLoad);

    return () => {
      webviewReadyRef.current = false;
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('page-title-updated', handleTitleUpdated);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, [readWebviewUrl, syncActiveTabFavicon, syncNavigationState, syncWebviewZoomFactor, targetUrl, updateActiveTab]);

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
