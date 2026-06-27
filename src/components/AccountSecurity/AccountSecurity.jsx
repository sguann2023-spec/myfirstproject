import { useEffect, useRef, useState } from 'react';
import ImgCrop from 'antd-img-crop';
import { LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Input, Tooltip, Typography, Upload, message } from 'antd';
import { Pencil, SquarePen } from 'lucide-react';
import './AccountSecurity.css';
import { electronStore } from '../../shared/electronStore';
import {
  ensureVectcutApiKeyForCurrentSession,
  getCachedVectcutApiKey,
  getCurrentVectcutUserId,
  getVectcutSessionSignature,
  persistVectcutApiKey,
} from '../../auth/vectcutApiKey';
import { getUserProfile, updateUserProfile } from '../../api/user';
import { uploadUserAvatar } from '../../api/sts';
import { maskApiKey } from '@renderer/utils/api';

const AVATAR_MAX_SIZE = 2000 * 1000;
const normalizeProfileText = (value) => String(value || '').trim();

const AccountSecurity = () => {
  const [apiKey, setApiKey] = useState(() => getCachedVectcutApiKey());
  const [syncing, setSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sessionSignature, setSessionSignature] = useState(() => getVectcutSessionSignature());
  const [profileLoading, setProfileLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(() => normalizeProfileText(electronStore.get('user')?.avatar));
  const [nickname, setNickname] = useState(() => normalizeProfileText(electronStore.get('user')?.name));
  const [nicknameDraft, setNicknameDraft] = useState(() => normalizeProfileText(electronStore.get('user')?.name));
  const [nicknameError, setNicknameError] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [savingNickname, setSavingNickname] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const editingNicknameRef = useRef(false);
  const nicknameInputRef = useRef(null);

  const applyUserPatch = (patch) => {
    const currentUser = electronStore.get('user') || {};
    const nextUser = {
      ...currentUser,
      ...patch,
    };

    const hasChanged = Object.keys(patch).some((key) => currentUser?.[key] !== nextUser[key]);
    if (!hasChanged) {
      return;
    }

    electronStore.set('user', nextUser);
  };

  useEffect(() => {
    let disposed = false;

    const syncProfile = async (nextSessionSignature) => {
      const storedUser = electronStore.get('user') || {};
      const storedName = normalizeProfileText(storedUser.name);
      const storedAvatar = normalizeProfileText(storedUser.avatar);

      if (!disposed) {
        setNickname(storedName);
        setAvatarUrl(storedAvatar);
        if (!editingNicknameRef.current) {
          setNicknameDraft(storedName);
        }
      }

      if (!nextSessionSignature) {
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      try {
        const payload = await getUserProfile();
        if (disposed || !payload?.user) {
          return;
        }

        const remoteName = normalizeProfileText(payload.user.name);
        const remoteAvatar = normalizeProfileText(payload.user.avatar);
        const nextName = remoteName || storedName;
        const nextAvatar = remoteAvatar || storedAvatar;

        setNickname(nextName);
        setAvatarUrl(nextAvatar);
        if (!editingNicknameRef.current) {
          setNicknameDraft(nextName);
        }

        applyUserPatch({
          name: nextName,
          avatar: nextAvatar || null,
        });
      } finally {
        if (!disposed) {
          setProfileLoading(false);
        }
      }
    };

    const syncApiKey = async () => {
      const nextSessionSignature = getVectcutSessionSignature();
      setSessionSignature(nextSessionSignature);
      void syncProfile(nextSessionSignature);

      if (!nextSessionSignature) {
        persistVectcutApiKey('');
        setApiKey('');
        setSyncing(false);
        return;
      }

      const cachedApiKey = getCachedVectcutApiKey();
      setApiKey(cachedApiKey);

      if (cachedApiKey) {
        setSyncing(false);
        return;
      }

      setSyncing(true);
      try {
        const nextApiKey = await ensureVectcutApiKeyForCurrentSession();
        if (!disposed) {
          setApiKey(nextApiKey);
        }
      } finally {
        if (!disposed) {
          setSyncing(false);
        }
      }
    };

    void syncApiKey();

    const disposers = [];
    if (typeof electronStore.onDidChange === 'function') {
      disposers.push(
        electronStore.onDidChange('auth.refresh_token', () => {
          void syncApiKey();
        })
      );
      disposers.push(
        electronStore.onDidChange('user', () => {
          const nextUser = electronStore.get('user') || {};
          const nextName = normalizeProfileText(nextUser.name);
          const nextAvatar = normalizeProfileText(nextUser.avatar);
          if (!disposed) {
            setNickname(nextName);
            setAvatarUrl(nextAvatar);
            if (!editingNicknameRef.current) {
              setNicknameDraft(nextName);
            }
          }
          void syncApiKey();
        })
      );
      disposers.push(
        electronStore.onDidChange('auth.vectcut_api_key', (newValue) => {
          if (!disposed) {
            setApiKey(String(newValue || '').trim());
          }
        })
      );
    }

    return () => {
      disposed = true;
      disposers.forEach((dispose) => {
        if (typeof dispose === 'function') {
          dispose();
        }
      });
    };
  }, []);

  useEffect(() => {
    editingNicknameRef.current = editingNickname;
  }, [editingNickname]);

  useEffect(() => {
    if (editingNickname) {
      nicknameInputRef.current?.focus?.({
        cursor: 'all',
      });
    }
  }, [editingNickname]);

  const isLoggedIn = Boolean(sessionSignature);
  const canCopy = Boolean(isLoggedIn && apiKey && !copying);
  const displayValue = apiKey
    ? maskApiKey(apiKey)
    : syncing
      ? '正在同步...'
      : isLoggedIn
        ? '未获取到 API KEY'
        : '未登录';

  const handleCopy = async () => {
    if (!apiKey) {
      message.warning('未获取到 API_KEY');
      return;
    }

    setCopying(true);
    try {
      await navigator.clipboard.writeText(apiKey);
      message.success('API_KEY 已复制');
    } catch {
      message.error('复制失败，请稍后重试');
    } finally {
      setCopying(false);
    }
  };

  const handleEditNickname = () => {
    if (!isLoggedIn) {
      message.warning('请先登录后再编辑昵称');
      return;
    }
    setNicknameDraft(nickname);
    setNicknameError('');
    setEditingNickname(true);
  };

  const handleNicknameChange = (event) => {
    const nextValue = event.target.value;
    setNicknameDraft(nextValue);
    if (nicknameError && nextValue.trim()) {
      setNicknameError('');
    }
  };

  const handleSaveNickname = async (rawNickname) => {
    const normalizedNickname = normalizeProfileText(rawNickname);
    if (!normalizedNickname) {
      setNicknameError('昵称不能为空');
      message.warning('昵称不能为空');
      requestAnimationFrame(() => {
        nicknameInputRef.current?.focus?.();
      });
      return false;
    }

    if (normalizedNickname === nickname) {
      setNicknameDraft(normalizedNickname);
      setNicknameError('');
      setEditingNickname(false);
      return true;
    }

    setSavingNickname(true);
    try {
      const payload = await updateUserProfile({ name: normalizedNickname });
      const nextName = normalizeProfileText(payload?.user?.name) || normalizedNickname;
      const nextAvatar = normalizeProfileText(payload?.user?.avatar) || avatarUrl;
      setNickname(nextName);
      setNicknameDraft(nextName);
      setNicknameError('');
      setAvatarUrl(nextAvatar);
      setEditingNickname(false);
      applyUserPatch({
        name: nextName,
        avatar: nextAvatar || null,
      });
      message.success('昵称已更新');
      return true;
    } catch (error) {
      message.error(error?.message || '昵称更新失败，请稍后重试');
      requestAnimationFrame(() => {
        nicknameInputRef.current?.focus?.();
      });
      return false;
    } finally {
      setSavingNickname(false);
    }
  };

  const handleNicknameBlur = async () => {
    if (savingNickname) {
      return;
    }
    await handleSaveNickname(nicknameDraft);
  };

  const handleAvatarBeforeCrop = async (file) => {
    if (!isLoggedIn) {
      message.warning('请先登录后再上传头像');
      return false;
    }

    if (!String(file?.type || '').startsWith('image/')) {
      message.warning('请上传图片格式的头像');
      return false;
    }

    return true;
  };

  const handleAvatarUpload = async (file) => {
    if ((file?.size || 0) > AVATAR_MAX_SIZE) {
      message.warning('头像图片大小不能超过 2MB');
      return Upload.LIST_IGNORE;
    }

    setAvatarUploading(true);
    try {
      let avatarFile = file;

      const currentUserId = getCurrentVectcutUserId();
      if (!currentUserId) {
        throw new Error('未获取到用户信息，请重新登录后重试');
      }

      const uploaded = await uploadUserAvatar(avatarFile, { userId: currentUserId });
      const nextAvatar = normalizeProfileText(uploaded?.publicUrl);
      if (!nextAvatar) {
        throw new Error('头像上传失败');
      }

      const payload = await updateUserProfile({ avatar: nextAvatar });
      const finalAvatar = normalizeProfileText(payload?.user?.avatar) || nextAvatar;
      const finalName = normalizeProfileText(payload?.user?.name) || nickname;

      setAvatarUrl(finalAvatar);
      setNickname(finalName);
      if (!editingNicknameRef.current) {
        setNicknameDraft(finalName);
      }
      applyUserPatch({
        name: finalName,
        avatar: finalAvatar,
      });
      message.success('头像已更新');
    } catch (error) {
      message.error(error?.message || '头像更新失败，请稍后重试');
    } finally {
      setAvatarUploading(false);
    }

    return Upload.LIST_IGNORE;
  };

  const nicknameDisplayValue = isLoggedIn
    ? (nickname || '未设置昵称')
    : '未登录';
  const avatarDisplayNode = avatarUrl
    ? <Avatar size={80} src={avatarUrl} className="account-security-avatar" />
    : (
      <Avatar size={80} icon={<UserOutlined />} className="account-security-avatar account-security-avatar--placeholder" />
    );

  return (
    <div className="account-security">
      <div className="account-security-section">
        <div className="account-security-row account-security-row--avatar">
          <div className="account-security-avatar-panel">
            <ImgCrop
              quality={1}
              aspect={1}
              cropShape="round"
              zoomSlider
              rotationSlider
              showReset
              showGrid
              modalTitle="裁剪头像"
              modalOk="保存"
              modalCancel="取消"
              beforeCrop={handleAvatarBeforeCrop}
            >
              <Upload accept="image/*" showUploadList={false} beforeUpload={handleAvatarUpload} disabled={!isLoggedIn || avatarUploading}>
                <button
                  type="button"
                  className="account-security-avatar-trigger"
                  disabled={!isLoggedIn || avatarUploading}
                  aria-label={avatarUrl ? '更换头像' : '上传头像'}
                >
                  <span className="account-security-avatar-box">
                    {avatarDisplayNode}
                    <span className="account-security-avatar-edit-badge" aria-hidden="true">
                      <Pencil size={12} strokeWidth={2.2} />
                    </span>
                    {(profileLoading || avatarUploading) ? (
                      <div className="account-security-avatar-loading">
                        <LoadingOutlined spin />
                      </div>
                    ) : null}
                  </span>
                </button>
              </Upload>
            </ImgCrop>
          </div>
        </div>
      </div>
      <div className="account-security-section">
        <div className="account-security-section-title">个人信息</div>
        <div className="account-security-card">
          <div className="account-security-row account-security-row--grouped">
            <div className="account-security-label">昵称</div>
            <div className="account-security-value account-security-value--profile">
              {editingNickname ? (
                <div className="account-security-editing">
                  <Input
                    ref={nicknameInputRef}
                    value={nicknameDraft}
                    showCount
                    maxLength={20}
                    placeholder="请输入昵称"
                    status={nicknameError ? 'error' : ''}
                    onChange={handleNicknameChange}
                    onBlur={handleNicknameBlur}
                    onPressEnter={(event) => {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }}
                    disabled={savingNickname}
                    className="account-security-nickname-input"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="account-security-value-button"
                  onClick={handleEditNickname}
                  disabled={!isLoggedIn || savingNickname}
                >
                  <span className="account-security-value-button-content">
                    <Typography.Text ellipsis={{ tooltip: nicknameDisplayValue }}>
                      {nicknameDisplayValue}
                    </Typography.Text>
                    <SquarePen size={12} strokeWidth={2} className="account-security-value-edit-icon" aria-hidden="true" />
                  </span>
                </button>
              )}
            </div>
          </div>
          <div className="account-security-row account-security-row--grouped">
            <div className="account-security-label">我的API KEY</div>
            <button
              type="button"
              className={`account-security-value account-security-value--api-key ${!apiKey ? 'empty' : ''}`}
              onClick={handleCopy}
              disabled={!canCopy}
            >
              <Tooltip title={canCopy ? '点击复制' : null} placement="topRight">
                <span className="account-security-value-text">{displayValue}</span>
              </Tooltip>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountSecurity;
