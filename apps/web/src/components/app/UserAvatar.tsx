interface UserAvatarProps {
  initial?: string | null;
  size?: number;
  className?: string;
  ariaLabel?: string;
}

export function UserAvatar({
  initial,
  size = 40,
  className = '',
  ariaLabel,
}: UserAvatarProps) {
  const label = (initial?.trim() || '·').slice(0, 1).toUpperCase();
  return (
    <span
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : 'true'}
      className={`inline-grid shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--grad-green),var(--grad-purple)_58%,var(--grad-lime))] p-[3px] shadow-[0_2px_10px_rgba(0,0,0,0.12)] ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="user-avatar-initial grid h-full w-full place-items-center rounded-full bg-[var(--fg)] font-semibold uppercase text-white"
        data-user-avatar-initial=""
        style={{ fontSize: Math.max(12, Math.round(size * 0.38)) }}
      >
        {label}
      </span>
    </span>
  );
}
