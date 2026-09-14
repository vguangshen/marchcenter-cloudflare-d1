import React, { useCallback, useEffect, useState } from 'react';
import {
    Activity, AlertTriangle, CheckCircle2, ChevronDown, Clock3, KeyRound, Loader2,
    Database, Eye, EyeOff, Plus, Save, ServerCog, Trash2
} from 'lucide-react';
import { api } from '../../../utils/api';
import { confirmAction } from '../../../utils/uiFeedback';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';

const EMPTY_SERVICE = {
    id: '', name: '新账号服务', enabled: true, endpointUrl: '', healthPath: '/health',
    authMode: 'hmac', timeoutMs: 10000, signingSecret: '', configuredSecrets: {}
};
const EMPTY_DATABASES = {
    sqlServer: { Enabled: false, Host: '', Port: 1433, User: '', Password: '', InitialDatabase: 'master', IntegratedSecurity: false, Encrypt: false, TrustServerCertificate: true, CommandTimeoutSeconds: 10 },
    mySql: { Enabled: false, Host: '', Port: 3306, User: '', Password: '', InitialDatabase: 'mysql', CharacterSet: 'utf8mb4', SslMode: 'None', CommandTimeoutSeconds: 10 }
};

const AccountManagementApiManager = ({ token }) => {
    const [services, setServices] = useState([]);
    const [form, setForm] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [expanded, setExpanded] = useState(false);
    const [databases, setDatabases] = useState(() => structuredClone(EMPTY_DATABASES));

    const request = useCallback(async (path, options = {}) => {
        const { method = 'GET', body, ...requestOptions } = options;
        const headers = {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(requestOptions.headers || {})
        };
        const normalizedBody = typeof body === 'string' ? JSON.parse(body) : body;
        const requestPath = `/account-management${path}`;
        if (method.toUpperCase() === 'DELETE') return api.delete(requestPath, { ...requestOptions, headers });
        if (method.toUpperCase() === 'GET') return api.get(requestPath, { ...requestOptions, headers });
        const methodClient = api[method.toLowerCase()];
        if (typeof methodClient !== 'function') throw new Error(`不支持的请求方法：${method}`);
        return methodClient(requestPath, normalizedBody, { ...requestOptions, headers });
    }, [token]);

    const load = useCallback(async (preferredId = '') => {
        setLoading(true);
        setLoadError('');
        try {
            const data = await request('/services');
            const next = Array.isArray(data.services) ? data.services : [];
            setServices(next);
            const selected = next.find(item => item.id === preferredId) || next[0] || null;
            setForm(selected ? { ...EMPTY_SERVICE, ...selected } : null);
            setDatabases(selected?.databaseConnections ? structuredClone(selected.databaseConnections) : structuredClone(EMPTY_DATABASES));
        } catch (error) {
            setLoadError(error.message || '账号管理 API 列表读取失败');
            setNotice(null);
        }
        finally { setLoading(false); }
    }, [request]);
    useEffect(() => { load(); }, [load]);

    const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
    const selectService = service => {
        setForm({ ...EMPTY_SERVICE, ...service });
        setDatabases(service?.databaseConnections ? structuredClone(service.databaseConnections) : structuredClone(EMPTY_DATABASES));
    };
    const payload = (source = form, extra = {}) => ({
        name: source.name, enabled: source.enabled, endpointUrl: source.endpointUrl,
        healthPath: '/health', authMode: 'hmac', timeoutMs: Number(source.timeoutMs),
        signingSecret: source.signingSecret || '', ...extra
    });

    const save = async () => {
        if (!form) return;
        setBusy('save'); setNotice(null);
        try {
            const creating = !form.id;
            const data = await request(creating ? '/services' : `/services/${form.id}`, {
                method: creating ? 'POST' : 'PUT', body: JSON.stringify(payload())
            });
            const serviceId = data.config.id;
            await request(`/services/${serviceId}/database-config`, {
                method: 'PUT', body: JSON.stringify({ connections: databases })
            });
            setNotice({ type: 'success', text: creating ? 'API 服务及数据库配置已添加' : 'API 服务、认证与数据库配置已保存' });
            await load(serviceId);
        } catch (error) { setNotice({ type: 'error', text: error.message }); }
        finally { setBusy(''); }
    };

    const updateDatabase = (provider, key, value) => setDatabases(previous => ({ ...previous, [provider]: { ...previous[provider], [key]: value } }));
    const test = async () => {
        if (!form?.id) return setNotice({ type: 'error', text: '请先保存新服务，再进行连接检测' });
        setBusy('test'); setNotice(null);
        const databaseDraft = structuredClone(databases);
        try {
            const result = await request(`/services/${form.id}/test`, {
                method: 'POST',
                body: JSON.stringify(payload(form, { connections: databases }))
            });
            const hasEnabledDatabase = Boolean(databases.sqlServer?.Enabled || databases.mySql?.Enabled);
            const providerNames = [
                ...(databases.sqlServer?.Enabled ? ['SQL Server'] : []),
                ...(databases.mySql?.Enabled ? ['MySQL'] : [])
            ];
            setNotice({
                type: 'success',
                text: result.setupRequired
                    ? `执行端连接成功 · ${result.latencyMs} ms，已读取加密公钥`
                    : `连接检测通过 · 执行端 ${result.latencyMs} ms${hasEnabledDatabase ? ` · ${providerNames.join('、')}` : ''}`
            });
            await load(form.id);
            setDatabases(databaseDraft);
        } catch (error) {
            setNotice({ type: 'error', text: error.message });
            await load(form.id);
            setDatabases(databaseDraft);
        }
        finally { setBusy(''); }
    };

    const toggle = async service => {
        setBusy(`toggle-${service.id}`);
        try {
            await request(`/services/${service.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !service.enabled }) });
            await load(service.id);
        } catch (error) { setNotice({ type: 'error', text: error.message }); }
        finally { setBusy(''); }
    };

    const remove = async service => {
        if (!await confirmAction({
            title: '删除账号管理 API',
            message: `确定删除“${service.name}”吗？\n已绑定该 API 的竞赛卡片将自动解除账号数据库绑定，卡片本身不会被删除。`,
            confirmText: '删除'
        })) return;
        setBusy(`delete-${service.id}`);
        try {
            const result = await request(`/services/${service.id}`, { method: 'DELETE' });
            const count = Number(result.unboundCompetitionCount || 0);
            setNotice({ type: 'success', text: count > 0 ? `API 服务已删除，并自动解绑 ${count} 张竞赛卡片` : 'API 服务已删除' });
            await load();
        }
        catch (error) { setNotice({ type: 'error', text: error.message }); }
        finally { setBusy(''); }
    };

    const clearCredentials = async () => {
        if (!form?.id || !await confirmAction({
            title: '清除认证凭证',
            message: '确定清除该 API 的认证凭证吗？清除后需要重新配置才能连接。',
            confirmText: '清除'
        })) return;
        setBusy('clear');
        try { await request(`/services/${form.id}`, { method: 'PUT', body: JSON.stringify(payload(form, { clearCredentials: true })) }); await load(form.id); setNotice({ type: 'success', text: '认证凭证已清除' }); }
        catch (error) { setNotice({ type: 'error', text: error.message }); }
        finally { setBusy(''); }
    };

    const secretPlaceholder = key => form?.configuredSecrets?.[key] ? '已安全保存，留空保持不变' : '请输入凭证';
    const databaseReady = Boolean(form?.deviceReady && form?.publicKey && form?.deviceId);
    if (loading) return <div className="flex min-h-[420px] items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />正在读取 API 服务列表…</div>;

    return <div className="space-y-6 animate-in fade-in duration-500">
        <header className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><ServerCog className="h-7 w-7 text-indigo-500" />账号管理 API</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">集中管理多个服务器执行端；每个 API 都可独立启用、检测和绑定竞赛卡片。</p></div>
            <button onClick={() => { setForm({ ...EMPTY_SERVICE }); setDatabases(structuredClone(EMPTY_DATABASES)); setExpanded(true); }} className="flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-xs font-black text-white shadow-lg dark:bg-indigo-600"><Plus className="h-4 w-4" />新增 API</button>
        </header>

        <LoadErrorNotice message={loadError} onRetry={() => load()} />
        {notice && <div className={`flex gap-3 rounded-2xl border p-4 text-sm ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{notice.text}</div>}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white/85 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {services.map((service, index) => <article key={service.id} onClick={() => selectService(service)} className={`group relative flex min-h-28 cursor-pointer items-center px-5 transition-colors sm:px-6 ${form?.id === service.id ? 'bg-indigo-50/70 dark:bg-indigo-950/35' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                <div className="flex w-full items-center gap-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black ${form?.id === service.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{String(index + 1).padStart(2, '0')}</div>
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate font-black text-slate-800 dark:text-white">{service.name}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${service.transport === 'HTTP' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{service.transport || '未配置'}</span></div><p className="mt-1 truncate font-mono text-[11px] text-slate-500">{service.endpointUrl || '尚未填写 API 地址'}</p></div>
                    <div className={`hidden min-w-28 text-right text-[11px] sm:block ${service.lastTestAt ? service.lastTestOk ? 'text-emerald-600' : 'text-red-600' : 'text-slate-400'}`}>{!service.lastTestAt ? '尚未检测' : service.lastTestOk ? `连接正常 · ${service.lastLatencyMs} ms` : '连接失败'}</div>
                    <button onClick={event => { event.stopPropagation(); toggle(service); }} disabled={busy === `toggle-${service.id}`} className={`relative h-7 w-12 shrink-0 rounded-full transition ${service.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} aria-label={service.enabled ? '停用此 API' : '启用此 API'}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${service.enabled ? 'left-6' : 'left-1'}`} /></button>
                    <button onClick={event => { event.stopPropagation(); remove(service); }} className="rounded-lg p-2 text-slate-400 opacity-70 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                </div>
                {form?.id === service.id && <button type="button" onClick={event => { event.stopPropagation(); setExpanded(previous => !previous); }} className="absolute inset-x-0 bottom-0 flex h-8 items-center justify-center gap-2 bg-transparent px-4 text-[11px] font-black leading-none text-slate-500 transition-colors hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300">
                    {expanded ? '收起详细配置' : `展开“${service.name}”的详细配置`}
                    <ChevronDown className={`h-4 w-4 transition-transform duration-500 ${expanded ? 'rotate-180' : ''}`} />
                </button>}
            </article>)}
            </div>
            {!services.length && <div className="col-span-full rounded-3xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">暂无账号管理 API，点击“新增 API”开始配置。</div>}
        </section>

        <div className={`glass-motion-container grid transition-[grid-template-rows,opacity,transform] duration-500 ease-out ${expanded && form ? 'grid-rows-[1fr] translate-y-0 opacity-100' : 'pointer-events-none grid-rows-[0fr] -translate-y-3 opacity-0'}`}>
        <div className="overflow-hidden">
        {form && <section className="space-y-5 rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-black text-slate-800 dark:text-white">{form.id ? '编辑 API 服务' : '新增 API 服务'}</h2><p className="mt-1 text-xs text-slate-500">统一配置执行端、认证与数据库；连接类型由地址自动识别。</p></div><div className="flex gap-2"><button onClick={test} disabled={Boolean(busy)} className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}连接检测</button><button onClick={save} disabled={Boolean(busy)} className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存</button></div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-950/45">
                <div className="mb-4"><h3 className="font-black text-slate-800 dark:text-white">执行端连接</h3><p className="mt-1 text-xs text-slate-500">填写服务地址即可，系统固定通过标准接口检测运行状态。</p></div>
                <div className="grid gap-4 md:grid-cols-[1fr_180px]"><Field label="服务名称"><input className="account-api-input" value={form.name} onChange={e => update('name', e.target.value)} /></Field><Field label="超时时间"><select className="account-api-input" value={form.timeoutMs} onChange={e => update('timeoutMs', Number(e.target.value))}>{[5000,10000,15000,30000].map(value => <option key={value} value={value}>{value / 1000} 秒</option>)}</select></Field></div>
                <div className="mt-4"><Field label="API 地址"><input className="account-api-input font-mono" value={form.endpointUrl} onChange={e => update('endpointUrl', e.target.value)} placeholder="https://api.example.com 或 http://IP:端口" /></Field></div>
                {form.endpointUrl?.startsWith('http://') && <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />已自动识别为 HTTP。链路不加密，建议优先使用 HTTPS 或 Cloudflare Tunnel 域名。</div>}
            </div>
            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-5 dark:border-emerald-900/70 dark:bg-emerald-950/25"><div className="flex items-center justify-between"><div><h3 className="flex items-center gap-2 font-black text-emerald-900 dark:text-emerald-100"><KeyRound className="h-5 w-5 text-emerald-600" />安全认证</h3><p className="mt-1 text-xs text-emerald-700/75 dark:text-emerald-300/70">HMAC 密钥需与 Windows 执行端保持一致。</p></div>{form.hasSecrets && <button onClick={clearCredentials} className="text-xs font-bold text-red-600">清除凭证</button>}</div><div className="mt-4"><Secret revealable label="HMAC 签名密钥（与 Windows 执行端保持一致）" value={form.signingSecret} onChange={v => update('signingSecret', v)} placeholder={secretPlaceholder('signingSecret')} /></div></div>
            <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 via-blue-50/75 to-cyan-50/70 p-5 shadow-inner shadow-indigo-100/40 dark:border-indigo-800/70 dark:from-indigo-950/45 dark:via-slate-900/70 dark:to-cyan-950/30">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-black text-slate-800 dark:text-white"><Database className="h-5 w-5 text-indigo-500" />数据库连接</h3><p className="mt-1 text-xs text-slate-500">连接信息由网站加密保存；顶部“连接检测”和“保存”会统一处理这里的配置。</p></div>{form.databaseConfigAppliedAt && <span className="text-xs font-bold text-emerald-600">最近保存：{new Date(form.databaseConfigAppliedAt).toLocaleString()}</span>}</div>
                {!databaseReady && <div className="mt-4 flex gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800"><AlertTriangle className="h-4 w-4 shrink-0" />数据库信息可以先填写；检测前请先保存与 Windows 执行端一致的 HMAC 签名密钥。</div>}
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    <ProviderPanel title="SQL Server" color="blue" value={databases.sqlServer} onChange={(key, value) => updateDatabase('sqlServer', key, value)} sqlServer />
                    <ProviderPanel title="MySQL" color="emerald" value={databases.mySql} onChange={(key, value) => updateDatabase('mySql', key, value)} />
                </div>
                {form.databaseConfigLastError && <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700">上次同步失败：{form.databaseConfigLastError}</div>}
            </div>
            {form.lastTestAt && <div className="grid gap-3 sm:grid-cols-3"><Status icon={form.lastTestOk ? CheckCircle2 : AlertTriangle} label="最近检测" value={form.lastTestOk ? '连接正常' : '连接失败'} /><Status icon={Clock3} label="响应时间" value={form.lastLatencyMs == null ? '--' : `${form.lastLatencyMs} ms`} /><Status icon={Activity} label="检测时间" value={new Date(form.lastTestAt).toLocaleString()} /></div>}
        </section>}
        </div>
        </div>
    </div>;
};

const Field = ({ label, children }) => <label className="block"><span className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>{children}</label>;
const Secret = ({ label, value, onChange, placeholder, revealable = false }) => {
    const [visible, setVisible] = useState(false);
    return <Field label={label}><div className="relative"><input type={visible ? 'text' : 'password'} autoComplete="new-password" className={`account-api-input ${revealable ? 'pr-12' : ''}`} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />{revealable && <button type="button" onClick={() => setVisible(current => !current)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-indigo-600" aria-label={visible ? '隐藏 HMAC 签名密钥' : '显示 HMAC 签名密钥'} title={visible ? '隐藏密钥' : '显示密钥'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}</div></Field>;
};
const Status = ({ icon: Icon, label, value }) => <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950"><div className="flex items-center gap-2 text-[10px] font-bold text-slate-400"><Icon className="h-4 w-4 text-indigo-500" />{label}</div><div className="mt-2 text-xs font-black text-slate-800 dark:text-slate-100">{value}</div></div>;
const ProviderPanel = ({ title, value, onChange, sqlServer = false }) => <div className="glass-motion-surface rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/60">
    <div className="flex items-center justify-between"><h4 className="font-black text-slate-800 dark:text-white">{title}</h4><label className="flex items-center gap-2 text-xs font-bold text-slate-500"><input type="checkbox" checked={value.Enabled} onChange={e => onChange('Enabled', e.target.checked)} />启用</label></div>
    <div className={`mt-4 space-y-3 transition-opacity ${value.Enabled ? '' : 'pointer-events-none opacity-40'}`}>
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]"><Mini label="服务器地址"><input className="account-api-input" maxLength={100} value={value.Host} onChange={e => onChange('Host', e.target.value)} placeholder="localhost（留空默认）" /></Mini><Mini label="端口"><input type="number" className="account-api-input" value={value.Port} onChange={e => onChange('Port', Number(e.target.value))} /></Mini></div>
        <div className="grid gap-3 sm:grid-cols-2"><Mini label="数据库账号"><input className="account-api-input" maxLength={80} value={value.User} onChange={e => onChange('User', e.target.value)} /></Mini><Mini label="数据库密码"><input type="password" className="account-api-input" maxLength={120} value={value.Password} onChange={e => onChange('Password', e.target.value)} /></Mini></div>
        <Mini label="初始数据库"><input className="account-api-input" maxLength={80} value={value.InitialDatabase} onChange={e => onChange('InitialDatabase', e.target.value)} /></Mini>
        <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500">{sqlServer ? <><label><input type="checkbox" checked={value.IntegratedSecurity} onChange={e => onChange('IntegratedSecurity', e.target.checked)} /> Windows 身份验证</label><label><input type="checkbox" checked={value.Encrypt} onChange={e => onChange('Encrypt', e.target.checked)} /> 加密连接</label><label><input type="checkbox" checked={value.TrustServerCertificate} onChange={e => onChange('TrustServerCertificate', e.target.checked)} /> 信任证书</label></> : <Mini label="SSL 模式"><select className="account-api-input h-9 py-0" value={value.SslMode} onChange={e => onChange('SslMode', e.target.value)}>{['None','Preferred','Required','VerifyCA','VerifyFull'].map(item => <option key={item}>{item}</option>)}</select></Mini>}</div>
    </div>
</div>;
const Mini = ({ label, children }) => <label className="block flex-1"><span className="mb-1 block text-[10px] font-bold text-slate-500">{label}</span>{children}</label>;

export default AccountManagementApiManager;
