import React from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { Button, Empty, Popover, Select, Tooltip, Upload as AntUpload, message } from 'antd';
import { ArrowUp, CirclePause, FileAudio, FileImage, FileVideo, Plus, Upload as UploadIcon } from 'lucide-react';
import './Composer.css';
import { uploadToOSSWithProgress } from '../../../api/sts';
import ChatToolFileIcon from '../../../../public/chat_tool_file.svg';
import ChatModelsTipIcon from '../../../../public/chat_models_tip.svg';
import Point2Icon from '../../../../public/point2.svg';
import AiWriteToolDetail from './AiWriteToolDetail/index';
import {
  getDefaultAiWritePresetId,
  getAiWriteFields,
  getAiWritePresetById,
} from './AiWriteToolDetail/presetOptions';
import ToolArea from './ToolArea/index';
import DigitalHumanToolDetail from './DigitalHumanToolDetail/index';
import VoiceSquareToolDetail, { getInitialSelectedVoiceLibraryItem } from './VoiceSquareToolDetail/index';

const { shell } = window.require('electron');
const MAX_UPLOAD_FILE_SIZE = 500 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 5;
const SKILL_MENTION_CLOSE_DELAY = 120;
const MENTION_TOKEN_BOUNDARY = '[\\s,.!?;:，。！？；：)]';
const MENTION_PANEL_DEFAULT_WIDTH = 180;
const MENTION_PANEL_EDGE_OFFSET = 4;
const MODEL_HOVER_CARD_WIDTH = 180;
const MODEL_HOVER_CARD_GAP = 20;
const MODEL_HOVER_CARD_VIEWPORT_MARGIN = 8;

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripUrlSearch = (value) => String(value || '').split('?')[0].split('#')[0];
const getSkillMentionLabel = (skill) => String(skill?.name || skill?.id || '').trim();
const getMentionText = (attrs = {}) => `@${attrs.label || attrs.id || ''}`;
const getFileReferenceText = (attrs = {}) => `#${attrs.name || '文件'}`;
const getFileDisplayName = (file = {}) => file.name || '文件';
const DIGITAL_HUMAN_VIDEO_SLOT_ID = 'digital-human-video';
const DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID = 'digital-human-selected-voice-id';
const VOICE_SQUARE_SELECTED_VOICE_ID_SLOT_ID = 'voice-square-selected-voice-id';
const DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE = 'digitalHumanScriptPlaceholder';
const DIGITAL_HUMAN_MOTION_PLACEHOLDER_NODE = 'digitalHumanMotionPlaceholder';
const AI_WRITE_FIELD_PLACEHOLDER_NODE = 'aiWriteFieldPlaceholder';
const DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT = '请输入文案';
const AI_WRITE_FIELD_PLACEHOLDER_TEXT = '请输入';
const DIGITAL_HUMAN_MODE_STORAGE_KEY = 'chat-panel:digital-human-mode';
const DIGITAL_HUMAN_AVATAR_TITLE_STORAGE_KEY = 'chat-panel:digital-human-avatar-title';
const DIGITAL_HUMAN_AVATAR_COVER_URL_STORAGE_KEY = 'chat-panel:digital-human-avatar-cover-url';
const DIGITAL_HUMAN_AVATAR_VOICE_ID_STORAGE_KEY = 'chat-panel:digital-human-avatar-voice-id';
const DEFAULT_DIGITAL_HUMAN_MODE = 'lips';
const DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE = '和蔼奶奶';
const DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL = 'https://player.install-ai-guider.top/example/digital_human/omni_pic_example_1.jpg';
const DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID = 'gv_5cbd3d5acae44943805e9bb7717f9f97';
const DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT = '画面中人物正在进行拍摄一个口播视频，自然的说话。人物在口播过程中，有着自然的摆头、张嘴、眼神变化以及手势的动作，在重点或者疑问的时候，他的表情甚至更加细微的表现出来强调或者疑问等等情感。视频的音频部分完全由他的口播声音构成，没有其他对话或杂音。严禁画面中出现文字。'
const FILE_SLOT_PLACEHOLDER = '请输入';
const normalizeDigitalHumanMode = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue === 'jimeng-avatar' ? 'jimeng-avatar' : DEFAULT_DIGITAL_HUMAN_MODE;
};
const readPersistedDigitalHumanMode = () => {
  try {
    return normalizeDigitalHumanMode(localStorage.getItem(DIGITAL_HUMAN_MODE_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_DIGITAL_HUMAN_MODE;
  }
};
const normalizeDigitalHumanAvatarTitle = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE;
};
const normalizeDigitalHumanAvatarCoverUrl = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL;
};
const normalizeDigitalHumanAvatarVoiceId = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID;
};
const readPersistedDigitalHumanAvatarSelection = () => {
  try {
    return {
      title: normalizeDigitalHumanAvatarTitle(localStorage.getItem(DIGITAL_HUMAN_AVATAR_TITLE_STORAGE_KEY)),
      cover_url: normalizeDigitalHumanAvatarCoverUrl(localStorage.getItem(DIGITAL_HUMAN_AVATAR_COVER_URL_STORAGE_KEY)),
      voice_id: normalizeDigitalHumanAvatarVoiceId(localStorage.getItem(DIGITAL_HUMAN_AVATAR_VOICE_ID_STORAGE_KEY)),
    };
  } catch (error) {
    return {
      title: DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE,
      cover_url: DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL,
      voice_id: DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID,
    };
  }
};
const createFileReferenceAttrs = (file = {}, overrides = {}) => ({
  uid: overrides.uid ?? file.uid ?? '',
  name: overrides.name ?? file.name ?? '',
  url: overrides.url ?? file.url ?? '',
  fileType: overrides.fileType ?? file.fileType ?? '',
  thumbnailUrl: overrides.thumbnailUrl ?? file.thumbnailUrl ?? file.url ?? '',
  previewUrl: overrides.previewUrl ?? file.previewUrl ?? file.url ?? '',
  localThumbUrl: overrides.localThumbUrl ?? file.localThumbUrl ?? '',
  localPreviewUrl: overrides.localPreviewUrl ?? file.localPreviewUrl ?? file.localThumbUrl ?? '',
  durationLabel: overrides.durationLabel ?? file.durationLabel ?? '',
  templateSlot: Boolean(overrides.templateSlot ?? file.templateSlot),
  slotId: overrides.slotId ?? file.slotId ?? '',
  slotLabel: overrides.slotLabel ?? file.slotLabel ?? '',
  acceptedKind: overrides.acceptedKind ?? file.acceptedKind ?? '',
  placeholderText: overrides.placeholderText ?? file.placeholderText ?? FILE_SLOT_PLACEHOLDER,
});
const createDigitalHumanSelectedVoiceReferenceAttrs = (
  selectedMode = DEFAULT_DIGITAL_HUMAN_MODE,
  selectedVoiceLibraryItem = null,
  selectedAvatar = readPersistedDigitalHumanAvatarSelection()
) => {
  if (selectedMode === 'jimeng-avatar') {
    return createFileReferenceAttrs({}, {
      uid: normalizeDigitalHumanAvatarVoiceId(selectedAvatar?.voice_id),
      name: normalizeDigitalHumanAvatarTitle(selectedAvatar?.title),
      fileType: 'audio/mpeg',
      slotId: DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID,
      slotLabel: '形象音色',
      placeholderText: normalizeDigitalHumanAvatarTitle(selectedAvatar?.title),
    });
  }

  return createFileReferenceAttrs({}, {
    uid: selectedVoiceLibraryItem?.global_voice_id || '',
    name: selectedVoiceLibraryItem?.title || '音色id',
    fileType: selectedVoiceLibraryItem?.global_voice_id ? 'audio/mpeg' : '',
    slotId: DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID,
    slotLabel: '音色id',
    placeholderText: selectedVoiceLibraryItem?.title || '音色id',
  });
};
const createVoiceSquareSelectedVoiceReferenceAttrs = (selectedVoiceLibraryItem = null) =>
  createFileReferenceAttrs({}, {
    uid: selectedVoiceLibraryItem?.global_voice_id || '',
    name: selectedVoiceLibraryItem?.title || '音色',
    fileType: selectedVoiceLibraryItem?.global_voice_id ? 'audio/mpeg' : '',
    slotId: VOICE_SQUARE_SELECTED_VOICE_ID_SLOT_ID,
    slotLabel: '音色',
    placeholderText: selectedVoiceLibraryItem?.title || '音色',
  });
const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  if (!(file instanceof Blob)) {
    reject(new Error('INVALID_FILE'));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('READ_FILE_FAILED'));
  reader.readAsDataURL(file);
});
const createDigitalHumanMediaReferenceAttrs = (
  selectedMode = DEFAULT_DIGITAL_HUMAN_MODE,
  currentFile = {},
  selectedAvatar = readPersistedDigitalHumanAvatarSelection()
) =>
  createFileReferenceAttrs(currentFile, {
    uid: selectedMode === 'jimeng-avatar'
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.uid,
    name: selectedMode === 'jimeng-avatar'
      ? normalizeDigitalHumanAvatarTitle(selectedAvatar?.title)
      : currentFile.name,
    url: selectedMode === 'jimeng-avatar'
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.url,
    fileType: selectedMode === 'jimeng-avatar' ? 'image/jpeg' : currentFile.fileType,
    thumbnailUrl: selectedMode === 'jimeng-avatar'
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.thumbnailUrl,
    previewUrl: selectedMode === 'jimeng-avatar'
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.previewUrl,
    templateSlot: true,
    slotId: DIGITAL_HUMAN_VIDEO_SLOT_ID,
    slotLabel: selectedMode === 'jimeng-avatar' ? '人物照片' : '人物视频',
    acceptedKind: selectedMode === 'jimeng-avatar' ? 'image' : 'video',
    placeholderText: selectedMode === 'jimeng-avatar' ? '选择的形象照片' : '人物视频',
  });
const buildDigitalHumanMediaParagraph = (
  selectedMode = DEFAULT_DIGITAL_HUMAN_MODE,
  currentFile = {},
  selectedAvatar = readPersistedDigitalHumanAvatarSelection()
) => {
  if (selectedMode === 'jimeng-avatar') {
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: '第二步: 将上一步生成的语音和人物照片 ' },
        {
          type: 'fileReference',
          attrs: createDigitalHumanMediaReferenceAttrs(selectedMode, currentFile, selectedAvatar),
        },
        { type: 'text', text: ' 合并成一个数字人视频，视频中的人物动作是' },
        {
          type: DIGITAL_HUMAN_MOTION_PLACEHOLDER_NODE,
          attrs: {
            text: DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT,
          },
        },
      ],
    };
  }

  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: '第二步: 将上一步生成的语音和人物视频 ' },
      {
        type: 'fileReference',
        attrs: createDigitalHumanMediaReferenceAttrs(selectedMode, currentFile, selectedAvatar),
      },
      { type: 'text', text: ' 合并成一个数字人视频。' },
    ],
  };
};
const getFileReferenceNodeText = (attrs = {}) => {
  if (attrs?.uid) {
    return getFileReferenceText(attrs);
  }
  if (attrs?.slotId === DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID) {
    return `[${attrs?.placeholderText || attrs?.name || '音色id'}]`;
  }
  if (attrs?.slotId === VOICE_SQUARE_SELECTED_VOICE_ID_SLOT_ID) {
    return `[${attrs?.placeholderText || attrs?.name || '音色'}]`;
  }
  return `[${attrs?.placeholderText || FILE_SLOT_PLACEHOLDER}]`;
};
const createDigitalHumanScriptPlaceholderExtension = () => {
  const DigitalHumanScriptPlaceholderNodeView = ({ editor, getPos, node }) => (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="chat-panel__digital-human-script-placeholder-node"
    >
      <button
        type="button"
        className="chat-panel__digital-human-script-placeholder"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const position = typeof getPos === 'function' ? getPos() : null;
          if (typeof position !== 'number') return;

          const transaction = editor.state.tr.deleteRange(position, position + node.nodeSize);
          transaction.setSelection(TextSelection.create(transaction.doc, position));
          editor.view.dispatch(transaction.scrollIntoView());
          editor.view.focus();
        }}
      >
        {node?.attrs?.text || DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT}
      </button>
    </NodeViewWrapper>
  );

  return Node.create({
    name: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
      return {
        text: { default: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-type="digital-human-script-placeholder"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-type': 'digital-human-script-placeholder',
          class: 'chat-panel__digital-human-script-placeholder-node',
        }),
        ['span', { class: 'chat-panel__digital-human-script-placeholder' }, HTMLAttributes.text || DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT],
      ];
    },

    renderText() {
      return '';
    },

    addNodeView() {
      return ReactNodeViewRenderer(DigitalHumanScriptPlaceholderNodeView);
    },
  });
};
const createDigitalHumanMotionPlaceholderExtension = () => {
  const DigitalHumanMotionPlaceholderNodeView = ({ editor, getPos, node }) => (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="chat-panel__digital-human-script-placeholder-node"
    >
      <button
        type="button"
        className="chat-panel__digital-human-script-placeholder"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const position = typeof getPos === 'function' ? getPos() : null;
          if (typeof position !== 'number') return;

          const text = String(node?.attrs?.text || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT);
          const replacementText = `[${text}]`;
          const transaction = editor.state.tr.insertText(
            replacementText,
            position,
            position + node.nodeSize
          );
          transaction.setSelection(
            TextSelection.create(transaction.doc, position + replacementText.length - 1)
          );
          editor.view.dispatch(transaction.scrollIntoView());
          editor.view.focus();
        }}
      >
        [{node?.attrs?.text || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT}]
      </button>
    </NodeViewWrapper>
  );

  return Node.create({
    name: DIGITAL_HUMAN_MOTION_PLACEHOLDER_NODE,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
      return {
        text: { default: DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-type="digital-human-motion-placeholder"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      const text = HTMLAttributes.text || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT;
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-type': 'digital-human-motion-placeholder',
          class: 'chat-panel__digital-human-script-placeholder-node',
        }),
        ['span', { class: 'chat-panel__digital-human-script-placeholder' }, `[${text}]`],
      ];
    },

    renderText({ node }) {
      return `[${node?.attrs?.text || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT}]`;
    },

    addNodeView() {
      return ReactNodeViewRenderer(DigitalHumanMotionPlaceholderNodeView);
    },
  });
};
const createAiWriteFieldPlaceholderExtension = () => {
  const AiWriteFieldPlaceholderNodeView = ({ editor, getPos, node }) => (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="chat-panel__ai-write-field-placeholder-node"
    >
      <button
        type="button"
        className="chat-panel__ai-write-field-placeholder"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const position = typeof getPos === 'function' ? getPos() : null;
          if (typeof position !== 'number') return;

          const transaction = editor.state.tr.deleteRange(position, position + node.nodeSize);
          transaction.setSelection(TextSelection.create(transaction.doc, position));
          editor.view.dispatch(transaction.scrollIntoView());
          editor.view.focus();
        }}
      >
        {node?.attrs?.text || AI_WRITE_FIELD_PLACEHOLDER_TEXT}
      </button>
    </NodeViewWrapper>
  );

  return Node.create({
    name: AI_WRITE_FIELD_PLACEHOLDER_NODE,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
      return {
        text: { default: AI_WRITE_FIELD_PLACEHOLDER_TEXT },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-type="ai-write-field-placeholder"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-type': 'ai-write-field-placeholder',
          class: 'chat-panel__ai-write-field-placeholder-node',
        }),
        ['span', { class: 'chat-panel__ai-write-field-placeholder' }, HTMLAttributes.text || AI_WRITE_FIELD_PLACEHOLDER_TEXT],
      ];
    },

    renderText() {
      return '';
    },

    addNodeView() {
      return ReactNodeViewRenderer(AiWriteFieldPlaceholderNodeView);
    },
  });
};
const buildDigitalHumanEditorDocument = (
  selectedVoiceLibraryItem = null,
  selectedMode = readPersistedDigitalHumanMode(),
  selectedAvatar = readPersistedDigitalHumanAvatarSelection()
) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '使用' },
        {
          type: 'mention',
          attrs: {
            id: 'vectcut-skill',
            label: 'vectcut-skill',
          },
        },
        { type: 'text', text: '执行下面步骤：' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '第一步: 将说话内容：[' },
        {
          type: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE,
          attrs: {
            text: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT,
          },
        },
        { type: 'text', text: '] 利用音色 ' },
        {
          type: 'fileReference',
          attrs: createDigitalHumanSelectedVoiceReferenceAttrs(selectedMode, selectedVoiceLibraryItem, selectedAvatar),
        },
        { type: 'text', text: ' 合成语音。' },
      ],
    },
    buildDigitalHumanMediaParagraph(selectedMode, {}, selectedAvatar),
  ],
});
const buildVoiceSquareEditorDocument = (selectedVoiceLibraryItem = null) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '将说话内容: [' },
        {
          type: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE,
          attrs: {
            text: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT,
          },
        },
        { type: 'text', text: '] 利用音色 ' },
        {
          type: 'fileReference',
          attrs: createVoiceSquareSelectedVoiceReferenceAttrs(selectedVoiceLibraryItem),
        },
        { type: 'text', text: ' 合成语音。' },
      ],
    },
  ],
});
const buildAiWriteEditorDocument = (presetId = getDefaultAiWritePresetId()) => {
  const preset = getAiWritePresetById(presetId);
  const fields = getAiWriteFields(presetId);
  const instructionText = String(preset?.instruction || '').trim() || `根据下面信息生成${preset.label}：`;

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: instructionText },
        ],
      },
      ...fields.map((fieldLabel) => ({
        type: 'paragraph',
        content: [
          { type: 'text', text: `${fieldLabel}：[` },
          {
            type: AI_WRITE_FIELD_PLACEHOLDER_NODE,
            attrs: {
              text: AI_WRITE_FIELD_PLACEHOLDER_TEXT,
            },
          },
          { type: 'text', text: ']' },
        ],
      })),
    ],
  };
};
const formatMediaDuration = (durationInSeconds) => {
  const totalSeconds = Math.max(0, Math.floor(Number(durationInSeconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
const createLocalObjectUrl = (file) => {
  if (!(file instanceof File) || typeof URL?.createObjectURL !== 'function') return '';
  try {
    return URL.createObjectURL(file);
  } catch (error) {
    return '';
  }
};
const revokeLocalObjectUrl = (value) => {
  if (!value || typeof URL?.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(value);
  } catch (error) {
    // noop
  }
};
const readMediaDuration = (mediaUrl, tagName = 'video') => new Promise((resolve) => {
  if (!mediaUrl || typeof document === 'undefined') {
    resolve('');
    return;
  }

  const element = document.createElement(tagName === 'audio' ? 'audio' : 'video');
  const cleanup = () => {
    element.removeAttribute('src');
    element.load?.();
  };
  const finish = (value = '') => {
    cleanup();
    resolve(value);
  };

  element.preload = 'metadata';
  element.onloadedmetadata = () => {
    finish(formatMediaDuration(element.duration));
  };
  element.onerror = () => {
    finish('');
  };
  element.src = mediaUrl;
});
const getFileKindFromType = (fileType = '') => {
  if (String(fileType).startsWith('image/')) return 'image';
  if (String(fileType).startsWith('video/')) return 'video';
  if (String(fileType).startsWith('audio/')) return 'audio';
  return 'file';
};
const isPreviewableFile = (fileType = '') => ['image', 'video', 'audio'].includes(getFileKindFromType(fileType));
const renderFilePreviewContent = (file = {}, className = '') => {
  const previewUrl = file.localPreviewUrl || file.localThumbUrl || file.previewUrl || file.thumbnailUrl || file.url;
  const kind = getFileKindFromType(file.fileType);

  if (!previewUrl) {
    return (
      <div className={`chat-panel__file-ref-preview chat-panel__file-ref-preview--empty ${className}`.trim()}>
        暂无预览
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div className={`chat-panel__file-ref-preview ${className}`.trim()}>
        <div className="chat-panel__file-ref-preview-title">{getFileDisplayName(file)}</div>
        <img className="chat-panel__file-ref-preview-image" src={previewUrl} alt={getFileDisplayName(file)} />
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div className={`chat-panel__file-ref-preview ${className}`.trim()}>
        <div className="chat-panel__file-ref-preview-title">{getFileDisplayName(file)}</div>
        <video className="chat-panel__file-ref-preview-video" src={previewUrl} controls muted playsInline />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className={`chat-panel__file-ref-preview chat-panel__file-ref-preview--audio ${className}`.trim()}>
        <div className="chat-panel__file-ref-preview-title">{getFileDisplayName(file)}</div>
        <audio className="chat-panel__file-ref-preview-audio" src={previewUrl} controls preload="metadata" />
      </div>
    );
  }

  return (
    <div className={`chat-panel__file-ref-preview chat-panel__file-ref-preview--empty ${className}`.trim()}>
      暂不支持预览
    </div>
  );
};
const renderFileThumb = (file = {}, options = {}) => {
  const previewUrl = file.localThumbUrl || file.localPreviewUrl || file.thumbnailUrl || file.previewUrl || file.url;
  const kind = getFileKindFromType(file.fileType);
  const showDuration = options.showDuration !== false;

  if (previewUrl && kind === 'image') {
    return <img className="chat-panel__file-ref-thumb-image" src={previewUrl} alt={getFileDisplayName(file)} />;
  }

  if (previewUrl && kind === 'video') {
    return (
      <>
        <video
          className="chat-panel__file-ref-thumb-video"
          src={previewUrl}
          muted
          playsInline
          preload="metadata"
        />
        {showDuration && file.durationLabel ? (
          <span className="chat-panel__file-ref-thumb-duration">{file.durationLabel}</span>
        ) : null}
      </>
    );
  }

  if (kind === 'video') {
    return <FileVideo className="chat-panel__file-ref-thumb-icon" />;
  }

  if (kind === 'audio') {
    return <FileAudio className="chat-panel__file-ref-thumb-icon" />;
  }

  return <FileImage className="chat-panel__file-ref-thumb-icon" />;
};
const getEditorPlainText = (editor) => {
  if (!editor || editor.isDestroyed) return '';
  return editor.getText({ blockSeparator: '\n' });
};
const getDigitalHumanTemplateCompletionState = (editor) => {
  if (!editor || editor.isDestroyed) {
    return {
      hasScriptContent: false,
      hasVideoReference: false,
      isComplete: false,
    };
  }

  const paragraphs = [];
  editor.state.doc.forEach((node) => {
    if (node.type?.name === 'paragraph') {
      paragraphs.push(node);
    }
  });

  const scriptParagraph = paragraphs[1];
  const videoParagraph = paragraphs[2];

  let hasScriptPlaceholder = false;
  let scriptText = '';
  if (scriptParagraph) {
    scriptParagraph.forEach((child) => {
      if (child.type?.name === DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE) {
        hasScriptPlaceholder = true;
        return;
      }
      if (child.type?.name === 'fileReference' && child.attrs?.slotId === DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID) {
        return false;
      }
      if (child.type?.name === 'text') {
        scriptText += child.text || '';
      }
      return true;
    });
  }

  const normalizedScriptText = scriptText
    .replace(/^第一步:\s*将说话内容：/, '')
    .replace(/\s*利用音色\s*$/, '')
    .trim();

  let hasVideoReference = false;
  if (videoParagraph) {
    videoParagraph.forEach((child) => {
      if (
        child.type?.name === 'fileReference' &&
        child.attrs?.slotId === DIGITAL_HUMAN_VIDEO_SLOT_ID &&
        child.attrs?.uid
      ) {
        hasVideoReference = true;
        return false;
      }
      return true;
    });
  }

  const hasScriptContent = !hasScriptPlaceholder && normalizedScriptText.length > 0;
  return {
    hasScriptContent,
    hasVideoReference,
    isComplete: hasScriptContent && hasVideoReference,
  };
};
const getAiWriteTemplateCompletionState = (editor, presetId = getDefaultAiWritePresetId()) => {
  const fields = getAiWriteFields(presetId);

  if (!editor || editor.isDestroyed) {
    return {
      filledCount: 0,
      totalCount: fields.length,
      isComplete: false,
    };
  }

  const paragraphs = [];
  editor.state.doc.forEach((node) => {
    if (node.type?.name === 'paragraph') {
      paragraphs.push(node);
    }
  });

  const fieldParagraphs = paragraphs.slice(1, fields.length + 1);
  let filledCount = 0;

  fieldParagraphs.forEach((paragraph, index) => {
    const fieldLabel = String(fields[index] || '').trim();
    if (!fieldLabel) return;

    let hasPlaceholder = false;
    let paragraphText = '';

    paragraph.forEach((child) => {
      if (child.type?.name === AI_WRITE_FIELD_PLACEHOLDER_NODE) {
        hasPlaceholder = true;
        return;
      }
      if (child.type?.name === 'text') {
        paragraphText += child.text || '';
      }
    });

    const normalizedFieldValue = paragraphText
      .replace(new RegExp(`^${escapeRegExp(fieldLabel)}：\\s*\\[`), '')
      .replace(/\]\s*$/, '')
      .trim();

    if (!hasPlaceholder && normalizedFieldValue.length > 0) {
      filledCount += 1;
    }
  });

  return {
    filledCount,
    totalCount: fields.length,
    isComplete: fields.length > 0 && filledCount === fields.length,
  };
};
const getVoiceSquareComposeParts = (editor) => {
  if (!editor || editor.isDestroyed) {
    return {
      scriptText: '',
      extraText: '',
    };
  }

  const paragraphs = [];
  editor.state.doc.forEach((node) => {
    if (node.type?.name === 'paragraph') {
      paragraphs.push(node);
    }
  });
  if (paragraphs.length === 0) {
    return {
      scriptText: '',
      extraText: '',
    };
  }

  let hasScriptPlaceholder = false;
  const beforeVoiceReferenceLines = [];
  const afterVoiceReferenceLines = [];
  let reachedVoiceReference = false;
  const getChildText = (child) => {
    if (!child) return '';
    if (child.type?.name === 'hardBreak') return '\n';
    if (child.type?.name === 'text') return child.text || '';
    return getInlineNodeText(child);
  };

  paragraphs.forEach((paragraph) => {
    let paragraphBeforeVoiceReferenceText = '';
    let paragraphAfterVoiceReferenceText = '';

    paragraph.forEach((child) => {
      if (child.type?.name === DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE) {
        hasScriptPlaceholder = true;
        return;
      }
      if (child.type?.name === 'fileReference' && child.attrs?.slotId === VOICE_SQUARE_SELECTED_VOICE_ID_SLOT_ID) {
        reachedVoiceReference = true;
        return true;
      }

      const childText = getChildText(child);
      if (!childText) return true;

      if (reachedVoiceReference) {
        paragraphAfterVoiceReferenceText += childText;
      } else {
        paragraphBeforeVoiceReferenceText += childText;
      }
      return true;
    });

    if (paragraphBeforeVoiceReferenceText) {
      beforeVoiceReferenceLines.push(paragraphBeforeVoiceReferenceText);
    }
    if (paragraphAfterVoiceReferenceText) {
      afterVoiceReferenceLines.push(paragraphAfterVoiceReferenceText);
    }
  });

  if (hasScriptPlaceholder) {
    return {
      scriptText: '',
      extraText: '',
    };
  }

  const scriptText = beforeVoiceReferenceLines
    .join('\n')
    .replace(/^将说话内容[:：]\s*\[/, '')
    .replace(/\]\s*利用音色\s*$/, '')
    .trim();
  const extraText = afterVoiceReferenceLines
    .join('\n')
    .replace(/^\s*合成语音。?\s*/, '')
    .trim();

  return {
    scriptText,
    extraText,
  };
};
const syncDigitalHumanVoiceReferenceNode = (
  editorInstance,
  selectedMode,
  selectedVoiceLibraryItem,
  selectedAvatar
) => {
  if (!editorInstance || editorInstance.isDestroyed) return;

  const nextAttrs = createDigitalHumanSelectedVoiceReferenceAttrs(
    selectedMode,
    selectedVoiceLibraryItem,
    selectedAvatar
  );
  let changed = false;
  const transaction = editorInstance.state.tr;

  editorInstance.state.doc.descendants((node, pos) => {
    if (node.type?.name !== 'fileReference') return true;
    if (node.attrs?.slotId !== DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID) return true;

    transaction.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      ...nextAttrs,
    });
    changed = true;
    return true;
  });

  if (changed) {
    editorInstance.view.dispatch(transaction);
  }
};
const syncVoiceSquareReferenceNode = (editorInstance, selectedVoiceLibraryItem) => {
  if (!editorInstance || editorInstance.isDestroyed) return;

  const nextAttrs = createVoiceSquareSelectedVoiceReferenceAttrs(selectedVoiceLibraryItem);
  let changed = false;
  const transaction = editorInstance.state.tr;

  editorInstance.state.doc.descendants((node, pos) => {
    if (node.type?.name !== 'fileReference') return true;
    if (node.attrs?.slotId !== VOICE_SQUARE_SELECTED_VOICE_ID_SLOT_ID) return true;

    transaction.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      ...nextAttrs,
    });
    changed = true;
    return true;
  });

  if (changed) {
    editorInstance.view.dispatch(transaction);
  }
};
const syncDigitalHumanMediaParagraph = (editorInstance, selectedMode, selectedAvatar) => {
  if (!editorInstance || editorInstance.isDestroyed) return;

  const currentDocument = editorInstance.getJSON();
  if (!Array.isArray(currentDocument?.content) || currentDocument.content.length < 3) return;

  const currentParagraph = currentDocument.content[2];
  const currentFileReferenceNode = Array.isArray(currentParagraph?.content)
    ? currentParagraph.content.find(
      (child) => child?.type === 'fileReference' && child?.attrs?.slotId === DIGITAL_HUMAN_VIDEO_SLOT_ID
    )
    : null;
  const nextParagraph = buildDigitalHumanMediaParagraph(
    selectedMode,
    currentFileReferenceNode?.attrs || {},
    selectedAvatar
  );

  if (JSON.stringify(currentParagraph) === JSON.stringify(nextParagraph)) return;

  const nextDocument = {
    ...currentDocument,
    content: [...currentDocument.content],
  };
  nextDocument.content[2] = nextParagraph;
  editorInstance.commands.setContent(nextDocument, false);
};

const getInlineNodeText = (node) => {
  if (!node) return '';
  if (node.type?.name === 'mention') {
  }
  if (node.type?.name === DIGITAL_HUMAN_MOTION_PLACEHOLDER_NODE) {
    return `[${node?.attrs?.text || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT}]`;
  }
  if (node.type?.name === 'fileReference') {
    return getFileReferenceNodeText(node.attrs);
  }
  return node.text || node.textContent || '';
};
const syncTemplateFileReferenceNode = (editorInstance, slotId, targetFile) => {
  if (!editorInstance || editorInstance.isDestroyed || !slotId || !targetFile?.uid) return false;

  let changed = false;
  const transaction = editorInstance.state.tr;

  editorInstance.state.doc.descendants((node, pos) => {
    if (node.type?.name !== 'fileReference') return true;
    if (node.attrs?.slotId !== slotId) return true;

    transaction.setNodeMarkup(pos, undefined, createFileReferenceAttrs(targetFile, {
      templateSlot: true,
      slotId,
      slotLabel: node.attrs?.slotLabel,
      acceptedKind: node.attrs?.acceptedKind,
      placeholderText: node.attrs?.placeholderText,
    }));
    changed = true;
    return true;
  });

  if (changed) {
    editorInstance.view.dispatch(transaction);
  }

  return changed;
};

const createFileReferenceExtension = ({ uploadedFilesRef, requestUploadPickerRef }) => {
  const FileReferenceNodeView = ({ node, selected, updateAttributes }) => {
    const file = node?.attrs || {};
    const isTemplateSlot = Boolean(file.templateSlot);
    const isPinnedVoiceReference = (
      file.slotId === DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID ||
      file.slotId === VOICE_SQUARE_SELECTED_VOICE_ID_SLOT_ID
    );
    const getAvailableFiles = React.useCallback(() => {
      return Array.isArray(uploadedFilesRef.current) ? uploadedFilesRef.current : [];
    }, [uploadedFilesRef]);

    const handleSelectFile = React.useCallback((targetFile) => {
      updateAttributes(createFileReferenceAttrs(targetFile, {
        templateSlot: true,
        slotId: file.slotId,
        slotLabel: file.slotLabel,
        placeholderText: file.placeholderText,
      }));
    }, [file.placeholderText, file.slotId, file.slotLabel, updateAttributes]);

    const renderPickerContent = () => {
      const availableFiles = getAvailableFiles().filter((item) => {
        if (!file.acceptedKind) return true;
        return getFileKindFromType(item?.fileType) === file.acceptedKind;
      });
      return (
        <div className={availableFiles.length === 0 ? 'chat-panel__skill-mention-panel--empty-upload' : ''}>
          <div className="chat-panel__skill-mention-list">
          {availableFiles.length > 0 ? (
            <>
              {availableFiles.map((item) => (
                <button
                  key={item.uid || item.url || item.name}
                  type="button"
                  className="chat-panel__skill-mention-item chat-panel__file-reference-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectFile(item)}
                >
                  <span className="chat-panel__file-reference-item-thumb">
                    {renderFileThumb(item)}
                  </span>
                  <span className="chat-panel__file-reference-item-main">
                    <span className="chat-panel__skill-mention-name">{getFileDisplayName(item)}</span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <div className="chat-panel__skill-mention-empty chat-panel__skill-mention-empty--upload">
              <Empty
                description="你还没有创建过引用"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                className="chat-panel__skill-mention-empty-state"
              />
              <Button
                type="default"
                className="chat-panel__skill-mention-empty-action"
                icon={<Plus className="chat-panel__skill-mention-empty-action-icon" />}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => requestUploadPickerRef.current && requestUploadPickerRef.current(file.slotId)}
              >
                上传引用
              </Button>
            </div>
          )}
          </div>
        </div>
      );
    };

    const nodeContent = file.uid ? (
      <span className="chat-panel__file-ref-chip">
        <span className="chat-panel__file-ref-thumb">
          {renderFileThumb(file, { showDuration: false })}
        </span>
        <span className="chat-panel__file-ref-label">{getFileDisplayName(file)}</span>
      </span>
    ) : (
      <span className="chat-panel__input-mention-token">[{file.placeholderText || FILE_SLOT_PLACEHOLDER}]</span>
    );

    return (
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        className={`chat-panel__file-ref-node ${selected ? 'is-selected' : ''}`}
      >
        {isPinnedVoiceReference ? nodeContent : (
          <Popover
            trigger="hover"
            placement="topLeft"
            classNames={{ root: 'chat-panel__file-ref-preview-popover' }}
            content={isTemplateSlot ? renderPickerContent : renderFilePreviewContent(file)}
          >
            {nodeContent}
          </Popover>
        )}
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: 'fileReference',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        uid: { default: '' },
        name: { default: '' },
        url: { default: '' },
        fileType: { default: '' },
        thumbnailUrl: { default: '' },
        previewUrl: { default: '' },
        localThumbUrl: { default: '' },
        localPreviewUrl: { default: '' },
        durationLabel: { default: '' },
        templateSlot: { default: false },
        slotId: { default: '' },
        slotLabel: { default: '' },
        acceptedKind: { default: '' },
        placeholderText: { default: FILE_SLOT_PLACEHOLDER },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-type="file-reference"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'file-reference' }), getFileReferenceNodeText(HTMLAttributes)];
    },

    renderText({ node }) {
      return getFileReferenceNodeText(node.attrs);
    },

    addNodeView() {
      return ReactNodeViewRenderer(FileReferenceNodeView);
    },
  });
};

const getActiveMentionStateFromSelection = (selection) => {
  if (!selection?.$from) {
    return null;
  }

  const { from, $from } = selection;
  const blockTextBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC');
  const atIndex = blockTextBeforeCursor.lastIndexOf('@');
  const hashIndex = blockTextBeforeCursor.lastIndexOf('#');
  const triggerIndex = Math.max(atIndex, hashIndex);

  if (triggerIndex < 0) {
    return null;
  }

  const symbol = blockTextBeforeCursor.charAt(triggerIndex);
  const query = blockTextBeforeCursor.slice(triggerIndex + 1);
  if (/[\s@#]/.test(query)) {
    return null;
  }

  return {
    open: true,
    symbol,
    query,
    start: $from.start() + triggerIndex,
    end: from,
  };
};

const getActiveMentionState = (editorInstance) => {
  if (!editorInstance || editorInstance.isDestroyed) {
    return null;
  }
  return getActiveMentionStateFromSelection(editorInstance.state.selection);
};

const getMentionPanelPosition = (editorInstance, containerElement, panelElement) => {
  if (!editorInstance || editorInstance.isDestroyed || !containerElement) {
    return {
      left: MENTION_PANEL_EDGE_OFFSET,
      top: 8,
    };
  }

  try {
    const { from } = editorInstance.state.selection;
    const caretCoordinates = editorInstance.view.coordsAtPos(from);
    const containerRect = containerElement.getBoundingClientRect();
    const panelWidth = panelElement?.offsetWidth || MENTION_PANEL_DEFAULT_WIDTH;
    const maxLeft = Math.max(
      MENTION_PANEL_EDGE_OFFSET,
      containerRect.width - panelWidth - MENTION_PANEL_EDGE_OFFSET
    );

    return {
      left: Math.min(
        Math.max(MENTION_PANEL_EDGE_OFFSET, caretCoordinates.left - containerRect.left),
        maxLeft
      ),
      top: Math.max(8, caretCoordinates.top - containerRect.top),
    };
  } catch (error) {
    return {
      left: MENTION_PANEL_EDGE_OFFSET,
      top: 8,
    };
  }
};

const insertInlineNodeAtView = (view, activeMentionState, nodeName, attrs) => {
  if (!view || !activeMentionState || !nodeName) return false;

  const inlineNodeType = view.state.schema.nodes[nodeName];
  if (!inlineNodeType) return false;

  const inlineNode = inlineNodeType.create(attrs);
  const fragment = Fragment.fromArray([inlineNode, view.state.schema.text(' ')]);
  const cursorPosition = activeMentionState.start + fragment.size;
  const transaction = view.state.tr.replaceWith(activeMentionState.start, activeMentionState.end, fragment);
  transaction.setSelection(TextSelection.create(transaction.doc, cursorPosition));

  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
};

const insertSkillMentionAtView = (view, activeMentionState, mentionLabel) => {
  if (!mentionLabel) return false;
  return insertInlineNodeAtView(view, activeMentionState, 'mention', {
    id: mentionLabel,
    label: mentionLabel,
  });
};

const insertFileReferenceAtView = (view, activeMentionState, file) => {
  if (!file?.uid) return false;
  return insertInlineNodeAtView(view, activeMentionState, 'fileReference', createFileReferenceAttrs(file));
};

const serializeEditorBlock = (node, buildMarkdownLink, referencedFileUids) => {
  if (!node) return '';

  let output = '';
  node.forEach((child) => {
    if (child.type?.name === 'text') {
      output += child.text || '';
      return;
    }

    if (child.type?.name === 'mention') {
      output += getMentionText(child.attrs);
      return;
    }

    if (child.type?.name === 'fileReference') {
      if (child.attrs?.uid) {
        referencedFileUids.add(child.attrs.uid);
      }
      if (child.attrs?.slotId === DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID) {
        output += child.attrs?.uid || child.attrs?.name || '音色id';
        return;
      }
      output += child.attrs?.url
        ? buildMarkdownLink(child.attrs.name || '附件', child.attrs.url)
        : getFileReferenceNodeText(child.attrs);
      return;
    }

    if (child.type?.name === DIGITAL_HUMAN_MOTION_PLACEHOLDER_NODE) {
      output += `[${child.attrs?.text || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT}]`;
      return;
    }

    if (child.type?.name === 'hardBreak') {
      output += '\n';
      return;
    }

    output += serializeEditorBlock(child, buildMarkdownLink, referencedFileUids);
  });

  return output;
};

const serializeEditorMessage = (editor, buildMarkdownLink) => {
  if (!editor || editor.isDestroyed) {
    return { text: '', referencedFileUids: new Set() };
  }

  const referencedFileUids = new Set();
  const lines = [];
  editor.state.doc.forEach((block) => {
    lines.push(serializeEditorBlock(block, buildMarkdownLink, referencedFileUids));
  });

  return {
    text: lines.join('\n').trim(),
    referencedFileUids,
  };
};

const buildEditorDocument = (value, mentionRegex) => {
  const text = String(value || '');
  const lines = text.split('\n');

  const content = lines.map((line) => {
    if (!line) {
      return { type: 'paragraph' };
    }

    if (!mentionRegex) {
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: line }],
      };
    }

    const inlineContent = [];
    let lastIndex = 0;
    mentionRegex.lastIndex = 0;
    let match = mentionRegex.exec(line);

    while (match) {
      const matchText = match[0];
      const matchIndex = match.index;
      const label = matchText.slice(1);

      if (matchIndex > lastIndex) {
        inlineContent.push({
          type: 'text',
          text: line.slice(lastIndex, matchIndex),
        });
      }

      inlineContent.push({
        type: 'mention',
        attrs: {
          id: label,
          label,
        },
      });

      lastIndex = matchIndex + matchText.length;
      match = mentionRegex.exec(line);
    }

    if (lastIndex < line.length) {
      inlineContent.push({
        type: 'text',
        text: line.slice(lastIndex),
      });
    }

    return inlineContent.length > 0
      ? { type: 'paragraph', content: inlineContent }
      : { type: 'paragraph' };
  });

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
};

const mapDocPositionToTextOffset = (editor, targetPosition) => {
  if (!editor || editor.isDestroyed) return 0;

  const { doc } = editor.state;
  let textOffset = 0;
  let result = null;

  doc.forEach((block, blockOffset, blockIndex) => {
    if (result !== null) return;

    const blockStart = blockOffset + 1;
    const blockEnd = blockStart + block.content.size;

    if (targetPosition <= blockStart) {
      result = textOffset;
      return;
    }

    block.forEach((child, childOffset) => {
      if (result !== null) return;

      const childStart = blockStart + childOffset;
      const childText = getInlineNodeText(child);
      const childLength = childText.length;

      if (child.isText) {
        const childEnd = childStart + childLength;
        if (targetPosition <= childEnd) {
          result = textOffset + Math.max(0, targetPosition - childStart);
          return;
        }
      } else {
        const childEnd = childStart + child.nodeSize;
        if (targetPosition <= childEnd) {
          result = textOffset + (targetPosition <= childStart ? 0 : childLength);
          return;
        }
      }

      textOffset += childLength;
    });

    if (result !== null) return;

    if (targetPosition <= blockEnd) {
      result = textOffset;
      return;
    }

    if (blockIndex < doc.childCount - 1) {
      textOffset += 1;
      if (targetPosition <= blockOffset + block.nodeSize) {
        result = textOffset;
      }
    }
  });

  if (result !== null) return result;
  return textOffset;
};

const mapTextOffsetToDocPosition = (editor, targetOffset) => {
  if (!editor || editor.isDestroyed) return 0;

  const text = getEditorPlainText(editor);
  const clampedOffset = Math.max(0, Math.min(Number(targetOffset) || 0, text.length));
  const { doc } = editor.state;
  let currentOffset = 0;
  let result = doc.content.size;

  doc.forEach((block, blockOffset, blockIndex) => {
    if (result !== doc.content.size) return;

    const blockStart = blockOffset + 1;
    const blockEnd = blockStart + block.content.size;

    if (clampedOffset <= currentOffset) {
      result = blockStart;
      return;
    }

    block.forEach((child, childOffset) => {
      if (result !== doc.content.size) return;

      const childStart = blockStart + childOffset;
      const childText = getInlineNodeText(child);
      const childLength = childText.length;

      if (child.isText) {
        if (clampedOffset <= currentOffset + childLength) {
          result = childStart + (clampedOffset - currentOffset);
          return;
        }
      } else {
        if (clampedOffset <= currentOffset) {
          result = childStart;
          return;
        }
        if (clampedOffset <= currentOffset + childLength) {
          result = childStart + child.nodeSize;
          return;
        }
      }

      currentOffset += childLength;
    });

    if (result !== doc.content.size) return;

    if (clampedOffset <= currentOffset) {
      result = blockEnd;
      return;
    }

    if (blockIndex < doc.childCount - 1) {
      if (clampedOffset <= currentOffset + 1) {
        result = blockEnd;
        return;
      }
      currentOffset += 1;
    }
  });

  return result;
};

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
  const [selectedAiWritePresetId, setSelectedAiWritePresetId] = React.useState(() => getDefaultAiWritePresetId());
  const [selectedDigitalHumanMode, setSelectedDigitalHumanMode] = React.useState(() => readPersistedDigitalHumanMode());
  const [selectedDigitalHumanAvatar, setSelectedDigitalHumanAvatar] = React.useState(() => readPersistedDigitalHumanAvatarSelection());
  const [selectedVoiceLibraryItem, setSelectedVoiceLibraryItem] = React.useState(() =>
    getInitialSelectedVoiceLibraryItem()
  );
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [hoveredModelCard, setHoveredModelCard] = React.useState(null);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  const [skillsError, setSkillsError] = React.useState('');
  const [skills, setSkills] = React.useState([]);
  const [mentionState, setMentionState] = React.useState({
    open: false,
    symbol: '',
    query: '',
    start: -1,
    end: -1,
    activeIndex: 0,
  });
  const [mentionPanelPosition, setMentionPanelPosition] = React.useState({
    left: MENTION_PANEL_EDGE_OFFSET,
    top: 8,
  });
  const mentionCloseTimerRef = React.useRef(null);
  const dragCounterRef = React.useRef(0);
  const latestInputRef = React.useRef(String(input || ''));
  const queueFilesForUploadRef = React.useRef(() => {});
  const latestMentionStateRef = React.useRef(mentionState);
  const latestFilteredSkillsRef = React.useRef([]);
  const latestSkillsRef = React.useRef(skills);
  const latestUploadedFileMetaRef = React.useRef(uploadedFileMeta);
  const handleSendWithAttachmentsRef = React.useRef(() => {});
  const mentionPanelPointerDownRef = React.useRef(false);
  const requestUploadPickerRef = React.useRef(() => {});
  const toolbarUploadTriggerRef = React.useRef(null);
  const pendingTemplateSlotAutoReferenceRef = React.useRef('');
  const inputWrapRef = React.useRef(null);
  const mentionPanelRef = React.useRef(null);
  const modelHoverCardRef = React.useRef(null);
  const [isDragActive, setIsDragActive] = React.useState(false);
  const inputPlaceholder =
    activeTool === 'digital-human'
      ? ''
      : '@技能成员，#引用，输入消息，Enter 发送，Shift+Enter 换行';

  requestUploadPickerRef.current = (slotId = '') => {
    pendingTemplateSlotAutoReferenceRef.current = slotId || '';
    toolbarUploadTriggerRef.current?.click?.();
  };

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

  React.useEffect(() => {
    latestInputRef.current = String(input || '');
  }, [input]);

  const closeMentionPanel = React.useCallback(() => {
    setMentionState((prev) => ({ ...prev, open: false, symbol: '', query: '', start: -1, end: -1, activeIndex: 0 }));
  }, []);

  const cancelMentionClose = React.useCallback(() => {
    if (mentionCloseTimerRef.current) {
      window.clearTimeout(mentionCloseTimerRef.current);
      mentionCloseTimerRef.current = null;
    }
  }, []);

  const mentionHighlightRegex = React.useMemo(() => {
    const escapedNames = skills
      .map((skill) => getSkillMentionLabel(skill))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .map((name) => escapeRegExp(name));

    if (escapedNames.length === 0) return null;

    return new RegExp(`@(?:${escapedNames.join('|')})(?=$|${MENTION_TOKEN_BOUNDARY})`, 'gi');
  }, [skills]);

  const updateMentionPanelPosition = React.useCallback((editorInstance) => {
    const nextPosition = getMentionPanelPosition(
      editorInstance,
      inputWrapRef.current,
      mentionPanelRef.current
    );
    setMentionPanelPosition((prev) => (
      prev.left === nextPosition.left && prev.top === nextPosition.top
        ? prev
        : nextPosition
    ));
  }, []);

  const syncMentionState = React.useCallback((editorInstance) => {
    const nextMentionState = getActiveMentionState(editorInstance);
    if (!nextMentionState) {
      closeMentionPanel();
      return;
    }

    updateMentionPanelPosition(editorInstance);
    setMentionState((prev) => ({
      ...prev,
      ...nextMentionState,
      activeIndex: prev.open && prev.query === nextMentionState.query ? prev.activeIndex : 0,
    }));
  }, [closeMentionPanel, updateMentionPanelPosition]);

  const filteredSkills = React.useMemo(() => {
    if (mentionState.symbol !== '@') return skills;
    const query = String(mentionState.query || '').trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) => String(skill?.name || '').toLowerCase().startsWith(query));
  }, [mentionState.query, mentionState.symbol, skills]);

  const filteredUploadedFiles = React.useMemo(() => {
    const query = String(mentionState.query || '').trim().toLowerCase();
    const source = Array.isArray(uploadedFileMeta) ? uploadedFileMeta : [];
    if (mentionState.symbol !== '#') return source;
    if (!query) return source;
    return source.filter((file) => (
      String(file?.name || '').toLowerCase().includes(query)
    ));
  }, [mentionState.query, mentionState.symbol, uploadedFileMeta]);

  React.useEffect(() => {
    latestMentionStateRef.current = mentionState;
  }, [mentionState]);

  React.useEffect(() => {
    latestFilteredSkillsRef.current = filteredSkills;
  }, [filteredSkills]);

  React.useEffect(() => {
    latestSkillsRef.current = skills;
  }, [skills]);

  React.useEffect(() => {
    latestUploadedFileMetaRef.current = uploadedFileMeta;
  }, [uploadedFileMeta]);

  const fileReferenceExtension = React.useMemo(() => (
    createFileReferenceExtension({
      uploadedFilesRef: latestUploadedFileMetaRef,
      requestUploadPickerRef,
    })
  ), []);
  const aiWriteFieldPlaceholderExtension = React.useMemo(
    () => createAiWriteFieldPlaceholderExtension(),
    []
  );
  const digitalHumanScriptPlaceholderExtension = React.useMemo(
    () => createDigitalHumanScriptPlaceholderExtension(),
    []
  );
  const digitalHumanMotionPlaceholderExtension = React.useMemo(
    () => createDigitalHumanMotionPlaceholderExtension(),
    []
  );

  React.useEffect(() => () => {
    latestUploadedFileMetaRef.current.forEach((item) => {
      revokeLocalObjectUrl(item?.localThumbUrl);
    });
  }, []);

  const activeSuggestionItems = mentionState.symbol === '#'
    ? filteredUploadedFiles
    : filteredSkills;

  React.useEffect(() => {
    if (!mentionState.open) return;
    if (activeSuggestionItems.length === 0) {
      setMentionState((prev) => ({ ...prev, activeIndex: 0 }));
      return;
    }
    if (mentionState.activeIndex > activeSuggestionItems.length - 1) {
      setMentionState((prev) => ({ ...prev, activeIndex: 0 }));
    }
  }, [activeSuggestionItems.length, mentionState.activeIndex, mentionState.open]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Mention.extend({
        renderText({ node }) {
          return getMentionText(node.attrs);
        },
        renderHTML({ node, HTMLAttributes }) {
          return ['span', mergeAttributes(HTMLAttributes, { class: 'chat-panel__input-mention-token' }), getMentionText(node.attrs)];
        },
      }).configure({
        HTMLAttributes: {
          class: 'chat-panel__input-mention-token',
        },
      }),
      aiWriteFieldPlaceholderExtension,
      digitalHumanScriptPlaceholderExtension,
      digitalHumanMotionPlaceholderExtension,
      fileReferenceExtension,
    ],
    editorProps: {
      attributes: {
        class: 'chat-panel__input-prosemirror',
      },
      handleKeyDown: (view, event) => {
        const liveMentionState = getActiveMentionStateFromSelection(view.state.selection);
        const liveFilteredSkills = liveMentionState?.symbol === '@'
          ? latestSkillsRef.current.filter((skill) => {
            const liveQuery = String(liveMentionState.query || '').trim().toLowerCase();
            if (!liveQuery) return true;
            return String(skill?.name || '').toLowerCase().startsWith(liveQuery);
          })
          : [];
        const liveFilteredFiles = liveMentionState?.symbol === '#'
          ? latestUploadedFileMetaRef.current.filter((file) => {
            const liveQuery = String(liveMentionState.query || '').trim().toLowerCase();
            if (!liveQuery) return true;
            return String(file?.name || '').toLowerCase().includes(liveQuery);
          })
          : [];
        const liveSuggestionItems = liveMentionState?.symbol === '#'
          ? liveFilteredFiles
          : liveFilteredSkills;

        if (liveMentionState?.open) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setMentionState((prev) => ({
              ...prev,
              activeIndex: liveSuggestionItems.length > 0 ? (prev.activeIndex + 1) % liveSuggestionItems.length : 0,
            }));
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setMentionState((prev) => ({
              ...prev,
              activeIndex: liveSuggestionItems.length > 0
                ? (prev.activeIndex - 1 + liveSuggestionItems.length) % liveSuggestionItems.length
                : 0,
            }));
            return true;
          }
          if ((event.key === 'Enter' || event.key === 'Tab') && liveSuggestionItems.length > 0) {
            event.preventDefault();
            const activeIndex = latestMentionStateRef.current?.activeIndex || 0;
            const activeItem = liveSuggestionItems[activeIndex] || liveSuggestionItems[0];

            if (liveMentionState.symbol === '@') {
              if (insertSkillMentionAtView(view, liveMentionState, getSkillMentionLabel(activeItem))) {
                closeMentionPanel();
                return true;
              }
            }

            if (liveMentionState.symbol === '#') {
              if (insertFileReferenceAtView(view, liveMentionState, activeItem)) {
                closeMentionPanel();
                return true;
              }
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            closeMentionPanel();
            return true;
          }
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          handleSendWithAttachmentsRef.current();
          return true;
        }

        return false;
      },
      handlePaste: (_, event) => {
        const clipboardItems = Array.from(event.clipboardData?.items || []);
        const files = clipboardItems
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter(Boolean);
        const fallbackFiles = Array.from(event.clipboardData?.files || []).filter(Boolean);
        const pastedFiles = files.length > 0 ? files : fallbackFiles;
        if (pastedFiles.length === 0) return false;
        event.preventDefault();
        queueFilesForUploadRef.current(pastedFiles);
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextText = getEditorPlainText(currentEditor);
      if (nextText !== latestInputRef.current) {
        latestInputRef.current = nextText;
        setInput(nextText);
      }
      syncMentionState(currentEditor);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      syncMentionState(currentEditor);
    },
    onBlur: () => {
      if (mentionPanelPointerDownRef.current) {
        mentionPanelPointerDownRef.current = false;
        return;
      }
      mentionCloseTimerRef.current = window.setTimeout(() => {
        closeMentionPanel();
      }, SKILL_MENTION_CLOSE_DELAY);
    },
    onFocus: ({ editor: currentEditor }) => {
      cancelMentionClose();
      syncMentionState(currentEditor);
    },
  });

  React.useEffect(() => {
    if (!mentionState.open || !editor || editor.isDestroyed) return undefined;

    const schedulePositionUpdate = () => {
      window.requestAnimationFrame(() => {
        updateMentionPanelPosition(editor);
      });
    };

    const scrollElement = editor.view.dom;
    schedulePositionUpdate();
    scrollElement.addEventListener('scroll', schedulePositionUpdate);
    window.addEventListener('resize', schedulePositionUpdate);

    return () => {
      scrollElement.removeEventListener('scroll', schedulePositionUpdate);
      window.removeEventListener('resize', schedulePositionUpdate);
    };
  }, [editor, mentionState.open, updateMentionPanelPosition]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const currentText = getEditorPlainText(editor);
    const nextText = String(input || '');
    if (currentText === nextText) return;

    const selection = {
      start: mapDocPositionToTextOffset(editor, editor.state.selection.from),
      end: mapDocPositionToTextOffset(editor, editor.state.selection.to),
    };

    editor.commands.setContent(buildEditorDocument(nextText, mentionHighlightRegex), false);

    const nextPlainText = getEditorPlainText(editor);
    const nextSelectionEnd = Math.min(selection.end, nextPlainText.length);
    const nextSelectionStart = Math.min(selection.start, nextSelectionEnd);
    const from = mapTextOffsetToDocPosition(editor, nextSelectionStart);
    const to = mapTextOffsetToDocPosition(editor, nextSelectionEnd);
    editor.commands.setTextSelection({ from, to });
  }, [editor, input, mentionHighlightRegex]);

  React.useEffect(() => {
    if (!inputRef) return undefined;

    const controller = {
      focus: () => {
        if (!editor || editor.isDestroyed) return;
        editor.commands.focus();
      },
      blur: () => {
        editor?.view?.dom?.blur?.();
      },
      isFocused: () => Boolean(editor && !editor.isDestroyed && editor.isFocused),
      getSelectionRange: () => {
        if (!editor || editor.isDestroyed) {
          return { start: 0, end: 0 };
        }
        return {
          start: mapDocPositionToTextOffset(editor, editor.state.selection.from),
          end: mapDocPositionToTextOffset(editor, editor.state.selection.to),
        };
      },
      setSelectionRange: (start, end = start) => {
        if (!editor || editor.isDestroyed) return;
        const from = mapTextOffsetToDocPosition(editor, start);
        const to = mapTextOffsetToDocPosition(editor, end);
        editor.chain().focus().setTextSelection({ from, to }).run();
      },
      get value() {
        return getEditorPlainText(editor);
      },
      get selectionStart() {
        return this.getSelectionRange().start;
      },
      get selectionEnd() {
        return this.getSelectionRange().end;
      },
    };

    inputRef.current = controller;

    return () => {
      if (inputRef.current === controller) {
        inputRef.current = null;
      }
    };
  }, [editor, inputRef]);

  const insertSkillMention = React.useCallback((skill) => {
    const mentionLabel = getSkillMentionLabel(skill);
    if (!editor || editor.isDestroyed || !mentionLabel || mentionState.start < 0 || mentionState.end < mentionState.start) return;

    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: mentionState.start, to: mentionState.end },
        [
          {
            type: 'mention',
            attrs: {
              id: mentionLabel,
              label: mentionLabel,
            },
          },
          {
            type: 'text',
            text: ' ',
          },
        ]
      )
      .run();
    closeMentionPanel();
  }, [closeMentionPanel, editor, mentionState.end, mentionState.start]);

  const insertFileReference = React.useCallback((file) => {
    if (!editor || editor.isDestroyed || !file?.uid || mentionState.start < 0 || mentionState.end < mentionState.start) return;

    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: mentionState.start, to: mentionState.end },
        [
          {
            type: 'fileReference',
            attrs: createFileReferenceAttrs(file),
          },
          {
            type: 'text',
            text: ' ',
          },
        ]
      )
      .run();
    closeMentionPanel();
  }, [closeMentionPanel, editor, mentionState.end, mentionState.start]);

  const handleOpenPricingDoc = (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      shell.openExternal('https://docs.vectcut.com/7834799m0');
    } catch (error) {
      window.open('https://docs.vectcut.com/7834799m0', '_blank');
    }
  };

  const formatModelOptionPrice = (value) => {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue.toFixed(1);
    }
    return String(value || '')
      .replace(/\/\s*千token/gi, '')
      .replace(/[,\s]+$/g, '')
      .trim();
  };

  const resolveModelOptionPricing = (item) => {
    if (!item || typeof item !== 'object') return { input: '', output: '' };
    const pricing = item?.pricing && typeof item.pricing === 'object' ? item.pricing : null;
    const input = formatModelOptionPrice(
      pricing?.input_resource_points_per_unit ?? pricing?.input ?? pricing?.input_price_text
    );
    const output = formatModelOptionPrice(
      pricing?.output_resource_points_per_unit ?? pricing?.output ?? pricing?.output_price_text
    );
    return { input, output };
  };

  const renderModelOptionPopoverContent = (text, description = '', priceMeta = null) => {
    if (!description && !priceMeta?.input && !priceMeta?.output) return null;
    return (
      <div className="chat-panel__model-option-popover">
        <div className="chat-panel__model-option-popover-title">{text}</div>
        {description ? (
          <div className="chat-panel__model-option-popover-description">{description}</div>
        ) : null}
        {(priceMeta?.input || priceMeta?.output) ? (
          <div className="chat-panel__model-option-popover-section">
            {priceMeta?.input ? (
              <div className="chat-panel__model-option-popover-row">
                <img className="chat-panel__model-option-popover-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
                <span>{priceMeta.input} / 1,000 tokens</span>
                <span className="chat-panel__model-option-popover-price-name">↑</span>
              </div>
            ) : null}
            {priceMeta?.output ? (
              <div className="chat-panel__model-option-popover-row">
                <img className="chat-panel__model-option-popover-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
                <span>{priceMeta.output} / 1,000 tokens</span>
                <span className="chat-panel__model-option-popover-price-name">↓</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderModelOptionInner = (text, icon, supportsReadImage = false, badges = []) => (
    <span className="chat-panel__model-option">
      <span className="chat-panel__model-option-main">
        {icon ? <img className="chat-panel__model-option-icon" src={icon} alt="" /> : null}
        <span className="chat-panel__model-option-text">{text}</span>
      </span>
      <span className="chat-panel__model-option-tags">
        {supportsReadImage ? <span className="chat-panel__model-option-tag">识图</span> : null}
        {Array.isArray(badges) ? badges.map((badge) => (
          <span
            key={badge}
            className={`chat-panel__model-option-tag ${badge === '限时优惠' ? 'chat-panel__model-option-tag--promo' : ''}`}
          >
            {badge}
          </span>
        )) : null}
      </span>
    </span>
  );

  const renderSelectedModelLabel = (text, icon) => (
    <span className="chat-panel__model-option-main chat-panel__model-option-main--selected">
      {icon ? <img className="chat-panel__model-option-icon" src={icon} alt="" /> : null}
      <span className="chat-panel__model-option-text">{text}</span>
    </span>
  );

  const computeModelHoverCardPosition = React.useCallback((anchorRect, cardSize = {}) => {
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const cardWidth = Number(cardSize?.width) || MODEL_HOVER_CARD_WIDTH;
    const cardHeight = Number(cardSize?.height) || 0;
    let left = anchorRect.left - cardWidth - MODEL_HOVER_CARD_GAP;
    if (left < MODEL_HOVER_CARD_VIEWPORT_MARGIN) {
      left = anchorRect.right + MODEL_HOVER_CARD_GAP;
    }
    const maxLeft = Math.max(MODEL_HOVER_CARD_VIEWPORT_MARGIN, viewportWidth - cardWidth - MODEL_HOVER_CARD_VIEWPORT_MARGIN);
    left = Math.min(Math.max(MODEL_HOVER_CARD_VIEWPORT_MARGIN, left), maxLeft);

    let top = anchorRect.top;
    const maxTop = Math.max(MODEL_HOVER_CARD_VIEWPORT_MARGIN, viewportHeight - cardHeight - MODEL_HOVER_CARD_VIEWPORT_MARGIN);
    top = Math.min(Math.max(MODEL_HOVER_CARD_VIEWPORT_MARGIN, top), maxTop);

    return { left, top };
  }, []);

  const clearHoveredModelCard = React.useCallback(() => {
    setHoveredModelCard(null);
  }, []);

  const showHoveredModelCard = React.useCallback((optionMeta, currentTarget) => {
    if (!optionMeta?.value || !currentTarget) return;
    const anchorRect = currentTarget.getBoundingClientRect();
    const normalizedAnchorRect = {
      top: anchorRect.top,
      right: anchorRect.right,
      bottom: anchorRect.bottom,
      left: anchorRect.left,
    };
    const nextPosition = computeModelHoverCardPosition(normalizedAnchorRect, { width: MODEL_HOVER_CARD_WIDTH });
    setHoveredModelCard({
      key: String(optionMeta.value),
      text: String(optionMeta.displayText || optionMeta.value || '').trim(),
      description: String(optionMeta.description || '').trim(),
      priceMeta: optionMeta.priceMeta || null,
      anchorRect: normalizedAnchorRect,
      left: nextPosition.left,
      top: nextPosition.top,
    });
  }, [computeModelHoverCardPosition]);

  React.useLayoutEffect(() => {
    if (!hoveredModelCard || !modelHoverCardRef.current) return;
    const cardRect = modelHoverCardRef.current.getBoundingClientRect();
    const nextPosition = computeModelHoverCardPosition(hoveredModelCard.anchorRect, {
      width: cardRect.width,
      height: cardRect.height,
    });
    if (Math.abs(nextPosition.left - hoveredModelCard.left) < 1 && Math.abs(nextPosition.top - hoveredModelCard.top) < 1) {
      return;
    }
    setHoveredModelCard((current) => {
      if (!current || current.key !== hoveredModelCard.key) return current;
      return { ...current, left: nextPosition.left, top: nextPosition.top };
    });
  }, [computeModelHoverCardPosition, hoveredModelCard]);

  React.useEffect(() => {
    if (!modelPickerOpen) return undefined;
    const handleViewportChange = () => {
      clearHoveredModelCard();
    };
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [clearHoveredModelCard, modelPickerOpen]);

  const availableModelOptions = (Array.isArray(modelOptions) ? modelOptions : [])
    .map((item) => {
      if (typeof item === 'string') {
        const displayText = formatModelDisplayName(item);
        return {
          value: item,
          label: displayText,
          displayText,
          icon: '',
          supportsReadImage: false,
          description: '',
          badges: [],
          priceMeta: null,
          selectedLabel: renderSelectedModelLabel(displayText, null),
        };
      }
      const value = item?.value;
      const labelText = item?.label || item?.name || item?.value || item?.id || '';
      const displayText = formatModelDisplayName(labelText);
      const icon = item?.icon || item?.iconUrl || item?.black_icon || '';
      const supportsReadImage = Boolean(item?.read_image);
      const priceMeta = resolveModelOptionPricing(item);
      return value ? {
        value,
        label: displayText,
        displayText,
        icon,
        supportsReadImage,
        description: String(item?.description || '').trim(),
        badges: Array.isArray(item?.badges) ? item.badges : [],
        priceMeta,
        selectedLabel: renderSelectedModelLabel(displayText, icon),
      } : null;
    })
    .filter(Boolean);
  const selectedModelConfig = (Array.isArray(modelOptions) ? modelOptions : []).find((item) => {
    if (!item || typeof item !== 'object') return false;
    const candidateValue = String(item?.value || item?.id || item?.name || '').trim();
    return candidateValue && candidateValue === String(model || '').trim();
  }) || null;
  const selectedModelSupportsReadImage = Boolean(selectedModelConfig?.read_image);

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
                  由 <span className="chat-panel__model-tip-brand">流光剪辑</span> 提供的模型列表
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
  const digitalHumanCompletionState = React.useMemo(
    () => getDigitalHumanTemplateCompletionState(editor),
    [editor, input]
  );
  const aiWriteCompletionState = React.useMemo(
    () => getAiWriteTemplateCompletionState(editor, selectedAiWritePresetId),
    [editor, input, selectedAiWritePresetId]
  );
  const canSend = String(input || '').trim().length > 0 || uploadedMarkdownLinks.length > 0;
  const isDigitalHumanSendBlocked = activeTool === 'digital-human' && !digitalHumanCompletionState.isComplete;
  const isAiWriteSendBlocked = activeTool === 'ai-write' && !aiWriteCompletionState.isComplete;
  const isSendDisabled = !canSend || modelListLoading || hasUploadingFile || isDigitalHumanSendBlocked || isAiWriteSendBlocked;

  const handleBeforeUpload = (file, batchFileList = []) => {
    const type = String(file?.type || '');
    const isAllowedType = type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/');
    if (!file || !isAllowedType) {
      message.error('仅支持上传图片、视频、音频文件');
      return AntUpload.LIST_IGNORE;
    }
    if (file.size > MAX_UPLOAD_FILE_SIZE) {
      message.error('单个文件大小不能超过 500MB，可去官网资产库上传更大文件');
      return AntUpload.LIST_IGNORE;
    }
    const currentCount = uploadFileList.filter((item) => item.status !== 'removed').length;
    const availableSlots = Math.max(0, MAX_UPLOAD_COUNT - currentCount);
    const batchIndex = batchFileList.findIndex((item) => item.uid === file.uid);
    if (availableSlots <= 0 || (batchIndex >= 0 && batchIndex >= availableSlots)) {
      message.error(`最多上传 ${MAX_UPLOAD_COUNT} 个文件`);
      return AntUpload.LIST_IGNORE;
    }
    return true;
  };

  const handleUploadListChange = React.useCallback((fileList) => {
    const nextList = fileList.slice(-MAX_UPLOAD_COUNT);
    const uidSet = new Set(nextList.map((item) => item.uid));
    setUploadFileList(nextList);
    setUploadedFileMeta((prev) => {
      const removedItems = prev.filter((item) => !uidSet.has(item.uid));
      removedItems.forEach((item) => {
        revokeLocalObjectUrl(item?.localThumbUrl);
      });
      return prev.filter((item) => uidSet.has(item.uid));
    });
  }, []);

  const handleFileUpload = async ({ file, onProgress, onSuccess, onError }) => {
    const targetFile = file instanceof File ? file : file?.originFileObj;
    const uid = file?.uid || targetFile?.uid || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const localThumbUrl = createLocalObjectUrl(targetFile);
    if (!targetFile) {
      const error = new Error('INVALID_FILE');
      onError && onError(error);
      return;
    }
    try {
      const durationLabel = getFileKindFromType(targetFile?.type || file?.type || '') === 'video'
        ? await readMediaDuration(localThumbUrl, 'video')
        : '';
      const result = await uploadToOSSWithProgress(targetFile, (event) => {
        onProgress && onProgress({ percent: Number(event?.percent || 0) }, targetFile);
      });
      onSuccess && onSuccess(result, targetFile);
      if (result?.publicUrl) {
        const normalizedUrl = stripUrlSearch(result.publicUrl);
        const uploadedFile = {
          uid,
          url: normalizedUrl,
          name: targetFile?.name || file?.name || '附件',
          fileType: targetFile?.type || file?.type || '',
          thumbnailUrl: normalizedUrl,
          previewUrl: normalizedUrl,
          localThumbUrl,
          localPreviewUrl: localThumbUrl,
          durationLabel,
        };
        setUploadedFileMeta((prev) => {
          const next = prev.filter((item) => item.uid !== uid);
          const previousItem = prev.find((item) => item.uid === uid);
          if (previousItem?.localThumbUrl && previousItem.localThumbUrl !== localThumbUrl) {
            revokeLocalObjectUrl(previousItem.localThumbUrl);
          }
          next.push(uploadedFile);
          return next;
        });
        const pendingSlotId = pendingTemplateSlotAutoReferenceRef.current;
        if (pendingSlotId) {
          syncTemplateFileReferenceNode(editor, pendingSlotId, uploadedFile);
          pendingTemplateSlotAutoReferenceRef.current = '';
        }
      } else {
        revokeLocalObjectUrl(localThumbUrl);
      }
      message.success('文件上传成功');
    } catch (error) {
      onError && onError(error);
      revokeLocalObjectUrl(localThumbUrl);
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

  React.useEffect(() => {
    queueFilesForUploadRef.current = queueFilesForUpload;
  }, [queueFilesForUpload]);

  const hasDraggedFiles = React.useCallback((event) => {
    const dataTransferTypes = Array.from(event?.dataTransfer?.types || []);
    return dataTransferTypes.includes('Files');
  }, []);

  const resetDragState = React.useCallback(() => {
    dragCounterRef.current = 0;
    setIsDragActive(false);
  }, []);

  const handleInputDragEnter = React.useCallback((event) => {
    if (sessionSending || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  }, [hasDraggedFiles, sessionSending]);

  const handleInputDragOver = React.useCallback((event) => {
    if (sessionSending || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (!isDragActive) {
      setIsDragActive(true);
    }
  }, [hasDraggedFiles, isDragActive, sessionSending]);

  const handleInputDragLeave = React.useCallback((event) => {
    if (sessionSending || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragActive(false);
    }
  }, [hasDraggedFiles, sessionSending]);

  const handleInputDrop = React.useCallback((event) => {
    if (sessionSending || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const droppedFiles = Array.from(event.dataTransfer?.files || []).filter(Boolean);
    resetDragState();
    if (droppedFiles.length === 0) return;
    queueFilesForUpload(droppedFiles);
  }, [hasDraggedFiles, queueFilesForUpload, resetDragState, sessionSending]);

  const collectImagePayloads = React.useCallback(async () => {
    if (!selectedModelSupportsReadImage) return [];
    const uploadedImageTypesByUid = new Map(
      uploadedFileMeta
        .filter((item) => String(item?.fileType || '').toLowerCase().startsWith('image/'))
        .map((item) => [String(item.uid || '').trim(), String(item.fileType || '').trim()])
    );
    const imageFiles = uploadFileList
      .filter((item) => item?.status !== 'removed')
      .map((item) => item?.originFileObj || item)
      .filter((file) => file instanceof File)
      .filter((file) => {
        const uid = String(file?.uid || '').trim();
        const mimeType = uploadedImageTypesByUid.get(uid) || String(file?.type || '').trim();
        return mimeType.toLowerCase().startsWith('image/');
      });
    if (imageFiles.length === 0) return [];
    const payloads = await Promise.all(imageFiles.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file);
      const [, base64 = ''] = dataUrl.split(',', 2);
      if (!base64) return null;
      return {
        data: base64,
        media_type: String(file?.type || 'image/png').trim() || 'image/png',
      };
    }));
    return payloads.filter(Boolean);
  }, [selectedModelSupportsReadImage, uploadFileList, uploadedFileMeta]);

  const handleSendWithAttachments = async () => {
    if (isSendDisabled) return;
    let imagePayloads = [];
    try {
      imagePayloads = await collectImagePayloads();
    } catch (error) {
      console.warn('[Composer] failed to collect image payloads', error);
    }
    const serializedMessage = serializeEditorMessage(editor, buildMarkdownFileLink);
    const hasMultimodalImages = selectedModelSupportsReadImage && imagePayloads.length > 0;
    const imageAttachmentPreviews = hasMultimodalImages
      ? uploadedFileMeta
        .filter((item) => String(item?.fileType || '').toLowerCase().startsWith('image/'))
        .map((item) => createFileReferenceAttrs(item, {
          localThumbUrl: '',
          localPreviewUrl: ''
        }))
      : [];
    const remainingUploadedLinks = uploadedFileMeta
      .filter((item) => item?.url && !serializedMessage.referencedFileUids.has(item.uid))
      .map((item) => buildMarkdownFileLink(item.name, item.url));
    const voiceSquareComposeParts = activeTool === 'voice-square'
      ? getVoiceSquareComposeParts(editor)
      : null;
    const text = activeTool === 'voice-square'
      ? voiceSquareComposeParts?.scriptText || ''
      : serializedMessage.text || String(input || '').trim();
    const combined = [text, ...remainingUploadedLinks].filter(Boolean).join('\n');
    if (!combined) return;
    const nextMessage =
      activeTool === 'voice-square'
        ? [
          `将说话内容: [${combined}] 利用音色${selectedVoiceLibraryItem?.global_voice_id || '默认音色'}合成语音。`,
          voiceSquareComposeParts?.extraText || '',
        ].filter(Boolean).join(' ')
        : combined;
    closeMentionPanel();
    handleSend && handleSend(nextMessage, {
      images: imagePayloads,
      imageAttachmentPreviews
    });
    setUploadFileList([]);
    setUploadedFileMeta((prev) => {
      prev.forEach((item) => {
        revokeLocalObjectUrl(item?.localThumbUrl);
      });
      return [];
    });
  };

  React.useEffect(() => {
    handleSendWithAttachmentsRef.current = handleSendWithAttachments;
  }, [handleSendWithAttachments]);

  React.useEffect(() => {
    if (activeTool !== 'digital-human') return;
    syncDigitalHumanVoiceReferenceNode(
      editor,
      selectedDigitalHumanMode,
      selectedVoiceLibraryItem,
      selectedDigitalHumanAvatar
    );
  }, [activeTool, editor, selectedDigitalHumanAvatar, selectedDigitalHumanMode, selectedVoiceLibraryItem]);

  React.useEffect(() => {
    if (activeTool !== 'voice-square') return;
    syncVoiceSquareReferenceNode(editor, selectedVoiceLibraryItem);
  }, [activeTool, editor, selectedVoiceLibraryItem]);

  React.useEffect(() => {
    if (activeTool !== 'digital-human') return;
    syncDigitalHumanMediaParagraph(editor, selectedDigitalHumanMode, selectedDigitalHumanAvatar);
  }, [activeTool, editor, selectedDigitalHumanAvatar, selectedDigitalHumanMode]);

  const applyAiWriteTemplate = React.useCallback((presetId) => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(buildAiWriteEditorDocument(presetId), false);
    editor.commands.focus('end');
  }, [editor]);

  const handleAiWritePresetSelect = React.useCallback((presetId) => {
    setSelectedAiWritePresetId(presetId);
    if (activeTool !== 'ai-write') return;
    applyAiWriteTemplate(presetId);
  }, [activeTool, applyAiWriteTemplate]);

  const handleToolSelect = React.useCallback((toolId) => {
    const nextTool = activeTool === toolId ? null : toolId;
    setActiveTool(nextTool);
    if (!editor || editor.isDestroyed) return;
    if (nextTool === 'voice-square') {
      editor.commands.setContent(
        buildVoiceSquareEditorDocument(selectedVoiceLibraryItem),
        false
      );
      editor.commands.focus('end');
      return;
    }
    if (nextTool === 'digital-human') {
      editor.commands.setContent(
        buildDigitalHumanEditorDocument(
          selectedVoiceLibraryItem,
          selectedDigitalHumanMode,
          selectedDigitalHumanAvatar
        ),
        false
      );
      editor.commands.focus('end');
      return;
    }
    if (nextTool === 'ai-write') {
      applyAiWriteTemplate(selectedAiWritePresetId);
    }
  }, [activeTool, applyAiWriteTemplate, editor, selectedAiWritePresetId, selectedDigitalHumanAvatar, selectedDigitalHumanMode, selectedVoiceLibraryItem]);

  const handleToolDetailBack = React.useCallback(() => {
    setActiveTool(null);
  }, []);

  return (
    <div className="chat-panel__composer">
      <div className="chat-panel__editor">
        {uploadFileList.length > 0 ? (
          <AntUpload
            className="chat-panel__upload-list chat-panel__upload-list--top"
            fileList={uploadFileList}
            showUploadList={{
              showPreviewIcon: false,
              showDownloadIcon: false,
              showRemoveIcon: true,
            }}
            onRemove={(file) => {
              setUploadFileList((prev) => prev.filter((item) => item.uid !== file.uid));
              setUploadedFileMeta((prev) => {
                const removedItem = prev.find((item) => item.uid === file.uid);
                revokeLocalObjectUrl(removedItem?.localThumbUrl);
                return prev.filter((item) => item.uid !== file.uid);
              });
              return true;
            }}
            openFileDialogOnClick={false}
          >
            <span />
          </AntUpload>
        ) : null}
        <div className="chat-panel__tool-bar">
          <div className="chat-panel__tool-left">
            <AntUpload
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
                ref={toolbarUploadTriggerRef}
                className="chat-panel__tool-button chat-panel__tool-button--icon-only"
                aria-label="上传文件"
                title="上传文件"
                role="button"
              >
                <img className="chat-panel__tool-icon" src={ChatToolFileIcon} alt="" aria-hidden="true" />
              </span>
            </AntUpload>
            <span className="chat-panel__tool-divider" aria-hidden="true" />
            {activeTool === 'voice-square' ? (
              <VoiceSquareToolDetail
                disabled={sessionSending}
                onBack={handleToolDetailBack}
                onSelectedVoiceChange={setSelectedVoiceLibraryItem}
              />
            ) : activeTool === 'digital-human' ? (
              <DigitalHumanToolDetail
                disabled={sessionSending}
                onBack={handleToolDetailBack}
                onModeChange={setSelectedDigitalHumanMode}
                onSelectedAvatarChange={setSelectedDigitalHumanAvatar}
                onSelectedVoiceChange={setSelectedVoiceLibraryItem}
              />
            ) : activeTool === 'ai-write' ? (
              <AiWriteToolDetail
                disabled={sessionSending}
                onBack={handleToolDetailBack}
                selectedPresetId={selectedAiWritePresetId}
                onPresetSelect={handleAiWritePresetSelect}
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
              listHeight={356}
              virtual={false}
              value={model}
              options={groupedModelOptions}
              optionLabelProp="selectedLabel"
              loading={modelListLoading}
              onChange={(value) => onModelChange && onModelChange(value)}
              onOpenChange={(open) => {
                setModelPickerOpen(open);
                if (!open) clearHoveredModelCard();
              }}
              disabled={sessionSending || modelListLoading || availableModelOptions.length === 0}
              popupMatchSelectWidth={false}
              getPopupContainer={(trigger) => trigger.parentElement}
              optionRender={(option) => {
                const optionMeta = option?.data || {};
                const optionValue = String(optionMeta?.value || '').trim();
                const displayText = String(optionMeta?.displayText || optionValue).trim();
                const icon = optionMeta?.icon || '';
                const supportsReadImage = Boolean(optionMeta?.supportsReadImage);
                const badges = Array.isArray(optionMeta?.badges) ? optionMeta.badges : [];
                const optionContent = renderModelOptionInner(displayText, icon, supportsReadImage, badges);
                return (
                  <div
                    className="chat-panel__model-option-trigger"
                    onPointerEnter={optionValue ? (event) => showHoveredModelCard(optionMeta, event.currentTarget) : undefined}
                    onPointerMove={optionValue ? (event) => showHoveredModelCard(optionMeta, event.currentTarget) : undefined}
                    onPointerLeave={optionValue ? clearHoveredModelCard : undefined}
                  >
                    {optionContent}
                  </div>
                );
              }}
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
        <div
          ref={inputWrapRef}
          className={`chat-panel__input-wrap ${isDragActive ? 'drag-active' : ''}`}
          onDragEnter={handleInputDragEnter}
          onDragOver={handleInputDragOver}
          onDragLeave={handleInputDragLeave}
          onDrop={handleInputDrop}
        >
          {mentionState.open && (
            (mentionState.symbol === '@' && (skillsLoading || skillsError || filteredSkills.length > 0))
            || (mentionState.symbol === '#' && (uploadedFileMeta.length > 0 || mentionState.query.length >= 0))
          ) ? (
            <div
              ref={mentionPanelRef}
              className={`chat-panel__skill-mention-panel ${
                mentionState.symbol === '#' && uploadedFileMeta.length === 0
                  ? 'chat-panel__skill-mention-panel--empty-upload'
                  : ''
              }`}
              style={{
                left: `${mentionPanelPosition.left}px`,
                top: `${mentionPanelPosition.top}px`,
              }}
              onMouseDown={() => {
                mentionPanelPointerDownRef.current = true;
                cancelMentionClose();
                window.setTimeout(() => {
                  mentionPanelPointerDownRef.current = false;
                }, 0);
              }}
            >
              <div className="chat-panel__skill-mention-list">
                {mentionState.symbol === '@' && skillsLoading ? <div className="chat-panel__skill-mention-empty">加载技能中...</div> : null}
                {mentionState.symbol === '@' && !skillsLoading && skillsError ? (
                  <div className="chat-panel__skill-mention-empty">{skillsError}</div>
                ) : null}
                {mentionState.symbol === '#' && uploadedFileMeta.length === 0 ? (
                  <div className="chat-panel__skill-mention-empty chat-panel__skill-mention-empty--upload">
                    <Empty
                      description="你还没有创建过引用"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      className="chat-panel__skill-mention-empty-state"
                    />
                    <AntUpload
                      accept="image/*,video/*,audio/*"
                      multiple
                      beforeUpload={handleBeforeUpload}
                      customRequest={handleFileUpload}
                      showUploadList={false}
                      fileList={uploadFileList}
                      onChange={({ fileList }) => handleUploadListChange(fileList)}
                      disabled={sessionSending}
                    >
                      <Button
                        type="default"
                        className="chat-panel__skill-mention-empty-action"
                        icon={<Plus className="chat-panel__skill-mention-empty-action-icon" />}
                      >
                        上传引用
                      </Button>
                    </AntUpload>
                  </div>
                ) : null}
                {mentionState.symbol === '#' && uploadedFileMeta.length > 0 && filteredUploadedFiles.length === 0 ? (
                  <div className="chat-panel__skill-mention-empty">没有匹配的文件</div>
                ) : null}
                {mentionState.symbol === '@' && !skillsLoading && !skillsError && filteredSkills.map((skill, index) => {
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
                {mentionState.symbol === '#' && filteredUploadedFiles.map((file, index) => {
                  const isActive = index === mentionState.activeIndex;
                  return (
                    <button
                      key={file.uid || file.url || file.name}
                      type="button"
                      className={`chat-panel__skill-mention-item chat-panel__file-reference-item ${isActive ? 'active' : ''}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertFileReference(file);
                      }}
                    >
                      <span className="chat-panel__file-reference-item-thumb">
                        {renderFileThumb(file)}
                      </span>
                      <span className="chat-panel__file-reference-item-main">
                        <span className="chat-panel__skill-mention-name">{getFileDisplayName(file)}</span>
                      </span>
                      {isPreviewableFile(file?.fileType) ? (
                        <Popover
                          trigger="hover"
                          placement="rightTop"
                          classNames={{ root: 'chat-panel__file-ref-preview-popover' }}
                          content={renderFilePreviewContent(file, 'chat-panel__file-ref-preview--panel')}
                        >
                        </Popover>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="chat-panel__input-editor">
            {isDragActive ? (
              <div className="chat-panel__drag-upload-overlay" aria-hidden="true">
                <div className="chat-panel__drag-upload-card">
                  <UploadIcon className="chat-panel__drag-upload-icon" />
                  <div className="chat-panel__drag-upload-text">将文件拖放到此处以添加到你的消息中</div>
                </div>
              </div>
            ) : null}
            {!String(input || '').length ? (
              <div aria-hidden="true" className="chat-panel__input-placeholder">
                {inputPlaceholder}
              </div>
            ) : null}
            <EditorContent
              editor={editor}
              className="chat-panel__input chat-panel__input--tiptap"
            />
          </div>
        </div>
      </div>
      {hoveredModelCard ? (
        <div
          ref={modelHoverCardRef}
          className="chat-panel__model-hover-card"
          style={{
            left: `${hoveredModelCard.left}px`,
            top: `${hoveredModelCard.top}px`,
          }}
        >
          {renderModelOptionPopoverContent(hoveredModelCard.text, hoveredModelCard.description, hoveredModelCard.priceMeta)}
        </div>
      ) : null}
    </div>
  );
};

export default Composer;
