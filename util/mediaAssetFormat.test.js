const assert = require('node:assert/strict');
const { test } = require('node:test');
const { preserveMediaAssetFormat } = require('./mediaAssetFormat');

test('preserves source extensions for images, videos and audio', () => {
  for (const [type, source, target, expected] of [
    ['image', '/Downloads/flame.svg', '/draft/assets/image/generated.png', '/draft/assets/image/generated.svg'],
    ['video', 'C:\\Videos\\clip.MOV', '/draft/assets/video/generated.mp4', '/draft/assets/video/generated.MOV'],
    ['audio', 'file:///Downloads/my%20voice.wav', '/draft/assets/audio/generated.mp3', '/draft/assets/audio/generated.wav'],
    ['image', 'https://example.com/photo.webp?token=123', '/draft/assets/image/generated.png', '/draft/assets/image/generated.webp']
  ]) {
    const material = { material_name: target.split('/').pop(), name: target.split('/').pop() };
    assert.equal(preserveMediaAssetFormat(type, material, source, target), expected);
    assert.equal(material.path, expected);
    assert.equal(material.replace_path, expected);
    assert.equal(material.material_name, expected.split('/').pop());
    assert.equal(material.name, expected.split('/').pop());
  }
});

test('leaves matching formats and unrecognized endpoint extensions unchanged', () => {
  for (const source of ['/Downloads/photo.png', 'https://example.com/download', 'https://example.com/download.php']) {
    const material = { material_name: 'photo.png' };
    assert.equal(preserveMediaAssetFormat('image', material, source, '/draft/photo.png'), '/draft/photo.png');
    assert.deepEqual(material, { material_name: 'photo.png' });
  }
});

test('does not alter effect assets or source references', () => {
  const material = { remote_url: '/Downloads/flame.svg', material_name: 'generated.png' };
  assert.equal(preserveMediaAssetFormat('effect', material, material.remote_url, '/draft/generated.png'), '/draft/generated.png');
  preserveMediaAssetFormat('image', material, material.remote_url, '/draft/generated.png');
  assert.equal(material.remote_url, '/Downloads/flame.svg');
});
