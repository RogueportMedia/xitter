import { expect, test } from "bun:test";
import { PUBLIC_ORIGIN } from "../src/config";
import { TIDY_SCRIPT } from "../src/tidy";

function extractFromX(): (u: unknown) => string | null {
	const start = TIDY_SCRIPT.indexOf("var ORIGIN=");
	const end = TIDY_SCRIPT.indexOf("function rewriteXLinks", start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	const fn = new Function("location", `${TIDY_SCRIPT.slice(start, end)};return fromX;`);
	return fn({ href: `${PUBLIC_ORIGIN}/home` }) as (u: unknown) => string | null;
}

test("TIDY_SCRIPT parses cleanly", () => {
	expect(() => new Function(TIDY_SCRIPT)).not.toThrow();
});

test("fromX rewrites x.com URLs to PUBLIC_ORIGIN and leaves others untouched", () => {
	const fromX = extractFromX();
	expect(fromX("https://x.com/acme")).toBe(`${PUBLIC_ORIGIN}/acme`);
	expect(fromX("https://www.x.com/acme?tab=1#top")).toBe(`${PUBLIC_ORIGIN}/acme?tab=1#top`);
	expect(fromX("https://mobile.x.com/acme/status/123")).toBe(`${PUBLIC_ORIGIN}/acme/status/123`);
	expect(fromX("http://x.com/tos")).toBe(`${PUBLIC_ORIGIN}/tos`);
	expect(fromX("https://ads.x.com/campaign")).toBeNull();
	expect(fromX("https://help.x.com/en/rules")).toBeNull();
	expect(fromX("https://example.com/?ref=https://x.com/acme")).toBeNull();
	expect(fromX("/acme")).toBeNull();
	expect(fromX(null)).toBeNull();
});

