const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const downloader = require('./downloader');
const i18next = require('i18next');
const logger = require('./loggerBridge').withContext('SaveDraftBackground');
const { parentPort } = require('worker_threads'); // 新增

function shouldUseElectronSessionDownload(source) {
  return typeof source === 'string' && /^https?:\/\//i.test(source);
}

function buildSessionDownloadHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
}

async function downloadViaElectronSession(url, localFilename, progressCallback, timeout = 180000) {
  if (!parentPort) {
    throw new Error('parentPort not available for session download');
  }

  return new Promise((resolve, reject) => {
    const reqId = `session-download:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    let settled = false;
    let timer = null;

    const resetTimeout = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        finish(reject, new Error(`session download timeout after ${Math.ceil(timeout / 1000)}s without progress`));
      }, timeout + 15000);
    };

    const cleanup = () => {
      parentPort.off('message', onMessage);
      if (timer) {
        clearTimeout(timer);
      }
    };

    const finish = (handler, payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(payload);
    };

    const onMessage = (msg) => {
      if (!msg || msg.reqId !== reqId) return;

      if (msg.type === 'session-download-progress') {
        resetTimeout();
        if (typeof progressCallback === 'function') {
          progressCallback(Number(msg.downloadedBytes || 0), Number(msg.totalBytes || 0));
        }
        return;
      }

      if (msg.type === 'session-download-response') {
        if (msg.success) {
          finish(resolve, true);
        } else {
          finish(reject, new Error(msg.error || 'session download failed'));
        }
      }
    };

    parentPort.on('message', onMessage);
    resetTimeout();
    parentPort.postMessage({
      type: 'session-download-request',
      reqId,
      url,
      localFilename,
      timeout,
      headers: buildSessionDownloadHeaders()
    });
  });
}

function loadUpdateMediaMetadata() {
  const candidates = [
    path.resolve(process.cwd(), 'out/util/update_media_metadata.js'),
    path.resolve(__dirname, '../out/util/update_media_metadata.js'),
    path.resolve(__dirname, 'update_media_metadata.js')
  ];

  const target = candidates.find((candidate) => fs.existsSync(candidate));
  if (!target) {
    throw new Error('update_media_metadata module not found');
  }

  logger.info(`[DLTRACE][Worker] load update_media_metadata from ${target}`);
  return require(target);
}

const { updateMediaMetadata } = loadUpdateMediaMetadata();

/**
 * 构建资源文件路径
 * @param {string} draftFolder - 草稿文件夹路径
 * @param {string} draftName - 草稿名称
 * @param {string} assetType - 资源类型（audio, image, video）
 * @param {string} materialName - 素材名称
 * @returns {string} - 构建好的路径
 */
function buildAssetPath(draftFolder, draftName, assetType, materialName) {
  // 简化版本，仅处理macOS/Linux路径
  return path.join(draftFolder, draftName, "assets", assetType, materialName);
}

/**
 * 递归复制文件夹
 * @param {string} source - 源文件夹路径
 * @param {string} destination - 目标文件夹路径
 * @returns {Promise<void>}
 */
async function copyFolderRecursive(source, destination) {
  if (!fs.existsSync(destination)) {
    await fs.promises.mkdir(destination, { recursive: true });
  }
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyFolderRecursive(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function stabilizeLocalRemoteUrls(script) {
  const visited = new WeakSet();
  let normalized = 0;
  let missingLocalFiles = 0;

  const isLocalLike = (v) => typeof v === 'string' &&
    (v.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('file://'));

  const normalizeLocalPath = (v) => {
    if (v.startsWith('file://')) {
      try { return decodeURI(v.replace(/^file:\/\//, '')); } catch { return v.replace(/^file:\/\//, ''); }
    }
    return v;
  };

  const walk = async (node) => {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) await walk(item);
      return;
    }

    for (const key of Object.keys(node)) {
      const val = node[key];
      if (key === 'remote_url' && isLocalLike(val)) {
        const src = normalizeLocalPath(val);
        try {
          if (fs.existsSync(src) && fs.statSync(src).isFile()) {
            if (src !== val) {
              node[key] = src;
              normalized++;
            }
          } else {
            missingLocalFiles++;
          }
        } catch {
          missingLocalFiles++;
        }
      }
      await walk(val);
    }
  };

  await walk(script);
  return { normalized, missingLocalFiles };
}

/**
 * 后台保存草稿到OSS
 * @param {string} draftId - 草稿ID
 * @param {string} draftName - 草稿名称
 * @param {string} draftFolder - 草稿文件夹路径
 * @param {string} taskId - 任务ID
 * @param {Function} progressCallback - 进度回调函数
 * @param {boolean} is_capcut - 是否为CapCut
 * @returns {Promise<Object>} - 返回结果对象 {success: boolean, error: string, message: string}
 */
async function saveDraftBackground(draftId, draftName, draftFolder, taskId, progressCallback, is_capcut, apiHost, cover, scriptFromRenderer) {
  let script;
  // 如果draftName为空，就应该设置为draftId
  draftName = draftName || draftId;
  logger.info('[DLTRACE][Worker] saveDraftBackground:start', {
    draftId,
    draftName,
    draftFolder: draftFolder || '',
    taskId: taskId || '',
    is_capcut: Boolean(is_capcut),
    hasApiHost: Boolean(apiHost),
    hasCover: Boolean(cover),
    hasScriptFromRenderer: Boolean(scriptFromRenderer)
  });

  if (!draftFolder || String(draftFolder).trim() === '') {
    const errorMessage = 'draftFolder is empty';
    logger.error('[DLTRACE][Worker] saveDraftBackground invalid args', {
      draftId,
      draftName,
      draftFolder: String(draftFolder || '')
    });
    throw new Error(errorMessage);
  }

  const downloadTasks = []; // 存储所有下载任务的完整列表
  const DOWNLOAD_PROGRESS_THROTTLE_MS = 150;
  let pendingDownloadProgress = null;
  let pendingDownloadProgressTimer = null;
  let lastDownloadProgressAt = 0;

  // --- 辅助函数：根据下载任务列表计算总体进度 ---
  const calculateOverallProgress = (tasks) => {
    if (tasks.length === 0) return { overallProgress: 100, totalBytes: 0, downloadedBytes: 0 };
    
    let totalBytes = 0;
    let downloadedBytes = 0;
    
    tasks.forEach(task => {
        // 如果文件大小未知 (total <= 0)，使用已下载大小作为估算，并给一个权重 (例如 1MB)
        if (task.total > 0) {
            totalBytes += task.total;
            downloadedBytes += task.downloaded;
        } else {
             // 对于大小未知的文件，我们假定它们都是 1MB，并使用已下载量
            const UNKNOWN_SIZE_WEIGHT = 1024 * 1024; 
            totalBytes += UNKNOWN_SIZE_WEIGHT;
            // 如果状态是 completed，则计入全部权重，否则计入 0
            downloadedBytes += task.status === 'completed' ? UNKNOWN_SIZE_WEIGHT : 0;
        }
    });

    const overallProgress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
    return { overallProgress, totalBytes, downloadedBytes };
  };

  // --- 辅助函数：发送进度报告 (包含文件列表) ---
  const sendProgress = (baseProgress, message, tasks) => {
      const { overallProgress } = calculateOverallProgress(tasks);
      
      // 下载部分占 40% (从 30% 到 70%)
      const downloadSectionProgress = overallProgress * 0.40; 
      const finalProgress = Math.floor(baseProgress + downloadSectionProgress);

      if (progressCallback) {
          progressCallback(finalProgress, message, tasks.map(task => ({
              id: task.id,
              name: task.material.material_name || task.material.name || path.basename(task.localPath),
              url: task.url,
              downloaded: task.downloaded / 1024 / 1024, // 转换为MB
              total: task.total > 0 ? task.total / 1024 / 1024 : 1, // 转换为MB, 至少为 1MB 避免 UI 崩溃
              unit: 'MB',
              status: task.status,
              folderPath: path.dirname(task.localPath),
              type: task.type
          })));
      }
      return finalProgress;
  };

  const flushDownloadProgress = () => {
      pendingDownloadProgressTimer = null;
      if (!pendingDownloadProgress) {
        return;
      }
      const { baseProgress, message, tasks } = pendingDownloadProgress;
      pendingDownloadProgress = null;
      lastDownloadProgressAt = Date.now();
      sendProgress(baseProgress, message, tasks);
  };

  const reportDownloadProgress = (baseProgress, message, tasks, options = {}) => {
      if (!progressCallback) {
        return;
      }

      pendingDownloadProgress = { baseProgress, message, tasks };
      if (options.force) {
        if (pendingDownloadProgressTimer) {
          clearTimeout(pendingDownloadProgressTimer);
          pendingDownloadProgressTimer = null;
        }
        flushDownloadProgress();
        return;
      }

      const now = Date.now();
      const remaining = DOWNLOAD_PROGRESS_THROTTLE_MS - (now - lastDownloadProgressAt);
      if (remaining <= 0) {
        flushDownloadProgress();
        return;
      }

      if (!pendingDownloadProgressTimer) {
        pendingDownloadProgressTimer = setTimeout(flushDownloadProgress, remaining);
      }
  };

  const disposeDownloadProgressReporter = () => {
      pendingDownloadProgress = null;
      if (pendingDownloadProgressTimer) {
        clearTimeout(pendingDownloadProgressTimer);
        pendingDownloadProgressTimer = null;
      }
  };
  
  try {
    // 1. 获取草稿信息 (10%)
    if (progressCallback) {
      progressCallback(5, i18next.t('getting_draft_info'));
    }

    // 使用渲染进程传来的脚本，避免在 worker 内触发前端逻辑
    if (!scriptFromRenderer) {
      const errMsg = '未提供草稿脚本，请在前端查询后再下载';
      logger.error('[DLTRACE][Worker] scriptFromRenderer missing', {
        draftId,
        draftName
      });
      throw new Error(errMsg);
    }

    const parsed = typeof scriptFromRenderer === 'string'
      ? JSON.parse(scriptFromRenderer)
      : scriptFromRenderer;
    script = parsed;
    logger.info(`成功使用前端提供的脚本，草稿 ${draftName}。`);

    const stagedLocal = await stabilizeLocalRemoteUrls(script);
    if (stagedLocal.normalized > 0) {
      logger.info(`已规范化本地素材路径: ${stagedLocal.normalized} 个`);
    }
    if (stagedLocal.missingLocalFiles > 0) {
      logger.warn(`检测到失效本地临时素材路径: ${stagedLocal.missingLocalFiles} 个（可能由系统清理临时文件导致）`);
    }

    // 2. 准备草稿文件和文件夹 (20%)
    if (progressCallback) {
      progressCallback(10, i18next.t('preparing_draft_files'));
    }
    
    logger.info(`任务 ${taskId} 状态更新为 'processing'：正在准备草稿文件。`);
    
    // 删除可能已存在的草稿文件夹
    const draftPath = path.join(draftFolder, draftName);
    if (fs.existsSync(draftPath)) {
      logger.warn(`删除已存在的草稿文件夹: ${draftPath}`);
      try {
        await fs.promises.rm(draftPath, { recursive: true, force: true });
      } catch (error) {
        // 如果是目录非空错误，尝试单独处理.backup目录
        if (error.code === 'ENOTEMPTY') {
          logger.warn(`无法删除目录，尝试单独处理问题文件夹: ${error.message}`);
          
          // 尝试先删除.backup目录中的文件
          const backupDir = path.join(draftPath, '.backup');
          if (fs.existsSync(backupDir)) {
            try {
              // 读取.backup目录中的所有文件
              const files = await fs.promises.readdir(backupDir);
              
              // 逐个删除文件
              for (const file of files) {
                try {
                  await fs.promises.unlink(path.join(backupDir, file));
                } catch (unlinkError) {
                  logger.error(`无法删除文件 ${file}: ${unlinkError.message}`);
                }
              }
              
              // 再次尝试删除.backup目录
              await fs.promises.rmdir(backupDir);
              
              // 最后尝试删除整个草稿文件夹
              await fs.promises.rm(draftPath, { recursive: true, force: true });
            } catch (innerError) {
              logger.error(`处理.backup目录失败: ${innerError.message}`);
              // 提示用户关闭剪映再次下载
              if (progressCallback) {
                progressCallback(-1, i18next.t('close_jianying_and_retry', { error: innerError.message }) || 
                  '删除草稿文件夹失败，请关闭剪映后再次尝试下载。');
              }
              return { success: false, error: innerError.message, message: '请关闭剪映后再次尝试下载' };
            }
          }
        } else {
          logger.error(`删除草稿文件夹失败: ${error.message}`);
          // 提示用户关闭剪映再次下载
          if (progressCallback) {
            progressCallback(-1, i18next.t('close_jianying_and_retry', { error: error.message }) || 
              '删除草稿文件夹失败，请关闭剪映后再次尝试下载。');
          }
          return { success: false, error: error.message, message: '请关闭剪映后再次尝试下载' };
        }
      }
    }

    logger.info(`开始保存草稿: ${draftName}`);
    
    // 根据配置选择不同的模板目录
    const templateDir = is_capcut ? "template" : "template_jianying";
    
    // 获取应用程序根目录
    const appRoot = path.join(__dirname, '..');
    
    // 复制模板目录到草稿路径
    const templatePath = path.join(appRoot, templateDir);
    logger.info(`复制模板目录 ${templatePath} 到草稿路径 ${draftPath}`);
    await copyFolderRecursive(templatePath, draftPath);
    logger.info(`模板目录复制完成`);
    const draftCoverPath = path.join(draftPath, 'draft_cover.jpg');
    
    if (progressCallback) {
      progressCallback(20, i18next.t('collecting_download_tasks'));
    }
    
    // 3. 收集下载任务 (30%)
    let fileIdCounter = 1;
    const taskIndexByKey = new Map();
    const isLocalLikePath = (value) => typeof value === 'string'
      && (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('file://'));
    const isHttpLikeUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);
    const normalizeLocalPath = (value) => {
      if (typeof value !== 'string' || !value) {
        return '';
      }
      if (!value.startsWith('file://')) {
        return value;
      }
      try {
        const decoded = decodeURI(value);
        if (process.platform === 'win32' && /^file:\/\/\/[a-zA-Z]:/.test(decoded)) {
          return decoded.slice('file:///'.length);
        }
        return decoded.replace(/^file:\/\//, '');
      } catch {
        return value.replace(/^file:\/\//, '');
      }
    };
    const shouldReferenceLocalSource = (remoteUrl) => isLocalLikePath(remoteUrl) && !isHttpLikeUrl(remoteUrl);
    const resolveLocalSourcePath = (remoteUrl) => {
      if (!shouldReferenceLocalSource(remoteUrl)) {
        return '';
      }
      return normalizeLocalPath(remoteUrl);
    };
    const assignMaterialSourcePath = (material, localSourcePath) => {
      if (!material || !localSourcePath) {
        return;
      }
      material.path = localSourcePath;
      material.replace_path = localSourcePath;
    };
    
    const addTask = (type, material, remoteUrl, localPath, downloadOptions = {}) => {
        if (!remoteUrl) {
            logger.warn(`文件 ${material.material_name || material.name} 没有 remote_url，跳过下载。`);
            return;
        }

        const localSourcePath = resolveLocalSourcePath(remoteUrl);
        if (localSourcePath && !downloadOptions.forceDownload) {
            assignMaterialSourcePath(material, localSourcePath);
            const exists = fs.existsSync(localSourcePath);
            logger.info(`[DLTRACE][Worker] 本地素材直接引用，跳过下载`, {
              type,
              materialName: material.material_name || material.name || '',
              localSourcePath,
              exists
            });
            if (!exists) {
              logger.warn(`[DLTRACE][Worker] 本地素材路径当前不存在，但仍按本地引用写入草稿`, {
                type,
                materialName: material.material_name || material.name || '',
                localSourcePath
              });
            }
            return;
        }

        const contextKey = downloadOptions.context || 'default';
        const taskKey = `${remoteUrl}::${contextKey}`;
        const existingTask = taskIndexByKey.get(taskKey);

        if (existingTask) {
            if (localPath && existingTask.localPath !== localPath && !existingTask.aliasLocalPaths.includes(localPath)) {
                existingTask.aliasLocalPaths.push(localPath);
            }
            return;
        }

        const task = {
            id: fileIdCounter++,
            type: type,
            url: remoteUrl,
            localPath: localPath,
            aliasLocalPaths: [],
            material: material,
            downloadOptions: downloadOptions,
            total: 0,   // 稍后获取文件大小（字节）
            downloaded: 0,  // 初始下载量（字节）
            status: 'queued',  // queued | downloading | completed | failed
        };

        downloadTasks.push(task);
        taskIndexByKey.set(taskKey, task);
    };

    const coverCandidates = [];
    const appendCoverCandidate = (value) => {
      if (Array.isArray(value)) {
        value.forEach(appendCoverCandidate);
        return;
      }
      if (typeof value !== 'string') {
        return;
      }
      const trimmed = value.trim();
      if (!trimmed || coverCandidates.includes(trimmed)) {
        return;
      }
      coverCandidates.push(trimmed);
    };

    appendCoverCandidate(cover);
    appendCoverCandidate(script?.cover);
    appendCoverCandidate(script?.cover_url);
    appendCoverCandidate(script?.coverUrl);
    appendCoverCandidate(script?.draft_cover);
    appendCoverCandidate(script?.draftCover);

    const explicitCoverSource = coverCandidates.find((candidate) =>
      isHttpLikeUrl(candidate) || shouldReferenceLocalSource(candidate)
    );
    if (explicitCoverSource) {
      logger.info(`[DLTRACE][Worker] 收到草稿封面，将写入 ${draftCoverPath}`);
      addTask(
        'cover',
        { material_name: 'draft_cover.jpg', name: 'draft_cover.jpg' },
        explicitCoverSource,
        draftCoverPath,
        { retry: 3, timeout: 180000, context: 'draft_cover', forceDownload: true }
      );
    }

    // 收集音频下载任务
    const audios = script.materials.audios;
    if (audios && audios.length > 0) {
      for (const audio of audios) {
        const remoteUrl = audio.remote_url;
        const materialName = audio.name;
        const localPath = buildAssetPath(draftFolder, draftName, "audio", materialName);
        // 使用辅助函数构建路径
        if (draftFolder && remoteUrl && !shouldReferenceLocalSource(remoteUrl)) {
          audio.path = localPath;
          audio.replace_path = localPath;
        }
        
        addTask('audio', audio, remoteUrl, localPath);
      }
    }
    
    // 收集视频和图片下载任务
    const videos = script.materials.videos;
    if (videos && videos.length > 0) {
      for (const video of videos) {
        const remoteUrl = video.remote_url;
        const materialName = video.material_name; // 注意：视频/图片用的是 material_name
        
        if (video.type === 'photo') {
          const localPath = buildAssetPath(draftFolder, draftName, "image", materialName);
          
          // 更新草稿路径
          if (draftFolder && remoteUrl && !shouldReferenceLocalSource(remoteUrl)) {
            video.path = localPath;
            video.replace_path = localPath;
          }
          
          addTask('image', video, remoteUrl, localPath);
        } else if (video.type === 'video') {
          const localPath = buildAssetPath(draftFolder, draftName, "video", materialName);

          // 更新草稿路径
          if (draftFolder && remoteUrl && !shouldReferenceLocalSource(remoteUrl)) {
            video.path = localPath;
            video.replace_path = localPath;
          }
          
          addTask('video', video, remoteUrl, localPath);
        }
      }
    }

    // 收集花字特效下载任务
    const effects = script.materials.filters;
    if (effects && effects.length > 0) {
      for (const effect of effects) {
        if (effect.type === 'TextEffect') {
          const effectId = effect.effect_id;
          const localPath = path.join(draftPath, "assets", "artistEffect", `${effectId}.zip`);

          // 更新草稿路径
          effect.path = buildAssetPath(draftFolder, draftName, "artistEffect", effectId);
          
          const downloadUrl = await getArtistEffectDownloadUrl(effectId);
          
          if (downloadUrl) {
            // 注意：这里需要传递下载所需的额外选项
            addTask(
              'text_effect', 
              effect, 
              downloadUrl, 
              localPath, 
              { retry: 3, timeout: 180000, context: 'text_artist' } // 额外选项
            );
          }
        }
      }
    }

    // 收集文本模板下载任务
    const textTemplates = script.materials.text_templates;
    if (textTemplates && textTemplates.length > 0) {
      for (const template of textTemplates) {
        const effectId = template.effect_id;
        const downloadUrl = `https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/text_template/${effectId}/${effectId}.zip`;
        const localPath = path.join(draftPath, "assets", "textTemplate", `${effectId}.zip`);

        // 注意：这里需要传递下载所需的额外选项
        addTask(
            'text_template', 
            template, 
            downloadUrl, 
            localPath, 
            { retry: 3, timeout: 180000, context: 'text_template' } // 额外选项
        );
      }
    }

    // --- 新增：收集预设/复合片段里的下载任务 (script.materials.drafts) ---
    const nestedDrafts = script.materials.drafts;
    if (nestedDrafts && nestedDrafts.length > 0) {
      for (const draftItem of nestedDrafts) {
        // 访问嵌套的 draft 对象，兼容对象或字典的取值方式
        const nestedDraft = draftItem.draft; // 假设JS中访问嵌套对象可以直接用 .draft
        if (!nestedDraft) {
          continue;
        }

        const materials = nestedDraft.materials;
        if (!materials) {
          continue;
        }

        // 💡 注意：在 nested draft 中，路径使用 .path 和 .replace_path 都可以，这里我们统一用 .path 
        // 并在 draftFolder 存在时更新。

        // 1. 收集嵌套音频下载任务
        const nestedAudios = materials.audios;
        if (nestedAudios && nestedAudios.length > 0) {
          for (const audio of nestedAudios) {
            const remoteUrl = audio.remote_url;
            // material_name 在 Python 中兼容了 name，这里也兼容
            const materialName = audio.material_name || audio.name; 
            const localPath = buildAssetPath(draftFolder, draftName, "audio", materialName);

            if (draftFolder && materialName && remoteUrl && !shouldReferenceLocalSource(remoteUrl)) {
              // 更新素材路径，为后续草稿写入做准备
              audio.path = localPath; 
              audio.replace_path = localPath;
            }

            if (!remoteUrl) {
              logger.warn(`[Nested Draft] 音频文件 ${materialName} 没有 remote_url，跳过下载。`);
              continue;
            }

            // 注意：这里需要确保 localPath 是实际下载路径，
            // 假设 os.path.join(current_dir, f"{draft_id}/assets/audio/{material_name}")
            // 等同于在你的 addTask 中使用 localPath 作为最终路径。
            addTask('audio', audio, remoteUrl, localPath);
          }
        }

        // 2. 收集嵌套视频和图片下载任务
        const nestedVideos = materials.videos;
        if (nestedVideos && nestedVideos.length > 0) {
          for (const video of nestedVideos) {
            const remoteUrl = video.remote_url;
            const materialName = video.material_name;
            // Python 代码中是 material_type，这里兼容 JS 原始代码的 type
            const videoType = video.material_type || video.type; 

            if (!remoteUrl) {
              logger.warn(`[Nested Draft] 视频/图片文件 ${materialName} 没有 remote_url，跳过下载。`);
              continue;
            }

            if (videoType === 'photo') {
              const localPath = buildAssetPath(draftFolder, draftName, "image", materialName);
              if (draftFolder && materialName && remoteUrl && !shouldReferenceLocalSource(remoteUrl)) {
                video.path = localPath;
                video.replace_path = localPath;
              }
              addTask('image', video, remoteUrl, localPath);
              
            } else if (videoType === 'video') {
              const localPath = buildAssetPath(draftFolder, draftName, "video", materialName);
              if (draftFolder && materialName && remoteUrl && !shouldReferenceLocalSource(remoteUrl)) {
                video.path = localPath;
                video.replace_path = localPath;
              }
              addTask('video', video, remoteUrl, localPath);
            }
          }
        }

        // 3. 收集嵌套花字特效下载任务
        const nestedEffects = materials.filters;
        if (nestedEffects && nestedEffects.length > 0) {
          for (const effect of nestedEffects) {
            // 假设 TextEffect 是一个可识别的 type 字段
            if (effect.type === 'TextEffect') {
              const effectId = effect.effect_id;
              
              // 更新草稿路径
              effect.path = buildAssetPath(draftFolder, draftName, "artistEffect", effectId);
              
              // 实际下载路径
              const localZipPath = path.join(draftPath, "assets", "artistEffect", `${effectId}.zip`);

              // 异步获取下载链接
              const downloadUrl = await getArtistEffectDownloadUrl(effectId);
              
              if (downloadUrl) {
                addTask(
                  'text_effect', 
                  effect, 
                  downloadUrl, 
                  localZipPath, 
                  { retry: 3, timeout: 180000, context: 'text_artist' }
                );
              } else {
                logger.warn(`[Nested Draft] 花字特效 ${effectId} 获取下载链接失败，跳过下载。`);
              }
            }
          }
        }

        // 4. 收集嵌套文本模板下载任务
        const nestedTextTemplates = materials.text_templates;
        if (nestedTextTemplates && nestedTextTemplates.length > 0) {
          for (const template of nestedTextTemplates) {
            const effectId = template.effect_id;
            if (!effectId) continue;
            
            const downloadUrl = `https://oss-jianying-resource.oss-cn-hangzhou.aliyuncs.com/text_template/${effectId}/${effectId}.zip`;
            const localZipPath = path.join(draftPath, "assets", "textTemplate", `${effectId}.zip`);

            // 文本模板不需要提前更新 path，下载完成后会解压到对应目录
            
            addTask(
                'text_template', 
                template, 
                downloadUrl, 
                localZipPath, 
                { retry: 3, timeout: 180000, context: 'text_template' }
            );
          }
        }
      }
    }

    logger.info(`任务 ${taskId} 进度10%：共收集到 ${downloadTasks.length} 个下载任务。`);
    if (progressCallback) {
      progressCallback(30, i18next.t('start_downloading', { count: downloadTasks.length }));
    }

    // 并发执行所有下载任务
    const downloadedPaths = [];
    const failedDownloads = [];

    if (downloadTasks.length > 0) {
      logger.info(`开始并发下载 ${downloadTasks.length} 个文件...`);
      
      // 使用Promise.all并发下载，最大并发数为4
      // 这里简化处理，实际可能需要更复杂的并发控制
      const batchSize = 4;
      const batches = [];
      
      for (let i = 0; i < downloadTasks.length; i += batchSize) {
        batches.push(downloadTasks.slice(i, i + batchSize));
      }

      // 不再在正式下载前同步预探测所有文件大小，避免 HEAD/Range 失败拖慢启动速度。
      reportDownloadProgress(30, i18next.t('download_tasks_ready'), downloadTasks, { force: true });
      
      for (const batch of batches) {
        const promises = batch.map(task => {
          return (async () => {
            try {
                // 1. 更新状态为 downloading
                task.status = 'downloading';
                reportDownloadProgress(30, i18next.t('downloading'), downloadTasks);
              
                // 2. 执行下载，传入实时回调
                const onTaskProgress = (downloadedBytes, totalBytes) => {
                    task.downloaded = downloadedBytes;
                    if (totalBytes > 0) task.total = totalBytes; 
                    task.status = 'downloading';
                    reportDownloadProgress(30, i18next.t('downloading'), downloadTasks);
                };

                if (shouldUseElectronSessionDownload(task.url)) {
                    logger.info(`[DLTRACE][Worker] 使用 Electron session 下载素材: ${task.url}`);
                    await downloadViaElectronSession(
                        task.url,
                        task.localPath,
                        onTaskProgress,
                        task.downloadOptions.timeout
                    );
                } else {
                    await downloader.downloadFile(
                        task.url, 
                        task.localPath, 
                        onTaskProgress,
                        task.downloadOptions.retry,
                        task.downloadOptions.timeout,
                        task.downloadOptions.context
                    );
                }
              
              // 3. 下载成功逻辑
              let finalSize = 0;
              
              // 使用异步 stat 获取最终文件大小，并确保文件存在
              try {
                  const stats = await fs.promises.stat(task.localPath);
                  finalSize = stats.size;
              } catch (statError) {
                  // 如果下载成功返回，但文件不存在 (ENOENT)，视为下载任务最终失败
                  // 这样会将错误捕获到外层 catch 块，并加入 failedDownloads 列表
                  statError.message = `Download succeeded, but final file check failed: ${statError.message}`;
                  throw statError; 
              }

              task.downloaded = finalSize;
              task.total = finalSize; 
              task.status = 'completed';
              downloadedPaths.push(task.localPath);

              if (Array.isArray(task.aliasLocalPaths) && task.aliasLocalPaths.length > 0) {
                await Promise.all(task.aliasLocalPaths.map(async aliasPath => {
                  if (!aliasPath || aliasPath === task.localPath) {
                    return;
                  }
                  await fs.promises.mkdir(path.dirname(aliasPath), { recursive: true });
                  await fs.promises.copyFile(task.localPath, aliasPath);
                }));
              }
              
              reportDownloadProgress(30, i18next.t('downloading'), downloadTasks, { force: true });

              return { success: true, url: task.url };
            } catch (error) {
              // 标记失败
              logger.error(`任务 ${taskId}：下载 ${task.type} 文件失败: ${task.url}`, error);
              task.status = 'failed'; 
              failedDownloads.push({ url: task.url, error: error.message });
              
              // 报告失败，继续处理其他文件
              reportDownloadProgress(30, i18next.t('downloading_with_errors'), downloadTasks, { force: true });

              return { success: false, url: task.url };
            }
          })();
        });
        
        await Promise.all(promises);
      }
      
      logger.info(`任务 ${taskId}：并发下载完成，共下载 ${downloadedPaths.length} 个文件。`);
    }

    // 4. 解压和清理文件 (60% - 70%)
    logger.info(`任务 ${taskId} 进度60%：正在进行文件解压和清理。`);

    const cleanupTasks = downloadTasks
        .filter(task => task.status === 'completed' && 
                      (task.downloadOptions.context === 'text_artist' || task.downloadOptions.context === 'text_template'));

    if (cleanupTasks.length > 0) {
        await Promise.all(cleanupTasks.map(async (task) => {
            const isArtistEffectZip = task.downloadOptions.context === 'text_artist';
            const isTextTemplate = task.downloadOptions.context === 'text_template';

            try {
                if (isArtistEffectZip) {
                    // 使用导出的解压函数
                    await downloader.unzipAndCleanup(task.localPath); 
                }
                if (isTextTemplate) {
                    // 使用导出的解压函数
                    await downloader.unzipTextTemplate(task.localPath); 
                }
            } catch (cleanupError) {
                // 如果解压/清理失败，将其添加到失败列表，但不中断主流程
                logger.error(`任务 ${taskId}：解压/清理文件 ${task.localPath} 失败`, cleanupError);
                failedDownloads.push({ 
                    url: task.url, 
                    error: `Cleanup failed: ${cleanupError.message}`,
                    isCleanupError: true 
                });
            }
        }));
    }
    
    // 5. 本地更新媒体元数据 (70% - 78%)
    if (progressCallback) {
      progressCallback(70, i18next.t('updating_media_metadata'));
    }
    logger.info(`任务 ${taskId} 进度70%：正在本地更新媒体元数据。`);

    try {
      await updateMediaMetadata(script, {
        onProgress(message) {
          if (progressCallback && message) {
            progressCallback(70, message);
          }
        }
      });
    } catch (metadataError) {
      logger.error(`任务 ${taskId}：本地更新媒体元数据失败，将继续保存草稿。`, metadataError);
    }

    // 6. 保存草稿信息 (78% - 90%)
    if (progressCallback) {
      progressCallback(78, i18next.t('saving_draft_info'));
    }
    logger.info(`任务 ${taskId} 进度78%：正在保存草稿信息。`);
    
      const {
        draftDate: fixedDraftDate,
        millisTimestamp: currentMillisTimestamp,
        microsTimestamp: currentMicrosTimestamp,
        secondsTimestamp: currentSecondsTimestamp
      } = getFixedDraftTimestamps();
      const generatedDraftId = randomUUID().toUpperCase();
      logger.info(
        `草稿时间已刷新为当前时间: millis=${currentMillisTimestamp}, micros=${currentMicrosTimestamp}, seconds=${currentSecondsTimestamp}, draftId=${generatedDraftId}`
      );

      script.id = generatedDraftId;
      script.name = script.name || draftName;
      script.path = draftPath.replace(/\\/g, '/');
      script.update_time = currentSecondsTimestamp;

      const draftInfoPath = path.join(draftPath, 'draft_info.json');
      const draftContentPath = path.join(draftPath, 'draft_content.json');
      const serializedScript = JSON.stringify(script, null, 2);

      // 保存草稿信息到JSON文件
      await fs.promises.writeFile(draftInfoPath, serializedScript);
    logger.info(`草稿信息已保存到 ${draftName}/draft_info.json。`);
      try {
        await fs.promises.writeFile(draftContentPath, serializedScript);
        logger.info(`已同步 ${draftName}/draft_content.json。`);
      } catch (copyError) {
        logger.warn(`同步 draft_content.json 失败，将继续后续流程: ${copyError.message}`);
      }
    
    // 处理文本模板路径
    if (textTemplates && textTemplates.length > 0) {
      for (const template of textTemplates) {
        await processTextTemplatePaths(draftName, template.effect_id, draftPath, draftFolder);
      }
    }

    // 统一更新时间元数据
    try {
      const metaInfoPath = path.join(draftPath, 'draft_meta_info.json');
      let metaInfo = {};
      const effectiveDraftName = draftName || path.basename(draftPath);
      
      // 检查文件是否存在
      if (fs.existsSync(metaInfoPath)) {
        // 读取现有文件
        const metaInfoData = await fs.promises.readFile(metaInfoPath, 'utf8');
        metaInfo = JSON.parse(metaInfoData);
      }
      
      // 同步当前草稿身份，避免沿用模板草稿的旧路径/名称/ID。
      metaInfo.draft_id = script && script.id ? script.id : (metaInfo.draft_id || "");
      metaInfo.draft_name = effectiveDraftName;
        metaInfo.draft_fold_path = draftPath.replace(/\\/g, '/');
        metaInfo.draft_root_path = draftFolder.replace(/\\/g, '/');
      metaInfo.tm_draft_create = currentMicrosTimestamp;
      metaInfo.tm_draft_modified = currentMicrosTimestamp;
      
      // 保存更新后的文件
      await fs.promises.writeFile(
        metaInfoPath,
        JSON.stringify(metaInfo, null, 2)
      );

      await upsertDraftSettingsTimes(draftPath, currentSecondsTimestamp, currentSecondsTimestamp);
        await refreshTemplateIds(draftPath);

      await bumpDraftFolderMTime(draftPath, fixedDraftDate);
        await upsertRootMetaTimes(
        draftPath,
        script && script.id ? script.id : undefined,
        effectiveDraftName,
        currentMicrosTimestamp,
        currentMicrosTimestamp
      );
        await notifyDraftRootChanged(draftFolder);
      
        logger.info(`已更新 draft_meta_info.json、draft_settings、root_meta_info.json，并触发草稿根目录刷新。`);
      if (progressCallback) {
        progressCallback(90, i18next.t('finalizing'));
      }
    } catch (error) {
      logger.error(`更新 draft_meta_info.json 失败:`, error);
      if (progressCallback) {
        progressCallback(-1, i18next.t('update_meta_info_failed', { error: error.message }));
      }
    }


    // ========== 新增的异常抛出逻辑 ==========
    if (failedDownloads.length > 0) {
        const total = downloadTasks.length;
        const failedCount = failedDownloads.length;
        const failedUrls = failedDownloads.map(f => `  - URL: ${f.url}\n    Error: ${f.error}`).join('\n');
        
        const errorMessage = `**部分文件下载失败！**\n总任务数: ${total}\n失败数: ${failedCount}\n\n失败列表:\n${failedUrls}`;
        
        logger.error(`任务 ${taskId}：最终下载失败，将抛出异常。\n${errorMessage}`);
        
        // 抛出包含失败列表的异常
        throw new Error(errorMessage);
    }
    
    // 更新任务状态 - 完成
    logger.info(`任务 ${taskId} 已完成`);
    if (progressCallback) {
      progressCallback(100, i18next.t('download_complete'));
    }
    disposeDownloadProgressReporter();
    return { success: true, message: i18next.t('download_complete') };

  } catch (error) {
    // 更新任务状态 - 失败
    disposeDownloadProgressReporter();
    logger.error(`保存草稿 ${draftName} 任务 ${taskId} 失败: ${error?.message || ''}`);
    logger.error('[DLTRACE][Worker] saveDraftBackground:catch', {
      draftId,
      draftName,
      taskId: taskId || '',
      message: error?.message || '',
      stack: error?.stack || ''
    });
    if (progressCallback) {
      progressCallback(-1, i18next.t('processing_failed', { error: error.message }));
    }
    return { success: false, error: error.message, message: i18next.t('processing_failed', { error: error.message }) };
  }
}

async function processTextTemplatePaths(draftName, effectId, draftPath, draftFolder) {
  try {
    const processedPathsFile = path.join(draftPath, "assets", "textTemplate", effectId, "processed_paths.json");
    if (!fs.existsSync(processedPathsFile)) {
      logger.warn(`processed_paths.json文件不存在: ${processedPathsFile}`);
      return;
    }

    const processedPaths = JSON.parse(await fs.promises.readFile(processedPathsFile, 'utf-8'));
    const draftInfoPath = path.join(draftPath, "draft_info.json");

    if (!fs.existsSync(draftInfoPath)) {
      logger.warn(`draft_info.json文件不存在: ${draftInfoPath}`);
      return;
    }

    let draftInfoContent = await fs.promises.readFile(draftInfoPath, 'utf-8');

    for (const pathItem of processedPaths) {
      if (pathItem.original_path && pathItem.target_path) {
        const originalPath = pathItem.original_path;
        const targetPath = pathItem.target_path;
        const newPath = `${draftFolder}/${draftName}/assets/textTemplate/${effectId}/${targetPath}`.replace(/\\/g, '/');
        const findPattern = new RegExp(originalPath.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        draftInfoContent = draftInfoContent.replace(findPattern, newPath);
      }
    }

    await fs.promises.writeFile(draftInfoPath, draftInfoContent, 'utf-8');
    logger.info(`成功处理文本模板 ${effectId} 的路径`);
  } catch (e) {
    logger.error(`处理文本模板路径时出错: ${e.message}`, e);
  }
}

module.exports = {
  saveDraftBackground,
  buildAssetPath
};

// 新增：触发草稿根目录的 mtime/ctime 变化
function getFixedDraftTimestamps() {
  const draftDate = new Date();
  const millisTimestamp = draftDate.getTime();
  return {
    draftDate,
    millisTimestamp,
    microsTimestamp: millisTimestamp * 1000,
    secondsTimestamp: Math.floor(millisTimestamp / 1000)
  };
}

async function refreshTemplateIds(draftPath) {
  for (const filename of ['template.tmp', 'template-2.tmp']) {
    const templatePath = path.join(draftPath, filename);
    if (!fs.existsSync(templatePath)) {
      continue;
    }
    try {
      const raw = await fs.promises.readFile(templatePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        parsed.id = randomUUID().toUpperCase();
        await fs.promises.writeFile(templatePath, JSON.stringify(parsed, null, 2), 'utf8');
      }
    } catch (error) {
      logger.warn(`刷新 ${filename} 的模板ID失败，将继续流程: ${error.message}`);
    }
  }
}

// 新增：触发草稿根目录的 mtime/ctime 变化
async function bumpDraftFolderMTime(draftPath, targetDate = getFixedDraftTimestamps().draftDate) {
  // 1) 尝试直接更新目录 mtime
  try {
    await fs.promises.utimes(draftPath, targetDate, targetDate);
  } catch (_) {}
  // 2) 创建并删除一个临时文件，更新目录的 mtime/ctime
  try {
    const tmp = path.join(draftPath, `.touch_${Date.now()}`);
    await fs.promises.writeFile(tmp, '');
    await fs.promises.unlink(tmp);
  } catch (_) {}
  // 3) 最后手段：原子重命名再改回，强制更新目录 ctime
  try {
    const parent = path.dirname(draftPath);
    const base = path.basename(draftPath);
    const bounce = path.join(parent, `${base}.__ren_bounce__`);
    await fs.promises.rename(draftPath, bounce);
    await fs.promises.rename(bounce, draftPath);
  } catch (_) {}
}

// 新增：同时触发父目录事件，确保目录监听器刷新排序
async function bumpParentDirectoryEvents(draftPath, targetDate = getFixedDraftTimestamps().draftDate) {
  const parentDir = path.dirname(draftPath);
  // 1) 更新父目录 mtime
  try {
    await fs.promises.utimes(parentDir, targetDate, targetDate);
  } catch (_) {}
  // 2) 在父目录创建并删除一个临时文件
  try {
    const tmp = path.join(parentDir, `.parent_touch_${Date.now()}`);
    await fs.promises.writeFile(tmp, '');
    await fs.promises.unlink(tmp);
  } catch (_) {}
  // 3) 再次执行对草稿目录的重命名-回滚，以确保父目录事件也被触发
  try {
    const base = path.basename(draftPath);
    const bounce = path.join(parentDir, `${base}.__parent_bounce__`);
    await fs.promises.rename(draftPath, bounce);
    await fs.promises.rename(bounce, draftPath);
  } catch (_) {}
}

// 在 worker 里通过主进程代理获取花字下载链接
async function getArtistEffectDownloadUrl(effectId) {
  if (!parentPort) throw new Error('parentPort not available');
  return new Promise((resolve, reject) => {
    const reqId = `artist:${effectId}:${Date.now()}`;
    const onMessage = (msg) => {
      if (msg && msg.type === 'artist-effect-url-response' && msg.reqId === reqId) {
        parentPort.off('message', onMessage);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.url);
      }
    };
    parentPort.on('message', onMessage);
    parentPort.postMessage({ type: 'artist-effect-url-request', effectId, reqId });
    setTimeout(() => {
      parentPort.off('message', onMessage);
      reject(new Error('artist-effect-url timeout'));
    }, 15000);
  });
}

async function bounceDraftByMoving(draftPath) {
    const fs = require('fs');
    const fsp = fs.promises;
    const path = require('path');

    const parentDir = path.dirname(draftPath);
    const grandParentDir = path.dirname(parentDir);
    const baseName = path.basename(draftPath);
    const tmpPath = path.join(grandParentDir, `${baseName}.tmp_move_${Date.now()}`);
    logger.info(`bounceDraftByMoving: ${draftPath} -> ${tmpPath}`);
    const sleep = ms => new Promise(res => setTimeout(res, ms));

    try {
        // 第一次剪切：draftPath -> tmpPath
        await fsp.rename(draftPath, tmpPath);
        await sleep(2000);

        // 第二次剪切：tmpPath -> draftPath
        await fsp.rename(tmpPath, draftPath);
    } catch (_) {
        // 尝试兜底恢复（若仍在 tmpPath）
        try {
            const stat = await fsp.stat(tmpPath);
            if (stat && stat.isDirectory()) {
                await sleep(300);
                await fsp.rename(tmpPath, draftPath);
            }
        } catch (_) {}
    }
}

async function upsertDraftSettingsTimes(draftFolderPath, draftCreateSeconds, draftLastEditSeconds) {
    const draftSettingsPath = path.join(draftFolderPath, 'draft_settings');

    let content = '';
    try {
        content = await fs.promises.readFile(draftSettingsPath, 'utf8');
    } catch (_) {
        content = '[General]\n';
    }

    let lines = content.replace(/\r\n/g, '\n').split('\n');
    if (!lines.length || (lines.length === 1 && lines[0] === '')) {
        lines = ['[General]'];
    }

    if (!lines.some(line => line.trim() === '[General]')) {
        lines.unshift('[General]');
    }

    const upsertLine = (key, value) => {
        const prefix = `${key}=`;
        const idx = lines.findIndex(line => line.startsWith(prefix));
        const nextLine = `${prefix}${value}`;
        if (idx >= 0) {
            lines[idx] = nextLine;
        } else {
            const generalIdx = lines.findIndex(line => line.trim() === '[General]');
            const insertAt = generalIdx >= 0 ? generalIdx + 1 : lines.length;
            lines.splice(insertAt, 0, nextLine);
        }
    };

    upsertLine('draft_create_time', draftCreateSeconds);
    upsertLine('draft_last_edit_time', draftLastEditSeconds);

    const normalized = `${lines.join('\n').replace(/\n+$/g, '')}\n`;
    await fs.promises.writeFile(draftSettingsPath, normalized, 'utf8');
}

async function upsertRootMetaTimes(draftFolderPath, targetDraftId, targetDraftName, tmCreateMillis, tmModifiedMicros) {
    const rootMetaPath = path.join(path.dirname(draftFolderPath), 'root_meta_info.json');

    let json;
    try {
        json = JSON.parse(await fs.promises.readFile(rootMetaPath, 'utf8'));
    } catch (_) {
        json = { all_draft_store: [] };
    }

    const store = Array.isArray(json.all_draft_store) ? [...json.all_draft_store] : [];

    if (!targetDraftId) {
        try {
            const info = JSON.parse(await fs.promises.readFile(path.join(draftFolderPath, 'draft_info.json'), 'utf8'));
            if (info && typeof info === 'object' && info.id) {
                targetDraftId = info.id;
            }
        } catch (_) {}
    }

    const normalizedDraftFolderPath = draftFolderPath.replace(/\\/g, '/');
    const draftJsonPath = path.join(draftFolderPath, 'draft_info.json').replace(/\\/g, '/');
    const draftCoverPath = path.join(draftFolderPath, 'draft_cover.jpg').replace(/\\/g, '/');
    const baseRootPath = path.dirname(draftFolderPath).replace(/\\/g, '/');
    const effectiveName = targetDraftName || path.basename(draftFolderPath);

    const findIdxBy = predicate => store.findIndex(predicate);
    let idx = findIdxBy(i =>
        i.draft_fold_path === normalizedDraftFolderPath ||
        i.draft_json_file === draftJsonPath
    );
    if (idx < 0) {
        idx = findIdxBy(i => i.draft_name === effectiveName);
    }
    if (idx < 0 && targetDraftId) {
        idx = findIdxBy(i => i.draft_id === targetDraftId);
    }

    const existingEntry = idx >= 0 ? store[idx] : {};
    const nextEntry = {
        draft_cloud_last_action_download: false,
        draft_cloud_purchase_info: "",
        draft_cloud_template_id: "",
        draft_cloud_tutorial_info: "",
        draft_cloud_videocut_purchase_info: "",
        draft_cover: draftCoverPath,
        draft_fold_path: normalizedDraftFolderPath,
        draft_id: targetDraftId || existingEntry.draft_id || "",
        draft_is_ai_shorts: false,
        draft_is_invisible: false,
        draft_json_file: draftJsonPath,
        draft_name: effectiveName,
        draft_new_version: "",
        draft_root_path: baseRootPath,
        draft_timeline_materials_size: 0,
        draft_type: "",
        tm_draft_cloud_completed: "",
        tm_draft_cloud_modified: 0,
        tm_draft_create: tmCreateMillis,
        tm_draft_modified: tmModifiedMicros,
        tm_draft_removed: 0,
        tm_duration: 0,
        ...existingEntry
    };
    nextEntry.draft_cover = draftCoverPath;
    nextEntry.draft_fold_path = normalizedDraftFolderPath;
    nextEntry.draft_id = targetDraftId || nextEntry.draft_id || "";
    nextEntry.draft_json_file = draftJsonPath;
    nextEntry.draft_name = effectiveName;
    nextEntry.draft_root_path = baseRootPath;
    nextEntry.tm_draft_create = tmCreateMillis;
    nextEntry.tm_draft_modified = tmModifiedMicros;
    nextEntry.tm_draft_removed = 0;

    const deduped = store.filter((item, itemIndex) => {
        if (itemIndex === idx) {
            return false;
        }
        return !(
            item.draft_fold_path === normalizedDraftFolderPath ||
            item.draft_json_file === draftJsonPath ||
            item.draft_name === effectiveName ||
            (targetDraftId && item.draft_id === targetDraftId)
        );
    });
    deduped.unshift(nextEntry);

    json.all_draft_store = deduped;
    json.draft_ids = deduped.length;
    json.root_path = baseRootPath;

    await fs.promises.writeFile(
        rootMetaPath,
        JSON.stringify(json, null, 2),
        'utf8'
    );
}

async function notifyDraftRootChanged(rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    const touchedPaths = [];
    const rootMetaPath = path.join(resolvedRoot, 'root_meta_info.json');
    const now = new Date();

    await fs.promises.mkdir(resolvedRoot, { recursive: true });

    for (const candidate of [resolvedRoot, rootMetaPath]) {
        try {
            await fs.promises.utimes(candidate, now, now);
            touchedPaths.push(candidate);
        } catch (_) {}
    }

    const triggerPath = path.join(resolvedRoot, `.refresh_trigger_${Date.now()}`);
    try {
        await fs.promises.writeFile(triggerPath, String(Date.now()), 'utf8');
        touchedPaths.push(triggerPath);
        await new Promise(resolve => setTimeout(resolve, 150));
    } finally {
        await fs.promises.unlink(triggerPath).catch(() => {});
    }

    logger.info(`notifyDraftRootChanged touched=${JSON.stringify(touchedPaths)}`);
}
