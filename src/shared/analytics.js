import { electronStore } from './electronStore';

const POSTHOG_API_KEY = import.meta.env.VITE_POSTHOG_API_KEY || '';
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com').replace(/\/$/, '');

const getCurrentUserId = () => {
  try {
    const user = electronStore.get('user') || {};
    const userId = user?.id;
    return userId ? String(userId) : '';
  } catch {
    return '';
  }
};

export const trackEvent = (event, properties = {}) => {
  if (!POSTHOG_API_KEY) return;

  const userId = getCurrentUserId();
  if (!userId) return;

  void fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event,
      distinct_id: userId,
      properties: {
        ...properties,
        user_id: userId,
        app_version: import.meta.env.VITE_APP_VERSION || undefined,
        platform: navigator.platform,
      },
    }),
  }).catch((error) => {
    // Analytics must never affect the primary user flow.
    console.warn('[Analytics] event tracking failed', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
