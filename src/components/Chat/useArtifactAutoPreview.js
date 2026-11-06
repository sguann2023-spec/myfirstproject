import { useEffect, useRef } from 'react';

// Only event fields trigger activation, never playback or preview cache state.
export const useArtifactAutoPreview = ({ sessionId, drafts, audios, images, videos, documents, historyLoading = false, onOpen }) => {
  const fingerprint = JSON.stringify([
    (documents || []).filter((item) => !item.restoredArtifact).map((item) => [item.id, item.filePath, item.createdAt]),
    (Array.isArray(drafts) ? drafts : []).filter((item) => !item.restoredArtifact).map((draft) => [draft.draftId || draft.id, draft.clientRequestId, draft.createdAt, draft.status]),
    (Array.isArray(audios) ? audios : []).filter((item) => !item.restoredArtifact).map((audio) => [audio.id, audio.runtimeSessionId, audio.audioUrl, audio.createdAt, audio.status]),
    (Array.isArray(videos) ? videos : []).filter((item) => !item.restoredArtifact).map((video) => [video.id, video.runtimeSessionId, video.videoUrl, video.status]),
    (Array.isArray(images) ? images : []).filter((item) => !item.restoredArtifact).map((image) => [image.id, image.runtimeSessionId, image.imageUrl, image.status])
  ]);
  const previous = useRef(null);
  useEffect(() => {
    const baseline = previous.current;
    previous.current = { sessionId, fingerprint, historyLoading };
    if (!baseline || historyLoading || baseline.historyLoading || baseline.sessionId !== sessionId || baseline.fingerprint === fingerprint) return;
    if (sessionId && (drafts?.length || videos?.length || images?.length || audios?.length || documents?.length)) onOpen();
  }, [sessionId, fingerprint, historyLoading, drafts, audios, images, videos, documents, onOpen]);
};
