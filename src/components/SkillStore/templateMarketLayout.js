export const TEMPLATE_CARD_MIN_WIDTH = 240;
export const TEMPLATE_COLUMN_GAP = 6;

export function getTemplateColumnCount(width) {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + TEMPLATE_COLUMN_GAP) / (TEMPLATE_CARD_MIN_WIDTH + TEMPLATE_COLUMN_GAP)));
}
