import { useEffect, useRef, useState } from 'react';
import ImgCrop from 'antd-img-crop';
import { ExclamationCircleOutlined, LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Input, Modal, Tooltip, Typography, Upload, message } from 'antd';
import { Pencil, QrCode, SquarePen, User } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import AppLogo from '../../../public/logo.png';
import Point2Icon from '../../../public/point2.svg';
import './AccountSecurity.css';
import { getMembershipSummary } from '../../api/membership';
import { MEMBER_COLOR } from '../../constants/member';
import { electronStore } from '../../shared/electronStore';
import {
  ensureVectcutApiKeyForCurrentSession,
  getCachedVectcutApiKey,
  getCurrentVectcutUserId,
  getVectcutSessionSignature,
  persistVectcutApiKey,
} from '../../auth/vectcutApiKey';
import {
  getInviteQualification,
  getInviteRebateSummary,
  getInviteStats,
  getUserProfile,
  transferInviteRebateToWallet,
  updateUserProfile,
} from '../../api/user';
import { uploadUserAvatar } from '../../api/sts';
import { maskApiKey } from '@renderer/utils/api';
import { IpcChannel } from '../../packages/shared/IpcChannel';

const AVATAR_MAX_SIZE = 2000 * 1000;
const INVITE_RULES_URL = 'https://www.vectcut.com/invite';
const WITHDRAW_MIN_POINTS = 1000;
const MEMBERSHIP_LEVEL_LABEL_MAP = {
  basic: '基础会员',
  medium: '标准会员',
  high: '高级会员',
};
const normalizeProfileText = (value) => String(value || '').trim();
const normalizeMembershipSummary = (payload = {}) => {
  const membershipLevel = String(payload?.membership_level || '').trim().toLowerCase() || 'none';
  return {
    membershipLevel,
    isActive: Boolean(payload?.is_active) && membershipLevel !== 'none',
    membershipExpiresAt: String(payload?.membership_expires_at || '').trim(),
  };
};
const formatMembershipExpiresAt = (value) => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';
  const date = new Date(normalizedValue.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) {
    return normalizedValue;
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};
const normalizeInviteCode = (value) => String(value || '').trim().toUpperCase();
const normalizeInviteCount = (value) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue >= 0 ? Math.floor(nextValue) : 0;
};
const normalizeInviteAmount = (value) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
};
const formatInviteAmount = (value) => {
  const normalizedValue = normalizeInviteAmount(value);
  return normalizedValue.toLocaleString('zh-CN', {
    minimumFractionDigits: Number.isInteger(normalizedValue) ? 0 : 2,
    maximumFractionDigits: 2,
  });
};
const formatInviteRate = (value) => {
  const normalizedValue = normalizeInviteAmount(value);
  return `${(normalizedValue * 100).toFixed(normalizedValue * 100 % 1 === 0 ? 0 : 2)}%`;
};
const createDefaultInviteInfo = () => ({
  eligible: false,
  inviteCode: '',
  inviteLink: '',
  totalInvitedUsers: 0,
  availableRebatePoints: 0,
  totalIncomePoints: 0,
  currentRebateRate: 0,
  message: '',
});

const AccountSecurity = () => {
  const appBridge = window['api'];
  const [apiKey, setApiKey] = useState(() => getCachedVectcutApiKey());
  const [syncing, setSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sessionSignature, setSessionSignature] = useState(() => getVectcutSessionSignature());
  const [membershipSummary, setMembershipSummary] = useState(() => normalizeMembershipSummary());
  const [profileLoading, setProfileLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(() => normalizeProfileText(electronStore.get('user')?.avatar));
  const [nickname, setNickname] = useState(() => normalizeProfileText(electronStore.get('user')?.name));
  const [nicknameDraft, setNicknameDraft] = useState(() => normalizeProfileText(electronStore.get('user')?.name));
  const [nicknameError, setNicknameError] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [savingNickname, setSavingNickname] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [transferringInviteRebate, setTransferringInviteRebate] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAccountInfo, setWithdrawAccountInfo] = useState('');
  const [withdrawAccountError, setWithdrawAccountError] = useState('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(() => createDefaultInviteInfo());
  const editingNicknameRef = useRef(false);
  const nicknameInputRef = useRef(null);
  const inviteQrCanvasRef = useRef(null);

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

  const buildInviteInfo = ({ qualification, stats, rebateSummary } = {}) => {
    const qualificationCode = normalizeInviteCode(qualification?.invite_code);
    const qualificationLink = normalizeProfileText(qualification?.invite_link);
    const qualificationMessage = normalizeProfileText(qualification?.message);

    return {
      eligible: true,
      inviteCode: normalizeInviteCode(stats?.invite_code) || qualificationCode,
      inviteLink: normalizeProfileText(stats?.invite_link) || qualificationLink,
      totalInvitedUsers: normalizeInviteCount(stats?.total_invited_users),
      availableRebatePoints: normalizeInviteAmount(rebateSummary?.available_rebate_points),
      totalIncomePoints: normalizeInviteAmount(
        rebateSummary?.total_income_points ?? rebateSummary?.total_rebate_points
      ),
      currentRebateRate: normalizeInviteAmount(rebateSummary?.current_rebate_rate),
      message: qualificationMessage,
    };
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

    const syncInviteInfo = async (nextSessionSignature) => {
      if (!nextSessionSignature) {
        if (!disposed) {
          setInviteInfo(createDefaultInviteInfo());
          setInviteLoading(false);
        }
        return;
      }

      setInviteLoading(true);
      try {
        const qualification = await getInviteQualification();
        if (disposed) {
          return;
        }

        const eligible = Boolean(qualification?.eligible);
        const qualificationMessage = normalizeProfileText(qualification?.message);

        if (!eligible) {
          setInviteInfo({
            eligible: false,
            inviteCode: '',
            inviteLink: '',
            totalInvitedUsers: 0,
            availableRebatePoints: 0,
            totalIncomePoints: 0,
            currentRebateRate: 0,
            message: qualificationMessage || '当前账号暂未开放邀请码资格',
          });
          return;
        }

        const [stats, rebateSummary] = await Promise.all([
          getInviteStats(),
          getInviteRebateSummary(),
        ]);
        if (disposed) {
          return;
        }

        setInviteInfo(buildInviteInfo({ qualification, stats, rebateSummary }));
      } catch {
        if (!disposed) {
          setInviteInfo({
            ...createDefaultInviteInfo(),
            message: '邀请信息加载失败，请稍后重试',
          });
        }
      } finally {
        if (!disposed) {
          setInviteLoading(false);
        }
      }
    };

    const syncMembership = async (nextSessionSignature) => {
      if (!nextSessionSignature) {
        if (!disposed) {
          setMembershipSummary(normalizeMembershipSummary());
        }
        return;
      }

      try {
        const payload = await getMembershipSummary();
        if (!disposed) {
          setMembershipSummary(normalizeMembershipSummary(payload));
        }
      } catch {
        if (!disposed) {
          setMembershipSummary(normalizeMembershipSummary());
        }
      }
    };

    const syncApiKey = async () => {
      const nextSessionSignature = getVectcutSessionSignature();
      setSessionSignature(nextSessionSignature);
      void syncProfile(nextSessionSignature);
      void syncInviteInfo(nextSessionSignature);
      void syncMembership(nextSessionSignature);

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

  useEffect(() => {
    try {
      const { ipcRenderer } = window.require('electron');
      const handlePaymentSuccess = () => {
        const nextSessionSignature = getVectcutSessionSignature();
        if (!nextSessionSignature) {
          setMembershipSummary(normalizeMembershipSummary());
          return;
        }
        void getMembershipSummary()
          .then((payload) => {
            setMembershipSummary(normalizeMembershipSummary(payload));
          })
          .catch(() => {
            setMembershipSummary(normalizeMembershipSummary());
          });
      };

      ipcRenderer.on(IpcChannel.Payment_Success, handlePaymentSuccess);
      return () => {
        ipcRenderer.removeListener(IpcChannel.Payment_Success, handlePaymentSuccess);
      };
    } catch (_error) {
      return undefined;
    }
  }, []);

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

  const handleCopyInviteLink = async () => {
    if (!inviteInfo.inviteLink) {
      message.warning('当前暂无分享链接');
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteInfo.inviteLink);
      message.success('分享链接已复制');
    } catch {
      message.error('分享链接复制失败，请稍后重试');
    }
  };

  const handleCopyInviteQr = async () => {
    if (!inviteInfo.inviteLink) {
      message.warning('当前暂无分享链接');
      return;
    }

    if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') {
      message.error('当前环境暂不支持复制二维码图片');
      return;
    }

    const canvas = inviteQrCanvasRef.current;
    if (!canvas?.toBlob) {
      message.error('二维码生成失败，请稍后重试');
      return;
    }

    try {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) {
            resolve(nextBlob);
            return;
          }
          reject(new Error('二维码导出失败'));
        }, 'image/png');
      });

      await navigator.clipboard.write([
        new window.ClipboardItem({
          'image/png': blob,
        }),
      ]);
      message.success('二维码已复制');
    } catch {
      message.error('复制二维码失败，请稍后重试');
    }
  };

  const handleOpenInviteRules = () => {
    try {
      if (window.api?.openWebsite) {
        window.api.openWebsite(INVITE_RULES_URL);
        return;
      }
    } catch {}

    try {
      const { shell } = window.require('electron');
      if (shell?.openExternal) {
        shell.openExternal(INVITE_RULES_URL);
        return;
      }
    } catch {}

    window.open(INVITE_RULES_URL, '_blank', 'noopener,noreferrer');
  };

  const handleTransferInviteRebate = async () => {
    const transferPoints = normalizeInviteAmount(inviteInfo.availableRebatePoints);
    if (transferPoints <= 0) {
      message.warning('当前没有可划转的收益');
      return;
    }

    setTransferringInviteRebate(true);
    try {
      const transferNo = `invite-${Date.now()}`;
      const payload = await transferInviteRebateToWallet(transferPoints, transferNo);
      const transferStatus = String(payload?.status || '').trim().toLowerCase();

      setInviteInfo((current) => ({
        ...current,
        availableRebatePoints: normalizeInviteAmount(payload?.available_rebate_points),
        totalIncomePoints: normalizeInviteAmount(
          payload?.total_income_points ?? payload?.total_rebate_points ?? current.totalIncomePoints
        ),
        currentRebateRate: normalizeInviteAmount(payload?.current_rebate_rate ?? current.currentRebateRate),
      }));

      if (transferStatus === 'processing') {
        message.success('划转申请已提交，稍后会自动入账到余额');
      } else {
        message.success('已划转到余额');
      }
    } catch (error) {
      message.error(error?.message || '划转到余额失败，请稍后重试');
    } finally {
      setTransferringInviteRebate(false);
    }
  };

  const handleOpenWithdrawModal = () => {
    if (normalizeInviteAmount(inviteInfo.availableRebatePoints) < WITHDRAW_MIN_POINTS) {
      message.warning(`待使用收益满 ${WITHDRAW_MIN_POINTS} 积分后才可提现`);
      return;
    }
    setWithdrawAccountError('');
    setWithdrawModalOpen(true);
  };

  const handleCloseWithdrawModal = () => {
    if (withdrawSubmitting) {
      return;
    }
    setWithdrawModalOpen(false);
    setWithdrawAccountError('');
  };

  const handleSubmitWithdrawRequest = async () => {
    const normalizedAccountInfo = normalizeProfileText(withdrawAccountInfo);
    if (!normalizedAccountInfo) {
      setWithdrawAccountError('请输入提现账号信息');
      return;
    }
    if (!appBridge?.sendFeedbackEmail) {
      message.error('当前环境暂不支持提交提现申请');
      return;
    }

    const currentUser = electronStore.get('user') || {};
    const platform = window.process?.platform || navigator.userAgentData?.platform || 'unknown';
    setWithdrawSubmitting(true);

    try {
      const appInfo = await appBridge?.getAppInfo?.();
      const version = normalizeProfileText(appInfo?.version) || '未知版本';
      const availableRebatePoints = formatInviteAmount(inviteInfo.availableRebatePoints);
      const totalIncomePoints = formatInviteAmount(inviteInfo.totalIncomePoints);

      await appBridge?.sendFeedbackEmail?.({
        message: [
          '【提现申请】',
          `提现账号信息：${normalizedAccountInfo}`,
          `待使用收益：${availableRebatePoints}`,
          `总收益：${totalIncomePoints}`,
          `邀请码：${inviteInfo.inviteCode || '未生成'}`,
          `分享链接：${inviteInfo.inviteLink || '未生成'}`,
        ].join('\n'),
        version,
        platform,
        logsPath: '',
        user: {
          id: currentUser?.id ? String(currentUser.id) : '',
          name: currentUser?.name ? String(currentUser.name) : '',
          email: currentUser?.email ? String(currentUser.email) : '',
        },
      });

      setWithdrawModalOpen(false);
      setWithdrawAccountInfo('');
      setWithdrawAccountError('');
      message.success('提现申请已提交');
    } catch (error) {
      message.error(error?.message || '提现申请提交失败，请检查邮件配置');
    } finally {
      setWithdrawSubmitting(false);
    }
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
  const inviteStatusText = !isLoggedIn
    ? '登录后查看'
    : inviteLoading
      ? '正在加载邀请信息...'
      : inviteInfo.message || '当前账号暂未开放邀请码资格';
  const avatarDisplayNode = avatarUrl
    ? <Avatar size={80} src={avatarUrl} className="account-security-avatar" />
    : (
      <Avatar size={80} icon={<UserOutlined />} className="account-security-avatar account-security-avatar--placeholder" />
    );
  const availableRebatePoints = normalizeInviteAmount(inviteInfo.availableRebatePoints);
  const withdrawDisabledByThreshold = availableRebatePoints < WITHDRAW_MIN_POINTS;
  const withdrawDisabled = withdrawSubmitting || withdrawDisabledByThreshold;
  const withdrawDisabledTooltip = withdrawDisabledByThreshold
    ? `待使用收益满 ${WITHDRAW_MIN_POINTS} 积分后才可提现`
    : null;
  const membershipLevelLabel = MEMBERSHIP_LEVEL_LABEL_MAP[membershipSummary.membershipLevel] || '会员';
  const membershipExpiresAtText = formatMembershipExpiresAt(membershipSummary.membershipExpiresAt);
  const membershipStatusText = !isLoggedIn
    ? '登录后查看'
    : membershipSummary.isActive
      ? `${membershipLevelLabel}${membershipExpiresAtText ? ` · ${membershipExpiresAtText} 到期` : ''}`
      : '免费会员';

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
                    <Typography.Text
                      ellipsis={{ tooltip: nicknameDisplayValue }}
                      style={membershipSummary.isActive ? { color: MEMBER_COLOR } : undefined}>
                      {nicknameDisplayValue}
                    </Typography.Text>
                    <SquarePen size={12} strokeWidth={2} className="account-security-value-edit-icon" aria-hidden="true" />
                  </span>
                </button>
              )}
            </div>
          </div>
          <div className="account-security-row account-security-row--grouped">
            <div className="account-security-label">会员状态</div>
            <div className="account-security-value account-security-value--profile">
              <Typography.Text
                ellipsis={{ tooltip: membershipStatusText }}
                style={membershipSummary.isActive ? { color: MEMBER_COLOR } : undefined}>
                {membershipStatusText}
              </Typography.Text>
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
      <div className="account-security-section">
        <div className="account-security-section-title">邀请奖励</div>
        <div className="account-security-card">
          {inviteInfo.eligible ? (
            <>
              <div className="account-security-row account-security-row--grouped">
                <div className="account-security-label account-security-label--stacked">
                  <div>待使用收益</div>
                  <div className="account-security-metric-subtitle">
                    邀请好友注册，好友充值后您可获得相应奖励
                  </div>
                </div>
                <div className="account-security-value account-security-value--profile account-security-value--metric account-security-value--metric-action">
                  <div className="account-security-metric-main">
                    <img src={Point2Icon} alt="" className="account-security-inline-icon" aria-hidden="true" />
                    <span>{formatInviteAmount(inviteInfo.availableRebatePoints)}</span>
                  </div>
                  <button
                    type="button"
                    className="account-security-button account-security-button--compact"
                    onClick={handleTransferInviteRebate}
                    disabled={transferringInviteRebate || availableRebatePoints <= 0}
                  >
                    {transferringInviteRebate ? '划转中...' : '划转到余额'}
                  </button>
                  <Tooltip title={withdrawDisabledTooltip} placement="top">
                    <span>
                      <button
                        type="button"
                        className="account-security-button account-security-button--compact"
                        onClick={handleOpenWithdrawModal}
                        disabled={withdrawDisabled}
                      >
                        {withdrawSubmitting ? '提交中...' : '提现'}
                      </button>
                    </span>
                  </Tooltip>
                </div>
              </div>
              <div className="account-security-row account-security-row--grouped">
                <div className="account-security-label">总收益</div>
                <div className="account-security-value account-security-value--profile account-security-value--metric">
                  <img src={Point2Icon} alt="" className="account-security-inline-icon" aria-hidden="true" />
                  <span>{formatInviteAmount(inviteInfo.totalIncomePoints)}</span>
                </div>
              </div>
              <div className="account-security-row account-security-row--grouped">
                <div className="account-security-label">已邀请用户</div>
                <div className="account-security-value account-security-value--profile account-security-value--metric">
                  <User size={15} strokeWidth={2} className="account-security-inline-icon account-security-inline-icon--stroke" aria-hidden="true" />
                  <span>{inviteInfo.totalInvitedUsers}</span>
                </div>
              </div>
              <div className="account-security-row account-security-row--grouped">
                <div className="account-security-label account-security-label--with-action">
                  <span>奖励比例</span>
                  <Tooltip title="返佣规则" placement="top">
                    <button
                      type="button"
                      className="account-security-label-action"
                      onClick={handleOpenInviteRules}
                      aria-label="查看返佣规则"
                    >
                      <ExclamationCircleOutlined />
                    </button>
                  </Tooltip>
                </div>
                <div className="account-security-value account-security-value--profile">
                  {formatInviteRate(inviteInfo.currentRebateRate)}
                </div>
              </div>
              <div className="account-security-row account-security-row--grouped">
                <div className="account-security-label">分享链接</div>
                <div className="account-security-value account-security-value--invite-group">
                  <button
                    type="button"
                    className="account-security-value account-security-value--invite-action account-security-value--invite-link"
                    onClick={handleCopyInviteLink}
                  >
                    <Tooltip title="点击复制" placement="topRight">
                      <span className="account-security-value-text">{inviteInfo.inviteLink}</span>
                    </Tooltip>
                  </button>
                  <Tooltip title="复制二维码" placement="topRight">
                    <button
                      type="button"
                      className="account-security-icon-button"
                      onClick={handleCopyInviteQr}
                      aria-label="复制分享二维码"
                    >
                      <QrCode size={15} strokeWidth={2} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </>
          ) : (
            <div className="account-security-row account-security-row--grouped">
              <div className="account-security-label">邀请资格</div>
              <div className="account-security-value account-security-value--invite-status">
                {inviteStatusText}
              </div>
            </div>
          )}
        </div>
      </div>
      {inviteInfo.eligible ? (
        <div className="account-security-qr-copy-source" aria-hidden="true">
          <QRCodeCanvas
            ref={inviteQrCanvasRef}
            value={inviteInfo.inviteLink || inviteInfo.inviteCode}
            size={240}
            level="H"
            marginSize={4}
            imageSettings={{
              src: AppLogo,
              height: 40,
              width: 40,
              excavate: true,
            }}
          />
        </div>
      ) : null}
      <Modal
        title="提现申请"
        open={withdrawModalOpen}
        onOk={handleSubmitWithdrawRequest}
        onCancel={handleCloseWithdrawModal}
        okText={withdrawSubmitting ? '提交中...' : '确认'}
        cancelText="取消"
        okButtonProps={{ loading: withdrawSubmitting }}
        cancelButtonProps={{ disabled: withdrawSubmitting }}
      >
        <div className="account-security-withdraw-modal">
          <div className="account-security-withdraw-tip">
            请输入提现账号信息，我们会根据你填写的信息尽快处理提现申请。
          </div>
          <Input.TextArea
            value={withdrawAccountInfo}
            onChange={(event) => {
              setWithdrawAccountInfo(event.target.value);
              if (withdrawAccountError && event.target.value.trim()) {
                setWithdrawAccountError('');
              }
            }}
            rows={4}
            maxLength={200}
            placeholder="请输入收款账号、姓名、开户行或其他必要说明"
            status={withdrawAccountError ? 'error' : ''}
            disabled={withdrawSubmitting}
          />
          {withdrawAccountError ? (
            <div className="account-security-withdraw-error">{withdrawAccountError}</div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
};

export default AccountSecurity;
