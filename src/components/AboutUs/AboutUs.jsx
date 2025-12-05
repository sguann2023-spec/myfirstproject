import React from 'react';
import './AboutUs.css';
import AppLogo from '../../logo.png';

const AboutUs = () => {
  const getArgValue = (name) => {
    try {
      const argv = window.process?.argv || [];
      const hit = argv.find(a => a.startsWith(`${name}=`));
      return hit ? hit.split('=')[1] : '';
    } catch {
      return '';
    }
  };

  const appVersion = getArgValue('--app-version') || '开发版';
  const versionCode = getArgValue('--version-code') || '';
  const versionDisplay = versionCode ? `${appVersion}-${versionCode}` : appVersion;

  return (
    <div className="about-container">
      <div className="about-card">
        <img src={AppLogo} alt="App Logo" className="about-logo" />
        <div className="about-version">版本:{versionDisplay}</div>
      </div>
    </div>
  );
};

export default AboutUs;