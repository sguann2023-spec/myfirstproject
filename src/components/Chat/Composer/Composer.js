import React from 'react';
import { Select, Tooltip, Upload, message } from 'antd';
import { ArrowUp, CirclePause } from 'lucide-react';
import './Composer.css';
import { uploadToOSSWithProgress } from '../../../api/sts';
import ChatToolFileIcon from '../../../../public/chat_tool_file.svg';
import ChatModelsTipIcon from '../../../../public/chat_models_tip.svg';

const { shell } = window.require('electron');
const MAX_UPLOAD_FILE_SIZE = 500 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 5;

const Composer = ({
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
        setUploadedFileMeta((prev) => {
          const next = prev.filter((item) => item.uid !== uid);
          next.push({
            uid,
            url: result.publicUrl,
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

  const handleSendWithAttachments = () => {
    if (isSendDisabled) return;
    const text = String(input || '').trim();
    const combined = [text, ...uploadedMarkdownLinks].filter(Boolean).join('\n');
    if (!combined) return;
    handleSend && handleSend(combined);
    setUploadFileList([]);
    setUploadedFileMeta([]);
  };

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
              onChange={({ fileList }) => {
                const nextList = fileList.slice(-MAX_UPLOAD_COUNT);
                const uidSet = new Set(nextList.map((item) => item.uid));
                setUploadFileList(nextList);
                setUploadedFileMeta((prev) => prev.filter((item) => uidSet.has(item.uid)));
              }}
              disabled={sessionSending}
            >
              <img className="chat-panel__tool-icon" src={ChatToolFileIcon} alt="文件工具" />
            </Upload>
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
          <textarea
            ref={inputRef}
            className="chat-panel__input"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSendWithAttachments();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Composer;
