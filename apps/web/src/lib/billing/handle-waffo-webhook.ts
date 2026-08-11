import { waffoService } from '@/services/billing/waffo-service';
import { fromException } from '@/lib/api/from-exception';

// Waffo webhook 入口。单一挂载(/api/webhooks/waffo);与 creem 不同,Waffo 的
// 投递地址在其 dashboard 配置一次,没有历史双路径包袱。
export async function handleWaffoWebhook(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-waffo-signature');
    await waffoService.handleWebhook(rawBody, signature);
    return Response.json({ received: true });
  } catch (e) {
    return fromException(e);
  }
}
