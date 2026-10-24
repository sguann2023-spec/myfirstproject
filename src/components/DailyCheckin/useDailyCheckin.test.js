import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useDailyCheckin from './useDailyCheckin';
import { checkinRechargeDaily, getDailyCheckinRewardStatus } from '../../api/recharge';

vi.mock('../../api/recharge', () => ({ checkinRechargeDaily: vi.fn(), getDailyCheckinRewardStatus: vi.fn() }));
vi.mock('antd', () => ({ message: { error: vi.fn() } }));

let root;
let state;
let serverReward;
let onClaimed;
function Harness() {
  state = useDailyCheckin({ onClaimed });
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.clearAllMocks();
  serverReward = { claimed_today: false, period: 1, reward_credits: 80 };
  getDailyCheckinRewardStatus.mockImplementation(async () => ({ ...serverReward }));
  onClaimed = vi.fn();
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(React.createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('queries on mount without automatically claiming', () => {
  expect(state.reward.claimed_today).toBe(false);
  expect(checkinRechargeDaily).not.toHaveBeenCalled();
});

it('blocks rapid clicks and further claims after success, refreshing balance separately', async () => {
  let finish;
  checkinRechargeDaily.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  let first;
  await act(async () => {
    first = state.claim();
    void state.claim();
  });
  expect(checkinRechargeDaily).toHaveBeenCalledTimes(1);
  expect(state.claiming).toBe(true);
  await act(async () => {
    serverReward.claimed_today = true;
    finish();
    await first;
  });
  await act(async () => state.claim());
  expect(checkinRechargeDaily).toHaveBeenCalledTimes(1);
  expect(state.reward.claimed_today).toBe(true);
  expect(onClaimed).toHaveBeenCalled();
});

it('reconciles a lost POST response with server state before allowing another claim', async () => {
  checkinRechargeDaily.mockImplementation(async () => {
    serverReward.claimed_today = true;
    throw new Error('Network interrupted');
  });
  await act(async () => state.claim());
  expect(state.reward.claimed_today).toBe(true);
  await act(async () => state.claim());
  expect(checkinRechargeDaily).toHaveBeenCalledTimes(1);
});

it('disables claiming when both POST and recovery query fail', async () => {
  checkinRechargeDaily.mockRejectedValue(new Error('Network interrupted'));
  getDailyCheckinRewardStatus.mockRejectedValue(new Error('Unavailable'));
  await act(async () => state.claim());
  expect(state.reward).toBeNull();
  await act(async () => state.claim());
  expect(checkinRechargeDaily).toHaveBeenCalledTimes(1);
});

it('does not revert successful claim when balance refresh fails', async () => {
  onClaimed.mockRejectedValue(new Error('Balance unavailable'));
  checkinRechargeDaily.mockImplementation(async () => { serverReward.claimed_today = true; });
  await act(async () => state.claim());
  expect(state.reward.claimed_today).toBe(true);
});
