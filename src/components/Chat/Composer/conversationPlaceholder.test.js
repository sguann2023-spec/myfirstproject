import { describe, expect, it } from 'vitest';
import {
  getConversationPlaceholder,
  DEFAULT_CONVERSATION_PLACEHOLDER as original,
  FAILED_CONVERSATION_PLACEHOLDER as error,
  COMPLETED_CONVERSATION_PLACEHOLDER as complete,
  RUNNING_CONVERSATION_PLACEHOLDER as running,
} from './conversationPlaceholder';

const user = { role: 'user', content: '制作视频' };
const result = (message, options = {}) => getConversationPlaceholder({ messages: [user, { role: 'assistant', ...message }], ...options });

describe('conversation outcome placeholder', () => {
  it('keeps new conversations and unanswered user turns unchanged', () => {
    expect(getConversationPlaceholder()).toBe(original);
    expect(getConversationPlaceholder({ messages: [user] })).toBe(original);
    expect(getConversationPlaceholder({ messages: [user, { role: 'assistant', error: 'old' }, user], fulfilled: true })).toBe(original);
  });
  it.each([{ error: { message: '失败' } }, { status: 'error' }, { status: 'failed' }, { canonicalStatus: 'failed' }, { blocks: [{ type: 'error' }] }])('shows continuation hint for failure %j', (message) => {
    expect(result(message)).toBe(error);
  });
  it.each(['success', 'completed', 'complete', 'done'])('shows change request hint for %s', (status) => {
    expect(result({ status })).toBe(complete);
  });
  it('supports real-time completion without message status', () => {
    expect(result({ content: '完成' }, { fulfilled: true })).toBe(complete);
  });
  it('does not reuse errors from an older turn', () => {
    expect(getConversationPlaceholder({ messages: [user, { role: 'assistant', error: 'old' }, user, { role: 'assistant', status: 'success' }] })).toBe(complete);
  });
  it('shows the queue hint while a task is executing, regardless of the previous outcome', () => {
    expect(result({ error: 'error' }, { sending: true })).toBe(running);
    expect(result({ status: 'success' }, { sending: true })).toBe(running);
    expect(getConversationPlaceholder({ sending: true, messages: [user] })).toBe(running);
  });
  it('keeps the original hint while loading history', () => {
    expect(result({ error: 'error' }, { historyLoading: true })).toBe(original);
    expect(result({ status: 'success' }, { historyLoading: true, sending: true })).toBe(original);
  });
  it.each(['pending', 'processing', 'streaming', 'running', 'paused', 'cancelled', 'interrupted'])('does not claim completion for %s', (status) => {
    expect(result({ status }, { fulfilled: true })).toBe(original);
  });
  it('distinguishes user cancellation from task failure', () => {
    expect(result({ aborted: true, error: { message: 'abort' } })).toBe(original);
  });
});
