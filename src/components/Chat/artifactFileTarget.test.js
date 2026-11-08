import { describe, expect, it } from 'vitest';
import { createArtifactChatReference, getArtifactFileSource, getArtifactFileName, getArtifactLocalPath, isLocalFileSource } from './artifactFileTarget';

describe('artifact file target', () => {
  it('prefers the local downloaded path over the artifact url', () => {
    const video = { filePath: '/workspace/.artifacts/a.mp4', url: 'https://cdn.example.com/a.mp4', videoUrl: 'https://cdn.example.com/a.mp4' };
    expect(getArtifactFileSource(video)).toBe('/workspace/.artifacts/a.mp4');
    expect(getArtifactFileName(video)).toBe('a.mp4');
  });

  it('falls back to media url fields and derives names from paths', () => {
    expect(getArtifactFileSource({ audioUrl: '/tmp/tts/c.mp3' })).toBe('/tmp/tts/c.mp3');
    expect(getArtifactFileName({ imageUrl: 'https://cdn.example.com/img/生成图.png?x=1' })).toBe('生成图.png');
    expect(getArtifactFileSource({ url: 'file:///tmp/b.mp3' })).toBe('file:///tmp/b.mp3');
    expect(getArtifactFileSource(null)).toBe('');
  });

  it('ignores the speech copy stored as a registered audio name', () => {
    const audio = {
      audioUrl: '/workspace/.artifacts/tts/d8f7c53e755c802ee0b7a8982ed483d270.mp3',
      filePath: '/workspace/.artifacts/tts/d8f7c53e755c802ee0b7a8982ed483d270.mp3',
      name: '年轻成年女性刚快速坐到朋友身边',
      text: '年轻成年女性刚快速坐到朋友身边'
    };
    expect(getArtifactFileName(audio)).toBe('d8f7c53e755c802ee0b7a8982ed483d270.mp3');
  });

  it('keeps the document name and falls back for unnamed artifacts', () => {
    expect(getArtifactFileName({ name: '脚本.html', filePath: '/workspace/脚本.html' })).toBe('脚本.html');
    expect(getArtifactFileName({ name: '  ', filePath: '/workspace/脚本.html' })).toBe('脚本.html');
    expect(getArtifactFileName({})).toBe('生成文件');
  });

  it('classifies local and remote sources', () => {
    expect(isLocalFileSource('/workspace/a.mp4')).toBe(true);
    expect(isLocalFileSource('C:\\workspace\\a.mp4')).toBe(true);
    expect(isLocalFileSource('https://cdn.example.com/a.mp4')).toBe(false);
    expect(isLocalFileSource('')).toBe(false);
  });

  it('builds a composer reference entry from a local artifact path', () => {
    expect(createArtifactChatReference({ filePath: '/workspace/.artifacts/a.mp4', url: 'https://cdn.example.com/a.mp4' }))
      .toEqual({ rootPath: '/workspace/.artifacts', node: { path: 'a.mp4', name: 'a.mp4', type: 'file' } });
    expect(createArtifactChatReference({ name: '脚本.html', filePath: 'C:\\workspace\\out\\脚本.html' }))
      .toEqual({ rootPath: 'C:\\workspace\\out', node: { path: '脚本.html', name: '脚本.html', type: 'file' } });
    expect(createArtifactChatReference({ imageUrl: 'https://cdn.example.com/a.png' })).toBeNull();
    expect(createArtifactChatReference({})).toBeNull();
  });

  it('resolves local paths for reveal-in-folder, decoding file urls', () => {
    expect(getArtifactLocalPath({ filePath: '/workspace/.artifacts/a.mp4' })).toBe('/workspace/.artifacts/a.mp4');
    expect(getArtifactLocalPath({ url: 'file:///tmp/artifacts/a%20b.mp3' })).toBe('/tmp/artifacts/a b.mp3');
    expect(getArtifactLocalPath({ url: 'file:///C:/out/a.mp4' })).toBe('C:/out/a.mp4');
    expect(getArtifactLocalPath({ imageUrl: 'https://cdn.example.com/a.png' })).toBe('');
    expect(getArtifactLocalPath({})).toBe('');
  });
});
