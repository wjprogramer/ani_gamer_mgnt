import { send } from '../../lib/messages.ts';

/** 每個分頁工作階段提醒一次 server 未啟動 */
export async function warnIfOffline() {
  const { online } = await send({ type: 'health' });
  if (online || sessionStorage.getItem('agm-offline-warned')) return;
  sessionStorage.setItem('agm-offline-warned', '1');
  const toast = document.createElement('div');
  toast.className = 'agm-toast';
  toast.textContent = '動畫瘋管理工具：本機 server 未啟動，資料會先暫存，啟動後自動補送。（點擊關閉）';
  toast.addEventListener('click', () => toast.remove());
  document.body.append(toast);
  setTimeout(() => toast.remove(), 10_000);
}
