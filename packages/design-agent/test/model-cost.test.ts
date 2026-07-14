import assert from "node:assert/strict";
import test from "node:test";
import { estimateCost } from "../src/core/model-cost.ts";

// design-agent 的花费此前【恒为 $0】：它走火山方舟，而 packages/ai 的方舟 provider
// 把所有模型单价写死为 cost {input:0, output:0}。那是零、不是 null，观测台把它当免费
// 累加进总额 —— 多轮带工具的设计对话循环（很可能是 token 消耗最大的一环）在账上不花钱。
// 成本现在从 packages/contracts/pricing/model-prices.json 算，与 engine 同一张表。

test("线上真实在跑的模型都能算出成本（带日期后缀也要命中）", () => {
	for (const model of [
		"deepseek-v4-pro-260425", // design-agent 实际配的就是这个
		"deepseek-v4-flash-260425",
		"doubao-seed-1-6-vision-250815",
		"gemini-2.5-flash",
	]) {
		const cost = estimateCost(model, 1000, 100);
		assert.ok(cost, `${model} 不在价目表里，它的花费会被静默丢掉`);
		assert.ok(cost.total > 0, `${model} 成本算成了 0 —— 这正是要修的 bug`);
	}
});

test("design-agent 的模型绝不能再算出 0 成本", () => {
	// 真实 trace 里的那条：1364 input / 124 output，此前 costUsd: 0。
	const cost = estimateCost("deepseek-v4-pro-260425", 1364, 124);
	assert.ok(cost);
	assert.notEqual(cost.total, 0, "有 token 却零成本 = 方舟 provider 的零单价又漏进来了");
	assert.equal(cost.currency, "USD");
});

test("未知模型返回 undefined，不返回 0", () => {
	// 0 会被观测台当成“免费”累加；undefined 让调用方写 null，不显示。
	assert.equal(estimateCost("never-heard-of-this", 1000, 100), undefined);
});

test("方舟按输入长度分档", () => {
	const mid = estimateCost("doubao-seed-1-6", 100_000, 0);
	const top = estimateCost("doubao-seed-1-6", 1_000_000, 0);
	assert.ok(mid && top);
	assert.equal(mid.input, 0.12); // 第二档 1.2 CNY/M
	assert.equal(top.input, 2.4); // 兜底档 2.4 CNY/M
	assert.equal(mid.currency, "CNY");
});

test("缓存命中按 cacheRead 价，不按 input 全价", () => {
	const full = estimateCost("deepseek-v4-flash", 1_000_000, 0, 0);
	const cached = estimateCost("deepseek-v4-flash", 1_000_000, 0, 1_000_000);
	assert.ok(full && cached);
	assert.equal(full.input, 0.14);
	assert.equal(cached.input, 0.0028); // 50 倍差
});

test("脏数据（命中数 > 总输入）不会把成本算成负的", () => {
	const cost = estimateCost("deepseek-v4-flash", 1000, 0, 999_999);
	assert.ok(cost);
	assert.ok(cost.input >= 0);
});
