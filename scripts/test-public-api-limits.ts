import { afterEach, describe, expect, test } from "bun:test";
import { apiDocsPage } from "../src/api-docs";
import { postLimitsJson, publicApi } from "../src/public-api";
import { settings } from "../src/settings";
import { LINK_WEIGHT, SHORT_POST } from "../src/textlen";

const originalInstanceName = settings().instance_name;
const originalPostLimits = { ...settings().post_limits };
const originalMaintenance = settings().operations.maintenance;

afterEach(() => {
	settings().instance_name = originalInstanceName;
	settings().post_limits = { ...originalPostLimits };
	settings().operations.maintenance = originalMaintenance;
});

describe("public API post character limits", () => {
	test("postLimitsJson exposes instance limits, preview cutoff and weights", () => {
		const anon = postLimitsJson();
		expect("limit" in anon).toBe(false);
		expect(anon).toEqual({
			short_post: SHORT_POST,
			limits: {
				none: originalPostLimits.none,
				blue: originalPostLimits.blue,
				business: originalPostLimits.business,
				government: originalPostLimits.government,
				government_individual: originalPostLimits.government,
			},
			weights: { default: 1, wide: 2, link: LINK_WEIGHT },
		});
	});

	test("postLimitsJson resolves account limit by verified_type", () => {
		settings().post_limits = { none: 500, blue: 1000, business: 5000, government: 10000 };
		expect(postLimitsJson(null).limit).toBe(500);
		expect(postLimitsJson("blue").limit).toBe(1000);
		expect(postLimitsJson("business").limit).toBe(5000);
		expect(postLimitsJson("government").limit).toBe(10000);
		expect(postLimitsJson("government_individual").limit).toBe(10000);
		expect(postLimitsJson("unknown").limit).toBe(500);
	});

	test("GET /api/v1/posts/limits works without authentication", async () => {
		settings().post_limits = { none: 1200, blue: 8000, business: 32000, government: 64000 };
		const url = new URL("https://example.test/api/v1/posts/limits");
		const res = await publicApi(new Request(url), url);
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("x-rate-limit-remaining")).not.toBeNull();
		const body = await res.json();
		expect(body).toEqual({
			data: {
				short_post: SHORT_POST,
				limits: {
					none: 1200,
					blue: 8000,
					business: 32000,
					government: 64000,
					government_individual: 64000,
				},
				weights: { default: 1, wide: 2, link: LINK_WEIGHT },
			},
		});
	});

	test("GET /api/v1/posts/limits rejects an invalid authorization header", async () => {
		const url = new URL("https://example.test/api/v1/posts/limits");
		const res = await publicApi(new Request(url, { headers: { authorization: "Bearer not-a-valid-token" } }), url);
		expect(res.status).toBe(401);
	});

	test("non-GET /api/v1/posts/limits still requires authentication", async () => {
		const url = new URL("https://example.test/api/v1/posts/limits");
		const res = await publicApi(new Request(url, { method: "POST" }), url);
		expect(res.status).toBe(401);
	});

	test("GET /api/v1/posts/limits returns 503 during maintenance", async () => {
		settings().operations.maintenance = true;
		const url = new URL("https://example.test/api/v1/posts/limits");
		const res = await publicApi(new Request(url), url);
		expect(res.status).toBe(503);
	});

	test("/api documentation describes /posts/limits and current configured limits", async () => {
		settings().instance_name = "Chirp";
		settings().post_limits = { none: 1234, blue: 5678, business: 9012, government: 34567 };
		const res = await apiDocsPage(new Request("https://example.test/api"));
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("/posts/limits");
		expect(html).toContain('id="post-limits"');
		expect(html).toContain("1,234");
		expect(html).toContain("5,678");
		expect(html).toContain("9,012");
		expect(html).toContain("34,567");
		expect(html).toContain("<code>short_post</code>");
		expect(html).toContain("<code>government_individual</code>");
	});
});
