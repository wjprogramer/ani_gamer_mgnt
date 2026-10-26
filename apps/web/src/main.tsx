import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, NavLink, Route, Routes } from 'react-router';
import { AnimeDetailPage } from './pages/AnimeDetailPage.tsx';
import { AnimeListPage } from './pages/AnimeListPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { MergePage } from './pages/MergePage.tsx';
import './style.css';

function App() {
  return (
    <HashRouter>
      <header className="topbar">
        <strong>動畫瘋管理工具</strong>
        <nav>
          <NavLink to="/" end>
            作品
          </NavLink>
          <NavLink to="/history">觀看紀錄</NavLink>
          <NavLink to="/merge">合併</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<AnimeListPage />} />
          <Route path="/anime/:id" element={<AnimeDetailPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/merge" element={<MergePage />} />
        </Routes>
      </main>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
