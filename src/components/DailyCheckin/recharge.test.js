import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getJson: vi.fn(), json: vi.fn(), userId: 'user-a', launchId: 'launch-a' }));
vi.mock('../../http', () => ({ http: mocks }));
vi.mock('../../auth/vectcutApiKey', () => ({ getCurrentVectcutUserId: () => mocks.userId }));

let api;
const reward = { claimed_today: true, period: 1, reward_credits: 80 };
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.userId = 'user-a';
  mocks.launchId = 'launch-a';
  window.api = { getAppInfo: async () => ({ launchId: mocks.launchId }) };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T10:00:00+08:00'));
  api = await import('../../api/recharge');
});
afterEach(() => vi.useRealTimers());

it('caches claimed status for today, including after module reload', async () => {
  mocks.getJson.mockResolvedValue(reward);
  await api.getDailyCheckinRewardStatus();
  await api.getDailyCheckinRewardStatus();
  vi.resetModules();
  api = await import('../../api/recharge');
  expect(await api.getDailyCheckinRewardStatus()).toEqual(reward);
  expect(mocks.getJson).toHaveBeenCalledTimes(1);
});

it('expires at Beijing midnight and isolates different accounts', async () => {
  mocks.getJson.mockResolvedValue(reward);
  await api.getDailyCheckinRewardStatus();
  mocks.userId = 'user-b';
  await api.getDailyCheckinRewardStatus();
  expect(mocks.getJson).toHaveBeenCalledTimes(2);
  mocks.userId = 'user-a';
  vi.setSystemTime(new Date('2026-10-26T00:00:00+08:00'));
  await api.getDailyCheckinRewardStatus();
  expect(mocks.getJson).toHaveBeenCalledTimes(3);
});

it('queries unclaimed status once per launch, including across renderer reloads', async () => {
  mocks.getJson.mockResolvedValue({ ...reward, claimed_today: false });
  await api.getDailyCheckinRewardStatus();
  await api.getDailyCheckinRewardStatus();
  vi.resetModules();
  api = await import('../../api/recharge');
  await api.getDailyCheckinRewardStatus();
  expect(mocks.getJson).toHaveBeenCalledTimes(1);
  mocks.launchId = 'launch-b';
  vi.resetModules();
  api = await import('../../api/recharge');
  await api.getDailyCheckinRewardStatus();
  expect(mocks.getJson).toHaveBeenCalledTimes(2);
});

it('does not repeat failed startup queries unless explicitly recovering a claim', async () => {
  mocks.getJson.mockRejectedValue(new Error('Unavailable'));
  await expect(api.getDailyCheckinRewardStatus()).rejects.toThrow('Unavailable');
  await expect(api.getDailyCheckinRewardStatus()).rejects.toThrow('Unavailable');
  expect(mocks.getJson).toHaveBeenCalledTimes(1);
  mocks.getJson.mockResolvedValue(reward);
  expect(await api.getDailyCheckinRewardStatus({ force: true })).toEqual(reward);
  expect(mocks.getJson).toHaveBeenCalledTimes(2);
});

it('caches a successful claim before the following status refresh', async () => {
  mocks.json.mockResolvedValue(undefined);
  await api.checkinRechargeDaily({ ...reward, claimed_today: false });
  expect(await api.getDailyCheckinRewardStatus()).toEqual(reward);
  expect(mocks.getJson).not.toHaveBeenCalled();
});

it('does not cache a failed claim', async () => {
  mocks.json.mockRejectedValue(new Error('Unavailable'));
  await expect(api.checkinRechargeDaily(reward)).rejects.toThrow('Unavailable');
  mocks.getJson.mockResolvedValue({ ...reward, claimed_today: false });
  expect((await api.getDailyCheckinRewardStatus()).claimed_today).toBe(false);
  expect(mocks.getJson).toHaveBeenCalledTimes(1);
});
