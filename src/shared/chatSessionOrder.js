const toTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

export const getChatSessionOrderTime = (session) => {
  const savedTime = toTimestamp(session?.lastUserMessageAt);
  if (savedTime) return savedTime;
  if (session?.lastUserMessageAt === 0) return toTimestamp(session?.createdAt);

  // Migrate legacy metadata before runtime messages are discarded on restore.
  const userTime = (Array.isArray(session?.messages) ? session.messages : [])
    .reduce((latest, message) => message?.role === 'user'
      ? Math.max(latest, toTimestamp(message.createdAt))
      : latest, 0);
  return userTime || toTimestamp(session?.updatedAt) || toTimestamp(session?.createdAt);
};

export const compareChatSessionOrder = (a, b) => (
  getChatSessionOrderTime(b) - getChatSessionOrderTime(a)
  || toTimestamp(b?.createdAt) - toTimestamp(a?.createdAt)
  || String(a?.id || '').localeCompare(String(b?.id || ''))
);
