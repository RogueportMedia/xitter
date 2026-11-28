import { afterEach, describe, expect, test } from "bun:test";
import type { User } from "../src/auth";
import { apiDocsPage } from "../src/api-docs";
import { PUBLIC_ORIGIN } from "../src/config";
import type { PostRow } from "../src/model";
import type { ApiNotification } from "../src/notifications";
import { notificationJson, parseIsoMs, publicApi } from "../src/public-api";
import { settings } from "../src/settings";

const user = (extra: Partial<User> = {}): User => ({
	id: "10",
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
	created_at: new Date("2025-01-01T00:00:00.000Z"),
	instance: null,
	...extra,
});

const post = (extra: Partial<PostRow> = {}, authorExtra: Partial<User> = {}): PostRow => ({
	id: "100",
	text: "hello world",
	reply_to_id: null,
	conversation_id: "100",
	quote_id: null,
	created_at: new Date("2025-01-02T00:00:00.000Z"),
	reply_user_id: null,
	reply_screen_name: null,
	like_count: 2,
	repost_count: 1,
	bookmark_count: 0,
	reply_count: 0,
	quote_count: 0,
	liked: false,
	reposted: false,
	bookmarked: false,
	author: user(authorExtra),
	...extra,
});

const originalInstanceName = settings().instance_name;

afterEach(() => {
	settings().instance_name = originalInstanceName;
});

describe("public API notifications", () => {
	test("notificationJson serializes post-backed, follow and staff notifications", () => {
		const alice = user({ id: "10", screen_name: "alice", name: "Alice" });
		const bob = user({ id: "11", screen_name: "bob", name: "Bob" });
		const p = post({ id: "100", text: "my post" }, { id: "1", screen_name: "you", name: "You" });

		const like: ApiNotification = {
			id: "like-100",
			type: "like",
			at: Date.parse("2026-11-28T04:55:00.123Z"),
			unread: true,
			text: "Alice and Bob liked your post",
			url: `${PUBLIC_ORIGIN}/you/status/100`,
			actors: [alice, bob],
			actorsCount: 5,
			post: p,
		};
		const likeOut = notificationJson(like);
		expect(likeOut.id).toBe("like-100");
		expect(likeOut.type).toBe("like");
		expect(likeOut.created_at).toBe("2026-11-28T04:55:00.123Z");
		expect(likeOut.unread).toBe(true);
		expect(likeOut.text).toBe("Alice and Bob liked your post");
		expect(likeOut.url).toBe(`${PUBLIC_ORIGIN}/you/status/100`);
		expect(likeOut.actors.map((a) => a.screen_name)).toEqual(["alice", "bob"]);
		expect(likeOut.actors_count).toBe(5);
		expect(likeOut.post?.id).toBe("100");

		const staff: ApiNotification = {
			id: "staff-9",
			type: "staff",
			at: Date.parse("2026-11-28T04:50:00.000Z"),
			unread: false,
			text: "A message from the Xitter team: welcome",
			url: `${PUBLIC_ORIGIN}/account/notices`,
			actors: [],
			actorsCount: 0,
			post: null,
		};
		const staffOut = notificationJson(staff);
		expect(staffOut).toEqual({
			id: "staff-9",
			type: "staff",
			created_at: "2026-11-28T04:50:00.000Z",
			unread: false,
			text: "A message from the Xitter team: welcome",
			url: `${PUBLIC_ORIGIN}/account/notices`,
			actors: [],
			actors_count: 0,
			post: null,
		});
	});

	test("parseIsoMs accepts valid ISO-8601 timestamps and rejects invalid inputs", () => {
		expect(parseIsoMs("2026-11-28T04:55:00.123Z", "since")).toBe(Date.parse("2026-11-28T04:55:00.123Z"));
		expect(parseIsoMs("2026-11-28T06:55:00+02:00", "up_to")).toBe(Date.parse("2026-11-28T04:55:00.000Z"));
		expect(parseIsoMs("1970-01-01T00:00:00Z", "since")).toBe(0);

		for (const bad of [null, 12345, "", "not-a-date", "2026", "2026-11-28", "1732761234567", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-01T25:00:00Z"]) {
			expect(() => parseIsoMs(bad, "up_to")).toThrow("up_to must be an ISO-8601 timestamp.");
		}
	});

	test("notification endpoints require authentication", async () => {
		for (const [method, path] of [
			["GET", "/notifications"],
			["GET", "/notifications/unread"],
			["POST", "/notifications/read"],
		] as const) {
			const url = new URL(`https://example.test/api/v1${path}`);
			const res = await publicApi(new Request(url, { method }), url);
			expect(res.status).toBe(401);
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
		}
	});

	test("/api documentation describes the notifications endpoints and shape", async () => {
		settings().instance_name = "Chirp";
		const res = await apiDocsPage(new Request("https://example.test/api"));
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("/notifications");
		expect(html).toContain("/notifications/unread");
		expect(html).toContain("/notifications/read");
		expect(html).toContain('id="notifications"');
		expect(html).toContain("<code>type=mentions</code>");
		expect(html).toContain("<code>unread=true</code>");
		expect(html).toContain("<code>since</code>");
		expect(html).toContain("<code>up_to</code>");
		expect(html).toContain("<code>last_seen_at</code>");
		expect(html).toContain("<code>actors_count</code>");
		expect(html).toContain("A notification:");
	});
});
