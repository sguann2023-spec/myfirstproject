import { describe, expect, it } from 'vitest';
import { filterTreeNodesByQuery } from './referenceTree.js';

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
