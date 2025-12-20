import React, { useEffect, useRef, useState } from 'react';
import { Layout, Typography, Input, Button, Dropdown, Menu, Modal, Collapse, message } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import './DownloadPage.css';
import logo from '../../icon.png';
import translateIcon from '../../public/translate.png';
import updateIcon from '../../public/update.png';
import settingsIcon from '../../public/settings.png';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import packageInfo from '../../package.json';
import DownloadList from '../../components/DownloadList/DownloadList';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

const { ipcRenderer } = window.require('electron');

const DEFAULT_HOST = 'https://cut-jianying-vdvswivepm.cn-hangzhou.fcapp.run/cut_jianying';

// ----------------------------------------------------
// 💥 模拟数据生成器 (用于测试) 💥
// ----------------------------------------------------
const createFakeDownloadList = (draftId) => ([
  { id: 1, name: 'video_asset_1.mp4', url: "https://example.com/assets/video1.mp4", downloaded: 0, total: 10.5, unit: 'MB', status: 'downloading', folderPath: `/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/dfd_cat_1761487581_d0192067/assets` },
  { id: 2, name: 'audio_track_2.mp3', url: "https://example.com/assets/audio2.mp3", downloaded: 0, total: 2.1, unit: 'MB', status: 'paused', folderPath: `/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/dfd_cat_1761487581_d0192067/assets` },
  { id: 3, name: 'image_3.jpg', url: "https://example.com/assets/image3.jpg", downloaded: 0, total: 0.8, unit: 'MB', status: 'paused', folderPath: `/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/dfd_cat_1761487581_d0192067/assets` },
]);

function parseUrlParams(protocolUrl) {
    try {
        const urlWithoutProtocol = protocolUrl.replace('capcutmaker://', '');
        const [path, queryString] = urlWithoutProtocol.split('?');
        const result = { path, params: {} };
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

const DownloadPage = ({ apiKey, language, onToggleLanguage, onUpdateApiKey }) => {
    const { t } = useTranslation();

    const [draftUrl, setDraftUrl] = useState('');
    const [draftId, setDraftId] = useState('');
    const currentDraftIdRef = useRef('');
    const [draftFolder, setDraftFolder] = useState('');
    const [isCapcut, setIsCapcut] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [updateMessage, setUpdateMessage] = useState('');
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [tempDraftFolder, setTempDraftFolder] = useState('');
    const [tempIsCapcut, setTempIsCapcut] = useState(true);
    const [tempApiKey, setTempApiKey] = useState(apiKey || '');
    const [apiHost, setApiHost] = useState(DEFAULT_HOST);
    const [tempApiHost, setTempApiHost] = useState(DEFAULT_HOST);
    const [downloadComplete, setDownloadComplete] = useState(false);
    const [completedDraftId, setCompletedDraftId] = useState('');
    const [downloadProject, setDownloadProject] = useState(null);

    useEffect(() => {
        currentDraftIdRef.current = draftId;
    }, [draftId]);

    useEffect(() => {
        // 初始设置从主进程加载（不在这里变更语言，由入口统一管理）
        ipcRenderer.invoke('get-draft-folder').then(settings => {
            const draftFolderValue = settings.draftFolder || '';
            setDraftFolder(draftFolderValue);
            if (settings.isCapcut !== undefined) setIsCapcut(settings.isCapcut);
            if (settings.apiHost !== undefined) {
                setApiHost(settings.apiHost);
                setTempApiHost(settings.apiHost);
            } else {
                setApiHost(DEFAULT_HOST);
                setTempApiHost(DEFAULT_HOST);
            }
            if (settings.apiKey !== undefined) {
                setTempApiKey(settings.apiKey);
                if (settings.apiKey !== apiKey && onUpdateApiKey) {
                    onUpdateApiKey(settings.apiKey);
                }
            }
        });

        // 监听设置变更广播，实现实时联动
        ipcRenderer.on('settings-updated', (event, updated) => {
            if (updated.draftFolder !== undefined) setDraftFolder(updated.draftFolder);
            if (updated.isCapcut !== undefined) setIsCapcut(updated.isCapcut);
            if (updated.apiHost !== undefined) {
                setApiHost(updated.apiHost);
                setTempApiHost(updated.apiHost);
            }
            if (updated.apiKey !== undefined) {
                setTempApiKey(updated.apiKey);
                if (updated.apiKey !== apiKey && onUpdateApiKey) {
                    onUpdateApiKey(updated.apiKey);
                }
            }
            // 如需联动语言，可在入口统一处理
        });

        ipcRenderer.on('protocol-url', (event, url) => {
            const parsedData = parseUrlParams(url);
            if (parsedData.params && parsedData.params.draft_id) {
                setDraftUrl(url);
                if (draftFolder && apiKey) {
                    setTimeout(() => {
                        handleDownload(parsedData.params.draft_id);
                    }, 100);
                } else {
                    message.info(t('please_login_first'));
                }
            }
        });

        ipcRenderer.on('download-progress', (event, { progress, text, fileList }) => {
            setDownloading(true);
            setProgress(progress);
            setProgressText(text);
            setDownloadComplete(false);
            setErrorMessage('');

            if (fileList) {
                setDownloadProject(prevProject => {
                    const activeFiles = fileList.filter(file => file.status !== 'completed');
                    return {
                        draftName: prevProject ? prevProject.draftName : currentDraftIdRef.current,
                        overallProgress: progress,
                        overallStatusText: text,
                        downloadFiles: activeFiles,
                    };
                });
            }
        });

        ipcRenderer.on('download-complete', (event, data) => {
            const currentDraftId = data.draft_id || currentDraftIdRef.current;
            setDownloading(false);
            setProgress(0);
            setDownloadComplete(true);
            setCompletedDraftId(currentDraftId);
            setErrorMessage('');
            setDownloadProject(null);

            message.success({
                content: t('view_draft', { draft_id: currentDraftId }),
                duration: 5,
            });
        });

        ipcRenderer.on('download-error', (event, data) => {
            const errorMsg = typeof data === 'string' ? data : data.error || data.message || t('unknown_error');
            const receivedFileList = data.fileList;

            setDownloading(false);
            setProgress(0);
            setProgressText('');
            setErrorMessage(errorMsg);
            setDownloadComplete(false);
            setCompletedDraftId('');

            if (downloadProject || receivedFileList) {
                setDownloadProject(prevProject => {
                    const newDownloadFiles = receivedFileList || prevProject.downloadFiles;
                    const totalDownloaded = newDownloadFiles.reduce((sum, file) => sum + file.downloaded, 0);
                    const totalTotal = newDownloadFiles.reduce((sum, file) => sum + file.total, 0);
                    const overallProgress = totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0;

                    return {
                        draftName: prevProject?.draftName || currentDraftIdRef.current,
                        overallProgress,
                        overallStatusText: errorMsg,
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
            let allCompleted = true;
            let finalDraftId = currentDraftIdRef.current;

            setDownloadProject(prevProject => {
                if (!prevProject) return null;

                finalDraftId = prevProject.draftName;

                const updatedFilesWithCompleted = prevProject.downloadFiles.map(file => {
                    if (file.id === id && (file.status === 'failed' || file.status === 'paused')) {
                        return { ...file, status: 'completed', downloaded: file.total };
                    }
                    return file;
                });

                allCompleted = updatedFilesWithCompleted.every(file => file.status === 'completed');
                const activeFiles = updatedFilesWithCompleted.filter(file => file.status !== 'completed');

                const totalDownloaded = updatedFilesWithCompleted.reduce((sum, file) => sum + file.downloaded, 0);
                const totalTotal = updatedFilesWithCompleted.reduce((sum, file) => sum + file.total, 0);
                const overallProgress = Math.round((totalDownloaded / totalTotal) * 100);

                return {
                    ...prevProject,
                    downloadFiles: activeFiles,
                    overallProgress,
                    overallStatusText: t('downloading_progress', { progress: overallProgress }),
                };
            });

            if (allCompleted && finalDraftId) {
                setTimeout(() => {
                    ipcRenderer.listeners('download-complete').forEach(listener => listener({}, { draft_id: finalDraftId }));
                }, 50);
            }
        });

        ipcRenderer.on('update-message', (event, msg) => {
            setUpdateMessage(msg);
            if (msg.includes('发现新版本') || msg.includes('更新已下载')) {
                setUpdateAvailable(true);
            }
        });

        return () => {
            ipcRenderer.removeAllListeners('protocol-url');
            ipcRenderer.removeAllListeners('download-progress');
            ipcRenderer.removeAllListeners('download-complete');
            ipcRenderer.removeAllListeners('download-error');
            ipcRenderer.removeAllListeners('update-message');
            ipcRenderer.removeAllListeners('file-found');
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, draftFolder, downloadProject, apiKey]);

    const checkForUpdates = () => {
        ipcRenderer.send('check-for-updates');
        message.info(t('check_update'));
    };

    const restartAndUpdate = () => {
        ipcRenderer.send('restart-and-update');
    };

    const openSettings = () => {
        setTempDraftFolder(draftFolder || '');
        setTempIsCapcut(isCapcut);
        setTempApiKey(apiKey || '');
        setTempApiHost(apiHost || DEFAULT_HOST);
        setSettingsVisible(true);
    };

    const saveSettings = () => {
        setDraftFolder(tempDraftFolder);
        setIsCapcut(tempIsCapcut);
        setApiHost(tempApiHost);

        if (tempApiKey !== apiKey && onUpdateApiKey) {
            onUpdateApiKey(tempApiKey);
        }

        ipcRenderer.send('save-settings', {
            draftFolder: tempDraftFolder,
            isCapcut: tempIsCapcut,
            apiKey: tempApiKey,
            apiHost: tempApiHost,
            language: language,
        });
        setSettingsVisible(false);
        message.success(t('settings_saved'));
    };

    const cancelSettings = () => {
        if (!draftFolder) {
            message.warning(t('draft_folder_required'));
            return;
        }
        setSettingsVisible(false);
    };

    const handleDownload = (draftIdParam) => {
        let currentDraftId = draftIdParam || draftId;
        let apiKeyHash = null;

        if (!apiKey) {
            message.error(t('api_key_required'));
            return;
        }

        try {
            const urlObj = new URL(draftUrl);
            const params = new URLSearchParams(urlObj.search);
            currentDraftId = params.get('draft_id') || currentDraftId;
            apiKeyHash = params.get('api_key_hash');
        } catch (error) {
            // ignore parse error, allow manual input
        }

        if (!currentDraftId) {
            message.error(t('input_required'));
            return;
        }

        if (!draftFolder) {
            message.error(t('draft_folder_required'));
            openSettings();
            return;
        }

        if (currentDraftId && currentDraftId !== draftId) {
            setDraftId(currentDraftId);
        }

        setDownloading(true);
        setProgress(0);
        setProgressText(t('preparing'));
        setErrorMessage('');

        const params = {
            draft_id: currentDraftId,
            draft_name: currentDraftId,
            draft_folder: draftFolder,
            is_capcut: isCapcut,
            api_key: apiKey,
        };
        if (apiKeyHash) {
            params.api_key_hash = apiKeyHash;
        }

        // 初始进度广播
        ipcRenderer.listeners('download-progress').forEach(listener => listener({}, { progress: 0, text: t('preparing'), fileList: null }));
        ipcRenderer.send('process-parameters', params);
    };

    return (
        <Layout className="app-container">
            <Header className="app-header">
                <div className="app-title" onClick={() => window.open('https://www.vectcut.com', '_blank', 'width=1200,height=900')}>
                    <img src={logo} alt="CapCutAPI Logo" className="app-logo" />
                    <Title level={3} style={{ margin: 0 }}>{t('title')}</Title>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Text strong type="secondary" style={{ marginRight: 15 }}>{t('api_key_label')}: {apiKey ? `${apiKey.substring(0, 4)}...` : '—'}</Text>
                    <Dropdown
                        overlay={
                            <Menu>
                                <Menu.Item key="zh" onClick={() => onToggleLanguage && onToggleLanguage('zh')}>
                                    中文
                                </Menu.Item>
                                <Menu.Item key="en" onClick={() => onToggleLanguage && onToggleLanguage('en')}>
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
                        />
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
                            <DownloadList project={downloadProject} />
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

            <Modal
                title={t('settings')}
                open={settingsVisible}
                onOk={saveSettings}
                onCancel={cancelSettings}
                okText={t('save')}
                okButtonProps={{ disabled: !tempDraftFolder || !tempApiKey }}
                styles={{ body: { marginTop: '50px', marginBottom: '50px' } }}
                cancelText={t('cancel')}
                closable={!!draftFolder}
                maskClosable={!!draftFolder}
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
                <Collapse ghost>
                    <Collapse.Panel header={t('advanced_settings')} key="advanced">
                        <div className="settings-form-item">
                            <Text strong>{t('is_capcut_label')}</Text>
                            <Input
                                className="settings-input"
                                value={tempIsCapcut ? 'true' : 'false'}
                                onChange={(e) => setTempIsCapcut(e.target.value === 'true')}
                                placeholder="true/false"
                            />
                        </div>
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
    );
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

export default DownloadPage;