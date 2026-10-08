import React from 'react';
import { createPortal } from 'react-dom';
import { PlusOutlined } from '@ant-design/icons';
import { Image, message, Spin, Upload } from 'antd';
import { createDigitalHumanAvatarLibrary } from '../../../../api/digital_human';
import { uploadDigitalHumanAvatarCover } from '../../../../api/sts';
import { normalizeMemberProvider } from '../../../../constants/member';
import VoiceLib, { useVoiceLib } from '../VoiceLib';
import { resizeDigitalHumanAvatarImage } from './imageProcessing';
import './index.css';

const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

const getBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = (error) => reject(error);
});

const CreateDigitalHumanAvatorDialog = ({
  open = false,
  name = '',
  lockedVoiceProvider = '',
  onClose,
  onCreated,
  onNameChange,
}) => {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState('');
  const [fileList, setFileList] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const [processingImage, setProcessingImage] = React.useState(false);
  const imageProcessingIdRef = React.useRef(0);
  const voiceLib = useVoiceLib({ lockedProvider: lockedVoiceProvider });
  const normalizedLockedVoiceProvider = normalizeMemberProvider(lockedVoiceProvider);
  const selectedVoiceProvider = normalizeMemberProvider(
    voiceLib?.selectedVoiceLibraryItem?.price_provider
    || voiceLib?.selectedVoiceLibraryItem?.provider
    || voiceLib?.selectedVoiceLibraryItem?.providers
    || voiceLib?.selectedVoiceLibraryItem?.voice_provider
    || voiceLib?.selectedVoiceLibraryItem?.voice_provider_type
    || voiceLib?.selectedVoiceLibraryItem?.voice_source_provider
    || ''
  );
  const hasSelectedVoice = Boolean(voiceLib?.selectedVoiceLibraryItem?.global_voice_id)
    && (!normalizedLockedVoiceProvider || selectedVoiceProvider === normalizedLockedVoiceProvider);
  const canSave = Boolean(
    !processingImage
    && fileList.length > 0
    && String(name || '').trim()
    && hasSelectedVoice
  );

  React.useEffect(() => {
    if (!open) {
      imageProcessingIdRef.current += 1;
      setProcessingImage(false);
      setPreviewOpen(false);
      setPreviewImage('');
    }
  }, [open]);

  const handleClose = React.useCallback(() => {
    if (saving || processingImage) return;
    onClose?.();
  }, [onClose, processingImage, saving]);

  const handlePreview = React.useCallback(async (file) => {
    if (!file.url && !file.preview && file.originFileObj) {
      file.preview = await getBase64(file.originFileObj);
    }

    setPreviewImage(file.url || file.preview || '');
    setPreviewOpen(true);
  }, []);

  const handleUploadChange = React.useCallback(({ fileList: nextFileList }) => {
    setFileList(nextFileList.slice(-1));
  }, []);

  const handleBeforeUpload = React.useCallback(async (file) => {
    if (!String(file?.type || '').toLowerCase().startsWith('image/')) {
      message.error('请选择图片文件');
      return Upload.LIST_IGNORE;
    }

    const processingId = imageProcessingIdRef.current + 1;
    imageProcessingIdRef.current = processingId;
    setProcessingImage(true);

    try {
      const result = await resizeDigitalHumanAvatarImage(file);
      if (processingId !== imageProcessingIdRef.current) return Upload.LIST_IGNORE;

      setFileList([{
        uid: file.uid,
        name: result.file.name,
        status: 'done',
        type: result.file.type,
        size: result.file.size,
        originFileObj: result.file,
      }]);
      setPreviewOpen(false);
      setPreviewImage('');

      if (result.resized) {
        message.info(`图片分辨率超过 1080P，已自动压缩为 ${result.width}×${result.height}`);
      }
    } catch (error) {
      if (processingId === imageProcessingIdRef.current) {
        message.error(error?.message || '图片处理失败，请重新选择');
      }
    } finally {
      if (processingId === imageProcessingIdRef.current) {
        setProcessingImage(false);
      }
    }

    return Upload.LIST_IGNORE;
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!canSave || saving) return;

    const targetFile = fileList[0]?.originFileObj || fileList[0];
    const title = String(name || '').trim();
    const voiceId = String(voiceLib?.selectedVoiceLibraryItem?.global_voice_id || '').trim();
    const voiceProvider = selectedVoiceProvider;
    const canUseSeedance = voiceProvider === 'elevenlabs';

    if (!targetFile || !title || !voiceId) return;

    setSaving(true);
    try {
      const uploaded = await uploadDigitalHumanAvatarCover(targetFile);
      const result = await createDigitalHumanAvatarLibrary({
        title,
        cover_url: uploaded.publicUrl,
        demo_url: '',
        voice_id: voiceId,
        can_use_seedance: canUseSeedance,
      });
      const createdItemBase = result?.item || result?.data?.item || {
        title,
        cover_url: uploaded.publicUrl,
        demo_url: '',
        voice_id: voiceId,
      };
      const createdItem = {
        ...createdItemBase,
        ...(voiceProvider
          ? {
            voice_provider: String(createdItemBase?.voice_provider || voiceProvider).trim().toLowerCase(),
            provider: String(createdItemBase?.provider || voiceProvider).trim().toLowerCase(),
            providers: String(createdItemBase?.providers || voiceProvider).trim().toLowerCase(),
          }
          : {}),
        can_use_seedance:
          typeof createdItemBase?.can_use_seedance === 'boolean'
            ? createdItemBase.can_use_seedance
            : canUseSeedance,
      };

      setFileList([]);
      setPreviewOpen(false);
      setPreviewImage('');
      onNameChange?.('');
      onCreated?.(createdItem, result);
      message.success('数字形象创建成功');
      onClose?.();
    } catch (error) {
      message.error(error?.message || '数字形象创建失败');
    } finally {
      setSaving(false);
    }
  }, [canSave, fileList, name, onClose, onCreated, onNameChange, saving, selectedVoiceProvider, voiceLib]);

  const uploadButton = (
    <button className="chat-panel__digital-human-create-upload-trigger" type="button">
      <PlusOutlined />
      <div className="chat-panel__digital-human-create-upload-trigger-text">支持真人&动漫</div>
      <div className="chat-panel__digital-human-create-upload-trigger-subtext">清晰的正脸，生成效果更佳</div>
    </button>
  );

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="chat-panel__digital-human-create-mask"
      onClick={handleClose}
    >
      <div
        className="chat-panel__digital-human-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="digital-human-create-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-panel__digital-human-create-header">
          <div className="chat-panel__digital-human-create-title-wrap">
            <h2 id="digital-human-create-dialog-title" className="chat-panel__digital-human-create-title">
              新建数字形象
            </h2>
          </div>
          <button
            type="button"
            className={`traffic-btn close chat-panel__digital-human-create-traffic-close ${
              isWindows ? 'chat-panel__digital-human-create-traffic-close--win' : 'chat-panel__digital-human-create-traffic-close--mac'
            }`}
            aria-label="关闭"
            onClick={handleClose}
          />
        </div>
        <div className="chat-panel__digital-human-create-body">
          {saving || processingImage ? (
            <div className="chat-panel__digital-human-create-loading">
              <Spin size="small" />
              <span className="chat-panel__digital-human-create-loading-text">
                {processingImage ? '图片处理中...' : '保存中...'}
              </span>
            </div>
          ) : null}
          <div className="chat-panel__digital-human-create-field">
            <div className="chat-panel__digital-human-create-upload-box">
              <Upload
                accept="image/*"
                listType="picture-card"
                fileList={fileList}
                disabled={saving || processingImage}
                maxCount={1}
                beforeUpload={handleBeforeUpload}
                onPreview={handlePreview}
                onChange={handleUploadChange}
                className="chat-panel__digital-human-create-upload"
              >
                {fileList.length >= 1 ? null : uploadButton}
              </Upload>
              {previewImage ? (
                <Image
                  className="chat-panel__digital-human-create-preview-image"
                  preview={{
                    visible: previewOpen,
                    zIndex: 1500,
                    onVisibleChange: (visible) => {
                      setPreviewOpen(visible);
                      if (!visible) setPreviewImage('');
                    },
                  }}
                  src={previewImage}
                />
              ) : null}
            </div>
          </div>
          <div className="chat-panel__digital-human-create-field chat-panel__digital-human-create-field--inline">
            <div className="chat-panel__digital-human-create-inline-label">
              名称
            </div>
            <div className="chat-panel__digital-human-create-inline-control">
              <input
                type="text"
                maxLength={20}
                disabled={saving}
                className="chat-panel__digital-human-create-input chat-panel__digital-human-create-input--inline"
                placeholder="请输入名称"
                value={name}
                onChange={(event) => onNameChange?.(event.target.value)}
              />
            </div>
            <span className="chat-panel__digital-human-create-count chat-panel__digital-human-create-count--inline">{name.length}/20</span>
          </div>
          <div className="chat-panel__digital-human-create-field chat-panel__digital-human-create-field--inline">
            <div className="chat-panel__digital-human-create-inline-label">
              音色
            </div>
            <div className="chat-panel__digital-human-create-inline-control chat-panel__digital-human-create-inline-control--voice">
              <VoiceLib
                controller={voiceLib}
                disabled={saving}
                getPopupContainer={(trigger) => trigger.parentElement}
                label="请选择音色"
                selectedTextPrefix=""
              />
            </div>
          </div>
        </div>
        <div className="chat-panel__digital-human-create-footer">
          <button
            type="button"
            className="chat-panel__digital-human-create-cancel"
            disabled={saving}
            onClick={handleClose}
          >
            取消
          </button>
          <button
            type="button"
            className={`chat-panel__digital-human-create-save ${canSave && !saving ? 'chat-panel__digital-human-create-save--enabled' : ''}`}
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CreateDigitalHumanAvatorDialog;
