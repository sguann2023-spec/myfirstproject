import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../../renderer/src/i18n/locales/en-us.json';
import zh from '../../renderer/src/i18n/locales/zh-cn.json';
import tw from '../../renderer/src/i18n/locales/zh-tw.json';
import AboutUs from './AboutUs';
import { getFeedbackErrorKey } from './feedbackError';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('antd', () => ({
  Input: { TextArea: ({ onChange, ...props }) => <textarea {...props} onInput={onChange} /> },
  Upload: ({ children }) => <div>{children}</div>,
  message: mocks,
}));
vi.mock('@ant-design/icons', () => ({ PlusOutlined: () => null }));
vi.mock('../../shared/electronStore', () => ({ electronStore: { get: () => ({}) } }));
vi.mock('../../../channel-branding/runtime', () => ({
  getCurrentChannelBrandConfig: () => ({ runtimeAssets: { aboutLogo: '' } }),
}));

const tlsError = new Error("Error invoking remote method 'app:send-feedback-email': Error: Client network socket disconnected before secure TLS connection was established");
const prefix = 'settings.about.feedback.errors';

describe('feedback error classification', () => {
  it.each([
    [tlsError, 'network'],
    [new Error('connect ECONNREFUSED smtp.example.test:465'), 'network'],
    [{ code: 'ETIMEDOUT' }, 'network'],
    ['Error invoking remote method: Error: Greeting never received: timeout', 'network'],
    [new Error('Invalid login: 535'), 'unavailable'],
    [new Error('FEEDBACK_UNAVAILABLE'), 'unavailable'],
    [new Error('读取图片失败'), 'image'],
    [new Error('Unexpected private backend detail'), 'failed'],
    [null, 'failed'],
  ])('maps %s to a user-facing translation key', (error, category) => {
    expect(getFeedbackErrorKey(error)).toBe(`${prefix}.${category}`);
  });

  it.each([en, zh, tw])('provides all feedback translations', (locale) => {
    const feedback = locale.settings.about.feedback;
    for (const key of ['description', 'images', 'submit', 'submitting', 'success']) {
      expect(feedback[key]).toBeTruthy();
    }
    expect(Object.keys(feedback.errors).sort()).toEqual(['failed', 'image', 'network', 'unavailable']);
    for (const value of Object.values(feedback.errors)) {
      expect(value).not.toMatch(/TLS|SMTP|app:send-feedback-email/);
    }
  });
});

describe('feedback submission', () => {
  let root;
  let container;
  let i18n;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.api = { sendFeedbackEmail: vi.fn().mockRejectedValue(tlsError) };
    i18n = createInstance();
    await i18n.init({
      lng: 'zh-CN',
      fallbackLng: 'en-US',
      resources: {
        'en-US': { translation: en },
        'zh-CN': { translation: zh },
        'zh-TW': { translation: tw },
      },
      interpolation: { escapeValue: false },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<I18nextProvider i18n={i18n}><AboutUs /></I18nextProvider>));
    await act(async () => {
      const textarea = container.querySelector('textarea');
      textarea.value = 'Feedback to preserve';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.api;
    vi.restoreAllMocks();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const submit = () => document.querySelector('.about-feedback-actions button');

  it.each(['zh-CN', 'zh-TW', 'en-US'])('shows a friendly localized error in %s and preserves input', async (language) => {
    await act(async () => i18n.changeLanguage(language));
    await act(async () => submit().click());
    expect(mocks.error).toHaveBeenCalledWith({
      key: 'about-feedback',
      content: i18n.t(`${prefix}.network`),
    });
    expect(container.querySelector('textarea').value).toBe('Feedback to preserve');
    expect(submit().disabled).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[AboutUs] Failed to send feedback', tlsError);
  });

  it('does not report success when the bridge is unavailable', async () => {
    delete window.api.sendFeedbackEmail;
    await act(async () => submit().click());
    expect(mocks.error).toHaveBeenCalledWith({
      key: 'about-feedback', content: i18n.t(`${prefix}.unavailable`),
    });
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('prevents duplicate sends and clears input after success', async () => {
    let resolve;
    window.api.sendFeedbackEmail.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await act(async () => {
      submit().click();
      submit().click();
    });
    expect(window.api.sendFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(submit().disabled).toBe(true);
    await act(async () => resolve());
    expect(container.querySelector('textarea').value).toBe('');
    expect(mocks.success).toHaveBeenCalledWith({
      key: 'about-feedback', content: i18n.t('settings.about.feedback.success'),
    });
  });
});
