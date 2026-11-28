// Notifications through the public API (/api/v1/notifications), against a
// migrated, disposable local database: listing, filtering (type=mentions,
// unread=true, since), paging, unread counts, marking read (partial up_to and
// full), read-only token enforcement, and hiding blocked accounts.
import { strict as assert } from "node:assert";
import { PUBLIC_ORIGIN } from "../src/config";
import { sql } from "../src/db";
import { newId } from "../src/ids";
import { createToken, publicApi } from "../src/public-api";

const database = new URL(process.env.DATABASE_URL ?? "postgres://localhost/xitter");
assert(["localhost", "127.0.0.1"].includes(database.hostname) && /test|codex/.test(database.pathname), "Use a disposable local test database.");

const tag = newId().slice(-8);
const people = { a: newId(), b: newId(), c: newId(), blocked: newId() };
const handle = (k: keyof typeof people) => `na_${k}_${tag}`;
const call = async (token: string, method: string, path: string, body?: unknown) => {
	const url = new URL(`${PUBLIC_ORIGIN}/api/v1${path}`);
	const res = await publicApi(
		new Request(url, {
			method,
			headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		}),
		url,
	);
	return { status: res.status, ...(await res.json()) };
};

try {
	const baseSeen = new Date("2026-01-01T00:00:00.000Z");
	for (const k of Object.keys(people) as (keyof typeof people)[]) {
		await sql`insert into users(id, screen_name, name, password_hash, notifications_seen_at)
			values(${people[k]}::bigint, ${handle(k)}, ${k.toUpperCase()}, 'unused', ${baseSeen})`;
	}
	const tok = {
		aWrite: await createToken(people.a, "notif write", "write"),
		aRead: await createToken(people.a, "notif read", "read"),
	};

	// starts empty and read
	const emptyUnread = await call(tok.aRead, "GET", "/notifications/unread");
	assert.deepEqual([emptyUnread.status, emptyUnread.data.unread_count, emptyUnread.data.last_seen_at], [200, 0, baseSeen.toISOString()]);
	const emptyList = await call(tok.aRead, "GET", "/notifications");
	assert.deepEqual([emptyList.status, emptyList.data, emptyList.next_cursor], [200, [], null]);

	// validation errors
	assert.equal((await call(tok.aRead, "GET", "/notifications?type=likes")).status, 400);
	assert.equal((await call(tok.aRead, "GET", "/notifications/unread?type=likes")).status, 400);
	assert.equal((await call(tok.aRead, "GET", "/notifications?unread=maybe")).status, 400);
	assert.equal((await call(tok.aRead, "GET", "/notifications?since=not-a-date")).status, 400);
	assert.equal((await call(tok.aRead, "GET", "/notifications?cursor=abc")).status, 400);
	assert.equal((await call(tok.aRead, "GET", "/notifications?cursor=0")).status, 400);
	assert.equal((await call(tok.aRead, "POST", "/notifications/read")).status, 403, "read token cannot mark read");
	assert.equal((await call(tok.aWrite, "POST", "/notifications/read", { up_to: "2026-02-30T00:00:00Z" })).status, 400);

	// fixture with distinct timestamps so ordering, paging and partial read are deterministic
	const t = (sec: number) => new Date(baseSeen.getTime() + sec * 1000);
	const postA = newId(), replyB = newId(), quoteB = newId(), mentionB = newId(), bellB = newId(), blockedMention = newId(), staffId = newId();
	await sql`insert into blocks(blocker_id, blocked_id) values(${people.a}::bigint, ${people.blocked}::bigint)`;
	// ring the bell after quoteB/mentionB so only bellB triggers a bell notification
	await sql`insert into post_notifications(user_id, target_id, created_at) values(${people.a}::bigint, ${people.b}::bigint, ${t(75)})`;

	await sql`insert into posts(id, user_id, text, conversation_id, created_at, received_at)
		values(${postA}::bigint, ${people.a}::bigint, 'hello', ${postA}::bigint, ${t(10)}, ${t(10)})`;
	await sql`insert into likes(user_id, post_id, created_at) values
		(${people.b}::bigint, ${postA}::bigint, ${t(20)}),
		(${people.c}::bigint, ${postA}::bigint, ${t(25)}),
		(${people.blocked}::bigint, ${postA}::bigint, ${t(26)})`;
	await sql`insert into reposts(id, user_id, post_id, created_at) values(${newId()}::bigint, ${people.b}::bigint, ${postA}::bigint, ${t(30)})`;
	await sql`insert into follows(follower_id, followee_id, created_at) values(${people.b}::bigint, ${people.a}::bigint, ${t(40)})`;
	await sql`insert into posts(id, user_id, text, reply_to_id, reply_to_user_id, conversation_id, created_at, received_at)
		values(${replyB}::bigint, ${people.b}::bigint, 'reply text', ${postA}::bigint, ${people.a}::bigint, ${postA}::bigint, ${t(50)}, ${t(50)})`;
	await sql`insert into posts(id, user_id, text, quote_id, conversation_id, created_at, received_at)
		values(${quoteB}::bigint, ${people.b}::bigint, 'quote text', ${postA}::bigint, ${quoteB}::bigint, ${t(60)}, ${t(60)})`;
	await sql`insert into posts(id, user_id, text, conversation_id, created_at, received_at)
		values(${mentionB}::bigint, ${people.b}::bigint, ${`hi @${handle("a")}`}, ${mentionB}::bigint, ${t(70)}, ${t(70)})`;
	await sql`insert into post_mentions(post_id, user_id) values(${mentionB}::bigint, ${people.a}::bigint)`;
	await sql`insert into posts(id, user_id, text, conversation_id, created_at, received_at)
		values(${bellB}::bigint, ${people.b}::bigint, 'bell post', ${bellB}::bigint, ${t(80)}, ${t(80)})`;
	await sql`insert into staff_messages(id, user_id, kind, body, created_at)
		values(${staffId}::bigint, ${people.a}::bigint, 'message', 'welcome aboard', ${t(90)})`;
	await sql`insert into posts(id, user_id, text, conversation_id, created_at, received_at)
		values(${blockedMention}::bigint, ${people.blocked}::bigint, ${`blocked @${handle("a")}`}, ${blockedMention}::bigint, ${t(95)}, ${t(95)})`;
	await sql`insert into post_mentions(post_id, user_id) values(${blockedMention}::bigint, ${people.a}::bigint)`;

	// all 8 notifications (staff, bell, mention, quote, reply, follow, repost, like); blocked user excluded
	const unreadAll = await call(tok.aRead, "GET", "/notifications/unread");
	assert.equal(unreadAll.data.unread_count, 8, "all 8 non-blocked notifications are unread");
	const unreadMentions = await call(tok.aRead, "GET", "/notifications/unread?type=mentions");
	assert.equal(unreadMentions.data.unread_count, 2, "only reply and mention count under mentions");

	const all = await call(tok.aRead, "GET", "/notifications?limit=20");
	assert.equal(all.status, 200);
	assert.deepEqual(
		all.data.map((n: any) => n.type),
		["staff", "bell", "mention", "quote", "reply", "follow", "repost", "like"],
		"newest first, all kinds present, blocked excluded",
	);
	assert.equal(all.next_cursor, null);
	assert(all.data.every((n: any) => n.unread === true));

	const like = all.data.find((n: any) => n.type === "like");
	assert.deepEqual([like.id, like.actors_count, like.actors.map((u: any) => u.screen_name), like.post.id], [`like-${postA}`, 2, [handle("c"), handle("b")], postA]);
	assert.equal(like.text, "C and B liked your post");
	const follow = all.data.find((n: any) => n.type === "follow");
	assert.deepEqual([follow.post, follow.actors_count, follow.url], [null, 1, `${PUBLIC_ORIGIN}/${handle("b")}`]);
	const staff = all.data.find((n: any) => n.type === "staff");
	assert.deepEqual([staff.actors, staff.actors_count, staff.post, staff.url], [[], 0, null, `${PUBLIC_ORIGIN}/account/notices`]);
	const bell = all.data.find((n: any) => n.type === "bell");
	assert.deepEqual([bell.post.id, bell.text], [bellB, "New post from B"]);

	// mentions tab: reply and mention only (not quote)
	const mentions = await call(tok.aRead, "GET", "/notifications?type=mentions");
	assert.deepEqual(mentions.data.map((n: any) => n.type), ["mention", "reply"]);

	// since filter: strictly newer than t(60) -> staff (90), bell (80), mention (70)
	const newer = await call(tok.aRead, "GET", `/notifications?since=${encodeURIComponent(t(60).toISOString())}`);
	assert.deepEqual(newer.data.map((n: any) => n.type), ["staff", "bell", "mention"]);

	// cursor pagination
	const p1 = await call(tok.aRead, "GET", "/notifications?limit=3");
	assert.deepEqual(p1.data.map((n: any) => n.type), ["staff", "bell", "mention"]);
	assert(p1.next_cursor, "page 1 has next_cursor");
	const p2 = await call(tok.aRead, "GET", `/notifications?limit=3&cursor=${p1.next_cursor}`);
	assert.deepEqual(p2.data.map((n: any) => n.type), ["quote", "reply", "follow"]);
	const p3 = await call(tok.aRead, "GET", `/notifications?limit=3&cursor=${p2.next_cursor}`);
	assert.deepEqual(p3.data.map((n: any) => n.type), ["repost", "like"]);
	assert.equal(p3.next_cursor, null);

	// partial mark read up through quote at t(60): leaves staff, bell, mention unread (3)
	const partial = await call(tok.aWrite, "POST", "/notifications/read", { up_to: t(60).toISOString() });
	assert.equal(partial.status, 200);
	assert.equal(partial.data.unread_count, 3);
	const onlyUnread = await call(tok.aRead, "GET", "/notifications?unread=true");
	assert.deepEqual(onlyUnread.data.map((n: any) => n.type), ["staff", "bell", "mention"]);
	// passing an older up_to does not move last_seen_at backward
	const backward = await call(tok.aWrite, "POST", "/notifications/read", { up_to: t(10).toISOString() });
	assert.deepEqual([backward.data.unread_count, backward.data.last_seen_at], [3, partial.data.last_seen_at]);

	// full mark read clears everything
	const cleared = await call(tok.aWrite, "POST", "/notifications/read");
	assert.equal(cleared.status, 200);
	assert.equal(cleared.data.unread_count, 0);
	assert.deepEqual((await call(tok.aRead, "GET", "/notifications?unread=true")).data, []);
	assert((await call(tok.aRead, "GET", "/notifications")).data.every((n: any) => n.unread === false));

	console.log("Notifications API checks passed");
} finally {
	await sql`delete from users where id = any(${sql.array(Object.values(people), "INT8")})`;
	await sql.close();
}
