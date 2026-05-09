import '@ant-design/v5-patch-for-react-19'
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { createRoot } from 'react-dom/client'

import App from '../../App.jsx'

// document.documentElement.classList.add('tw-scope')
// document.body.classList.add('tw-scope')
// document.documentElement.classList.add('tw-root-scope')
// document.body.classList.add('tw-root-scope')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
