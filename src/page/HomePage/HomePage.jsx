// HomePage 组件
import React, { useEffect, useState } from 'react';
import './HomePage.css';
import { electronStore } from '../../shared/electronStore';
import LogoIcon from '../../../public/logo.png';
import { countTodayDrafts } from '../../api/capcut';
import DPane from '../../components/DPane/DPane';

const HomePage = () => {
  console.log('HomePage rendered');
  const user = electronStore.get('user') || {};
  const avatarSrc = user?.avatar || LogoIcon;
  const userName = user?.name || '';
  const [todayCount, setTodayCount] = useState(null);

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

  return (
    <div className="home-container" style={{ WebkitAppRegion: 'drag' }}>
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
              <DPane />
          </div>
          <div className="center-pane column"></div>
          <div className="right-pane column"></div>
      </div>
    </div>
  );
};

export default HomePage;