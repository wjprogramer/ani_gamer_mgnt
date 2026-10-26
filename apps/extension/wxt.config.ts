import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // 用自己平常的 Chrome 載入 .output/chrome-mv3-dev，才會有動畫瘋的登入狀態
  webExt: { disabled: true },
  manifest: {
    name: '動畫瘋管理工具',
    description: '在動畫瘋與 Netflix 上隱藏作品、撰寫評論，並把觀看紀錄存到本機',
    permissions: ['storage', 'alarms'],
    host_permissions: [
      'https://ani.gamer.com.tw/*',
      'https://api.gamer.com.tw/*',
      'https://www.netflix.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
  },
});
