import { useAgent } from '@renderer/hooks/agents/useAgent';
import React from 'react';
import { mergeAttributes, Node } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { Button, Empty, Popover, Select, Tooltip, Upload as AntUpload, message } from 'antd';
import { ArrowUp, ChevronLeft, ChevronRight, CirclePause, File, FileAudio, FileVideo, Folder, FolderOpen, Plus, Upload as UploadIcon } from 'lucide-react';
import './Composer.css';
import ChatToolFileIcon from '../../../../public/chat_tool_file.svg';
import ChatModelsTipIcon from '../../../../public/chat_models_tip.svg';
import {
  getDefaultAiWritePresetId,
  getAiWriteFields,
  getAiWritePresetById,
} from './AiWriteToolDetail/presetOptions';
import ToolArea from './ToolArea/index';
import DigitalHumanToolDetail from './DigitalHumanToolDetail/index';
import ImagePanToolDetail from './ImagePanToolDetail/index';
import LocalFilePreviewList from './LocalFilePreviewList/index';
import VideoToolDetail from './VideoToolDetail/index';
import VoiceSquareToolDetail, { getInitialSelectedVoiceLibraryItem } from './VoiceSquareToolDetail/index';

const { shell } = window.require('electron');
const MAX_UPLOAD_COUNT = 100;
const SKILL_MENTION_CLOSE_DELAY = 120;
const MENTION_TOKEN_BOUNDARY = '[\\s,.!?;:，。！？；：)]';
const MENTION_PANEL_DEFAULT_WIDTH = 180;
const MENTION_PANEL_EDGE_OFFSET = 4;
const MODEL_HOVER_CARD_WIDTH = 180;
const MODEL_HOVER_CARD_GAP = 20;
const MODEL_HOVER_CARD_VIEWPORT_MARGIN = 8;
const TOOL_BAR_SCROLL_STEP = 220;
const TOOL_BAR_MIN_RIGHT_GAP = 32;
const TOOL_BAR_NAV_VISIBILITY_THRESHOLD = 24;
const TREE_LIST_MAX_ENTRIES = 20000;
const IMAGE_FILE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const VIDEO_FILE_EXTENSIONS = new Set(['avi', 'm4v', 'mov', 'mp4', 'mkv', 'webm']);
const AUDIO_FILE_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma']);
const normalizePath = (value) => String(value || '').replace(/\\/g, '/');
const isAbsoluteEntryPath = (value) => (
  value.startsWith('/') ||
  /^[a-zA-Z]:\//.test(value) ||
  value.startsWith('//')
);
const resolveListedEntryPath = (rootPath, entryPath) => {
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '');
  const normalizedEntry = normalizePath(entryPath).trim();
  if (!normalizedEntry) return '';
  if (isAbsoluteEntryPath(normalizedEntry)) return normalizedEntry;
  return `${normalizedRoot}/${normalizedEntry}`.replace(/\/+/g, '/');
};
const getBaseName = (value) => {
  const normalized = normalizePath(value).replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
};
const getWorkspaceConfig = (session) => {
  const config = session?.configuration && typeof session.configuration === 'object'
    ? session.configuration
    : {};
  const lockedPath = normalizePath(config?.selected_workspace_path || session?.accessible_paths?.[0] || '');
  const recentPaths = Array.isArray(config?.recent_workspace_paths)
    ? config.recent_workspace_paths.map((item) => normalizePath(item)).filter(Boolean)
    : [];
  return { lockedPath, recentPaths };
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getSkillMentionLabel = (skill) => String(
  skill?.name || skill?.folderName || skill?.filename || skill?.id || ''
).trim();
const getMentionText = (attrs = {}) => `@${attrs.label || attrs.id || ''}`;
const getFileReferenceText = (attrs = {}) => {
  const sourcePath = String(attrs?.sourcePath || '').trim();
  if (sourcePath) return sourcePath;
  return `#${attrs.name || '文件'}`;
};
const toDisplayFileUrl = (value = '') => {
  const normalized = normalizePath(value).trim();
  if (!normalized) return '';
  if (/^(data:|https?:\/\/|file:\/\/)/i.test(normalized)) return normalized;
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${pathname}`);
};
const getFileDisplayName = (file = {}) => file.name || '文件';
const isBlobLike = (value) => (
  Boolean(value)
  && typeof value === 'object'
  && typeof value.size === 'number'
  && typeof value.type === 'string'
  && typeof value.slice === 'function'
);
const isFileLike = (value) => (
  isBlobLike(value)
  && typeof value.name === 'string'
);
const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.startsWith('.') && !normalized.slice(1).includes('.')) return normalized.slice(1);
  const segments = normalized.split('.');
  return segments.length > 1 ? segments.pop() || '' : '';
};
const createLocalFileUrl = (filePath = '') => {
  const normalizedPath = normalizePath(filePath).trim();
  if (!normalizedPath) return '';
  const pathname = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return encodeURI(`file://${pathname}`);
};
const guessFileTypeFromName = (fileName = '') => {
  const extension = getFileExtension(fileName);
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return extension === 'svg' ? 'image/svg+xml' : 'image/png';
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return 'video/mp4';
  if (AUDIO_FILE_EXTENSIONS.has(extension)) return 'audio/mpeg';
  return 'text/plain';
};
const sortTreeNodes = (nodes) => (
  [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return String(left.name || '').localeCompare(String(right.name || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  })
);
const sortTreeRecursively = (nodes) => (
  sortTreeNodes(nodes).map((node) => (
    node.type === 'directory' && Array.isArray(node.children)
      ? { ...node, children: sortTreeRecursively(node.children) }
      : node
  ))
);
const buildTreeFromEntries = (rootPath, entries, directoryFlags) => {
  const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '');
  const nodeMap = new Map();
  const rootNodes = [];

  entries
    .map((entryPath) => normalizePath(entryPath))
    .filter((entryPath) => entryPath && entryPath.startsWith(`${normalizedRoot}/`))
    .sort((left, right) => left.length - right.length)
    .forEach((entryPath) => {
      const relativePath = entryPath.slice(normalizedRoot.length + 1);
      if (!relativePath) return;

      const segments = relativePath.split('/').filter(Boolean);
      if (segments.length === 0) return;

      const nodePath = segments.join('/');
      const parentPath = segments.slice(0, -1).join('/');
      const node = {
        name: segments[segments.length - 1],
        path: nodePath,
        type: directoryFlags.get(entryPath) ? 'directory' : 'file',
      };

      if (node.type === 'directory') {
        node.children = [];
      }

      nodeMap.set(nodePath, node);

      if (parentPath && nodeMap.has(parentPath)) {
        const parentNode = nodeMap.get(parentPath);
        if (!Array.isArray(parentNode.children)) {
          parentNode.children = [];
        }
        parentNode.children.push(node);
      } else {
        rootNodes.push(node);
      }
    });

  return sortTreeRecursively(rootNodes);
};
const filterTreeNodesByQuery = (nodes, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return Array.isArray(nodes) ? nodes : [];

  return (Array.isArray(nodes) ? nodes : []).reduce((accumulator, node) => {
    const matchesSelf = String(node?.name || '').toLowerCase().includes(normalizedQuery);
    if (node?.type === 'directory') {
      const matchedChildren = filterTreeNodesByQuery(node.children, normalizedQuery);
      if (matchesSelf || matchedChildren.length > 0) {
        accumulator.push({
          ...node,
          children: matchedChildren,
        });
      }
      return accumulator;
    }

    if (matchesSelf) {
      accumulator.push(node);
    }
    return accumulator;
  }, []);
};
const createLocalReferenceFile = ({ rootPath, node, sourceType = 'workspace', sourceLabel = '' }) => {
  const sourcePath = resolveListedEntryPath(rootPath, node?.path);
  const fileUrl = createLocalFileUrl(sourcePath);
  const fileType = guessFileTypeFromName(node?.name || '');
  const isMediaFile = /^image\/|^video\/|^audio\//.test(fileType);

  return {
    uid: `local:${sourcePath}`,
    name: node?.name || getBaseName(sourcePath) || '文件',
    url: fileUrl,
    fileType,
    thumbnailUrl: isMediaFile ? fileUrl : '',
    previewUrl: isMediaFile ? fileUrl : '',
    localThumbUrl: isMediaFile ? fileUrl : '',
    localPreviewUrl: isMediaFile ? fileUrl : '',
    sourcePath,
    sourceType,
    sourceLabel,
  };
};
const collectVisibleTreeFiles = (
  nodes,
  rootPath,
  scopeKey,
  expandedKeys,
  { forceExpanded = false, sourceType = 'workspace', sourceLabel = '' } = {}
) => {
  const results = [];

  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    const compositeKey = `${scopeKey}:${node.path}`;
    if (node?.type === 'file') {
      results.push(createLocalReferenceFile({ rootPath, node, sourceType, sourceLabel }));
      return;
    }

    if (node?.type === 'directory' && (forceExpanded || expandedKeys.has(compositeKey))) {
      results.push(
        ...collectVisibleTreeFiles(node.children, rootPath, compositeKey, expandedKeys, {
          forceExpanded,
          sourceType,
          sourceLabel,
        })
      );
    }
  });

  return results;
};
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
const IMAGE_PAN_MODEL_STORAGE_KEY = 'chat-panel:image-pan-model';
const IMAGE_PAN_RESOLUTION_STORAGE_KEY = 'chat-panel:image-pan-resolution';
const VIDEO_MODEL_STORAGE_KEY = 'chat-panel:video-model';
const VIDEO_GENERATION_MODE_STORAGE_KEY = 'chat-panel:video-generation-mode';
const VIDEO_RESOLUTION_STORAGE_KEY = 'chat-panel:video-resolution';
const VIDEO_DURATION_STORAGE_KEY = 'chat-panel:video-duration';
const VIDEO_GENERATE_AUDIO_STORAGE_KEY = 'chat-panel:video-generate-audio';
const VIDEO_SEEDANCE_OFFLINE_STORAGE_KEY = 'chat-panel:video-seedance-offline';
const VIDEO_SUPER_RESOLVE_STORAGE_KEY = 'chat-panel:video-super-resolve';
const DEFAULT_DIGITAL_HUMAN_MODE = 'seedance-avatar';
const DIGITAL_HUMAN_IMAGE_DRIVE_MODES = new Set(['jimeng-avatar', 'seedance-avatar']);
const DIGITAL_HUMAN_OPTION_VALUES = new Set(['seedance-avatar', 'jimeng-avatar', 'lips']);
const DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE = '和蔼奶奶';
const DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL = 'https://player.install-ai-guider.top/example/digital_human/omni_pic_example_1.jpg';
const DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID = 'pfetRIoSD753RDghCo31';
const DEFAULT_IMAGE_PAN_MODEL = 'seedream-4.5';
const DEFAULT_IMAGE_PAN_RESOLUTION = '1440x2560';
const DEFAULT_VIDEO_MODEL = 'seedance-2.0';
const DEFAULT_VIDEO_GENERATION_MODE = 'text_to_video';
const DEFAULT_VIDEO_RESOLUTION = '720x1280';
const DEFAULT_VIDEO_DURATION = 5;
const DEFAULT_VIDEO_GENERATE_AUDIO = true;
const DEFAULT_VIDEO_SEEDANCE_OFFLINE = false;
const DEFAULT_VIDEO_SUPER_RESOLVE = false;
const VIDEO_GENERATION_MODE_VALUES = new Set(['text_to_video', 'first_frame', 'first_last_frame', 'reference']);
const VIDEO_GENERATION_MODE_LABELS = {
  text_to_video: '文生视频',
  first_frame: '首帧生成',
  first_last_frame: '首尾帧',
  reference: '参考生成',
};
const IMAGE_PAN_UPLOAD_MAX_COUNT = 10;
const IMAGE_PAN_PLACEHOLDER_CONFIG = [
  { key: 'image_pan', label: '图片', kind: 'image' },
];
const VIDEO_REFERENCE_UPLOAD_MAX_COUNT = 10;
const VIDEO_FRAME_SLOT_ORDER = {
  first_frame: 0,
  last_frame: 1,
};
const VIDEO_GENERATION_PLACEHOLDER_CONFIG = {
  first_frame: [
    { key: 'first_frame', label: '首帧图', kind: 'image' },
  ],
  first_last_frame: [
    { key: 'first_frame', label: '首帧图', kind: 'image' },
    { key: 'last_frame', label: '尾帧图', kind: 'image' },
  ],
  reference: [
    { key: 'reference', label: `参考内容`, kind: 'file' },
  ],
};
const DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT = '画面中人物正在进行拍摄一个口播视频，自然的说话。人物在口播过程中，有着自然的摆头、张嘴、眼神变化以及手势的动作，在重点或者疑问的时候，他的表情甚至更加细微的表现出来强调或者疑问等等情感。视频的音频部分完全由他的口播声音构成，没有其他对话或杂音。严禁画面中出现文字。'
const FILE_SLOT_PLACEHOLDER = '请输入';
const normalizeDigitalHumanMode = (value) => {
  const normalizedValue = String(value || '').trim();
  return DIGITAL_HUMAN_OPTION_VALUES.has(normalizedValue) ? normalizedValue : DEFAULT_DIGITAL_HUMAN_MODE;
};
const isDigitalHumanImageDriveMode = (value) => DIGITAL_HUMAN_IMAGE_DRIVE_MODES.has(String(value || '').trim());
const isSeedanceDigitalHumanMode = (value) => String(value || '').trim() === 'seedance-avatar';
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

const normalizeImagePanModel = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_IMAGE_PAN_MODEL;
};

const normalizeImagePanResolution = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_IMAGE_PAN_RESOLUTION;
};

const readPersistedImagePanModel = () => {
  try {
    return normalizeImagePanModel(localStorage.getItem(IMAGE_PAN_MODEL_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_IMAGE_PAN_MODEL;
  }
};

const readPersistedImagePanResolution = () => {
  try {
    return normalizeImagePanResolution(localStorage.getItem(IMAGE_PAN_RESOLUTION_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_IMAGE_PAN_RESOLUTION;
  }
};

const normalizeVideoModel = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_VIDEO_MODEL;
};

const normalizeVideoGenerationMode = (value) => {
  const normalizedValue = String(value || '').trim();
  return VIDEO_GENERATION_MODE_VALUES.has(normalizedValue) ? normalizedValue : DEFAULT_VIDEO_GENERATION_MODE;
};

const normalizeVideoResolution = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_VIDEO_RESOLUTION;
};

const readPersistedVideoModel = () => {
  try {
    return normalizeVideoModel(localStorage.getItem(VIDEO_MODEL_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_VIDEO_MODEL;
  }
};

const readPersistedVideoGenerationMode = () => {
  try {
    return normalizeVideoGenerationMode(localStorage.getItem(VIDEO_GENERATION_MODE_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_VIDEO_GENERATION_MODE;
  }
};

const readPersistedVideoResolution = () => {
  try {
    return normalizeVideoResolution(localStorage.getItem(VIDEO_RESOLUTION_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_VIDEO_RESOLUTION;
  }
};

const normalizeVideoDuration = (value) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_VIDEO_DURATION;
};

const readPersistedVideoDuration = () => {
  try {
    return normalizeVideoDuration(localStorage.getItem(VIDEO_DURATION_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_VIDEO_DURATION;
  }
};

const normalizeBooleanStorageValue = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === null || typeof value === 'undefined') return fallback;
  const normalizedValue = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) return true;
  if (['false', '0', 'no', 'off'].includes(normalizedValue)) return false;
  return fallback;
};

const isImageFileType = (fileType = '') => String(fileType || '').toLowerCase().startsWith('image/');
const isVideoFileType = (fileType = '') => String(fileType || '').toLowerCase().startsWith('video/');
const isAudioFileType = (fileType = '') => String(fileType || '').toLowerCase().startsWith('audio/');
const getResolvedUploadFileType = (file = {}) => {
  const explicitType = String(file?.type || file?.originFileObj?.type || '').trim();
  if (explicitType) return explicitType;
  return guessFileTypeFromName(file?.name || file?.originFileObj?.name || '');
};
const isSupportedVideoReferenceFile = (file = {}) => {
  const resolvedType = getResolvedUploadFileType(file);
  return isImageFileType(resolvedType) || isVideoFileType(resolvedType) || isAudioFileType(resolvedType);
};
const isVideoFrameSlotId = (value) => Object.prototype.hasOwnProperty.call(VIDEO_FRAME_SLOT_ORDER, String(value || '').trim());
const sortItemsByVideoFrameSlot = (items = []) => (
  [...items].sort((left, right) => {
    const leftSlotId = String(left?.slotId || '').trim();
    const rightSlotId = String(right?.slotId || '').trim();
    const leftOrder = Object.prototype.hasOwnProperty.call(VIDEO_FRAME_SLOT_ORDER, leftSlotId)
      ? VIDEO_FRAME_SLOT_ORDER[leftSlotId]
      : Number.MAX_SAFE_INTEGER;
    const rightOrder = Object.prototype.hasOwnProperty.call(VIDEO_FRAME_SLOT_ORDER, rightSlotId)
      ? VIDEO_FRAME_SLOT_ORDER[rightSlotId]
      : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  })
);
const getVideoModeUploadLimit = (mode) => {
  const normalizedMode = normalizeVideoGenerationMode(mode);
  if (normalizedMode === 'first_frame') {
    return {
      maxCount: 1,
      imageOnly: true,
      typeErrorMessage: '首帧生成模式仅支持上传图片',
    };
  }
  if (normalizedMode === 'first_last_frame') {
    return {
      maxCount: 2,
      imageOnly: true,
      typeErrorMessage: '首尾帧模式仅支持上传图片',
    };
  }
  if (normalizedMode === 'reference') {
    return {
      maxCount: VIDEO_REFERENCE_UPLOAD_MAX_COUNT,
      imageOnly: false,
      accept: 'image/*,video/*,audio/*',
      validateFile: isSupportedVideoReferenceFile,
      typeErrorMessage: '参考生成模式仅支持上传图片、视频、音频',
    };
  }
  return {
    maxCount: MAX_UPLOAD_COUNT,
    imageOnly: false,
    accept: undefined,
    validateFile: null,
    typeErrorMessage: '',
  };
};

const readPersistedVideoGenerateAudio = () => {
  try {
    return normalizeBooleanStorageValue(localStorage.getItem(VIDEO_GENERATE_AUDIO_STORAGE_KEY), DEFAULT_VIDEO_GENERATE_AUDIO);
  } catch (error) {
    return DEFAULT_VIDEO_GENERATE_AUDIO;
  }
};

const readPersistedVideoSeedanceOffline = () => {
  try {
    return normalizeBooleanStorageValue(localStorage.getItem(VIDEO_SEEDANCE_OFFLINE_STORAGE_KEY), DEFAULT_VIDEO_SEEDANCE_OFFLINE);
  } catch (error) {
    return DEFAULT_VIDEO_SEEDANCE_OFFLINE;
  }
};

const readPersistedVideoSuperResolve = () => {
  try {
    return normalizeBooleanStorageValue(localStorage.getItem(VIDEO_SUPER_RESOLVE_STORAGE_KEY), DEFAULT_VIDEO_SUPER_RESOLVE);
  } catch (error) {
    return DEFAULT_VIDEO_SUPER_RESOLVE;
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
  sourcePath: overrides.sourcePath ?? file.sourcePath ?? '',
  sourceType: overrides.sourceType ?? file.sourceType ?? '',
  sourceLabel: overrides.sourceLabel ?? file.sourceLabel ?? '',
});
const createDigitalHumanSelectedVoiceReferenceAttrs = (
  selectedMode = DEFAULT_DIGITAL_HUMAN_MODE,
  selectedVoiceLibraryItem = null,
  selectedAvatar = readPersistedDigitalHumanAvatarSelection()
) => {
  if (isDigitalHumanImageDriveMode(selectedMode)) {
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
  if (!isBlobLike(file)) {
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
    uid: isDigitalHumanImageDriveMode(selectedMode)
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.uid,
    name: isDigitalHumanImageDriveMode(selectedMode)
      ? normalizeDigitalHumanAvatarTitle(selectedAvatar?.title)
      : currentFile.name,
    url: isDigitalHumanImageDriveMode(selectedMode)
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.url,
    fileType: isDigitalHumanImageDriveMode(selectedMode) ? 'image/jpeg' : currentFile.fileType,
    thumbnailUrl: isDigitalHumanImageDriveMode(selectedMode)
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.thumbnailUrl,
    previewUrl: isDigitalHumanImageDriveMode(selectedMode)
      ? normalizeDigitalHumanAvatarCoverUrl(selectedAvatar?.cover_url)
      : currentFile.previewUrl,
    templateSlot: true,
    slotId: DIGITAL_HUMAN_VIDEO_SLOT_ID,
    slotLabel: isDigitalHumanImageDriveMode(selectedMode) ? '人物照片' : '人物视频',
    acceptedKind: isDigitalHumanImageDriveMode(selectedMode) ? 'image' : 'video',
    placeholderText: isDigitalHumanImageDriveMode(selectedMode) ? '选择的形象照片' : '请上传人物视频',
  });
const createDigitalHumanScriptNode = (scriptText = '') => {
  const normalizedScriptText = String(scriptText || '');
  if (normalizedScriptText.trim()) {
    return {
      type: 'text',
      text: normalizedScriptText,
    };
  }

  return {
    type: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE,
    attrs: {
      text: DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_TEXT,
    },
  };
};
const normalizeDigitalHumanMotionText = (value) => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT;

  const bracketMatchedValue = normalizedValue.match(/^\[(.*)\]$/s);
  const cleanedValue = bracketMatchedValue ? String(bracketMatchedValue[1] || '').trim() : normalizedValue;
  return cleanedValue || DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT;
};
const createDigitalHumanMotionNode = (motionText = DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT) => ({
  type: DIGITAL_HUMAN_MOTION_PLACEHOLDER_NODE,
  attrs: {
    text: normalizeDigitalHumanMotionText(motionText),
  },
});
const isVideoDigitalHumanMediaReference = (attrs = {}) => {
  const fileType = String(attrs?.fileType || '').trim().toLowerCase();
  const acceptedKind = String(attrs?.acceptedKind || '').trim().toLowerCase();
  return fileType.startsWith('video/') || acceptedKind === 'video';
};
const getReusableDigitalHumanMediaReferenceAttrs = (selectedMode = DEFAULT_DIGITAL_HUMAN_MODE, attrs = {}) => {
  if (isDigitalHumanImageDriveMode(selectedMode)) return {};
  return isVideoDigitalHumanMediaReference(attrs) ? attrs : {};
};
const buildDigitalHumanMediaParagraph = (
  selectedMode = DEFAULT_DIGITAL_HUMAN_MODE,
  currentFile = {},
  selectedAvatar = readPersistedDigitalHumanAvatarSelection(),
  motionText = DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT,
  scriptText = ''
) => {
  if (isSeedanceDigitalHumanMode(selectedMode)) {
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: '将说话内容：[' },
        createDigitalHumanScriptNode(scriptText),
        { type: 'text', text: '] 利用音色 ' },
        {
          type: 'fileReference',
          attrs: createDigitalHumanSelectedVoiceReferenceAttrs(selectedMode, null, selectedAvatar),
        },
        { type: 'text', text: ' 和人物照片 ' },
        {
          type: 'fileReference',
          attrs: createDigitalHumanMediaReferenceAttrs(selectedMode, currentFile, selectedAvatar),
        },
        { type: 'text', text: ' 合并成一个seedance数字人视频。' }
      ],
    };
  }

  if (isDigitalHumanImageDriveMode(selectedMode)) {
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: '第二步: 将上一步生成的语音和人物照片 ' },
        {
          type: 'fileReference',
          attrs: createDigitalHumanMediaReferenceAttrs(selectedMode, currentFile, selectedAvatar),
        },
        { type: 'text', text: ' 合并成一个即梦数字人视频，视频中的人物动作是' },
        createDigitalHumanMotionNode(motionText),
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
  selectedAvatar = readPersistedDigitalHumanAvatarSelection(),
  {
    scriptText = '',
    motionText = DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT,
    mediaReferenceAttrs = {},
  } = {}
) => {
  const content = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '执行下面步骤：' },
      ],
    },
  ];

  if (!isSeedanceDigitalHumanMode(selectedMode)) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: '第一步: 将说话内容：[' },
        createDigitalHumanScriptNode(scriptText),
        { type: 'text', text: '] 利用音色 ' },
        {
          type: 'fileReference',
          attrs: createDigitalHumanSelectedVoiceReferenceAttrs(selectedMode, selectedVoiceLibraryItem, selectedAvatar),
        },
        { type: 'text', text: ' 合成语音。' },
      ],
    });
  }

  content.push(
    buildDigitalHumanMediaParagraph(
      selectedMode,
      mediaReferenceAttrs,
      selectedAvatar,
      motionText,
      scriptText
    )
  );

  return {
    type: 'doc',
    content,
  };
};
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
  if (!isFileLike(file) || typeof URL?.createObjectURL !== 'function') return '';
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
const tryGetNativeFilePath = (value) => {
  const getter = window?.api?.file?.getPathForFile;
  if (typeof getter !== 'function') return '';
  const FileCtor = globalThis?.File;
  if (typeof FileCtor !== 'function' || !(value instanceof FileCtor)) return '';
  try {
    return normalizePath(getter(value)).trim();
  } catch (error) {
    return '';
  }
};
const createLocalAttachmentEntry = async (rawFile = {}) => {
  const targetFile = isFileLike(rawFile) ? rawFile : rawFile?.originFileObj;
  const uid = rawFile?.uid || targetFile?.uid || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  if (!targetFile) return null;

  const localObjectUrl = createLocalObjectUrl(targetFile);
  const sourcePath = normalizePath(
    targetFile?.path
    || rawFile?.path
    || tryGetNativeFilePath(targetFile)
    || tryGetNativeFilePath(rawFile)
    || targetFile?.webkitRelativePath
    || rawFile?.webkitRelativePath
    || ''
  ).trim();
  const fileType = targetFile?.type || rawFile?.type || '';
  const kind = getFileKindFromType(fileType);
  const durationLabel = localObjectUrl && kind === 'video'
    ? await readMediaDuration(localObjectUrl, 'video')
    : '';

  return {
    uploadItem: {
      uid,
      name: targetFile?.name || rawFile?.name || '附件',
      type: fileType,
      size: targetFile?.size || rawFile?.size || 0,
      originFileObj: targetFile,
      status: 'done',
    },
    fileMeta: {
      uid,
      name: targetFile?.name || rawFile?.name || '附件',
      url: '',
      fileType,
      thumbnailUrl: localObjectUrl,
      previewUrl: localObjectUrl,
      localThumbUrl: localObjectUrl,
      localPreviewUrl: localObjectUrl,
      durationLabel,
      sourcePath,
      sourceType: 'local',
    },
  };
};
const TEMPLATE_MEDIA_ROLE_LABELS = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_image: '参考图片',
  reference_video: '参考视频',
  reference_audio: '参考音频',
};
const getRemoteMediaUrlFileName = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  try {
    const parsedUrl = new URL(normalizedValue);
    return decodeURIComponent(getBaseName(parsedUrl.pathname || ''));
  } catch (_error) {
    return decodeURIComponent(getBaseName(normalizedValue.split('?')[0] || ''));
  }
};
const getTemplateMediaTypeByContentItem = (item = {}) => {
  const itemType = String(item?.type || '').trim();
  if (itemType === 'image_url') return 'image/jpeg';
  if (itemType === 'video_url') return 'video/mp4';
  if (itemType === 'audio_url') return 'audio/mpeg';
  return '';
};
const getTemplateMediaUrlByContentItem = (item = {}) => {
  const itemType = String(item?.type || '').trim();
  if (itemType === 'image_url') return String(item?.image_url?.url || '').trim();
  if (itemType === 'video_url') return String(item?.video_url?.url || '').trim();
  if (itemType === 'audio_url') return String(item?.audio_url?.url || '').trim();
  return '';
};
const createRemoteAttachmentEntry = async ({ uid, name, url, fileType, sourceType = 'remote', sourceLabel = '' } = {}) => {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return null;
  const resolvedName = String(name || '').trim() || getRemoteMediaUrlFileName(normalizedUrl) || '附件';
  const resolvedFileType = String(fileType || '').trim() || guessFileTypeFromName(resolvedName);
  const kind = getFileKindFromType(resolvedFileType);
  const durationLabel = kind === 'video'
    ? await readMediaDuration(normalizedUrl, 'video')
    : kind === 'audio'
      ? await readMediaDuration(normalizedUrl, 'audio')
      : '';

  return {
    uid: String(uid || '').trim() || `remote:${normalizedUrl}`,
    name: resolvedName,
    url: normalizedUrl,
    fileType: resolvedFileType,
    thumbnailUrl: normalizedUrl,
    previewUrl: normalizedUrl,
    localThumbUrl: '',
    localPreviewUrl: '',
    durationLabel,
    sourcePath: normalizedUrl,
    sourceType,
    sourceLabel,
  };
};
const createVideoTemplateAttachmentEntries = async (template = {}) => {
  const contentItems = Array.isArray(template?.content) ? template.content : [];
  const mediaItems = contentItems.filter((item) => ['image_url', 'video_url', 'audio_url'].includes(String(item?.type || '').trim()));
  const entries = await Promise.all(mediaItems.map(async (item, index) => {
    const url = getTemplateMediaUrlByContentItem(item);
    if (!url) return null;

    const role = String(item?.role || '').trim();
    const roleLabel = TEMPLATE_MEDIA_ROLE_LABELS[role] || '素材';
    const fileNameFromUrl = getRemoteMediaUrlFileName(url);
    const fallbackExtension = getFileExtension(fileNameFromUrl);
    const resolvedName = fallbackExtension ? `${roleLabel}.${fallbackExtension}` : roleLabel;
    const guessedFileType = guessFileTypeFromName(fileNameFromUrl);

    return createRemoteAttachmentEntry({
      uid: `video-template:${template?.id || 'template'}:${role || 'media'}:${index}`,
      name: resolvedName,
      url,
      fileType: guessedFileType !== 'text/plain' ? guessedFileType : getTemplateMediaTypeByContentItem(item),
      sourceType: 'video_template',
      sourceLabel: String(template?.id || '').trim(),
    });
  }));

  return entries.filter(Boolean);
};
const createImageTemplateAttachmentEntries = async (template = {}) => {
  const contentItems = Array.isArray(template?.content) ? template.content : [];
  const contentReferenceItems = contentItems.filter((item) => (
    String(item?.type || '').trim() === 'image_url'
    && String(item?.role || '').trim() === 'reference_image'
  ));
  const contentEntries = await Promise.all(contentReferenceItems.map(async (item, index) => {
    const url = getTemplateMediaUrlByContentItem(item);
    if (!url) return null;

    const fileNameFromUrl = getRemoteMediaUrlFileName(url);
    const fallbackExtension = getFileExtension(fileNameFromUrl);
    const resolvedName = fallbackExtension ? `参考图片${index + 1}.${fallbackExtension}` : `参考图片${index + 1}`;
    const guessedFileType = guessFileTypeFromName(fileNameFromUrl);

    return createRemoteAttachmentEntry({
      uid: `image-template:${template?.id || 'template'}:reference_image:${index}`,
      name: resolvedName,
      url,
      fileType: guessedFileType !== 'text/plain' ? guessedFileType : 'image/jpeg',
      sourceType: 'image_template',
      sourceLabel: String(template?.id || '').trim(),
    });
  }));
  const normalizedContentEntries = contentEntries.filter(Boolean);
  if (normalizedContentEntries.length > 0) {
    return normalizedContentEntries;
  }

  const referenceImageUrls = Array.isArray(template?.referenceImageUrls)
    ? template.referenceImageUrls.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
  const urlEntries = await Promise.all(referenceImageUrls.map(async (url, index) => {
    const fileNameFromUrl = getRemoteMediaUrlFileName(url);
    const fallbackExtension = getFileExtension(fileNameFromUrl);
    const resolvedName = fallbackExtension ? `参考图片${index + 1}.${fallbackExtension}` : `参考图片${index + 1}`;
    const guessedFileType = guessFileTypeFromName(fileNameFromUrl);

    return createRemoteAttachmentEntry({
      uid: `image-template:${template?.id || 'template'}:reference_image_url:${index}`,
      name: resolvedName,
      url,
      fileType: guessedFileType !== 'text/plain' ? guessedFileType : 'image/jpeg',
      sourceType: 'image_template',
      sourceLabel: String(template?.id || '').trim(),
    });
  }));

  return urlEntries.filter(Boolean);
};
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

  return <File className="chat-panel__file-ref-thumb-icon" />;
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

  let hasScriptPlaceholder = false;
  let hasVideoReference = false;
  const scriptLines = [];

  paragraphs.forEach((paragraph) => {
    let paragraphBeforeVoiceReferenceText = '';
    let reachedVoiceReference = false;

    paragraph.forEach((child) => {
      if (child.type?.name === DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE) {
        hasScriptPlaceholder = true;
        return;
      }

      if (
        child.type?.name === 'fileReference' &&
        child.attrs?.slotId === DIGITAL_HUMAN_VIDEO_SLOT_ID &&
        child.attrs?.uid
      ) {
        hasVideoReference = true;
      }

      if (
        child.type?.name === 'fileReference' &&
        child.attrs?.slotId === DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID
      ) {
        reachedVoiceReference = true;
        return true;
      }

      if (!reachedVoiceReference && child.type?.name === 'text') {
        paragraphBeforeVoiceReferenceText += child.text || '';
      }
      return true;
    });

    if (reachedVoiceReference && paragraphBeforeVoiceReferenceText) {
      scriptLines.push(paragraphBeforeVoiceReferenceText);
    }
  });

  const normalizedScriptText = scriptLines
    .join('\n')
    .replace(/^第一步:\s*将说话内容[:：]/, '')
    .replace(/^将说话内容[:：]/, '')
    .replace(/\s*利用音色\s*$/, '')
    .trim();

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
const extractDigitalHumanTemplateState = (editorInstance) => {
  if (!editorInstance || editorInstance.isDestroyed) {
    return {
      scriptText: '',
      motionText: DIGITAL_HUMAN_IMAGE_DRIVE_MOTION_TEXT,
      mediaReferenceAttrs: {},
    };
  }

  const paragraphs = [];
  editorInstance.state.doc.forEach((node) => {
    if (node.type?.name === 'paragraph') {
      paragraphs.push(node);
    }
  });

  let hasScriptPlaceholder = false;
  let scriptText = '';
  let motionText = '';
  let mediaReferenceAttrs = {};

  paragraphs.forEach((paragraph) => {
    let reachedVoiceReference = false;
    let reachedMediaReference = false;
    let beforeVoiceReferenceText = '';
    let afterMediaReferenceText = '';

    paragraph.forEach((child) => {
      if (child.type?.name === DIGITAL_HUMAN_SCRIPT_PLACEHOLDER_NODE) {
        hasScriptPlaceholder = true;
        return;
      }

      if (
        child.type?.name === 'fileReference'
        && child.attrs?.slotId === DIGITAL_HUMAN_SELECTED_VOICE_ID_SLOT_ID
      ) {
        reachedVoiceReference = true;
        return true;
      }

      if (
        child.type?.name === 'fileReference'
        && child.attrs?.slotId === DIGITAL_HUMAN_VIDEO_SLOT_ID
      ) {
        mediaReferenceAttrs = { ...child.attrs };
        reachedMediaReference = true;
        return true;
      }

      const childText = getInlineNodeText(child);
      if (!childText) return true;

      if (!reachedVoiceReference) {
        beforeVoiceReferenceText += childText;
      }

      if (reachedMediaReference) {
        afterMediaReferenceText += childText;
      }

      return true;
    });

    if (!hasScriptPlaceholder && reachedVoiceReference && beforeVoiceReferenceText) {
      const normalizedScriptText = beforeVoiceReferenceText
        .replace(/^第一步:\s*将说话内容[:：]\s*\[/, '')
        .replace(/^将说话内容[:：]\s*\[/, '')
        .replace(/\]\s*利用音色\s*$/, '')
        .trim();

      if (normalizedScriptText) {
        scriptText = normalizedScriptText;
      }
    }

    if (!motionText && afterMediaReferenceText.includes('动作是')) {
      const normalizedMotionText = afterMediaReferenceText
        .replace(/^.*动作是/, '')
        .trim();

      if (normalizedMotionText) {
        motionText = normalizeDigitalHumanMotionText(normalizedMotionText);
      }
    }
  });

  return {
    scriptText: hasScriptPlaceholder ? '' : scriptText,
    motionText: normalizeDigitalHumanMotionText(motionText),
    mediaReferenceAttrs,
  };
};
const syncDigitalHumanTemplateDocument = (
  editorInstance,
  selectedMode,
  selectedVoiceLibraryItem,
  selectedAvatar
) => {
  if (!editorInstance || editorInstance.isDestroyed) return;

  const currentDocument = editorInstance.getJSON();
  const currentTemplateState = extractDigitalHumanTemplateState(editorInstance);
  const nextDocument = buildDigitalHumanEditorDocument(
    selectedVoiceLibraryItem,
    selectedMode,
    selectedAvatar,
    {
      scriptText: currentTemplateState.scriptText,
      motionText: currentTemplateState.motionText,
      mediaReferenceAttrs: getReusableDigitalHumanMediaReferenceAttrs(
        selectedMode,
        currentTemplateState.mediaReferenceAttrs
      ),
    }
  );

  if (JSON.stringify(currentDocument) === JSON.stringify(nextDocument)) return;
  editorInstance.commands.setContent(nextDocument, false);
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
                description="你还没有选择过本地文件"
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
                选择文件
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
        sourcePath: { default: '' },
        sourceType: { default: '' },
        sourceLabel: { default: '' },
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
  session: sessionProp = null,
  beginnerGuideAiToolAreaRef = null,
  beginnerGuideModelPickerRef = null,
  beginnerGuideInputAreaRef = null,
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
  const { agent } = useAgent(agentId || null);
  const [runtimeSession, setRuntimeSession] = React.useState(null);
  const session = runtimeSession || sessionProp;
  const [uploadFileList, setUploadFileList] = React.useState([]);
  const [uploadedFileMeta, setUploadedFileMeta] = React.useState([]);
  const [activeTool, setActiveTool] = React.useState(null);
  const [selectedAiWritePresetId, setSelectedAiWritePresetId] = React.useState(() => getDefaultAiWritePresetId());
  const [selectedDigitalHumanMode, setSelectedDigitalHumanMode] = React.useState(() => readPersistedDigitalHumanMode());
  const [selectedDigitalHumanAvatar, setSelectedDigitalHumanAvatar] = React.useState(() => readPersistedDigitalHumanAvatarSelection());
  const [selectedImagePanModel, setSelectedImagePanModel] = React.useState(() => readPersistedImagePanModel());
  const [selectedImagePanResolution, setSelectedImagePanResolution] = React.useState(() => readPersistedImagePanResolution());
  const [selectedVideoModel, setSelectedVideoModel] = React.useState(() => readPersistedVideoModel());
  const [selectedVideoGenerationMode, setSelectedVideoGenerationMode] = React.useState(() => readPersistedVideoGenerationMode());
  const [selectedVideoResolution, setSelectedVideoResolution] = React.useState(() => readPersistedVideoResolution());
  const [selectedVideoDuration, setSelectedVideoDuration] = React.useState(() => readPersistedVideoDuration());
  const [selectedVideoGenerateAudio, setSelectedVideoGenerateAudio] = React.useState(() => readPersistedVideoGenerateAudio());
  const [selectedVideoSeedanceOffline, setSelectedVideoSeedanceOffline] = React.useState(() => readPersistedVideoSeedanceOffline());
  const [selectedVideoSuperResolve, setSelectedVideoSuperResolve] = React.useState(() => readPersistedVideoSuperResolve());
  const [selectedVoiceLibraryItem, setSelectedVoiceLibraryItem] = React.useState(() =>
    getInitialSelectedVoiceLibraryItem()
  );
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [hoveredModelCard, setHoveredModelCard] = React.useState(null);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  const [skillsError, setSkillsError] = React.useState('');
  const [skills, setSkills] = React.useState([]);
  const [skillReferenceTrees, setSkillReferenceTrees] = React.useState({});
  const [workspaceReferenceTrees, setWorkspaceReferenceTrees] = React.useState({});
  const [referenceTreesLoading, setReferenceTreesLoading] = React.useState(false);
  const [referenceTreesError, setReferenceTreesError] = React.useState('');
  const [expandedReferenceNodeKeys, setExpandedReferenceNodeKeys] = React.useState(() => new Set());
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
  const latestReferenceSuggestionItemsRef = React.useRef([]);
  const handleSendWithAttachmentsRef = React.useRef(() => {});
  const mentionPanelPointerDownRef = React.useRef(false);
  const requestUploadPickerRef = React.useRef(() => {});
  const toolbarUploadTriggerRef = React.useRef(null);
  const pendingTemplateSlotAutoReferenceRef = React.useRef('');
  const inputWrapRef = React.useRef(null);
  const mentionPanelRef = React.useRef(null);
  const modelHoverCardRef = React.useRef(null);
  const toolContentScrollRef = React.useRef(null);
  const toolBarRef = React.useRef(null);
  const toolLeftPrefixRef = React.useRef(null);
  const toolRightRef = React.useRef(null);
  const [isDragActive, setIsDragActive] = React.useState(false);
  const [toolContentScrollState, setToolContentScrollState] = React.useState({
    isOverflowing: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const [toolContentMaxWidth, setToolContentMaxWidth] = React.useState(null);
  const workspaceConfig = React.useMemo(() => getWorkspaceConfig(session), [session]);
  const primarySkillWorkdir = React.useMemo(
    () => workspaceConfig.lockedPath,
    [workspaceConfig.lockedPath]
  );
  const workspaceReferenceRootLabel = React.useMemo(
    () => getBaseName(primarySkillWorkdir) || '工作空间',
    [primarySkillWorkdir]
  );
  const inputPlaceholder =
    activeTool === 'digital-human'
      ? ''
      : activeTool === 'image-pan'
        ? '描述你想要的图片，或者选择本地图片后修改'
        : activeTool === 'ai-video'
          ? '描述你想要的视频'
      : '@技能成员，#引用，输入消息，Enter 发送，Shift+Enter 换行';

  requestUploadPickerRef.current = (slotId = '') => {
    pendingTemplateSlotAutoReferenceRef.current = slotId || '';
    toolbarUploadTriggerRef.current?.click?.();
  };

  React.useEffect(() => {
    let cancelled = false;

    const loadRuntimeSession = async () => {
      const targetSessionId = String(runtimeSessionId || '').trim();
      if (!targetSessionId || typeof window?.electronAPI?.cherryChatStream?.getSession !== 'function') {
        setRuntimeSession(null);
        return;
      }
      try {
        const result = await window.electronAPI.cherryChatStream.getSession(targetSessionId);
        if (cancelled) return;
        setRuntimeSession(result?.ok ? result.session || null : null);
      } catch (_error) {
        if (!cancelled) {
          setRuntimeSession(null);
        }
      }
    };

    void loadRuntimeSession();
    return () => {
      cancelled = true;
    };
  }, [runtimeSessionId]);

  React.useEffect(() => {
    const api = window?.electronAPI?.agentSessionStream;
    const targetSessionId = String(runtimeSessionId || '').trim();
    if (!targetSessionId || typeof api?.onSessionChanged !== 'function') return undefined;

    return api.onSessionChanged((payload) => {
      if (String(payload?.sessionId || '').trim() !== targetSessionId) return;
      void (async () => {
        try {
          const result = await window.electronAPI.cherryChatStream.getSession(targetSessionId);
          setRuntimeSession(result?.ok ? result.session || null : null);
        } catch (_error) {
          setRuntimeSession(null);
        }
      })();
    });
  }, [runtimeSessionId]);

  React.useEffect(() => {
    let cancelled = false;
    let removeSkillsChangedListener = null;
    const loadSkills = async () => {
      const api = window?.electronAPI?.agentSkills;
      if (!runtimeSessionId && !agentId) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError('');
          setSkillsLoading(false);
        }
        return;
      }
      if (!api || typeof api.listLocal !== 'function') {
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
        const result = await api.listLocal({ workdir: '__global_skills__' });
        if (cancelled) return;
        if (!result?.ok) {
          setSkills([]);
          setSkillsError(result?.error || '加载技能失败');
          return;
        }
        const nextSkills = Array.isArray(result.skills) ? result.skills : [];
        const normalizedSkills = nextSkills.map((skill) => {
          const localSkillRoot = normalizePath(String(skill?.path || '').trim());

          return localSkillRoot ? { ...skill, __skillRoot: localSkillRoot } : skill;
        });
        setSkills(normalizedSkills);
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
    return skills.filter((skill) => getSkillMentionLabel(skill).toLowerCase().startsWith(query));
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

  const loadLocalReferenceTree = React.useCallback(async (rootPath, options = {}) => {
    if (!rootPath || !window?.api?.file?.listDirectory || !window?.api?.file?.isDirectory) {
      return [];
    }

    const { excludeClaude = false } = options;
    const normalizedRoot = normalizePath(rootPath).replace(/\/$/, '');
    const entries = await window.api.file.listDirectory(normalizedRoot, {
      recursive: true,
      maxDepth: 10,
      includeHidden: false,
      includeFiles: true,
      includeDirectories: true,
      maxEntries: TREE_LIST_MAX_ENTRIES,
      searchPattern: '.'
    });

    const normalizedEntries = Array.isArray(entries)
      ? Array.from(
          new Set(
            entries
              .map((entryPath) => resolveListedEntryPath(normalizedRoot, entryPath))
              .filter((entryPath) => {
                if (!entryPath.startsWith(`${normalizedRoot}/`)) return false;
                if (!excludeClaude) return true;
                const relativePath = entryPath.slice(normalizedRoot.length + 1);
                return relativePath && !relativePath.split('/').includes('.claude');
              })
          )
        )
      : [];

    const directoryChecks = await Promise.all(
      normalizedEntries.map(async (entryPath) => {
        try {
          const isDirectory = await window.api.file.isDirectory(entryPath);
          return [entryPath, Boolean(isDirectory)];
        } catch (_error) {
          return [entryPath, false];
        }
      })
    );

    return buildTreeFromEntries(normalizedRoot, normalizedEntries, new Map(directoryChecks));
  }, []);

  React.useEffect(() => {
    if (!mentionState.open || mentionState.symbol !== '#') return undefined;

    let cancelled = false;

    const loadReferenceTrees = async () => {
      const skillRootsToLoad = skills.filter((skill) => {
        const skillKey = getSkillMentionLabel(skill);
        return skill?.__skillRoot && skillKey && !Object.prototype.hasOwnProperty.call(skillReferenceTrees, skillKey);
      });
      const shouldLoadWorkspace = primarySkillWorkdir
        && !Object.prototype.hasOwnProperty.call(workspaceReferenceTrees, primarySkillWorkdir);

      if (!shouldLoadWorkspace && skillRootsToLoad.length === 0) {
        setReferenceTreesError('');
        return;
      }

      setReferenceTreesLoading(true);
      setReferenceTreesError('');

      try {
        const [workspaceNodes, skillTreeEntries] = await Promise.all([
          shouldLoadWorkspace
            ? loadLocalReferenceTree(primarySkillWorkdir, { excludeClaude: true })
            : Promise.resolve(null),
          Promise.all(
            skillRootsToLoad.map(async (skill) => {
              const skillKey = getSkillMentionLabel(skill);
              const nodes = await loadLocalReferenceTree(skill.__skillRoot);
              return [skillKey, nodes];
            })
          )
        ]);

        if (cancelled) return;

        if (shouldLoadWorkspace) {
          setWorkspaceReferenceTrees((prev) => ({
            ...prev,
            [primarySkillWorkdir]: Array.isArray(workspaceNodes) ? workspaceNodes : []
          }));
        }

        if (skillTreeEntries.length > 0) {
          setSkillReferenceTrees((prev) => ({
            ...prev,
            ...Object.fromEntries(skillTreeEntries.map(([skillKey, nodes]) => [skillKey, Array.isArray(nodes) ? nodes : []]))
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setReferenceTreesError(error?.message || '加载引用文件失败');
        }
      } finally {
        if (!cancelled) {
          setReferenceTreesLoading(false);
        }
      }
    };

    void loadReferenceTrees();

    return () => {
      cancelled = true;
    };
  }, [loadLocalReferenceTree, mentionState.open, mentionState.symbol, primarySkillWorkdir, skillReferenceTrees, skills, workspaceReferenceTrees]);

  const updateToolContentScrollState = React.useCallback(() => {
    const element = toolContentScrollRef.current;
    if (!element) return;

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    const isOverflowing = maxScrollLeft > TOOL_BAR_NAV_VISIBILITY_THRESHOLD;
    const nextState = {
      isOverflowing,
      canScrollLeft: isOverflowing && element.scrollLeft > 1,
      canScrollRight: isOverflowing && element.scrollLeft < maxScrollLeft - 1,
    };

    setToolContentScrollState((prev) => (
      prev.isOverflowing === nextState.isOverflowing
      && prev.canScrollLeft === nextState.canScrollLeft
      && prev.canScrollRight === nextState.canScrollRight
        ? prev
        : nextState
    ));
  }, []);

  const updateToolContentMaxWidth = React.useCallback(() => {
    const toolBarElement = toolBarRef.current;
    const toolPrefixElement = toolLeftPrefixRef.current;
    const toolRightElement = toolRightRef.current;
    if (!toolBarElement || !toolPrefixElement || !toolRightElement) return;

    const toolBarStyle = window.getComputedStyle(toolBarElement);
    const toolLeftElement = toolPrefixElement.parentElement;
    const toolLeftStyle = toolLeftElement ? window.getComputedStyle(toolLeftElement) : null;
    const toolBarGap = Number.parseFloat(toolBarStyle.columnGap || toolBarStyle.gap || '0') || 0;
    const toolLeftGap = Number.parseFloat(toolLeftStyle?.columnGap || toolLeftStyle?.gap || '0') || 0;
    const nextWidth = Math.max(
      0,
      toolBarElement.clientWidth
      - toolRightElement.offsetWidth
      - toolPrefixElement.offsetWidth
      - toolBarGap
      - toolLeftGap
      - TOOL_BAR_MIN_RIGHT_GAP
    );

    setToolContentMaxWidth((prev) => (
      Math.abs((prev || 0) - nextWidth) < 1 ? prev : nextWidth
    ));
  }, []);

  React.useEffect(() => {
    const element = toolContentScrollRef.current;
    if (!element) return undefined;

    updateToolContentScrollState();
    element.addEventListener('scroll', updateToolContentScrollState, { passive: true });

    let observer = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        updateToolContentScrollState();
      });
      observer.observe(element);
      if (element.firstElementChild) {
        observer.observe(element.firstElementChild);
      }
    }

    window.addEventListener('resize', updateToolContentScrollState);

    return () => {
      element.removeEventListener('scroll', updateToolContentScrollState);
      observer?.disconnect();
      window.removeEventListener('resize', updateToolContentScrollState);
    };
  }, [activeTool, updateToolContentScrollState]);

  React.useEffect(() => {
    const toolBarElement = toolBarRef.current;
    const toolPrefixElement = toolLeftPrefixRef.current;
    const toolRightElement = toolRightRef.current;
    if (!toolBarElement || !toolPrefixElement || !toolRightElement) return undefined;

    updateToolContentMaxWidth();
    let observer = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        updateToolContentMaxWidth();
      });
      observer.observe(toolBarElement);
      observer.observe(toolPrefixElement);
      observer.observe(toolRightElement);
    }

    window.addEventListener('resize', updateToolContentMaxWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateToolContentMaxWidth);
    };
  }, [activeTool, model, updateToolContentMaxWidth]);

  const handleToolContentScroll = React.useCallback((direction) => {
    const element = toolContentScrollRef.current;
    if (!element) return;

    element.scrollBy({
      left: direction * TOOL_BAR_SCROLL_STEP,
      behavior: 'smooth',
    });
  }, []);

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

  const referenceQuery = React.useMemo(
    () => String(mentionState.query || '').trim().toLowerCase(),
    [mentionState.query]
  );
  const filteredSkillReferenceGroups = React.useMemo(() => (
    skills
      .map((skill) => {
        const skillKey = getSkillMentionLabel(skill);
        const nodes = skillReferenceTrees[skillKey] || [];
        return {
          skill,
          skillKey,
          label: skillKey,
          rootPath: normalizePath(skill?.__skillRoot || ''),
          nodes: filterTreeNodesByQuery(nodes, referenceQuery),
        };
      })
      .filter((group) => group.label && group.rootPath && group.nodes.length > 0)
  ), [referenceQuery, skillReferenceTrees, skills]);
  const filteredWorkspaceReferenceNodes = React.useMemo(
    () => filterTreeNodesByQuery(workspaceReferenceTrees[primarySkillWorkdir] || [], referenceQuery),
    [primarySkillWorkdir, referenceQuery, workspaceReferenceTrees]
  );
  const filteredLocalReferenceFiles = React.useMemo(() => {
    const forceExpanded = Boolean(referenceQuery);
    const localFiles = [];

    filteredSkillReferenceGroups.forEach((group) => {
      const rootNodeKey = `skill-root:${group.skillKey}`;
      if (forceExpanded || expandedReferenceNodeKeys.has(rootNodeKey)) {
        localFiles.push(
          ...collectVisibleTreeFiles(group.nodes, group.rootPath, rootNodeKey, expandedReferenceNodeKeys, {
            forceExpanded,
            sourceType: 'skill',
            sourceLabel: group.label,
          })
        );
      }
    });

    const workspaceRootNodeKey = `workspace-root:${primarySkillWorkdir}`;
    if (primarySkillWorkdir && (forceExpanded || expandedReferenceNodeKeys.has(workspaceRootNodeKey))) {
      localFiles.push(
        ...collectVisibleTreeFiles(filteredWorkspaceReferenceNodes, primarySkillWorkdir, workspaceRootNodeKey, expandedReferenceNodeKeys, {
          forceExpanded,
          sourceType: 'workspace',
          sourceLabel: workspaceReferenceRootLabel,
        })
      );
    }

    return localFiles;
  }, [
    expandedReferenceNodeKeys,
    filteredSkillReferenceGroups,
    filteredWorkspaceReferenceNodes,
    primarySkillWorkdir,
    referenceQuery,
    workspaceReferenceRootLabel,
  ]);
  const activeSuggestionItems = mentionState.symbol === '#'
    ? [...filteredLocalReferenceFiles, ...filteredUploadedFiles]
    : filteredSkills;

  React.useEffect(() => {
    latestReferenceSuggestionItemsRef.current = filteredLocalReferenceFiles;
  }, [filteredLocalReferenceFiles]);

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
          return [
            'span',
            mergeAttributes(HTMLAttributes, {
              'data-type': 'mention',
              class: 'chat-panel__input-mention-token chat-panel__input-mention-token--skill',
            }),
            getMentionText(node.attrs),
          ];
        },
      }).configure({
        HTMLAttributes: {
          class: 'chat-panel__input-mention-token chat-panel__input-mention-token--skill',
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
            return getSkillMentionLabel(skill).toLowerCase().startsWith(liveQuery);
          })
          : [];
        const liveSuggestionItems = liveMentionState?.symbol === '#'
          ? [...latestReferenceSuggestionItemsRef.current, ...latestUploadedFileMetaRef.current.filter((file) => {
            const liveQuery = String(liveMentionState.query || '').trim().toLowerCase();
            if (!liveQuery) return true;
            return String(file?.name || '').toLowerCase().includes(liveQuery);
          })]
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

  const toggleReferenceNodeExpanded = React.useCallback((nodeKey) => {
    if (!nodeKey || referenceQuery) return;
    setExpandedReferenceNodeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  }, [referenceQuery]);

  const activeSuggestionUid = mentionState.symbol === '#'
    ? activeSuggestionItems[mentionState.activeIndex]?.uid || ''
    : '';

  const renderReferenceTreeNodes = React.useCallback((
    nodes,
    rootPath,
    scopeKey,
    depth = 1,
    sourceType = 'workspace',
    sourceLabel = ''
  ) => {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    const forceExpanded = Boolean(referenceQuery);

    return nodes.map((node) => {
      const compositeKey = `${scopeKey}:${node.path}`;
      const isDirectory = node.type === 'directory';
      const isExpanded = forceExpanded || expandedReferenceNodeKeys.has(compositeKey);
      const localFile = !isDirectory
        ? createLocalReferenceFile({ rootPath, node, sourceType, sourceLabel })
        : null;
      const isActive = !isDirectory && localFile?.uid && activeSuggestionUid === localFile.uid;

      return (
        <React.Fragment key={compositeKey}>
          <button
            type="button"
            className={`chat-panel__reference-tree-item ${isDirectory ? 'is-directory' : 'is-file'} ${isActive ? 'active' : ''}`.trim()}
            style={{ '--reference-depth': depth }}
            onMouseDown={(event) => {
              event.preventDefault();
              if (isDirectory) {
                toggleReferenceNodeExpanded(compositeKey);
                return;
              }
              insertFileReference(localFile);
            }}
          >
            <span
              className={`chat-panel__reference-tree-toggle ${isExpanded ? 'is-expanded' : ''}`.trim()}
              aria-hidden="true"
            >
              {isDirectory ? <ChevronRight size={12} /> : null}
            </span>
            <span className="chat-panel__reference-tree-icon" aria-hidden="true">
              {isDirectory
                ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />)
                : <File size={14} />}
            </span>
            <span className="chat-panel__reference-tree-label">{node.name}</span>
          </button>
          {isDirectory && isExpanded && Array.isArray(node.children)
            ? renderReferenceTreeNodes(
              node.children,
              rootPath,
              compositeKey,
              depth + 1,
              sourceType,
              sourceLabel
            )
            : null}
        </React.Fragment>
      );
    });
  }, [activeSuggestionUid, expandedReferenceNodeKeys, insertFileReference, referenceQuery, toggleReferenceNodeExpanded]);

  const renderReferenceRoot = React.useCallback((rootNodeKey, label, nodes, rootPath, sourceType) => {
    const hasNodes = Array.isArray(nodes) && nodes.length > 0;
    const forceExpanded = Boolean(referenceQuery);
    const isExpanded = forceExpanded || expandedReferenceNodeKeys.has(rootNodeKey);

    return (
      <React.Fragment key={rootNodeKey}>
        <button
          type="button"
          className="chat-panel__reference-tree-item chat-panel__reference-tree-item--root"
          onMouseDown={(event) => {
            event.preventDefault();
            toggleReferenceNodeExpanded(rootNodeKey);
          }}
        >
          <span
            className={`chat-panel__reference-tree-toggle ${isExpanded ? 'is-expanded' : ''}`.trim()}
            aria-hidden="true"
          >
            <ChevronRight size={12} />
          </span>
          <span className="chat-panel__reference-tree-icon" aria-hidden="true">
            {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <span className="chat-panel__reference-tree-label">{label}</span>
        </button>
        {isExpanded && hasNodes ? (
          <div className="chat-panel__reference-tree-children">
            {renderReferenceTreeNodes(nodes, rootPath, rootNodeKey, 1, sourceType, label)}
          </div>
        ) : null}
        {isExpanded && !hasNodes ? (
          <div className="chat-panel__reference-empty">没有可引用的文件</div>
        ) : null}
      </React.Fragment>
    );
  }, [expandedReferenceNodeKeys, referenceQuery, renderReferenceTreeNodes, toggleReferenceNodeExpanded]);

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
      .replace(/\/\s*百万tokens/gi, '')
      .replace(/\/\s*1,?000,?000\s*tokens/gi, '')
      .replace(/[,\s]+$/g, '')
      .trim();
  };

  const formatModelOptionPriceMultiplier = (value) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';
    const normalizedValue = rawValue.replace(/x$/i, '').trim();
    const numericValue = Number(normalizedValue);
    if (Number.isFinite(numericValue)) {
      return `${numericValue.toFixed(2)}x`;
    }
    const matchedValue = normalizedValue.match(/-?\d+(?:\.\d+)?/);
    if (!matchedValue) return '';
    const parsedValue = Number(matchedValue[0]);
    return Number.isFinite(parsedValue) ? `${parsedValue.toFixed(2)}x` : '';
  };

  const resolveModelOptionPriceMultiplier = (item) => {
    if (!item || typeof item !== 'object') return '';
    return formatModelOptionPriceMultiplier(
      item?.price_multiplier_text ?? item?.pricing?.price_multiplier_text
    );
  };

  const renderModelOptionPopoverContent = (text, description = '', priceMultiplier = '') => {
    if (!description && !priceMultiplier) {
      return null;
    }
    return (
      <div className="chat-panel__model-option-popover">
        <div className="chat-panel__model-option-popover-title">{text}</div>
        {description ? (
          <div className="chat-panel__model-option-popover-description">{description}</div>
        ) : null}
        {priceMultiplier ? (
          <div className="chat-panel__model-option-popover-multiplier">
            <span>消耗速度</span>
            <span>{priceMultiplier} 倍率</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderModelOptionInner = (text, icon, supportsReadImage = false, badges = [], priceMultiplier = '') => (
    <span className="chat-panel__model-option">
      <span className="chat-panel__model-option-leading">
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
      {priceMultiplier ? (
        <span className="chat-panel__model-option-multiplier">{priceMultiplier}</span>
      ) : null}
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
      priceMultiplier: String(optionMeta.priceMultiplier || '').trim(),
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

  const availableModelOptions = React.useMemo(() => (
    (Array.isArray(modelOptions) ? modelOptions : [])
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
            selectedLabel: renderSelectedModelLabel(displayText, null),
          };
        }
        const value = item?.value;
        const labelText = item?.label || item?.name || item?.value || item?.id || '';
        const displayText = formatModelDisplayName(labelText);
        const icon = item?.icon || item?.iconUrl || item?.black_icon || '';
        const supportsReadImage = Boolean(item?.read_image);
        const priceMultiplier = resolveModelOptionPriceMultiplier(item);
        return value ? {
          value,
          label: displayText,
          displayText,
          icon,
          supportsReadImage,
          description: String(item?.description || '').trim(),
          badges: Array.isArray(item?.badges) ? item.badges : [],
          priceMultiplier,
          selectedLabel: renderSelectedModelLabel(displayText, icon),
        } : null;
      })
      .filter(Boolean)
  ), [modelOptions]);
  const selectedModelConfig = (Array.isArray(modelOptions) ? modelOptions : []).find((item) => {
    if (!item || typeof item !== 'object') return false;
    const candidateValue = String(item?.value || item?.id || item?.name || '').trim();
    return candidateValue && candidateValue === String(model || '').trim();
  }) || null;
  const selectedModelSupportsReadImage = Boolean(selectedModelConfig?.read_image);
  const normalizedSelectedVideoGenerationMode = React.useMemo(
    () => normalizeVideoGenerationMode(selectedVideoGenerationMode),
    [selectedVideoGenerationMode]
  );
  const videoModeUploadLimit = React.useMemo(
    () => getVideoModeUploadLimit(normalizedSelectedVideoGenerationMode),
    [normalizedSelectedVideoGenerationMode]
  );
  const imagePanUploadLimit = React.useMemo(() => ({
    maxCount: IMAGE_PAN_UPLOAD_MAX_COUNT,
    imageOnly: true,
    accept: 'image/*',
    validateFile: null,
    typeErrorMessage: '图片模式仅支持上传图片',
  }), []);
  const activeUploadLimit = React.useMemo(() => {
    if (activeTool === 'ai-video') return videoModeUploadLimit;
    if (activeTool === 'image-pan') return imagePanUploadLimit;
    return {
      maxCount: MAX_UPLOAD_COUNT,
      imageOnly: false,
      accept: undefined,
      validateFile: null,
      typeErrorMessage: '',
    };
  }, [activeTool, imagePanUploadLimit, videoModeUploadLimit]);
  const uploadAccept = React.useMemo(() => {
    if (activeUploadLimit.imageOnly) return 'image/*';
    return activeUploadLimit.accept;
  }, [activeUploadLimit]);
  const imagePanUploadPlaceholders = React.useMemo(() => {
    if (activeTool !== 'image-pan') return [];
    const uploadedImageCount = uploadedFileMeta.filter((item) => isImageFileType(item?.fileType)).length;
    return uploadedImageCount >= IMAGE_PAN_UPLOAD_MAX_COUNT ? [] : IMAGE_PAN_PLACEHOLDER_CONFIG;
  }, [activeTool, uploadedFileMeta]);
  const videoUploadPlaceholders = React.useMemo(() => {
    if (activeTool !== 'ai-video') return [];

    if (normalizedSelectedVideoGenerationMode === 'reference') {
      return uploadedFileMeta.length >= VIDEO_REFERENCE_UPLOAD_MAX_COUNT
        ? []
        : VIDEO_GENERATION_PLACEHOLDER_CONFIG.reference;
    }

    const configuredSlots = VIDEO_GENERATION_PLACEHOLDER_CONFIG[normalizedSelectedVideoGenerationMode] || [];
    if (configuredSlots.length === 0) return [];

    const occupiedSlotIds = new Set(
      uploadedFileMeta
        .filter((item) => isImageFileType(item?.fileType))
        .map((item) => String(item?.slotId || '').trim())
        .filter(Boolean)
    );
    if (occupiedSlotIds.size > 0) {
      return configuredSlots.filter((item) => !occupiedSlotIds.has(String(item?.key || '').trim()));
    }

    const uploadedImageCount = uploadedFileMeta.filter((item) => isImageFileType(item?.fileType)).length;
    return configuredSlots.slice(Math.min(uploadedImageCount, configuredSlots.length));
  }, [activeTool, normalizedSelectedVideoGenerationMode, uploadedFileMeta]);
  const videoPreviewSlotOrder = React.useMemo(() => {
    if (activeTool !== 'ai-video') return [];
    return (VIDEO_GENERATION_PLACEHOLDER_CONFIG[normalizedSelectedVideoGenerationMode] || []).map((item) => item.key);
  }, [activeTool, normalizedSelectedVideoGenerationMode]);
  const activeUploadPlaceholders = React.useMemo(() => {
    if (activeTool === 'ai-video') return videoUploadPlaceholders;
    if (activeTool === 'image-pan') return imagePanUploadPlaceholders;
    return [];
  }, [activeTool, imagePanUploadPlaceholders, videoUploadPlaceholders]);
  const activePreviewSlotOrder = React.useMemo(() => {
    if (activeTool === 'ai-video') return videoPreviewSlotOrder;
    return [];
  }, [activeTool, videoPreviewSlotOrder]);

  const groupedModelOptions = React.useMemo(() => (
    availableModelOptions.length > 0
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
      : []
  ), [availableModelOptions]);
  const buildMarkdownFileLink = (name, url) => {
    const safeName = String(name || '附件')
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]');
    return `[${safeName}](${url})`;
  };
  const buildAttachmentReferenceText = (file = {}) => {
    const directUrl = String(file?.url || '').trim();
    if (directUrl) {
      return buildMarkdownFileLink(file.name, directUrl);
    }

    const localUrl = toDisplayFileUrl(file?.sourcePath);
    if (localUrl) {
      return buildMarkdownFileLink(file.name, localUrl);
    }

    return getFileReferenceText(file);
  };
  const hasSelectedLocalFile = uploadFileList.length > 0;
  const digitalHumanCompletionState = React.useMemo(
    () => getDigitalHumanTemplateCompletionState(editor),
    [editor, input]
  );
  const aiWriteCompletionState = React.useMemo(
    () => getAiWriteTemplateCompletionState(editor, selectedAiWritePresetId),
    [editor, input, selectedAiWritePresetId]
  );
  const canSend = String(input || '').trim().length > 0 || hasSelectedLocalFile;
  const isDigitalHumanSendBlocked = activeTool === 'digital-human' && !digitalHumanCompletionState.isComplete;
  const isAiWriteSendBlocked = activeTool === 'ai-write' && !aiWriteCompletionState.isComplete;
  const isSendDisabled = !canSend || modelListLoading || isDigitalHumanSendBlocked || isAiWriteSendBlocked;

  const removeLocalFile = React.useCallback((uid) => {
    setUploadFileList((prev) => prev.filter((item) => item.uid !== uid));
    setUploadedFileMeta((prev) => {
      const removedItem = prev.find((item) => item.uid === uid);
      revokeLocalObjectUrl(removedItem?.localThumbUrl);
      return prev.filter((item) => item.uid !== uid);
    });
  }, []);

  const queueFilesForUpload = React.useCallback(async (files = []) => {
    if (sessionSending) return;
    const normalizedFiles = files.filter((item) => isFileLike(item));
    if (normalizedFiles.length === 0) return;
    const pendingSlotId = String(pendingTemplateSlotAutoReferenceRef.current || '').trim();
    const isPendingVideoFrameSlot = activeTool === 'ai-video' && isVideoFrameSlotId(pendingSlotId);

    const { imageOnly, maxCount, typeErrorMessage, validateFile } = activeUploadLimit;
    const typeFilteredFiles = imageOnly
      ? normalizedFiles.filter((item) => isImageFileType(getResolvedUploadFileType(item)))
      : typeof validateFile === 'function'
        ? normalizedFiles.filter((item) => validateFile(item))
        : normalizedFiles;
    if (typeFilteredFiles.length !== normalizedFiles.length) {
      message.error(typeErrorMessage);
    }
    if (typeFilteredFiles.length === 0) return;

    const currentCount = imageOnly
      ? uploadedFileMeta.filter((item) => isImageFileType(item?.fileType)).length
      : uploadedFileMeta.length;
    const availableSlots = Math.max(0, maxCount - currentCount);
    const acceptedFiles = [];

    let hasOverflow = false;

    typeFilteredFiles.forEach((file) => {
      if (acceptedFiles.length >= availableSlots) {
        hasOverflow = true;
        return;
      }
      acceptedFiles.push(file);
    });

    if (hasOverflow) {
      message.error(activeTool === 'ai-video' || activeTool === 'image-pan'
        ? `当前模式最多上传 ${maxCount} 个文件`
        : `最多选择 ${MAX_UPLOAD_COUNT} 个文件`);
    }
    if (acceptedFiles.length === 0) return;
    const resolvedAcceptedFiles = isPendingVideoFrameSlot ? acceptedFiles.slice(0, 1) : acceptedFiles;
    if (isPendingVideoFrameSlot && acceptedFiles.length > 1) {
      message.error('当前槽位一次只能上传 1 张图片');
    }

    const nextEntries = (await Promise.all(resolvedAcceptedFiles.map((file) => createLocalAttachmentEntry(file)))).filter(Boolean);
    if (nextEntries.length === 0) return;

    const nextUploadItems = nextEntries.map((item) => (
      isPendingVideoFrameSlot
        ? { ...item.uploadItem, slotId: pendingSlotId }
        : item.uploadItem
    ));
    const nextFileMeta = nextEntries.map((item) => (
      isPendingVideoFrameSlot
        ? { ...item.fileMeta, slotId: pendingSlotId, slotLabel: TEMPLATE_MEDIA_ROLE_LABELS[pendingSlotId] || '' }
        : item.fileMeta
    ));

    setUploadFileList((prev) => {
      if (!isPendingVideoFrameSlot) return [...prev, ...nextUploadItems];
      const retainedItems = prev.filter((item) => String(item?.slotId || '').trim() !== pendingSlotId);
      return sortItemsByVideoFrameSlot([...retainedItems, ...nextUploadItems]);
    });
    setUploadedFileMeta((prev) => {
      if (!isPendingVideoFrameSlot) return [...prev, ...nextFileMeta];
      const replacedItem = prev.find((item) => String(item?.slotId || '').trim() === pendingSlotId);
      revokeLocalObjectUrl(replacedItem?.localThumbUrl);
      const retainedItems = prev.filter((item) => String(item?.slotId || '').trim() !== pendingSlotId);
      return sortItemsByVideoFrameSlot([...retainedItems, ...nextFileMeta]);
    });

    if (pendingSlotId && nextFileMeta[0]) {
      syncTemplateFileReferenceNode(editor, pendingSlotId, nextFileMeta[0]);
      pendingTemplateSlotAutoReferenceRef.current = '';
    }
  }, [activeTool, activeUploadLimit, editor, sessionSending, uploadedFileMeta]);

  const handleBeforeUpload = React.useCallback((file, batchFileList = []) => {
    const normalizedBatch = Array.isArray(batchFileList) && batchFileList.length > 0
      ? batchFileList
      : [file];
    if (normalizedBatch[0]?.uid !== file?.uid) {
      return AntUpload.LIST_IGNORE;
    }
    queueFilesForUpload(normalizedBatch);
    return AntUpload.LIST_IGNORE;
  }, [queueFilesForUpload]);

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
      .map((item) => ({
        uid: String(item?.uid || '').trim(),
        file: item?.originFileObj || item,
        fileType: String(item?.type || item?.originFileObj?.type || '').trim(),
      }))
      .filter((item) => isFileLike(item.file))
      .filter((item) => {
        const mimeType = uploadedImageTypesByUid.get(item.uid) || item.fileType;
        return mimeType.toLowerCase().startsWith('image/');
      });
    if (imageFiles.length === 0) return [];
    const payloads = await Promise.all(imageFiles.map(async ({ uid, file, fileType }) => {
      const dataUrl = await readFileAsDataUrl(file);
      const [, base64 = ''] = dataUrl.split(',', 2);
      if (!base64) return null;
      return {
        uid,
        data: base64,
        media_type: fileType || String(file?.type || 'image/png').trim() || 'image/png',
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
    const imagePayloadByUid = new Map(imagePayloads.map((item) => [item.uid, item]));
    const imageAttachmentPreviews = hasMultimodalImages
      ? uploadedFileMeta
        .filter((item) => String(item?.fileType || '').toLowerCase().startsWith('image/'))
        .map((item) => {
          const payload = imagePayloadByUid.get(String(item?.uid || '').trim());
          const dataUrl = payload ? `data:${payload.media_type};base64,${payload.data}` : item.previewUrl;
          return createFileReferenceAttrs(item, {
            thumbnailUrl: dataUrl || item.thumbnailUrl,
            previewUrl: dataUrl || item.previewUrl,
            localThumbUrl: '',
            localPreviewUrl: ''
          });
        })
      : [];
    const uploadFileByUid = new Map(
      uploadFileList
        .filter((item) => item?.status !== 'removed')
        .map((item) => [String(item?.uid || '').trim(), item?.originFileObj || item])
    );
    const pendingLocalAttachments = uploadedFileMeta
      .filter((item) => !String(item?.sourcePath || '').trim() && !String(item?.url || '').trim())
      .map((item) => ({
        uid: String(item?.uid || '').trim(),
        name: String(item?.name || '').trim(),
        fileType: String(item?.fileType || '').trim(),
        file: uploadFileByUid.get(String(item?.uid || '').trim()),
      }))
      .filter((item) => item.uid && item.name && isFileLike(item.file));
    const remainingLocalReferences = uploadedFileMeta
      .filter((item) => !serializedMessage.referencedFileUids.has(item.uid))
      .map((item) => buildAttachmentReferenceText(item));
    const voiceSquareComposeParts = activeTool === 'voice-square'
      ? getVoiceSquareComposeParts(editor)
      : null;
    const text = activeTool === 'voice-square'
      ? voiceSquareComposeParts?.scriptText || ''
      : serializedMessage.text || String(input || '').trim();
    const combined = [text, ...remainingLocalReferences].filter(Boolean).join('\n');
    if (!combined) return;
    const nextMessage =
      activeTool === 'voice-square'
        ? [
          `将说话内容: [${combined}] 利用音色${selectedVoiceLibraryItem?.global_voice_id || '默认音色'}合成语音。`,
          voiceSquareComposeParts?.extraText || '',
        ].filter(Boolean).join(' ')
        : activeTool === 'image-pan'
          ? `请使用模型 ${selectedImagePanModel}，分辨率 ${selectedImagePanResolution} 生成图片：${combined}`
          : activeTool === 'ai-video'
            ? `请使用模型 ${selectedVideoModel}，生成方式 ${VIDEO_GENERATION_MODE_LABELS[normalizeVideoGenerationMode(selectedVideoGenerationMode)] || VIDEO_GENERATION_MODE_LABELS[DEFAULT_VIDEO_GENERATION_MODE]}，分辨率 ${selectedVideoResolution}，时长 ${selectedVideoDuration} 秒，${selectedVideoGenerateAudio ? '输出有声音' : '输出无声音'}，${selectedVideoSeedanceOffline ? '开启闲时生成' : '关闭闲时生成'}，${selectedVideoSuperResolve ? '开启超分' : '关闭超分'} 生成视频提示词：${combined}`
        : combined;
    closeMentionPanel();
    handleSend && handleSend(nextMessage, {
      images: imagePayloads.map(({ data, media_type }) => ({ data, media_type })),
      imageAttachmentPreviews,
      pendingLocalAttachments
    });
    if (activeTool) {
      setActiveTool(null);
    }
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
    syncDigitalHumanTemplateDocument(
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
    try {
      localStorage.setItem(IMAGE_PAN_MODEL_STORAGE_KEY, normalizeImagePanModel(selectedImagePanModel));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedImagePanModel]);

  React.useEffect(() => {
    try {
      localStorage.setItem(IMAGE_PAN_RESOLUTION_STORAGE_KEY, normalizeImagePanResolution(selectedImagePanResolution));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedImagePanResolution]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_MODEL_STORAGE_KEY, normalizeVideoModel(selectedVideoModel));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoModel]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_GENERATION_MODE_STORAGE_KEY, normalizeVideoGenerationMode(selectedVideoGenerationMode));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoGenerationMode]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_RESOLUTION_STORAGE_KEY, normalizeVideoResolution(selectedVideoResolution));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoResolution]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_DURATION_STORAGE_KEY, String(normalizeVideoDuration(selectedVideoDuration)));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoDuration]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_GENERATE_AUDIO_STORAGE_KEY, String(Boolean(selectedVideoGenerateAudio)));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoGenerateAudio]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_SEEDANCE_OFFLINE_STORAGE_KEY, String(Boolean(selectedVideoSeedanceOffline)));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoSeedanceOffline]);

  React.useEffect(() => {
    try {
      localStorage.setItem(VIDEO_SUPER_RESOLVE_STORAGE_KEY, String(Boolean(selectedVideoSuperResolve)));
    } catch (error) {
      // Ignore local storage persistence failures.
    }
  }, [selectedVideoSuperResolve]);

  const applyAiWriteTemplate = React.useCallback((presetId) => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(buildAiWriteEditorDocument(presetId), false);
    editor.commands.focus('end');
  }, [editor]);

  const handleImageTemplateApply = React.useCallback((prompt) => {
    setInput(String(prompt || ''));
    if (!editor || editor.isDestroyed) return;
    window.requestAnimationFrame(() => {
      if (!editor || editor.isDestroyed) return;
      editor.commands.focus('end');
    });
  }, [editor, setInput]);

  const handleImageTemplateMediaApply = React.useCallback(async (template) => {
    const nextTemplateAttachments = await createImageTemplateAttachmentEntries(template);
    setUploadedFileMeta((prev) => {
      const retainedItems = (Array.isArray(prev) ? prev : []).filter((item) => String(item?.sourceType || '').trim() !== 'image_template');
      return [...retainedItems, ...nextTemplateAttachments];
    });
  }, []);

  const handleVideoTemplateMediaApply = React.useCallback(async (template) => {
    const nextTemplateAttachments = await createVideoTemplateAttachmentEntries(template);
    setUploadedFileMeta((prev) => {
      const retainedItems = (Array.isArray(prev) ? prev : []).filter((item) => String(item?.sourceType || '').trim() !== 'video_template');
      return [...retainedItems, ...nextTemplateAttachments];
    });
  }, []);

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
        <LocalFilePreviewList
          files={uploadedFileMeta}
          placeholders={activeUploadPlaceholders}
          slotOrder={activePreviewSlotOrder}
          onRemove={(file) => removeLocalFile(file?.uid)}
          onAddFile={(placeholder) => requestUploadPickerRef.current(placeholder?.key || '')}
        />
        <div ref={toolBarRef} className="chat-panel__tool-bar">
          <div className="chat-panel__tool-left">
            <div ref={toolLeftPrefixRef} className="chat-panel__tool-left-prefix">
              <AntUpload
                multiple
                accept={uploadAccept}
                beforeUpload={handleBeforeUpload}
                showUploadList={false}
                disabled={sessionSending}
              >
                <span
                  ref={toolbarUploadTriggerRef}
                  className="chat-panel__tool-button chat-panel__tool-button--icon-only"
                  aria-label="选择文件"
                  title="选择文件"
                  role="button"
                >
                  <img className="chat-panel__tool-icon" src={ChatToolFileIcon} alt="" aria-hidden="true" />
                </span>
              </AntUpload>
              <span className="chat-panel__tool-divider" aria-hidden="true" />
            </div>
            <div
              className="chat-panel__tool-content-shell"
              style={toolContentMaxWidth !== null ? { maxWidth: `${toolContentMaxWidth}px` } : undefined}
            >
              <div
                className={[
                  'chat-panel__tool-content-viewport',
                  toolContentScrollState.isOverflowing ? 'is-overflowing' : '',
                  toolContentScrollState.canScrollLeft ? 'can-scroll-left' : '',
                  toolContentScrollState.canScrollRight ? 'can-scroll-right' : '',
                ].filter(Boolean).join(' ')}
              >
                <div ref={toolContentScrollRef} className="chat-panel__tool-content-scroll">
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
                  ) : activeTool === 'image-pan' ? (
                    <ImagePanToolDetail
                      disabled={sessionSending}
                      onBack={handleToolDetailBack}
                      selectedModel={selectedImagePanModel}
                      selectedResolution={selectedImagePanResolution}
                      onModelChange={setSelectedImagePanModel}
                      onResolutionChange={setSelectedImagePanResolution}
                      onPromptChange={handleImageTemplateApply}
                      onTemplateMediaChange={handleImageTemplateMediaApply}
                    />
                  ) : activeTool === 'ai-video' ? (
                    <VideoToolDetail
                      disabled={sessionSending}
                      onBack={handleToolDetailBack}
                      selectedModel={selectedVideoModel}
                      selectedGenerationMode={selectedVideoGenerationMode}
                      selectedResolution={selectedVideoResolution}
                      selectedDuration={selectedVideoDuration}
                      selectedGenerateAudio={selectedVideoGenerateAudio}
                      selectedSeedanceOffline={selectedVideoSeedanceOffline}
                      selectedSuperResolve={selectedVideoSuperResolve}
                      onModelChange={setSelectedVideoModel}
                      onGenerationModeChange={setSelectedVideoGenerationMode}
                      onResolutionChange={setSelectedVideoResolution}
                      onDurationChange={setSelectedVideoDuration}
                      onGenerateAudioChange={setSelectedVideoGenerateAudio}
                      onSeedanceOfflineChange={setSelectedVideoSeedanceOffline}
                      onSuperResolveChange={setSelectedVideoSuperResolve}
                      onPromptChange={handleImageTemplateApply}
                      onTemplateMediaChange={handleVideoTemplateMediaApply}
                    />
                  ) : (
                    <ToolArea
                      toolAreaRef={beginnerGuideAiToolAreaRef}
                      disabled={sessionSending}
                      onSelect={handleToolSelect}
                    />
                  )}
                </div>
              </div>
              <div className="chat-panel__tool-content-nav-group" aria-hidden={!toolContentScrollState.isOverflowing}>
                <button
                  type="button"
                  className={`chat-panel__tool-content-nav ${toolContentScrollState.canScrollLeft ? 'is-visible' : ''}`}
                  aria-label="向左查看工具"
                  onClick={() => handleToolContentScroll(-1)}
                  disabled={!toolContentScrollState.canScrollLeft}
                >
                  <ChevronLeft className="chat-panel__tool-content-nav-icon" />
                </button>
                <button
                  type="button"
                  className={`chat-panel__tool-content-nav ${toolContentScrollState.canScrollRight ? 'is-visible' : ''}`}
                  aria-label="向右查看工具"
                  onClick={() => handleToolContentScroll(1)}
                  disabled={!toolContentScrollState.canScrollRight}
                >
                  <ChevronRight className="chat-panel__tool-content-nav-icon" />
                </button>
              </div>
            </div>
          </div>
          <div ref={toolRightRef} className="chat-panel__tool-right">
            <div ref={beginnerGuideModelPickerRef}>
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
                  const priceMultiplier = String(optionMeta?.priceMultiplier || '').trim();
                  const optionContent = renderModelOptionInner(displayText, icon, supportsReadImage, badges, priceMultiplier);
                  return (
                    <div
                      className="chat-panel__model-option-trigger"
                      onPointerEnter={optionValue ? (event) => showHoveredModelCard(optionMeta, event.currentTarget) : undefined}
                      onPointerLeave={optionValue ? clearHoveredModelCard : undefined}
                    >
                      {optionContent}
                    </div>
                  );
                }}
              />
            </div>
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
          ref={(node) => {
            inputWrapRef.current = node;
            if (beginnerGuideInputAreaRef) {
              beginnerGuideInputAreaRef.current = node;
            }
          }}
          className={`chat-panel__input-wrap ${isDragActive ? 'drag-active' : ''}`}
          onDragEnter={handleInputDragEnter}
          onDragOver={handleInputDragOver}
          onDragLeave={handleInputDragLeave}
          onDrop={handleInputDrop}
        >
          {mentionState.open && (
            (mentionState.symbol === '@')
            || (mentionState.symbol === '#')
          ) ? (
            <div
              ref={mentionPanelRef}
              className={`chat-panel__skill-mention-panel ${
                mentionState.symbol === '#'
                  ? 'chat-panel__skill-mention-panel--file-tree'
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
                {mentionState.symbol === '@' && !skillsLoading && !skillsError && filteredSkills.length === 0 ? (
                  <div className="chat-panel__skill-mention-empty">没有匹配的技能</div>
                ) : null}
                {mentionState.symbol === '@' && !skillsLoading && !skillsError && filteredSkills.map((skill, index) => {
                  const label = getSkillMentionLabel(skill);
                  const isActive = index === mentionState.activeIndex;
                  return (
                    <button
                      key={skill.id || skill.folderName || skill.filename || skill.name}
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
                {mentionState.symbol === '#' && (
                  <>
                    {referenceTreesLoading ? <div className="chat-panel__skill-mention-empty">加载文件中...</div> : null}
                    {!referenceTreesLoading && referenceTreesError ? (
                      <div className="chat-panel__skill-mention-empty">{referenceTreesError}</div>
                    ) : null}
                    {!referenceTreesLoading && !referenceTreesError && filteredSkillReferenceGroups.length > 0 ? (
                      <div className="chat-panel__reference-section">
                        <div className="chat-panel__reference-section-title">技能成员</div>
                        {filteredSkillReferenceGroups.map((group) => (
                          renderReferenceRoot(
                            `skill-root:${group.skillKey}`,
                            group.label,
                            group.nodes,
                            group.rootPath,
                            'skill'
                          )
                        ))}
                      </div>
                    ) : null}
                    {!referenceTreesLoading && !referenceTreesError && primarySkillWorkdir ? (
                      <div className="chat-panel__reference-section">
                        <div className="chat-panel__reference-section-title">工作空间</div>
                        {renderReferenceRoot(
                          `workspace-root:${primarySkillWorkdir}`,
                          workspaceReferenceRootLabel,
                          filteredWorkspaceReferenceNodes,
                          primarySkillWorkdir,
                          'workspace'
                        )}
                      </div>
                    ) : null}
                    {!referenceTreesLoading
                    && !referenceTreesError
                    && filteredSkillReferenceGroups.length === 0
                    && filteredWorkspaceReferenceNodes.length === 0
                    && filteredUploadedFiles.length === 0 ? (
                      <div className="chat-panel__skill-mention-empty chat-panel__skill-mention-empty--upload">
                        <Empty
                          description={referenceQuery ? '没有匹配的文件' : '你还没有可引用的文件'}
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          className="chat-panel__skill-mention-empty-state"
                        />
                      </div>
                      ) : null}
                    <div className="chat-panel__reference-section">
                      <div className="chat-panel__reference-section-header">
                        <span className="chat-panel__reference-section-title">本地文件</span>
                        <AntUpload
                          multiple
                          accept={uploadAccept}
                          beforeUpload={handleBeforeUpload}
                          showUploadList={false}
                          disabled={sessionSending}
                        >
                          <Button
                            type="default"
                            size="small"
                            className="chat-panel__reference-upload-action"
                            icon={<Plus className="chat-panel__skill-mention-empty-action-icon" />}
                          >
                            选择
                          </Button>
                        </AntUpload>
                      </div>
                      {filteredUploadedFiles.length === 0 ? (
                        <div className="chat-panel__reference-empty">
                          {uploadedFileMeta.length === 0 ? '暂无本地文件' : '没有匹配的本地文件'}
                        </div>
                      ) : null}
                      {filteredUploadedFiles.map((file, index) => {
                        const isActive = activeSuggestionUid
                          ? activeSuggestionUid === file.uid
                          : index === mentionState.activeIndex;
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
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
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
          {renderModelOptionPopoverContent(
            hoveredModelCard.text,
            hoveredModelCard.description,
            hoveredModelCard.priceMultiplier,
          )}
        </div>
      ) : null}
    </div>
  );
};

export default Composer;
