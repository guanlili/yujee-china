'use client';

import { useEffect, useState } from 'react';

export interface ChromeUser {
  name: string | null;
  email: string;
  avatarInitial: string;
  creditBalance: number;
}

export interface ChromeSession {
  user: ChromeUser | null;
  loading: boolean;
}

function initialFor(user: { name: string | null; email: string }): string {
  const source = user.name?.trim() || user.email;
  return source.charAt(0).toUpperCase();
}

export function useChromeSession(): ChromeSession {
  const [user, setUser] = useState<ChromeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const meRes = await fetch('/api/v1/user/me');
        const meJson = await meRes.json();
        if (!active) return;
        if (meJson.ok) {
          setUser({
            name: meJson.data.name,
            email: meJson.data.email,
            avatarInitial: initialFor(meJson.data),
            creditBalance: meJson.data.creditBalance ?? 0,
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}
