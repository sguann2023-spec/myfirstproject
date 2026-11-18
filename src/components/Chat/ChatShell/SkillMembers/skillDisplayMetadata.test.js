import { describe, expect, it } from 'vitest';
import { parseSkillDisplayMetadata } from './skillDisplayMetadata';

const parse = (example, root = '/skills/demo') => parseSkillDisplayMetadata(JSON.stringify(example), root);

describe('skill display metadata', () => {
  it('uses the example display cover and web URL, not its title or content', () => {
    expect(parse({ title: 'Other title', cover_url: 'fallback.jpg', display_info: { cover_url: 'https://example.test/cover.jpg', web_share: 'https://example.test/view', content: 'Other description' } })).toEqual({ coverSrc: 'https://example.test/cover.jpg', webUrl: 'https://example.test/view' });
  });
  it('supports top-level covers and skill-relative paths', () => {
    expect(parse({ cover_url: './cover one.jpg' }).coverSrc).toBe('file:///skills/demo/cover%20one.jpg');
    expect(parse({ display_info: { cover_url: 'images/cover.jpg' } }).coverSrc).toBe('file:///skills/demo/images/cover.jpg');
  });
  it('keeps absolute local and remote sources intact', () => {
    expect(parse({ cover_url: '/tmp/cover.jpg' }).coverSrc).toBe('file:///tmp/cover.jpg');
    expect(parse({ cover_url: 'C:\\skills\\cover.jpg' }).coverSrc).toBe('file:///C:/skills/cover.jpg');
    expect(parse({ cover_url: 'file:///tmp/cover.jpg' }).coverSrc).toBe('file:///tmp/cover.jpg');
  });
  it('gracefully handles missing and malformed examples or unsafe schemes', () => {
    for (const raw of [null, '', 'broken', '{}', 'null']) expect(parseSkillDisplayMetadata(raw)).toEqual({ webUrl: '', coverSrc: '' });
    expect(parse({ display_info: { web_share: 'javascript:alert(1)', cover_url: 'javascript:alert(1)' } })).toEqual({ webUrl: '', coverSrc: '' });
    expect(parse({ cover_url: 'cover.jpg' }, '').coverSrc).toBe('');
  });
});
