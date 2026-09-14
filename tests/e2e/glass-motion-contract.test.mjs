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
    assert.match(classAction, /系统维护[\s\S]*账号已同步[\s\S]*修复登录[\s\S]*删除班级/);
    assert.match(classAction, /Java[\s\S]*\.NET[\s\S]*修复登录/);
    assert.match(contestCard, /onRepairAccountReadiness[\s\S]*repair:\$\{link\.id\}[\s\S]*ClassActionOverlay/);
    assert.match(accountManager, /glass-motion-container grid transition-\[grid-template-rows,opacity,transform\] duration-500/);
    assert.match(accountManager, /glass-motion-surface rounded-2xl[\s\S]*backdrop-blur-sm/);
    assert.match(announcement, /glass-motion-container mb-8[\s\S]*transition-all duration-700/);
    assert.match(announcement, /glass-motion-surface group relative overflow-hidden[\s\S]*backdrop-blur-md[\s\S]*transition-all hover:scale-\[1\.01\]/);
    assert.match(announcement, /window\.open\(announcement\.link, '_blank', 'noopener,noreferrer'\)/);
    assert.match(announcement, /role="group"[\s\S]*打开公告链接[\s\S]*aria-label="关闭公告"/);
});

test('login header keeps its docking animation on transform and clipping instead of layout edges', () => {
    assert.match(loginPage, /event\.propertyName === 'transform'/);
    assert.match(loginPage, /onTransitionCancel/);
    assert.doesNotMatch(authSession, /unlockTimerRef|setTimeout\(completeLoginTransition|1400/);
    assert.match(authSession, /document\.visibilityState !== 'hidden'/);
    assert.match(styles, /\.login-portal-header \{[\s\S]*transform: translate3d\(0, 0, 0\)[\s\S]*clip-path: inset\(0 0 0 0 round 0px\)[\s\S]*transition:[\s\S]*transform 840ms[\s\S]*clip-path 840ms/);
    assert.doesNotMatch(styles, /\.login-portal-header \{[\s\S]*\btop 840ms/);
    assert.doesNotMatch(styles, /\.login-portal-header \{[\s\S]*\bleft 840ms/);
    assert.doesNotMatch(styles, /\.login-portal-header \{[\s\S]*\bright 840ms/);
    assert.match(styles, /\.login-portal-header-unlocking \{[\s\S]*top: 0 !important[\s\S]*left: 0 !important[\s\S]*right: 0 !important[\s\S]*transform: translate3d\(0, 16px, 0\)[\s\S]*clip-path: inset\(0 var\(--login-navbar-dock-side\) 0 var\(--login-navbar-dock-side\) round 16px\)/);
    assert.match(loginPage, /login-navbar-login-actions flex shrink-0 items-center gap-2/);
    assert.match(styles, /\.login-navbar-brand,[\s\S]*\.login-navbar-login-actions \{[\s\S]*transition: transform 840ms/);
    assert.match(styles, /\.login-portal-header-unlocking \.login-navbar-brand \{[\s\S]*translate3d\(var\(--login-navbar-content-shift\), 0, 0\)/);
    assert.match(styles, /\.login-portal-header-unlocking \.login-navbar-login-actions \{[\s\S]*translate3d\(calc\(0px - var\(--login-navbar-content-shift\)\), 0, 0\)/);
});

test('dashboard navbar uses CSS animation and clears its one-shot entry state from animationend', () => {
    assert.doesNotMatch(authSession, /navbarTransitionTimerRef|setTimeout\(completeNavbarTransition/);
    assert.match(authSession, /completeNavbarTransition[\s\S]*setIsNavbarTransitioning\(false\)/);
    assert.match(styles, /\.dashboard-navbar-entering \.dashboard-navbar-search[\s\S]*animation: dashboard-navbar-control-in/);
    assert.match(styles, /\.dashboard-navbar-entering \.dashboard-navbar-actions[\s\S]*animation: dashboard-navbar-control-in/);
    assert.match(styles, /@keyframes dashboard-navbar-control-in[\s\S]*from \{ opacity: 0; \}[\s\S]*to \{ opacity: 1; \}/);
    assert.match(navbar, /event\.animationName === 'dashboard-navbar-control-in'[\s\S]*onEntryTransitionEnd\?\.\(\)/);
});

test('login auth glass card keeps its arrival and unlock motion while using a stable layer', () => {
    assert.match(loginPage, /login-auth-card glass-motion-surface w-full rounded-3xl transition-all duration-500/);
    assert.match(styles, /\.login-auth-card\.glass-motion-surface[\s\S]*will-change:\s*transform, opacity, filter/);
    assert.match(styles, /@keyframes login-card-arrive[\s\S]*translateY\(18px\) scale\(\.985\)[\s\S]*translateY\(0\) scale\(1\)/);
    assert.match(styles, /@keyframes login-card-unlock[\s\S]*filter: blur\(0\)[\s\S]*translate3d\(0, 0, 0\) scale\(1\)[\s\S]*filter: blur\(7px\)[\s\S]*translate3d\(0, -12px, 0\) scale\(\.982\)/);
    assert.match(styles, /\.login-auth-card-unlocking \{[\s\S]*animation: login-card-unlock 720ms cubic-bezier\(\.22, 1, \.36, 1\)/);
});
