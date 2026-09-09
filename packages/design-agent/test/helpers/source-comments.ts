/**
 * 源码正则守卫的公共前置:**断言前先剥注释**。
 *
 * 为什么这是硬规矩:守卫用正则在源码里找「某处确实写了这一笔」,而注释也是源码。
 * 只要有人在注释里提一句被断言的标识符,`assert.match` 就被喂饱、`deepEqual` 的
 * 清单就多一项 —— 守卫从此永远绿,而它存在的全部理由就是拦漂移。本仓已经栽过
 * 三次假绿,所以这个包里所有读源码的守卫一律先过这个函数。
 *
 * 反过来 `assert.doesNotMatch` 会被注释喂成假红,同样得剥。
 *
 * ⚠️ 唯一的例外是**故意断言注释内容**的守卫(例如 image-fit.test.ts 要求顶部注释
 * 写明「人脸框恒空」),那种守卫的对象就是注释本身,剥了就没意义了。
 *
 * 自测在 test/source-comments.test.ts —— 剥注释的工具自己错了,底下所有守卫一起假绿。
 */

/**
 * 去掉 `//` 行注释与 `/* *\/` 块注释;字符串/模板字面量里的 `//` 不误伤
 * (用最朴素的状态机,不做完整 JS 词法分析)。
 *
 * 已知边界:不识别正则字面量,`/ab\/\/cd/` 这类正则里的 `//` 会被当成行注释。
 * 本包的守卫都不读带正则字面量的行,真要读就换解析器。
 */
export function stripComments(source: string): string {
	let out = "";
	let index = 0;
	let quote: string | null = null;
	while (index < source.length) {
		const char = source[index]!;
		const next = source[index + 1];
		if (quote) {
			if (char === "\\") {
				out += char + (next ?? "");
				index += 2;
				continue;
			}
			if (char === quote) quote = null;
			out += char;
			index += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
			index += 2;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}
