// Run: pnpm exec vitest run src/api/chat.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../http', () => ({ http: { postJson: vi.fn(), getJson: vi.fn() } }));
import { http } from '../http';
import { testChatModel } from './chat.js';

beforeEach(() => {
  vi.useFakeTimers();
  http.postJson.mockReset();
  http.getJson.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('testChatModel', () => {
  it('succeeds immediately when the submit response already contains content', async () => {
    http.postJson.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
    const result = await testChatModel('glm-5.3');
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(http.postJson).toHaveBeenCalledTimes(1);
    const [url, body] = http.postJson.mock.calls[0];
    expect(url).toContain('/llm/chat/submit_task/submit_chat_task');
    expect(body).toMatchObject({ model: 'glm-5.3', stream: false });
    expect(http.getJson).not.toHaveBeenCalled();
  });

  it('polls task status until success', async () => {
    http.postJson.mockResolvedValue({ task_id: 'task-1' });
    http.getJson.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({ status: 'success' });
    const promise = testChatModel('glm-5.3');
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(http.getJson).toHaveBeenCalledTimes(2);
    expect(http.getJson.mock.calls[0][0]).toContain('task_id=task-1');
  });

  it('reports failure reason from a failed task', async () => {
    http.postJson.mockResolvedValue({ task_id: 'task-2' });
    http.getJson.mockResolvedValue({ status: 'failed', error: 'model unavailable' });
    const promise = testChatModel('broken-model');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, error: 'model unavailable' });
  });

  it('treats error status as failure instead of polling until timeout', async () => {
    http.postJson.mockResolvedValue({ task_id: 'task-err' });
    http.getJson.mockResolvedValue({ status: 'error', message: 'upstream exploded' });
    const promise = testChatModel('broken-model');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, error: 'upstream exploded' });
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });

  it('fails closed on network errors and missing model without throwing', async () => {
    http.postJson.mockRejectedValue(new Error('network down'));
    const result = await testChatModel('glm-5.3');
    expect(result).toMatchObject({ ok: false, error: 'network down' });
    http.postJson.mockClear();
    const missing = await testChatModel('  ');
    expect(missing.ok).toBe(false);
    expect(http.postJson).not.toHaveBeenCalled();
  });

  it('times out only after the full 60s budget when the task never finishes', async () => {
    http.postJson.mockResolvedValue({ task_id: 'task-3' });
    http.getJson.mockResolvedValue({ status: 'running' });
    const promise = testChatModel('slow-model');
    await vi.advanceTimersByTimeAsync(30000);
    expect(http.getJson).toHaveBeenCalledTimes(15);
    await vi.advanceTimersByTimeAsync(31000);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, error: '测试超时（60 秒）' });
    expect(http.getJson).toHaveBeenCalledTimes(30);
  });
});