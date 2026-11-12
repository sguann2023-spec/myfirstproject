// Publish each root immediately; one failed root must not discard successful siblings.
export const loadReferenceRoots = async (roots, { isCurrent, publish, fail, complete }) => {
  await Promise.all(roots.map(async (root) => {
    try {
      const nodes = await root.load();
      if (isCurrent()) publish(root.key, nodes);
    } catch (error) {
      if (isCurrent()) fail(root.key, error);
    }
  }));
  if (isCurrent()) complete();
};

// Cancellation invalidates in-flight results as well as pending debounce timers.
export const scheduleReferenceRoots = (roots, callbacks, delay = 0) => {
  let cancelled = false;
  const timer = setTimeout(() => {
    void loadReferenceRoots(roots, {
      ...callbacks,
      isCurrent: () => !cancelled && callbacks.isCurrent(),
    });
  }, delay);
  return () => { cancelled = true; clearTimeout(timer); };
};

// The keyboard walks exactly the nodes displayed by the expanded tree UI.
export const collectVisibleReferenceNodes = (nodes, scopeKey, expandedKeys, forceExpanded = false) => {
  const results = [];
  for (const node of nodes || []) {
    const key = `${scopeKey}:${node.path}`;
    if (node.type === 'file' || node.type === 'directory') results.push(node);
    if (node.type === 'directory' && (forceExpanded || expandedKeys.has(key))) {
      results.push(...collectVisibleReferenceNodes(node.children, key, expandedKeys, forceExpanded));
    }
  }
  return results;
};

// Children are absent until a directory is opened; preserve that distinction.
export const replaceLazyTreeChildren = (nodes, parentPath, children) => (nodes || []).map((node) => {
  if (node.path === parentPath) {
    return { ...node, children: children.map((child) => ({ ...child, path: `${parentPath}/${child.path}` })) };
  }
  return node.children ? { ...node, children: replaceLazyTreeChildren(node.children, parentPath, children) } : node;
});

const normalizeReferencePath = (value) => String(value || '').replace(/\\/g, '/');

// Materialize only matching files and their ancestors, not the shallow browse cache.
export const flatReferencePathsToTree = (paths) => {
  const roots = [];
  const directories = new Map();
  const seen = new Set();
  for (const value of paths || []) {
    const parts = normalizeReferencePath(value).split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) continue;
    const fullPath = parts.join('/');
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    let siblings = roots;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      if (index === parts.length - 1) {
        siblings.push({ name, path, type: 'file' });
      } else {
        if (!directories.has(path)) {
          const node = { name, path, type: 'directory', children: [] };
          directories.set(path, node);
          siblings.push(node);
        }
        siblings = directories.get(path).children;
      }
    });
  }
  return roots;
};

export const filterTreeNodesByQuery = (nodes, query) => {
  const normalizedQuery = normalizeReferencePath(query).trim().toLowerCase();
  if (!normalizedQuery) return Array.isArray(nodes) ? nodes : [];

  return (Array.isArray(nodes) ? nodes : []).reduce((accumulator, node) => {
    const matchesSelf = [node?.name, node?.path].some((value) => (
      normalizeReferencePath(value).toLowerCase().includes(normalizedQuery)
    ));

    if (node?.type === 'directory') {
      const matchedChildren = filterTreeNodesByQuery(node.children, normalizedQuery);
      if (matchesSelf || matchedChildren.length > 0) {
        accumulator.push({
          ...node,
          ...(node.children === undefined ? {} : { children: matchedChildren }),
        });
      }
      return accumulator;
    }

    if (matchesSelf) {
      accumulator.push(node);
    }
    return accumulator;
  }, []);
};
