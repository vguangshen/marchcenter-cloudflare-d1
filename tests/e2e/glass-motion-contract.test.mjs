import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
const contestCard = await readFile(new URL('../../src/components/cards/ContestCard.jsx', import.meta.url), 'utf8');
const loginPage = await readFile(new URL('../../src/components/views/LoginPage.jsx', import.meta.url), 'utf8');
const authSession = await readFile(new URL('../../src/hooks/useAuthSession.js', import.meta.url), 'utf8');
const navbar = await readFile(new URL('../../src/components/layouts/Navbar.jsx', import.meta.url), 'utf8');
const announcement = await readFile(new URL('../../src/components/views/dashboard/AnnouncementBanner.jsx', import.meta.url), 'utf8');
const classAction = await readFile(new URL('../../src/components/cards/ClassActionOverlay.jsx', import.meta.url), 'utf8');
const accountManager = await readFile(new URL('../../src/components/views/settings/AccountManagementApiManager.jsx', import.meta.url), 'utf8');

test('moving glass surfaces use isolated compositor hints without removing their effects', () => {
    assert.match(styles, /\.glass-motion-surface,[\s\S]*\.glass-motion-container[\s\S]*isolation:\s*isolate/);
    assert.match(styles, /\.glass-motion-surface[\s\S]*will-change:\s*transform, opacity/);
    assert.match(styles, /\.glass-motion-container[\s\S]*will-change:\s*transform, opacity, filter/);

    assert.match(contestCard, /manual-login-panel manual-login-panel-enter glass-motion-surface/);
    assert.match(contestCard, /backdrop-blur-xl border border-slate-200\/50[\s\S]*glass-motion-surface[\s\S]*transition-all duration-500/);
    assert.match(styles, /@keyframes manual-login-panel-in[\s\S]*translate3d\(0, -10px, 0\) scale\(0\.94\)[\s\S]*translate3d\(0, 2px, 0\) scale\(1\.01\)[\s\S]*translate3d\(0, 0, 0\) scale\(1\)/);
    assert.match(classAction, /glass-motion-surface absolute inset-0[\s\S]*backdrop-blur-md animate-in fade-in zoom-in-95 duration-200/);
    assert.match(classAction, /系统维护[\s\S]*修复登录[\s\S]*删除班级/);
    assert.match(accountManager, /glass-motion-container grid transition-\[grid-template-rows,opacity,transform\] duration-500/);
    assert.match(accountManager, /glass-motion-surface rounded-2xl[\s\S]*backdrop-blur-sm/);
    assert.match(announcement, /glass-motion-container mb-8[\s\S]*transition-all duration-700/);
    assert.match(announcement, /glass-motion-surface group relative overflow-hidden[\s\S]*backdrop-blur-md[\s\S]*transition-all hover:scale-\[1\.01\]/);
    assert.match(announcement, /window\.open\(announcement\.link, '_blank', 'noopener,noreferrer'\)/);
    assert.match(announcement, /role="group"[\s\S]*打开公告链接[\s\S]*aria-label="关闭公告"/);
});

function ruleBody(selector) {
    const start = styles.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `${selector} rule exists`);
    return styles.slice(start, styles.indexOf('}', start));
}

test('login bar docks by cross-fading two static layers and sliding content, never clipping per frame', () => {
    // The brand's transform transition commits the swap, with a timer fallback.
    assert.match(loginPage, /classList\?\.contains\('login-navbar-brand'\)[\s\S]*event\.propertyName === 'transform'[\s\S]*onUnlockTransitionEnd/);
    assert.match(loginPage, /onTransitionCancel/);
    assert.match(loginPage, /if \(!isUnlocking\) return undefined;[\s\S]*setTimeout\(\(\) => onUnlockTransitionEnd\?\.\(\), 900\)/);
    assert.doesNotMatch(authSession, /unlockTimerRef|setTimeout\(completeLoginTransition|startViewTransition/);
    assert.match(authSession, /document\.visibilityState !== 'hidden'/);
    // Nothing on the bar animates clip-path, radius, shadow or blur.
    assert.doesNotMatch(ruleBody('.login-portal-header'), /transition|clip-path|will-change|backdrop-filter/);
    assert.match(styles, /\.login-portal-header::before,\s*\.login-portal-header::after \{[^}]*transition: opacity 520ms/);
    assert.match(styles, /\.login-portal-header::after \{\s*top: 16px;[^}]*left: var\(--login-navbar-dock-side\)[^}]*border-radius: 16px[^}]*opacity: 0;/);
    assert.match(styles, /\.login-portal-header-unlocking::before \{ opacity: 0; \}/);
    assert.match(styles, /\.login-portal-header-unlocking::after \{ opacity: 1; \}/);
    // Docked geometry matches the measured dashboard navbar, so the swap has no jump.
    assert.match(styles, /\.login-portal-header-unlocking \.login-navbar-brand \{[\s\S]*translate3d\(calc\(var\(--login-navbar-content-shift\) \+ 1px\), var\(--login-navbar-dock-y\), 0\)/);
    assert.match(styles, /\.login-portal-header-unlocking \.login-navbar-login-actions \{[\s\S]*translate3d\(calc\(-1px - var\(--login-navbar-content-shift\)\), var\(--login-navbar-dock-y\), 0\)/);
    assert.match(styles, /@media \(min-width: 768px\) \{\s*\.login-portal-header \{\s*--login-navbar-dock-y: 19px;\s*--login-navbar-dock-bottom: -22px;/);
});

test('dashboard navbar uses CSS animation and clears its one-shot entry state from animationend', () => {
    assert.doesNotMatch(authSession, /navbarTransitionTimerRef|setTimeout\(completeNavbarTransition/);
    assert.match(authSession, /completeNavbarTransition[\s\S]*setIsNavbarTransitioning\(false\)/);
    assert.match(styles, /\.dashboard-navbar-entering \.dashboard-navbar-search[\s\S]*animation: dashboard-navbar-control-in/);
    assert.match(styles, /\.dashboard-navbar-entering \.dashboard-navbar-actions[\s\S]*animation: dashboard-navbar-control-in/);
    assert.match(styles, /@keyframes dashboard-navbar-control-in[\s\S]*from \{ opacity: 0; \}[\s\S]*to \{ opacity: 1; \}/);
    assert.match(navbar, /event\.animationName === 'dashboard-navbar-control-in'[\s\S]*onEntryTransitionEnd\?\.\(\)/);
});

test('login card and wallpaper leave with compositor-only motion', () => {
    assert.match(loginPage, /login-auth-card glass-motion-surface w-full rounded-3xl transition-all duration-500/);
    assert.match(ruleBody('.login-auth-card.glass-motion-surface'), /will-change:\s*transform, opacity;/);
    assert.match(styles, /@keyframes login-card-arrive[\s\S]*translateY\(18px\) scale\(\.985\)[\s\S]*translateY\(0\) scale\(1\)/);
    const unlock = styles.match(/@keyframes login-card-unlock \{[\s\S]*?\r?\n\}/)?.[0] || '';
    assert.match(unlock, /translate3d\(0, 0, 0\) scale\(1\)[\s\S]*translate3d\(0, -10px, 0\) scale\(\.965\)/);
    assert.doesNotMatch(unlock, /filter/);
    assert.match(styles, /\.login-auth-card-unlocking \{[\s\S]*animation: login-card-unlock 340ms/);
    // The wallpaper never animates its blur radius: a pre-blurred copy fades out.
    assert.doesNotMatch(ruleBody('.wallpaper-background-layer'), /filter|transition/);
    assert.match(ruleBody('.wallpaper-soft-copy'), /filter: blur\(16px\)[\s\S]*transition: opacity 900ms/);
});
