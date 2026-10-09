import { loggerService } from '@logger';
import { electronStore } from './electronStore';

const logger = loggerService.withContext('Analytics');
const POSTHOG_API_KEY = import.meta.env.VITE_POSTHOG_API_KEY || '';
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com').replace(/\/$/, '');
const QUEUE_KEY = 'analytics.posthog.queue';
const BATCH_SIZE = 10;
const MAX_QUEUE_SIZE = 1000;
const MAX_EVENT_BYTES = 32 * 1024;
const RETRY_DELAYS_MS = [1000, 5000, 15000];

let flushInProgress = false;

const getCurrentUserId = () => {
  try {
    const user = electronStore.get('user') || {};
    return user?.id ? String(user.id) : '';
  } catch {
    return '';
  }
};

const readQueue = () => {
  try {
    const queue = electronStore.get(QUEUE_KEY);
    return Array.isArray(queue) ? queue : [];
  } catch (error) {
    logger.error('Analytics queue read failed', { error: String(error) });
    return [];
  }
};

const writeQueue = (queue) => {
  try {
    electronStore.set(QUEUE_KEY, queue);
  } catch (error) {
    logger.error('Analytics queue write failed', { error: String(error) });
  }
};

const postBatch = async (batch, keepalive = false) => {
  const response = await fetch(`${POSTHOG_HOST}/batch/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive,
    body: JSON.stringify({ api_key: POSTHOG_API_KEY, batch }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
};

const flushQueue = async ({ force = false, keepalive = false } = {}) => {
  if (flushInProgress || !POSTHOG_API_KEY) return;
  const queue = readQueue();
  if (queue.length === 0 || (!force && queue.length < BATCH_SIZE)) return;

  flushInProgress = true;
  const batch = queue.slice(0, BATCH_SIZE);
  try {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await postBatch(batch, keepalive);
        writeQueue(readQueue().slice(batch.length));
        logger.debug('Analytics batch sent', { count: batch.length });
        if (readQueue().length >= BATCH_SIZE) void flushQueue({ force: true });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < RETRY_DELAYS_MS.length && !keepalive) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    logger.error('Analytics batch sending failed', {
      count: batch.length,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      host: POSTHOG_HOST,
    });
  } finally {
    flushInProgress = false;
  }
};

export const trackEvent = (event, properties = {}) => {
  if (!POSTHOG_API_KEY) {
    return;
  }
  const userId = getCurrentUserId();
  if (!userId) {
    return;
  }

  const eventPayload = {
    event,
    distinct_id: userId,
    properties: { ...properties, user_id: userId, app_version: import.meta.env.VITE_APP_VERSION || undefined, platform: navigator.platform },
    timestamp: new Date().toISOString(),
  };

  let eventBytes;
  try {
    eventBytes = new Blob([JSON.stringify(eventPayload)]).size;
  } catch (error) {
    logger.warn('Analytics event serialization failed', { event, error: String(error) });
    return;
  }

  if (eventBytes > MAX_EVENT_BYTES) {
    logger.warn('Analytics event dropped: payload too large', {
      event,
      bytes: eventBytes,
      maxBytes: MAX_EVENT_BYTES,
    });
    return;
  }

  const queue = readQueue();
  queue.push(eventPayload);

  if (queue.length > MAX_QUEUE_SIZE) {
    const droppedCount = queue.length - MAX_QUEUE_SIZE;
    queue.splice(0, droppedCount);
    logger.warn('Analytics queue exceeded max size; oldest events dropped', {
      droppedCount,
      maxQueueSize: MAX_QUEUE_SIZE,
    });
  }

  writeQueue(queue);
  if (queue.length >= BATCH_SIZE) void flushQueue({ force: true });
};
