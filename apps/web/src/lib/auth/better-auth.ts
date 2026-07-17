import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email/send-email';
import { renderVerificationEmail } from '@/lib/email/templates';
import { env } from '@/lib/env';
import { FREE_PLAN_CREDITS } from '@/config/pricing';

type SchemaModule = Record<string, unknown>;
type BetterAuthSchema = {
  user: unknown;
  session: unknown;
  account: unknown;
  verification: unknown;
};

const requiredTableExports = ['users', 'sessions', 'accounts', 'verifications'] as const;
const LOCAL_TRUSTED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3210',
  'http://127.0.0.1:3210',
];

export function getBetterAuthSchema(schemaModule: Partial<SchemaModule>): BetterAuthSchema {
  const missing = requiredTableExports.filter((key) => !schemaModule[key]);
  if (missing.length > 0) {
    throw new Error(`Missing better-auth tables from B2 schema: ${missing.join(', ')}`);
  }

  return {
    user: schemaModule.users,
    session: schemaModule.sessions,
    account: schemaModule.accounts,
    verification: schemaModule.verifications,
  };
}

export function createAuthOptions(schemaModule: SchemaModule = schema): BetterAuthOptions {
  return {
    baseURL: env.WEB_BASE_URL,
    trustedOrigins: LOCAL_TRUSTED_ORIGINS,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: getBetterAuthSchema(schemaModule),
      transaction: true,
    }),
    plugins: [nextCookies()],
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const email = renderVerificationEmail({
          locale: 'en',
          name: user.name ?? user.email,
          actionUrl: url,
        });
        await sendEmail({ to: user.email, ...email });
      },
    },
    user: {
      additionalFields: {
        isAdmin: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
        },
        creditBalance: {
          type: 'number',
          required: false,
          // New users get the free-plan welcome credits. Under per-photo billing
          // (1 credit = 1 photo) that is FREE_PLAN_CREDITS = 20, enough for a full
          // ~20-photo starter book. (Recording this as a SIGNUP_BONUS ledger row is
          // a follow-up — it needs the user committed, which conflicts with the
          // adapter's create transaction.)
          defaultValue: FREE_PLAN_CREDITS,
          input: false,
        },
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
  };
}

export function createAuth() {
  return betterAuth(createAuthOptions());
}

let authInstance: ReturnType<typeof createAuth> | null = null;

export function getAuth(): ReturnType<typeof createAuth> {
  authInstance ??= createAuth();
  return authInstance;
}
