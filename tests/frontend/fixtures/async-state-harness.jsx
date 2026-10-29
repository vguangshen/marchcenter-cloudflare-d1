import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../src/App.jsx';
import ProfileModal from '../../../src/components/modals/ProfileModal.jsx';
import TaskAppModal from '../../../src/components/modals/TaskAppModal.jsx';
import { useAuthSession } from '../../../src/hooks/useAuthSession.js';

const scenario = new URLSearchParams(window.location.search);
const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
window.__calls = [];
window.__notifications = [];
window.__activeCoverRequests = 0;
window.__maxCoverRequests = 0;
window.__failRefresh = scenario.get('rejectRefresh') === '1';
window.__profileUser = { id: 7, username: 'fixture-user', role: 'student', avatarDataUrl: avatar, passwordChangeRecommended: false };
window.__testApi = async (method, url, body, requestToken) => {
    window.__calls.push({ method, url, body });
    if (method === 'DELETE') return new Promise(resolve => { window.__releaseDelete = resolve; });
    if (method === 'PATCH' && url === '/users/me/profile') {
        window.__profileUser = { ...window.__profileUser, ...body };
        return { success: true, user: window.__profileUser };
    }
    if (method === 'POST' && url === '/auth/change-password') return { success: true };
    if (method === 'POST' && url === '/paas-v2/covers/cache') {
        window.__activeCoverRequests += 1;
        window.__maxCoverRequests = Math.max(window.__maxCoverRequests, window.__activeCoverRequests);
        await new Promise(resolve => setTimeout(resolve, 10));
        window.__activeCoverRequests -= 1;
        if (body.urls[0]?.endsWith('/100.png')) throw Object.assign(new Error('Fixture blocked cover'), { code: 'cover_url_not_allowed' });
        return { covers: Object.fromEntries(body.urls.map(url => [url, `/cached/${url.split('/').at(-1)}`])) };
    }
    if (method === 'POST' && url === '/competitions/batch-paas-v2') return { created: body.tasks.length };
    if (url === '/auth/me' && scenario.get('deferAuth') === '1') return new Promise((resolve, reject) => {
        window.__releaseAuth = () => {
            window.dispatchEvent(new CustomEvent('fixture-unauthorized', { detail: { token: requestToken } }));
            reject(Object.assign(new Error('Fixture old token expired'), { status: 401 }));
            window.__oldAuthRejected = true;
        };
    });
    if (url === '/auth/me') return { user: window.__profileUser };
    if (url === '/competitions' || url === '/sso/student-accounts') return [];
    if (url === '/paas-v2/platforms') return [];
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

const mode = scenario.get('mode');
if (mode === 'app' || mode === 'auth') {
    localStorage.setItem('authToken', 'fixture-token');
    localStorage.setItem('authUser', JSON.stringify(window.__profileUser));
}
createRoot(document.getElementById('root')).render(mode === 'profile' ? <ProfileFixture /> : mode === 'platform' ? <PlatformFixture /> : mode === 'auth' ? <AuthFixture /> : <App />);
