// The preview shares the existing viewport: never resize the native window or
// lock the content to its previous width. CSS shrinks the main pane instead.
export const usePreviewWindowReady = ({ previewRequested }) => ({
  ready: Boolean(previewRequested),
  layoutWidth: null,
});
