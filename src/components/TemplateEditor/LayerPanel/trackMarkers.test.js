import { expect, it } from 'vitest';
import { indexEditorTree } from '../editorView';
import { layerTrackMarkers } from './trackMarkers';

const text = id => ({ id, name: '同名', type: 'text', children: [] });
const composition = id => ({
  id, type: 'composition', children: [
    { id: `${id}-text-track`, name: '同名轨道', type: 'track', children: [text(`${id}-text`), text(`${id}-title`)] }
  ]
});
function fixture() {
  return [{
    id: 'root', type: 'composition', children: [
      { id: 'first-track', name: '同名轨道', type: 'track', children: [composition('first'), composition('second')] },
      { id: 'other-track', name: '同名轨道', type: 'track', children: [composition('other')] }
    ]
  }];
}
function visible(tree, collapsed = new Set(), depth = 0) {
  return tree.flatMap(node => node.type === 'track' ? visible(node.children, collapsed, depth) : [
    { ...node, depth }, ...(collapsed.has(node.id) ? [] : visible(node.children, collapsed, depth + 1))
  ]);
}
function markers(tree, selectedId, collapsed) {
  return layerTrackMarkers(visible(tree, collapsed), indexEditorTree(tree), selectedId);
}
const activeIds = result => [...result].filter(([, marker]) => marker.active).map(([id]) => id);

it('同轨分镜和展开后代共用连续蓝线，同名不同轨道保持灰色', () => {
  const result = markers(fixture(), 'first');
  expect(activeIds(result)).toEqual(['first', 'first-text', 'first-title', 'second', 'second-text', 'second-title']);
  expect(result.get('first')).toMatchObject({ first: true, last: false, depth: 1 });
  expect(result.get('second-title')).toMatchObject({ first: false, last: true, depth: 1 });
  expect(result.get('other')).toMatchObject({ active: false, first: true });
  expect(result.get('other-title')).toMatchObject({ active: false, last: true });
  expect(result.has('root')).toBe(false);
});

it('折叠分镜后蓝线缩短到当前可见的轨道最后一行', () => {
  const result = markers(fixture(), 'first', new Set(['first', 'second']));
  expect(activeIds(result)).toEqual(['first', 'second']);
  expect(result.get('second').last).toBe(true);
});

it('选中内部文字或隐藏轨道，只标记该层实际轨道且不扩散到父级', () => {
  const tree = fixture();
  for (const selection of ['first-text', 'first-text-track']) {
    const result = markers(tree, selection);
    expect(activeIds(result)).toEqual(['first-text', 'first-title']);
    expect(result.get('first-text').depth).toBe(2);
    expect(result.has('second')).toBe(false);
  }
});

it('拖到其他轨道后跟随真实分组更新，不使用旧分组或元素名称', () => {
  const tree = fixture();
  tree[0].children[1].children.unshift(tree[0].children[0].children.pop());
  expect(activeIds(markers(tree, 'first'))).toEqual(['first', 'first-text', 'first-title']);
  expect(activeIds(markers(tree, 'second'))).toEqual(['second', 'second-text', 'second-title', 'other', 'other-text', 'other-title']);
});

it('根场景归属同一根轨道，无选中时使用灰线', () => {
  const tree = [composition('first'), composition('second')];
  expect(activeIds(markers(tree, 'first'))).toEqual(['first', 'first-text', 'first-title', 'second', 'second-text', 'second-title']);
  expect(activeIds(markers(tree, '__root__'))).toEqual([]);
});
