import { useMemo, useState } from 'react';
import { Typography, List, Row, Col, Space, Progress, Tooltip, Button, Modal } from 'antd';
import { CaretRightOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './DownloadList.css'; // 引入外部 CSS 文件
import RightArrowIcon from '../../../public/right_arrow.svg'
import FileIcon from '../../../public/download_file_icon.svg'
import { loggerService } from '@logger';
import { DownloadController } from '../../shared/DownloadController.js';
const logger = loggerService.withContext('DownloadList');
const { ipcRenderer, shell } = window.require('electron');

const { Text } = Typography;

/**
 * DownloadList 组件：用于展示下载列表、总体进度和状态。
 * @param {object} props
 * @param {object} props.project - 项目数据对象
 * @param {string} props.project.draftName - 草稿名称，例如 'pyJianYingDraft'
 * @param {number} props.project.overallProgress - 总体下载进度 (0-100)
 * @param {string} props.project.overallStatusText - 总体状态文本，例如 '已下载 2%, 已全部暂停'
 * @param {Array} props.project.downloadFiles - 待下载的文件列表
 */
const DownloadList = ({
    project = {
        draftName: 'Current Draft',
        overallProgress: 0,
        overallStatusText: '',
        downloadFiles: [],
        errorMessage: ''
    }
}) => {
    const { draftId, draftName, jobId, status, overallProgress, overallStatusText, downloadFiles, errorMessage } = project;
    const { t } = useTranslation('legacy');
    const hasActiveDraft = typeof draftName === 'string' && draftName.trim().length > 0;
    const [pendingAction, setPendingAction] = useState('');

    const handleQueueAction = async (action) => {
        if (action === 'cancel') {
            const taskName = draftName || draftId || '当前任务';
            const confirmed = await new Promise((resolve) => {
                Modal.confirm({
                    title: '确认取消下载',
                    content: `取消后当前下载任务会立即停止，确认取消「${taskName}」吗？`,
                    okText: '确认取消',
                    cancelText: '继续下载',
                    centered: true,
                    okType: 'danger',
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
            if (!confirmed) return;
        }

        setPendingAction(action);
        try {
            if (action === 'pause') {
                await DownloadController.pauseCurrent();
            } else if (action === 'resume') {
                await DownloadController.resumeCurrent();
            } else if (action === 'retry') {
                await DownloadController.retryTask({ draft_id: draftId, jobId });
            } else if (action === 'cancel') {
                await DownloadController.cancelCurrent();
            }
        } catch (error) {
            logger.error(`Failed to perform ${action} for download task`, error);
        } finally {
            setPendingAction('');
        }
    };

    const actionButtons = useMemo(() => {
        if (!draftId && !jobId) return [];

        if (status === 'downloading') {
            return [
                { key: 'pause', label: '停止', icon: <Square size={12} strokeWidth={2.4} /> },
                { key: 'cancel', label: '取消', title: '取消', icon: <X size={14} strokeWidth={2.2} /> },
            ];
        }

        if (status === 'paused') {
            return [
                { key: 'resume', label: '开始', icon: <CaretRightOutlined /> },
                { key: 'cancel', label: '取消', title: '取消', icon: <X size={14} strokeWidth={2.2} /> },
            ];
        }

        if (status === 'failed') {
            return [
                { key: 'retry', label: '重试', icon: <ReloadOutlined /> },
            ];
        }

        return [];
    }, [draftId, jobId, status]);

    const getFileStatusLabel = (fileStatus) => {
        if (fileStatus === 'failed') return '下载失败';
        if (fileStatus === 'paused') return '已暂停';
        if (fileStatus === 'queued') return '排队中';
        if (fileStatus === 'completed' || fileStatus === 'success') return '已完成';
        return '下载中';
    };

    const renderFileItem = (item) => {
        const total = Number(item.total) || 0;
        const downloaded = Number(item.downloaded) || 0;
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        let statusContent;

        const handleOpenExternalUrl = (e, url) => {
            e.preventDefault(); // 阻止在 Electron 窗口内部打开链接
            e.stopPropagation(); // 阻止事件冒泡到其他 Ant Design 组件
            
            if (shell) {
                // 使用 shell.openExternal() 调用系统默认浏览器打开链接
                shell.openExternal(url).catch(err => {
                    logger.error('Failed to open external URL:', err);
                    // 可以在这里添加一个 Ant Design message 提示用户失败
                });
            } else {
                logger.error("Electron shell module not available.");
            }
        };
        
        const handleOpenFolder = (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            
            logger.debug('[React Component] Click event triggered. Attempting to call IPC directly.');
            
            const targetDirectory = item.folderPath; 
            
            // ✅ 使用 ipcRenderer 直接发送消息给 main.js
            if (ipcRenderer) {
                logger.debug('IPC Renderer found. Sending messages directly. ',targetDirectory);
                
                // 1. 通知主进程打开下载目录
                // 注意：这里我们使用的是您 main.js 中已有的通道名称
                ipcRenderer.send('open-download-directory', targetDirectory); 
                
            } else {
                logger.error("IPC Renderer not available. Check main.js for contextIsolation/nodeIntegration.");
            }
        };
        // ⚡️ Tooltip 内容的 JSX 渲染
        // 注意：这里的点击事件需要是真实的回调函数，但为了演示，我们先使用 #
        const failedTooltipTitle = (
            <span style={{ fontSize: 12 }}>
                手动下载 <a 
                    href={item.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    onClick={(e) => { handleOpenExternalUrl(e, item.url)}}
                    style={{ color: '#fff', textDecoration: 'underline' }}
                >链接</a> 到 <a 
                    href="#"
                    onClick={handleOpenFolder}
                    style={{ color: '#fff', textDecoration: 'underline' }}
                >文件夹</a> 并重命名为 {item.name}
            </span>
        );
        if (item.status === 'failed') {
            // 失败状态：文本 + 图标
            statusContent = (
                <Space size={4} className='status-failed-container' align="center">
                    <Text className='file-list-item-status-failed'>下载失败</Text>
                    {/* ⚡️ 使用 Tooltip 包裹 SearchOutlined */}
                    <Tooltip 
                        title={failedTooltipTitle} 
                        placement="top"
                    >
                        <SearchOutlined className='status-action-icon' /> 
                    </Tooltip>
                </Space>
            );
        } else {
            // 下载中 / 已暂停状态：文本 + 进度条
            statusContent = (
                <div className='status-and-progress-wrapper'>
                    {/* 状态文本 (下载中/已暂停) */}
                    <Text className='file-list-item-status'>
                        {getFileStatusLabel(item.status)}
                    </Text>
                    
                    {/* 进度条 */}
                    <Progress 
                        percent={percent} 
                        size="small" 
                        showInfo={false} 
                        // 保持 Progress 颜色由 CSS 控制
                    />
                </div>
            );
        }
            return (
                <div className="download-list-item">
                    <Row align="middle">
                        
                        {/* 1. 文件图标和名称 (span={12} - 对应头部的 '名称') */}
                        <Col span={12}>
                            <Space size="middle" className='file-list-item-space'>
                                <img 
                                    src={FileIcon} 
                                    alt="File Icon" 
                                    className="file-icon" 
                                />
                                <div className="file-item-text-container">
                                    <Space direction="vertical" size={0}>
                                        {/* 文件名 */}
                                        <Text className='file-list-item-name'>{item.name}</Text>
                                        {/* 描述/路径 */}
                                        <Text className='file-list-item-url'>{item.url}</Text>
                                    </Space>
                                </div>
                            </Space>
                        </Col>
                        
                        {/* 2. 大小 (span={6} - 对应头部的 '大小', 左对齐) */}
                        <Col span={6} style={{ textAlign: 'left' }}>
                            <Text className='file-list-item-size'>
                                {/* 格式化大小显示，使用 toFixed(2) 确保两位小数 */}
                                {item.downloaded.toFixed(2)} {item.unit} / {item.total.toFixed(2)} {item.unit}
                            </Text>
                        </Col>
                        
                        {/* 3. 状态和进度 (span={7} - 对应头部的 '状态', 左对齐) */}
                        <Col span={6} style={{ textAlign: 'left' }}> 
                            {statusContent}
                        </Col>
                    </Row>
                </div>
            );
    };

    return (
        <div className="download-list-container">
            {/* 顶部总体状态栏 */}
            <div className="download-list-header">
                <Row align="middle">
                    <Col span={16}>
                        <Space className="custom-space-align-center" size={4}>
                            <Text className="header-path-text">{t('download_list')}</Text>
                            <img 
                                src={RightArrowIcon} 
                                alt="Arrow" 
                                className="header-path-svg-arrow" 
                            />
                            {hasActiveDraft && (
                                <>
                                    <Text className="header-path-text">{draftName}</Text>
                                    <Text className="header-path-dot">·</Text>
                                </>
                            )}
                            <Text className="header-path-text">{overallStatusText || `已下载 ${overallProgress}%`}</Text>
                        </Space>
                    </Col>
                    <Col span={8} className="download-list-header-actions">
                        {actionButtons.map((action) => (
                            <Button
                                key={action.key}
                                size="small"
                                type="text"
                                icon={action.icon}
                                className={`download-list-action-button ${action.key === 'cancel' ? 'download-list-action-button-cancel' : ''}`}
                                loading={pendingAction === action.key}
                                title={action.title || action.label}
                                aria-label={action.title || action.label}
                                onClick={() => handleQueueAction(action.key)}
                            >
                                {action.label}
                            </Button>
                        ))}
                    </Col>
                </Row>
            </div>

            {errorMessage ? (
                <div className="download-list-error-banner">
                    <Text className="download-list-error-text">{errorMessage}</Text>
                </div>
            ) : null}

            {/* 文件列表头部 */}
            <Row className="file-list-header-row">
                {/* 1. 名称 (span={12} - 占一半宽度) */}
                <Col span={12} className='file-list-header-name'>名称</Col> 
                
                {/* 2. 大小 (span={6} - 占四分之一宽度, 右对齐) */}
                <Col span={6} className='file-list-header-name'>大小</Col>
                
                {/* 3. 状态 (span={6} - 占四分之一宽度, 可以左对齐或保持默认) */}
                <Col span={6} className='file-list-header-name'>状态</Col> 
            </Row>

            {/* 文件列表体 */}
            <List
                dataSource={downloadFiles}
                renderItem={renderFileItem}
                rowKey="id"
                className="file-list-body"
                split={false} // 列表项之间的分割线由 renderFileItem 内部控制
            />
        </div>
    );
};

export default DownloadList;
