import type { ReactNode } from 'react';

export const YUJEE_STATE_ASSETS = {
  empty: '/ui-states/01-empty-state-360.webp',
  loading: '/ui-states/02-loading-state-360.webp',
  error: '/ui-states/03-error-state-360.webp',
} as const;

type YujeeStateVariant = keyof typeof YUJEE_STATE_ASSETS;

interface YujeeStateProps {
  variant: YujeeStateVariant;
  title?: string;
  message?: string;
  imageAlt?: string;
  compact?: boolean;
  showDots?: boolean;
  children?: ReactNode;
  className?: string;
}

export function YujeeLoadingDots({ className = '' }: { className?: string }) {
  const dot = 'h-2 w-2 rounded-full [animation:yujee-dot-bounce_1.2s_ease-in-out_infinite]';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-hidden="true">
      <span className={`${dot} bg-[var(--grad-green)]`} />
      <span className={`${dot} bg-[var(--grad-purple)] [animation-delay:0.14s]`} />
      <span className={`${dot} bg-[var(--grad-lime)] [animation-delay:0.28s]`} />
    </span>
  );
}

export function YujeeState({
  variant,
  title,
  message,
  imageAlt = '',
  compact = false,
  showDots = variant === 'loading',
  children,
  className = '',
}: YujeeStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      <div className="relative">
        <img
          src={YUJEE_STATE_ASSETS[variant]}
          alt={imageAlt}
          className={`${compact ? 'w-[150px]' : 'w-[220px] sm:w-[260px]'} h-auto select-none`}
          draggable={false}
        />
      </div>
      {showDots && (
        <YujeeLoadingDots className={compact ? 'mt-2' : 'mt-3'} />
      )}
      {title && (
        <div className={`${compact ? 'mt-2 text-sm' : 'mt-4 text-lg'} font-semibold text-[var(--fg)]`}>
          {title}
        </div>
      )}
      {message && (
        <div className={`${compact ? 'mt-1 text-xs' : 'mt-2 text-sm'} max-w-[320px] leading-relaxed text-[var(--muted)]`}>
          {message}
        </div>
      )}
      {children && <div className={compact ? 'mt-3' : 'mt-5'}>{children}</div>}
    </div>
  );
}
