import React from 'react';
import { message } from 'antd';
import { buildStoryboardAiPrompt, validateAiStoryboard } from './aiAssist';

export const useAiAssist = ({ bindingRef, file, send, running, onError, visible = true }) => {
  const [busy, setBusy] = React.useState(false);
  const requestRef = React.useRef(null);
  const mounted = React.useRef(true);
  const runningRef = React.useRef(running);
  runningRef.current = running;
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = requestRef.current;
      clearTimeout(request?.timer);
      request?.binding.resumePolling();
      requestRef.current = null;
    };
  }, []);

  const finish = React.useCallback(async (request, failure = '') => {
    if (requestRef.current !== request || request.finishing) return;
    request.finishing = true;
    clearTimeout(request.timer);
    let loaded = false;
    try {
      // Read only after the entire chat task ends, not after its first file write.
      const { restored } = await request.binding.completeAi(
        request.original, (next) => validateAiStoryboard(next, request.original),
      );
      loaded = true;
      if (mounted.current) {
        onError(failure);
        if (restored) message.warning('AI生成任务结束，但是校验遇到问题，已恢复历史版本，建议重试');
      }
    } catch (error) {
      if (mounted.current) {
        const errorMessage = 'AI结果校验或历史版本恢复失败，请检查文件读写权限后重新打开。';
        onError(errorMessage);
        if (!visibleRef.current) message.error(errorMessage);
      }
    } finally {
      // A failed rollback must not allow polling to load the rejected file.
      if (loaded) request.binding.resumePolling();
      if (requestRef.current === request) requestRef.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [onError]);

  React.useEffect(() => {
    const request = requestRef.current;
    if (!request?.sent) return;
    if (running) {
      request.started = true;
      clearTimeout(request.timer);
    } else if (request.started) void finish(request);
  }, [running, busy, finish]);

  const submit = async (instruction) => {
    if (requestRef.current || runningRef.current) return false;
    if (!send || !file || !bindingRef.current) {
      onError('当前对话未就绪，无法发送 AI 辅助任务');
      return false;
    }
    const request = { binding: bindingRef.current, started: false, sent: false };
    requestRef.current = request;
    setBusy(true);
    onError('');
    try {
      if (await request.binding.flush() === false) throw new Error('请先解决分镜文件同步问题，再使用 AI 辅助');
      if (!mounted.current) return false;
      if (runningRef.current) throw new Error('当前对话正在执行其他任务，请稍后重试');
      request.binding.pausePolling();
      request.original = request.binding.getDocument();
      request.sent = true;
      const accepted = send(buildStoryboardAiPrompt(file, instruction), {
        images: [], imageAttachmentPreviews: [], pendingLocalAttachments: [],
        subtitleStoryboardRequest: {
          sourceFile: file.path,
          storyboardFile: file.draftPath,
          instruction: String(instruction || '').trim(),
        },
      });
      if (accepted !== true) throw new Error('消息未发送，请检查模型是否就绪或当前对话是否忙碌');
      request.timer = setTimeout(() => {
        if (!request.started) void finish(request, 'AI任务未启动，请查看聊天中的错误提示后重试');
      }, 20000);
      return true;
    } catch (error) {
      request.binding.resumePolling();
      if (requestRef.current === request) requestRef.current = null;
      if (mounted.current) {
        setBusy(false);
        onError(error.message || 'AI辅助发送失败');
      }
      return false;
    }
  };
  return { busy, submit };
};
