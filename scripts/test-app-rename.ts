import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { AUDIT_ACTIONS } from "../src/admin";
import { validAppName } from "../src/oauth";
import { validPlatformLabel } from "../src/platforms";

describe("app rename validation", () => {
	test("validAppName enforces 1–80 code points without control characters", () => {
		expect(validAppName("")).toBe(false);
		expect(validAppName("a")).toBe(true);
		expect(validAppName("a".repeat(80))).toBe(true);
		expect(validAppName("a".repeat(81))).toBe(false);
		expect(validAppName("🚀".repeat(80))).toBe(true);
		expect(validAppName("🚀".repeat(81))).toBe(false);
		expect(validAppName("line\nbreak")).toBe(false);
		expect(validAppName("tab\there")).toBe(false);
		expect(validAppName("del\x7fchar")).toBe(false);
	});

	test("validPlatformLabel enforces 1–80 code points without control characters", () => {
		expect(validPlatformLabel("")).toBe(false);
		expect(validPlatformLabel("Xitter for Android")).toBe(true);
		expect(validPlatformLabel("a".repeat(80))).toBe(true);
		expect(validPlatformLabel("a".repeat(81))).toBe(false);
		expect(validPlatformLabel("🚀".repeat(80))).toBe(true);
		expect(validPlatformLabel("🚀".repeat(81))).toBe(false);
		expect(validPlatformLabel("bad\r\nlabel")).toBe(false);
		expect(validPlatformLabel("null\x00byte")).toBe(false);
	});

	test("AUDIT_ACTIONS includes rename_platform", () => {
		expect(AUDIT_ACTIONS).toContain("rename_platform");
	});
});

describe("admin#apps rename UI", () => {
	const loadAppsRenderer = async () => {
		const source = await Bun.file(new URL("../src/admin.html", import.meta.url)).text();
		const escLine = source.split("\n").find((line) => line.startsWith("const esc = "))!;
		const start = source.indexOf("\tasync apps(main) {");
		const end = source.indexOf("\n\tasync oauth(main) {", start);
		const method = source.slice(start, end).replace(/,\s*$/, "");
		return new Function("api", "can", "when", "ask", "act", "route", "$", "prompt", `${escLine}\nconst o = {\n${method}\n};\nreturn o.apps;`);
	};

	test("renders Rename for active apps, omits it for revoked apps and non-admins, and calls renamePlatform", async () => {
		const factory = await loadAppsRenderer();
		const platforms = [
			{ id: "101", label: 'Xitter "Beta" & Co', revoked: false, created_at: "2026-01-01T00:00:00Z" },
			{ id: "102", label: "Old App", revoked: true, created_at: "2026-01-01T00:00:00Z" },
		];
		const calls: { action: string; body: any }[] = [];
		const prompts: { message: string; initial: string }[] = [];
		let routed = 0;
		let pending: Promise<unknown> = Promise.resolve();
		let nextPrompt: string | null = "Xitter for iOS";

		const { document } = parseHTML("<!doctype html><main></main>");
		const main = document.querySelector("main")!;
		const render = factory(
			async (action: string, body?: any) => {
				if (action === "platforms") return { platforms };
				calls.push({ action, body });
				return {};
			},
			(role: string) => role === "admin",
			() => "Jan 1, 2026",
			async () => true,
			(fn: () => Promise<unknown>) => (pending = fn()),
			async () => { routed++; },
			(selector: string) => main.querySelector(selector),
			(message: string, initial: string) => {
				prompts.push({ message, initial });
				return nextPrompt;
			},
		);

		await render(main);
		const renameButtons = [...main.querySelectorAll("[data-rename]")];
		expect(renameButtons).toHaveLength(1);
		expect(renameButtons[0]!.getAttribute("data-rename")).toBe("101");
		expect(renameButtons[0]!.getAttribute("data-label")).toBe('Xitter "Beta" & Co');

		// cancel does nothing
		nextPrompt = null;
		(renameButtons[0] as any).onclick();
		await pending;
		expect(calls).toHaveLength(0);

		// unchanged label does nothing
		nextPrompt = '  Xitter "Beta" & Co  ';
		(renameButtons[0] as any).onclick();
		await pending;
		expect(calls).toHaveLength(0);

		// new label invokes renamePlatform and re-routes
		nextPrompt = "Xitter for iOS";
		(renameButtons[0] as any).onclick();
		await pending;
		await new Promise((r) => setTimeout(r, 0));
		expect(prompts[0]).toEqual({ message: "New name for the app", initial: 'Xitter "Beta" & Co' });
		expect(calls).toEqual([{ action: "renamePlatform", body: { id: "101", label: "Xitter for iOS" } }]);
		expect(routed).toBe(1);

		// non-admin sees no Rename button
		const nonAdminRender = factory(
			async () => ({ platforms }),
			() => false,
			() => "Jan 1, 2026",
			async () => true,
			async (fn: () => Promise<unknown>) => await fn(),
			async () => {},
			(selector: string) => main.querySelector(selector),
			() => null,
		);
		await nonAdminRender(main);
		expect(main.querySelectorAll("[data-rename]")).toHaveLength(0);
	});
});
