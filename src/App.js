import React, { useState, useEffect, useRef } from 'react';
import { Segmented, Layout, Typography, Input, Switch, Button, Progress, message, ConfigProvider, Dropdown, Menu, Modal, Collapse } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import './App.css';
import logo from './icon.png';
import translateIcon from '../public/translate.png';
import updateIcon from '../public/update.png'; // 导入更新图标
import settingsIcon from '../public/settings.png'; // 导入设置图标
import { useTranslation } from 'react-i18next';
import './i18n'; // 导入i18n配置
import packageInfo from '../package.json'; // 导入package.json
import DownloadList from './components/DownloadList/DownloadList';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

// 引入electron的ipcRenderer模块
const { ipcRenderer } = window.require('electron');

const DEFAULT_HOST = 'https://open.capcutapi.top/cut_jianying';

// ----------------------------------------------------
// 💥 模拟数据生成器 (用于测试) 💥
// ----------------------------------------------------
const createFakeDownloadList = (draftId) => ([
  { id: 1, name: 'video_asset_1.mp4', url: "https://example.com/assets/video1.mp4", downloaded: 0, total: 10.5, unit: 'MB', status: 'downloading', folderPath: `/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/dfd_cat_1761487581_d0192067/assets` },
  { id: 2, name: 'audio_track_2.mp3', url: "https://example.com/assets/audio2.mp3", downloaded: 0, total: 2.1, unit: 'MB', status: 'paused', folderPath: `/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/dfd_cat_1761487581_d0192067/assets` },
  { id: 3, name: 'image_3.jpg', url: "https://example.com/assets/image3.jpg", downloaded: 0, total: 0.8, unit: 'MB', status: 'paused', folderPath: `/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/dfd_cat_1761487581_d0192067/assets` },
]);
// ----------------------------------------------------

// 解析URL参数的函数
function parseUrlParams(protocolUrl) {
  try {
    // 移除协议前缀
    const urlWithoutProtocol = protocolUrl.replace('capcutmaker://', '');
    
    // 分离路径和查询参数
    const [path, queryString] = urlWithoutProtocol.split('?');
    
    const result = {
      path: path,
      params: {}
    };
    
    // 解析查询参数
    if (queryString) {
      const params = new URLSearchParams(queryString);
      params.forEach((value, key) => {
        result.params[key] = value;
      });
    }
    
    return result;
  } catch (error) {
    return { error: error.message };
  }
}

const App = () => {
  const { t, i18n } = useTranslation(); // 使用useTranslation hook
  const [draftUrl, setDraftUrl] = useState('');
  const [draftId, setDraftId] = useState('');
  const currentDraftIdRef = useRef('');
  const [draftFolder, setDraftFolder] = useState('');
  const [isCapcut, setIsCapcut] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [locale, setLocale] = useState(zhCN);
  const [language, setLanguage] = useState('zh');
  const [updateAvailable, setUpdateAvailable] = useState(false); // 添加更新状态
  const [updateMessage, setUpdateMessage] = useState(''); // 添加更新消息
  const [settingsVisible, setSettingsVisible] = useState(false); // 添加设置对话框可见性状态
  const [tempDraftFolder, setTempDraftFolder] = useState(''); // 临时存储设置对话框中的草稿文件夹路径
  const [tempIsCapcut, setTempIsCapcut] = useState(true); // 临时存储设置对话框中的应用类型
  const [tempApiKey, setTempApiKey] = useState(''); // 临时存储设置对话框中的API_KEY
  const [apiKey, setApiKey] = useState(''); // 存储API_KEY
  const [apiHost, setApiHost] = useState(DEFAULT_HOST); // 添加API Host状态变量
  const [tempApiHost, setTempApiHost] = useState(''); // 临时存储设置对话框中的API Host
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [completedDraftId, setCompletedDraftId] = useState('');
  const [downloadProject, setDownloadProject] = useState(null); // 存储整个项目数据
  
  useEffect(() => {
    currentDraftIdRef.current = draftId;
  }, [draftId]);

  // 修改useEffect部分，移除对旧版本的兼容处理
  useEffect(() => {
    // 从主进程获取保存的设置值
    ipcRenderer.invoke('get-draft-folder').then(settings => {
      // 新版本返回对象的情况
      const draftFolderValue = settings.draftFolder || '';
      setDraftFolder(draftFolderValue);
      if (settings.isCapcut !== undefined) {
        setIsCapcut(settings.isCapcut);
      }
      if (settings.apiKey !== undefined) {
        setApiKey(settings.apiKey);
      }
      if (settings.apiHost !== undefined) {
        setApiHost(settings.apiHost);
      } else {
        setApiHost(DEFAULT_HOST); // 默认值
      }
      
      // 如果draftFolder为空，自动弹出设置对话框
      if (!draftFolderValue) {
        openSettings();
      }
    });

    // 监听来自主进程的协议URL消息
    ipcRenderer.on('protocol-url', (event, url) => {
      console.log('Received protocol URL:', url);
      const parsedData = parseUrlParams(url);
      
      // 如果URL中包含draft_id参数，自动填充到表单中并触发下载
      if (parsedData.params && parsedData.params.draft_id) {
        setDraftId(parsedData.params.draft_id);
        
        // 如果是从协议URL跳转而来，自动触发下载
        // 确保draftFolder已设置
        if (draftFolder) {
          // 延迟一点执行下载，确保状态已更新
          setTimeout(() => {
            handleDownload(parsedData.params.draft_id);
          }, 100);
        }
      }
    });
    
    // ----------- 下载系列监听 -----------
    // 1. 监听下载进度
    ipcRenderer.on('download-progress', (event, { progress, text, fileList }) => {
      // 激活下载中状态
      setDownloading(true); 
      setProgress(progress);
      setProgressText(text);
      setDownloadComplete(false); // 确保在下载过程中，不显示完成状态
      setErrorMessage('');       // 清除任何旧的错误信息
      
      // 💥 更新下载项目状态：这里不对 fileList 进行过滤，以确保进度条计算的准确性
      if (fileList) {
          // 💥 仅在接收到新的完整列表时更新 downloadProject
          setDownloadProject(prevProject => {
              // 💥 在更新前，先移除已完成的文件，只保留活动文件
              const activeFiles = fileList.filter(file => file.status !== 'completed');

              return {
              draftName: prevProject ? prevProject.draftName : currentDraftIdRef.current, 
              overallProgress: progress,
              overallStatusText: text,
                  downloadFiles: activeFiles, // 💥 使用过滤后的列表
              };
          });
      }
    });
    
    // 2. 监听下载完成 (负责成功状态和成功弹窗)
    ipcRenderer.on('download-complete', (event, data) => { // 接收 data 以获取 draft_id
      console.log('on donwload complete')
      const currentDraftId = data.draft_id || currentDraftIdRef.current; 
      
      setDownloading(false);
      setProgress(0); // 清除进度条
      setDownloadComplete(true);
      setCompletedDraftId(currentDraftId);
      setErrorMessage('');
      
      setDownloadProject(null);

      // 使用 Ant Design 的 message 组件显示成功消息 (只在这里弹窗一次)
      message.success({
        content: t('view_draft', { draft_id: currentDraftId }),
        duration: 5,
      });
    });

    // 3. 监听下载错误 (负责失败状态和错误弹窗)
    ipcRenderer.on('download-error', (event, data) => {
      const errorMsg = typeof data === 'string' ? data : data.error || data.message || t('unknown_error');
      const receivedFileList = data.fileList;

      setDownloading(false);
      setProgress(0); // 隐藏进度条
      setProgressText('');
      setErrorMessage(errorMsg); // 记录错误信息以便在页面上显示
      setDownloadComplete(false);
      setCompletedDraftId('');
    
      if (downloadProject || receivedFileList) {
          setDownloadProject(prevProject => {
              // 如果接收到精简后的列表，直接使用它
              const newDownloadFiles = receivedFileList || prevProject.downloadFiles;
              
              // 重新计算进度（通常是 100%，因为只有未完成项还在列表里）
              const totalDownloaded = newDownloadFiles.reduce((sum, file) => sum + file.downloaded, 0);
              const totalTotal = newDownloadFiles.reduce((sum, file) => sum + file.total, 0);
              const overallProgress = totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0;
              
              return {
                  draftName: prevProject?.draftName || currentDraftIdRef.current,
                  overallProgress: overallProgress,
                  overallStatusText: errorMsg, // 更新为错误信息
                  downloadFiles: newDownloadFiles,
              };
          });
      }

      message.error({
          content: errorMsg,
          duration: 5,
      });
    });

    ipcRenderer.on('file-found', (event, { id }) => {
        console.log(`[App] File found for ID: ${id}. Updating list.`);
        
        let allCompleted = true;
        let finalDraftId = currentDraftIdRef.current;
        
        setDownloadProject(prevProject => {
            if (!prevProject) return null;
            
            finalDraftId = prevProject.draftName; // 确保使用当前的项目ID

            // 1. 更新文件状态
            const updatedFilesWithCompleted = prevProject.downloadFiles.map(file => {
                if (file.id === id && (file.status === 'failed' || file.status === 'paused')) {
                    return { ...file, status: 'completed', downloaded: file.total };
                }
                return file;
            });
            
            // 2. 检查是否全部完成（基于完整列表）
            allCompleted = updatedFilesWithCompleted.every(file => file.status === 'completed');
            
            // 3. 过滤掉已完成的文件（保留活动列表）
            const activeFiles = updatedFilesWithCompleted.filter(file => file.status !== 'completed');

            // 4. 计算整体进度（基于完整列表进行计算，但我们只需更新整体进度状态）
            const totalDownloaded = updatedFilesWithCompleted.reduce((sum, file) => sum + file.downloaded, 0);
            const totalTotal = updatedFilesWithCompleted.reduce((sum, file) => sum + file.total, 0);
            const overallProgress = Math.round((totalDownloaded / totalTotal) * 100);

            // 更新整个项目对象
            const newProject = { 
                ...prevProject, 
                downloadFiles: activeFiles, // 💥 关键：只保留活动文件
                overallProgress: overallProgress,
                overallStatusText: t('downloading_progress', { progress: overallProgress }) // 更新文本
            };
            
            return newProject;
        });

        // 如果所有文件都已完成，模拟下载成功通知
        if (allCompleted && finalDraftId) {
          console.log('send complete')
            // 延迟发送，确保状态更新完毕
            setTimeout(() => {
                // 使用 simulateIPC 模拟主进程发送消息到渲染进程
                simulateIPC('download-complete', { draft_id: finalDraftId });
            }, 50); 
        }
    });

    // 监听更新消息
    ipcRenderer.on('update-message', (event, message) => {
      setUpdateMessage(message);
      if (message.includes('发现新版本') || message.includes('更新已下载')) {
        setUpdateAvailable(true);
      }
    });
    
    // 组件卸载时清理事件监听器
    return () => {
      ipcRenderer.removeAllListeners('protocol-url');
      ipcRenderer.removeAllListeners('download-progress');
      ipcRenderer.removeAllListeners('download-complete');
      ipcRenderer.removeAllListeners('download-error');
      ipcRenderer.removeAllListeners('update-message');
      ipcRenderer.removeAllListeners('file-found');
    };
  }, [t, draftFolder, downloadProject]); // 添加 downloadProject 作为依赖项

  // ----------------------------------------------------
  // 模拟下载过程 (仅用于测试)
  // ----------------------------------------------------
  // 💥 重新添加 simulateIPC 函数
  const simulateIPC = (channel, data) => {
      // ⚠️ 实际 Electron 环境中，这是由主进程的 ipcMain.on('process-parameters') 触发的。
      // 为了测试，我们直接调用 ipcRenderer 的监听器回调函数。
      ipcRenderer.listeners(channel).forEach(listener => {
          // 假造一个 event 对象
          listener({}, data);
      });
  };
  
  // 模拟下载过程 (仅用于测试)
  const startFakeDownload = (currentDraftId) => {
    const initialList = createFakeDownloadList(currentDraftId);
    
    // 💥 维护一个完整的列表状态，用于准确计算总体进度，但只将活动列表发送给组件
    let fullFileList = initialList;

    // 初始化 downloadProject 状态 (只包含活动文件)
    setDownloadProject({
        draftName: currentDraftId,
        overallProgress: 1,
        overallStatusText: t('preparing'),
        downloadFiles: initialList.filter(file => file.status !== 'completed'), // 初始过滤
    });
    
    // 模拟主进程开始处理，并返回初始列表 (使用 IPC)
    simulateIPC('download-progress', { 
        progress: 1, 
        text: t('preparing'), 
        fileList: initialList, 
    });
    
    let cycleCounter = 0; // 模拟时间循环计数器 (0 到 20)
    const totalCycles = 20; 
    

    const interval = setInterval(() => {
        cycleCounter += 1;
        
        if (cycleCounter > totalCycles) {
            clearInterval(interval);
            
            // 1. 从最终完整列表中移除所有已完成的文件
            const remainingFiles = fullFileList.filter(
                file => file.status !== 'completed'
            );
            
            // 2. 发送 download-error，并将移除完成项后的列表作为数据的一部分
            simulateIPC('download-error', { 
                error: t('download_partially_failed'),
                fileList: remainingFiles, // 💥 传递精简后的列表
            });

            // // 发送下载完成
            // simulateIPC('download-complete', { draft_id: currentDraftId })
            
            return;
        }
        
        // 1. 在当前完整列表上进行映射更新
        const updatedList = fullFileList.map(file => {
                let newFile = { ...file };
                
                // 仅处理 status 为 'downloading' 或 'paused' 的文件
                if (newFile.status === 'downloading' || newFile.status === 'paused') {
                    
                    if (newFile.id === 1) {
                        // 正常下载完成
                        const progress = Math.round((cycleCounter*2 / totalCycles) * 100);
                        newFile.downloaded = newFile.total * (progress / 100);
                        newFile.status = progress >= 100 ? 'completed' : 'downloading';

                        // // 50% 失败
                        // const targetProgress = 50;
                        // const maxCycleForTarget = totalCycles / 2; 

                        // if (cycleCounter <= maxCycleForTarget) {
                        //     const progress = Math.round((cycleCounter / maxCycleForTarget) * targetProgress);
                        //     newFile.downloaded = newFile.total * (progress / 100);
                        //     newFile.status = 'downloading';
                        // } else if (newFile.status !== 'failed' && cycleCounter === maxCycleForTarget + 1) {
                        //     newFile.status = 'failed';
                        //     newFile.downloaded = newFile.total * (targetProgress / 100);
                        // }
                        
                    } else if (newFile.id === 2) {
                        // // 正常下载完成
                        // const progress = Math.round((cycleCounter*2 / totalCycles) * 100);
                        // newFile.downloaded = newFile.total * (progress / 100);
                        // newFile.status = progress >= 100 ? 'completed' : 'downloading';

                        // 下载到50%失败
                        const targetProgress = 50;
                        const maxCycleForTarget = totalCycles / 2; 

                        if (cycleCounter <= maxCycleForTarget) {
                            const progress = Math.round((cycleCounter / maxCycleForTarget) * targetProgress);
                            newFile.downloaded = newFile.total * (progress / 100);
                            newFile.status = 'downloading';
                        } else if (newFile.status !== 'failed' && cycleCounter === maxCycleForTarget + 1) {
                            newFile.status = 'failed';
                            newFile.downloaded = newFile.total * (targetProgress / 100);
                        }
                        
                    } else if (newFile.id === 3) {
                        // 3. 文件 3: 下载速度非常慢 (20 个周期只下载到 10%)
                        // const targetProgress = 10;
                        // const progress = Math.round((cycleCounter / totalCycles) * targetProgress);
                        // newFile.downloaded = newFile.total * (progress / 100);
                        // newFile.status = progress >= 100 ? 'completed' : 'downloading'; 

                        const progress = Math.round((cycleCounter*2 / totalCycles) * 100);
                        newFile.downloaded = newFile.total * (progress / 100);
                        newFile.status = progress >= 100 ? 'completed' : 'downloading';
                        
                    }
                }
                
                return newFile;
            });
            
        // 2. 更新 fullFileList 状态
        fullFileList = updatedList;

        // 3. 计算总进度 (使用完整列表)
        const totalDownloaded = fullFileList.reduce((sum, file) => sum + file.downloaded, 0);
        const totalTotal = fullFileList.reduce((sum, file) => sum + file.total, 0);
            const overallProgress = Math.round((totalDownloaded / totalTotal) * 100);
            const progressText = t('downloading_progress', { progress: overallProgress });

            // 4. 模拟 IPC 广播更新 (发送完整列表)
            simulateIPC('download-progress', {
                progress: overallProgress,
                text: progressText,
                fileList: fullFileList, 
            });
            
        // 5. App.js 中的 setDownloadProject 会在 download-progress 监听器中处理过滤

    }, 500); 
  };

  // 切换语言
  const toggleLanguage = (newLang) => {
    const newLanguage = newLang || (language === 'zh' ? 'en' : 'zh');
    setLanguage(newLanguage);
    setLocale(newLanguage === 'zh' ? zhCN : enUS);
    i18n.changeLanguage(newLanguage); // 使用i18next切换语言
  };

  // 检查更新
  const checkForUpdates = () => {
    ipcRenderer.send('check-for-updates');
    message.info(t('check_update'));
  };

  // 重启并安装更新
  const restartAndUpdate = () => {
    ipcRenderer.send('restart-and-update');
  };

  // 打开设置对话框
  const openSettings = () => {
    setTempDraftFolder(draftFolder || ''); // 确保是空字符串而不是undefined
    setTempIsCapcut(isCapcut);
    setTempApiKey(apiKey || ''); // 设置临时API_KEY
    setTempApiHost(apiHost || DEFAULT_HOST); // 设置临时API Host
    setSettingsVisible(true);
  };

  // 保存设置
  const saveSettings = () => {
    setDraftFolder(tempDraftFolder);
    setIsCapcut(tempIsCapcut);
    setApiKey(tempApiKey); // 保存API_KEY
    setApiHost(tempApiHost); // 保存API Host
    // 保存设置到主进程
    ipcRenderer.send('save-settings', {
      draftFolder: tempDraftFolder,
      isCapcut: tempIsCapcut,
      apiKey: tempApiKey, // 添加API_KEY
      apiHost: tempApiHost // 添加API Host
    });
    setSettingsVisible(false);
    message.success(t('settings_saved'));
  };

  // 取消设置
  const cancelSettings = () => {
    // 如果是首次启动且没有设置draftFolder，不允许关闭设置对话框
    if (!draftFolder) {
      message.warning(t('draft_folder_required'));
      return;
    }
    setSettingsVisible(false);
  };

  // 处理下载
  const handleDownload = (draftIdParam) => {
    // 使用传入的参数或状态中的值
    let currentDraftId = draftIdParam || draftId;
    let apiKeyHash = null;

    console.log('draftUrl: ', draftUrl)
    
    // 尝试解析URL中的参数
    try {
      const urlObj = new URL(draftUrl);
      const params = new URLSearchParams(urlObj.search);
      
      currentDraftId = params.get('draft_id');
      apiKeyHash = params.get('api_key_hash');
    } catch (error) {
      console.error('解析URL失败:', error);
    }
    
    if (!currentDraftId) {
      message.error(t('input_required'));
      return;
    }

    // 如果draftFolder为空，提示用户设置
    if (!draftFolder) {
      message.error(t('draft_folder_required'));
      openSettings();
      return;
    }
    
    // 只有当有 currentDraftId 时才更新 draftId 状态
    if (currentDraftId && currentDraftId !== draftId) {
        setDraftId(currentDraftId);
    }

    setDownloading(true);
    setProgress(0);
    setProgressText(t('preparing'));
    setErrorMessage('');

    const params = {
      draft_id: currentDraftId,
      draft_folder: draftFolder,
      is_capcut: isCapcut
    };
    
    // 如果有apiKeyHash，添加到参数中
    if (apiKeyHash) {
      params.api_key_hash = apiKeyHash;
    }

    simulateIPC('download-progress', { 
        progress: 0, 
        text: t('preparing'), 
        fileList: null, 
    });

    // 发送到主进程
    ipcRenderer.send('process-parameters', params);
    // 调用我们的模拟函数
    // startFakeDownload(currentDraftId);
  };

  return (
    <ConfigProvider locale={locale}>
      <Layout className="app-container">
        <Header className="app-header">
          <div className="app-title" onClick={() => window.open('https://www.capcutapi.top', '_blank', 'width=1200,height=900')}>
            <img src={logo} alt="CapCutAPI Logo" className="app-logo" />
            <Title level={3} style={{ margin: 0 }}>{t('title')}</Title>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Dropdown
              overlay={
                <Menu>
                  <Menu.Item key="zh" onClick={() => toggleLanguage('zh')}>
                    中文
                  </Menu.Item>
                  <Menu.Item key="en" onClick={() => toggleLanguage('en')}>
                    English
                  </Menu.Item>
                </Menu>
              }
              placement="bottomRight"
            >
              <Button 
                icon={<img src={translateIcon} alt="translate" className="translate-icon" />}
                type="text"
                className="header-button"
              >
              </Button>
            </Dropdown>
            {updateAvailable ? (
              <Button 
                icon={<img src={updateIcon} alt="update" className="update-icon" />}
                type="primary"
                onClick={restartAndUpdate}
                className="update-button"
                title={updateMessage}
              >
                {language === 'zh' ? '重启更新版本' : 'Restart to update'}
              </Button>
            ) : (
              <Button 
                icon={<img src={updateIcon} alt="update" className="update-icon" />}
                type="text"
                onClick={checkForUpdates}
                title={t('check_update')}
                className="header-button"
              />
            )}
            <Button 
              icon={<img src={settingsIcon} alt="settings" className="settings-icon" />}
              type="text"
              onClick={openSettings}
              title={t('settings')}
              className="header-button"
            />
          </div>
        </Header>
        
        <Content className="app-content">
          <div className="form-container">
            <div className="form-item">
              <Text strong>{t('draft_url_label')}</Text>
              <Input 
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder={t('draft_url_placeholder')}
              />
            </div>
            
            <div className="form-item">
              <Button 
                type="primary" 
                onClick={() => handleDownload()}
                loading={downloading}
                block
              >
                {t('download_button')}
              </Button>
            </div>
            
            {(downloading || downloadProject) && downloadProject?.downloadFiles?.length > 0 && (
              <div className="form-item">
                <DownloadList 
                    project={downloadProject}
                  />
              </div>
            )}
            
            {downloadComplete && (
              <div className="form-item success-message" style={{ color: '#52c41a', marginTop: '10px', textAlign: 'center' }}>
                <CloudDownloadOutlined style={{ marginRight: '8px' }} />
                {t('view_draft', { draft_id: completedDraftId })}
              </div>
            )}
            
          </div>
        </Content>

        {/* 设置对话框 */}
        <Modal
          title={t('settings')}
          open={settingsVisible}
          onOk={saveSettings}
          onCancel={cancelSettings}
          okText={t('save')}
          okButtonProps={{ disabled: !tempDraftFolder || !tempApiKey }} // 如果tempDraftFolder为空，禁用保存按钮
          styles={{ body: { marginTop: '50px', marginBottom: '50px' } }}
          cancelText={t('cancel')}
          closable={!!draftFolder} // 如果draftFolder为空，不允许通过X关闭对话框
          maskClosable={!!draftFolder} // 如果draftFolder为空，不允许通过点击遮罩关闭对话框
        >
          <div className="settings-form-item">
            <Text strong>{t('api_key_label')}</Text>
            <Input 
              className="settings-input"
              value={tempApiKey}
              onChange={(e) => setTempApiKey(e.target.value)}
              placeholder={t('api_key_placeholder')}
            />
          </div>
          <div className="settings-form-item">
            <Text strong>{t('draft_folder_label')}</Text>
            <Input 
              className="settings-input"
              value={tempDraftFolder}
              onChange={(e) => setTempDraftFolder(e.target.value)}
              placeholder={t('draft_folder_placeholder')}
            />
          </div>
          <div className="settings-form-item">
            <Text strong>{t('app_type_label')}</Text>
            <div className="switch-container">
              <Segmented
                options={[
                  { value: 'jianying', label: t('jianying') },
                  { value: 'capcut', label: t('capcut') }
                ]}
                value={tempIsCapcut ? 'capcut' : 'jianying'}
                onChange={(value) => setTempIsCapcut(value === 'capcut')}
                className="app-segmented"
              />
            </div>
          </div>

          <Collapse ghost>
            <Collapse.Panel header={t('advanced_settings')} key="1">
              <div className="settings-form-item">
                <Text strong>{t('api_host_label')}</Text>
                <Input 
                  className="settings-input"
                  value={tempApiHost}
                  onChange={(e) => setTempApiHost(e.target.value)}
                  placeholder={t('api_host_placeholder')}
                />
              </div>
            </Collapse.Panel>
          </Collapse>
        </Modal>

        <div className="version-info">
            <Text type="secondary">v{packageInfo.version}</Text>
        </div>
      </Layout>
    </ConfigProvider>
  );
};

export default App;