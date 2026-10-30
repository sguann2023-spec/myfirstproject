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

// Children are absent until a directory is opened; preserve that distinction.
export const replaceLazyTreeChildren = (nodes, parentPath, children) => (nodes || []).map((node) => {
  if (node.path === parentPath) {
    return { ...node, children: children.map((child) => ({ ...child, path: `${parentPath}/${child.path}` })) };
  }
  return node.children ? { ...node, children: replaceLazyTreeChildren(node.children, parentPath, children) } : node;
});

const normalizeReferencePath = (value) => String(value || '').replace(/\\/g, '/');

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
