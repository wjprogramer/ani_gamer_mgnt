import type { MouseEvent } from 'react';

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
