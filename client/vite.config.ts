import react from '@vitejs/plugin-react'
import dayjs from 'dayjs'
import { defineConfig } from 'vite'

import packageConf from './package.json'

const VITE_APP_TIME = `v.${packageConf.version}.${dayjs().format('YY.MMDD.HHmm')}`

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_TIME': JSON.stringify(VITE_APP_TIME)
  },
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      },
      '/rtc-config': {
        target: 'http://localhost:3001'
      }
    }
  }
})
