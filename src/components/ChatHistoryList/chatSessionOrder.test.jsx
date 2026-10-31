import fs from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ChatHistoryList from './ChatHistoryList';
import { compareChatSessionOrder, getChatSessionOrderTime } from '../../shared/chatSessionOrder';

const home = fs.readFileSync(`${process.cwd()}/src/page/HomePage/HomePage.jsx`, 'utf8');
const serializationSource = home.slice(
  home.indexOf('const shouldPersistChatSessionMessages ='),
  home.indexOf('const countVisibleAssistantMessages =')
);
const serialize = new Function('getChatSessionOrderTime', 'normalizePersistedChatMessage',
  `${serializationSource}; return serializeChatSessionsForPersistence;`)(getChatSessionOrderTime, (message) => message);
const order = (sessions) => [...sessions].sort(compareChatSessionOrder).map((session) => session.id);

describe('stable chat history order', () => {
  it('preserves the legacy sort time when runtime messages are omitted and later hydrated', () => {
    const legacy = [
      { id: 'older', runtimeSessionId: 'r1', createdAt: 100, updatedAt: 400, messages: [] },
      { id: 'newer', runtimeSessionId: 'r2', createdAt: 200, updatedAt: 500, messages: [] }
    ];
    const restored = JSON.parse(JSON.stringify(serialize(legacy)));
    expect(restored[0].lastUserMessageAt).toBe(400);
    const hydrated = restored.map((session) => session.id === 'newer'
      ? { ...session, updatedAt: 999, messages: [{ role: 'user', createdAt: 150 }] }
      : session);
    expect(order(hydrated)).toEqual(order(restored));
    expect(order(serialize(hydrated))).toEqual(order(restored));
  });

  it('migrates the newest valid user timestamp before dropping runtime messages', () => {
    const timestamp = Date.parse('2026-10-31T01:00:00Z');
    const [saved] = serialize([{
      runtimeSessionId: 'r1', updatedAt: timestamp + 1000,
      messages: [
        { role: 'user', createdAt: '2026-10-31T01:00:00Z' },
        { role: 'user', createdAt: timestamp - 1000 },
        { role: 'user', createdAt: 'invalid' },
        { role: 'assistant', createdAt: timestamp + 1000 }
      ]
    }]);
    expect(saved.messages).toEqual([]);
    expect(saved.lastUserMessageAt).toBe(timestamp);
  });

  it('keeps empty chats anchored to creation rather than metadata updates', () => {
    const empty = { id: 'empty', lastUserMessageAt: 0, createdAt: 100, updatedAt: 999 };
    expect(getChatSessionOrderTime(empty)).toBe(100);
    expect(serialize([empty])[0].lastUserMessageAt).toBe(0);
  });

  it('uses deterministic tie breakers even if the input array is reordered', () => {
    const sessions = [
      { id: 'b', lastUserMessageAt: 500, createdAt: 100 },
      { id: 'a', lastUserMessageAt: 500, createdAt: 100 },
      { id: 'c', lastUserMessageAt: 500, createdAt: 200 }
    ];
    expect(order(sessions)).toEqual(['c', 'a', 'b']);
    expect(order([...sessions].reverse())).toEqual(order(sessions));
  });

  it('updates order with the actual user timestamp in all three send paths', () => {
    const positions = [...home.matchAll(/messages: \[\.\.\.item\.messages, userMessage, assistantMessage\],/g)]
      .map((match) => match.index);
    expect(positions).toHaveLength(2);
    positions.push(home.indexOf('messages: [...item.messages, failedUserMessage, failedAssistantMessage],'));
    for (const position of positions) {
      expect(position).toBeGreaterThan(0);
      const start = home.lastIndexOf('setChatSessions((prev) => {', position);
      const end = home.indexOf('});', home.indexOf('return sortChatSessions(updated);', position)) + 3;
      const newer = { id: 'newer', createdAt: 200, lastUserMessageAt: 200, messages: [] };
      let result;
      new Function('setChatSessions', 'targetSessionId', 'userMessage', 'assistantMessage',
        'failedUserMessage', 'failedAssistantMessage', 'sortChatSessions', home.slice(start, end))(
        (update) => { result = update([{ id: 'older', createdAt: 100, lastUserMessageAt: 100, messages: [] }, newer]); },
        'older', { role: 'user', createdAt: 300 }, { role: 'assistant' },
        { role: 'user', createdAt: 300 }, { role: 'assistant' },
        (sessions) => [...sessions].sort(compareChatSessionOrder)
      );
      expect(result.map((session) => session.id)).toEqual(['older', 'newer']);
      expect(result[0].lastUserMessageAt).toBe(300);
      expect(result[1]).toBe(newer);
    }
  });

  it('keeps rendered workspace groups in place after selecting and loading a chat', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const select = vi.fn();
    const sessions = [
      { id: 'old', title: 'Old', createdAt: 100, lastUserMessageAt: 100, accessible_paths: ['/work/old'] },
      { id: 'new', title: 'New', createdAt: 200, lastUserMessageAt: 200, accessible_paths: ['/work/new'] }
    ];
    const titles = () => [...container.querySelectorAll('.chat-history-list__group-title')].map((node) => node.textContent);
    try {
      await act(async () => root.render(<ChatHistoryList sessions={sessions} activeSessionId="new" onSelectSession={select} />));
      expect(titles()).toEqual(['new', 'old']);
      const title = [...container.querySelectorAll('.chat-history-list__item-title')].find((node) => node.textContent === 'Old');
      await act(async () => title.click());
      expect(select).toHaveBeenCalledWith('old');
      const hydrated = sessions.map((session) => session.id === 'old'
        ? { ...session, updatedAt: 999, messages: [{ role: 'user', createdAt: 50 }] }
        : session);
      await act(async () => root.render(<ChatHistoryList sessions={hydrated} activeSessionId="old" onSelectSession={select} />));
      expect(titles()).toEqual(['new', 'old']);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
