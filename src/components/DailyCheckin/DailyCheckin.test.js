import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import DailyCheckin from './DailyCheckin';
import { checkinRechargeDaily, getDailyCheckinRewardStatus } from '../../api/recharge';

vi.mock('../../api/recharge', () => ({ checkinRechargeDaily: vi.fn(), getDailyCheckinRewardStatus: vi.fn() }));
vi.mock('antd', () => ({ message: { error: vi.fn() } }));
let root;
let container;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.clearAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('keeps the popup after claiming, even when subsequent status reads would fail; closes only manually', async () => {
  getDailyCheckinRewardStatus.mockResolvedValueOnce({ claimed_today: false, period: 1, reward_credits: 80 })
    .mockRejectedValue(new Error('Status unavailable'));
  checkinRechargeDaily.mockResolvedValue(undefined);
  await act(async () => root.render(React.createElement(DailyCheckin)));
  expect(container.textContent).toContain('立即领取');
  await act(async () => container.querySelector('.daily-checkin__claim').click());
  expect(container.querySelector('.daily-checkin')).not.toBeNull();
  expect(container.querySelector('.daily-checkin__claim').textContent).toBe('今日已领取');
  expect(container.querySelector('.daily-checkin__claim').disabled).toBe(true);
  await act(async () => container.querySelector('.daily-checkin__claim').click());
  expect(checkinRechargeDaily).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector('.daily-checkin__close').click());
  expect(container.querySelector('.daily-checkin')).toBeNull();
});

it('still hides the popup when initially loading an already claimed reward', async () => {
  getDailyCheckinRewardStatus.mockResolvedValue({ claimed_today: true, period: 1, reward_credits: 80 });
  await act(async () => root.render(React.createElement(DailyCheckin)));
  expect(container.querySelector('.daily-checkin')).toBeNull();
});
