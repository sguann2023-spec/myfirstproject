import React from 'react';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { Dropdown, Empty, Popover, Select, Spin, Tooltip, message } from 'antd';
import { Check, Play, Plus, Square, Trash2 } from 'lucide-react';
import {
  deleteDigitalHumanAvatarLibrary,
  getDigitalHumanAvatarExamples,
  getDigitalHumanPricing,
} from '../../../../api/digital_human';
import { getMembershipSummary } from '../../../../api/membership';
import { tokenStore } from '../../../../auth';
import { electronStore } from '../../../../shared/electronStore';
import { MEMBER_COLOR } from '../../../../constants/member';
import { IpcChannel } from '../../../../packages/shared/IpcChannel';
import './index.css';
import DigitalHumanSelectedIcon from '../../../../../public/digital_human_selected.svg';
import LipsIcon from '../../../../../public/lips.svg';
import DigitalHumanAvatarIcon from '../../../../../public/digital_human_avatar.svg';
import DigitalHumanAvatarMemberIcon from '../../../../../public/digital_human_avatar_member.svg';
import Point2Icon from '../../../../../public/point2.svg';
import VoiceLib, { useVoiceLib } from '../VoiceLib';
import CreateDigitalHumanAvatorDialog from '../CreateDigitalHumanAvatorDialog';

const DIGITAL_HUMAN_MODE_STORAGE_KEY = 'chat-panel:digital-human-mode';
const DIGITAL_HUMAN_AVATAR_TITLE_STORAGE_KEY = 'chat-panel:digital-human-avatar-title';
const DIGITAL_HUMAN_AVATAR_COVER_URL_STORAGE_KEY = 'chat-panel:digital-human-avatar-cover-url';
const DIGITAL_HUMAN_AVATAR_VOICE_ID_STORAGE_KEY = 'chat-panel:digital-human-avatar-voice-id';
const DIGITAL_HUMAN_AVATAR_VOICE_PROVIDER_STORAGE_KEY = 'chat-panel:digital-human-avatar-voice-provider';
const DEFAULT_DIGITAL_HUMAN_AVATAR_TITLE = '和蔼奶奶';
const DEFAULT_DIGITAL_HUMAN_AVATAR_COVER_URL = 'https://player.install-ai-guider.top/example/digital_human/omni_pic_example_1.jpg';
const DEFAULT_DIGITAL_HUMAN_AVATAR_VOICE_ID = 'pfetRIoSD753RDghCo31';
const ELEVENLABS_PROVIDER = 'elevenlabs';
const SEEDANCE_AVATAR_PROVIDER_TIP = '仅支持elevenlabs克隆音色';
const REDEEM_PAYMENT_URL = 'https://www.vectcut.com/redeem/payment';
const DIGITAL_HUMAN_IMAGE_DRIVE_MODES = new Set(['jimeng-avatar', 'seedance-avatar']);
const DIGITAL_HUMAN_OPTIONS = [
  {
    value: 'seedance-avatar',
    label: 'seedance图片驱动',
    icon: DigitalHumanAvatarIcon,
    pricingKey: 'seedance_image_driver',
    badges: ['官网同款'],
    highlightMember: true,
  },
  {
    value: 'jimeng-avatar',
    label: '即梦图片驱动',
    icon: DigitalHumanAvatarIcon,
    pricingKey: 'omni_image_driver',
    badges: [],
  },
  {
    value: 'lips',
    label: '口型驱动',
    icon: LipsIcon,
    pricingKey: 'lip_sync',
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

const isDigitalHumanImageDriveMode = (value) => DIGITAL_HUMAN_IMAGE_DRIVE_MODES.has(String(value || '').trim());
const SEEDANCE_DIGITAL_HUMAN_MODE = 'seedance-avatar';
const DEFAULT_NON_MEMBER_DIGITAL_HUMAN_MODE = 'jimeng-avatar';

const stopOptionSelectEvent = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

const normalizeMembershipSummary = (payload = {}) => {
  const membershipLevel = String(payload?.membership_level || '').trim().toLowerCase() || 'none';
  return {
    membershipLevel,
    isActive: Boolean(payload?.is_active) && membershipLevel !== 'none',
  };
};

const getAccessibleDigitalHumanMode = (membershipSummary) =>
  membershipSummary?.isActive ? SEEDANCE_DIGITAL_HUMAN_MODE : DEFAULT_NON_MEMBER_DIGITAL_HUMAN_MODE;

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

const normalizeDigitalHumanAvatarVoiceProvider = (value) => String(value || '').trim().toLowerCase();

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

const readPersistedDigitalHumanAvatarVoiceProvider = () => {
  try {
    return normalizeDigitalHumanAvatarVoiceProvider(localStorage.getItem(DIGITAL_HUMAN_AVATAR_VOICE_PROVIDER_STORAGE_KEY));
  } catch (error) {
    return '';
  }
};

const persistDigitalHumanAvatarVoiceProvider = (value) => {
  try {
    localStorage.setItem(
      DIGITAL_HUMAN_AVATAR_VOICE_PROVIDER_STORAGE_KEY,
      normalizeDigitalHumanAvatarVoiceProvider(value)
    );
  } catch (error) {
    // Ignore storage errors so avatar voice provider still works in-memory.
  }
};

const normalizeDigitalHumanAvatarSeedanceAvailability = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (['true', 'yes', 'y', 'on'].includes(normalizedValue)) return true;
  if (['false', 'no', 'n', 'off'].includes(normalizedValue)) return false;
  return null;
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

const buildDigitalHumanPriceMap = (priceItems = []) => DIGITAL_HUMAN_OPTIONS.reduce((acc, item) => {
  const matchedItem = priceItems.find((priceItem) => String(priceItem?.key || '').trim() === item.pricingKey);
  acc[item.value] = formatDigitalHumanPriceText(matchedItem?.resource_points_per_unit);
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

const resolveDigitalHumanAvatarVoiceProvider = (item = {}) => {
  const directProvider = normalizeDigitalHumanAvatarVoiceProvider(
    item?.voice_provider
    || item?.provider
    || item?.providers
    || item?.voice_provider_type
    || item?.voice_source_provider
    || item?.voice_channel
  );
  if (directProvider) return directProvider;

  const tags = normalizeDigitalHumanAvatarVoiceProvider(item?.voice_persona_tags);
  if (tags.includes(ELEVENLABS_PROVIDER)) return ELEVENLABS_PROVIDER;
  return '';
};

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
      voice_provider: resolveDigitalHumanAvatarVoiceProvider(item),
      can_use_seedance: normalizeDigitalHumanAvatarSeedanceAvailability(item?.can_use_seedance),
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

const renderDigitalHumanOptionLabel = (
  text,
  icon,
  priceText,
  badges = [],
  highlightMember = false,
  lockedMember = false,
  onOpenMembershipPayment = null
) => {
  const optionContent = (
    <span className="chat-panel__model-option">
      <span
        className={`chat-panel__model-option-main ${lockedMember ? 'chat-panel__model-option-main--locked' : ''}`}
        onMouseDown={lockedMember ? stopOptionSelectEvent : undefined}
        onClick={lockedMember ? stopOptionSelectEvent : undefined}
      >
        <img
          className="chat-panel__model-option-icon"
          src={highlightMember ? DigitalHumanAvatarMemberIcon : icon}
          alt=""
          aria-hidden="true"
        />
        <span
          className={`chat-panel__model-option-text ${highlightMember ? 'chat-panel__model-option-text--member' : ''}`}
          style={highlightMember ? { color: MEMBER_COLOR } : undefined}
        >
          {text}
        </span>
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

  if (!lockedMember) return optionContent;

  return (
    <Popover
      trigger="hover"
      placement="right"
      align={{ offset: [20, 20] }}
      mouseEnterDelay={0.12}
      classNames={{ root: 'chat-panel__digital-human-member-popover' }}
      content={(
        <div
          className="chat-panel__digital-human-member-popover-content"
          onMouseDown={stopOptionSelectEvent}
          onClick={stopOptionSelectEvent}
        >
          <div className="chat-panel__digital-human-member-hover-title">会员专属</div>
          <div className="chat-panel__digital-human-member-hover-desc">开通会员后即可使用官网同款图片驱动数字人</div>
          <button
            type="button"
            className="chat-panel__digital-human-member-hover-action"
            onMouseDown={stopOptionSelectEvent}
            onClick={(event) => {
              stopOptionSelectEvent(event);
              onOpenMembershipPayment?.();
            }}
          >
            开通会员
          </button>
        </div>
      )}
    >
      {optionContent}
    </Popover>
  );
};

const renderDigitalHumanSelectedLabel = (text, icon, open = false, highlightMember = false) => (
  <span className="chat-panel__digital-human-selected">
    <span className="chat-panel__model-option-main">
      <img
        className="chat-panel__model-option-icon"
        src={highlightMember ? DigitalHumanAvatarMemberIcon : icon}
        alt=""
        aria-hidden="true"
      />
      <span
        className={`chat-panel__model-option-text ${highlightMember ? 'chat-panel__model-option-text--member' : ''}`}
        style={highlightMember ? { color: MEMBER_COLOR } : undefined}
      >
        {text}
      </span>
    </span>
    <DownOutlined
      className={`chat-panel__digital-human-selected-arrow ${
        highlightMember ? 'chat-panel__digital-human-selected-arrow--member' : ''
      } ${open ? 'is-open' : ''}`}
      style={highlightMember ? { color: MEMBER_COLOR } : undefined}
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
  const [selectedAvatarVoiceProvider, setSelectedAvatarVoiceProvider] = React.useState(
    () => readPersistedDigitalHumanAvatarVoiceProvider()
  );
  const [playingAvatarExampleKey, setPlayingAvatarExampleKey] = React.useState('');
  const [deletingAvatarIds, setDeletingAvatarIds] = React.useState([]);
  const [createAvatarDialogOpen, setCreateAvatarDialogOpen] = React.useState(false);
  const [createAvatarName, setCreateAvatarName] = React.useState('');
  const [membershipSummary, setMembershipSummary] = React.useState(() => normalizeMembershipSummary());
  const [membershipLoaded, setMembershipLoaded] = React.useState(false);
  const voiceLib = useVoiceLib({ onSelectedVoiceChange });
  const selectedAvatarButtonText = `形象 ${selectedAvatarTitle}`;
  const seedanceLocked =
    membershipLoaded && selectedMode === SEEDANCE_DIGITAL_HUMAN_MODE && !membershipSummary.isActive;
  const knownVoiceProviderById = React.useMemo(() => {
    const providerMap = new Map();
    const registerVoiceItem = (item) => {
      const voiceId = String(item?.global_voice_id || item?.voice_id || '').trim();
      if (!voiceId) return;
      const provider = normalizeDigitalHumanAvatarVoiceProvider(
        item?.price_provider || item?.providers || item?.provider || item?.voice_provider
      );
      if (!provider) return;
      providerMap.set(voiceId, provider);
    };

    registerVoiceItem(voiceLib?.selectedVoiceLibraryItem);
    (voiceLib?.myVoiceState?.items || []).forEach(registerVoiceItem);
    return providerMap;
  }, [voiceLib?.myVoiceState?.items, voiceLib?.selectedVoiceLibraryItem]);

  const resolveAvatarVoiceProvider = React.useCallback((item = {}) => {
    const directProvider = resolveDigitalHumanAvatarVoiceProvider(item);
    if (directProvider) return directProvider;

    const voiceId = String(item?.voice_id || item?.global_voice_id || '').trim();
    if (!voiceId) return '';
    return knownVoiceProviderById.get(voiceId) || '';
  }, [knownVoiceProviderById]);

  const resolveAvatarSeedanceAvailability = React.useCallback((item = {}) => {
    const explicitAvailability = normalizeDigitalHumanAvatarSeedanceAvailability(item?.can_use_seedance);
    if (explicitAvailability !== null) return explicitAvailability;
    return resolveAvatarVoiceProvider(item) === ELEVENLABS_PROVIDER;
  }, [resolveAvatarVoiceProvider]);

  const isSeedanceSupportedAvatar = React.useCallback(
    (item = {}) => resolveAvatarSeedanceAvailability(item),
    [resolveAvatarSeedanceAvailability]
  );

  const refreshMembershipSummary = React.useCallback(async () => {
    try {
      const result = await getMembershipSummary();
      setMembershipSummary(normalizeMembershipSummary(result));
    } catch (error) {
      setMembershipSummary(normalizeMembershipSummary());
    } finally {
      setMembershipLoaded(true);
    }
  }, []);

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
    } catch {}

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
    } catch {}

    window.open(paymentUrl, '_blank', 'noopener,noreferrer');
  }, []);

  const handleModeChange = React.useCallback((nextValue) => {
    const normalizedValue = normalizeDigitalHumanMode(nextValue);
    if (membershipLoaded && normalizedValue === SEEDANCE_DIGITAL_HUMAN_MODE && !membershipSummary.isActive) {
      return;
    }
    persistDigitalHumanMode(normalizedValue);
    setSelectedMode(normalizedValue);
    if (typeof onModeChange === 'function') {
      onModeChange(normalizedValue);
    }
  }, [membershipLoaded, membershipSummary.isActive, onModeChange]);

  React.useEffect(() => {
    void refreshMembershipSummary();
  }, [refreshMembershipSummary]);

  React.useEffect(() => {
    try {
      const { ipcRenderer } = window.require('electron');
      const handlePaymentSuccess = () => {
        void refreshMembershipSummary();
      };
      ipcRenderer.on(IpcChannel.Payment_Success, handlePaymentSuccess);
      return () => {
        ipcRenderer.removeListener(IpcChannel.Payment_Success, handlePaymentSuccess);
      };
    } catch {
      return undefined;
    }
  }, [refreshMembershipSummary]);

  React.useEffect(() => {
    if (!isDigitalHumanImageDriveMode(selectedMode)) {
      setAvatarDropdownOpen(false);
      setPlayingAvatarExampleKey('');
    }
  }, [selectedMode]);

  React.useEffect(() => {
    if (!seedanceLocked) return;
    setAvatarDropdownOpen(false);
    setPlayingAvatarExampleKey('');
  }, [seedanceLocked]);

  React.useEffect(() => {
    if (!membershipLoaded) return;
    if (membershipSummary.isActive) return;
    if (selectedMode !== SEEDANCE_DIGITAL_HUMAN_MODE) return;
    const nextMode = getAccessibleDigitalHumanMode(membershipSummary);
    if (!nextMode || nextMode === selectedMode) return;
    persistDigitalHumanMode(nextMode);
    setSelectedMode(nextMode);
    onModeChange?.(nextMode);
  }, [membershipLoaded, membershipSummary, onModeChange, selectedMode]);

  React.useEffect(() => {
    if (typeof onSelectedAvatarChange !== 'function') return;
    onSelectedAvatarChange({
      title: selectedAvatarTitle,
      cover_url: selectedAvatarCoverUrl,
      voice_id: selectedAvatarVoiceId,
      voice_provider: selectedAvatarVoiceProvider,
    });
  }, [onSelectedAvatarChange, selectedAvatarCoverUrl, selectedAvatarTitle, selectedAvatarVoiceId, selectedAvatarVoiceProvider]);

  React.useEffect(() => {
    if (digitalHumanPriceCache) {
      setPriceMap(digitalHumanPriceCache);
      return undefined;
    }

    let cancelled = false;
    const fetchPricing = async () => {
      try {
        const pendingRequest = digitalHumanPriceRequest || getDigitalHumanPricing();
        digitalHumanPriceRequest = pendingRequest;
        const result = await pendingRequest;
        const priceItems = Array.isArray(result?.items)
          ? result.items
          : Array.isArray(result?.data?.items)
            ? result.data.items
            : [];
        const nextPriceMap = buildDigitalHumanPriceMap(priceItems);
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
    const nextVoiceProvider = resolveAvatarVoiceProvider(item);
    const nextCanUseSeedance = resolveAvatarSeedanceAvailability(item);
    persistDigitalHumanAvatarTitle(nextTitle);
    persistDigitalHumanAvatarCoverUrl(nextCoverUrl);
    persistDigitalHumanAvatarVoiceId(nextVoiceId);
    persistDigitalHumanAvatarVoiceProvider(nextVoiceProvider);
    setSelectedAvatarTitle(nextTitle);
    setSelectedAvatarCoverUrl(nextCoverUrl);
    setSelectedAvatarVoiceId(nextVoiceId);
    setSelectedAvatarVoiceProvider(nextVoiceProvider);
    if (typeof item === 'object' && item !== null) {
      item.can_use_seedance = nextCanUseSeedance;
    }
    setAvatarDropdownOpen(false);
    setPlayingAvatarExampleKey('');
  }, [resolveAvatarSeedanceAvailability, resolveAvatarVoiceProvider]);

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

  React.useEffect(() => {
    if (selectedMode !== SEEDANCE_DIGITAL_HUMAN_MODE) return;
    if (selectedAvatarVoiceProvider === ELEVENLABS_PROVIDER) return;

    const knownSelectedAvatarVoiceProvider = resolveAvatarVoiceProvider({ voice_id: selectedAvatarVoiceId });
    if (knownSelectedAvatarVoiceProvider) {
      persistDigitalHumanAvatarVoiceProvider(knownSelectedAvatarVoiceProvider);
      setSelectedAvatarVoiceProvider(knownSelectedAvatarVoiceProvider);
      return;
    }

    const normalizedSelectedVoiceId = String(selectedAvatarVoiceId || '').trim();
    const matchedSelectedAvatar = avatarExamples.find(
      (item) => String(item?.voice_id || '').trim() === normalizedSelectedVoiceId
    );
    if (matchedSelectedAvatar && isSeedanceSupportedAvatar(matchedSelectedAvatar)) {
      handleAvatarUse(matchedSelectedAvatar);
      return;
    }

    const firstSupportedAvatar = avatarExamples.find(isSeedanceSupportedAvatar);
    if (firstSupportedAvatar) {
      handleAvatarUse(firstSupportedAvatar);
      return;
    }

    if (avatarExamples.length === 0 && !avatarExamplesLoading && !digitalHumanAvatarExampleCache && !digitalHumanAvatarExampleRequest) {
      void fetchAvatarExamples();
    }
  }, [
    avatarExamples,
    avatarExamplesLoading,
    fetchAvatarExamples,
    handleAvatarUse,
    isSeedanceSupportedAvatar,
    resolveAvatarVoiceProvider,
    selectedAvatarVoiceId,
    selectedAvatarVoiceProvider,
    selectedMode,
  ]);

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
      item.badges || [],
      Boolean(item.highlightMember),
      membershipLoaded && item.value === SEEDANCE_DIGITAL_HUMAN_MODE && !membershipSummary.isActive,
      handleOpenMembershipPayment
    ),
    selectedLabel: renderDigitalHumanSelectedLabel(
      item.label,
      item.icon,
      pickerOpen,
      Boolean(item.highlightMember)
    ),
  })), [handleOpenMembershipPayment, membershipLoaded, membershipSummary.isActive, pickerOpen, priceMap]);

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
              const avatarUseDisabled = selectedMode === SEEDANCE_DIGITAL_HUMAN_MODE
                && !resolveAvatarSeedanceAvailability(item);

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
                      <Tooltip
                        title={avatarUseDisabled ? SEEDANCE_AVATAR_PROVIDER_TIP : null}
                        placement="top"
                      >
                        <span className="chat-panel__digital-human-avatar-action-trigger">
                          <button
                            type="button"
                            className="chat-panel__digital-human-avatar-action"
                            disabled={avatarUseDisabled}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (avatarUseDisabled) return;
                              handleAvatarUse(item);
                            }}
                          >
                            使用
                          </button>
                        </span>
                      </Tooltip>
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
    deletingAvatarIds,
    fetchAvatarExamples,
    handleAvatarUse,
    handleDeleteAvatar,
    playingAvatarExampleKey,
    selectedMode,
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
          getPopupContainer={() => document.body}
        />
        {selectedMode === 'lips' ? (
          <VoiceLib
            controller={voiceLib}
            disabled={disabled}
          />
        ) : null}
        {isDigitalHumanImageDriveMode(selectedMode) ? (
          <Dropdown
            disabled={disabled || seedanceLocked}
            trigger={['click']}
            open={avatarDropdownOpen}
            onOpenChange={handleAvatarDropdownOpenChange}
            overlayClassName="chat-panel__digital-human-avatar-dropdown"
            placement="topLeft"
            menu={{ items: [] }}
            popupRender={() => digitalHumanAvatarPopupContent}
            getPopupContainer={() => document.body}
          >
            <span className="chat-panel__tool-dropdown-trigger">
              <button
                type="button"
                className={`chat-panel__tool-button ${avatarDropdownOpen ? 'chat-panel__tool-button--sub-active' : ''} ${
                  seedanceLocked ? 'chat-panel__tool-button--member-locked' : ''
                }`}
                aria-label={selectedAvatarButtonText}
                title={selectedAvatarButtonText}
                disabled={disabled || seedanceLocked}
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
