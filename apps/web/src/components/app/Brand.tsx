import Link from 'next/link';

interface Props {
  href: string;
}

export function Brand({ href }: Props) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 font-extrabold text-[var(--text-xl)] tracking-tight text-[var(--fg)]"
    >
      <span className="w-6 h-6 rounded-md bg-gradient-to-br from-[var(--grad-green)] via-[var(--grad-purple)] to-[var(--grad-lime)] opacity-90" />
      <span>Yujee</span>
    </Link>
  );
}
