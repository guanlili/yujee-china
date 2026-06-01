# 生成相册的积分锁定 · 结算需求

> 产品经理产出。**这是独立于「UI 还原 gap」的另一块需求**——那块是修页面(前端视觉),这块是积分账务的事务逻辑(后端计费正确性)。两者刻意分开,互不混。
> 本文只定**产品规则**(什么时候锁、什么时候扣、什么时候退),不定技术实现(怎么接、放哪个 service)——那是架构的事。
> 本文基于实读 `apps/web/src/services/credit/` + `app/api/v1/jobs/` 现状。

---

## 一句话问题

用户生成相册时,**没有积分校验、没有锁定、没有扣减**——余额为 0 也能发起生成,生成失败了账务也不对。需要把"先锁定、成功才扣、失败退回"的逻辑接上。

## 给谁用

所有发起生成的注册用户(消耗积分的核心动作)。

## 现状(实测,关键)

**账务零件已经全部造好,只是没装到生成流程上:**

| 已存在 ✅ | 位置 |
|---|---|
| `precheck(userId, amount)` 余额校验,不足抛 `CREDIT_INSUFFICIENT` | `services/credit/credit-service.ts` |
| `hold(...)` 锁定:建 `credit_holds` 行 + 挂到 `albums.credit_hold_id`,余额不变,落 0-delta 账本痕迹 | 同上 |
| `settle(tx, userId, holdId)` 结算:实扣余额、关闭 hold | 同上 |
| `release(holdId)` / `releaseByAlbum(albumId)` 释放锁定 | 同上 |
| `CREDIT_COST_PER_ALBUM` 单本相册成本常量(**金额已定义,本需求不改它**) | credit-service 引用 |
| `credit_holds` 表 + ledger 的 `GENERATION_HOLD/SETTLE/RELEASE` 理由 | `db/schema.ts`、migrations |
| `zombie-sweeper` 卡死任务清扫器(可用于释放悬挂锁定) | `services/job/zombie-sweeper.ts` |

**缺口(就是本需求要补的):**
- ❌ 生成入口 `POST /api/v1/jobs`(`app/api/v1/jobs/route.ts`)**完全没调积分**——没 precheck、没 hold。
- ❌ 生成完成/失败的状态流转(`generation-service` 等)**没在结束时 settle / release**。
- 即:**precheck/hold/settle/release 这套原语都现成,但没被生成生命周期调用。**

## why now

订单积分扣减这块"还有很大问题"(用户原话)。已上线、用户在真实消耗积分,账务不接 = 漏钱 + 失败误扣,属于上线后必须尽快补的计费正确性问题。

## 目标逻辑(最小可行)

按"锁定 → 按结果结算"的三段式:

1. **发起生成时(jobs 提交)**
   - 先 `precheck`:余额 ≥ `CREDIT_COST_PER_ALBUM`?
     - **不足** → 拦截,不发起生成,提示去充值/升级(UX 见待决策)。
     - **足够** → `hold` 锁定该笔成本(余额此刻**不变**,只是冻结额度)。
   - 然后才真正派发生成任务。
2. **生成结果回来时(服务端状态流转)**
   - 状态 = **成功(COMPLETED)** → `settle`:把锁定的额度**实扣**,余额减少,hold 关闭。
   - 状态 = **失败 / 超时(FAILED / TIMEOUT)** → `release`:**释放锁定,不扣分**。
3. **全程账本可审计**(HOLD/SETTLE/RELEASE 痕迹)。

> 核心承诺:**锁定在前,扣减在后,且只在生成成功时扣;失败一分不扣。**

## 成功标准(可度量)

- 余额 < 单本成本 → **无法发起**生成(被 precheck 拦)。
- 生成失败 / 超时 → 该笔积分**完整退回**,余额不减。
- 生成成功 → 恰好扣 `CREDIT_COST_PER_ALBUM`,不多不少。
- **不存在永久悬挂的 hold**(卡死任务的锁定最终会被释放)。

## 不做(scope 边界,显式)

- 不改定价、不改 `CREDIT_COST_PER_ALBUM` 数值。
- 不做编辑器里二次修改 / 重新排版的计费(本需求只管**首次生成**这一次锁定+扣减)。
- 不做退款 / 发票逻辑(那是 billing 域,另说)。
- 不碰 UI 视觉还原(那是另一份 `ui-restore-gap.md`)。

## 待用户决策 🟡(我不替你定的产品点)

1. **余额不足时的拦截 UX**:拦在哪一步——
   (a) `/create` 提交**前**就置灰/提示(需要前端先知道余额和成本),还是
   (b) 提交**后**由 precheck 报错弹提示?
   提示文案 + 跳哪:去 `/pricing` 升级订阅,还是去 `/credits` 充值积分?(这条会牵动 UI 文档里的 create 页和 credits pill)
2. **失败后重试是否重新计费**:用户对一个失败的生成点"重试",是开一笔**新的 hold + 新校验**,还是复用原锁定?(我建议:新 hold,逻辑最干净。)
3. **悬挂锁定的释放策略**:生成卡死/超时,锁定的积分多久、由谁释放?是否复用现成的 `zombie-sweeper` 调 `releaseByAlbum`?(此项偏架构,列出来让架构接,产品上只要求"最终一定释放"。)

---

## 与 UI 还原需求的关系

- **完全独立**,各走各的文档 / issue。
- 唯一交叉点:上面待决策 #1 的"余额不足提示"会落在 `/create` 页和顶栏 credits pill 上——那两处的**视觉**归 `ui-restore-gap.md`,本文档只定**计费规则与拦截行为**。架构切活时注意别重复。
</content>
