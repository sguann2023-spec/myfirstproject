import React, { useState } from 'react';
import './GuiderSetting1.css';
import JianyingImg from '../../../../public/jianying.png';
import CapcutImg from '../../../../public/capcut.png';

const GuiderSetting1 = () => {
  const [interfaceMode, setInterfaceMode] = useState('jianying');

  return (
    <div className="gs1-settings">
      <div className="gs1-section">
        <div className="gs1-section-title">选择你的剪映软件</div>
        <div className="gs1-section-subtitle">不同版本的软件对应不同的下载策略</div>
        <div className="gs1-options gs1-options-large">
          <div
            className={`gs1-card ${interfaceMode === 'jianying' ? 'selected' : ''}`}
            onClick={() => setInterfaceMode('jianying')}
          >
            <div className={`gs1-card-preview ${interfaceMode === 'jianying' ? 'selected' : ''}`}>
              <img src={JianyingImg} alt="剪映" className="gs1-card-image" />
            </div>
            <div className="gs1-card-title">剪映</div>
          </div>
          <div
            className={`gs1-card ${interfaceMode === 'capcut' ? 'selected' : ''}`}
            onClick={() => setInterfaceMode('capcut')}
          >
            <div className={`gs1-card-preview ${interfaceMode === 'capcut' ? 'selected' : ''}`}>
              <img src={CapcutImg} alt="CapCut" className="gs1-card-image" />
            </div>
            <div className="gs1-card-title">CapCut</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuiderSetting1;
