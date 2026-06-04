import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, Empty, Select, Spin, Tooltip, message } from 'antd';
import { Check, Play, Plus, Square, Trash2 } from 'lucide-react';
import { getProjectPricing } from '../../../../api/pricing';
import {
  deleteDigitalHumanAvatarLibrary,
  getDigitalHumanAvatarExamples,
} from '../../../../api/digital_human';
import './index.css';
import DigitalHumanSelectedIcon from '../../../../../public/digital_human_selected.svg';
import LipsIcon from '../../../../../public/lips.svg';
import DigitalHumanAvatarIcon from '../../../../../public/digital_human_avatar.svg';
import Point2Icon from '../../../../../public/point2.svg';
import VoiceLib, { useVoiceLib } from '../VoiceLib';
import CreateDigitalHumanAvatorDialog from '../CreateDigitalHumanAvatorDialog';

const DIGITAL_HUMAN_MODE_STORAGE_KEY = 'chat-panel:digital-human-mode';
const DIGITAL_HUMAN_AVATAR_TITLE_STORAGE_KEY = 'chat-panel:digital-human-avatar-title';
const DIGITAL_HUMAN_AVATAR_COVER_URL_STORAGE_KEY = 'chat-panel:digital-human-avatar-cover-url';
const DIGITAL_HUMAN_AVATAR_VOICE_ID_STORAGE_KEY = 'chat-panel:digital-human-avatar-voice-id';
const DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE = '和蔼奶奶';
const DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL = 'https://player.install-ai-guider.top/example/digital_human/omni_pic_example_1.jpg';
const DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID = 'gv_5cbd3d5acae44943805e9bb7717f9f97';
const DIGITAL_HUMAN_OPTIONS = [
  {
    value: 'lips',
    label: '口型驱动',
    icon: LipsIcon,
    projectId: '32',
  },
  {
    value: 'jimeng-avatar',
    label: '图片驱动',
    icon: DigitalHumanAvatarIcon,
    projectId: '77',
    badges: ['即梦', '官网同款'],
  },
];

const DEFAULT_PRICE_TEXT = '--/秒';
let digitalHumanPriceCache = null;
let digitalHumanPriceRequest = null;
let digitalHumanAvatarExampleCache = null;
let digitalHumanAvatarExampleRequest = null;
const DIGITAL_HUMAN_OPTION_VALUES = new Set(DIGITAL_HUMAN_OPTIONS.map((item) => item.value));

const normalizeDigitalHumanMode = (value) => {
  const normalizedValue = String(value || '').trim();
  return DIGITAL_HUMAN_OPTION_VALUES.has(normalizedValue) ? normalizedValue : DIGITAL_HUMAN_OPTIONS[0].value;
};

const readPersistedDigitalHumanMode = () => {
  try {
    return normalizeDigitalHumanMode(localStorage.getItem(DIGITAL_HUMAN_MODE_STORAGE_KEY));
  } catch (error) {
    return DIGITAL_HUMAN_OPTIONS[0].value;
  }
};

const persistDigitalHumanMode = (value) => {
  try {
    localStorage.setItem(DIGITAL_HUMAN_MODE_STORAGE_KEY, normalizeDigitalHumanMode(value));
  } catch (error) {
    // Ignore storage errors so digital human mode still works in-memory.
  }
};

const normalizeDigitalHumanAvatarTitle = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE;
};

const readPersistedDigitalHumanAvatarTitle = () => {
  try {
    return normalizeDigitalHumanAvatarTitle(localStorage.getItem(DIGITAL_HUMAN_AVATAR_TITLE_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE;
  }
};

const persistDigitalHumanAvatarTitle = (value) => {
  try {
    localStorage.setItem(
      DIGITAL_HUMAN_AVATAR_TITLE_STORAGE_KEY,
      normalizeDigitalHumanAvatarTitle(value)
    );
  } catch (error) {
    // Ignore storage errors so avatar title still works in-memory.
  }
};

const normalizeDigitalHumanAvatarCoverUrl = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL;
};

const readPersistedDigitalHumanAvatarCoverUrl = () => {
  try {
    return normalizeDigitalHumanAvatarCoverUrl(localStorage.getItem(DIGITAL_HUMAN_AVATAR_COVER_URL_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL;
  }
};

const persistDigitalHumanAvatarCoverUrl = (value) => {
  try {
    localStorage.setItem(
      DIGITAL_HUMAN_AVATAR_COVER_URL_STORAGE_KEY,
      normalizeDigitalHumanAvatarCoverUrl(value)
    );
  } catch (error) {
    // Ignore storage errors so avatar cover still works in-memory.
  }
};

const normalizeDigitalHumanAvatarVoiceId = (value) => {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID;
};

const readPersistedDigitalHumanAvatarVoiceId = () => {
  try {
    return normalizeDigitalHumanAvatarVoiceId(localStorage.getItem(DIGITAL_HUMAN_AVATAR_VOICE_ID_STORAGE_KEY));
  } catch (error) {
    return DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID;
  }
};

const persistDigitalHumanAvatarVoiceId = (value) => {
  try {
    localStorage.setItem(
      DIGITAL_HUMAN_AVATAR_VOICE_ID_STORAGE_KEY,
      normalizeDigitalHumanAvatarVoiceId(value)
    );
  } catch (error) {
    // Ignore storage errors so avatar voice id still works in-memory.
  }
};

const formatDigitalHumanPriceText = (price) => {
  const normalizedPrice = String(price || '').trim();
  if (!normalizedPrice) return DEFAULT_PRICE_TEXT;

  const numericPrice = Number(normalizedPrice);
  if (Number.isFinite(numericPrice)) {
    return `${Math.trunc(numericPrice)}/秒`;
  }

  const integerPrice = normalizedPrice.split('.')[0];
  return integerPrice ? `${integerPrice}/秒` : DEFAULT_PRICE_TEXT;
};

const buildDigitalHumanPriceMap = (projects = []) => DIGITAL_HUMAN_OPTIONS.reduce((acc, item) => {
  const matchedProject = projects.find((project) => String(project?.project_id || '').trim() === item.projectId);
  acc[item.value] = formatDigitalHumanPriceText(matchedProject?.resource_points_per_unit);
  return acc;
}, {});

const getInitialPriceMap = () => {
  if (digitalHumanPriceCache) return digitalHumanPriceCache;
  return DIGITAL_HUMAN_OPTIONS.reduce((acc, item) => {
    acc[item.value] = DEFAULT_PRICE_TEXT;
    return acc;
  }, {});
};

const isOfficialDigitalHumanAvatar = (avatarId) => String(avatarId || '').trim().startsWith('official_');

const normalizeDigitalHumanAvatarExamples = (result) => {
  const sourceItems = Array.isArray(result?.items)
    ? result.items
    : Array.isArray(result?.data?.items)
      ? result.data.items
      : [];

  return sourceItems
    .map((item, index) => ({
      __sourceIndex: index,
      avatar_id: String(item?.avatar_id || '').trim(),
      exampleKey: String(item?.avatar_id || item?.voice_id || item?.demo_url || item?.cover_url || `digital-human-example-${index}`),
      voice_id: String(item?.voice_id || ''),
      title: String(item?.title || '').trim(),
      cover_url: String(item?.cover_url || '').trim(),
      demo_url: String(item?.demo_url || '').trim(),
    }))
    .filter((item) => item.cover_url || item.demo_url)
    .sort((a, b) => {
      const aIsOfficial = isOfficialDigitalHumanAvatar(a.avatar_id);
      const bIsOfficial = isOfficialDigitalHumanAvatar(b.avatar_id);
      if (aIsOfficial === bIsOfficial) {
        return a.__sourceIndex - b.__sourceIndex;
      }
      return aIsOfficial ? -1 : 1;
    })
    .map(({ __sourceIndex, ...item }) => item);
};

const renderDigitalHumanOptionLabel = (text, icon, priceText, badges = []) => (
  <span className="chat-panel__model-option">
    <span className="chat-panel__model-option-main">
      <img className="chat-panel__model-option-icon" src={icon} alt="" aria-hidden="true" />
      <span className="chat-panel__model-option-text">{text}</span>
    </span>
    <span className="chat-panel__digital-human-option-side">
      {badges.length ? (
        <span className="chat-panel__digital-human-option-tags">
          {badges.map((badge) => (
            <span key={badge} className="chat-panel__model-option-tag">{badge}</span>
          ))}
        </span>
      ) : null}
      <span className="chat-panel__digital-human-option-price-wrap">
        <img className="chat-panel__digital-human-option-price-icon" src={Point2Icon} alt="" aria-hidden="true" />
        <span className="chat-panel__digital-human-option-price">{priceText}</span>
      </span>
      <Check className="chat-panel__digital-human-option-check" size={16} strokeWidth={2.25} aria-hidden="true" />
    </span>
  </span>
);

const renderDigitalHumanSelectedLabel = (text, icon, open = false) => (
  <span className="chat-panel__digital-human-selected">
    <span className="chat-panel__model-option-main">
      <img className="chat-panel__model-option-icon" src={icon} alt="" aria-hidden="true" />
      <span className="chat-panel__model-option-text">{text}</span>
    </span>
    <DownOutlined
      className={`chat-panel__digital-human-selected-arrow ${open ? 'is-open' : ''}`}
      aria-hidden="true"
    />
  </span>
);

const DigitalHumanToolDetail = ({
  disabled = false,
  onBack,
  children = null,
  onSelectedVoiceChange = null,
  onModeChange = null,
  onSelectedAvatarChange = null,
}) => {
  const [selectedMode, setSelectedMode] = React.useState(() => readPersistedDigitalHumanMode());
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [priceMap, setPriceMap] = React.useState(() => getInitialPriceMap());
  const [avatarDropdownOpen, setAvatarDropdownOpen] = React.useState(false);
  const [avatarExamples, setAvatarExamples] = React.useState(() => digitalHumanAvatarExampleCache || []);
  const [avatarExamplesLoading, setAvatarExamplesLoading] = React.useState(false);
  const [avatarExamplesError, setAvatarExamplesError] = React.useState('');
  const [selectedAvatarTitle, setSelectedAvatarTitle] = React.useState(() => readPersistedDigitalHumanAvatarTitle());
  const [selectedAvatarCoverUrl, setSelectedAvatarCoverUrl] = React.useState(() => readPersistedDigitalHumanAvatarCoverUrl());
  const [selectedAvatarVoiceId, setSelectedAvatarVoiceId] = React.useState(() => readPersistedDigitalHumanAvatarVoiceId());
  const [playingAvatarExampleKey, setPlayingAvatarExampleKey] = React.useState('');
  const [deletingAvatarIds, setDeletingAvatarIds] = React.useState([]);
  const [createAvatarDialogOpen, setCreateAvatarDialogOpen] = React.useState(false);
  const [createAvatarName, setCreateAvatarName] = React.useState('');
  const voiceLib = useVoiceLib({ onSelectedVoiceChange });
  const selectedAvatarButtonText = `形象 ${selectedAvatarTitle}`;

  const handleModeChange = React.useCallback((nextValue) => {
    const normalizedValue = normalizeDigitalHumanMode(nextValue);
    persistDigitalHumanMode(normalizedValue);
    setSelectedMode(normalizedValue);
    if (typeof onModeChange === 'function') {
      onModeChange(normalizedValue);
    }
  }, [onModeChange]);

  React.useEffect(() => {
    if (selectedMode !== 'jimeng-avatar') {
      setAvatarDropdownOpen(false);
      setPlayingAvatarExampleKey('');
    }
  }, [selectedMode]);

  React.useEffect(() => {
    if (typeof onSelectedAvatarChange !== 'function') return;
    onSelectedAvatarChange({
      title: selectedAvatarTitle,
      cover_url: selectedAvatarCoverUrl,
      voice_id: selectedAvatarVoiceId,
    });
  }, [onSelectedAvatarChange, selectedAvatarCoverUrl, selectedAvatarTitle, selectedAvatarVoiceId]);

  React.useEffect(() => {
    if (digitalHumanPriceCache) {
      setPriceMap(digitalHumanPriceCache);
      return undefined;
    }

    let cancelled = false;
    const fetchPricing = async () => {
      try {
        const pendingRequest = digitalHumanPriceRequest || getProjectPricing();
        digitalHumanPriceRequest = pendingRequest;
        const result = await pendingRequest;
        const projects = Array.isArray(result?.projects)
          ? result.projects
          : Array.isArray(result?.data?.projects)
            ? result.data.projects
            : [];
        const nextPriceMap = buildDigitalHumanPriceMap(projects);
        digitalHumanPriceCache = nextPriceMap;
        if (!cancelled) {
          setPriceMap(nextPriceMap);
        }
      } catch (error) {
        if (!cancelled) {
          setPriceMap(getInitialPriceMap());
        }
      } finally {
        digitalHumanPriceRequest = null;
      }
    };

    fetchPricing();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchAvatarExamples = React.useCallback(async () => {
    setAvatarExamplesLoading(true);
    setAvatarExamplesError('');
    try {
      const pendingRequest = digitalHumanAvatarExampleRequest || getDigitalHumanAvatarExamples();
      digitalHumanAvatarExampleRequest = pendingRequest;
      const result = await pendingRequest;
      const nextExamples = normalizeDigitalHumanAvatarExamples(result);
      digitalHumanAvatarExampleCache = nextExamples;
      setAvatarExamples(nextExamples);
    } catch (error) {
      setAvatarExamples(digitalHumanAvatarExampleCache || []);
      setAvatarExamplesError('加载失败，请稍后重试');
    } finally {
      setAvatarExamplesLoading(false);
      digitalHumanAvatarExampleRequest = null;
    }
  }, []);

  const handleAvatarDropdownOpenChange = React.useCallback((nextOpen) => {
    setAvatarDropdownOpen(nextOpen);
    if (!nextOpen) {
      setPlayingAvatarExampleKey('');
      return;
    }

    if (!digitalHumanAvatarExampleCache && !digitalHumanAvatarExampleRequest) {
      void fetchAvatarExamples();
      return;
    }

    if (digitalHumanAvatarExampleCache) {
      setAvatarExamples(digitalHumanAvatarExampleCache);
      setAvatarExamplesError('');
    }
  }, [fetchAvatarExamples]);

  const closeCreateAvatarDialog = React.useCallback(() => {
    setCreateAvatarDialogOpen(false);
  }, []);

  const handleAvatarUse = React.useCallback((item) => {
    const nextTitle = normalizeDigitalHumanAvatarTitle(item?.title);
    const nextCoverUrl = normalizeDigitalHumanAvatarCoverUrl(item?.cover_url);
    const nextVoiceId = normalizeDigitalHumanAvatarVoiceId(item?.voice_id);
    persistDigitalHumanAvatarTitle(nextTitle);
    persistDigitalHumanAvatarCoverUrl(nextCoverUrl);
    persistDigitalHumanAvatarVoiceId(nextVoiceId);
    setSelectedAvatarTitle(nextTitle);
    setSelectedAvatarCoverUrl(nextCoverUrl);
    setSelectedAvatarVoiceId(nextVoiceId);
    setAvatarDropdownOpen(false);
    setPlayingAvatarExampleKey('');
  }, []);

  const openCreateAvatarDialog = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setAvatarDropdownOpen(false);
    setPlayingAvatarExampleKey('');
    setCreateAvatarDialogOpen(true);
  }, []);

  const handleCreateAvatarCreated = React.useCallback((createdItem) => {
    const normalizedItems = normalizeDigitalHumanAvatarExamples({ items: [createdItem] });
    if (normalizedItems.length === 0) return;

    setAvatarExamples((prev) => {
      const nextItems = [
        ...normalizedItems,
        ...prev.filter((item) => item.exampleKey !== normalizedItems[0].exampleKey),
      ];
      digitalHumanAvatarExampleCache = nextItems;
      return nextItems;
    });
    setAvatarExamplesError('');
  }, []);

  const handleDeleteAvatar = React.useCallback(async (avatarId, exampleKey) => {
    const normalizedAvatarId = String(avatarId || '').trim();
    const normalizedExampleKey = String(exampleKey || '').trim();
    if (!normalizedAvatarId) return;
    if (isOfficialDigitalHumanAvatar(normalizedAvatarId)) return;
    if (deletingAvatarIds.includes(normalizedAvatarId)) return;

    setDeletingAvatarIds((prev) => [...prev, normalizedAvatarId]);
    try {
      const result = await deleteDigitalHumanAvatarLibrary(normalizedAvatarId);
      if (result?.ok === false) {
        throw new Error(result?.error || '删除失败');
      }

      setAvatarExamples((prev) => {
        const nextItems = prev.filter((item) => String(item.avatar_id || '').trim() !== normalizedAvatarId);
        digitalHumanAvatarExampleCache = nextItems;
        return nextItems;
      });
      setPlayingAvatarExampleKey((currentValue) => (currentValue === normalizedExampleKey ? '' : currentValue));
      message.success('删除成功');
    } catch (error) {
      message.error(error?.message || '删除失败');
    } finally {
      setDeletingAvatarIds((prev) => prev.filter((id) => id !== normalizedAvatarId));
    }
  }, [deletingAvatarIds]);

  const options = React.useMemo(() => DIGITAL_HUMAN_OPTIONS.map((item) => ({
    value: item.value,
    label: renderDigitalHumanOptionLabel(
      item.label,
      item.icon,
      priceMap[item.value] || DEFAULT_PRICE_TEXT,
      item.badges || []
    ),
    selectedLabel: renderDigitalHumanSelectedLabel(item.label, item.icon, pickerOpen),
  })), [pickerOpen, priceMap]);

  const digitalHumanAvatarPopupContent = React.useMemo(() => {
    if (avatarExamplesLoading && avatarExamples.length === 0) {
      return (
        <div className="chat-panel__digital-human-avatar-popup">
          <div className="chat-panel__digital-human-avatar-content chat-panel__digital-human-avatar-content--center">
            <Spin size="small" />
          </div>
        </div>
      );
    }

    if (avatarExamplesError && avatarExamples.length === 0) {
      return (
        <div className="chat-panel__digital-human-avatar-popup">
          <div className="chat-panel__digital-human-avatar-content chat-panel__digital-human-avatar-content--center">
            <div className="chat-panel__digital-human-avatar-status error">
              <span>{avatarExamplesError}</span>
              <button
                type="button"
                className="chat-panel__digital-human-avatar-retry"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void fetchAvatarExamples();
                }}
              >
                重试
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (avatarExamples.length === 0) {
      return (
        <div className="chat-panel__digital-human-avatar-popup">
          <div className="chat-panel__digital-human-avatar-content chat-panel__digital-human-avatar-content--center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无数字形象示例"
            />
          </div>
        </div>
      );
    }

    return (
      <div className="chat-panel__digital-human-avatar-popup">
        <div
          className="chat-panel__digital-human-avatar-content"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-panel__digital-human-avatar-grid">
            {avatarExamples.map((item) => {
              const isPlaying = playingAvatarExampleKey === item.exampleKey && item.demo_url;
              const showDeleteButton = Boolean(item.avatar_id) && !isOfficialDigitalHumanAvatar(item.avatar_id);
              const isDeleting = deletingAvatarIds.includes(item.avatar_id);

              return (
                <div
                  key={item.exampleKey}
                  className="chat-panel__digital-human-avatar-card"
                >
                  <div className="chat-panel__digital-human-avatar-media">
                    {isPlaying ? (
                      <video
                        className="chat-panel__digital-human-avatar-video"
                        src={item.demo_url}
                        autoPlay
                        loop
                        playsInline
                        preload="metadata"
                        onEnded={() => setPlayingAvatarExampleKey('')}
                      />
                    ) : (
                      <img
                        className="chat-panel__digital-human-avatar-image"
                        src={item.cover_url}
                        alt=""
                        aria-hidden="true"
                      />
                    )}
                    {item.demo_url || showDeleteButton ? (
                      <div className={`chat-panel__digital-human-avatar-play-layer ${isPlaying ? 'is-visible' : ''}`}>
                        <div className="chat-panel__digital-human-avatar-top-actions">
                          {item.demo_url ? (
                            <button
                              type="button"
                              className="chat-panel__digital-human-avatar-play"
                              aria-label={isPlaying ? '暂停预览' : '播放预览'}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setPlayingAvatarExampleKey((currentValue) => (
                                  currentValue === item.exampleKey ? '' : item.exampleKey
                                ));
                              }}
                            >
                              {isPlaying ? (
                                <Square size={11} strokeWidth={2.25} aria-hidden="true" />
                              ) : (
                                <Play size={11} strokeWidth={2.25} aria-hidden="true" />
                              )}
                            </button>
                          ) : null}
                          {showDeleteButton ? (
                            <button
                              type="button"
                              className="chat-panel__digital-human-avatar-delete"
                              aria-label={isDeleting ? '删除中' : '删除形象'}
                              disabled={isDeleting}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleDeleteAvatar(item.avatar_id, item.exampleKey);
                              }}
                            >
                              {isDeleting ? (
                                <Spin size="small" />
                              ) : (
                                <Trash2 size={11} strokeWidth={2.25} aria-hidden="true" />
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    <div className="chat-panel__digital-human-avatar-action-layer">
                      {item.title ? (
                        <div className="chat-panel__digital-human-avatar-title">
                          {item.title}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="chat-panel__digital-human-avatar-action"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleAvatarUse(item);
                        }}
                      >
                        使用
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="chat-panel__digital-human-avatar-card chat-panel__digital-human-avatar-card--placeholder"
              onMouseDown={(event) => event.preventDefault()}
              onClick={openCreateAvatarDialog}
            >
              <div className="chat-panel__digital-human-avatar-media chat-panel__digital-human-avatar-media--placeholder">
                <div className="chat-panel__digital-human-avatar-placeholder-content">
                  <span className="chat-panel__digital-human-avatar-placeholder-icon" aria-hidden="true">
                    <Plus size={18} strokeWidth={2.25} />
                  </span>
                  <span className="chat-panel__digital-human-avatar-placeholder-text">新建数字形象</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }, [
    avatarExamples,
    avatarExamplesError,
    avatarExamplesLoading,
    fetchAvatarExamples,
    playingAvatarExampleKey,
  ]);

  return (
    <div className="chat-panel__tool-detail-area">
      <Tooltip title="点击退出">
        <span className="chat-panel__tool-tooltip-trigger">
          <button
            type="button"
            className="chat-panel__tool-button chat-panel__tool-button--active"
            aria-label="数字人"
            title="数字人"
            aria-pressed="true"
            disabled={disabled}
            onClick={onBack}
          >
            <img className="chat-panel__tool-icon" src={DigitalHumanSelectedIcon} alt="" aria-hidden="true" />
            <span className="chat-panel__tool-text chat-panel__tool-text--active">数字人</span>
            <CloseOutlined className="chat-panel__tool-close-icon" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <div className="chat-panel__tool-detail-content">
        <Select
          size="small"
          variant="borderless"
          className="chat-panel__model-picker chat-panel__digital-human-picker"
          classNames={{ popup: { root: 'chat-panel__digital-human-picker-dropdown' } }}
          value={selectedMode}
          options={options}
          optionLabelProp="selectedLabel"
          onChange={handleModeChange}
          onOpenChange={setPickerOpen}
          disabled={disabled}
          popupMatchSelectWidth={false}
          getPopupContainer={(trigger) => trigger.parentElement}
        />
        {selectedMode === 'lips' ? (
          <VoiceLib
            controller={voiceLib}
            disabled={disabled}
          />
        ) : null}
        {selectedMode === 'jimeng-avatar' ? (
          <Dropdown
            disabled={disabled}
            trigger={['click']}
            open={avatarDropdownOpen}
            onOpenChange={handleAvatarDropdownOpenChange}
            overlayClassName="chat-panel__digital-human-avatar-dropdown"
            placement="topLeft"
            menu={{ items: [] }}
            popupRender={() => digitalHumanAvatarPopupContent}
            getPopupContainer={(trigger) => trigger.parentElement}
          >
            <span className="chat-panel__tool-dropdown-trigger">
              <button
                type="button"
                className={`chat-panel__tool-button ${avatarDropdownOpen ? 'chat-panel__tool-button--sub-active' : ''}`}
                aria-label={selectedAvatarButtonText}
                title={selectedAvatarButtonText}
                disabled={disabled}
              >
                <img className="chat-panel__tool-icon" src={selectedAvatarCoverUrl} alt="" aria-hidden="true" />
                <span
                  className="chat-panel__tool-text"
                  style={{
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedAvatarButtonText}
                </span>
              </button>
            </span>
          </Dropdown>
        ) : null}
        {children}
      </div>
      <CreateDigitalHumanAvatorDialog
        open={createAvatarDialogOpen}
        name={createAvatarName}
        onCreated={handleCreateAvatarCreated}
        onClose={closeCreateAvatarDialog}
        onNameChange={setCreateAvatarName}
      />
    </div>
  );
};

export default DigitalHumanToolDetail;
