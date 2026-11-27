import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { newId } from "./ids";
import { settings } from "./settings";

// the web client's own name; stored with each post, renamed with the instance (admin.ts)
export const webSource = (name = settings().instance_name) => `${name} for Web`;

// the app a post came from, under its time; a post from another instance also
// names that instance ("Xitter for Web - xit.example.org"). Older copies only
// kept the instance, and then the app is taken to be the web client.
export function shownSource(source: string | null | undefined, home: string | null | undefined): string {
	if (!home) return source ?? webSource();
	return `${source && source !== home ? source : "Xitter for Web"} - ${home}`;
}

// a client's stored source and sign-up app move to the instance's new name
export async function renameWebSource(from: string, to: string) {
	if (from === to) return;
	const [a, b] = [webSource(from), webSource(to)];
	await sql`update posts set source = ${b} where source = ${a} and user_id in (select id from users where instance is null)`;
	await sql`update users set signup_source = ${b} where signup_source = ${a}`;
	await sql`update login_events set app = ${b} where app = ${a}`;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const validPlatformLabel = (value: string) => !!value && [...value].length <= 80 && !/[\x00-\x1f\x7f]/.test(value);

export async function createPlatform(label: string, actorId: string) {
	const token = `xitter_${randomBytes(32).toString("hex")}`;
	const id = newId();
	await sql`insert into client_platforms (id, label, token_hash, creator_id) values (${id}::bigint, ${label}, ${hash(token)}, ${actorId}::bigint)`;
	return { id, label, token };
}

export async function renamePlatform(id: string, label: string): Promise<{ ok: true; previous: string } | { ok: false; reason: "missing" | "revoked" }> {
	return sql.begin(async (tx) => {
		const [row] = await tx`select label, revoked from client_platforms where id = ${id}::bigint for update`;
		if (!row) return { ok: false, reason: "missing" };
		if (row.revoked) return { ok: false, reason: "revoked" };
		if (row.label !== label) await tx`update client_platforms set label = ${label} where id = ${id}::bigint`;
		return { ok: true, previous: row.label as string };
	});
}

export async function platformSource(req: Request): Promise<string | null> {
	const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
	if (!token?.startsWith("xitter_")) return webSource();
	const [platform] = await sql`select label from client_platforms where token_hash = ${hash(token)} and not revoked`;
	return platform?.label ?? null;
}
