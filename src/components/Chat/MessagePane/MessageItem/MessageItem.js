import React from 'react';
import { Bot, Check, Code, Copy, RefreshCw, Trash2, Type } from 'lucide-react';
import { Tooltip, message as antMessage } from 'antd';
import { Provider, useSelector } from 'react-redux';
import './MessageItem.css';
import MessageContent from '../MessageContent/MessageContent';
import MessageHeader from '../MessageHeader/MessageHeader';
import MessageTokens from '../../../../renderer/src/pages/home/Messages/MessageTokens';
import appStore from '../../../../renderer/src/store';
import { buildErrorSignature } from '../../../../shared/chatError';
const DEBUG_CHAT_LOADING = false && process.env.NODE_ENV !== 'production';

const buildImageAttachmentSignature = (attachments = []) => JSON.stringify(
  (Array.isArray(attachments) ? attachments : []).map((item) => ({
    uid: String(item?.uid || ''),
    name: String(item?.name || ''),
    url: String(item?.url || ''),
    previewUrl: String(item?.previewUrl || ''),
    thumbnailUrl: String(item?.thumbnailUrl || ''),
    fileType: String(item?.fileType || '')
  }))
);

const buildUsageSignature = (usage = null) => JSON.stringify({
  total_tokens: Number(usage?.total_tokens || 0),
  prompt_tokens: Number(usage?.prompt_tokens || 0),
  completion_tokens: Number(usage?.completion_tokens || 0),
  cost: Number(usage?.cost || 0)
});

const buildUsageStepsSignature = (usageSteps = []) => JSON.stringify(
  (Array.isArray(usageSteps) ? usageSteps : []).map((step) => ({
    total_tokens: Number(step?.total_tokens || 0),
    prompt_tokens: Number(step?.prompt_tokens || 0),
    completion_tokens: Number(step?.completion_tokens || 0),
    cache_read_input_tokens: Number(step?.cache_read_input_tokens || 0),
    cache_creation_input_tokens: Number(step?.cache_creation_input_tokens || 0)
  }))
);

const buildMetricsSignature = (metrics = null) => JSON.stringify({
  completion_tokens: Number(metrics?.completion_tokens || 0),
  time_completion_millsec: Number(metrics?.time_completion_millsec || 0),
  time_first_token_millsec: Number(metrics?.time_first_token_millsec || 0)
});
const buildDraftRequestSignature = (draftRequest = null) => {
  if (!draftRequest || typeof draftRequest !== 'object') return '';
  return JSON.stringify({
    action: String(draftRequest?.action || ''),
    width: Number(draftRequest?.width || 0),
    height: Number(draftRequest?.height || 0),
    cover: String(draftRequest?.cover || ''),
    name: String(draftRequest?.name || '')
  });
};
const buildDraftDownloadRequestSignature = (draftDownloadRequest = null) => {
  if (!draftDownloadRequest || typeof draftDownloadRequest !== 'object') return '';
  return JSON.stringify({
    drafts: (Array.isArray(draftDownloadRequest?.drafts) ? draftDownloadRequest.drafts : []).map((item) => ({
      draftId: String(item?.draftId || item?.draft_id || ''),
      draftName: String(item?.draftName || item?.draft_name || ''),
      cover: String(item?.cover || '')
    }))
  });
};
const buildDraftExportRequestSignature = (draftExportRequest = null) => buildDraftDownloadRequestSignature(draftExportRequest);
const buildDraftModifyRequestSignature = (draftModifyRequest = null) => {
  if (!draftModifyRequest || typeof draftModifyRequest !== 'object') return '';
  return JSON.stringify({
    draftId: String(draftModifyRequest?.draftId || draftModifyRequest?.draft_id || ''),
    name: String(draftModifyRequest?.name || ''),
    cover: String(draftModifyRequest?.cover || '')
  });
};
const buildDraftInspectRequestSignature = (draftInspectRequest = null) => {
  if (!draftInspectRequest || typeof draftInspectRequest !== 'object') return '';
  return JSON.stringify({
    requestId: String(draftInspectRequest?.requestId || ''),
    draftId: String(draftInspectRequest?.draftId || draftInspectRequest?.draft_id || ''),
    requirement: String(
      draftInspectRequest?.requirement
      || draftInspectRequest?.inspectRequirement
      || draftInspectRequest?.query
      || ''
    )
  });
};
const isHttpLikeUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());
const resolveDraftApiCover = (draftRequest = null, message = {}) => {
  const directCover = String(draftRequest?.cover || '').trim();
  if (isHttpLikeUrl(directCover)) return directCover;

  const attachmentCover = (Array.isArray(message?.imageAttachments) ? message.imageAttachments : []).reduce((matched, attachment) => {
    if (matched) return matched;
    const candidate = String(
      attachment?.url
      || attachment?.previewUrl
      || attachment?.thumbnailUrl
      || ''
    ).trim();
    return isHttpLikeUrl(candidate) ? candidate : matched;
  }, '');
  if (attachmentCover) return attachmentCover;
  if (directCover) return directCover;
  return '';
};
const buildDraftRequestApiCurl = (draftRequest = null, message = {}) => {
  const width = Number(draftRequest?.width || 1080) || 1080;
  const height = Number(draftRequest?.height || 1920) || 1920;
  const cover = resolveDraftApiCover(draftRequest, message);
  const name = String(draftRequest?.name || '').trim();
  const payload = {
    width,
    height,
    ...(cover ? { cover } : {}),
    ...(name ? { name } : {})
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/create_draft' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildDraftModifyRequestApiCurl = (draftModifyRequest = null, message = {}) => {
  const draftId = String(draftModifyRequest?.draftId || draftModifyRequest?.draft_id || '').trim();
  const cover = resolveDraftApiCover(draftModifyRequest, message);
  const name = String(draftModifyRequest?.name || '').trim();
  const payload = {
    draft_id: draftId,
    ...(name ? { name } : {}),
    ...(cover ? { cover } : {})
  };
  const payloadText = JSON.stringify(payload, null, 4);
  return [
    "curl --location 'https://open.vectcut.com/cut_jianying/modify_draft' \\",
    "--header 'Authorization: Bearer <token>' \\",
    "--header 'Content-Type: application/json' \\",
    `--data '${payloadText}'`
  ].join('\n');
};
const buildDraftAgentPrompt = (content = '') => {
  const normalizedContent = String(content || '').trim();
  return normalizedContent ? `使用vectcut工具，${normalizedContent}` : '使用vectcut工具';
};

const LiveAssistantMessageTokens = ({ fallbackMessage, storeAssistantMessageId }) => {
  const storeMessage = useSelector((state) => state?.messages?.entities?.[storeAssistantMessageId] || null);
  const resolvedMessage = storeMessage
    ? {
      ...fallbackMessage,
      ...storeMessage,
      model: storeMessage?.model || fallbackMessage?.model,
      modelId: storeMessage?.modelId || fallbackMessage?.modelId,
      usage: storeMessage?.usage ?? fallbackMessage?.usage,
      usageSteps: storeMessage?.usageSteps ?? fallbackMessage?.usageSteps,
      metrics: storeMessage?.metrics ?? fallbackMessage?.metrics
    }
    : fallbackMessage;

  return <MessageTokens message={resolvedMessage} />;
};

const MessageItem = ({
  message,
  role,
  hasConnectedExternalAgent = false,
  onCopyAssistantMessage,
  onRetryAssistantMessage,
  onDeleteAssistantMessage,
  actionsDisabled = false,
  formatMessageTime,
  model,
  modelOptions,
  formatModelDisplayName,
  isLoading = false,
  userName,
  userAvatar,
}) => {
  const isAssistant = role === 'assistant';
  const isUser = role === 'user';
  const draftRequest = message?.draftRequest && typeof message.draftRequest === 'object'
    ? message.draftRequest
    : null;
  const draftExportRequest = message?.draftExportRequest && typeof message.draftExportRequest === 'object'
    ? message.draftExportRequest
    : null;
  const draftDownloadRequest = message?.draftDownloadRequest && typeof message.draftDownloadRequest === 'object'
    ? message.draftDownloadRequest
    : null;
  const draftModifyRequest = message?.draftModifyRequest && typeof message.draftModifyRequest === 'object'
    ? message.draftModifyRequest
    : null;
  const draftInspectRequest = message?.draftInspectRequest && typeof message.draftInspectRequest === 'object'
    ? message.draftInspectRequest
    : null;
  const hasDraftAgentCompatibleRequest = Boolean(
    draftRequest || draftExportRequest || draftDownloadRequest || draftModifyRequest || draftInspectRequest
  );
  const canShowDraftAgentAction = isUser && hasConnectedExternalAgent && hasDraftAgentCompatibleRequest;
  const canShowDraftApiAction = isUser && !draftExportRequest && !draftDownloadRequest && (Boolean(draftRequest) || Boolean(draftModifyRequest));
  const storeAssistantMessageId = String(message?.storeAssistantMessageId || '').trim();
  const canUseLiveAssistantTokens = isAssistant && Boolean(storeAssistantMessageId);
  const [copied, setCopied] = React.useState(false);
  const [draftDisplayMode, setDraftDisplayMode] = React.useState('text');
  const showDraftAgentFormat = draftDisplayMode === 'agent';
  const showDraftApiFormat = draftDisplayMode === 'api';
  const displayedMessage = React.useMemo(() => {
    if (showDraftAgentFormat && canShowDraftAgentAction) {
      return {
        ...message,
        content: buildDraftAgentPrompt(message?.content)
      };
    }
    if (!canShowDraftApiAction || !showDraftApiFormat) return message;
    const apiContent = draftModifyRequest
      ? buildDraftModifyRequestApiCurl(draftModifyRequest, message)
      : buildDraftRequestApiCurl(draftRequest, message);
    return {
      ...message,
      content: apiContent,
      imageAttachments: []
    };
  }, [
    canShowDraftAgentAction,
    canShowDraftApiAction,
    draftModifyRequest,
    draftRequest,
    message,
    showDraftAgentFormat,
    showDraftApiFormat
  ]);

  React.useEffect(() => {
    if (showDraftAgentFormat && !canShowDraftAgentAction) {
      setDraftDisplayMode('text');
      return;
    }
    if (showDraftApiFormat && !canShowDraftApiAction) {
      setDraftDisplayMode('text');
    }
  }, [canShowDraftAgentAction, canShowDraftApiAction, showDraftAgentFormat, showDraftApiFormat]);

  React.useEffect(() => {
    if (!DEBUG_CHAT_LOADING || !isAssistant) return;
    // logger.info({
    //   role,
    //   messageId: message?.id || '',
    //   isLoading,
    //   contentLength: String(message?.content || '').length,
    //   hasError: Boolean(message?.error)
    // });
  }, [isAssistant, role, message, isLoading]);

  const handleCopy = async (event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    if (!onCopyAssistantMessage) return;
    try {
      await onCopyAssistantMessage(displayedMessage);
      antMessage.success('已复制');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      antMessage.error('复制失败');
    }
  };
  const handleConvertToApi = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('api');
  }, []);
  const handleConvertToAgent = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('agent');
  }, []);
  const handleConvertToText = React.useCallback((event) => {
    event.stopPropagation();
    event.currentTarget?.blur?.();
    setDraftDisplayMode('text');
  }, []);

  return (
    <div className={`chat-panel__message ${role}`}>
      <MessageHeader
        role={role}
        message={message}
        model={model}
        modelOptions={modelOptions}
        formatModelDisplayName={formatModelDisplayName}
        formatMessageTime={formatMessageTime}
        userName={userName}
        userAvatar={userAvatar}
      />
      <div className={`chat-panel__message-body ${isAssistant ? 'assistant' : 'user'}`}>
        <MessageContent message={displayedMessage} isLoading={isLoading} />
        {!isLoading && isAssistant && (
          <div className="chat-panel__message-actions">
            <Tooltip title="复制" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={handleCopy}
                disabled={actionsDisabled}>
                {copied ? <Check size={15} className="chat-panel__message-action-icon copied" /> : <Copy size={15} className="chat-panel__message-action-icon" />}
              </button>
            </Tooltip>
            <Tooltip title="重试" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryAssistantMessage && onRetryAssistantMessage(message);
                }}
                disabled={actionsDisabled}>
                <RefreshCw size={15} className="chat-panel__message-action-icon" />
              </button>
            </Tooltip>
            <Tooltip title="删除" mouseEnterDelay={1} styles={{ body: { fontSize: 12 } }}>
              <button
                type="button"
                className="chat-panel__message-action-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteAssistantMessage && onDeleteAssistantMessage(message);
                }}
                disabled={actionsDisabled}>
                <Trash2 size={15} className="chat-panel__message-action-icon" />
              </button>
            </Tooltip>
            <div className="chat-panel__message-tokens">
              {canUseLiveAssistantTokens ? (
                <Provider store={appStore}>
                  <LiveAssistantMessageTokens
                    fallbackMessage={message}
                    storeAssistantMessageId={storeAssistantMessageId}
                  />
                </Provider>
              ) : (
                <MessageTokens message={message} />
              )}
            </div>
          </div>
        )}
      </div>
      {!isLoading && isUser && (
        <div className="chat-panel__message-actions chat-panel__message-actions--user">
          {canShowDraftApiAction && showDraftApiFormat ? (
            <div className="chat-panel__message-api-tip">替换token为你的API KEY</div>
          ) : null}
          {canShowDraftAgentAction && showDraftAgentFormat ? (
            <div className="chat-panel__message-api-tip">复制到其他agent使用</div>
          ) : null}
          {(canShowDraftAgentAction || canShowDraftApiAction) ? (
            <>
              <Tooltip title="文字" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                <button
                  type="button"
                  className={`chat-panel__message-action-btn ${draftDisplayMode === 'text' ? 'is-active' : ''}`}
                  onClick={handleConvertToText}
                  disabled={actionsDisabled}>
                  <Type size={15} className="chat-panel__message-action-icon" />
                </button>
              </Tooltip>
              {canShowDraftAgentAction ? (
                <Tooltip title="Agent" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                  <button
                    type="button"
                    className={`chat-panel__message-action-btn ${showDraftAgentFormat ? 'is-active' : ''}`}
                    onClick={handleConvertToAgent}
                    disabled={actionsDisabled}>
                    <Bot size={15} className="chat-panel__message-action-icon" />
                  </button>
                </Tooltip>
              ) : null}
              {canShowDraftApiAction ? (
                <Tooltip title="API" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
                  <button
                    type="button"
                    className={`chat-panel__message-action-btn ${showDraftApiFormat ? 'is-active' : ''}`}
                    onClick={handleConvertToApi}
                    disabled={actionsDisabled}>
                    <Code size={15} className="chat-panel__message-action-icon" />
                  </button>
                </Tooltip>
              ) : null}
            </>
          ) : null}
          <Tooltip title="复制" mouseEnterDelay={0.8} styles={{ body: { fontSize: 12 } }}>
            <button
              type="button"
              className="chat-panel__message-action-btn"
              onClick={handleCopy}
              disabled={actionsDisabled}>
              {copied ? <Check size={15} className="chat-panel__message-action-icon copied" /> : <Copy size={15} className="chat-panel__message-action-icon" />}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const areModelOptionsEqual = (prevOptions = [], nextOptions = []) => {
  if (prevOptions === nextOptions) return true;
  if (!Array.isArray(prevOptions) || !Array.isArray(nextOptions)) return false;
  if (prevOptions.length !== nextOptions.length) return false;
  for (let i = 0; i < prevOptions.length; i += 1) {
    const prev = prevOptions[i];
    const next = nextOptions[i];
    if (typeof prev !== typeof next) return false;
    if (typeof prev === 'string') {
      if (prev !== next) return false;
      continue;
    }
    const prevValue = prev?.value || prev?.name || prev?.id || '';
    const nextValue = next?.value || next?.name || next?.id || '';
    const prevLabel = prev?.label || prev?.name || prev?.value || prev?.id || '';
    const nextLabel = next?.label || next?.name || next?.value || next?.id || '';
    const prevIcon = prev?.icon || prev?.iconUrl || prev?.black_icon || '';
    const nextIcon = next?.icon || next?.iconUrl || next?.black_icon || '';
    if (prevValue !== nextValue || prevLabel !== nextLabel || prevIcon !== nextIcon) {
      return false;
    }
  }
  return true;
};

export default React.memo(MessageItem, (prevProps, nextProps) => {
  const prevMessage = prevProps.message || {};
  const nextMessage = nextProps.message || {};
  const prevError = buildErrorSignature(prevMessage.error);
  const nextError = buildErrorSignature(nextMessage.error);
  const prevUsage = buildUsageSignature(prevMessage.usage);
  const nextUsage = buildUsageSignature(nextMessage.usage);
  const prevUsageSteps = buildUsageStepsSignature(prevMessage.usageSteps);
  const nextUsageSteps = buildUsageStepsSignature(nextMessage.usageSteps);
  const prevMetrics = buildMetricsSignature(prevMessage.metrics);
  const nextMetrics = buildMetricsSignature(nextMessage.metrics);
  return (
    prevProps.role === nextProps.role
    && prevProps.onCopyAssistantMessage === nextProps.onCopyAssistantMessage
    && prevProps.onRetryAssistantMessage === nextProps.onRetryAssistantMessage
    && prevProps.onDeleteAssistantMessage === nextProps.onDeleteAssistantMessage
    && prevProps.hasConnectedExternalAgent === nextProps.hasConnectedExternalAgent
    && prevProps.actionsDisabled === nextProps.actionsDisabled
    && prevProps.isLoading === nextProps.isLoading
    && prevProps.model === nextProps.model
    && areModelOptionsEqual(prevProps.modelOptions, nextProps.modelOptions)
    && prevProps.formatMessageTime === nextProps.formatMessageTime
    && prevProps.formatModelDisplayName === nextProps.formatModelDisplayName
    && prevProps.userName === nextProps.userName
    && prevProps.userAvatar === nextProps.userAvatar
    && prevMessage.id === nextMessage.id
    && prevMessage.content === nextMessage.content
    && prevMessage.role === nextMessage.role
    && prevMessage.createdAt === nextMessage.createdAt
    && prevMessage.updatedAt === nextMessage.updatedAt
    && prevUsage === nextUsage
    && prevUsageSteps === nextUsageSteps
    && prevMetrics === nextMetrics
    && buildImageAttachmentSignature(prevMessage.imageAttachments) === buildImageAttachmentSignature(nextMessage.imageAttachments)
    && buildDraftRequestSignature(prevMessage.draftRequest) === buildDraftRequestSignature(nextMessage.draftRequest)
    && buildDraftExportRequestSignature(prevMessage.draftExportRequest) === buildDraftExportRequestSignature(nextMessage.draftExportRequest)
    && buildDraftDownloadRequestSignature(prevMessage.draftDownloadRequest) === buildDraftDownloadRequestSignature(nextMessage.draftDownloadRequest)
    && buildDraftModifyRequestSignature(prevMessage.draftModifyRequest) === buildDraftModifyRequestSignature(nextMessage.draftModifyRequest)
    && buildDraftInspectRequestSignature(prevMessage.draftInspectRequest) === buildDraftInspectRequestSignature(nextMessage.draftInspectRequest)
    && prevError === nextError
  );
});
