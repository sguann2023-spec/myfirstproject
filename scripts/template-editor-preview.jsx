import React from 'react';
import { createRoot } from 'react-dom/client';
import TemplateEditPage from '../src/page/TemplateEditPage/TemplateEditPage';

window.electron = {
  ipcRenderer: {
    async invoke(channel, ...args) {
      const response = await fetch('/__template_api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, args })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.result;
    }
  }
};
createRoot(document.getElementById('root')).render(<TemplateEditPage />);
