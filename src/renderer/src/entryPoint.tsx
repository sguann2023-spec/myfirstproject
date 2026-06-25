import '@ant-design/v5-patch-for-react-19'
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { ConfigProvider } from 'antd'
import { createRoot } from 'react-dom/client'

// document.documentElement.classList.add('tw-scope')
// document.body.classList.add('tw-scope')
// document.documentElement.classList.add('tw-root-scope')
// document.body.classList.add('tw-root-scope')

const root = createRoot(document.getElementById('root') as HTMLElement)
const view = new URLSearchParams(window.location.search).get('view')

async function bootstrap() {
  if (view === 'settings') {
    const { default: SettingPage } = await import('../../page/SettingPage/SettingPage.jsx');
    root.render(
      <ConfigProvider>
        <SettingPage />
      </ConfigProvider>
    );
    return
  }

  const { default: App } = await import('../../App.jsx')
  root.render(<App />)
}

void bootstrap()
