import React from 'react';
import { Select, Tooltip, Upload, message } from 'antd';
import { ArrowUp, CirclePause } from 'lucide-react';
import './Composer.css';
import { uploadToOSSWithProgress } from '../../../api/sts';
import ChatToolFileIcon from '../../../../public/chat_tool_file.svg';
import ChatModelsTipIcon from '../../../../public/chat_models_tip.svg';
import ToolArea from './ToolArea/index';
import VoiceSquareToolDetail from './VoiceSquareToolDetail/index';

const { shell } = window.require('electron');
const MAX_UPLOAD_FILE_SIZE = 500 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 5;
const SKILL_MENTION_CLOSE_DELAY = 120;
const MENTION_TOKEN_BOUNDARY = '[\\s,.!?;:，。！？；：)]';

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripUrlSearch = (value) => String(value || '').split('?')[0].split('#')[0];

const Composer = ({
  agentId,
  runtimeSessionId,
  inputRef,
  input,
  setInput,
  handleSend,
  handleStop,
  sending = false,
  sessionSending = false,
  model,
  modelOptions = [],
  modelListLoading = false,
  onModelChange,
  formatModelDisplayName,
}) => {
  const [uploadFileList, setUploadFileList] = React.useState([]);
  const [uploadedFileMeta, setUploadedFileMeta] = React.useState([]);
  const [activeTool, setActiveTool] = React.useState(null);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  const [skillsError, setSkillsError] = React.useState('');
  const [skills, setSkills] = React.useState([]);
  const [mentionState, setMentionState] = React.useState({
    open: false,
    query: '',
    start: -1,
    end: -1,
    activeIndex: 0,
  });
  const mentionCloseTimerRef = React.useRef(null);
  const inputHighlightRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    let removeSkillsChangedListener = null;
    const loadSkills = async () => {
      const api = window?.electronAPI?.agentSkills;
      const cherryChatStream = window?.electronAPI?.cherryChatStream;
      if (!runtimeSessionId && !agentId) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('');
          setSkillsLoading(false);
        }
        return;
      }
      if (!api || typeof api.listActive !== 'function') {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('技能服务不可用');
          setSkillsLoading(false);
        }
        return;
      }

      setSkillsLoading(true);
      setSkillsError('');
      try {
        let result = null;
        if (
          runtimeSessionId &&
          cherryChatStream &&
          typeof cherryChatStream.getSession === 'function' &&
          typeof api.listLocal === 'function'
        ) {
          const sessionResult = await cherryChatStream.getSession(runtimeSessionId);
          const accessiblePaths = sessionResult?.ok ? sessionResult?.session?.accessible_paths : [];
          const workdir = accessiblePaths?.[1] || '';
          if (workdir) {
            result = await api.listLocal({ workdir });
          }
        }
        if (!result) {
          result = await api.listActive({ agentId });
        }
        if (cancelled) return;
        if (!result?.ok) {
          setSkills([]);
          setSkillsError(result?.error || '加载技能失败');
          return;
        }
        setSkills(Array.isArray(result.skills) ? result.skills : []);
      } catch (error) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError(error?.message || '加载技能失败');
        }
      } finally {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      }
    };
    loadSkills();
    const api = window?.electronAPI?.agentSkills;
    if (agentId && api && typeof api.onChanged === 'function') {
      void api.subscribeChanges({ agentId }).catch(() => {});
      removeSkillsChangedListener = api.onChanged((payload) => {
        if (payload?.agentId && payload.agentId !== agentId) return;
        void loadSkills();
      });
    }
    return () => {
      cancelled = true;
      if (typeof removeSkillsChangedListener === 'function') {
        removeSkillsChangedListener();
      }
      if (agentId && api && typeof api.unsubscribeChanges === 'function') {
        void api.unsubscribeChanges({ agentId }).catch(() => {});
      }
    };
  }, [agentId, runtimeSessionId]);

  React.useEffect(() => () => {
    if (mentionCloseTimerRef.current) {
      window.clearTimeout(mentionCloseTimerRef.current);
    }
  }, []);

  const closeMentionPanel = React.useCallback(() => {
    setMentionState((prev) => ({ ...prev, open: false, query: '', start: -1, end: -1, activeIndex: 0 }));
  }, []);

  const syncMentionState = React.useCallback((target) => {
    const value = String(target?.value || '');
    const cursor = target?.selectionStart ?? value.length;
    const prefix = value.slice(0, cursor);
    const mentionStart = prefix.lastIndexOf('@');

    if (mentionStart < 0) {
      closeMentionPanel();
      return;
    }

    const query = prefix.slice(mentionStart + 1);
    if (/[\s@]/.test(query)) {
      closeMentionPanel();
      return;
    }

    setMentionState((prev) => ({
      open: true,
      query,
      start: mentionStart,
      end: cursor,
      activeIndex: prev.open && prev.query === query ? prev.activeIndex : 0,
    }));
  }, [closeMentionPanel]);

  const filteredSkills = React.useMemo(() => {
    const query = String(mentionState.query || '').trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) => String(skill?.name || '').toLowerCase().startsWith(query));
  }, [mentionState.query, skills]);

  const mentionHighlightRegex = React.useMemo(() => {
    const escapedNames = skills
      .map((skill) => String(skill?.name || '').trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .map((name) => escapeRegExp(name));

    if (escapedNames.length === 0) return null;

    return new RegExp(`@(?:${escapedNames.join('|')})(?=$|${MENTION_TOKEN_BOUNDARY})`, 'gi');
  }, [skills]);

  React.useEffect(() => {
    if (!mentionState.open) return;
    if (filteredSkills.length === 0) {
      setMentionState((prev) => ({ ...prev, activeIndex: 0 }));
      return;
    }
    if (mentionState.activeIndex > filteredSkills.length - 1) {
      setMentionState((prev) => ({ ...prev, activeIndex: 0 }));
    }
  }, [filteredSkills.length, mentionState.activeIndex, mentionState.open]);

  const insertSkillMention = React.useCallback((skill) => {
    const mentionLabel = skill?.name || skill?.id;
    if (!mentionLabel || mentionState.start < 0 || mentionState.end < mentionState.start) return;

    const currentText = String(input || '');
    const replacement = `@${mentionLabel} `;
    const nextText = `${currentText.slice(0, mentionState.start)}${replacement}${currentText.slice(mentionState.end)}`;
    const nextCursor = mentionState.start + replacement.length;
    setInput(nextText);
    closeMentionPanel();

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [closeMentionPanel, input, inputRef, mentionState.end, mentionState.start, setInput]);

  const renderHighlightedInput = React.useCallback(() => {
    const text = String(input || '');
    if (!text) return null;
    if (!mentionHighlightRegex) return text;

    mentionHighlightRegex.lastIndex = 0;

    const nodes = [];
    let lastIndex = 0;
    let match = mentionHighlightRegex.exec(text);

    while (match) {
      const matchText = match[0];
      const matchIndex = match.index;

      if (matchIndex > lastIndex) {
        nodes.push(text.slice(lastIndex, matchIndex));
      }

      nodes.push(
        <span
          key={`${matchText}-${matchIndex}`}
          className="chat-panel__input-mention-token">
          {matchText}
        </span>
      );

      lastIndex = matchIndex + matchText.length;
      match = mentionHighlightRegex.exec(text);
    }

    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }

    return nodes;
  }, [input, mentionHighlightRegex]);

  const handleOpenPricingDoc = (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      shell.openExternal('https://docs.vectcut.com/7834799m0');
    } catch (error) {
      window.open('https://docs.vectcut.com/7834799m0', '_blank');
    }
  };

  const renderModelOptionLabel = (text, icon) => (
    <span className="chat-panel__model-option">
      {icon ? <img className="chat-panel__model-option-icon" src={icon} alt="" /> : null}
      <span>{text}</span>
    </span>
  );

  const availableModelOptions = (Array.isArray(modelOptions) ? modelOptions : [])
    .map((item) => {
      if (typeof item === 'string') {
        return {
          value: item,
          label: renderModelOptionLabel(formatModelDisplayName(item), null),
        };
      }
      const value = item?.value;
      const labelText = item?.label || item?.name || item?.value || item?.id || '';
      const icon = item?.icon || item?.iconUrl || item?.black_icon || '';
      return value ? {
        value,
        label: renderModelOptionLabel(formatModelDisplayName(labelText), icon),
      } : null;
    })
    .filter(Boolean);

  const groupedModelOptions = availableModelOptions.length > 0
    ? [
      {
        label: (
          <span className="chat-panel__model-group-title">
            <span>内置模型</span>
            <Tooltip
              placement="right"
              classNames={{ root: 'chat-panel__model-tip-overlay' }}
              title={(
                <span className="chat-panel__model-tip-text">
                  由 <span className="chat-panel__model-tip-brand">流光剪辑</span> 提供的模型列表，按
                  <button
                    type="button"
                    className="chat-panel__model-tip-link"
                    onClick={handleOpenPricingDoc}
                  >
                    token计费
                  </button>
                </span>
              )}
            >
              <img className="chat-panel__model-tip-icon" src={ChatModelsTipIcon} alt="模型计费说明" />
            </Tooltip>
          </span>
        ),
        title: '内置模型',
        options: availableModelOptions,
      },
    ]
    : [];
  const buildMarkdownFileLink = (name, url) => {
    const safeName = String(name || '附件')
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]');
    return `[${safeName}](${url})`;
  };
  const uploadedMarkdownLinks = uploadedFileMeta
    .filter((item) => item?.url)
    .map((item) => buildMarkdownFileLink(item.name, item.url));
  const hasUploadingFile = uploadFileList.some((item) => item?.status === 'uploading');
  const canSend = String(input || '').trim().length > 0 || uploadedMarkdownLinks.length > 0;
  const isSendDisabled = !canSend || modelListLoading || hasUploadingFile;

  const handleBeforeUpload = (file, batchFileList = []) => {
    const type = String(file?.type || '');
    const isAllowedType = type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/');
    if (!file || !isAllowedType) {
      message.error('仅支持上传图片、视频、音频文件');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_UPLOAD_FILE_SIZE) {
      message.error('单个文件大小不能超过 500MB，可去官网资产库上传更大文件');
      return Upload.LIST_IGNORE;
    }
    const currentCount = uploadFileList.filter((item) => item.status !== 'removed').length;
    const availableSlots = Math.max(0, MAX_UPLOAD_COUNT - currentCount);
    const batchIndex = batchFileList.findIndex((item) => item.uid === file.uid);
    if (availableSlots <= 0 || (batchIndex >= 0 && batchIndex >= availableSlots)) {
      message.error(`最多上传 ${MAX_UPLOAD_COUNT} 个文件`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const handleUploadListChange = React.useCallback((fileList) => {
    const nextList = fileList.slice(-MAX_UPLOAD_COUNT);
    const uidSet = new Set(nextList.map((item) => item.uid));
    setUploadFileList(nextList);
    setUploadedFileMeta((prev) => prev.filter((item) => uidSet.has(item.uid)));
  }, []);

  const handleFileUpload = async ({ file, onProgress, onSuccess, onError }) => {
    const targetFile = file instanceof File ? file : file?.originFileObj;
    const uid = file?.uid || targetFile?.uid || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    if (!targetFile) {
      const error = new Error('INVALID_FILE');
      onError && onError(error);
      return;
    }
    try {
      const result = await uploadToOSSWithProgress(targetFile, (event) => {
        onProgress && onProgress({ percent: Number(event?.percent || 0) }, targetFile);
      });
      onSuccess && onSuccess(result, targetFile);
      if (result?.publicUrl) {
        const normalizedUrl = stripUrlSearch(result.publicUrl);
        setUploadedFileMeta((prev) => {
          const next = prev.filter((item) => item.uid !== uid);
          next.push({
            uid,
            url: normalizedUrl,
            name: targetFile?.name || file?.name || '附件',
          });
          return next;
        });
      }
      message.success('文件上传成功');
    } catch (error) {
      onError && onError(error);
      message.error('文件上传失败');
    }
  };

  const queueFilesForUpload = React.useCallback((files = []) => {
    if (sessionSending) return;
    const fileList = files
      .filter((item) => item instanceof File)
      .map((file, index) => {
        const uid = file.uid || `paste_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`;
        return {
          requestFile: {
            uid,
            name: file.name,
            type: file.type,
            size: file.size,
            originFileObj: file,
          },
          uploadItem: {
            uid,
            name: file.name || '附件',
            type: file.type,
            size: file.size,
            originFileObj: file,
            status: 'uploading',
            percent: 0,
          },
        };
      });
    if (fileList.length === 0) return;

    const batchFileList = fileList.map((item) => item.requestFile);
    const acceptedFiles = fileList.filter((item) => handleBeforeUpload(item.requestFile, batchFileList) === true);
    if (acceptedFiles.length === 0) return;

    setUploadFileList((prev) => [...prev, ...acceptedFiles.map((item) => item.uploadItem)].slice(-MAX_UPLOAD_COUNT));

    acceptedFiles.forEach(({ requestFile }) => {
      handleFileUpload({
        file: requestFile,
        onProgress: ({ percent }) => {
          setUploadFileList((prev) => prev.map((item) => (
            item.uid === requestFile.uid
              ? { ...item, status: 'uploading', percent: Number(percent || 0) }
              : item
          )));
        },
        onSuccess: () => {
          setUploadFileList((prev) => prev.map((item) => (
            item.uid === requestFile.uid
              ? { ...item, status: 'done', percent: 100 }
              : item
          )));
        },
        onError: () => {
          setUploadFileList((prev) => prev.map((item) => (
            item.uid === requestFile.uid
              ? { ...item, status: 'error' }
              : item
          )));
        },
      });
    });
  }, [handleBeforeUpload, handleFileUpload, sessionSending]);

  const handleSendWithAttachments = () => {
    if (isSendDisabled) return;
    const text = String(input || '').trim();
    const combined = [text, ...uploadedMarkdownLinks].filter(Boolean).join('\n');
    if (!combined) return;
    closeMentionPanel();
    handleSend && handleSend(combined);
    setUploadFileList([]);
    setUploadedFileMeta([]);
  };

  const handleToolSelect = React.useCallback((toolId) => {
    setActiveTool(toolId);
  }, []);

  const handleToolDetailBack = React.useCallback(() => {
    setActiveTool(null);
  }, []);

  return (
    <div className="chat-panel__composer">
      <div className="chat-panel__editor">
        {uploadFileList.length > 0 ? (
          <Upload
            className="chat-panel__upload-list chat-panel__upload-list--top"
            fileList={uploadFileList}
            showUploadList={{
              showPreviewIcon: false,
              showDownloadIcon: false,
              showRemoveIcon: true,
            }}
            onRemove={(file) => {
              setUploadFileList((prev) => prev.filter((item) => item.uid !== file.uid));
              setUploadedFileMeta((prev) => prev.filter((item) => item.uid !== file.uid));
              return true;
            }}
            openFileDialogOnClick={false}
          >
            <span />
          </Upload>
        ) : null}
        <div className="chat-panel__tool-bar">
          <div className="chat-panel__tool-left">
            <Upload
              accept="image/*,video/*,audio/*"
              multiple
              beforeUpload={handleBeforeUpload}
              customRequest={handleFileUpload}
              showUploadList={false}
              fileList={uploadFileList}
              onChange={({ fileList }) => handleUploadListChange(fileList)}
              disabled={sessionSending}
            >
              <span
                className="chat-panel__tool-button chat-panel__tool-button--icon-only"
                aria-label="上传文件"
                title="上传文件"
                role="button"
              >
                <img className="chat-panel__tool-icon" src={ChatToolFileIcon} alt="" aria-hidden="true" />
              </span>
            </Upload>
            <span className="chat-panel__tool-divider" aria-hidden="true" />
            {activeTool === 'voice-square' ? (
              <VoiceSquareToolDetail
                disabled={sessionSending}
                onBack={handleToolDetailBack}
              />
            ) : (
              <ToolArea
                disabled={sessionSending}
                onSelect={handleToolSelect}
              />
            )}
          </div>
          <div className="chat-panel__tool-right">
            <Select
              size="small"
              variant="borderless"
              className="chat-panel__model-picker"
              value={model}
              options={groupedModelOptions}
              loading={modelListLoading}
              onChange={(value) => onModelChange && onModelChange(value)}
              disabled={sessionSending || modelListLoading || availableModelOptions.length === 0}
              popupMatchSelectWidth={false}
              getPopupContainer={(trigger) => trigger.parentElement}
            />
            <button
              type="button"
              className={`chat-panel__send-btn ${isSendDisabled && !sessionSending ? 'disabled' : ''} ${sessionSending ? 'stopping' : ''}`}
              onClick={() => {
                if (sessionSending) {
                  handleStop && handleStop();
                  return;
                }
                if (!isSendDisabled) handleSendWithAttachments();
              }}
              aria-label={sessionSending ? '停止生成' : '发送消息'}
              aria-disabled={sessionSending ? false : isSendDisabled}
              disabled={sessionSending ? false : isSendDisabled}
            >
              {sessionSending ? <CirclePause className="chat-panel__send-icon stop" /> : <ArrowUp className="chat-panel__send-icon" />}
            </button>
          </div>
        </div>
        <div className="chat-panel__input-wrap">
          {mentionState.open && (skillsLoading || skillsError || filteredSkills.length > 0) ? (
            <div className="chat-panel__skill-mention-panel">
              <div className="chat-panel__skill-mention-list">
                {skillsLoading ? <div className="chat-panel__skill-mention-empty">加载技能中...</div> : null}
                {!skillsLoading && skillsError ? (
                  <div className="chat-panel__skill-mention-empty">{skillsError}</div>
                ) : null}
                {!skillsLoading && !skillsError && filteredSkills.map((skill, index) => {
                  const label = skill?.name || '';
                  const isActive = index === mentionState.activeIndex;
                  return (
                    <button
                      key={skill.id || skill.name}
                      type="button"
                      className={`chat-panel__skill-mention-item ${isActive ? 'active' : ''}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertSkillMention(skill);
                      }}
                    >
                      <span className="chat-panel__skill-mention-name">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="chat-panel__input-editor">
            <div
              ref={inputHighlightRef}
              aria-hidden="true"
              className="chat-panel__input-highlights">
              {renderHighlightedInput()}
            </div>
            <textarea
              ref={inputRef}
              className="chat-panel__input chat-panel__input--overlay"
              placeholder="@技能成员，输入消息，Enter 发送，Shift+Enter 换行"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                syncMentionState(event.target);
              }}
              onScroll={(event) => {
                if (inputHighlightRef.current) {
                  inputHighlightRef.current.scrollTop = event.target.scrollTop;
                  inputHighlightRef.current.scrollLeft = event.target.scrollLeft;
                }
              }}
              onClick={(event) => syncMentionState(event.target)}
              onPaste={(event) => {
                const clipboardItems = Array.from(event.clipboardData?.items || []);
                const files = clipboardItems
                  .filter((item) => item.kind === 'file')
                  .map((item) => item.getAsFile())
                  .filter(Boolean);
                const fallbackFiles = Array.from(event.clipboardData?.files || []).filter(Boolean);
                const pastedFiles = files.length > 0 ? files : fallbackFiles;
                if (pastedFiles.length === 0) return;
                event.preventDefault();
                queueFilesForUpload(pastedFiles);
              }}
              onKeyUp={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') {
                  syncMentionState(event.target);
                }
              }}
              onBlur={() => {
                mentionCloseTimerRef.current = window.setTimeout(() => {
                  closeMentionPanel();
                }, SKILL_MENTION_CLOSE_DELAY);
              }}
              onFocus={(event) => {
                if (mentionCloseTimerRef.current) {
                  window.clearTimeout(mentionCloseTimerRef.current);
                }
                syncMentionState(event.target);
              }}
              onKeyDown={(event) => {
                if (mentionState.open) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setMentionState((prev) => ({
                      ...prev,
                      activeIndex: filteredSkills.length > 0 ? (prev.activeIndex + 1) % filteredSkills.length : 0,
                    }));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setMentionState((prev) => ({
                      ...prev,
                      activeIndex: filteredSkills.length > 0
                        ? (prev.activeIndex - 1 + filteredSkills.length) % filteredSkills.length
                        : 0,
                    }));
                    return;
                  }
                  if ((event.key === 'Enter' || event.key === 'Tab') && filteredSkills.length > 0) {
                    event.preventDefault();
                    insertSkillMention(filteredSkills[mentionState.activeIndex] || filteredSkills[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMentionPanel();
                    return;
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSendWithAttachments();
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Composer;
