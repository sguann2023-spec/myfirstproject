import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageItem from '../Chat/MessagePane/MessageItem/MessageItem';
import MessageMcpTool from '../../renderer/src/pages/home/Messages/Tools/MessageMcpTool';
import { McpServerToolRenderer } from '../../renderer/src/pages/home/Messages/Tools/MessageAgentTools/McpServerToolRenderer';
import { buildReversePromptBlocks, REVERSE_PROMPT_TOOL } from '../../shared/reversePrompt';

vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }));
vi.mock('@renderer/store', () => ({ default: {}, useAppSelector: () => [] }));
vi.mock('@renderer/components/Icons', () => ({ CopyIcon: () => null }));
vi.mock('@renderer/context/CodeStyleProvider', () => ({ useCodeStyle: () => ({}) }));
vi.mock('@renderer/hooks/useSettings', () => ({ useSettings: () => ({ fontSize: 14 }) }));
vi.mock('@renderer/hooks/useTimer', () => ({ useTimer: () => ({ setTimeoutTimer: vi.fn() }) }));
vi.mock('@renderer/utils/mcp-tools', () => ({ isToolAutoApproved: () => false }));
vi.mock('@renderer/pages/home/Messages/MessageTokens', () => ({ default: () => null }));
vi.mock('../Chat/MessagePane/MessageHeader/MessageHeader', () => ({ default: () => null }));
vi.mock('../Chat/MessagePane/MessageContent/MessageContent', () => ({
  default: ({ message }) => <div data-testid="content">{message.content}</div>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('@renderer/pages/home/Messages/Tools/hooks/useToolApproval', () => ({
  useToolApproval: () => ({ isWaiting: false }),
}));
vi.mock('@renderer/pages/home/Messages/Tools/ToolApprovalActions', () => ({ default: () => null }));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/GenericTools', () => ({
  getEffectiveStatus: (status) => status,
  SkeletonSpan: () => null, TruncatedIndicator: () => null,
  ToolStatusIndicator: ({ status }) => <span>{status}</span>,
  ToolHeader: ({ stats }) => <div>{stats}</div>,
}));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/KouboTemplateTool', () => ({
  isKouboTemplateToolName: () => false, KouboTemplateToolBody: () => null,
}));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/MediaGenerationTool', () => ({
  isMediaGenerationToolName: () => false, MediaGenerationToolBody: () => null,
}));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/SubtitleRecognitionTool', () => ({
  isSubtitleRecognitionToolName: () => false, SubtitleRecognitionToolBody: () => null,
}));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/SubtitleTemplateTool', () => ({
  isSubtitleTemplateToolName: () => false, SubtitleTemplateToolBody: () => null,
}));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/ImageUnderstandeToolRenderer', () => ({ ImageUnderstandeTool: () => null }));
vi.mock('@renderer/pages/home/Messages/Tools/MessageAgentTools/VideoUnderstandeToolRenderer', () => ({ VideoUnderstandeTool: () => null }));
vi.mock('antd', () => ({
  Tooltip: ({ title, children }) => <span data-tooltip={title}>{children}</span>,
  message: { success: vi.fn(), error: vi.fn() },
  Flex: ({ children, className }) => <div className={className}>{children}</div>,
  ConfigProvider: ({ children }) => children,
  Progress: () => <span data-testid="progress" />,
  Collapse: ({ items, className }) => <div className={className}>{items.map((item) => <div key={item.key}>{item.label}</div>)}</div>,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, progressListener;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({})));
  window.electron = { ipcRenderer: { on: (_event, listener) => { progressListener = listener; return () => {}; } } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (element) => act(() => root.render(element));
const button = (title) => container.querySelector(`[data-tooltip="${title}"] button`);

describe('反推消息仅支持 Agent 转换', () => {
  const message = { id: 'u', content: '反推视频 https://v.douyin.com/example/', reversePromptRequest: { shareText: 'https://v.douyin.com/example/', requestId: 'r' } };
  it('文字与 Agent 可切换，复制使用展示内容且不修改原始消息', async () => {
    const copy = vi.fn();
    render(<MessageItem message={message} role="user" hasConnectedExternalAgent onCopyAssistantMessage={copy} />);
    expect(button('Agent')).not.toBeNull();
    expect(button('API')).toBeNull();
    expect(button('Coze')).toBeNull();
    act(() => button('Agent').click());
    expect(container.querySelector('[data-testid="content"]').textContent).toContain('使用vectcut工具');
    await act(async () => button('复制').click());
    expect(copy.mock.calls[0][0].content).toContain('使用vectcut工具');
    expect(message.content.startsWith('反推视频')).toBe(true);
    act(() => button('文字').click());
    expect(container.querySelector('[data-testid="content"]').textContent).toBe(message.content);
  });
  it('外部 Agent 未连接时不显示转换入口', () => {
    render(<MessageItem message={message} role="user" hasConnectedExternalAgent={false} />);
    expect(button('Agent')).toBeNull();
    expect(button('API')).toBeNull();
  });
  it('补回历史请求标记时 memo 不阻止更新', () => {
    render(<MessageItem message={{ id: 'u', content: message.content }} role="user" hasConnectedExternalAgent />);
    expect(button('Agent')).toBeNull();
    render(<MessageItem message={message} role="user" hasConnectedExternalAgent />);
    expect(button('Agent')).not.toBeNull();
  });
});

describe('工具卡片显示消耗', () => {
  const payload = { billing: { total_consumed_points: 1.8, complete: true } };
  const block = (status, response = payload) => buildReversePromptBlocks({
    assistantMessageId: 'a', requestId: 'r', request: {}, status, response,
  })[0];
  it('直连卡片在 100% 进度后显示总点数，不被进度覆盖', () => {
    render(<MessageMcpTool block={block('processing', null)} />);
    act(() => progressListener(null, { callId: 'reverse_prompt_request_r', progress: 1, message: '已完成' }));
    expect(container.querySelector('[data-testid="progress"]')).not.toBeNull();
    render(<MessageMcpTool block={block('success')} />);
    expect(container.querySelector('[title="总消耗 1.80"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="progress"]')).toBeNull();
  });
  it('错误工具卡片保留已知点数', () => {
    render(<MessageMcpTool block={block('error', { billing: { total_consumed_points: 0.6, complete: false } })} />);
    const badge = container.querySelector('[title="总消耗 0.60"]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('0.60');
    expect(container.textContent).not.toContain('（已知）');
  });
  it('未返回计费数据不显示 0 点', () => {
    render(<MessageMcpTool block={block('success', { billing: { complete: false } })} />);
    expect(container.querySelector('[title^="总消耗"]')).toBeNull();
  });
  it('Agent 路径同样展示汇总点数', () => {
    const Header = () => McpServerToolRenderer({
      toolName: REVERSE_PROMPT_TOOL,
      output: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
      progress: 1,
    }).label;
    render(<Header />);
    expect(container.querySelector('[title="总消耗 1.80"]')).not.toBeNull();
  });
});
