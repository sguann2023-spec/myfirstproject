import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The template-parity check imports settings, but must not load its HTTP client.
vi.mock('../api/chat.js', () => ({ getChatModelList: vi.fn(), testChatModel: vi.fn() }));
import { ProviderLogo } from './ProviderLogo.jsx';
import { inferProviderLogoKey, resolveProviderLogo } from '../shared/providerBranding.js';
import { buildChatModelProviders } from '../page/HomePage/chatProviders.js';
import { PROVIDER_TEMPLATES } from './ModelSettings/ModelSettings.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = undefined;
});
const render = (props) => {
  if (!root) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => root.render(<ProviderLogo {...props} />));
};

describe('shared provider branding', () => {
  it('preserves every template name mapping without depending on settings at runtime', () => {
    for (const template of PROVIDER_TEMPLATES) {
      expect(inferProviderLogoKey({ name: template.name })).toBe(template.logoKey);
    }
  });

  it('prioritizes persisted identity, then exact template name, then safe exact endpoint host', () => {
    expect(inferProviderLogoKey({ logoKey: 'kimi', name: 'OpenAI', baseUrl: 'https://api.anthropic.com/v1' })).toBe('kimi');
    expect(inferProviderLogoKey({ name: 'OpenAI', baseUrl: 'https://api.anthropic.com/v1' })).toBe('openai');
    expect(inferProviderLogoKey({ name: 'Renamed', baseUrl: 'https://api.anthropic.com/v1' })).toBe('anthropic');
    for (const baseUrl of ['invalid', 'ftp://api.openai.com', 'https://secret@api.openai.com', 'https://api.openai.com.evil.test']) {
      expect(inferProviderLogoKey({ baseUrl })).toBeUndefined();
      expect(resolveProviderLogo(baseUrl)).toBeNull();
    }
    for (const logoKey of ['unknown', '__proto__', 'constructor', 'toString']) {
      expect(resolveProviderLogo(undefined, logoKey)).toBeNull();
    }
  });

  it('projects inferred presentation identity without credentials or endpoints', () => {
    const provider = {
      id: 'legacy', name: 'Renamed', baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'never-echo-this', headers: { Authorization: 'secret' },
      models: [{ id: 'm', modelId: 'deepseek-chat', enabled: true }],
    };
    expect(buildChatModelProviders([], [], [provider])).toEqual([
      { id: 'legacy', name: 'Renamed', kind: 'custom', badge: 'API', logoKey: 'deepseek', modelValues: ['m:deepseek-chat'] },
    ]);
    expect(provider).not.toHaveProperty('logoKey');
  });

  it('renders a name-based local image or a generic fallback', () => {
    render({ name: 'OpenAI', size: 16, className: 'provider-logo' });
    expect(host.querySelector('img').getAttribute('src')).toBe(resolveProviderLogo(undefined, 'openai'));
    expect(host.querySelector('img').getAttribute('width')).toBe('16');
    render({ logoKey: 'unknown' });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
  });

  it('falls back after image failure and retries when switching sources, including returning to a failed source', () => {
    render({ logoKey: 'openai' });
    act(() => host.querySelector('img').dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull();
    render({ logoKey: 'anthropic' });
    const oldImage = host.querySelector('img');
    render({ logoKey: 'openai' });
    act(() => oldImage.dispatchEvent(new Event('error')));
    expect(host.querySelector('img').getAttribute('src')).toBe(resolveProviderLogo(undefined, 'openai'));
    act(() => host.querySelector('img').dispatchEvent(new Event('error')));
    expect(host.querySelector('svg')).not.toBeNull();
    render({ logoKey: 'anthropic' });
    expect(host.querySelector('img')).not.toBeNull();
  });
});
