import pool from '../config/db.js';
import { ACCOUNT_CAPABLE_METHODS } from '../utils/competitionMaintenance.js';
import { validateConfirmedOfficialBaseUrl } from '../utils/officialCompat/officialJumpConfig.js';
import { ROLES } from '../utils/roleAccess.js';

export async function readCompetitionSsoProfiles() {
    const [rows] = await pool.query(`
        SELECT id, name, base_url, json_extract(config_data, '$.method') AS method,
            json_extract(config_data, '$.allowHttp') AS allow_http
        FROM sso_configs
        WHERE json_valid(config_data) AND json_extract(config_data, '$.canaryOnly') IS NOT 1
        ORDER BY name COLLATE NOCASE, id`);
    return rows.filter(profile => ACCOUNT_CAPABLE_METHODS.has(profile.method));
}

function targetKey(value) {
    try { return new URL(validateConfirmedOfficialBaseUrl(value)).href; }
    catch { return null; }
}

function profileDto({ id, name, method }) {
    return { id, name, method };
}

/**
 * An ordinary administrator can reuse an existing association but cannot
 * introduce a new destination for credentials. A super administrator already
 * has the authority to bind the card to a method in the system's card editor.
 */
export function competitionSsoSelector(user, profiles, cards) {
    const byId = new Map(profiles.map(profile => [profile.id, profile]));
    const profilesByTarget = new Map();
    const approve = (url, profile) => {
        if (!url || !profile) return;
        if (!profilesByTarget.has(url)) profilesByTarget.set(url, new Set());
        profilesByTarget.get(url).add(profile.id);
    };
    for (const profile of profiles) approve(targetKey(profile.base_url), profile);
    for (const card of cards) {
        const bound = byId.get(card.sso_config_id);
        const method = card.sso_method || card.fallback_sso_method;
        if (bound && bound.method === method) approve(targetKey(card.url), bound);
        if (!card.sso_config_id && method) {
            const compatible = profiles.filter(profile => profile.method === method && !targetKey(profile.base_url));
            if (compatible.length === 1) approve(targetKey(card.url), compatible[0]);
        }
    }

    return card => {
        const target = targetKey(card.url);
        if (!target || card.bound_canary_only === 1) return null;
        const bound = byId.get(card.sso_config_id);
        const method = card.sso_method || card.fallback_sso_method;
        if (method && !ACCOUNT_CAPABLE_METHODS.has(method)) return null;
        const matchesTransport = profile => !target.startsWith('http:') || Boolean(profile.allow_http);
        if (bound && bound.method === method && matchesTransport(bound)) {
            return { mode: 'auto', profile: profileDto(bound) };
        }

        const approved = profilesByTarget.get(target);
        const canBindNewTarget = user.role === ROLES.SUPER_ADMIN;
        const candidates = profiles.filter(profile => {
            if (!matchesTransport(profile)) return false;
            if (!method) return approved?.has(profile.id);
            return method === profile.method
                && (canBindNewTarget || approved?.has(profile.id) || !targetKey(profile.base_url));
        });
        // An invalid explicit binding requires a decision even when only
        // one compatible profile remains.
        if (candidates.length === 1 && !card.sso_config_id) {
            return { mode: 'auto', profile: profileDto(candidates[0]) };
        }
        const options = candidates.length || method || !canBindNewTarget
            ? candidates : profiles.filter(matchesTransport);
        return options.length ? { mode: 'manual', profiles: options.map(profileDto) } : null;
    };
}
