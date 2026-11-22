export const BRAND_NAME = 'mcgo.app';

const LEGACY_BRAND_NAME = /\b(?:marchcenter\.top|marchcenter|competition hub)\b(?![.-][a-z\d])/gi;

export function normalizeBrandText(value) {
    return typeof value === 'string' ? value.replace(LEGACY_BRAND_NAME, BRAND_NAME) : value;
}
