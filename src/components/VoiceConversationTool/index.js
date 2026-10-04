import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { Ribbon } from 'lucide-react';
import Point2Icon from '../../../public/point2.svg';
import './index.css';

export const VOICE_CONVERSION_SOURCE_SLOT_ID = 'voice_conversion_source';
export const VOICE_CONVERSION_VOICE_SLOT_ID = 'voice_conversion_voice_id';

const isAudioFileType = (fileType = '') => String(fileType || '').toLowerCase().startsWith('audio/');
const isVideoFileType = (fileType = '') => String(fileType || '').toLowerCase().startsWith('video/');

const resolveMediaSource = (file = {}) => {
  const directSource = String(file?.url || file?.sourcePath || '').trim();
  if (directSource) return directSource;
  const uid = String(file?.uid || '').trim();
  return uid ? `local-attachment:${uid}` : '';
};

export const buildVoiceConversionRequestParams = (uploadedFiles = []) => {
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const sourceFile = files.find((item) => String(item?.slotId || '').trim() === VOICE_CONVERSION_SOURCE_SLOT_ID);
  const voiceFile = files.find((item) => String(item?.slotId || '').trim() === VOICE_CONVERSION_VOICE_SLOT_ID);
  const source = resolveMediaSource(sourceFile);
  const voiceId = String(voiceFile?.voiceId || '').trim();
  if (!source || !voiceId) return null;

  return {
    ...(isVideoFileType(sourceFile?.fileType) ? { video_url: source } : { audio_url: source }),
    voice_id: voiceId,
  };
};

export const getVoiceConversionToolSendState = ({ uploadedFiles = [] } = {}) => {
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const sourceFile = files.find((item) => String(item?.slotId || '').trim() === VOICE_CONVERSION_SOURCE_SLOT_ID);
  const voiceFile = files.find((item) => String(item?.slotId || '').trim() === VOICE_CONVERSION_VOICE_SLOT_ID);
  const hasSource = Boolean(sourceFile && (isAudioFileType(sourceFile?.fileType) || isVideoFileType(sourceFile?.fileType)));
  const hasVoiceId = Boolean(String(voiceFile?.voiceId || '').trim());

  return {
    canSend: hasSource && hasVoiceId,
    disabledReason: !hasSource ? '请上传要变声的音频或视频' : !hasVoiceId ? '请选择音色 ID' : '',
  };
};

const VoiceConversationTool = ({ disabled = false, onBack, priceState = null }) => {
  const priceText = String(priceState?.text || '').trim();
  const priceTitle = String(priceState?.title || '').trim() || (priceText ? `预计消耗 ${priceText}` : '');

  return (
    <div className="chat-panel__tool-detail-area chat-panel__voice-conversion-detail" role="group" aria-label="变声工具">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="变声"
            title="变声"
            aria-pressed="true"
            onClick={onBack}
            disabled={disabled}
          >
            <Ribbon size={20} className="chat-panel__tool-icon chat-panel__voice-conversion-tool-icon" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">变声</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      {priceText ? (
        <div className="chat-panel__tool-detail-content chat-panel__voice-conversion-detail-content">
          <span className="chat-panel__voice-conversion-price" title={priceTitle}>
            <img className="chat-panel__voice-conversion-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
            <span className="chat-panel__voice-conversion-price-text">{priceText}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default VoiceConversationTool;
