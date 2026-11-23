import type { User } from "./auth";
import type { PostRow } from "./model";

const CHAIN_SIZE = 6;
const SELF_THREAD_SIZE = 50;
export const TIMELINE_THREAD_SIZE = 3;
export const THREADS_PER_PAGE = 30;
export const MORE_PER_PAGE = 20;

export type Placed = { post: PostRow; parent?: string; indent?: boolean };
export type Thread = { root: PostRow; shown: Placed[]; rest: Placed[] };
export type TimelinePost = { id: string; post: PostRow; repost?: { by: User; created_at: Date } };
export type TimelineGroup<T extends TimelinePost = TimelinePost> =
	| { kind: "single"; item: T; index: number }
	| { kind: "thread"; item: T; index: number; root: PostRow; posts: PostRow[]; allIds: string[]; hasMore: boolean };

const engagement = (p: PostRow) => p.like_count + p.reply_count;
const older = (a: PostRow, b: PostRow) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

export function conversationThreads(focal: PostRow, below: PostRow[], pinned: string | null) {
	const kids = new Map<string, PostRow[]>();
	for (const p of below) if (p.reply_to_id) kids.set(p.reply_to_id, [...(kids.get(p.reply_to_id) ?? []), p]);
	const childrenOf = (id: string) => kids.get(id) ?? [];
	const op = focal.author.id;

	const selfChain: PostRow[] = [];
	for (let at = focal; ; ) {
		const next = childrenOf(at.id)
			.filter((p) => p.author.id === op)
			.sort(older)[0];
		if (!next) break;
		selfChain.push(next);
		at = next;
	}
	const self = selfChain[0];

	const rank = (p: PostRow) => (p.id === pinned ? 0 : p === self ? 1 : p.author.id === op ? 2 : 3);
	const roots = [...childrenOf(focal.id)].sort((a, b) => rank(a) - rank(b) || engagement(b) - engagement(a) || older(b, a));

	const thread = (root: PostRow): Thread => {
		if (root === self) {
			const placed = selfChain.map((post, i) => ({ post, parent: i ? selfChain[i - 1].id : undefined }));
			return { root, shown: placed.slice(0, SELF_THREAD_SIZE), rest: placed.slice(SELF_THREAD_SIZE) };
		}
		const party = new Set([op, root.author.id]);
		const order = (list: PostRow[]) =>
			[...list].sort((a, b) => Number(party.has(b.author.id)) - Number(party.has(a.author.id)) || engagement(b) - engagement(a) || older(a, b));
		const place = (post: PostRow): Placed =>
			post === root ? { post } : { post, parent: post.reply_to_id ?? undefined, indent: childrenOf(post.reply_to_id ?? "").length > 1 };
		const shown = [place(root)];
		for (let at = root; shown.length < CHAIN_SIZE; ) {
			const [next, ...others] = order(childrenOf(at.id));
			if (!next) break;
			shown.push(place(next));
			at = next;
			if (others.length && !party.has(next.author.id)) break;
		}
		const seen = new Set(shown.map((s) => s.post.id));
		const rest: Placed[] = [];
		const walk = (p: PostRow) => {
			for (const k of order(childrenOf(p.id))) {
				if (!seen.has(k.id)) rest.push(place(k));
				walk(k);
			}
		};
		walk(root);
		return { root, shown, rest };
	};

	return { roots, thread };
}

// Groups consecutive self-replies by the same author into thread modules for a
// timeline page, deduplicating any later items on the page that belong to the
// same self-thread. Reposts and replies to other accounts stay standalone.
export function groupSelfThreads<T extends TimelinePost>(items: T[], extra: PostRow[]): TimelineGroup<T>[] {
	const byId = new Map<string, PostRow>();
	for (const p of extra) byId.set(p.id, p);
	// page posts win over extra so hydrated objects from the page are kept
	for (const it of items) if (!it.repost) byId.set(it.post.id, it.post);

	const kids = new Map<string, PostRow[]>();
	for (const p of byId.values()) {
		if (!p.reply_to_id) continue;
		const parent = byId.get(p.reply_to_id);
		if (!parent || parent.author.id !== p.author.id) continue;
		const list = kids.get(parent.id);
		if (list) list.push(p);
		else kids.set(parent.id, [p]);
	}
	for (const list of kids.values()) list.sort(older);

	const rootOf = (post: PostRow, stopAt?: Set<string>): PostRow => {
		let cur = post;
		const seen = new Set([cur.id]);
		while (cur.reply_to_id) {
			const parent = byId.get(cur.reply_to_id);
			if (!parent || parent.author.id !== cur.author.id || seen.has(parent.id) || stopAt?.has(parent.id)) break;
			seen.add(parent.id);
			cur = parent;
		}
		return cur;
	};

	const chainFrom = (start: PostRow): PostRow[] => {
		const chain = [start];
		const seen = new Set([start.id]);
		for (let at = start; ; ) {
			const next = (kids.get(at.id) ?? []).find((c) => c.author.id === start.author.id && !seen.has(c.id));
			if (!next) break;
			seen.add(next.id);
			chain.push(next);
			at = next;
		}
		return chain;
	};

	const pagePostIds = new Set(items.filter((i) => !i.repost).map((i) => i.post.id));
	const consumed = new Set<string>();
	const out: TimelineGroup<T>[] = [];

	for (let index = 0; index < items.length; index++) {
		const item = items[index]!;
		if (item.repost) {
			out.push({ kind: "single", item, index });
			continue;
		}
		if (consumed.has(item.post.id)) continue;

		const root = rootOf(item.post);
		let chain = chainFrom(root);
		// A second self-reply branch under the same parent isn't on the primary
		// chain: start from its own branch root instead of dropping it.
		if (!chain.some((p) => p.id === item.post.id)) {
			const primary = new Set(chain.map((p) => p.id));
			chain = chainFrom(rootOf(item.post, primary));
		}

		if (chain.length < 2) {
			out.push({ kind: "single", item, index });
			continue;
		}

		for (const p of chain) consumed.add(p.id);
		const triggerIdx = chain.findIndex((p) => p.id === item.post.id);
		const hasMore = chain.length > TIMELINE_THREAD_SIZE;
		const posts = !hasMore
			? chain
			: pagePostIds.has(chain[0]!.id) || triggerIdx < TIMELINE_THREAD_SIZE
				? chain.slice(0, TIMELINE_THREAD_SIZE)
				: [chain[0]!, chain[triggerIdx]!];
		out.push({ kind: "thread", item, index, root: chain[0]!, posts, allIds: chain.map((p) => p.id), hasMore });
	}
	return out;
}
