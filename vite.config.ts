import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // LAN 内の .home.arpa 配下のホスト名で開発サーバーにアクセスできるようにする。
  server: { host: true, allowedHosts: ['.home.arpa'], proxy: { '/api': 'http://localhost:8877' } },
})
