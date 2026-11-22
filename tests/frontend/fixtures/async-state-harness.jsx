import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../src/App.jsx';
import AgentTaskCard from '../../../src/components/cards/AgentTaskCard.jsx';
import ProfileModal from '../../../src/components/modals/ProfileModal.jsx';
import TaskAppModal from '../../../src/components/modals/TaskAppModal.jsx';
import { useAgentTaskResults } from '../../../src/hooks/useAgentTaskResults.js';
import { useAuthSession } from '../../../src/hooks/useAuthSession.js';
import { useCompetitionActions } from '../../../src/hooks/useCompetitionActions.js';
import { getBrandImageCenterOffset } from '../../../src/utils/brandImageAlignment.js';
import { prepareLogoDataUrl } from '../../../src/utils/logoUpload.js';

const scenario = new URLSearchParams(window.location.search);
const mode = scenario.get('mode');
if (mode === 'logo-upload') {
    window.__prepareLogoDataUrl = prepareLogoDataUrl;
    window.__getBrandImageCenterOffset = getBrandImageCenterOffset;
}

const moduleFixtureLink = (id, title, softwareUnique, agentModule, agentResult) => ({
    id, title, ssoMethod: 'paasV2', paasV2SoftwareUnique: softwareUnique,
    agentModule, agentResult
});
const marketModule = { id: '1', title: '市场分析', order: 1 };
const supplyModule = { id: '2', title: '供应链数据分析', order: 2 };
const moduleFixtureLinks = [
    moduleFixtureLink(43, '仓储任务', 'sjfxah', { ...supplyModule, taskOrder: 1 }),
    moduleFixtureLink(42, '甲类指标解读', 'sjfxah', { ...marketModule, taskOrder: 2 }),
    moduleFixtureLink(45, '补充练习', 'sjfxah'),
    moduleFixtureLink(41, '乙类指标解读', 'sjfxah', { ...marketModule, taskOrder: 1 }, { status: 'completed', score: 0 }),
    moduleFixtureLink(51, '独立平台案例', 'another-platform', marketModule),
    moduleFixtureLink(52, '独立平台练习', 'another-platform', supplyModule),
    moduleFixtureLink(61, '历史任务', 'legacy-platform')
];
const moduleFixturePlatforms = [
    { softwareUnique: 'sjfxah', code: 'SJFX', name: '数据分析方法与工具应用' },
    { softwareUnique: 'another-platform', code: 'OTHER', name: '独立平台' },
    { softwareUnique: 'legacy-platform', code: 'LEGACY', name: '历史平台' }
];
const missingDeleteBinding = '班级删除映射未配置';
const unconfiguredMaintenance = {
    delete: missingDeleteBinding,
    repair: '登录修复未绑定平台实例',
    initialize: '系统初始化未绑定平台实例'
};
let configuredJavaCard = {
    id: 73, title: '已绑定实训', url: 'https://fixture.example/bound', ssoMethod: 'java', teacherReady: 1,
    classDeleteMapping: {
        enabled: true, apiId: 'fixture-account-service', databaseName: 'training', classTable: 'classes',
        classNameColumn: 'class_name', classIdColumn: 'id', userTable: 'accounts', userClassColumn: 'class_id'
    }
};

const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
window.__calls = [];
window.__notifications = [];
window.__activeCoverRequests = 0;
window.__maxCoverRequests = 0;
window.__agentResult = mode === 'agent-modules' ? { status: 'completed', score: 86.5 } : null;
window.__failRefresh = scenario.get('rejectRefresh') === '1';
window.__profileUser = {
    id: 7, username: 'fixture-user', role: mode === 'maintenance' ? 'super_admin' : 'student',
    avatarDataUrl: avatar,
    // remind=1: an administrator-created account inside its 7-day reminder
    // period, without an email. mustChange=1: the period has already ended.
    email: scenario.get('remind') === '1' ? null : 'fixture-user@example.invalid',
    passwordChangeRecommended: scenario.get('mustChange') === '1' || scenario.get('remind') === '1',
    passwordChangeDeadline: scenario.get('remind') === '1'
        ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 60_000).toISOString() : null
};
window.__testApi = async (method, url, body, requestToken) => {
    window.__calls.push({ method, url, body });
    if (method === 'POST' && url === '/sso/class/remove') return { deleted: true, className: '演示班' };
    if (method === 'POST' && url === '/sso/account-readiness/73/repair') {
        const student = { loginRole: 'student', studentIndex: 1 };
        return body.targets ? { repaired: [student], failed: [] }
            : { repaired: [{ loginRole: 'teacher', studentIndex: 1 }], failed: [student] };
    }
    if (method === 'DELETE') return new Promise(resolve => { window.__releaseDelete = resolve; });
    if (method === 'PATCH' && url === '/users/me/profile') {
        window.__profileUser = { ...window.__profileUser, ...body };
        return { success: true, user: window.__profileUser };
    }
    if (method === 'PATCH' && url === '/users/me/email') {
        window.__profileUser = { ...window.__profileUser, email: body.email.toLowerCase() };
        return { user: window.__profileUser };
    }
    if (method === 'POST' && url === '/auth/change-password') {
        if (scenario.get('mustChange') !== '1' && scenario.get('remind') !== '1') return { success: true };
        window.__profileUser = { ...window.__profileUser, passwordChangeRecommended: false };
        return { success: true, token: 'rotated-token' };
    }
    if (method === 'POST' && url === '/auth/login') return { user: window.__profileUser, token: 'fixture-token' };
    if (method === 'POST' && url === '/paas-v2/result') return window.__agentResult;
    if (method === 'POST' && url === '/paas-v2/reset') {
        if (window.__failAgentReset) throw new Error('Fixture reset failed');
        return { success: true };
    }
    if (method === 'POST' && url === '/sso/execute/stream') {
        if (window.__failAgentLaunch) throw new Error('Fixture launch failed');
        return { success: true, redirectUrl: `${location.origin}/provider` };
    }
    if (method === 'POST' && url === '/paas-v2/covers/cache') {
        window.__activeCoverRequests += 1;
        window.__maxCoverRequests = Math.max(window.__maxCoverRequests, window.__activeCoverRequests);
        await new Promise(resolve => setTimeout(resolve, 10));
        window.__activeCoverRequests -= 1;
        if (body.urls[0]?.endsWith('/100.png')) throw Object.assign(new Error('Fixture blocked cover'), { code: 'cover_url_not_allowed' });
        return { covers: Object.fromEntries(body.urls.map(url => [url, `/cached/${url.split('/').at(-1)}`])) };
    }
    if (method === 'POST' && url === '/competitions/batch-paas-v2') return { created: body.tasks.length };
    if (url === '/auth/me' && scenario.has('authOffline')) throw new Error('Fixture offline');
    if (url === '/auth/me' && scenario.get('deferAuth') === '1') return new Promise((resolve, reject) => {
        window.__releaseAuth = () => {
            window.dispatchEvent(new CustomEvent('fixture-unauthorized', { detail: { token: requestToken } }));
            reject(Object.assign(new Error('Fixture old token expired'), { status: 401 }));
            window.__oldAuthRejected = true;
        };
    });
    if (url === '/auth/me' && scenario.get('deferAuth') === 'success') {
        await new Promise(resolve => { window.__releaseAuth = resolve; });
    }
    if (url === '/auth/me') return { user: requestToken === 'replacement-token'
        ? { id: 8, username: 'replacement-user', role: 'student' } : window.__profileUser };
    if (mode === 'maintenance' && method === 'GET' && url === '/sso-config') {
        return [{ id: 'fixture-java', configData: { method: 'java' } }];
    }
    if (mode === 'maintenance' && method === 'PUT' && url === '/competitions/73') {
        configuredJavaCard = { ...configuredJavaCard, ...body };
        return { success: true };
    }
    if (url === '/competitions' && scenario.has('timedCards')) {
        const opensAt = new Date(Date.now() + 20_000).toISOString();
        return Array.from({ length: 80 }, (_, index) => ({
            id: index + 1, title: `Fixture card ${index + 1}`, unlockTime: index === 0 ? opensAt : null
        }));
    }
    if (url === '/competitions' && mode === 'maintenance') return [
        { id: 71, title: 'Java 实训', url: 'https://fixture.example/java', ssoMethod: 'java', maintenance: unconfiguredMaintenance },
        { id: 72, title: '直达实训', url: 'https://fixture.example/direct', ssoMethod: 'direct' },
        {
            ...configuredJavaCard,
            maintenance: {
                delete: configuredJavaCard.classDeleteMapping?.enabled ? null : missingDeleteBinding,
                repair: null,
                initialize: null
            }
        }
    ];
    if (url === '/competitions' && mode === 'agent-modules') {
        const links = [...moduleFixtureLinks, { id: 90, title: '普通竞赛', ssoMethod: 'java' }];
        if (scenario.get('deferCatalog') === '1') {
            await new Promise(resolve => { window.__releaseCatalog = resolve; });
        }
        return links;
    }
    if (url === '/competitions') return [];
    if (url === '/sso/student-accounts') return [];
    if (url === '/paas-v2/platforms') return mode === 'agent-modules' ? moduleFixturePlatforms : [];
    if (url.startsWith('/paas-v2/catalog')) return { tasks: scenario.get('largeCatalog') === '1'
        ? Array.from({ length: 500 }, (_, index) => ({ title: `Fixture task ${index}`, plugFlag: `task-${index}`, answerType: '1', cover: `https://covers.example/${index}.png` }))
        : [{ title: 'Fixture task', plugFlag: 'task-1', answerType: '1' }] };
    if (url.startsWith('/content/updates')) return { announcements: { changed: false, revision: '1' }, gifts: { changed: false, revision: '1' }, serverTime: new Date().toISOString() };
    return {};
};

function ProfileFixture() {
    const [user, setUser] = useState(window.__profileUser);
    const [open, setOpen] = useState(true);
    return open ? <ProfileModal isOpen user={user} onClose={() => setOpen(false)} onSaved={async savedUser => {
        if (window.__failRefresh) throw new Error('Fixture refresh offline');
        setUser(savedUser || window.__profileUser);
    }} /> : <p>PROFILE CLOSED</p>;
}

function PlatformFixture() {
    const [open, setOpen] = useState(true);
    const [platforms, setPlatforms] = useState([{ code: 'FIXTURE', name: 'Fixture platform', softwareUnique: 'scyxcjrh', theme: 'violet' }]);
    const [ssoConfigs, setSsoConfigs] = useState([]);
    window.__setSsoConfigs = setSsoConfigs;
    window.__renderedSsoConfigCount = ssoConfigs.length;
    return open ? <TaskAppModal isOpen platforms={platforms} ssoConfigs={scenario.get('lateSso') === '1' ? ssoConfigs : undefined} onClose={() => setOpen(false)} onPlatformsChange={async () => { setPlatforms([]); return []; }} /> : <p>TASK CLOSED</p>;
}

function AuthFixture() {
    window.__session = useAuthSession();
    return <p data-testid="session-user">{window.__session.currentUser?.username || 'anonymous'}</p>;
}

window.__agentPopups = [];
if (scenario.get('mode') === 'agent-score') {
    window.open = () => {
        const popup = {
            document: document.implementation.createHTMLDocument('Fixture popup'),
            closed: false,
            close() { this.closed = true; },
            location: { replace(url) { popup.url = url; } }
        };
        window.__agentPopups.push(popup);
        return popup;
    };
}

function AgentScoreFixture() {
    const [links, setLinks] = useState([{
        id: 42, title: 'Fixture agent task', ssoMethod: 'paasV2',
        agentResult: scenario.get('legacyProgress') === '1' ? { status: 'in_progress', score: null } : null
    }]);
    const { agentScoreStates, refreshAgentTaskScore, handleResetAgentTask, trackAgentTaskReturn } = useAgentTaskResults({
        token: 'fixture-token', userId: window.__profileUser.id, links, setLinks, fetchLinks: async () => {}
    });
    const { handleOpenCompetition, openingCompetitionKeys } = useCompetitionActions({
        token: 'fixture-token', currentUser: window.__profileUser, setLinks, refreshAgentTaskScore, trackAgentTaskReturn
    });
    const link = links[0];
    const scoreState = agentScoreStates[link.id];
    const openTask = (card, role, target, options) => {
        window.__calls.push({ action: 'open-agent', cardId: card.id, role, target, options });
        return handleOpenCompetition(card, role, target, options);
    };
    return <AgentTaskCard link={link} scoreResult={scoreState?.result} scoreLoading={scoreState?.loading}
        scoreError={scoreState?.error} resetting={scoreState?.resetting} onRefreshScore={refreshAgentTaskScore}
        onOpen={openTask} onReset={handleResetAgentTask}
        openingCompetitionKeys={openingCompetitionKeys} />;
}

if (['app', 'auth', 'agent-score', 'agent-modules', 'maintenance'].includes(mode) && scenario.get('signedOut') !== '1') {
    localStorage.setItem('authToken', 'fixture-token');
    localStorage.setItem('authUser', JSON.stringify(window.__profileUser));
}
const fixtures = { profile: ProfileFixture, platform: PlatformFixture, auth: AuthFixture, 'agent-score': AgentScoreFixture };
const Fixture = fixtures[mode] || App;
createRoot(document.getElementById('root')).render(<Fixture />);
