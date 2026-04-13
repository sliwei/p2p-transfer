import './index.css'
import 'sonner/dist/styles.css'

import eruda from 'eruda'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'

import App from './App.tsx'

eruda.init()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <Toaster position="top-center" />
  </>
)
