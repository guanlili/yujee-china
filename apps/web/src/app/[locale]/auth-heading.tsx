/**
 * The h1 of an auth card. No hooks and no server-only imports, so both the
 * server pages and the client forms can render it.
 */
export function AuthHeading({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="mb-2 text-[32px] font-extrabold tracking-[-0.02em] text-[var(--fg)]"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {children}
    </h1>
  );
}
