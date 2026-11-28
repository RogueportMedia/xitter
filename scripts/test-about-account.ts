// About this account visibility (about-account.ts): government and
// government_individual accounts always hide all About metadata except join
// date and verification date; other accounts follow the admin toggle.
import { expect, test } from "bun:test";
import { aboutProfile, hidesAboutInfo, isGovernmentAccount } from "../src/about-account";
import type { User } from "../src/auth";
import { userResult } from "../src/model";
import { mayRun } from "../src/staff-permissions";

const ORIGIN = "https://xitter.example";
const sampleData = {
	affiliateUsername: "gov_org",
	country: "US",
	basedInOverride: "United States",
	locationPref: "Country",
	signupCountry: "US",
	source: "Xitter for Web",
	usernameChanges: 3,
	lastUsernameChange: new Date("2026-05-01T12:00:00Z"),
};

const sampleUser = (extra: Partial<User> = {}) =>
	({
		id: "42",
		screen_name: "official",
		name: "Official",
		bio: "",
		location: "",
		avatar_url: null,
		banner_url: null,
		verified_type: null,
		verified_at: new Date("2026-02-03T00:00:00Z"),
		created_at: new Date("2025-01-02T00:00:00Z"),
		...extra,
	}) as User;

test("government and government_individual accounts automatically hide About details", () => {
	for (const verifiedType of ["government", "government_individual"] as const) {
		expect(isGovernmentAccount(verifiedType)).toBe(true);
		expect(hidesAboutInfo(verifiedType, false)).toBe(true);
		expect(aboutProfile({ ...sampleData, verifiedType, hideAboutInfo: false }, ORIGIN)).toEqual({
			affiliate_username: null,
			account_based_in: null,
			learn_more_url: `${ORIGIN}/rules`,
			location_accurate: true,
		});
		const base = userResult(sampleUser({ verified_type: verifiedType }));
		expect(base.core.created_at).toBeTruthy();
		expect(base.verification_info?.reason?.verified_since_msec).toBe(String(new Date("2026-02-03T00:00:00Z").getTime()));
	}
});

test("other accounts show About details by default and hide them when toggled on", () => {
	for (const verifiedType of [null, "blue", "business"] as const) {
		expect(isGovernmentAccount(verifiedType)).toBe(false);
		expect(hidesAboutInfo(verifiedType, false)).toBe(false);
		const shown = aboutProfile({ ...sampleData, verifiedType, hideAboutInfo: false }, ORIGIN);
		expect(shown).toEqual({
			affiliate_username: "gov_org",
			account_based_in: "United States",
			created_country: "United States",
			created_country_accurate: true,
			source: "Xitter for Web",
			learn_more_url: `${ORIGIN}/rules`,
			location_accurate: true,
			username_changes: {
				count: "3",
				last_changed_at_msec: String(sampleData.lastUsernameChange.getTime()),
			},
		});

		expect(hidesAboutInfo(verifiedType, true)).toBe(true);
		expect(aboutProfile({ ...sampleData, verifiedType, hideAboutInfo: true }, ORIGIN)).toEqual({
			affiliate_username: null,
			account_based_in: null,
			learn_more_url: `${ORIGIN}/rules`,
			location_accurate: true,
		});
		const base = userResult(sampleUser({ verified_type: verifiedType }));
		expect(base.core.created_at).toBeTruthy();
		if (verifiedType) expect(base.verification_info?.reason?.verified_since_msec).toBe(String(new Date("2026-02-03T00:00:00Z").getTime()));
	}
});

test("setHideAboutInfo defaults to admin-only permission and is wired in admin.html", async () => {
	expect(mayRun("admin", "setHideAboutInfo", "admin")).toBe(true);
	expect(mayRun("moderator", "setHideAboutInfo", "admin")).toBe(false);
	expect(mayRun("support", "setHideAboutInfo", "admin")).toBe(false);

	const html = await Bun.file(new URL("../src/admin.html", import.meta.url)).text();
	expect(html).toContain('id="hide-about-info"');
	expect(html).toContain('api("setHideAboutInfo"');
	expect(html).toContain("Automatic for government accounts");
});
