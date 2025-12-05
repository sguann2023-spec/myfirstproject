// HomePage 组件
import React, { useEffect, useState } from 'react';
import './HomePage.css';
import { electronStore } from '../../shared/electronStore';
import LogoIcon from '../../../public/logo-circle.png';
import { countTodayDrafts } from '../../api/capcut';
import DPane from '../../components/DPane/DPane';
import DraftList from '../../components/DraftList';
import DownloadDualList from '../../components/DownloadDualList/DownloadDualList';
import DraftPreview from '../../components/DraftPreview/DraftPreview';
import logger from '../../shared/logger';
import DownloadList from '../../components/DownloadList/DownloadList';
import DraftDownloadSuccessPreview from '../../components/DraftDownloadSuccessPreview/DraftDownloadSuccessPreview';

const HomePage = () => {
  logger.debug('HomePage rendered');
  const user = electronStore.get('user') || {};
  const avatarSrc = user?.avatar || LogoIcon;
  const userName = user?.name || '';
  const [todayCount, setTodayCount] = useState(null);
  const [selectedPane, setSelectedPane] = useState('draft');
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [downloadDualView, setDownloadDualView] = useState('downloading');
  const [downloadProject, setDownloadProject] = useState(null);
  // 用“选中项”驱动右侧展示
  const [selectedCompleted, setSelectedCompleted] = useState(null);

  // 暴露一个可复用的计数刷新方法
  const refreshTodayCount = () => {
    return countTodayDrafts()
      .then((res) => {
        const c = typeof res?.count === 'number' ? res.count : 0;
        setTodayCount(c); // 更新界面（第 23-24 行对应逻辑）
      })
      .catch(() => setTodayCount(0));
  };

  useEffect(() => {
    let mounted = true;
    countTodayDrafts()
      .then((res) => {
        const c = typeof res?.count === 'number' ? res.count : 0;
        if (mounted) setTodayCount(c);
      })
      .catch(() => {
        if (mounted) setTodayCount(0);
      });
    return () => { mounted = false; };
  }, []);

  // 订阅当前下载任务的文件列表，映射为 DownloadList 所需的 project
  useEffect(() => {
    const { DownloadController } = require('../../shared/DownloadController');
    const unsubscribe = DownloadController.subscribeFileList(({ draft_id, fileList }) => {
      const active = Array.isArray(fileList) ? fileList.filter(f => f.status !== 'completed') : [];
      const totalDownloaded = active.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
      const totalTotal = active.reduce((sum, f) => sum + (Number(f.total) || 0), 0);
      const overallProgress = totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0;
      setDownloadProject({
        draftName: draft_id || '',
        overallProgress,
        overallStatusText: `已下载 ${overallProgress}%`,
        downloadFiles: active,
      });
    });
    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, []);

  // 新增：订阅进度，当当前任务结束（current 为空）时清空右侧项目
  useEffect(() => {
    const { DownloadController } = require('../../shared/DownloadController');
    const unsubscribe = DownloadController.subscribeProgress((snapshot) => {
      if (!snapshot?.current) {
        setDownloadProject(null);
      }
    });
    return () => { typeof unsubscribe === 'function' && unsubscribe(); };
  }, []);

  // 构建“已完成”记录为 DownloadList 的 project（仅失败项需要列表）
  const buildProjectFromCompleted = (item) => {
    if (!item) return { draftName: '', overallProgress: 0, overallStatusText: '', downloadFiles: [] };
    const isSuccess = item.status === 'success';
    const list = isSuccess
      ? []
      : (Array.isArray(item.flatList)
          ? item.flatList
          : (Array.isArray(item.fileList) ? item.fileList.filter(f => f.status === 'failed') : []));
    const totalDownloaded = list.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
    const totalTotal = list.reduce((sum, f) => sum + (Number(f.total) || 0), 0);
    const overallProgress = isSuccess ? 100 : (totalTotal > 0 ? Math.round((totalDownloaded / totalTotal) * 100) : 0);
    return {
      draftName: item.draft_name || item.draft_id || '',
      overallProgress,
      overallStatusText: isSuccess ? '下载完成' : '下载失败',
      downloadFiles: list,
    };
  };

  let rightPanel = null;
  if (selectedPane === 'download') {
      if (downloadDualView === 'completed') {
          logger.info('selectedCompleted', selectedCompleted);
          if (selectedCompleted) {
              if (selectedCompleted.status === 'success') {
                  rightPanel = <DraftDownloadSuccessPreview draft={selectedCompleted} />;
              } else {
                  rightPanel = <DownloadList project={buildProjectFromCompleted(selectedCompleted)} />;
              }
          }
      }
  }
  return (
    <div className="home-container" style={{ WebkitAppRegion: 'no-drag' }}>
        <div className="home-header">
            <img src={avatarSrc} alt="avatar" className="header-avatar" />
            <span className="header-username">{userName}</span>
            <span className="header-welcome">
              今天你创作了{todayCount != null ? todayCount : '…'}个草稿
            </span>
        </div>
      {/* 主体三栏 */}
      <div className="home-content">
          <div className="left-pane column">
              <DPane selected={selectedPane} onSelect={setSelectedPane} />
          </div>
          <div className="center-pane column">
            {selectedPane === 'draft' && (
              <DraftList
                onRefreshTodayCount={refreshTodayCount}
                onSelectDraft={setSelectedDraft}
                selectedId={selectedDraft?.draft_id}
              />
            )}
            {selectedPane === 'download' && (
              <DownloadDualList
                onViewChange={(v) => {
                    const prev = downloadDualView;
                    setDownloadDualView(v);
                    // 仅在“实际切换到已完成”时清空选中项
                    if (v === 'completed' && prev !== 'completed') setSelectedCompleted(null);
                }}
                // 列表内的选中态，用于高亮与右侧联动
                selectedCompletedId={selectedCompleted?.draft_id}
                // 选中项变更时，右侧展示相应内容
                onSelectCompletedItem={(item) => setSelectedCompleted(item)}
              />
            )}
          </div>
          <div className="right-pane column">
            {selectedPane === 'draft' && selectedDraft ? (
              <DraftPreview draft={selectedDraft} />
            ) : null}
            {/* 下载中视图：显示当前下载详情 */}
            {selectedPane === 'download' && downloadDualView === 'downloading' ? (
              <DownloadList project={downloadProject || { draftName: '', overallProgress: 0, overallStatusText: '', downloadFiles: [] }} />
            ) : null}
            {/* 已完成视图：仅在选中具体项后展示右侧内容 */}
            {rightPanel}
          </div>
      </div>
    </div>
  );
};

export default HomePage;