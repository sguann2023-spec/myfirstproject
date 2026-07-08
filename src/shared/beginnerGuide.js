import { electronStore } from './electronStore';

export const BEGINNER_GUIDE_COMPLETED_KEY = 'guide.beginner.completed';
export const BEGINNER_GUIDE_REOPEN_PENDING_KEY = 'guide.beginner.reopenPending';
export const BEGINNER_GUIDE_LEGACY_DONE_KEY = 'home-beginner-guide-v1-done';

export const isBeginnerGuideCompleted = () => {
  const stored = electronStore?.get(BEGINNER_GUIDE_COMPLETED_KEY);
  if (typeof stored === 'boolean') {
    return stored;
  }

  try {
    return window.localStorage.getItem(BEGINNER_GUIDE_LEGACY_DONE_KEY) === 'true';
  } catch (_error) {
    return false;
  }
};

export const isBeginnerGuideReopenPending = () => Boolean(
  electronStore?.get(BEGINNER_GUIDE_REOPEN_PENDING_KEY, false)
);

export const setBeginnerGuideCompleted = (completed) => {
  const normalized = Boolean(completed);
  electronStore?.set(BEGINNER_GUIDE_COMPLETED_KEY, normalized);

  try {
    if (normalized) {
      window.localStorage.setItem(BEGINNER_GUIDE_LEGACY_DONE_KEY, 'true');
    } else {
      window.localStorage.removeItem(BEGINNER_GUIDE_LEGACY_DONE_KEY);
    }
  } catch (_error) {
    // ignore storage failures
  }
};

export const setBeginnerGuideReopenPending = (pending) => {
  electronStore?.set(BEGINNER_GUIDE_REOPEN_PENDING_KEY, Boolean(pending));
};

export const scheduleBeginnerGuideReopen = () => {
  setBeginnerGuideReopenPending(true);
};

export const clearBeginnerGuideReopen = () => {
  setBeginnerGuideReopenPending(false);
};
