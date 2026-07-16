import React from 'react';
import { createPortal } from 'react-dom';
import {
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  LoadingOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  RedoOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Input, Select, Tooltip, message } from 'antd';
import SiriWave from 'siriwave';
import { loggerService } from '@logger';
import { IpcChannel } from '../../../../packages/shared/IpcChannel';
import { uploadToOSSWithProgress } from '../../../../api/sts';
import {
  cloneTtsVoiceWithElevenlabs,
  cloneTtsVoiceWithFish,
  cloneTtsVoiceWithMinimax,
  getTtsClonePrice,
  updateMyVoiceProfile,
} from '../../../../api/tts';
import { tokenStore } from '../../../../auth';
import { electronStore } from '../../../../shared/electronStore';
import { MEMBER_COLOR } from '../../../../constants/member';
import './index.css';
import Point3Icon from '../../../../../public/point3.svg';
import VoiceCloneActionIcon from '../../../../../public/voice_clone_icon.svg';
import VoiceCloneRecordBlackIcon from '../../../../../public/voice_clone_record_black.svg';
import VoiceCloneRecordIcon from '../../../../../public/voice_clone_record.svg';
import VoiceCloneUploadIcon from '../../../../../public/voice_clone_upload.svg';
import VoiceCloneIcon from '../../../../../public/voice_clone.svg';
import VoiceSelectedIcon from '../../../../../public/voice_selected.svg';
import VoiceLib, { VOICE_TAB_MY, useVoiceLib } from '../VoiceLib';

const logger = loggerService.withContext('VoiceSquareToolDetail');
const REDEEM_PAYMENT_URL = 'https://www.vectcut.com/redeem/payment';
const VOICE_CLONE_AUDIO_ACCEPT = '.wav,.mp3,.m4a,.aac,.ogg,.pcm';
const VOICE_CLONE_MIN_RECORD_SECONDS = 10;
const VOICE_CLONE_MAX_RECORD_SECONDS = 60;
const VOICE_CLONE_MIN_UPLOAD_SECONDS = 10;
const VOICE_CLONE_MAX_UPLOAD_SECONDS = 90;
const VOICE_CLONE_MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const VOICE_CLONE_SCRIPT =
  '贝加尔湖是世界上最古老、最深的淡水湖泊，位于俄罗斯西伯利亚地区，湖水极其清澈透明，是世界上最纯净的湖泊之一。';
const VOICE_CLONE_RECOMMENDED_AVATARS = Array.from(
  { length: 10 },
  (_, index) => `https://player.install-ai-guider.top/example/voice/avatar/avatar${index + 1}.png`
);
const VOICE_CLONE_PROVIDER_OPTIONS = [
  { label: 'fish', value: 'fish' },
  { label: 'minimax', value: 'minimax' },
  {
    label: (
      <span className="chat-panel__clone-provider-option-member" style={{ color: MEMBER_COLOR }}>
        elevenlabs(会员)
      </span>
    ),
    value: 'elevenlabs',
  },
];
const ELEVENLABS_MEMBERSHIP_LEVEL_TEXT_MAP = {
  none: '免费会员',
  basic: '基础会员',
  medium: '标准会员',
  high: '高级会员',
};

const toNullableNumber = (value) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
};

const buildCloneBillingState = (provider, payload = {}) => {
  const normalizedProvider = String(provider || payload?.provider || '').trim().toLowerCase();
  const billingMode =
    String(payload?.billing_mode || '').trim().toLowerCase() ||
    (normalizedProvider === 'elevenlabs' ? 'membership_slots' : 'points');
  const membershipLevel = String(payload?.membership_level || '').trim().toLowerCase() || null;
  const slotLimit = toNullableNumber(payload?.slot_limit);
  const usedSlots = toNullableNumber(payload?.used_slots);
  const remainingSlots = toNullableNumber(payload?.remaining_slots);
  const usageText = String(payload?.usage_text || '').trim();
  const priceText = String(payload?.price_text || '').trim();
  let text = priceText || '--/次';

  if (billingMode === 'membership_slots' || normalizedProvider === 'elevenlabs') {
    if (usageText) {
      text = usageText;
    } else if (usedSlots !== null && remainingSlots !== null && ((slotLimit || 0) > 0 || usedSlots > 0)) {
      text = `已用${usedSlots}/剩余${remainingSlots}`;
    } else if ((slotLimit || 0) <= 0) {
      text =
        membershipLevel && membershipLevel !== 'none'
          ? `${ELEVENLABS_MEMBERSHIP_LEVEL_TEXT_MAP[membershipLevel] || '当前会员'}不可用`
          : '会员专享';
    } else {
      text = '会员槽位';
    }
  }

  return {
    provider: normalizedProvider,
    billingMode,
    membershipLevel,
    slotLimit,
    usedSlots,
    remainingSlots,
    text,
  };
};

const stripUrlQuery = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const [base] = raw.split('?');
  return base || raw;
};

const pickRandomCloneAvatar = () =>
  VOICE_CLONE_RECOMMENDED_AVATARS[Math.floor(Math.random() * VOICE_CLONE_RECOMMENDED_AVATARS.length)];

const VoiceSquareToolDetail = ({
  disabled = false,
  onBack,
  children = null,
  onSelectedVoiceChange = null,
  onVoiceCloneUpload = null,
  onVoiceCloneRecord = null,
}) => {
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';
  const cloneWaveContainerRef = React.useRef(null);
  const cloneWaveRef = React.useRef(null);
  const cloneUploadInputRef = React.useRef(null);
  const cloneAudioRef = React.useRef(null);
  const cloneDialogRef = React.useRef(null);
  const cloneRandomPulseTimerRef = React.useRef(0);
  const cloneWaveDriveFrameRef = React.useRef(0);
  const cloneMediaRecorderRef = React.useRef(null);
  const cloneMediaStreamRef = React.useRef(null);
  const cloneMediaChunksRef = React.useRef([]);
  const cloneAudioContextRef = React.useRef(null);
  const cloneAnalyserRef = React.useRef(null);
  const cloneTimerRef = React.useRef(0);
  const cloneAutoStopTriggeredRef = React.useRef(false);
  const cloneCancelEditNameRef = React.useRef(false);
  const voiceLib = useVoiceLib({ onSelectedVoiceChange });
  const [activeDetailTool, setActiveDetailTool] = React.useState(null);
  const [voiceCloneDialogOpen, setVoiceCloneDialogOpen] = React.useState(false);
  const [cloneRecordingActive, setCloneRecordingActive] = React.useState(false);
  const [cloneRecordSeconds, setCloneRecordSeconds] = React.useState(0);
  const [cloneSelectedFile, setCloneSelectedFile] = React.useState(null);
  const [cloneUploading, setCloneUploading] = React.useState(false);
  const [cloneIsPlaying, setCloneIsPlaying] = React.useState(false);
  const [cloneAudioCurrentSec, setCloneAudioCurrentSec] = React.useState(0);
  const [cloneAudioDurationSec, setCloneAudioDurationSec] = React.useState(0);
  const [cloneProvider, setCloneProvider] = React.useState('fish');
  const [cloningVoice, setCloningVoice] = React.useState(false);
  const [cloneSuccess, setCloneSuccess] = React.useState(false);
  const [clonedVoiceItem, setClonedVoiceItem] = React.useState(null);
  const [clonePriceLoading, setClonePriceLoading] = React.useState(false);
  const [cloneBillingState, setCloneBillingState] = React.useState(() => buildCloneBillingState('fish'));
  const [cloneEditingName, setCloneEditingName] = React.useState(false);
  const [cloneEditNameValue, setCloneEditNameValue] = React.useState('');
  const [cloneProfileSaving, setCloneProfileSaving] = React.useState(false);
  const [cloneAvatarDropdownOpen, setCloneAvatarDropdownOpen] = React.useState(false);

  const cloneUploadDone = cloneSelectedFile?.status === 'done';
  const cloneSelectedSourceUrl = cloneSelectedFile?.sourceUrl || cloneSelectedFile?.url || '';
  const cloneWaveVisible = voiceCloneDialogOpen && (cloneRecordingActive || !cloneUploadDone);
  const showCloneMembershipCta = cloneProvider === 'elevenlabs';
  const cloneSubmitDisabled =
    cloneUploading ||
    (cloneBillingState.billingMode === 'membership_slots' &&
      (cloneBillingState.slotLimit === 0 || cloneBillingState.remainingSlots === 0));
  const refreshCloneBillingState = React.useCallback(
    async (provider) => {
      const normalizedProvider = String(provider || '').trim().toLowerCase();
      if (!normalizedProvider) return;
      setClonePriceLoading(true);
      setCloneBillingState(buildCloneBillingState(normalizedProvider));
      try {
        const result = await getTtsClonePrice({ provider: normalizedProvider });
        setCloneBillingState(buildCloneBillingState(normalizedProvider, result));
      } catch (error) {
        setCloneBillingState(buildCloneBillingState(normalizedProvider));
      } finally {
        setClonePriceLoading(false);
      }
    },
    []
  );
  const clonePlayTimeText = React.useMemo(() => {
    const formatAudioTime = (seconds) => {
      const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
      const mm = String(Math.floor(safe / 60)).padStart(2, '0');
      const ss = String(safe % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    };

    return `${formatAudioTime(cloneAudioCurrentSec)} / ${formatAudioTime(cloneAudioDurationSec)}`;
  }, [cloneAudioCurrentSec, cloneAudioDurationSec]);

  const handleVoiceLibraryOpenChange = React.useCallback((open) => {
    setActiveDetailTool((prev) => {
      if (open) return 'voice-lib';
      return prev === 'voice-lib' ? null : prev;
    });
  }, []);

  const handleVoiceCloneDialogClose = React.useCallback(() => {
    setVoiceCloneDialogOpen(false);
    setActiveDetailTool((prev) => (prev === 'voice-clone' ? null : prev));
  }, []);

  const handleVoiceCloneDialogOpen = React.useCallback(() => {
    setVoiceCloneDialogOpen(true);
    setActiveDetailTool('voice-clone');
  }, []);

  const stopClonePlayback = React.useCallback(() => {
    const audio = cloneAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCloneIsPlaying(false);
    setCloneAudioCurrentSec(0);
  }, []);

  const handleVoiceCloneUploadClick = React.useCallback(() => {
    cloneUploadInputRef.current?.click();
  }, []);

  const getCloneDialogPopupContainer = React.useCallback(
    (trigger) => cloneDialogRef.current || trigger?.parentElement || document.body,
    []
  );

  const getCloneAudioDurationFromFile = React.useCallback(async (file) => {
    const objectUrl = URL.createObjectURL(file);
    try {
      const duration = await new Promise((resolve, reject) => {
        const probe = document.createElement('audio');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => {
          resolve(Number.isFinite(probe.duration) ? Number(probe.duration) : 0);
        };
        probe.onerror = () => reject(new Error('audio metadata parse failed'));
        probe.src = objectUrl;
      });
      return duration;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, []);

  const createBrowserAudioContext = React.useCallback(() => {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) {
      throw new Error('AudioContext is not supported');
    }
    return new AudioContextCtor();
  }, []);

  const interleaveCloneAudioChannels = React.useCallback((audioBuffer) => {
    const channelCount = audioBuffer.numberOfChannels;
    if (channelCount <= 1) return audioBuffer.getChannelData(0);

    const length = audioBuffer.length * channelCount;
    const result = new Float32Array(length);
    let offset = 0;

    for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        result[offset] = audioBuffer.getChannelData(channelIndex)[sampleIndex];
        offset += 1;
      }
    }

    return result;
  }, []);

  const encodeCloneAudioBufferToWav = React.useCallback(
    (audioBuffer) => {
      const channelCount = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const interleaved = interleaveCloneAudioChannels(audioBuffer);
      const bytesPerSample = 2;
      const blockAlign = channelCount * bytesPerSample;
      const buffer = new ArrayBuffer(44 + interleaved.length * bytesPerSample);
      const view = new DataView(buffer);

      const writeString = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + interleaved.length * bytesPerSample, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channelCount, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, interleaved.length * bytesPerSample, true);

      let offset = 44;
      for (let index = 0; index < interleaved.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, interleaved[index]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
      }

      return new Blob([buffer], { type: 'audio/wav' });
    },
    [interleaveCloneAudioChannels]
  );

  const convertRecordedBlobToWavFile = React.useCallback(
    async (recordedBlob) => {
      const decodeContext = createBrowserAudioContext();
      try {
        const arrayBuffer = await recordedBlob.arrayBuffer();
        const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
        const wavBlob = encodeCloneAudioBufferToWav(audioBuffer);
        return new File([wavBlob], 'MyRecordVoice.wav', { type: 'audio/wav' });
      } finally {
        await decodeContext.close();
      }
    },
    [createBrowserAudioContext, encodeCloneAudioBufferToWav]
  );

  const resetCloneResultState = React.useCallback(() => {
    setCloneSuccess(false);
    setClonedVoiceItem(null);
  }, []);

  const resetCloneDialogState = React.useCallback((fileUrlToRevoke = '') => {
    if (fileUrlToRevoke && String(fileUrlToRevoke).startsWith('blob:')) {
      URL.revokeObjectURL(fileUrlToRevoke);
    }

    cloneAutoStopTriggeredRef.current = false;
    if (cloneUploadInputRef.current) {
      cloneUploadInputRef.current.value = '';
    }

    setCloneRecordingActive(false);
    setCloneRecordSeconds(0);
    setCloneSelectedFile(null);
    setCloneUploading(false);
    setCloneIsPlaying(false);
    setCloneAudioCurrentSec(0);
    setCloneAudioDurationSec(0);
    setCloneProvider('fish');
    setCloneBillingState(buildCloneBillingState('fish'));
    setCloningVoice(false);
    setCloneSuccess(false);
    setClonedVoiceItem(null);
  }, []);

  const handleVoiceCloneUploadChange = React.useCallback(
    async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      event.target.value = '';

      if (file.size > VOICE_CLONE_MAX_UPLOAD_SIZE) {
        message.error('上传音频需小于等于10MB');
        return;
      }

      const normalizedType = String(file.type || '').toLowerCase();
      const normalizedName = String(file.name || '').toLowerCase();
      const isAudioFile =
        normalizedType.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|pcm)$/i.test(normalizedName);
      if (!isAudioFile) {
        message.error('请上传音频文件');
        return;
      }

      try {
        const durationSec = await getCloneAudioDurationFromFile(file);
        if (durationSec < VOICE_CLONE_MIN_UPLOAD_SECONDS || durationSec > VOICE_CLONE_MAX_UPLOAD_SECONDS) {
          message.error('上传音频时长需在10秒到90秒之间');
          return;
        }
      } catch (error) {
        message.error('无法读取音频时长，请更换文件重试');
        return;
      }

      stopClonePlayback();
      resetCloneResultState();
      setCloneUploading(true);
      setCloneSelectedFile({
        name: file.name,
        size: file.size,
        type: file.type || 'audio',
        status: 'uploading',
        percent: 0,
        objectKey: '',
        url: '',
        sourceUrl: '',
      });

      try {
        const uploaded = await uploadToOSSWithProgress(file, ({ percent }) => {
          setCloneSelectedFile((prev) => (prev ? { ...prev, percent: Number(percent || 0) } : prev));
        });

        setCloneSelectedFile((prev) =>
          prev
            ? {
                ...prev,
                status: 'done',
                percent: 100,
                objectKey: uploaded?.objectKey || '',
                url: uploaded?.publicUrl || '',
                sourceUrl: uploaded?.publicUrl || '',
              }
            : prev
        );
        message.success('音频上传成功');
        onVoiceCloneUpload?.(file);
      } catch (error) {
        setCloneSelectedFile(null);
        message.error('音频上传失败');
      } finally {
        setCloneUploading(false);
      }
    },
    [
      getCloneAudioDurationFromFile,
      onVoiceCloneUpload,
      resetCloneResultState,
      stopClonePlayback,
    ]
  );

  const stopCloneStreamAndContext = React.useCallback(async () => {
    if (cloneMediaStreamRef.current) {
      cloneMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      cloneMediaStreamRef.current = null;
    }
    if (cloneAudioContextRef.current) {
      await cloneAudioContextRef.current.close();
      cloneAudioContextRef.current = null;
    }
    cloneAnalyserRef.current = null;
  }, []);

  const stopCloneRecord = React.useCallback(
    async ({ keepResult = true } = {}) => {
      const recorder = cloneMediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        setCloneRecordingActive(false);
        await stopCloneStreamAndContext();
        return;
      }

      setCloneRecordingActive(false);
      await new Promise((resolve) => {
        recorder.onstop = async () => {
          await stopCloneStreamAndContext();
          const recordedMimeType = recorder.mimeType || 'audio/webm';
          const recordedBlob = new Blob(cloneMediaChunksRef.current, { type: recordedMimeType });
          cloneMediaChunksRef.current = [];
          cloneMediaRecorderRef.current = null;

          if (!keepResult) {
            resetCloneResultState();
            resolve();
            return;
          }

          resetCloneResultState();
          let displayFile = null;
          try {
            displayFile = await convertRecordedBlobToWavFile(recordedBlob);
          } catch (error) {
            message.error('录音转换为 WAV 失败，请重试');
            resolve();
            return;
          }

          stopClonePlayback();
          const localUrl = URL.createObjectURL(displayFile);
          setCloneSelectedFile({
            name: displayFile.name,
            size: displayFile.size,
            type: displayFile.type || 'audio/wav',
            status: 'done',
            percent: 100,
            objectKey: '',
            url: localUrl,
            sourceUrl: '',
          });
          setCloneUploading(true);

          try {
            const uploaded = await uploadToOSSWithProgress(displayFile, ({ percent }) => {
              setCloneSelectedFile((prev) => (prev ? { ...prev, percent: Number(percent || 0) } : prev));
            });
            setCloneSelectedFile((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'done',
                    percent: 100,
                    objectKey: uploaded?.objectKey || '',
                    sourceUrl: uploaded?.publicUrl || prev.sourceUrl || '',
                  }
                : prev
            );
          } catch (error) {
            message.warning('录音已生成，上传失败，可重新上传后再复刻');
          } finally {
            setCloneUploading(false);
            resolve();
          }
        };
        recorder.stop();
      });
    },
    [
      convertRecordedBlobToWavFile,
      resetCloneResultState,
      stopClonePlayback,
      stopCloneStreamAndContext,
    ]
  );

  const handleVoiceCloneRecordClick = React.useCallback(async () => {
    try {
      cloneAutoStopTriggeredRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const context = createBrowserAudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      cloneMediaChunksRef.current = [];
      recorder.ondataavailable = (recordEvent) => {
        if (recordEvent.data && recordEvent.data.size > 0) {
          cloneMediaChunksRef.current.push(recordEvent.data);
        }
      };

      cloneMediaRecorderRef.current = recorder;
      cloneMediaStreamRef.current = stream;
      cloneAudioContextRef.current = context;
      cloneAnalyserRef.current = analyser;
      stopClonePlayback();
      setCloneRecordSeconds(0);
      setCloneRecordingActive(true);
      recorder.start(200);
      onVoiceCloneRecord?.();
    } catch (error) {
      message.error('无法使用麦克风，请检查权限');
    }
  }, [createBrowserAudioContext, onVoiceCloneRecord, stopClonePlayback]);

  const handleCloneAudioTogglePlay = React.useCallback(async () => {
    const audio = cloneAudioRef.current;
    if (!audio || !cloneSelectedFile?.url) {
      message.warning('当前音频暂不可播放');
      return;
    }

    if (cloneIsPlaying) {
      audio.pause();
      setCloneIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setCloneIsPlaying(true);
    } catch (error) {
      setCloneIsPlaying(false);
      message.error('播放失败');
    }
  }, [cloneIsPlaying, cloneSelectedFile]);

  const handleCloneAudioDelete = React.useCallback(() => {
    stopClonePlayback();
    setCloneSelectedFile(null);
    resetCloneResultState();
  }, [resetCloneResultState, stopClonePlayback]);

  const handleCloneAudioReRecord = React.useCallback(() => {
    handleCloneAudioDelete();
    void handleVoiceCloneRecordClick();
  }, [handleCloneAudioDelete, handleVoiceCloneRecordClick]);

  const handleUseClonedVoice = React.useCallback(() => {
    const normalizedId = String(clonedVoiceItem?.global_voice_id || '').trim();
    if (!normalizedId) return;

    voiceLib.upsertMyVoiceItem(clonedVoiceItem);
    voiceLib.setSelectedVoiceLibraryId(normalizedId, clonedVoiceItem, VOICE_TAB_MY);
    voiceLib.setActiveVoiceTab(VOICE_TAB_MY);
    handleVoiceCloneDialogClose();
    message.success('已切换为新复刻音色');
  }, [clonedVoiceItem, handleVoiceCloneDialogClose, voiceLib]);

  const saveClonedVoiceProfile = React.useCallback(
    async (patch = {}, successMessageText = '') => {
      const provider = String(clonedVoiceItem?.provider || clonedVoiceItem?.providers || '').trim();
      const globalVoiceId = String(clonedVoiceItem?.global_voice_id || '').trim();

      if (!provider || !globalVoiceId) {
        message.error('缺少音色信息，暂时无法编辑');
        return false;
      }

      const payload = {
        provider,
        global_voice_id: globalVoiceId,
        title: String(patch?.title ?? clonedVoiceItem?.title ?? '').trim(),
        avatar_url: String(patch?.avatar_url || clonedVoiceItem?.avatar_url || pickRandomCloneAvatar()).trim(),
        voice_persona_desc: String(patch?.voice_persona_desc ?? clonedVoiceItem?.voice_persona_desc ?? '').trim(),
      };

      if (!payload.title) {
        message.warning('请输入音色名称');
        return false;
      }

      setCloneProfileSaving(true);
      try {
        const response = await updateMyVoiceProfile(payload);
        if (!response?.success) {
          message.error('音色信息更新失败');
          return false;
        }

        const nextVoiceItem = { ...(clonedVoiceItem || {}), ...payload };
        setClonedVoiceItem(nextVoiceItem);
        voiceLib.upsertMyVoiceItem(nextVoiceItem);

        if (successMessageText) {
          message.success(successMessageText);
        }
        return true;
      } catch (error) {
        message.error('音色信息更新失败');
        return false;
      } finally {
        setCloneProfileSaving(false);
      }
    },
    [clonedVoiceItem, voiceLib]
  );

  const handleCloneEditNameStart = React.useCallback(() => {
    setCloneEditNameValue(String(clonedVoiceItem?.title || '').trim());
    cloneCancelEditNameRef.current = false;
    setCloneEditingName(true);
  }, [clonedVoiceItem]);

  const handleCloneEditNameSave = React.useCallback(async () => {
    const nextTitle = String(cloneEditNameValue || '').trim();

    if (!nextTitle) {
      message.warning('请输入音色名称');
      return;
    }

    const saved = await saveClonedVoiceProfile({ title: nextTitle }, '音色名称已更新');
    if (saved) {
      setCloneEditingName(false);
    }
  }, [cloneEditNameValue, saveClonedVoiceProfile]);

  const handleCloneAvatarSelect = React.useCallback(
    async ({ key }) => {
      const nextAvatarUrl = String(key || '').trim();
      setCloneAvatarDropdownOpen(false);
      if (!nextAvatarUrl || nextAvatarUrl === clonedVoiceItem?.avatar_url) return;
      await saveClonedVoiceProfile({ avatar_url: nextAvatarUrl }, '头像已更新');
    },
    [clonedVoiceItem, saveClonedVoiceProfile]
  );

  const cloneAvatarMenu = React.useMemo(
    () => ({
      selectable: true,
      selectedKeys: clonedVoiceItem?.avatar_url ? [clonedVoiceItem.avatar_url] : [],
      items: VOICE_CLONE_RECOMMENDED_AVATARS.map((url, index) => ({
        key: url,
        label: (
          <span className="chat-panel__clone-avatar-option">
            <img className="chat-panel__clone-avatar-option-img" src={url} alt="" aria-hidden="true" />
            <span>头像 {index + 1}</span>
          </span>
        ),
      })),
      onClick: handleCloneAvatarSelect,
    }),
    [clonedVoiceItem, handleCloneAvatarSelect]
  );

  const handleFinishCloneRecord = React.useCallback(() => {
    if (cloneRecordSeconds < VOICE_CLONE_MIN_RECORD_SECONDS) {
      message.error('录制时长需在10秒到60秒之间');
      void stopCloneRecord({ keepResult: false });
      return;
    }
    if (cloneRecordSeconds > VOICE_CLONE_MAX_RECORD_SECONDS) {
      message.error('录制时长超过60秒，已停止并返回上传页');
      void stopCloneRecord({ keepResult: false });
      return;
    }
    void stopCloneRecord({ keepResult: true });
  }, [cloneRecordSeconds, stopCloneRecord]);

  const handleCloneVoiceSubmit = React.useCallback(async () => {
    if (!cloneSelectedSourceUrl) {
      message.warning('请先上传可用音频后再复刻');
      return;
    }
    if (String(cloneSelectedSourceUrl).startsWith('blob:')) {
      message.warning('录音上传中，请稍后再试');
      return;
    }

    const payload = {
      file_url: stripUrlQuery(cloneSelectedSourceUrl),
      title: cloneSelectedFile?.name || undefined,
    };

    setCloningVoice(true);
    try {
      const response =
        cloneProvider === 'minimax'
          ? await cloneTtsVoiceWithMinimax(payload)
          : cloneProvider === 'elevenlabs'
            ? await cloneTtsVoiceWithElevenlabs(payload)
            : await cloneTtsVoiceWithFish(payload);

      if (!response?.success) {
        message.error('复刻失败，请稍后重试');
        return;
      }

      if (cloneProvider === 'elevenlabs') {
        setCloneBillingState(buildCloneBillingState(cloneProvider, response));
      }

      const voiceId = String(response?.voice_id || response?.item?.global_voice_id || '').trim();
      const randomAvatarUrl = pickRandomCloneAvatar();
      const nextVoiceItem = {
        provider: cloneProvider,
        providers: cloneProvider,
        voice_id: voiceId,
        global_voice_id: voiceId || `tmp_${Date.now()}`,
        title: cloneSelectedFile?.name || '我的复刻音色',
        avatar_url: randomAvatarUrl,
        voice_persona_desc: String(response?.item?.voice_persona_desc || '').trim(),
        voice_persona_tags: cloneProvider,
        try_listen_url: response?.item?.try_listen_url || cloneSelectedFile?.url || '',
      };

      setCloneSuccess(true);
      setClonedVoiceItem(nextVoiceItem);
      voiceLib.upsertMyVoiceItem(nextVoiceItem);
      message.success('复刻任务已提交');
    } catch (error) {
      if (cloneProvider === 'elevenlabs' && error?.data && typeof error.data === 'object') {
        setCloneBillingState(buildCloneBillingState(cloneProvider, error.data));
      }
      message.error(error?.message || '复刻失败，请稍后重试');
    } finally {
      setCloningVoice(false);
    }
  }, [
    cloneProvider,
    cloneSelectedFile,
    cloneSelectedSourceUrl,
    voiceLib,
  ]);

  const handleOpenMembershipPayment = React.useCallback(async () => {
    let paymentUrl = REDEEM_PAYMENT_URL;

    try {
      const accessToken = await tokenStore.ensureValidAccessToken();
      if (typeof accessToken === 'string' && accessToken.trim()) {
        const currentUser = electronStore.get('user') || {};
        const paymentUrlObject = new URL(REDEEM_PAYMENT_URL);
        const hashParams = new URLSearchParams({
          jwt: accessToken.trim(),
        });
        if (typeof currentUser?.name === 'string' && currentUser.name.trim()) {
          hashParams.set('name', currentUser.name.trim());
        }
        if (typeof currentUser?.avatar === 'string' && currentUser.avatar.trim()) {
          hashParams.set('avatar', currentUser.avatar.trim());
        }
        if (typeof currentUser?.email === 'string' && currentUser.email.trim()) {
          hashParams.set('email', currentUser.email.trim());
        }
        paymentUrlObject.hash = hashParams.toString();
        paymentUrl = paymentUrlObject.toString();
      }
    } catch (error) {
      logger.warn('Failed to resolve access token for membership payment window.', error);
    }

    try {
      if (window.api?.openInternalWebsite) {
        window.api.openInternalWebsite(paymentUrl);
        return;
      }
    } catch {}

    try {
      const { shell } = window.require('electron');
      if (shell?.openExternal) {
        shell.openExternal(paymentUrl);
        return;
      }
    } catch (error) {
      logger.warn('Electron shell is not available. Falling back to window.open.', error);
    }

    window.open(paymentUrl, '_blank', 'noopener,noreferrer');
  }, []);

  React.useEffect(() => {
    if (!voiceCloneDialogOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleVoiceCloneDialogClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleVoiceCloneDialogClose, voiceCloneDialogOpen]);

  React.useEffect(() => {
    if (!cloneWaveVisible || !cloneWaveContainerRef.current) return undefined;

    const container = cloneWaveContainerRef.current;
    const siriWave = new SiriWave({
      container,
      width: Math.max(240, Math.round(container.clientWidth || 320)),
      height: Math.max(48, Math.round(container.clientHeight || 56)),
      style: 'ios9',
      autostart: true,
      speed: 0.07,
      amplitude: 0.55,
    });

    cloneWaveRef.current = siriWave;
    return () => {
      if (cloneWaveDriveFrameRef.current) window.cancelAnimationFrame(cloneWaveDriveFrameRef.current);
      if (cloneRandomPulseTimerRef.current) window.clearInterval(cloneRandomPulseTimerRef.current);
      siriWave.dispose();
      if (cloneWaveRef.current === siriWave) {
        cloneWaveRef.current = null;
      }
    };
  }, [cloneWaveVisible]);

  React.useEffect(() => {
    if (!cloneWaveVisible || !cloneWaveRef.current) return undefined;

    if (cloneWaveDriveFrameRef.current) window.cancelAnimationFrame(cloneWaveDriveFrameRef.current);
    if (cloneRandomPulseTimerRef.current) window.clearInterval(cloneRandomPulseTimerRef.current);

    if (cloneRecordingActive && cloneAnalyserRef.current) {
      const analyser = cloneAnalyserRef.current;
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        const amplitude = Math.min(2.2, 0.3 + rms * 8.5);
        cloneWaveRef.current?.setAmplitude(amplitude);
        cloneWaveRef.current?.setSpeed(0.05 + rms * 0.28);
        cloneWaveDriveFrameRef.current = window.requestAnimationFrame(tick);
      };
      cloneWaveDriveFrameRef.current = window.requestAnimationFrame(tick);
      return () => {
        if (cloneWaveDriveFrameRef.current) {
          window.cancelAnimationFrame(cloneWaveDriveFrameRef.current);
        }
      };
    }

    cloneRandomPulseTimerRef.current = window.setInterval(() => {
      cloneWaveRef.current?.setAmplitude(0.75 + Math.random() * 0.45);
      cloneWaveRef.current?.setSpeed(0.04 + Math.random() * 0.08);
    }, 900);

    return () => {
      if (cloneRandomPulseTimerRef.current) {
        window.clearInterval(cloneRandomPulseTimerRef.current);
      }
    };
  }, [cloneRecordingActive, cloneWaveVisible]);

  React.useEffect(() => {
    if (!cloneRecordingActive) {
      if (cloneTimerRef.current) {
        window.clearInterval(cloneTimerRef.current);
      }
      return undefined;
    }

    cloneTimerRef.current = window.setInterval(() => {
      setCloneRecordSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      if (cloneTimerRef.current) {
        window.clearInterval(cloneTimerRef.current);
      }
    };
  }, [cloneRecordingActive]);

  React.useEffect(() => {
    if (!cloneRecordingActive) return;
    if (cloneRecordSeconds <= VOICE_CLONE_MAX_RECORD_SECONDS) return;
    if (cloneAutoStopTriggeredRef.current) return;

    cloneAutoStopTriggeredRef.current = true;
    message.error('录制时长超过60秒，已停止并返回上传页，请重新录制');
    void stopCloneRecord({ keepResult: false });
  }, [cloneRecordSeconds, cloneRecordingActive, stopCloneRecord]);

  React.useEffect(() => {
    if (!voiceCloneDialogOpen) return undefined;

    let cancelled = false;
    const loadClonePrice = async () => {
      try {
        await refreshCloneBillingState(cloneProvider);
        if (cancelled) return;
      } catch (error) {
        if (!cancelled) {
          setCloneBillingState(buildCloneBillingState(cloneProvider));
        }
      }
    };

    void loadClonePrice();
    return () => {
      cancelled = true;
    };
  }, [cloneProvider, refreshCloneBillingState, voiceCloneDialogOpen]);

  React.useEffect(() => {
    if (!voiceCloneDialogOpen) return undefined;
    try {
      const { ipcRenderer } = window.require('electron');
      const handlePaymentSuccess = () => {
        if (cloneProvider !== 'elevenlabs') return;
        void refreshCloneBillingState('elevenlabs');
      };
      ipcRenderer.on(IpcChannel.Payment_Success, handlePaymentSuccess);
      return () => {
        ipcRenderer.removeListener(IpcChannel.Payment_Success, handlePaymentSuccess);
      };
    } catch (error) {
      logger.warn('Failed to subscribe payment success events in voice clone dialog.', error);
      return undefined;
    }
  }, [cloneProvider, refreshCloneBillingState, voiceCloneDialogOpen]);

  React.useEffect(() => {
    const audio = cloneAudioRef.current;
    if (!audio) return undefined;

    const handleEnded = () => {
      setCloneIsPlaying(false);
      setCloneAudioCurrentSec(audio.duration || 0);
    };
    const handleLoadedMetadata = () => {
      setCloneAudioDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const handleTimeUpdate = () => {
      setCloneAudioCurrentSec(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    };

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [voiceCloneDialogOpen]);

  React.useEffect(() => {
    stopClonePlayback();
    setCloneAudioDurationSec(0);
  }, [cloneSelectedFile?.url, stopClonePlayback]);

  React.useEffect(() => {
    const fileUrl = cloneSelectedFile?.url;
    return () => {
      if (fileUrl && String(fileUrl).startsWith('blob:')) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [cloneSelectedFile?.url]);

  React.useEffect(() => {
    if (voiceCloneDialogOpen) return;

    let cancelled = false;
    const fileUrl = cloneSelectedFile?.url || '';

    const cleanupCloneDialog = async () => {
      stopClonePlayback();
      if (cloneRecordingActive) {
        await stopCloneRecord({ keepResult: false });
      } else {
        await stopCloneStreamAndContext();
      }
      if (cancelled) return;
      resetCloneDialogState(fileUrl);
    };

    void cleanupCloneDialog();
    return () => {
      cancelled = true;
    };
  }, [
    cloneRecordingActive,
    cloneSelectedFile?.url,
    resetCloneDialogState,
    stopClonePlayback,
    stopCloneRecord,
    stopCloneStreamAndContext,
    voiceCloneDialogOpen,
  ]);

  const cloneRecordTimeText = React.useMemo(() => {
    const mm = String(Math.floor(cloneRecordSeconds / 60)).padStart(2, '0');
    const ss = String(cloneRecordSeconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }, [cloneRecordSeconds]);

  return (
    <div className="chat-panel__tool-detail-area" style={{ '--member-color': MEMBER_COLOR }}>
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="语音生成"
            title="语音生成"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={VoiceSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">语音生成</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <VoiceLib
          controller={voiceLib}
          disabled={disabled}
          active={activeDetailTool === 'voice-lib'}
          onOpenChange={handleVoiceLibraryOpenChange}
        />
        <button
          type="button"
          className={`chat-panel__tool-button ${activeDetailTool === 'voice-clone' ? 'chat-panel__tool-button--sub-active' : ''}`}
          aria-label="克隆"
          title="克隆"
          disabled={disabled}
          onClick={handleVoiceCloneDialogOpen}
        >
          <img className="chat-panel__tool-icon" src={VoiceCloneIcon} alt="" aria-hidden="true" />
          <span className="chat-panel__tool-text">克隆</span>
        </button>
        {children}
      </div>
      {voiceCloneDialogOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="chat-panel__clone-dialog-mask"
              onClick={handleVoiceCloneDialogClose}
              role="presentation"
            >
              <div
                className="chat-panel__clone-dialog"
                ref={cloneDialogRef}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="voice-clone-dialog-title"
              >
                <button
                  type="button"
                  className={`traffic-btn close chat-panel__clone-dialog-traffic-close ${
                    isWindows ? 'chat-panel__clone-dialog-traffic-close--win' : 'chat-panel__clone-dialog-traffic-close--mac'
                  }`}
                  aria-label="关闭"
                  onClick={handleVoiceCloneDialogClose}
                />
                <audio ref={cloneAudioRef} src={cloneSelectedFile?.url || undefined} preload="metadata" />
                {cloneRecordingActive ? (
                  <div className="chat-panel__clone-dialog-panel">
                    <div className="chat-panel__clone-dialog-header">
                      <h2 id="voice-clone-dialog-title" className="chat-panel__clone-dialog-record-title">
                        请大声朗读下面文案
                      </h2>
                      <div className="chat-panel__clone-dialog-script">{VOICE_CLONE_SCRIPT}</div>
                    </div>
                    <div className="chat-panel__clone-dialog-wave">
                      <div ref={cloneWaveContainerRef} className="chat-panel__clone-dialog-wave-canvas" />
                    </div>
                    <div className="chat-panel__clone-dialog-record-actions">
                      <button
                        type="button"
                        className="chat-panel__clone-dialog-action chat-panel__clone-dialog-action--primary"
                        onClick={handleFinishCloneRecord}
                      >
                        <img
                          className="chat-panel__clone-dialog-action-icon"
                          src={VoiceCloneRecordIcon}
                          alt=""
                          aria-hidden="true"
                        />
                        <span>完成录制</span>
                      </button>
                    </div>
                    <div className="chat-panel__clone-dialog-record-meta">
                      <span className="chat-panel__clone-dialog-record-time">{cloneRecordTimeText}</span>
                      <span className="chat-panel__clone-dialog-record-divider" />
                      <button
                        type="button"
                        className="chat-panel__clone-dialog-inline-action"
                        onClick={() => {
                          void stopCloneRecord({ keepResult: false });
                        }}
                      >
                        <RedoOutlined />
                        <span>重新录制</span>
                      </button>
                    </div>
                  </div>
                ) : cloneUploadDone ? (
                  <div className="chat-panel__clone-dialog-panel">
                    {cloneSuccess && clonedVoiceItem ? (
                      <>
                        <div className="chat-panel__clone-dialog-header">
                          <h2 id="voice-clone-dialog-title" className="chat-panel__clone-dialog-title">
                            音色已复刻成功
                          </h2>
                          <div className="chat-panel__clone-dialog-description">
                            现在可以直接将该音色用于当前语音生成。
                          </div>
                        </div>
                        <div className="chat-panel__clone-result-card">
                          <Dropdown
                            trigger={['click']}
                            menu={cloneAvatarMenu}
                            overlayClassName="chat-panel__clone-avatar-dropdown"
                            open={cloneAvatarDropdownOpen}
                            onOpenChange={setCloneAvatarDropdownOpen}
                            getPopupContainer={getCloneDialogPopupContainer}
                          >
                            <button
                              type="button"
                              className="chat-panel__clone-result-avatar-trigger"
                              aria-label="选择头像"
                              disabled={cloneProfileSaving}
                            >
                              {clonedVoiceItem?.avatar_url ? (
                                <img
                                  className="chat-panel__clone-result-avatar"
                                  src={clonedVoiceItem.avatar_url}
                                  alt=""
                                  aria-hidden="true"
                                />
                              ) : (
                                <span className="chat-panel__clone-result-avatar chat-panel__clone-result-avatar--placeholder">
                                  {String(clonedVoiceItem?.title || clonedVoiceItem?.global_voice_id || '?').slice(0, 1)}
                                </span>
                              )}
                              <span className="chat-panel__clone-result-avatar-caret">
                                <DownOutlined />
                              </span>
                            </button>
                          </Dropdown>
                          <div className="chat-panel__clone-result-main">
                            <div className="chat-panel__clone-result-name-row">
                              {cloneEditingName ? (
                                <Input
                                  autoFocus
                                  value={cloneEditNameValue}
                                  maxLength={64}
                                  className="chat-panel__clone-result-name-input"
                                  onChange={(event) => setCloneEditNameValue(event.target.value)}
                                  onPressEnter={(event) => {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }}
                                  onBlur={() => {
                                    if (cloneCancelEditNameRef.current) {
                                      cloneCancelEditNameRef.current = false;
                                      setCloneEditingName(false);
                                      return;
                                    }
                                    void handleCloneEditNameSave();
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      cloneCancelEditNameRef.current = true;
                                      setCloneEditNameValue(String(clonedVoiceItem?.title || '').trim());
                                      event.currentTarget.blur();
                                    }
                                  }}
                                />
                              ) : (
                                <div className="chat-panel__clone-result-name">
                                  {clonedVoiceItem?.title || clonedVoiceItem?.global_voice_id || '我的复刻音色'}
                                </div>
                              )}
                              <button
                                type="button"
                                className="chat-panel__clone-result-edit-btn"
                                aria-label="编辑音色名称"
                                onClick={handleCloneEditNameStart}
                                disabled={cloneProfileSaving}
                              >
                                <EditOutlined />
                              </button>
                            </div>
                            <div className="chat-panel__clone-result-meta">
                              {(clonedVoiceItem?.provider || clonedVoiceItem?.providers || cloneProvider || 'fish').toUpperCase()}
                            </div>
                            {clonedVoiceItem?.voice_persona_desc ? (
                              <div className="chat-panel__clone-result-desc">{clonedVoiceItem.voice_persona_desc}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="chat-panel__clone-dialog-actions">
                          <button
                            type="button"
                            className="chat-panel__clone-dialog-action chat-panel__clone-dialog-action--secondary"
                            onClick={handleCloneAudioDelete}
                          >
                            <span>重新上传</span>
                          </button>
                          <button
                            type="button"
                            className="chat-panel__clone-dialog-action chat-panel__clone-dialog-action--primary"
                            onClick={handleUseClonedVoice}
                          >
                            <span>使用该音色</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="chat-panel__clone-dialog-header">
                          <h2 id="voice-clone-dialog-title" className="chat-panel__clone-dialog-title">
                            上传完成，
                            <span className="chat-panel__clone-dialog-title-accent">一键复刻</span>
                          </h2>
                        </div>
                        <div className="chat-panel__clone-uploaded-card">
                          <button
                            type="button"
                            className="chat-panel__clone-uploaded-play"
                            onClick={handleCloneAudioTogglePlay}
                          >
                            {cloneIsPlaying ? <PauseCircleFilled /> : <PlayCircleFilled />}
                          </button>
                          <div className="chat-panel__clone-uploaded-main">
                            <div className="chat-panel__clone-uploaded-name">
                              {cloneSelectedFile?.name || '已上传音频'}
                            </div>
                            <div className="chat-panel__clone-uploaded-meta">{clonePlayTimeText}</div>
                          </div>
                          <Tooltip title="删除" zIndex={1301}>
                            <button
                              type="button"
                              className="chat-panel__clone-uploaded-icon-btn"
                              aria-label="删除"
                              onClick={handleCloneAudioDelete}
                            >
                              <DeleteOutlined />
                            </button>
                          </Tooltip>
                          <span className="chat-panel__clone-uploaded-divider" />
                          <Tooltip title="重新上传" zIndex={1301}>
                            <button
                              type="button"
                              className="chat-panel__clone-uploaded-icon-btn"
                              aria-label="重新上传"
                              onClick={handleVoiceCloneUploadClick}
                            >
                              <img
                                className="chat-panel__clone-dialog-action-icon"
                                src={VoiceCloneUploadIcon}
                                alt=""
                                aria-hidden="true"
                              />
                            </button>
                          </Tooltip>
                          <Tooltip title="重新录制" zIndex={1301}>
                            <button
                              type="button"
                              className="chat-panel__clone-uploaded-icon-btn"
                              aria-label="重新录制"
                              onClick={handleCloneAudioReRecord}
                            >
                              <img
                                className="chat-panel__clone-dialog-action-icon"
                                src={VoiceCloneRecordBlackIcon}
                                alt=""
                                aria-hidden="true"
                              />
                            </button>
                          </Tooltip>
                        </div>
                        <div className="chat-panel__clone-provider-row">
                          <span>使用</span>
                          <Select
                            value={cloneProvider}
                            onChange={setCloneProvider}
                            className="chat-panel__clone-provider-select"
                            options={VOICE_CLONE_PROVIDER_OPTIONS}
                            variant="borderless"
                            popupMatchSelectWidth={false}
                            getPopupContainer={getCloneDialogPopupContainer}
                          />
                          <span>复刻音色</span>
                        </div>
                        <div className="chat-panel__clone-submit-row">
                          <Button
                            type="primary"
                            className={`chat-panel__clone-submit-btn ${
                              cloneProvider === 'elevenlabs' ? 'chat-panel__clone-submit-btn--member' : ''
                            }`}
                            icon={
                              <img
                                src={VoiceCloneActionIcon}
                                alt=""
                                className="chat-panel__clone-submit-icon"
                                aria-hidden="true"
                              />
                            }
                            loading={cloningVoice}
                            onClick={handleCloneVoiceSubmit}
                            disabled={cloneSubmitDisabled}
                          >
                            <span className="chat-panel__clone-submit-label">开始复刻</span>
                            <span className="chat-panel__clone-submit-price">
                              {cloneBillingState.billingMode === 'membership_slots' ? null : (
                                <img
                                  src={Point3Icon}
                                  alt=""
                                  className="chat-panel__clone-submit-price-icon"
                                  aria-hidden="true"
                                />
                              )}
                              {clonePriceLoading ? <LoadingOutlined spin /> : cloneBillingState.text}
                            </span>
                          </Button>
                        </div>
                        {showCloneMembershipCta ? (
                          <div className="chat-panel__clone-membership-cta-row">
                            <button
                              type="button"
                              className="chat-panel__clone-membership-cta"
                              onClick={handleOpenMembershipPayment}
                            >
                              开通会员
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="chat-panel__clone-dialog-panel">
                    <div className="chat-panel__clone-dialog-header">
                      <h2 id="voice-clone-dialog-title" className="chat-panel__clone-dialog-title">
                        录制或上传音频，
                        <span className="chat-panel__clone-dialog-title-accent">轻松复刻</span>
                      </h2>
                      <div className="chat-panel__clone-dialog-description">
                        推荐上传或录制 10-30s 音频，上传支持小于等于10MB 的 wav、mp3、m4a 格式文件
                      </div>
                      <div className="chat-panel__clone-dialog-description">
                        避免多人对话、明显杂音、噪音、混响等情况
                      </div>
                    </div>
                    <div className="chat-panel__clone-dialog-wave">
                      <div ref={cloneWaveContainerRef} className="chat-panel__clone-dialog-wave-canvas" />
                    </div>
                    <div className="chat-panel__clone-dialog-actions">
                      <button
                        type="button"
                        className="chat-panel__clone-dialog-action chat-panel__clone-dialog-action--secondary"
                        onClick={handleVoiceCloneUploadClick}
                      >
                        <img
                          className="chat-panel__clone-dialog-action-icon"
                          src={VoiceCloneUploadIcon}
                          alt=""
                          aria-hidden="true"
                        />
                        <span>{cloneUploading ? '上传中...' : '上传音频'}</span>
                      </button>
                      <button
                        type="button"
                        className="chat-panel__clone-dialog-action chat-panel__clone-dialog-action--primary"
                        onClick={handleVoiceCloneRecordClick}
                        disabled={cloneUploading}
                      >
                        <img
                          className="chat-panel__clone-dialog-action-icon"
                          src={VoiceCloneRecordIcon}
                          alt=""
                          aria-hidden="true"
                        />
                        <span>开始录制</span>
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={cloneUploadInputRef}
                  type="file"
                  accept={VOICE_CLONE_AUDIO_ACCEPT}
                  className="chat-panel__clone-dialog-file-input"
                  onChange={handleVoiceCloneUploadChange}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

export default VoiceSquareToolDetail;
export { getInitialSelectedVoiceLibraryItem } from '../VoiceLib';
