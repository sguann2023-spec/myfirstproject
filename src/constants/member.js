export const MEMBER_COLOR = '#da9b60';

export const normalizeMemberProvider = (provider) =>
  String(provider || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)[0] || '';

export const isMemberVoiceProvider = (provider) => normalizeMemberProvider(provider) === 'elevenlabs';
