import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "@earendil-works/pi-agent-core";
import { createDefaultAlbumSkills } from "./skills.ts";

/**
 * 文件化 Skill 加载器：扫描 skills/<name>/SKILL.md（YAML frontmatter 带
 * name/description，正文即技能内容）。改 markdown 即改技能，无需动代码；
 * 目录缺失或为空时退回内置默认技能。
 */

export interface AlbumSkillsLoaderOptions {
	/** skills 根目录；默认为包内 skills/（可用 YUJEE_DESIGN_SKILLS_DIR 覆盖）。 */
	skillsDir?: string;
	env?: Record<string, string | undefined>;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function defaultSkillsDir(env: Record<string, string | undefined> = process.env): string {
	const fromEnv = env.YUJEE_DESIGN_SKILLS_DIR?.trim();
	if (fromEnv) return fromEnv;
	// src/core/album 与 dist/core/album 深度一致，上三层即包根。
	return join(moduleDir, "..", "..", "..", "skills");
}

export function loadAlbumSkills(options: AlbumSkillsLoaderOptions = {}): Skill[] {
	const skillsDir = options.skillsDir ?? defaultSkillsDir(options.env ?? process.env);
	const skills: Skill[] = [];
	if (existsSync(skillsDir)) {
		for (const entry of readdirSync(skillsDir).sort()) {
			const skillPath = join(skillsDir, entry, "SKILL.md");
			try {
				if (!statSync(join(skillsDir, entry)).isDirectory() || !existsSync(skillPath)) continue;
				const parsed = parseSkillMarkdown(readFileSync(skillPath, "utf8"), skillPath);
				if (parsed) skills.push(parsed);
			} catch {
				// 单个技能文件损坏不拖垮整体加载。
			}
		}
	}
	return skills.length > 0 ? skills : createDefaultAlbumSkills();
}

/** 解析 SKILL.md：`---` 包围的 frontmatter（仅取 name/description）+ 正文。 */
export function parseSkillMarkdown(raw: string, filePath: string): Skill | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.trim());
	if (!match) return undefined;
	const frontmatter = match[1] ?? "";
	const content = (match[2] ?? "").trim();
	const name = readFrontmatterValue(frontmatter, "name");
	const description = readFrontmatterValue(frontmatter, "description");
	if (!name || !description || !content) return undefined;
	return { name, description, filePath, content };
}

function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
	for (const line of frontmatter.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith(`${key}:`)) continue;
		const value = trimmed
			.slice(key.length + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (value) return value;
	}
	return undefined;
}
