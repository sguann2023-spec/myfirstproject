export const getFeedbackErrorKey = (error) => {
  // Electron IPC may retain only the message, including its remote-method prefix.
  const detail = `${error?.code || ''} ${typeof error === 'string' ? error : error?.message || ''}`;
  const prefix = 'settings.about.feedback.errors';

  if (/读取图片失败|FEEDBACK_IMAGE_READ_FAILED/i.test(detail)) {
    return `${prefix}.image`;
  }
  if (/FEEDBACK_UNAVAILABLE|反馈邮箱未配置|EAUTH|Invalid login|authentication failed|Missing credentials/i.test(detail)) {
    return `${prefix}.unavailable`;
  }
  if (/TLS|SSL|certificate|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKET|EDNS|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket|timed?\s*out|timeout/i.test(detail)) {
    return `${prefix}.network`;
  }
  return `${prefix}.failed`;
};
