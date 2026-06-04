'use client';

import { useEffect, useState } from 'react';

export interface ChromeUser {
  name: string | null;
  email: string;
  avatarInitial: string;
  planLabel: string;
}

export interface ChromeSession {
  user: ChromeUser | null;
  balance: number | null;
  plan: string;
  loading: boolean;
}

function initialFor(user: { name: string | null; email: string }): string {
  const source = user.name?.trim() || user.email;
  return source.charAt(0).toUpperCase();
}

export function useChromeSession(): ChromeSession {
  const [user, setUser] = useState<ChromeUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [meRes, balanceRes] = await Promise.all([
          fetch('/api/v1/user/me'),
          fetch('/api/v1/credit/balance'),
        ]);
        const meJson = await meRes.json();
        const balanceJson = await balanceRes.json();
        if (!active) return;
        if (meJson.ok) {
          setUser({
            name: meJson.data.name,
            email: meJson.data.email,
            avatarInitial: initialFor(meJson.data),
            planLabel: meJson.data.plan?.label ?? 'Free',
          });
        }
        if (balanceJson.ok) setBalance(balanceJson.data.balance);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { user, balance, plan: user?.planLabel ?? 'Free', loading };
}
