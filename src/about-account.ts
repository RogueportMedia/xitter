import { PUBLIC_ORIGIN } from "./config";
import { countryDisplayName, countryName, regionName } from "./countries";

export type AboutAccountData = {
	verifiedType: string | null | undefined;
	hideAboutInfo?: boolean | null;
	affiliateUsername?: string | null;
	country?: string | null;
	basedInOverride?: string | null;
	locationPref?: string | null;
	signupCountry?: string | null;
	source?: string | null;
	usernameChanges?: number | null;
	lastUsernameChange?: Date | null;
};

// Government accounts always hide About this account metadata except join date,
// verification date (which live on the base user record), and affiliation.
export const isGovernmentAccount = (verifiedType: string | null | undefined): boolean =>
	verifiedType === "government" || verifiedType === "government_individual";

export const hidesAboutInfo = (verifiedType: string | null | undefined, hideAboutInfo?: boolean | null): boolean =>
	isGovernmentAccount(verifiedType) || !!hideAboutInfo;

// "Account based in": the country if its owner chose that, else the continent
export function basedIn(country: string | null | undefined, preference: string | null | undefined): string | null {
	if (!country) return null;
	if (preference === "Country") return countryName(country) ?? null;
	return regionName(country) ?? countryName(country) ?? null;
}

export function aboutProfile(data: AboutAccountData, origin = PUBLIC_ORIGIN) {
	if (hidesAboutInfo(data.verifiedType, data.hideAboutInfo)) {
		return {
			affiliate_username: data.affiliateUsername ?? null,
			account_based_in: null,
			learn_more_url: `${origin}/rules`,
			location_accurate: true,
		};
	}
	const changes = data.usernameChanges ?? 0;
	return {
		affiliate_username: data.affiliateUsername ?? null,
		account_based_in: data.basedInOverride ?? basedIn(data.country, data.locationPref),
		...(data.signupCountry ? { created_country: countryDisplayName(data.signupCountry), created_country_accurate: true } : {}),
		...(data.source ? { source: data.source } : {}),
		learn_more_url: `${origin}/rules`,
		location_accurate: true,
		username_changes: {
			count: String(changes),
			...(data.lastUsernameChange ? { last_changed_at_msec: String(data.lastUsernameChange.getTime()) } : {}),
		},
	};
}
