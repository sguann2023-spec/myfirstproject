import { describe, expect, it, vi } from 'vitest';
vi.mock('../http', () => ({ http: { getJson: vi.fn() } }));
import { http } from '../http';
import { getChatModelList } from './chat';

describe('official model catalog renderer contract', () => {
  it('uses the shared rich PC parser and keeps desktop metadata on the request', async () => {
    http.getJson.mockResolvedValueOnce({
      models: ['gpt-6.1-sol'], default_model: 'gpt-6.1-sol',
      model_items: [{ model_id: 'gpt-6.1-sol', name: 'Sol', read_image: true, context_window_tokens: 1050000, thinking_levels: ['low', 'medium', 'high'], thinking_default: 'medium' }]
    });
    const result = await getChatModelList();
    expect(result.defaultModel).toBe('gpt-6.1-sol');
    expect(result.modelItems[0]).toMatchObject({ model_id: 'gpt-6.1-sol', name: 'Sol', read_image: true, context_window_tokens: 1050000, thinking_default: 'medium' });
    const [url, options] = http.getJson.mock.calls.at(-1);
    expect(url).toContain('/llm/chat/model_list?');
    expect(new URL(url).searchParams.get('client_type')).toMatch(/^(mac|windows|linux|pc)$/);
    expect(options.headers['X-Client-Type']).toBe(new URL(url).searchParams.get('client_type'));
  });
  it('keeps live IDs/order authoritative over stale metadata, including an empty list', async () => {
    const model_items = [
      { model_id: 'stale' },
      { model_id: 'second', name: 'Second', read_image: true },
      { model_id: 'first', name: 'First' },
    ];
    http.getJson.mockResolvedValueOnce({ data: { models: ['first', 'missing', 'second'], model_items } });
    const result = await getChatModelList();
    expect(result.modelItems.map(model => model.model_id)).toEqual(['first', 'missing', 'second']);
    expect(result.modelItems[1]).toEqual({ model_id: 'missing', name: 'missing' });
    http.getJson.mockResolvedValueOnce({ models: [], model_items });
    expect(await getChatModelList()).toMatchObject({ models: [], modelItems: [] });
  });
  it('does not supply fake models or vision support for sparse or failed data', async () => {
    http.getJson.mockResolvedValueOnce({ models: ['official-real-model'] });
    const sparse = await getChatModelList();
    expect(sparse.modelItems).toEqual([{ model_id: 'official-real-model', name: 'official-real-model' }]);
    http.getJson.mockResolvedValueOnce({ models: [] });
    expect((await getChatModelList()).modelItems).toEqual([]);
    http.getJson.mockRejectedValueOnce(new Error('offline'));
    await expect(getChatModelList()).rejects.toThrow('offline');
  });
});
