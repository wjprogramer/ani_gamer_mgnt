import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

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

/** 點開的小視窗；點外面或呼叫 close 時收起 */
export function Popover({
  summary,
  title,
  className = '',
  children,
}: {
  summary: ReactNode;
  title?: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details className={`popover ${className}`} ref={ref}>
      <summary title={title}>{summary}</summary>
      <div className="popover-menu">{children(close)}</div>
    </details>
  );
}

/** 下拉後用核取方塊複選；沒勾任何項目表示全部 */
export function MultiSelect<T extends string | number>({
  label,
  summary,
  options,
  value,
  onChange,
  empty,
}: {
  /** 沒勾任何項目時顯示 */
  label: string;
  /** 自訂顯示在按鈕上的內容 */
  summary?: ReactNode;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  /** 沒有任何選項時顯示 */
  empty?: ReactNode;
}) {
  const selected = options.filter((o) => value.includes(o.value));
  const toggle = (v: T, on: boolean) =>
    // 依選項順序排列
    onChange(options.map((o) => o.value).filter((x) => (x === v ? on : value.includes(x))));

  return (
    <Popover className="multi-select" title={label} summary={summary ?? (selected.length ? selected.map((o) => o.label).join('、') : label)}>
      {() => (
        <>
          {options.map((o) => (
            <label key={o.value} className="row small">
              <input type="checkbox" checked={value.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
              {o.label}
            </label>
          ))}
          {options.length === 0 && empty}
          {selected.length > 0 && (
            <button type="button" className="link" onClick={() => onChange([])}>
              清除
            </button>
          )}
        </>
      )}
    </Popover>
  );
}

/** 點星星評分；點目前的星等可清除 */
export function RatingInput({ value, onChange }: { value: number | null; onChange: (rating: number | null) => void }) {
  return (
    <span className="rating-input" role="group" aria-label="評分">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={value !== null && n <= value ? 'on' : ''}
          title={n === value ? '清除評分' : `${n} 星`}
          onClick={() => onChange(n === value ? null : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}
