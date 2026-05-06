import { useAppSelector } from '@renderer/store';

export function useSettings() {
  const renderInputMessageAsMarkdown = useAppSelector(
    (state) => state?.settings?.renderInputMessageAsMarkdown !== false
  );
  return {
    renderInputMessageAsMarkdown
  };
}
