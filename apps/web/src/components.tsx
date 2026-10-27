import { useEffect, useRef, type MouseEvent } from 'react';

/** 收藏切換；放在連結裡時不觸發換頁 */
export function FavoriteButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <button
      type="button"
      className={active ? 'favorite active' : 'favorite'}
      onClick={click}
      aria-pressed={active}
      title={active ? '取消收藏' : '收藏'}
    >
      {active ? '♥' : '♡'}
    </button>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="stars" title={`${rating} 星`}>
      {'★'.repeat(rating)}
    </span>
  );
}

/** 下拉後用核取方塊複選；沒勾任何項目表示全部 */
export function MultiSelect<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  /** 沒勾任何項目時顯示 */
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // 點外面就收起來
  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const selected = options.filter((o) => value.includes(o.value));
  const toggle = (v: T, on: boolean) =>
    // 依選項順序排列
    onChange(options.map((o) => o.value).filter((x) => (x === v ? on : value.includes(x))));

  return (
    <details className="multi-select" ref={ref}>
      <summary aria-label={label}>{selected.length ? selected.map((o) => o.label).join('、') : label}</summary>
      <div className="multi-select-menu">
        {options.map((o) => (
          <label key={o.value} className="row small">
            <input type="checkbox" checked={value.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
            {o.label}
          </label>
        ))}
        {selected.length > 0 && (
          <button type="button" className="link" onClick={() => onChange([])}>
            清除
          </button>
        )}
      </div>
    </details>
  );
}
