import { getAuth } from '@/lib/auth/better-auth';

async function handler(req: Request): Promise<Response> {
  return getAuth().handler(req);
}

export { handler as GET, handler as POST };
