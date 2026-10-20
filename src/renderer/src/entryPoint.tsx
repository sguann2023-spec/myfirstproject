import '@ant-design/v5-patch-for-react-19'
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { ConfigProvider } from 'antd'
import { createRoot } from 'react-dom/client'
import { installRendererHttpClient } from '../../http/installFetchInterceptor'
import { createRendererRootErrorHandlers } from '../../shared/rendererRootErrors'
import { loggerService } from './services/LoggerService'

installRendererHttpClient()

// document.documentElement.classList.add('tw-scope')
// document.body.classList.add('tw-scope')
// document.documentElement.classList.add('tw-root-scope')
// document.body.classList.add('tw-root-scope')

const logger = loggerService.withContext('RendererRoot')
const root = createRoot(
  document.getElementById('root') as HTMLElement,
  createRendererRootErrorHandlers(logger)
)
logger.info('Renderer root error handlers installed')
const view = new URLSearchParams(window.location.search).get('view')

async function bootstrap() {
  if (view === 'template-edit') {
    const { default: TemplateEditPage } = await import('../../page/TemplateEditPage/TemplateEditPage.jsx')
    document.title = '新模版'
    document.getElementById('spinner')?.remove()
    root.render(<TemplateEditPage />)
    return
  }

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
