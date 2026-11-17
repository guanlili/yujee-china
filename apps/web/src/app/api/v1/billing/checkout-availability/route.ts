// GET /api/v1/billing/checkout-availability → { enabled: boolean }
//
// 只暴露一个布尔值:当前 provider 的凭据是否齐备。不返回 provider 名、不返回缺哪把钥匙、
// 不返回任何密钥内容 —— 对匿名访客也安全。
//
// 为什么需要这个接口:首页是服务端组件,可以直接调 isCheckoutConfigured() 把结果塞进
// props;但 /credits 页和相册里的购买弹窗都是客户端组件,它们拿不到 process.env。
// 加一个 GET 比把 prop 从服务端一路穿过 EditorBook(5,522 行)/ ChatPanel(3,002 行) 更
// 安全 —— 那条链路是上一轮明确否决过的改动面。
//
// 客户端拿到 false 之后只做一件事:禁用购买按钮、换成「暂不可购买」。拿到 true 或请求
// 失败都按可用处理 —— 判定失败不该顺手关掉一个本来能用的通道。

import { isCheckoutConfigured } from '@/lib/billing/checkout-availability';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(
    { enabled: isCheckoutConfigured() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
