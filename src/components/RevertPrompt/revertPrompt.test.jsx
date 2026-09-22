import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RevertPrompt, { REVERT_PROMPT_HINT, getRevertPromptSendState } from './index';
import { AI_WRITE_PRESET_OPTIONS } from '../Chat/Composer/AiWriteToolDetail/presetOptions';
import { buildReversePromptBlocks, normalizeReversePromptRequest, parseReversePromptResult, REVERSE_PROMPT_TOOL } from '../../shared/reversePrompt';

vi.mock('antd', () => ({ Tooltip: ({ children }) => children }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
});
const render = (props = {}) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<RevertPrompt {...props} />));
};
const request = { shareText: '分享视频 https://v.douyin.com/example/ 复制此文案' };
const response = { analysis: { prompt_json: { summary: '写法总结', reusable_prompt: '围绕 {topic} 写文案', user_prompt_template: '主题：{topic}' } } };
const result = { content: [{ type: 'text', text: JSON.stringify(response) }] };

describe('反推提示词入口', () => {
  it('仅显示独立标签和原来的回退箭头，支持退出', () => {
    const onBack = vi.fn();
    render({ onBack });
    expect(container.textContent).toBe('反推提示词');
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('svg.lucide-undo-2')).not.toBeNull();
    act(() => container.querySelector('button').click());
    expect(onBack).toHaveBeenCalledOnce();
  });
  it('发送期间禁止退出', () => {
    const onBack = vi.fn();
    render({ disabled: true, onBack });
    act(() => container.querySelector('button').click());
    expect(onBack).not.toHaveBeenCalled();
  });
  it('预设使用相同图标和 hint，不再预填字段', () => {
    const preset = AI_WRITE_PRESET_OPTIONS.find((item) => item.id === 'reverse-prompt');
    expect(preset.iconName).toBe('undo-2');
    expect(preset.placeholder).toBe(REVERT_PROMPT_HINT);
    expect(preset.template).toBe('');
    expect(preset.fields).toEqual([]);
    expect(preset.instruction).toBeUndefined();
  });
  it.each(['', '   ', '视频分享链接：[请输入]', '只有附件'])('拒绝没有链接的输入：%s', (input) => {
    expect(getRevertPromptSendState({ input, hasSelectedLocalFile: true }).canSend).toBe(false);
    expect(() => normalizeReversePromptRequest({ shareText: input })).toThrow();
  });
  it('接受并完整保留链接周围的分享文案', () => {
    expect(getRevertPromptSendState({ input: request.shareText }).canSend).toBe(true);
    expect(normalizeReversePromptRequest({ shareText: `  ${request.shareText}  `, other: 'ignored' })).toEqual(request);
  });
});

describe('MCP 结果与进度卡片', () => {
  it('输出可复用提示词而不是内部下载信息', () => {
    expect(parseReversePromptResult(result)).toEqual({
      response, assistantText: '写法总结\n\n围绕 {topic} 写文案\n\n主题：{topic}',
    });
  });
  it('兼容非 JSON 的分析正文', () => {
    expect(parseReversePromptResult({ content: [{ type: 'text', text: JSON.stringify({ analysis: { raw_response: '提示词正文' } }) }] }).assistantText).toBe('提示词正文');
  });
  it.each([
    { isError: true, content: [{ type: 'text', text: 'Error: 解析失败' }] },
    { content: [] },
    { content: [{ type: 'text', text: '{}' }] },
  ])('工具失败或无结果不伪装为成功', (value) => {
    expect(() => parseReversePromptResult(value)).toThrow();
  });
  it('处理中与完成的工具调用 ID 一致，用于接收进度', () => {
    const args = { assistantMessageId: 'a', requestId: 'r', request };
    const pending = buildReversePromptBlocks(args);
    const complete = buildReversePromptBlocks({ ...args, response, status: 'success', assistantText: '提示词' });
    expect(pending[0].toolName).toBe(REVERSE_PROMPT_TOOL);
    expect(pending[0].toolId).toBe('reverse_prompt_request_r');
    expect(complete[0].toolId).toBe(pending[0].toolId);
    expect(complete[1].content).toBe('提示词');
  });
});

// Exercise the registered handler with mocked MCP and persistence, without invoking paid APIs.
const createHandler = (callTool = vi.fn(async () => result)) => {
  const source = readFileSync('src/main/services/agents/services/channels/sessionStreamIpc.ts', 'utf8');
  const code = source.slice(source.indexOf('  const handleReversePromptRequest ='), source.indexOf('  const handleSessionCreate ='));
  const save = vi.fn(async () => {});
  const persistExchange = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const activeAbortControllers = new Map();
  const context = {
    normalizeReversePromptRequest, parseReversePromptResult, buildReversePromptBlocks,
    AbortController, Date, Error, String, randomUUID: () => 'generated-id',
    resolveSessionById: vi.fn(async () => ({ id: 's', agent_id: 'agent' })),
    activeAbortControllers,
    SocialCopywritingServer: class {
      mcpServer = { server: { _requestHandlers: new Map([['tools/call', callTool]]) }, close };
    },
    ensureDirectRequestSegment: vi.fn(async () => ({ id: 'segment' })),
    agentTurnRepository: { save },
    agentMessageRepository: { persistExchange },
    broadcastSessionChanged: vi.fn(),
  };
  const js = transpileModule(`${code}\nglobalThis.handler = handleReversePromptRequest;`, { compilerOptions: { target: 9 } }).outputText;
  runInNewContext(js, context);
  return { handler: context.handler, save, persistExchange, close, activeAbortControllers, callTool };
};
const payload = { sessionId: 's', requestId: 'r', assistantMessageId: 'a', userMessageId: 'u', userContent: '反推视频提示词', reversePromptRequest: request };
describe('普通分镜请求元数据', () => {
  it('普通 Agent 持久化保留分镜标记，使用当前执行 ID 且不排斥已有标记', () => {
    const source = readFileSync('src/main/services/agents/services/channels/sessionStreamIpc.ts', 'utf8');
    const handler = source.slice(source.indexOf('  const handleSessionMessageCreate ='));
    const declarations = handler.slice(handler.indexOf('      const draftInspectRequest ='), handler.indexOf('      if (!sessionId)'));
    const optionsStart = handler.indexOf('{\n                persist: true,');
    const optionsEnd = handler.indexOf('\n              }\n            ),', optionsStart) + '\n              }'.length;
    expect(optionsStart).toBeGreaterThan(0);
    const options = handler.slice(optionsStart, optionsEnd);
    const marker = { requestId: 'old', sourceFile: '/sre.json', storyboardFile: '/part.json', instruction: '分镜' };
    const context = {
      payload: { subtitleStoryboardRequest: marker, draftInspectRequest: { draftId: 'draft' } },
      requestId: 'retry-id', content: '完整提示词', images: [],
    };
    runInNewContext(transpileModule(`${declarations}\nglobalThis.options = ${options};`, {
      compilerOptions: { target: 9 },
    }).outputText, context);
    expect(context.options).toMatchObject({
      persist: true, displayContent: '完整提示词',
      userMessageExtras: {
        subtitleStoryboardRequest: { ...marker, requestId: 'retry-id' },
        draftInspectRequest: { draftId: 'draft' },
      },
    });
    expect(marker.requestId).toBe('old');
  });
  it('普通重试透传分镜标记及新执行 ID，不改变原提示词', () => {
    const source = readFileSync('src/page/HomePage/HomePage.jsx', 'utf8');
    const start = source.lastIndexOf('window.electronAPI.cherryChatStream.createMessage({');
    const code = source.slice(start, source.indexOf('\n      });', start) + '\n      });'.length);
    const createMessage = vi.fn();
    const marker = { requestId: 'old', sourceFile: '/sre.json', storyboardFile: '/part.json' };
    runInNewContext(code, {
      window: { electronAPI: { cherryChatStream: { createMessage } } },
      agentSessionId: 'session', requestId: 'new', chatModel: 'model',
      prevUser: { content: '完整格式约束', createdAt: 123, subtitleStoryboardRequest: marker },
    });
    expect(createMessage).toHaveBeenCalledWith({
      sessionId: 'session', content: '完整格式约束', createdAt: 123,
      requestId: 'new', model: 'model',
      subtitleStoryboardRequest: { ...marker, requestId: 'new' },
    });
    expect(marker.requestId).toBe('old');
  });
});
describe('主进程直连 MCP', () => {
  it('传递 shareText、进度 ID，并保存结果与重试元数据', async () => {
    const h = createHandler();
    const output = await h.handler(null, payload);
    expect(output.ok).toBe(true);
    expect(h.callTool.mock.calls[0][0].params).toEqual({ name: 'derive_copy_prompt', arguments: request });
    expect(h.callTool.mock.calls[0][1].toolCallId).toBe('reverse_prompt_request_r');
    expect(h.persistExchange.mock.calls[0][0].user.payload.message.reversePromptRequest).toEqual({ ...request, requestId: 'r' });
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.activeAbortControllers.size).toBe(0);
  });
  it('工具错误释放资源，不写入成功历史', async () => {
    const h = createHandler(vi.fn(async () => ({ isError: true, content: [{ type: 'text', text: '链接解析失败' }] })));
    expect(await h.handler(null, payload)).toMatchObject({ ok: false, error: '链接解析失败' });
    expect(h.persistExchange).not.toHaveBeenCalled();
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
  it('错误回包保留已计费结果并写入失败历史', async () => {
    const billing = { total_consumed_points: 0.8, complete: false };
    const h = createHandler(vi.fn(async () => ({
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: '分析失败', billing }) }],
    })));
    const output = await h.handler(null, payload);
    expect(output).toMatchObject({ ok: false, error: '分析失败' });
    expect(output.assistantBlocks[0].metadata.rawMcpToolResponse).toMatchObject({
      status: 'error', response: { billing },
    });
    expect(h.persistExchange.mock.calls[0][0].assistant.payload.blocks[0].content.billing).toEqual(billing);
    expect(h.save.mock.calls[0][0].status).toBe('failed');
  });
});

describe('编辑器入口集成', () => {
  it('选择反推模式时清空旧模板并聚焦，不调用通用模板', () => {
    const source = readFileSync('src/components/Chat/Composer/Composer.js', 'utf8');
    const code = source.slice(source.indexOf('  const handleAiWritePresetSelect ='), source.indexOf('  const handleImageTemplateApply ='));
    const context = {
      React: { useCallback: (fn) => fn },
      getAiWritePresetById: (id) => AI_WRITE_PRESET_OPTIONS.find((item) => item.id === id),
      getDefaultAiWritePresetId: () => 'add-text',
      setSelectedAiWritePresetId: vi.fn(),
      setActiveTool: vi.fn(), setInput: vi.fn(), latestInputRef: { current: '旧内容' },
      applyAiWriteTemplate: vi.fn(), enterTextAddMode: vi.fn(),
      closeMentionPanel: vi.fn(),
      editor: { commands: { clearContent: vi.fn(), focus: vi.fn() } },
    };
    runInNewContext(`${code}\nhandleAiWritePresetSelect('reverse-prompt');`, context);
    expect(context.setActiveTool).toHaveBeenCalledWith('reverse-prompt');
    expect(context.setInput).toHaveBeenCalledWith('');
    expect(context.editor.commands.clearContent).toHaveBeenCalledOnce();
    expect(context.editor.commands.focus).toHaveBeenCalledWith('end');
    expect(context.applyAiWriteTemplate).not.toHaveBeenCalled();
    expect(context.latestInputRef.current).toBe('');
  });
  it('发送链接时生成专用请求，hint 不进入消息正文', async () => {
    const source = readFileSync('src/components/Chat/Composer/Composer.js', 'utf8');
    const code = source.slice(source.indexOf('  const handleSendWithAttachments ='), source.indexOf('  const attemptSendWithAttachments ='));
    const context = {
      isSendDisabled: false, activeTool: 'reverse-prompt', input: request.shareText,
      collectImagePayloads: async () => [], selectedModelSupportsReadImage: false,
      uploadedFileMeta: [], uploadFileList: [], editor: {}, buildMarkdownFileLink: vi.fn(),
      serializeEditorMessage: () => ({ text: request.shareText, referencedFileUids: new Set() }),
      selectedTextAddDraftIds: [], selectedDraftInspectIds: [], selectedDraftModifyIds: [],
      buildVideoOptionPromptSegments: () => [], activeVideoCapability: null,
      selectedVideoGenerateAudio: false, selectedVideoSeedanceOffline: false, selectedVideoSuperResolve: false,
      closeMentionPanel: vi.fn(), handleSend: vi.fn(), setActiveTool: vi.fn(),
      setSelectedDraftDownloadIds: vi.fn(), setSelectedTextAddDraftIds: vi.fn(),
      setSelectedDraftInspectIds: vi.fn(), setSelectedDraftModifyIds: vi.fn(),
      setUploadFileList: vi.fn(), setUploadedFileMeta: vi.fn(),
    };
    runInNewContext(`${code}\nglobalThis.send = handleSendWithAttachments;`, context);
    await context.send();
    expect(context.handleSend).toHaveBeenCalledWith(
      `请反推以下视频的文案提示词：\n${request.shareText}`,
      expect.objectContaining({ reversePromptRequest: request, draftRequest: null, textAddRequest: null }),
    );
    expect(context.setActiveTool).toHaveBeenCalledWith(null);
  });
});

const createFrontendExecutor = (invoke) => {
  const source = readFileSync('src/page/HomePage/HomePage.jsx', 'utf8');
  const code = source.slice(source.indexOf('  const executeReversePromptRequest ='), source.indexOf('  const handleSendChatMessage ='));
  const context = {
    normalizeReversePromptRequest, buildReversePromptBlocks, chatModel: 'model', chatModelMeta: {},
    updateChatAssistantMessage: vi.fn(),
    chatPendingByRequestIdRef: { current: new Map() },
    window: { electronAPI: { cherryChatStream: { createReversePromptRequest: invoke } } },
    finalizeChatAssistantMessageLocally: vi.fn(),
    chatHistoryHydrateSettledRef: { current: new Set() },
    hydratePersistedChatSessionFromHistory: vi.fn(),
    setChatSessionFulfilled: vi.fn(), setChatSessionSending: vi.fn(),
    setChatSessionInFlight: vi.fn(), setChatSending: vi.fn(),
    normalizeChatError: (error) => ({ message: error.message }),
  };
  runInNewContext(`${code}\nglobalThis.execute = executeReversePromptRequest;`, context);
  return context;
};
const frontendArgs = {
  chatId: 'chat', agentSessionId: 's', requestId: 'r', assistantMessageId: 'a', request,
  userMessage: { id: 'u', content: '用户消息', createdAt: 123 },
};
describe('会话直连提交与重试执行器', () => {
  it('调用专用 IPC 并结束会话等待状态', async () => {
    const invoke = vi.fn(async () => ({ ok: true, assistantText: '提示词', assistantBlocks: [] }));
    const c = createFrontendExecutor(invoke);
    await c.execute(frontendArgs);
    expect(invoke.mock.calls[0][0]).toMatchObject({ reversePromptRequest: request, assistantMessageId: 'a', userMessageId: 'u' });
    expect(c.updateChatAssistantMessage).toHaveBeenLastCalledWith('chat', 'a', expect.objectContaining({ content: '提示词' }));
    expect(c.setChatSessionInFlight).toHaveBeenCalledWith('chat', false, 'reverse-prompt.complete');
    expect(c.chatPendingByRequestIdRef.current.size).toBe(0);
  });
  it('失败显示可重试错误并结束等待', async () => {
    const c = createFrontendExecutor(vi.fn(async () => ({ ok: false, error: '解析失败' })));
    await c.execute(frontendArgs);
    expect(c.finalizeChatAssistantMessageLocally).toHaveBeenCalledWith(
      { chatId: 'chat', assistantMessageId: 'a' }, { error: { message: '解析失败' } },
    );
    expect(c.setChatSessionFulfilled).not.toHaveBeenCalled();
    expect(c.chatPendingByRequestIdRef.current.size).toBe(0);
  });
  it('失败后显示后端返回的计费工具卡片', async () => {
    const blocks = buildReversePromptBlocks({
      assistantMessageId: 'a', requestId: 'r', request, status: 'error',
      response: { billing: { total_consumed_points: 0.8, complete: false } },
    });
    const c = createFrontendExecutor(vi.fn(async () => ({ ok: false, error: '分析失败', assistantBlocks: blocks })));
    await c.execute(frontendArgs);
    expect(c.updateChatAssistantMessage).toHaveBeenLastCalledWith('chat', 'a', { blocks });
    expect(c.finalizeChatAssistantMessageLocally).toHaveBeenCalledOnce();
  });
  it('取消后的迟到响应不会覆盖消息或新任务状态', async () => {
    const c = createFrontendExecutor(vi.fn(async () => {
      c.chatPendingByRequestIdRef.current.delete('r');
      return { ok: true, assistantText: '迟到的提示词', assistantBlocks: [] };
    }));
    await c.execute(frontendArgs);
    expect(c.updateChatAssistantMessage).toHaveBeenCalledOnce();
    expect(c.setChatSessionSending).not.toHaveBeenCalled();
  });
});
