import { afterEach, describe, expect, test } from "bun:test";
import type { User } from "../src/auth";
import { apiDocsPage } from "../src/api-docs";
import type { PostRow } from "../src/model";
import { postJson } from "../src/public-api";
import { settings } from "../src/settings";

const author = (extra: Partial<User> = {}): User => ({
	id: "1",
	screen_name: "alice",
	name: "Alice",
	bio: "",
	location: "",
	website: "",
	avatar_url: null,
	banner_url: null,
	verified_type: null,
	flag: null,
	status: "active",
	protected: false,
	created_at: new Date("2025-01-01T00:00:00Z"),
	instance: null,
	...extra,
});

const post = (extra: Partial<PostRow> = {}, authorExtra: Partial<User> = {}): PostRow => ({
	id: "100",
	text: "hello",
	reply_to_id: null,
	conversation_id: "100",
	quote_id: null,
	created_at: new Date("2025-01-02T00:00:00Z"),
	reply_user_id: null,
	reply_screen_name: null,
	like_count: 0,
	repost_count: 0,
	bookmark_count: 0,
	reply_count: 0,
	quote_count: 0,
	liked: false,
	reposted: false,
	bookmarked: false,
	author: author(authorExtra),
	...extra,
});

const originalInstanceName = settings().instance_name;

afterEach(() => {
	settings().instance_name = originalInstanceName;
});

describe("public API post source labels", () => {
	test("returns the stored source for local posts without HTML escaping", () => {
		expect(postJson(post({ source: "Xitter API" })).source).toBe("Xitter API");
		expect(postJson(post({ source: "App: Tom & Jerry" })).source).toBe("App: Tom & Jerry");
		expect(postJson(post({ source: "Xitter for UFO" })).source).toBe("Xitter for UFO");
	});

	test("falls back to the instance web source when source is absent", () => {
		settings().instance_name = "Chirp";
		expect(postJson(post({ source: undefined })).source).toBe("Chirp for Web");
	});

	test("formats federated post sources with the author's instance", () => {
		expect(postJson(post({ source: "Xitter API" }, { instance: "other.example" })).source).toBe("Xitter API - other.example");
		expect(postJson(post({ source: "other.example" }, { instance: "other.example" })).source).toBe("Xitter for Web - other.example");
		expect(postJson(post({ source: undefined }, { instance: "other.example" })).source).toBe("Xitter for Web - other.example");
	});

	test("/api documentation describes the post source field and token labels", async () => {
		settings().instance_name = "Chirp";
		const res = await apiDocsPage(new Request("https://example.test/api"));
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("<code>source</code>");
		expect(html).toContain("Chirp for Web");
		expect(html).toContain("Xitter API");
		expect(html).toContain("App: &lt;name&gt;");
	});
});
