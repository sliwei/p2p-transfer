import './index.css'

import eruda from 'eruda'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'

eruda.init()

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
