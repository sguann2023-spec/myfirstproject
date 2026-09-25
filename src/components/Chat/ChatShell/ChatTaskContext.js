import React from 'react';

// Tasks launched by tools use the same visible conversation as the chat composer.
/** @type {React.Context<{
 * send: ((prompt: string, options: Record<string, unknown>) => boolean) | null,
 * running: boolean,
 * openSubtitleStoryboard: ((filePath: string) => void) | null
 * }>} */
export const ChatTaskContext = React.createContext({ send: null, running: false, openSubtitleStoryboard: null });
