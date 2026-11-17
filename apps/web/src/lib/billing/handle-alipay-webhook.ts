import { alipayService } from '@/services/billing/alipay-service';

// 支付宝异步通知入口。支付宝要求响应体是字面量 `success`(区分大小写),否则会
// 按 4h/8h/... 的节奏重试最多 24 小时;失败时回 `failure` 让其重试。
// 支付宝回的是 form-urlencoded 且要求纯文本响应,和 JSON 契约的通道不同,这里不能复用 fromException。
export async function handleAlipayWebhook(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    await alipayService.handleWebhook(rawBody);
    return new Response('success', { status: 200, headers: { 'content-type': 'text/plain' } });
  } catch {
    // 不把错误细节回给支付宝:它只看 success/failure,细节进日志由 service 负责。
    return new Response('failure', { status: 400, headers: { 'content-type': 'text/plain' } });
  }
}
