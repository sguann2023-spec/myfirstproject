import React from 'react';
import { loggerService } from '../../renderer/src/services/LoggerService';

const logger = loggerService.withContext('ImageTimeline');

export default class ImageTimelineBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    logger.error('图片时间线渲染失败', {
      message: error?.message,
      stack: error?.stack,
      componentStack: info.componentStack,
      settings: this.props.settings
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="chat-panel__text-preset-error">
      图片时间线预览异常，当前设置已保留。
      <button type="button" onClick={() => this.setState({ failed: false })}>重新加载预览</button>
    </div>;
  }
}
