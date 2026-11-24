import { expect, test } from "bun:test";
import { patchText } from "../src/patch";
import { chatBuildFromManifest } from "./fetch-client";

const SHA = "79c7b50028b205cdb37bae4af3adb4bfbd5593fd";
const BASE = "https://abs.twimg.com/x-web/xchat/embed/";

test("keeps a build hash already present in publicPath", () => {
	expect(chatBuildFromManifest({ metaData: { publicPath: `${BASE}${SHA}/` } })).toBe(`${BASE}${SHA}/`);
});

test("extracts the build hash from remoteEntry.name or remoteEntry.path", () => {
	expect(chatBuildFromManifest({ metaData: { publicPath: BASE, remoteEntry: { name: `${SHA}/remoteEntry.js`, path: "" } } })).toBe(`${BASE}${SHA}/`);
	expect(chatBuildFromManifest({ metaData: { publicPath: BASE, remoteEntry: { name: "remoteEntry.js", path: SHA } } })).toBe(`${BASE}${SHA}/`);
});

test("rejects unexpected hosts, missing hashes, and malformed manifests", () => {
	for (const manifest of [
		null,
		{},
		{ metaData: { publicPath: BASE } },
		{ metaData: { publicPath: BASE, remoteEntry: { name: "remoteEntry.js", path: "" } } },
		{ metaData: { publicPath: BASE, remoteEntry: { name: "../evil/remoteEntry.js" } } },
		{ metaData: { publicPath: `https://evil.example/x-web/xchat/embed/${SHA}/` } },
	])
		expect(chatBuildFromManifest(manifest)).toBeUndefined();
});

test("chat patch relaxes Juicebox single-realm registration thresholds without touching main client", () => {
	const check = "function validate(r,l){var u;if(r.a18p_1!==3)u=`register_threshold `+r.a18p_1+` != 3`;else if(r.b18p_1!==2)u=`recover_threshold `+r.b18p_1+` != 2`;else if(l>=2)u=`recovery must include at least one HSM`;else if(r.c18p_1!==`Standard2019`)u=`bad`;else u=null;return u}";
	expect(patchText(check, false)).toBe(check);
	const patched = patchText(check, true);
	expect(patched).not.toContain("!= 3");
	expect(patched).not.toContain("at least one HSM");
	const validate = new Function(`${patched}; return validate;`)();
	expect(validate({ a18p_1: 1, b18p_1: 1, c18p_1: "Standard2019" }, 1)).toBeNull();
	expect(validate({ a18p_1: 0, b18p_1: 1, c18p_1: "Standard2019" }, 1)).toContain("register_threshold");
	expect(validate({ a18p_1: 1, b18p_1: 0, c18p_1: "Standard2019" }, 1)).toContain("recover_threshold");
	expect(validate({ a18p_1: 1, b18p_1: 1, c18p_1: "Other" }, 1)).toBe("bad");
});
