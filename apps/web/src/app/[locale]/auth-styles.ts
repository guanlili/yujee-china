/**
 * Shared look of the auth pages. Kept in its own dependency-free module so the
 * client forms can import it without pulling auth-shell.tsx (and the server
 * components it imports) into the client bundle.
 */

/** Layered radial wash — the one surface behind every auth page. */
export const AUTH_BACKGROUND =
  'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(19,184,166,0.07) 0%, transparent 70%),' +
  'radial-gradient(ellipse 60% 70% at 50% 100%, rgba(19,184,166,0.06) 0%, transparent 70%),' +
  'radial-gradient(ellipse 70% 50% at 100% 20%, rgba(218,244,94,0.06) 0%, transparent 70%),' +
  'var(--bg)';

/** Pill text input, as used by every auth form. */
export const AUTH_FIELD_CLASS =
  'w-full rounded-[var(--radius-pill)] border border-[var(--border-soft)] bg-[var(--surface)] px-[18px] py-3 text-[var(--text-base)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(19,184,166,0.12)] focus:outline-none';
