import {
  V3InternalAgentDataRequest,
  V3InternalAgentDataResponse,
  type V3InternalAgentDataRequest as V3InternalAgentDataRequestT,
} from '@yujee/contracts';
import { ok } from '@/lib/api/ok';
import { albumService } from '@/services/album/album-service';

export type AgentDataRequest = V3InternalAgentDataRequestT;

export function parseAgentDataRequest(url: URL): V3InternalAgentDataRequestT {
  return V3InternalAgentDataRequest.parse(Object.fromEntries(url.searchParams.entries()));
}

export async function handleAgentData(req: Request) {
  const query = parseAgentDataRequest(new URL(req.url));
  return ok(V3InternalAgentDataResponse.parse(await albumService.getInternalAgentData(query)));
}
