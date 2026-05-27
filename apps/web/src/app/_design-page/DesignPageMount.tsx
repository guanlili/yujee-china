'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  body: string;
  scripts: string[];
};

export function DesignPageMount({ body, scripts }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    for (const code of scripts) {
      try {
        const fn = new Function(code);
        fn();
      } catch (e) {
        console.error('design-page inline script failed', e);
      }
    }
  }, [scripts]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a') as HTMLAnchorElement | null;
      if (!target) return;
      const href = target.getAttribute('href') ?? '';
      if (href.startsWith('/') && !href.startsWith('//')) {
        e.preventDefault();
        router.push(href);
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [router]);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: body }} />;
}
