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
          children: matchedChildren,
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
