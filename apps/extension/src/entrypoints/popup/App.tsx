import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { DEFAULT_SERVER_URL } from '@agm/shared';
import { send, type HealthResult } from '../../lib/messages.ts';
import { hideModeItem, serverUrlItem, showHiddenItem, type HideMode } from '../../lib/storage.ts';

export function App() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [mode, setMode] = useState<HideMode>('collapse');
  const [url, setUrl] = useState('');

  const check = () => void send({ type: 'flush' }).then(setHealth);

  useEffect(() => {
    check();
    void showHiddenItem.getValue().then(setShowHidden);
    void hideModeItem.getValue().then(setMode);
    void serverUrlItem.getValue().then(setUrl);
  }, []);

  function saveUrl() {
    const value = url.trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL;
    setUrl(value);
    void serverUrlItem.setValue(value).then(check);
  }

  return (
    <main>
      <h1>動畫瘋管理工具</h1>

      <section className={health?.online ? 'status ok' : 'status down'}>
        {health === null ? '檢查中…' : health.online ? '● 本機 server 運作中' : '● 本機 server 未啟動'}
        {!!health?.queueSize && <div className="small">待補送：{health.queueSize} 筆</div>}
        {health && !health.online && (
          <div className="small">
            請在專案目錄執行 <code>npm start</code>
          </div>
        )}
        <button onClick={check}>重新檢查</button>
      </section>

      <button
        className="primary"
        disabled={!health?.online}
        onClick={() => void browser.tabs.create({ url: health?.serverUrl ?? url })}
      >
        開啟管理頁
      </button>

      <label className="check">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => {
            setShowHidden(e.target.checked);
            void showHiddenItem.setValue(e.target.checked);
          }}
        />
        暫時顯示已隱藏的動畫
      </label>

      <label>
        隱藏方式
        <select
          value={mode}
          onChange={(e) => {
            const v = e.target.value as HideMode;
            setMode(v);
            void hideModeItem.setValue(v);
          }}
        >
          <option value="collapse">摺疊成一行（可還原）</option>
          <option value="remove">完全移除</option>
        </select>
      </label>

      <details>
        <summary>進階設定</summary>
        <label>
          Server 網址
          <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={saveUrl} />
        </label>
      </details>
    </main>
  );
}
