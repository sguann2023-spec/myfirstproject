// DPane 组件
import React from 'react';
import './DPane.css';
import DraftIcon from '../../../public/draft_icon.svg';
import DraftSelectedIcon from '../../../public/draft_selected_icon.svg';

const DPane = ({ children, style, className = '', selected = 'draft' }) => {
  const isDraftSelected = selected === 'draft';

  return (
    <div className={`d-pane ${className}`} style={style}>
      <div className={`d-pane-item ${isDraftSelected ? 'selected' : ''}`}>
        <img
          src={isDraftSelected ? DraftSelectedIcon : DraftIcon}
          alt="Draft Icon"
          className="d-pane-icon"
        />
        <div className="d-pane-tip">草稿</div>
      </div>
      <div className="d-pane-body">
        {children}
      </div>
    </div>
  );
};

export default DPane;