const { parentPort, workerData } = require('worker_threads');
const { saveDraftBackground } = require('./saveDraftBackground');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const path = require('path');
const fs = require('fs');
const logger = require('./loggerBridge').withContext('DownloadWorker');

// 初始化i18next
function initI18n() {
  const localesPath = path.join(process.env.LOCALES_PATH || path.join(__dirname, '../locales'));
  
  return i18next.use(Backend).init({
    backend: {
      loadPath: path.join(localesPath, '{{lng}}/{{ns}}.json')
    },
    fallbackLng: 'zh',
    debug: false,
    interpolation: {
      escapeValue: false
    }
  });
}

// 在开始下载前初始化i18next
initI18n().then(() => runDownload());

async function runDownload() {
  logger.info('runDownload')
  try {
    const { draft_id, draft_name, draftFolder, taskId, is_capcut, apiHost, script } = workerData;
    
    /**
     * 创建进度回调函数，将进度消息和文件列表发送回主线程
     * @param {number} progress - 总体进度百分比 (0-100)
     * @param {string} message - 状态信息
     * @param {Array<Object>} fileList - 包含每个文件详细进度的列表
     */
    const progressCallback = (progress, message, fileList) => {
      parentPort.postMessage({
        type: 'progress',
        progress,
        message,
        fileList // 重点：现在将 fileList 传递给主线程
      });
    };
    
    // 调用saveDraftBackground函数
    const result = await saveDraftBackground(
      draft_id,
      draft_name,
      draftFolder,
      taskId,
      progressCallback,
      is_capcut,
      apiHost,
      script // 传入前端获取的脚本
    );
    
    if (result.success) {
      parentPort.postMessage({
        type: 'complete',
        message: result.message || '下载完成！'
      });
    } else {
      parentPort.postMessage({
        type: 'error',
        message: result.message || '下载失败',
        error: result.error || '下载失败'
      });
    }
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: error?.message || '处理过程中发生错误',
      error: error?.message || '下载失败'
    });
  }
}
