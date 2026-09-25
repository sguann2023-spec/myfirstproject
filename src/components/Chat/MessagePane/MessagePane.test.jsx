import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessagePane from './MessagePane';

const layout = vi.hoisted(() => ({
  height: 1200,
  viewport: 400,
  scrollTo: vi.fn(),
}));

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: React.forwardRef(({ list, children }, ref) => {
    const elementRef = React.useRef(null);
    React.useImperativeHandle(ref, () => {
      const element = elementRef.current;
      Object.defineProperties(element, {
        scrollHeight: { configurable: true, get: () => layout.height },
        clientHeight: { configurable: true, get: () => layout.viewport },
      });
      element.scrollTo = (options) => {
        layout.scrollTo(options);
        element.scrollTop = options.top;
        element.dispatchEvent(new Event('scroll'));
      };
      return {
        scrollElement: () => element,
        getTotalSize: () => layout.height - 24,
        measure: () => {},
        resizeItem: () => {},
      };
    });
    return <div ref={elementRef} data-testid="scroller">{list.map(children)}</div>;
  }),
}));

vi.mock('./MessageGroup/MessageGroup', () => ({
  default: ({ messages }) => <div>{messages.map((message) => message.content).join('')}</div>,
}));
vi.mock('./WelcomePage', () => ({ default: () => <div>Welcome</div> }));

let container;
let root;
let frames;
let observers;
let messages;

const render = async (session = 'session-1', props = {}) => {
  await act(async () => root.render(
    <MessagePane messages={messages} runtimeSessionId={session} {...props} />
  ));
};
const flushFrames = async () => {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(0)));
};
const scroller = () => container.querySelector('[data-testid="scroller"]');
const scroll = async (top) => {
  await act(async () => {
    scroller().scrollTop = top;
    scroller().dispatchEvent(new Event('scroll'));
  });
};
const wheelUp = async () => {
  await act(async () => scroller().dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  layout.height = 1200;
  layout.viewport = 400;
  layout.scrollTo.mockClear();
  messages = [{ id: '1', role: 'user', content: 'Hello' }];
  frames = new Map();
  observers = new Set();
  let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => frames.delete(frame));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(element) {
      this.element = element;
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessagePane auto-scroll', () => {
  it('opens existing history at the actual bottom, including padding', async () => {
    await render();
    await flushFrames();
    expect(layout.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'auto' });
  });

  it('keeps following when a new message group increases the height', async () => {
    await render();
    await flushFrames();
    layout.scrollTo.mockClear();
    layout.height = 1600;
    messages = [...messages, { id: '2', role: 'assistant', content: 'Reply' }];
    await render();
    await flushFrames();
    expect(layout.scrollTo).toHaveBeenLastCalledWith({ top: 1200, behavior: 'auto' });
  });

  it('does not mistake a layout scroll event during streaming for opting out', async () => {
    await render();
    await flushFrames();
    layout.height = 1800;
    await scroll(800);
    messages = [{ ...messages[0], content: 'More streamed content' }];
    await render();
    await flushFrames();
    expect(scroller().scrollTop).toBe(1400);
  });

  it('cancels queued following on upward wheel input and resumes at the bottom', async () => {
    await render();
    await flushFrames();
    layout.scrollTo.mockClear();
    layout.height = 1600;
    messages = [...messages, { id: '2', role: 'assistant', content: 'Reply' }];
    await render();
    await wheelUp();
    await scroll(500);
    await flushFrames();
    expect(layout.scrollTo).not.toHaveBeenCalled();
    messages = [...messages, { id: '3', role: 'assistant', content: 'Next' }];
    await render();
    await flushFrames();
    expect(layout.scrollTo).not.toHaveBeenCalled();
    await scroll(1200);
    layout.height = 1800;
    messages = [...messages, { id: '4', role: 'assistant', content: 'Next reply' }];
    await render();
    await flushFrames();
    expect(scroller().scrollTop).toBe(1400);
  });

  it('pauses for upward scrollbar or keyboard scrolling', async () => {
    await render();
    await flushFrames();
    layout.scrollTo.mockClear();
    await scroll(500);
    messages = [{ ...messages[0], content: 'Updated' }];
    await render();
    await flushFrames();
    expect(layout.scrollTo).not.toHaveBeenCalled();
  });

  it.each([false, true])('resumes at the bottom on send, with assistant placeholder: %s', async (withPlaceholder) => {
    await render();
    await flushFrames();
    await wheelUp();
    await scroll(200);
    layout.height = 1600;
    messages = [...messages, { id: 'sent', role: 'user', content: 'New request' }];
    if (withPlaceholder) messages.push({ id: 'reply', role: 'assistant', content: '' });
    await render('session-1', { sending: true });
    await flushFrames();
    expect(scroller().scrollTop).toBe(1200);
    layout.height = 1800;
    const observer = [...observers].find((entry) => entry.element !== scroller());
    vi.spyOn(observer.element, 'getBoundingClientRect').mockReturnValue({ height: 1776 });
    await act(async () => observer.callback());
    await flushFrames();
    expect(scroller().scrollTop).toBe(1400);
  });

  it('follows viewport resizing only while follow mode is active', async () => {
    await render();
    await flushFrames();
    const observer = [...observers].find((entry) => entry.element === scroller());
    layout.viewport = 300;
    await act(async () => observer.callback());
    await flushFrames();
    expect(scroller().scrollTop).toBe(900);
    await wheelUp();
    layout.scrollTo.mockClear();
    layout.viewport = 200;
    await act(async () => observer.callback());
    await flushFrames();
    expect(layout.scrollTo).not.toHaveBeenCalled();
  });

  it('follows delayed message layout growth', async () => {
    await render();
    await flushFrames();
    layout.height = 1800;
    const observer = [...observers].find((entry) => entry.element !== scroller());
    vi.spyOn(observer.element, 'getBoundingClientRect').mockReturnValue({ height: 1776 });
    await act(async () => observer.callback());
    await flushFrames();
    expect(scroller().scrollTop).toBe(1400);
  });

  it('keeps following after completion removes the loading indicator', async () => {
    layout.height = 1499;
    layout.viewport = 330;
    await render('session-1', { sending: true });
    await flushFrames();
    expect(scroller().scrollTop).toBe(1169);
    layout.height = 1467;
    await scroll(1137);
    await render('session-1', { sending: false, historyLoading: true });
    const observer = [...observers].find((entry) => entry.element !== scroller());
    layout.height = 1500;
    vi.spyOn(observer.element, 'getBoundingClientRect').mockReturnValue({ height: 1476 });
    await act(async () => observer.callback());
    await flushFrames();
    expect(scroller().scrollTop).toBe(1170);
  });

  it('does not resume a user-paused view when completion shrinks the bottom', async () => {
    await render('session-1', { sending: true });
    await flushFrames();
    await wheelUp();
    layout.scrollTo.mockClear();
    layout.height = 1168;
    await scroll(768);
    await render('session-1', { sending: false });
    const observer = [...observers].find((entry) => entry.element !== scroller());
    vi.spyOn(observer.element, 'getBoundingClientRect').mockReturnValue({ height: 1144 });
    await act(async () => observer.callback());
    await flushFrames();
    expect(layout.scrollTo).not.toHaveBeenCalled();
  });

  it('restores following when switching sessions or leaving the empty page', async () => {
    await render();
    await flushFrames();
    await wheelUp();
    await render('session-2');
    await flushFrames();
    expect(scroller().scrollTop).toBe(800);
    messages = [];
    await render('session-2');
    messages = [{ id: 'new', role: 'assistant', content: 'New session' }];
    await render('session-2');
    await flushFrames();
    expect(scroller().scrollTop).toBe(800);
  });

  it('cancels pending animation frames when unmounted', async () => {
    await render();
    expect(frames.size).toBeGreaterThan(0);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
  });
});
