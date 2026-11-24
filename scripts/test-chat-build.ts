import { expect, test } from "bun:test";
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
