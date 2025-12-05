import { electronStore } from '../shared/electronStore';

export function setStorage(key, value) {
  electronStore.set(key, value);
}

export function getStorage(key) {
  const v = electronStore.get(key);
  return v !== undefined ? v : null;
}

export function removeStorage(key) {
  electronStore.delete(key);
}