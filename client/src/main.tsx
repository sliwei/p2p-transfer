import './index.css'
import 'sonner/dist/styles.css'

import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'

import App from './App.tsx'

if (import.meta.env.MODE !== 'live') {
  void import('eruda').then((m) => m.default.init())
}

console.info(`%c Version %c ${import.meta.env.VITE_APP_TIME} `, 'color: #fff; background: #5f5f5f', 'color: #fff; background: #4bc729')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <Toaster position="top-center" />
  </>
)
