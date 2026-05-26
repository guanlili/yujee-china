import { eq } from 'drizzle-orm';
import { db } from '../client';
import { agentJobs, type NewAgentJob, type AgentJob } from '../schema';

type Tx = typeof db;

export const agentJobRepo = {
  findByRequestId: async (requestId: string): Promise<AgentJob | undefined> =>
    db.select().from(agentJobs).where(eq(agentJobs.requestId, requestId)).get(),

  create: async (tx: Tx, data: NewAgentJob): Promise<AgentJob> => {
    return tx.insert(agentJobs).values(data).returning().get();
  },

  update: async (tx: Tx, id: string, patch: Partial<NewAgentJob>): Promise<void> => {
    tx.update(agentJobs).set(patch).where(eq(agentJobs.id, id)).run();
  },
};
