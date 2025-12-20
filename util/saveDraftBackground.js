const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { promisify } = require('util');
const axios = require('axios');
const downloader = require('./downloader');
const { log } = require('console');
const i18next = require('i18next');
const logger = require('../src/shared/logger');
const { parentPort } = require('worker_threads'); // 新增

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
  // 确保目标文件夹存在
  if (!fs.existsSync(destination)) {
    await fs.promises.mkdir(destination, { recursive: true });
  }

  // 读取源文件夹中的所有文件和子文件夹
  const entries = await fs.promises.readdir(source, { withFileTypes: true });

  // 遍历并复制每个文件和子文件夹
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      // 递归复制子文件夹
      await copyFolderRecursive(srcPath, destPath);
    } else {
      // 复制文件
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
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
async function saveDraftBackground(draftId, draftName, draftFolder, taskId, progressCallback, is_capcut, apiHost, scriptFromRenderer) {
  let script;
  // 如果draftName为空，就应该设置为draftId
  draftName = draftName || draftId;

  const draftPath = path.join(draftFolder, draftName);
  const downloadTasks = []; // 存储所有下载任务的完整列表

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
      const { overallProgress, totalBytes, downloadedBytes } = calculateOverallProgress(tasks);
      
      // 下载部分占 40% (从 30% 到 70%)
      const downloadSectionProgress = overallProgress * 0.40; 
      const finalProgress = Math.floor(baseProgress + downloadSectionProgress);

      const totalMB = totalBytes / 1024 / 1024;
      const downloadedMB = downloadedBytes / 1024 / 1024;
      
      const statusText = `${message} (${downloadedMB.toFixed(2)}MB / ${totalMB.toFixed(2)}MB)`;
      
      if (progressCallback) {
          progressCallback(finalProgress, statusText, tasks.map(task => ({
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
  
  try {
    // 1. 获取草稿信息 (10%)
    if (progressCallback) {
      progressCallback(5, i18next.t('getting_draft_info'));
    }

    // 使用渲染进程传来的脚本，避免在 worker 内触发前端逻辑
    if (!scriptFromRenderer) {
      const errMsg = '未提供草稿脚本，请在前端查询后再下载';
      throw new Error(errMsg);
    }

    const parsed = typeof scriptFromRenderer === 'string'
      ? JSON.parse(scriptFromRenderer)
      : scriptFromRenderer;
    script = parsed;
    logger.info(`成功使用前端提供的脚本，草稿 ${draftName}。`);

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
    
    if (progressCallback) {
      progressCallback(20, i18next.t('collecting_download_tasks'));
    }
    
    // 3. 收集下载任务 (30%)
    let fileIdCounter = 1;
    
    const addTask = (type, material, remoteUrl, localPath, downloadOptions = {}) => {
        if (!remoteUrl) {
            logger.warn(`文件 ${material.material_name || material.name} 没有 remote_url，跳过下载。`);
            return;
        }
        
        downloadTasks.push({
            id: fileIdCounter++,
            type: type,
            url: remoteUrl,
            localPath: localPath,
            material: material,
            downloadOptions: downloadOptions,
            total: 0,                   // 稍后获取文件大小（字节）
            downloaded: 0,              // 初始下载量（字节）
            status: 'downloading',          // pending | downloading | completed | failed
        });
    };

    // 收集音频下载任务
    const audios = script.materials.audios;
    if (audios && audios.length > 0) {
      for (const audio of audios) {
        const remoteUrl = audio.remote_url;
        const materialName = audio.name;
        const localPath = buildAssetPath(draftFolder, draftName, "audio", materialName);
        // 使用辅助函数构建路径
        if (draftFolder && remoteUrl) {
          audio.path = localPath;
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
          if (draftFolder && remoteUrl) {
            video.path = localPath;
          }
          
          addTask('image', video, remoteUrl, localPath);
        } else if (video.type === 'video') {
          const localPath = buildAssetPath(draftFolder, draftName, "video", materialName);

          // 更新草稿路径
          if (draftFolder && remoteUrl) {
            video.path = localPath;
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

            if (draftFolder && materialName && remoteUrl) {
              // 更新素材路径，为后续草稿写入做准备
              audio.path = localPath; 
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
              if (draftFolder && materialName && remoteUrl) {
                video.path = localPath;
                video.replace_path = localPath;
              }
              addTask('image', video, remoteUrl, localPath);
              const coverDraftId = (nestedDraft && typeof nestedDraft === 'object') ? (nestedDraft.id || nestedDraft.draft_id) : null;
              if (coverDraftId === "28D7F8DB-7861-49CB-B634-C116DE87AE69") {
                logger.info(`封面图片 ${materialName}`);
                const coverPath = path.join(draftPath, "draft_cover.jpg");
                addTask('image', video, remoteUrl, coverPath);
              }
              
            } else if (videoType === 'video') {
              const localPath = buildAssetPath(draftFolder, draftName, "video", materialName);
              if (draftFolder && materialName && remoteUrl) {
                video.path = localPath;
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
    let completedFiles = 0;
    const failedDownloads = [];

    if (downloadTasks.length > 0) {
      logger.info(`开始并发下载 ${downloadTasks.length} 个文件...`);
      
      // 使用Promise.all并发下载，最大并发数为16
      // 这里简化处理，实际可能需要更复杂的并发控制
      const batchSize = 16;
      const batches = [];
      
      for (let i = 0; i < downloadTasks.length; i += batchSize) {
        batches.push(downloadTasks.slice(i, i + batchSize));
      }
      
      // 预先获取所有文件大小 (并发进行)
      await Promise.all(downloadTasks.map(async task => {
          task.total = await downloader.getFileSize(task.url);
      }));
      
      // 更新一次进度，显示文件总大小
      sendProgress(30, i18next.t('download_tasks_ready'), downloadTasks);
      
      for (const batch of batches) {
        const promises = batch.map(task => {
          return (async () => {
            try {
                // 1. 更新状态为 downloading
                task.status = 'downloading';
                sendProgress(30, i18next.t('downloading'), downloadTasks);
              
                // 2. 执行下载，传入实时回调
                await downloader.downloadFile(
                    task.url, 
                    task.localPath, 
                    (downloadedBytes, totalBytes) => {
                        // 进度回调 (频繁触发)
                        task.downloaded = downloadedBytes;
                        // 实时更新 total (如果 totalBytes 在回调中更新)
                        if (totalBytes > 0) task.total = totalBytes; 
                        task.status = 'downloading';
                        // 限制 progressCallback 的调用频率以防性能问题，这里简化为每次都调用
                        sendProgress(30, i18next.t('downloading'), downloadTasks);
                    },
                    task.downloadOptions.retry,
                    task.downloadOptions.timeout,
                    task.downloadOptions.context
                );
              
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
              
              sendProgress(30, i18next.t('downloading'), downloadTasks);

              return { success: true, url: task.url };
            } catch (error) {
              // 标记失败
              logger.error(`任务 ${taskId}：下载 ${task.type} 文件失败: ${task.url}`, error);
              task.status = 'failed'; 
              failedDownloads.push({ url: task.url, error: error.message });
              
              // 报告失败，继续处理其他文件
              sendProgress(30, i18next.t('downloading_with_errors'), downloadTasks);

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
    
    // 5. 保存草稿信息 (70% - 90%)
    if (progressCallback) {
      progressCallback(70, i18next.t('saving_draft_info'));
    }
    logger.info(`任务 ${taskId} 进度70%：正在保存草稿信息。`);
    
    // 保存草稿信息到JSON文件
    await fs.promises.writeFile(
      path.join(draftPath, `draft_info.json`),
      JSON.stringify(script, null, 2)
    );
    logger.info(`草稿信息已保存到 ${draftName}/draft_info.json。`);
    
    // 处理文本模板路径
    if (textTemplates && textTemplates.length > 0) {
      for (const template of textTemplates) {
        await processTextTemplatePaths(draftName, template.effect_id, draftPath, draftFolder);
      }
    }

    // 读取并修改 draft_meta_info.json 文件
    try {
      const metaInfoPath = path.join(draftPath, 'draft_meta_info.json');
      let metaInfo = {};
      
      // 检查文件是否存在
      if (fs.existsSync(metaInfoPath)) {
        // 读取现有文件
        const metaInfoData = await fs.promises.readFile(metaInfoPath, 'utf8');
        metaInfo = JSON.parse(metaInfoData);
      }
      
      // 更新时间戳
      const currentMillisTimestamp = Date.now(); // 毫秒级时间戳
      logger.info(`当前毫秒级时间戳: ${currentMillisTimestamp}`);
      const currentMicrosTimestamp = currentMillisTimestamp * 1000; // 微秒级时间戳
      metaInfo.tm_draft_create = currentMicrosTimestamp;
      metaInfo.tm_draft_modified = currentMicrosTimestamp;
      
      // 保存更新后的文件
      await fs.promises.writeFile(
        metaInfoPath,
        JSON.stringify(metaInfo, null, 2)
      );

      // 新增：触发草稿目录及父目录的文件系统事件
      await bumpDraftFolderMTime(draftPath);
      upsertRootMetaTimes(draftPath, undefined, path.basename(draftPath), currentMicrosTimestamp, currentMicrosTimestamp);
      // pulseDraftSubdir(draftFolder)
      await bounceDraftByMoving(draftPath);
      await bumpParentDirectoryEvents(draftPath);
      
      logger.info(`已更新 draft_meta_info.json 中的时间戳，并触发目录与父目录事件。`);
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
    return { success: true, message: i18next.t('download_complete') };

  } catch (error) {
    // 更新任务状态 - 失败
    logger.error(`保存草稿 ${draftName} 任务 ${taskId} 失败: ${error?.message || ''}`);
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
async function bumpDraftFolderMTime(draftPath) {
  const now = new Date();
  // 1) 尝试直接更新目录 mtime
  try {
    await fs.promises.utimes(draftPath, now, now);
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
async function bumpParentDirectoryEvents(draftPath) {
  const parentDir = path.dirname(draftPath);
  const now = new Date();
  // 1) 更新父目录 mtime
  try {
    await fs.promises.utimes(parentDir, now, now);
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

function upsertRootMetaTimes(draftFolderPath, targetDraftId, targetDraftName, tmCreateMillis, tmModifiedMicros) {
    const fs = require('fs');
    const path = require('path');

    const rootMetaPath = path.join(path.dirname(draftFolderPath), 'root_meta_info.json');

    let json;
    try {
        json = JSON.parse(fs.readFileSync(rootMetaPath, 'utf8'));
    } catch (_) {
        json = { all_draft_store: [] };
    }

    const store = Array.isArray(json.all_draft_store) ? json.all_draft_store : [];

    if (!targetDraftId) {
        try {
            const info = JSON.parse(fs.readFileSync(path.join(draftFolderPath, 'draft_info.json'), 'utf8'));
            if (info && typeof info === 'object' && info.id) {
                targetDraftId = info.id;
            }
        } catch (_) {}
    }

    const draftJsonPath = path.join(draftFolderPath, 'draft_info.json');
    const draftCoverPath = path.join(draftFolderPath, 'draft_cover.jpg');
    const baseRootPath = path.dirname(draftFolderPath);
    const effectiveName = targetDraftName || path.basename(draftFolderPath);

    const idx = store.findIndex(i =>
        i.draft_id === targetDraftId ||
        i.draft_name === effectiveName ||
        i.draft_fold_path === draftFolderPath ||
        i.draft_json_file === draftJsonPath
    );

    if (idx >= 0) {
        store[idx].tm_draft_create = tmCreateMillis;
        store[idx].tm_draft_modified = tmModifiedMicros;
    } else {
        store.unshift({
            draft_cloud_last_action_download: false,
            draft_cloud_purchase_info: "",
            draft_cloud_template_id: "",
            draft_cloud_tutorial_info: "",
            draft_cloud_videocut_purchase_info: "",
            draft_cover: draftCoverPath,
            draft_fold_path: draftFolderPath,
            draft_id: targetDraftId || "",
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
            tm_duration: 0
        });
    }

    json.all_draft_store = store;
    fs.writeFileSync(rootMetaPath, JSON.stringify(json));
}
