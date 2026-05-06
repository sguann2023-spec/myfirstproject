const toMessage = (error) => String(error?.message || '').trim();

const parseHttpStatus = (errorMessage = '') => {
  const matched = String(errorMessage).match(/http\s*(\d{3})/i);
  if (!matched) return undefined;
  const status = Number(matched[1]);
  return Number.isFinite(status) ? status : undefined;
};

export const isAbortError = (error) => {
  if (!error) return false;
  if (error?.name === 'AbortError') return true;
  const message = toMessage(error).toLowerCase();
  if (!message) return false;
  return (
    message.includes('request was aborted')
    || message.includes('aborterror')
    || message.includes('signal is aborted')
    || message.includes('operation was aborted')
    || message.includes('operation aborted')
  );
};

const classifyError = ({ message = '', status } = {}) => {
  const lower = String(message || '').toLowerCase();

  if (
    status === 401
    || status === 403
    || lower.includes('invalid_api_key')
    || lower.includes('authentication')
    || lower.includes('unauthorized')
    || lower.includes('forbidden')
  ) {
    return {
      category: 'auth',
      title: '鉴权失败，请检查 API Key 或授权状态。',
    };
  }

  if (
    status === 404
    || lower.includes('model not found')
    || lower.includes('model_not_found')
    || lower.includes('model does not exist')
  ) {
    return {
      category: 'model',
      title: '模型不可用，请检查模型名称或提供商配置。',
    };
  }

  if (
    status === 429
    || lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('rate_limit')
    || lower.includes('insufficient_quota')
    || lower.includes('insufficient_balance')
  ) {
    return {
      category: 'quota',
      title: '请求频率或额度已达上限，请稍后重试。',
    };
  }

  if (
    lower.includes('context_length_exceeded')
    || lower.includes('too many tokens')
    || lower.includes('maximum context length')
  ) {
    return {
      category: 'context_length',
      title: '上下文长度超限，请缩短输入或新建会话。',
    };
  }

  if (
    status === 413
    || lower.includes('payload too large')
    || lower.includes('request entity too large')
  ) {
    return {
      category: 'payload',
      title: '请求内容过大，请减少输入内容后重试。',
    };
  }

  if (
    lower.includes('timeout')
    || lower.includes('network')
    || lower.includes('fetch failed')
    || lower.includes('econnrefused')
    || lower.includes('enotfound')
    || lower.includes('etimedout')
  ) {
    return {
      category: 'network',
      title: '网络连接异常，请检查网络或代理配置。',
    };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      category: 'server',
      title: '服务暂时不可用，请稍后重试。',
    };
  }

  return {
    category: 'unknown',
    title: '请求失败，请稍后重试。',
  };
};

export const normalizeChatError = (error) => {
  const rawMessage = toMessage(error) || 'Unknown error';
  const status = Number(error?.status || error?.statusCode || parseHttpStatus(rawMessage) || 0) || undefined;
  const code = error?.code ? String(error.code) : undefined;

  if (isAbortError(error)) {
    return {
      category: 'aborted',
      title: '请求被中止，导致操作未完成。',
      message: 'Request was aborted',
      detail: rawMessage || 'Request was aborted.',
      status,
      code,
    };
  }

  const classification = classifyError({
    message: rawMessage,
    status,
  });

  return {
    category: classification.category,
    title: classification.title,
    message: rawMessage,
    detail: rawMessage,
    status,
    code,
  };
};

export const buildErrorSignature = (error) => {
  if (!error) return '';
  const category = String(error?.category || '');
  const title = String(error?.title || '');
  const message = String(error?.message || '');
  const detail = String(error?.detail || '');
  const status = String(error?.status || '');
  const code = String(error?.code || '');
  return [category, title, message, detail, status, code].join('|');
};
