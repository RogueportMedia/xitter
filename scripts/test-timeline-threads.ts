import { describe, expect, test } from "bun:test";
import type { User } from "../src/auth";
import { type PostRow, selfThreadEntry } from "../src/model";
import { TIMELINE_THREAD_SIZE, type TimelinePost, groupSelfThreads } from "../src/threads";

function makeUser(id: string, screen_name: string): User {
	return {
		id,
		screen_name,
		name: screen_name,
		bio: "",
		location: "",
		avatar_url: null,
		banner_url: null,
		verified_type: null,
		created_at: new Date("2026-01-01T00:00:00Z"),
	};
}

const alice = makeUser("10", "alice");
const bob = makeUser("20", "bob");

function makePost(id: string, author: User, opts: { replyTo?: PostRow; conversationId?: string; text?: string; community?: Record<string, unknown>; communityId?: string } = {}): PostRow {
	return {
		id,
		text: opts.text ?? `post ${id}`,
		reply_to_id: opts.replyTo?.id ?? null,
		conversation_id: opts.conversationId ?? opts.replyTo?.conversation_id ?? id,
		quote_id: null,
		created_at: new Date("2026-01-01T00:00:00Z"),
		reply_user_id: opts.replyTo?.author.id ?? null,
		reply_screen_name: opts.replyTo?.author.screen_name ?? null,
		like_count: 0,
		repost_count: 0,
		bookmark_count: 0,
		reply_count: 0,
		quote_count: 0,
		liked: false,
		reposted: false,
		bookmarked: false,
		author,
		...(opts.community ? { community: opts.community, community_id: opts.communityId ?? "99" } : {}),
	};
}

const item = (post: PostRow, repost?: { by: User; created_at: Date }): TimelinePost => ({ id: post.id, post, ...(repost ? { repost } : {}) });

describe("timeline self-thread grouping", () => {
	test("leaves single posts without self-replies standalone", () => {
		const p1 = makePost("100", alice);
		const p2 = makePost("200", bob);
		const groups = groupSelfThreads([item(p2), item(p1)], []);
		expect(groups.map((g) => [g.kind, g.item.id])).toEqual([
			["single", "200"],
			["single", "100"],
		]);
	});

	test("expands a root post into its self-thread on replies-off feeds", () => {
		const p1 = makePost("100", alice);
		const p2 = makePost("101", alice, { replyTo: p1 });
		const p3 = makePost("102", alice, { replyTo: p2 });
		const groups = groupSelfThreads([item(p1)], [p2, p3]);
		expect(groups).toHaveLength(1);
		const g = groups[0]!;
		expect(g.kind).toBe("thread");
		if (g.kind === "thread") {
			expect(g.posts.map((p) => p.id)).toEqual(["100", "101", "102"]);
			expect(g.allIds).toEqual(["100", "101", "102"]);
			expect(g.hasMore).toBe(false);
		}
	});

	test("deduplicates self-thread posts into one chronological module on replies-on feeds", () => {
		const p1 = makePost("100", alice);
		const p2 = makePost("101", alice, { replyTo: p1 });
		const p3 = makePost("102", alice, { replyTo: p2 });
		const other = makePost("105", bob);
		// Feed arrives newest first: other, p3, p2, p1
		const groups = groupSelfThreads([item(other), item(p3), item(p2), item(p1)], []);
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ kind: "single", item: { id: "105" }, index: 0 });
		const thread = groups[1]!;
		expect(thread.kind).toBe("thread");
		if (thread.kind === "thread") {
			expect(thread.item.id).toBe("102");
			expect(thread.index).toBe(1);
			expect(thread.posts.map((p) => p.id)).toEqual(["100", "101", "102"]);
			expect(thread.hasMore).toBe(false);
		}
	});

	test("truncates long threads to TIMELINE_THREAD_SIZE with hasMore and allIds", () => {
		const p1 = makePost("100", alice);
		const p2 = makePost("101", alice, { replyTo: p1 });
		const p3 = makePost("102", alice, { replyTo: p2 });
		const p4 = makePost("103", alice, { replyTo: p3 });
		const groups = groupSelfThreads([item(p1)], [p2, p3, p4]);
		expect(groups).toHaveLength(1);
		const g = groups[0]!;
		expect(g.kind).toBe("thread");
		if (g.kind === "thread") {
			expect(g.posts).toHaveLength(TIMELINE_THREAD_SIZE);
			expect(g.posts.map((p) => p.id)).toEqual(["100", "101", "102"]);
			expect(g.allIds).toEqual(["100", "101", "102", "103"]);
			expect(g.hasMore).toBe(true);
		}
	});

	test("shows root and latest continuation when an older long thread is continued", () => {
		const p1 = makePost("100", alice);
		const p2 = makePost("101", alice, { replyTo: p1 });
		const p3 = makePost("102", alice, { replyTo: p2 });
		const p4 = makePost("103", alice, { replyTo: p3 });
		// Only p4 is on this page; p1..p3 came from extra
		const groups = groupSelfThreads([item(p4)], [p1, p2, p3]);
		expect(groups).toHaveLength(1);
		const g = groups[0]!;
		expect(g.kind).toBe("thread");
		if (g.kind === "thread") {
			expect(g.posts.map((p) => p.id)).toEqual(["100", "103"]);
			expect(g.allIds).toEqual(["100", "101", "102", "103"]);
			expect(g.hasMore).toBe(true);
		}
	});

	test("does not merge another user's reply or an author's reply to another user", () => {
		const p1 = makePost("100", alice);
		const b1 = makePost("101", bob, { replyTo: p1 });
		const p2 = makePost("102", alice, { replyTo: b1 });
		const groups = groupSelfThreads([item(p2), item(b1), item(p1)], []);
		expect(groups.map((g) => [g.kind, g.item.id])).toEqual([
			["single", "102"],
			["single", "101"],
			["single", "100"],
		]);
	});

	test("groups a self-thread that starts as a reply to someone else without swallowing their post", () => {
		const b1 = makePost("100", bob);
		const a1 = makePost("101", alice, { replyTo: b1 });
		const a2 = makePost("102", alice, { replyTo: a1 });
		const groups = groupSelfThreads([item(a2), item(a1)], [b1]);
		expect(groups).toHaveLength(1);
		const g = groups[0]!;
		expect(g.kind).toBe("thread");
		if (g.kind === "thread") {
			expect(g.posts.map((p) => p.id)).toEqual(["101", "102"]);
		}
	});

	test("keeps secondary self-reply branches instead of dropping them", () => {
		const p1 = makePost("100", alice);
		const p2a = makePost("101", alice, { replyTo: p1 });
		const p2b = makePost("102", alice, { replyTo: p1 });
		const p3b = makePost("103", alice, { replyTo: p2b });
		const groups = groupSelfThreads([item(p3b), item(p2b), item(p2a), item(p1)], []);
		expect(groups).toHaveLength(2);
		expect(groups[0]!.kind).toBe("thread");
		expect(groups[1]!.kind).toBe("thread");
		if (groups[0]!.kind === "thread" && groups[1]!.kind === "thread") {
			expect(groups[0]!.posts.map((p) => p.id)).toEqual(["102", "103"]);
			expect(groups[1]!.posts.map((p) => p.id)).toEqual(["100", "101"]);
		}
	});

	test("never expands reposts into self-thread modules", () => {
		const p1 = makePost("100", alice);
		const p2 = makePost("101", alice, { replyTo: p1 });
		const groups = groupSelfThreads([item(p1, { by: bob, created_at: new Date("2026-01-01T00:01:00Z") })], [p2]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.kind).toBe("single");
	});

	test("selfThreadEntry builds a VerticalConversation module with connectors, metadata and optional footer", () => {
		const p1 = makePost("100", alice, { community: { name: "Test Community" }, communityId: "77" });
		const p2 = makePost("101", alice, { replyTo: p1 });
		const entry = selfThreadEntry([p1, p2], "500", {
			prefix: "home-conversation",
			allIds: ["100", "101", "102"],
			hasMore: true,
		});
		expect(entry.entryId).toBe("home-conversation-100");
		expect(entry.sortIndex).toBe("500");
		expect(entry.content.__typename).toBe("TimelineTimelineModule");
		expect(entry.content.entryType).toBe("TimelineTimelineModule");
		expect(entry.content.displayType).toBe("VerticalConversation");
		expect(entry.content.metadata).toEqual({
			conversationMetadata: { allTweetIds: ["100", "101", "102"], enableDeduplication: true },
		});
		expect(entry.content.items).toHaveLength(2);
		expect(entry.content.items[0]!.entryId).toBe("home-conversation-100-tweet-100");
		expect((entry.content.items[0] as any).treeDisplay).toBeUndefined();
		expect((entry.content.items[0]!.item.itemContent as any).socialContext).toEqual({
			type: "TimelineGeneralContext",
			contextType: "Community",
			text: "Test Community",
			landingUrl: { url: "/i/communities/77", urlType: "ExternalUrl" },
		});
		expect(entry.content.items[1]!.entryId).toBe("home-conversation-100-tweet-101");
		expect((entry.content.items[1] as any).treeDisplay).toEqual({
			parentModuleItemEntryId: "home-conversation-100-tweet-100",
			indentFromParent: false,
		});
		expect((entry.content.items[1]!.item.itemContent as any).socialContext).toBeUndefined();
		expect((entry.content as any).footer).toEqual({
			displayType: "Classic",
			text: "Show this thread",
			landingUrl: { url: "https://x.com/alice/status/100", urlType: "ExternalUrl" },
		});

		const shortEntry = selfThreadEntry([p1, p2], "500", { prefix: "profile-conversation" });
		expect(shortEntry.entryId).toBe("profile-conversation-100");
		expect((shortEntry.content as any).footer).toBeUndefined();
	});
});
