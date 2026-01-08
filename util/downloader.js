const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { promisify } = require('util');
const AdmZip = require('adm-zip');
const { log } = require('console');
const logger = require('../src/shared/logger');

/**
 * 通过 HEAD 请求获取文件大小
 * @param {string} url - 文件URL
 * @returns {Promise<number>} - 文件大小（字节）
 */
async function getFileSize(url) {
    try {
        const response = await axios.head(url, {
            // 增强请求头，避免部分服务器拒绝 HEAD 请求
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000 // 10秒超时
        });
        const totalSize = parseInt(response.headers['content-length'] || 0, 10);
        return isNaN(totalSize) ? 0 : totalSize;
    } catch (error) {
        logger.error(`无法通过 HEAD 获取文件大小 ${url}: ${error.message}`);
        // 尝试 GET 请求获取 Content-Length (但不下载 body)
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Range': 'bytes=0-0' // 仅请求 1 字节，获取头部
                },
                timeout: 10000 
            });
            const totalSize = parseInt(response.headers['content-length'] || 0, 10);
            return isNaN(totalSize) ? 0 : totalSize;
        } catch (e) {
             return 0; // 无法获取大小，返回 0
        }
    }
}

/**
 * 下载文件到指定路径
 * @param {string} url - 文件URL或本地路径
 * @param {string} localFilename - 本地保存路径
 * @param {number} maxRetries - 最大重试次数
 * @param {number} timeout - 超时时间（毫秒）
 * @param {string} fileType - 文件类型，用于确定是否需要解压
 * @param {function} progressCallback - 进度回调函数 (downloadedBytes, totalBytes) => void
 * @returns {Promise<boolean>} - 是否下载成功
 * @throws {Error} - 如果所有重试都失败，则抛出包含失败信息的错误
 */
async function downloadFile(url, localFilename, progressCallback, maxRetries = 3, timeout = 180000, fileType = null) { 
    // 检查是否是本地文件路径
    if (fs.existsSync(url) && fs.statSync(url).isFile()) {
        // 是本地文件，直接复制
        const directory = path.dirname(localFilename);
        
        // 创建目标目录（如果不存在）
        if (directory && !fs.existsSync(directory)) {
            await fs.promises.mkdir(directory, { recursive: true });
            logger.debug(`Created directory: ${directory}`);
        }
        
        logger.debug(`Copying local file: ${url} to ${localFilename}`);
        const startTime = Date.now();
        
        // 复制文件
        await fs.promises.copyFile(url, localFilename);
        
        logger.debug(`Copy completed in ${(Date.now() - startTime) / 1000} seconds`);
        logger.debug(`File saved as: ${path.resolve(localFilename)}`);
        return true;
    }
    
    // 根据file_type判断文件类型
    const isArtistEffectZip = fileType === "text_artist";
    const isTextTemplate = fileType === "text_template";

    // 原有的下载逻辑
    // Extract directory part
    const directory = path.dirname(localFilename);

    let retries = 0;
    // 用于记录最后一次的错误信息
    let lastError = null; 
    
    while (retries < maxRetries) {
        try {
            if (retries > 0) {
                const waitTime = Math.pow(2, retries);  // 指数退避策略
                logger.debug(`Retrying in ${waitTime} seconds... (Attempt ${retries+1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
            
            logger.debug(`Downloading file: ${localFilename}`);
            
            // 创建目录（如果不存在）
            if (directory && !fs.existsSync(directory)) {
                await fs.promises.mkdir(directory, { recursive: true });
                logger.debug(`Created directory: ${directory}`);
            }

            // 增强请求头
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://www.coze.cn/',  // 更通用的 Referer
                'Accept': '*/*',  // 接受任何类型的内容
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Cache-Control': 'max-age=0',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            };

            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: timeout,
                headers: headers
            });
            
            let totalSize = parseInt(response.headers['content-length'] || 0);
            const writer = fs.createWriteStream(localFilename);
            
            let bytesWritten = 0;
            
            // 实时回调进度
            response.data.on('data', (chunk) => {
                bytesWritten += chunk.length;
                
                // 如果 totalSize 首次为 0 (例如 chunked transfer)，尝试使用 bytesWritten 作为估值，但主逻辑使用 0
                totalSize = parseInt(response.headers['content-length'] || 0); 
                progressCallback(bytesWritten, totalSize);
            });
            
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                response.data.pipe(writer);
            });
            
            // 下载完成后，再次确保回调完成状态
            const finalDownloadedSize = fs.statSync(localFilename).size;
            progressCallback(finalDownloadedSize, finalDownloadedSize);


            const isImage = /\.(png|jpg|jpeg|gif|bmp)$/i.test(url);

            // 保持原有的图片小文件 fallback 逻辑
            if (isImage && finalDownloadedSize < 2048) {
                logger.debug(`Downloaded image size is suspiciously small (${finalDownloadedSize} bytes). Attempting fallback download.`);
                const fallbackHeaders = {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                };
                const fallbackResponse = await axios({
                    method: 'GET',
                    url: url,
                    responseType: 'stream',
                    timeout: timeout,
                    headers: fallbackHeaders
                });
                const fallbackWriter = fs.createWriteStream(localFilename);
                fallbackResponse.data.pipe(fallbackWriter);
                await new Promise((resolve, reject) => {
                    fallbackWriter.on('finish', resolve);
                    fallbackWriter.on('error', reject);
                });

                const fallbackSize = fs.statSync(localFilename).size;
                 if (fallbackSize < 2048) {
                    throw new Error(`Fallback download also resulted in a small file (${fallbackSize} bytes).`);
            }
                progressCallback(fallbackSize, fallbackSize); // 更新最终大小
            }
            
            // logger.debug(`\nFile saved as: ${path.resolve(localFilename)}`);

            // if (isArtistEffectZip) {
            //     await unzipAndCleanup(localFilename);
            // }
            // if (isTextTemplate) {
            //     await unzipTextTemplate(localFilename);
            // }

            return true;
                
        } catch (error) {
            if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
                logger.debug(`Download timed out after ${timeout/1000} seconds`);
                lastError = new Error(`Download timed out after ${timeout/1000}s for URL: ${url}`);
            } else if (error.response) {
                logger.debug(`Request failed with status ${error.response.status}: ${error.message}`);
                lastError = new Error(`Request failed with status ${error.response.status} for URL: ${url}. Details: ${error.message}`);
            } else {
                logger.debug(`Unexpected error during download: ${error.message}`);
                lastError = error; // 捕获原始错误对象
            }
            
            retries++;
        }
    }
    
    logger.debug(`Download failed after ${maxRetries} attempts for URL: ${url}`);

    // 如果所有重试都失败了，抛出最后一次的错误，或者一个通用的失败信息
    if (lastError) {
        // 为了确保外层能拿到 URL，我们可以在原始错误对象上附加信息或抛出新错误
        lastError.message = `Download failed after ${maxRetries} attempts for URL: ${url}. Last error: ${lastError.message}`;
        throw lastError;
    } else {
        // 以防万一 (虽然应该不会发生)
        throw new Error(`Download failed after ${maxRetries} attempts for URL: ${url} with no recorded error details.`);
    }
}

async function unzipAndCleanup(zipFilePath) {
    const extractPath = path.dirname(zipFilePath);
    try {
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(extractPath, true);
        logger.debug(`Successfully unzipped text template: ${zipFilePath}`);
        
        // 递归删除__MACOSX文件夹
        const macosxDir = path.join(extractPath, '__MACOSX');
        if (fs.existsSync(macosxDir)) {
            fs.rmSync(macosxDir, { recursive: true, force: true });
            logger.debug(`Removed __MACOSX directory from ${extractPath}`);
        }

        // 删除原始zip文件
        fs.unlinkSync(zipFilePath);
        logger.debug(`Removed original zip file: ${zipFilePath}`);
    } catch (e) {
        logger.error(`Failed to unzip text template ${zipFilePath}: ${e.message}`, e);
    }
}

async function unzipTextTemplate(zipFilePath) {
    const extractPath = path.dirname(zipFilePath);
    try {
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(extractPath, true);
        logger.debug(`Successfully unzipped text template: ${zipFilePath}`);
        
        // 递归删除__MACOSX文件夹
        const macosxDir = path.join(extractPath, '__MACOSX');
        if (fs.existsSync(macosxDir)) {
            fs.rmSync(macosxDir, { recursive: true, force: true });
            logger.debug(`Removed __MACOSX directory from ${extractPath}`);
        }

        // 删除原始zip文件
        fs.unlinkSync(zipFilePath);
        logger.debug(`Removed original zip file: ${zipFilePath}`);
    } catch (e) {
        logger.error(`Failed to unzip text template ${zipFilePath}: ${e.message}`, e);
    }
}

module.exports = {
    downloadFile,
    unzipAndCleanup,
    unzipTextTemplate,
    getFileSize // 导出新函数
};
