import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import path from 'node:path';
import {
  normalizeSubtitleRecognitionRequest, buildSubtitleRecognitionBlocks, parseSubtitleRecognitionResult,
  buildSubtitleStoryboardLink, parseSubtitleStoryboardLink,
} from '../../shared/subtitleRecognition';

const request = { url: '/video.mp4', effectMode: 'nlp', maxSentenceLength: 20 };
const response = {
  success: true, status: 'success', billing: { consume: 3 },
  result: { content: '完整文案', segments: [{ start: 370, end: 1850, text: '字幕|内容' }] },
  artifact: { relative_path: 'task.json' },
};
const result = { content: [{ type: 'text', text: JSON.stringify(response) }] };

describe('字幕直连请求与固定回复', () => {
  it('固定回复链接使用实际识别文件路径，并安全编码空格、括号和中文', () => {
    const filePath = '/workspace/测试 (一)/sre_任务.json';
    const withArtifact = { ...response, artifact: { file_path: filePath, relative_path: '测试 (一)/sre_任务.json' } };
    const parsed = parseSubtitleRecognitionResult({
      content: [{ type: 'text', text: JSON.stringify(withArtifact) }],
    }, request);
    const link = buildSubtitleStoryboardLink(filePath);
    expect(parsed.assistantText).toContain(`[打开字幕分镜](${link})`);
    expect(link).not.toContain('(');
    expect(parseSubtitleStoryboardLink(link)).toBe(filePath);
    expect(parseSubtitleStoryboardLink(buildSubtitleStoryboardLink('C:\\工作区\\sre_one.json'))).toBe('C:/工作区/sre_one.json');
  });
  it('缺失文件不制造链接，异常链接或目录穿越不被接受', () => {
    const noFile = { ...response, artifact: undefined };
    expect(parseSubtitleRecognitionResult({ content: [{ type: 'text', text: JSON.stringify(noFile) }] }, request)
      .assistantText).not.toContain('打开字幕分镜');
    expect(buildSubtitleStoryboardLink('../sre_one.json')).toBe('');
    expect(parseSubtitleStoryboardLink('#subtitle-storyboard?file=%E0%A4')).toBe('');
    expect(parseSubtitleStoryboardLink('https://example.com/sre_one.json')).toBe('');
  });
  it('规范化参数并移除内部 requestId，不分句不传字数', () => {
    expect(normalizeSubtitleRecognitionRequest({ ...request, requestId: 'r', content: '  ' })).toEqual(request);
    expect(normalizeSubtitleRecognitionRequest({ ...request, effectMode: 'basic', content: ' 文案 ' }))
      .toEqual({ url: '/video.mp4', effectMode: 'basic', content: '文案' });
    expect(() => normalizeSubtitleRecognitionRequest({ ...request, maxSentenceLength: 81 })).toThrow();
    expect(() => normalizeSubtitleRecognitionRequest({ ...request, url: 'blob:abc' })).toThrow();
  });
  it('按真实结果生成毫秒时间轴、表格、全文和文件名，保留计费摘要', () => {
    const parsed = parseSubtitleRecognitionResult(result, request);
    expect(parsed.assistantText).toContain('共 1 条字幕，使用 20 字分句');
    expect(parsed.assistantText).toContain('| 1 | 00:00:00,370 → 00:00:01,850 | 字幕&#124;内容 |');
    expect(parsed.assistantText).toContain('```text\n完整文案\n```');
    expect(parsed.assistantText).toContain('工作区文件：task.json');
    expect(parsed.response.billing).toEqual({ consume: 3 });
    expect(parsed.response.result).toBeUndefined();
    expect(parseSubtitleRecognitionResult(result, { ...request, effectMode: 'basic' }).assistantText).toContain('不分句');
  });
  it('错误保留计费，不生成成功回复；缺失时间轴不伪造结果', () => {
    try {
      parseSubtitleRecognitionResult({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: '失败', billing: { consume: 3 } }) }] }, request);
      throw new Error('expected error');
    } catch (error) {
      expect(error.toolResponse.billing.consume).toBe(3);
    }
    expect(() => parseSubtitleRecognitionResult({ content: [{ type: 'text', text: '{}' }] }, request)).toThrow('缺少时间轴');
  });
});

const createHandler = (execute = vi.fn(async () => result)) => {
  const source = readFileSync('src/main/services/agents/services/channels/sessionStreamIpc.ts', 'utf8');
  const code = source.slice(source.indexOf('  const handleReversePromptRequest ='), source.indexOf('  const handleSessionCreate ='));
  const persistExchange = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const activeAbortControllers = new Map();
  const resolveSessionById = vi.fn(async () => ({ id: 's', agent_id: 'agent', accessible_paths: ['/workspace'] }));
  const context = {
    normalizeSubtitleRecognitionRequest, buildSubtitleRecognitionBlocks, parseSubtitleRecognitionResult,
    AbortController, Date, Error, String, randomUUID: () => 'new-id', activeAbortControllers,
    resolveSessionById,
    path, fs: { mkdirSync: vi.fn() }, getDefaultAgentWorkspacePath: () => '/default-workspace',
    sessionService: { updateSession: vi.fn(async () => ({})) },
    SubtitleRecognitionServer: class {
      executeDirectRequest = execute;
      mcpServer = { server: { _requestHandlers: new Map([['tools/call', vi.fn()]]) }, close };
    },
    ensureDirectRequestSegment: async () => ({ id: 'segment' }),
    agentTurnRepository: { save }, agentMessageRepository: { persistExchange },
    broadcastSessionChanged: vi.fn(),
    windowService: { getMainWindow: () => ({ webContents: { send: vi.fn() } }) },
    IpcChannel: { Mcp_Progress: 'progress' },
  };
  runInNewContext(transpileModule(`${code}\nglobalThis.handler = handleReversePromptRequest;`, {
    compilerOptions: { target: 9 },
  }).outputText, context);
  return { ...context, persistExchange, execute, close, save };
};
const payload = { sessionId: 's', requestId: 'r', assistantMessageId: 'a', userMessageId: 'u', userContent: '识别字幕', subtitleRecognitionRequest: request };

describe('字幕主进程直连', () => {
  it('直接执行 MCP、保存同会话历史及固定回复、关闭资源', async () => {
    const h = createHandler();
    const output = await h.handler(null, payload);
    expect(output.ok).toBe(true);
    expect(h.execute.mock.calls[0][0]).toEqual(request);
    expect(h.execute.mock.calls[0][1]._meta.progressToken).toBe('subtitle_recognition_request_r');
    expect(output.assistantBlocks[0].metadata.rawMcpToolResponse.response.billing.consume).toBe(3);
    const exchange = h.persistExchange.mock.calls[0][0];
    expect(exchange.user.payload.message.subtitleRecognitionRequest).toEqual({ ...request, requestId: 'r' });
    expect(exchange.assistant.payload.blocks[1].content).toContain('共 1 条字幕');
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.activeAbortControllers.size).toBe(0);
  });
  it('取消后忽略迟到结果', async () => {
    const h = createHandler(vi.fn(async () => {
      h.activeAbortControllers.get('s').controller.abort();
      return result;
    }));
    expect(await h.handler(null, payload)).toMatchObject({ ok: false, aborted: true });
    expect(h.persistExchange).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });
  it('没有工作区时创建并保存到当前会话', async () => {
    const h = createHandler();
    h.resolveSessionById.mockResolvedValue({ id: 's', agent_id: 'agent', accessible_paths: [] });
    expect((await h.handler(null, payload)).ok).toBe(true);
    expect(h.fs.mkdirSync).toHaveBeenCalledWith('/default-workspace/s', { recursive: true });
    expect(h.sessionService.updateSession).toHaveBeenCalledWith('agent', 's', {
      accessible_paths: ['/default-workspace/s'],
      configuration: { selected_workspace_path: '/default-workspace/s' },
    });
  });
  it('失败仍保存扣费和错误卡片', async () => {
    const h = createHandler(vi.fn(async () => ({
      isError: true, content: [{ type: 'text', text: JSON.stringify({ error: '识别失败', billing: { consume: 2 } }) }],
    })));
    const output = await h.handler(null, payload);
    expect(output.ok).toBe(false);
    expect(output.assistantBlocks[0].status).toBe('error');
    expect(output.assistantBlocks[0].metadata.rawMcpToolResponse.response.billing.consume).toBe(2);
    expect(h.persistExchange).toHaveBeenCalledOnce();
  });
});

describe('字幕前端直连执行器', () => {
  it('调用字幕 IPC，保留参数与请求标记并结束等待', async () => {
    const source = readFileSync('src/page/HomePage/HomePage.jsx', 'utf8');
    const code = source.slice(source.indexOf('  const executeReversePromptRequest ='), source.indexOf('  const handleSendChatMessage ='));
    const invoke = vi.fn(async () => ({ ok: true, assistantText: '字幕完成', assistantBlocks: [] }));
    const context = {
      normalizeSubtitleRecognitionRequest, buildSubtitleRecognitionBlocks, chatModel: 'model', chatModelMeta: {},
      updateChatAssistantMessage: vi.fn(), chatPendingByRequestIdRef: { current: new Map() },
      window: { electronAPI: { cherryChatStream: { createSubtitleRecognitionRequest: invoke } } },
      finalizeChatAssistantMessageLocally: vi.fn(), chatHistoryHydrateSettledRef: { current: new Set() },
      hydratePersistedChatSessionFromHistory: vi.fn(), setChatSessionFulfilled: vi.fn(),
      setChatSessionSending: vi.fn(), setChatSessionInFlight: vi.fn(), setChatSending: vi.fn(),
      normalizeChatError: (error) => ({ message: error.message }),
    };
    runInNewContext(`${code}\nglobalThis.execute = executeReversePromptRequest;`, context);
    await context.execute({ chatId: 'chat', agentSessionId: 's', requestId: 'r', assistantMessageId: 'a',
      userMessage: { id: 'u', createdAt: 123, content: '识别字幕' }, request, isSubtitle: true });
    expect(invoke.mock.calls[0][0].subtitleRecognitionRequest).toEqual(request);
    expect(context.updateChatAssistantMessage).toHaveBeenLastCalledWith('chat', 'a', expect.objectContaining({ content: '字幕完成' }));
    expect(context.chatPendingByRequestIdRef.current.size).toBe(0);
    expect(context.setChatSending).toHaveBeenCalledWith(false);
  });
});
