import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialCopywritingBilling } from '../../main/mcpServers/social-copywriting-billing';
import { extractMediaGenerationBillingSummary } from '../../renderer/src/pages/home/Messages/Tools/MessageAgentTools/mediaGenerationBilling';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('electron-store', () => ({ default: class { get() {} set() {} } }));
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }) } }));
vi.mock('@main/services/WindowService', () => ({ windowService: { sendToAllWindows: vi.fn() } }));
vi.mock('@main/utils', () => ({ getResourcePath: vi.fn() }));

import SocialCopywritingServer from '../../main/mcpServers/social-copywriting';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('组合调用点数汇总', () => {
  it('按阶段求和，兼容点数字符串、别名和嵌套字段，不重复统计别名', () => {
    const billing = new SocialCopywritingBilling();
    billing.record('parse_share_link', { billing: { consume: '0.1' }, consume: 0.1 });
    billing.record('asr', { result: { points_consumed: 0.2 } });
    billing.record('analyze_prompt', { result: { response: { billing: { total_consumed_points: 0.3 } } } });
    expect(billing.snapshot().billing).toMatchObject({ total_consumed_points: 0.6, complete: true, missing_stages: [] });
  });
  it('任务提交、轮询和最终结果只计一次，以最新计费结果为准', () => {
    const billing = new SocialCopywritingBilling();
    billing.record('asr', { task_id: 'asr-1', points_consumed: 1 });
    for (let i = 0; i < 3; i += 1) billing.record('asr', { task_id: 'asr-1', billing: { consume: 1 } });
    billing.record('asr', { task_id: 'asr-1', result: { billing: { consume: 1.5 } } });
    billing.record('asr', { task_id: 'asr-1', status: 'success' });
    expect(billing.snapshot().billing.total_consumed_points).toBe(1.5);
  });
  it('缺失字段不当作零；显式零点是有效的计费记录', () => {
    const billing = new SocialCopywritingBilling();
    expect(billing.snapshot().billing.total_consumed_points).toBeUndefined();
    billing.record('parse_share_link', { billing: { consume: 0 } });
    expect(billing.snapshot().billing).toMatchObject({
      total_consumed_points: 0, complete: false, missing_stages: ['asr', 'analyze_prompt'],
    });
  });
  it.each([null, '', false, -1, 'NaN'])('拒绝无效点数 %s', (value) => {
    const billing = new SocialCopywritingBilling();
    billing.record('asr', { points_consumed: value });
    expect(billing.snapshot().billing.total_consumed_points).toBeUndefined();
  });
  it('保留内部模型 token 用量，不将点数当成 token', () => {
    const billing = new SocialCopywritingBilling();
    const payload = { result: { response: { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } } };
    billing.record('analyze_prompt', payload);
    billing.record('analyze_prompt', payload);
    expect(billing.snapshot().usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  });
  it('不同阶段的 token 别名先对齐再汇总，不遗漏或重复计数', () => {
    const billing = new SocialCopywritingBilling();
    billing.record('asr', { usage: { input_tokens: 100, output_tokens: 20 } });
    billing.record('analyze_prompt', { usage: { prompt_tokens: 200, input_tokens: 200, completion_tokens: 30 } });
    expect(billing.snapshot().usage).toEqual({ prompt_tokens: 300, completion_tokens: 50, total_tokens: 350 });
  });
  it('现有卡片显示已返回阶段的合计，不附加计费不完整说明', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    const billing = new SocialCopywritingBilling();
    billing.record('asr', { points_consumed: 1.25 });
    const result = { content: [{ type: 'text', text: JSON.stringify(billing.snapshot()) }] };
    expect(extractMediaGenerationBillingSummary({ response: result, responseRaw: result })).toEqual({
      totalConsumedPoints: 1.25, displayText: '1.25',
    });
  });
});

const jsonResponse = (data) => ({ ok: true, json: async () => data });
const createServer = (failAnalysis = false) => {
  const server = new SocialCopywritingServer();
  const asrStates = [
    { status: 'processing', billing: { consume: 0.5 } },
    { status: 'success', result: { content: '字幕正文', points_consumed: 0.5 } },
  ];
  const chatStates = [
    { status: 'processing', points_consumed: 1.2 },
    {
      status: failAnalysis ? 'failed' : 'success', error: failAnalysis ? '分析失败' : undefined,
      result: {
        billing: { consume: 1.2 },
        response: {
          choices: [{ message: { content: JSON.stringify({ reusable_prompt: '提示词' }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        },
      },
    },
  ];
  server.requestJson = vi.fn(async (endpoint) => {
    if (endpoint.includes('/parse')) return jsonResponse({ success: true, billing: { consume: 0.1 }, data: { video: { url: 'https://example.com/video.mp4' } } });
    if (endpoint.includes('submit_asr')) return jsonResponse({ success: true, task_id: 'asr-1', billing: { consume: 0.5 } });
    if (endpoint.includes('asr_llm/submit_task/task_status')) return jsonResponse(asrStates.shift());
    if (endpoint.includes('submit_chat')) return jsonResponse({ success: true, task_id: 'chat-1', points_consumed: 1.2 });
    if (endpoint.includes('chat/submit_task/task_status')) return jsonResponse(chatStates.shift());
    throw new Error(`Unexpected endpoint ${endpoint}`);
  });
  server.createTempArtifacts = vi.fn(async () => ({ tempDir: '/tmp/mock', videoPath: '/tmp/mock/video', audioPath: '/tmp/mock/audio' }));
  server.downloadToFile = vi.fn(async () => 1024);
  server.extractAudioToMp3 = vi.fn(async () => {});
  server.uploadLocalFileToTempOss = vi.fn(async () => ({ publicUrl: 'https://example.com/audio.mp3' }));
  server.cleanupTempArtifacts = vi.fn(async () => {});
  server.reportProgress = vi.fn(async () => {});
  return server;
};
const execute = async (server) => {
  vi.useFakeTimers();
  const handler = server.mcpServer.server._requestHandlers.get('tools/call');
  const pending = handler({
    method: 'tools/call', params: { name: 'derive_copy_prompt', arguments: { shareText: 'https://v.douyin.com/example/' } },
  }, { signal: new AbortController().signal, requestId: 'request-1', sendNotification: vi.fn() });
  await vi.runAllTimersAsync();
  const result = await pending;
  await server.mcpServer.close();
  return { result, payload: JSON.parse(result.content[0].text) };
};

describe('真实组合工具执行链路（模拟付费后端）', () => {
  it.each(['asr', 'chat'])('%s 阶段超过原来的三分钟仍可等待成功', async (stage) => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const server = createServer();
    server.requestJson = vi.fn(async () => jsonResponse(
      Date.now() - startedAt < 4 * 60 * 1000
        ? { status: 'processing' }
        : { status: 'success', result: { content: '字幕', assistant: '{"reusable_prompt":"提示词"}' } },
    ));
    const extra = { signal: new AbortController().signal };
    const pending = stage === 'asr'
      ? server.waitForAsrResult('task', extra)
      : server.waitForChatResult('task', 'model', extra);
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    const result = await pending;
    expect(stage === 'asr' ? result.status : result.parsed.reusable_prompt).toBe(stage === 'asr' ? 'success' : '提示词');
    await server.mcpServer.close();
  });
  it('贯通解析、ASR、分析、轮询和返回值，累计 1.80 点', async () => {
    const server = createServer();
    const { result, payload } = await execute(server);
    expect(result.isError).not.toBe(true);
    expect(payload.billing).toMatchObject({ total_consumed_points: 1.8, complete: true });
    expect(payload.usage.total_tokens).toBe(150);
    expect(payload.analysis.prompt_json.reusable_prompt).toBe('提示词');
    expect(server.cleanupTempArtifacts).toHaveBeenCalledOnce();
  });
  it('分析失败仍返回之前的计费与错误，不清零', async () => {
    const { result, payload } = await execute(createServer(true));
    expect(result.isError).toBe(true);
    expect(payload.error).toContain('分析失败');
    expect(payload.billing.total_consumed_points).toBe(1.8);
  });
  it('分析提交失败时只统计已知阶段，缺失阶段不填零', async () => {
    const server = createServer();
    const originalRequest = server.requestJson;
    server.requestJson = vi.fn(async (endpoint, options) => (
      endpoint.includes('submit_chat')
        ? { ok: false, status: 503, text: async () => 'service unavailable' }
        : originalRequest(endpoint, options)
    ));
    const { result, payload } = await execute(server);
    expect(result.isError).toBe(true);
    expect(payload.billing).toMatchObject({
      total_consumed_points: 0.6, complete: false, missing_stages: ['analyze_prompt'],
    });
  });
});
