export function mapDownloadErrorMessage(message) {
  const rawMessage = String(message || '').trim();

  if (/ENOFT/i.test(rawMessage)) {
    return '文件名冲突，关闭剪映后再下载';
  }

  if (/EPERM/i.test(rawMessage)) {
    return '文件下载冲突，关闭剪映后再下载';
  }

  if (/部分文件下载失败/.test(rawMessage)) {
    return '文件下载错误，请再次检查设置的素材链接或者路径是否正确';
  }

  return rawMessage;
}
