// 全局统一的删除确认弹窗。
//
// 对齐草稿/音色/工作区删除的既有样式（参考「确认删除草稿」）：
// 警示图标 + 标题 + 「删除后不可恢复…」说明 + 红色「删除」按钮。
// 复用 App 注入的 window.modal（antd Modal.useModal 实例），因此弹窗继承
// 全局主题与 ant.css 样式，而不是各页面自己的局部 ConfigProvider 主题，
// 保证整个应用的删除确认观感一致。
//
// 用法：
//   const ok = await confirmDelete({
//     title: '确认删除供应商',
//     content: `删除后不可恢复，确认删除供应商「${name}」及其全部模型吗？`,
//   });
//   if (!ok) return;
//
// 返回 Promise<boolean>：用户点「删除」为 true，点「取消」/关闭为 false。

/**
 * @param {Object} options
 * @param {string} options.title 弹窗标题（如「确认删除草稿」）。
 * @param {string} [options.content] 说明文案（如「删除后不可恢复，确认删除「…」吗？」）。
 * @param {string} [options.okText='删除'] 确认按钮文案。
 * @param {string} [options.cancelText='取消'] 取消按钮文案。
 * @returns {Promise<boolean>} 是否确认删除。
 */
export function confirmDelete({ title, content, okText = '删除', cancelText = '取消' }) {
  const modal = typeof window !== 'undefined' ? window.modal : undefined;
  if (modal && typeof modal.confirm === 'function') {
    return new Promise((resolve) => {
      modal.confirm({
        title,
        content,
        okText,
        cancelText,
        centered: true,
        okType: 'danger',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
  // 无全局 modal（如测试 / 非 Electron 环境）时退化为原生确认框。
  const fallback = typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(content || title)
    : false;
  return Promise.resolve(fallback);
}

export default confirmDelete;