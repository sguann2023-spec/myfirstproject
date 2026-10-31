import { describe, expect, it } from 'vitest';
import { filterTreeNodesByQuery, replaceLazyTreeChildren, loadReferenceRoots } from './referenceTree.js';

describe('independent root refresh', () => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };

  it('publishes workspace before another root settles and isolates its failure', async () => {
    const workspace = deferred();
    const skill = deferred();
    const published = [];
    const failures = [];
    let completed = false;
    const run = loadReferenceRoots([
      { key: 'workspace', load: () => workspace.promise },
      { key: 'removed-skill', load: () => skill.promise },
    ], {
      isCurrent: () => true,
      publish: (key, nodes) => published.push([key, nodes]),
      fail: (key) => failures.push(key),
      complete: () => { completed = true; },
    });
    workspace.resolve(['file.txt']);
    await Promise.resolve();
    expect(published).toEqual([['workspace', ['file.txt']]]);
    expect(completed).toBe(false);
    skill.reject(new Error('ENOENT'));
    await run;
    expect(failures).toEqual(['removed-skill']);
    expect(published).toEqual([['workspace', ['file.txt']]]);
    expect(completed).toBe(true);
  });

  it('ignores late success, errors, and aggregate completion after reopening', async () => {
    const success = deferred();
    const failure = deferred();
    let current = true;
    const events = [];
    const run = loadReferenceRoots([
      { key: 'success', load: () => success.promise },
      { key: 'failure', load: () => failure.promise },
    ], {
      isCurrent: () => current,
      publish: () => events.push('publish'),
      fail: () => events.push('fail'),
      complete: () => events.push('complete'),
    });
    current = false;
    success.resolve([]);
    failure.reject(new Error('stale'));
    await run;
    expect(events).toEqual([]);
  });
});

const tree = [
  {
    name: 'chat',
    path: 'chat',
    type: 'directory',
    children: [
      { name: 'app.py', path: 'chat/app.py', type: 'file' },
      { name: 'helpers.py', path: 'chat/helpers.py', type: 'file' },
    ],
  },
  {
    name: 'other',
    path: 'other',
    type: 'directory',
    children: [
      { name: 'app.py', path: 'other/app.py', type: 'file' },
    ],
  },
];

describe('lazy reference trees', () => {
  it('loads only the requested folder and preserves unloaded siblings', () => {
    const nodes = [{ path: 'a', name: 'a', type: 'directory' }, { path: 'b', type: 'directory' }];
    const loaded = replaceLazyTreeChildren(nodes, 'a', [{ path: 'nested', type: 'directory' }]);
    expect(loaded[0].children).toEqual([{ path: 'a/nested', type: 'directory' }]);
    expect(loaded[1]).toBe(nodes[1]);
    expect(nodes[0].children).toBeUndefined();
    const nested = replaceLazyTreeChildren(loaded, 'a/nested', []);
    expect(nested[0].children[0].children).toEqual([]);
  });

  it('replaces stale children and keeps sibling paths isolated', () => {
    const loaded = replaceLazyTreeChildren(tree, 'chat', [{ path: 'new.txt', type: 'file' }]);
    expect(loaded[0].children).toEqual([{ path: 'chat/new.txt', type: 'file' }]);
    expect(loaded[1]).toEqual(tree[1]);
    expect(replaceLazyTreeChildren(loaded, 'chat', [])[0].children).toEqual([]);
    expect(tree[0].children).toHaveLength(2);
  });

  it('searches loaded data without inventing children for unloaded folders', () => {
    const nodes = [{ name: 'empty', path: 'empty', type: 'directory' }];
    expect(filterTreeNodesByQuery(nodes, 'empty')[0].type).toBe('directory');
    expect(nodes[0].children).toBeUndefined();
    expect(filterTreeNodesByQuery(nodes, 'unknown')).toEqual([]);
  });
});

describe('filterTreeNodesByQuery', () => {
  it('keeps basename matching behavior', () => {
    const result = filterTreeNodesByQuery(tree, 'app.py');

    expect(result).toHaveLength(2);
    expect(result[0].children).toEqual([
      { name: 'app.py', path: 'chat/app.py', type: 'file' },
    ]);
    expect(result[1].children).toEqual([
      { name: 'app.py', path: 'other/app.py', type: 'file' },
    ]);
  });

  it('matches a workspace-relative path without including duplicate basenames', () => {
    const result = filterTreeNodesByQuery(tree, 'chat/app.py');

    expect(result).toEqual([
      {
        name: 'chat',
        path: 'chat',
        type: 'directory',
        children: [
          { name: 'app.py', path: 'chat/app.py', type: 'file' },
        ],
      },
    ]);
  });

  it('normalizes path separators and ignores case', () => {
    const result = filterTreeNodesByQuery(tree, 'CHAT\\APP.PY');

    expect(result[0].children).toEqual([
      { name: 'app.py', path: 'chat/app.py', type: 'file' },
    ]);
  });

  it('returns no matches for an unknown relative path', () => {
    expect(filterTreeNodesByQuery(tree, 'missing/app.py')).toEqual([]);
  });
});
