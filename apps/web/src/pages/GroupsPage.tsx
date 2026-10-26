import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { AnimeGroup } from '@agm/shared';
import { api } from '../api.ts';

/** 自訂分群的新增、改名與刪除；作品要加入哪些分群在作品頁設定 */
export function GroupsPage() {
  const [groups, setGroups] = useState<AnimeGroup[] | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');

  const load = () => api.listGroups().then(setGroups, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void run(() => api.createGroup(name.trim())).then(() => setName(''));
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing?.name.trim()) return;
    void run(() => api.renameGroup(editing.id, editing.name.trim())).then(() => setEditing(null));
  }

  function remove(g: AnimeGroup) {
    if (!window.confirm(`刪除分群「${g.name}」？作品本身不會被刪除。`)) return;
    void run(() => api.deleteGroup(g.id));
  }

  return (
    <>
      <h1>分群</h1>
      <p className="muted small">一部作品可以同時屬於多個分群，在作品頁勾選。</p>
      <form className="row" onSubmit={create}>
        <input placeholder="新分群名稱，例如「追番中」" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={!name.trim()}>
          新增
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {groups?.length === 0 && <p className="muted">還沒有分群。</p>}
      <ul className="groups">
        {groups?.map((g) =>
          editing?.id === g.id ? (
            <li key={g.id}>
              <form className="row grow" onSubmit={rename}>
                <input
                  autoFocus
                  value={editing.name}
                  maxLength={50}
                  onChange={(e) => setEditing({ id: g.id, name: e.target.value })}
                />
                <button className="primary">儲存</button>
                <button type="button" onClick={() => setEditing(null)}>
                  取消
                </button>
              </form>
            </li>
          ) : (
            <li key={g.id}>
              <Link className="grow" to={`/?group=${g.id}`}>
                {g.name}
              </Link>
              <span className="muted small">{g.count} 部</span>
              <button className="link" onClick={() => setEditing({ id: g.id, name: g.name })}>
                改名
              </button>
              <button className="link danger" onClick={() => remove(g)}>
                刪除
              </button>
            </li>
          ),
        )}
      </ul>
    </>
  );
}
