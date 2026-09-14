import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Boxes, Check, CircleDot, Code2, Database, ExternalLink, Eye, EyeOff,
    KeyRound, Link2, Loader2, Network, RadioTower, Save, ServerCog, ShieldCheck
} from 'lucide-react';
import { api } from '../../../utils/api';
import { notify } from '../../../utils/uiFeedback';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';

const METHODS = [
    {
        id: 'java', name: 'JAVA 通用', badge: 'REST', color: 'indigo', icon: Code2,
        serviceName: 'NewTrainingInterfaceUtilService',
        description: '接口自动建班并按教师/学生身份跳转',
        path: 'commonReturnTeacherBaseInfo / StudentBaseInfo'
    },
    {
        id: 'net', name: '.NET 通用', badge: 'SOAP', color: 'blue', icon: Boxes,
        serviceName: 'NetGeneralStandardInterfaceUtilService', profile: 'netGeneralStandard',
        description: '标准 .NET 实训平台免密入口',
        path: '/normwebservice.asmx → /Login.aspx'
    },
    {
        id: 'marketing', name: '市场营销沙盘', badge: 'SOAP', color: 'amber', icon: RadioTower,
        serviceName: 'ShichangyingxiaoshapanInterfaceUtilService', profile: 'shapan_shichangyingxiao',
        description: '市场营销沙盘专用适配器',
        path: 'SOAP Ticket → /Login.aspx'
    },
    {
        id: 'commerce', name: '电子商务沙盘', badge: 'SOAP', color: 'emerald', icon: Database,
        serviceName: 'WangdianyunyingtuiguangGJshapanInterfaceUtilService', profile: 'shapan_wangdianyunyingtuiguanggaoji',
        description: '网店运营推广高级沙盘',
        path: 'SOAP Ticket → /Login.aspx'
    },
    {
        id: 'managementAccounting', name: '管理会计高级', badge: 'SOAP', color: 'indigo', icon: Database,
        serviceName: 'GuanlikuaijiGJshapanInterfaceUtilService', profile: 'shapan_guanlikuaijigaoji',
        description: '管理会计高级沙盘专用适配器',
        path: 'SOAP Ticket → /Login.aspx'
    },
    {
        id: 'crossBorderCommerce', name: '跨境电商', badge: 'SOAP', color: 'blue', icon: Boxes,
        serviceName: 'KuajingdianshangshapanInterfaceUtilService', profile: 'shapan_kuajingdianshang',
        description: '跨境电商沙盘专用适配器',
        path: 'SOAP Ticket → /Login.aspx'
    },
    {
        id: 'enterpriseManagement', name: '企业管理', badge: 'SOAP', color: 'emerald', icon: ServerCog,
        serviceName: 'QiyeguanlishapanInterfaceUtilService', profile: 'shapan_qiyeguanli',
        description: '企业管理沙盘专用适配器',
        path: 'SOAP Ticket → /Login.aspx'
    },
    {
        id: 'direct', name: '直接跳转', badge: '轻量', color: 'slate', icon: ExternalLink,
        serviceName: 'jump',
        description: '原样使用当前竞赛卡片的跳转地址',
        path: 'Card URL → Browser Redirect'
    },
    {
        id: 'paasV2', name: 'PaaS 新版免密跳转', badge: 'REST+FORM', color: 'violet', icon: ServerCog,
        serviceName: 'PaasV2AgentAdapter',
        description: 'PT04/大渔智能体任务免密入口',
        path: '/GetTokenInfo → POST /enterIndex'
    }
];

const DEFAULT_CONFIG = {
    method: 'java',
    serviceName: METHODS[0].serviceName,
    baseUrl: '',
    allowHttp: false,
    className: '默认班级',
    teacherUserName: 'teacher',
    roleName: 'student',
    teamName: '',
    flag: '1',
    trainOrExam: 'train',
    loginRole: 'student',
    classPrefix: 'mc',
    teacherPrefix: 'mc',
    studentPrefix: 'mcs',
    studentSuffix: '1',
    expertPrefix: 'mcpw',
    tokenNumber: '',
    tokenPassword: '',
    soapUsername: '',
    soapPassword: '',
    ticketType: 'itmc',
    studentInitialPassword: '123456'
};

const tones = {
    indigo: { icon: 'bg-indigo-100 text-indigo-600', active: 'border-indigo-400 bg-indigo-50/80 shadow-indigo-100', tag: 'bg-indigo-100 text-indigo-600' },
    violet: { icon: 'bg-violet-100 text-violet-600', active: 'border-violet-400 bg-violet-50/80 shadow-violet-100', tag: 'bg-violet-100 text-violet-600' },
    blue: { icon: 'bg-blue-100 text-blue-600', active: 'border-blue-400 bg-blue-50/80 shadow-blue-100', tag: 'bg-blue-100 text-blue-600' },
    amber: { icon: 'bg-amber-100 text-amber-600', active: 'border-amber-400 bg-amber-50/80 shadow-amber-100', tag: 'bg-amber-100 text-amber-700' },
    emerald: { icon: 'bg-emerald-100 text-emerald-600', active: 'border-emerald-400 bg-emerald-50/80 shadow-emerald-100', tag: 'bg-emerald-100 text-emerald-700' },
    slate: { icon: 'bg-slate-100 text-slate-600', active: 'border-slate-400 bg-slate-50 shadow-slate-100', tag: 'bg-slate-100 text-slate-600' }
};

const safeParse = (value) => {
    try { return typeof value === 'string' ? JSON.parse(value) : (value || {}); }
    catch { return {}; }
};

const credentialValuesFor = (methodId, defaults = {}) => methodId === 'java'
    ? { tokenNumber: defaults.java?.tokenNumber || '', tokenPassword: defaults.java?.tokenPassword || '' }
    : methodId === 'direct' || methodId === 'paasV2'
        ? {}
        : { soapUsername: defaults.soap?.soapUsername || '', soapPassword: defaults.soap?.soapPassword || '', ticketType: defaults.soap?.ticketType || 'itmc', studentInitialPassword: defaults.soap?.studentInitialPassword || '123456' };

const SAVED_SECRET_MASK = '••••••••••••';

const SecretField = ({
    label,
    value,
    configured,
    editing,
    revealed,
    placeholder,
    onChange,
    onEdit,
    onCancel,
    onToggleVisibility,
    revealing
}) => {
    const acceptsInput = !configured || editing;
    const hasLoadedValue = revealed && typeof value === 'string' && value.length > 0;
    const displayValue = configured && !editing && !hasLoadedValue
        ? SAVED_SECRET_MASK
        : (value || '');
    return (
        <label className="flex min-h-[118px] min-w-0 flex-col rounded-xl border border-slate-100 bg-white/85 p-3 shadow-sm">
            <span className="flex min-h-5 min-w-0 items-center justify-between gap-2 text-[10px] font-bold text-slate-600">
                <span className="min-w-0 truncate">{label}</span>
                {configured && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[8px] font-black text-emerald-700">已配置</span>}
            </span>
            <span className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
                <span className="relative min-w-0">
                    <input
                    type={revealed ? 'text' : 'password'}
                    value={displayValue}
                    onChange={event => acceptsInput && onChange(event.target.value)}
                    readOnly={!acceptsInput}
                    placeholder={acceptsInput ? placeholder : ''}
                    autoComplete="new-password"
                    aria-label={label}
                    className={`h-10 w-full min-w-0 rounded-lg border px-3 pr-10 font-mono text-xs outline-none ${acceptsInput ? 'border-violet-100 bg-white focus:border-violet-400' : 'cursor-default border-emerald-100 bg-emerald-50/70 text-emerald-700'}`}
                    />
                    <button
                        type="button"
                        onClick={onToggleVisibility}
                        disabled={revealing}
                        aria-label={revealed ? `隐藏${label}` : `显示${label}`}
                        title={revealed ? `隐藏${label}` : `显示${label}`}
                        className="absolute inset-y-0 right-0 grid w-9 place-items-center text-slate-400 transition hover:text-violet-600 disabled:cursor-wait disabled:opacity-50"
                    >
                        {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                </span>
                {configured && (editing
                    ? <button type="button" onClick={onCancel} className="h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-600 hover:bg-slate-50">取消</button>
                    : <button type="button" onClick={onEdit} className="h-10 shrink-0 rounded-lg border border-violet-200 bg-white px-3 text-[9px] font-bold text-violet-600 hover:bg-violet-50">修改</button>)}
            </span>
            <small className="mt-2 block text-[8px] leading-3 text-slate-400">
                {configured && !editing ? '密码已安全保存；点击“修改”可设置新密码。' : configured ? '输入新密码并保存；取消修改会继续使用原密码。' : '尚未配置，请输入后保存。'}
            </small>
        </label>
    );
};

const CredentialField = ({ label, value, onChange, help = '\u00a0', type = 'text' }) => (
    <label className="flex min-h-[118px] min-w-0 flex-col rounded-xl border border-slate-100 bg-white/85 p-3 shadow-sm">
        <span className="flex min-h-5 items-center text-[10px] font-bold text-slate-600">{label}</span>
        <input
            type={type}
            value={value || ''}
            onChange={event => onChange(event.target.value)}
            autoComplete="off"
            className="mt-2 h-10 w-full min-w-0 rounded-lg border border-violet-100 bg-white px-3 font-mono text-xs outline-none focus:border-violet-400"
        />
        <small className="mt-2 block text-[8px] leading-3 text-slate-400">{help}</small>
    </label>
);

const SsoManager = ({ configs = [], token, fetchConfigs, loadError = '', onRetry }) => {
    const [selectedId, setSelectedId] = useState(null);
    const [configName, setConfigName] = useState('JAVA 通用配置');
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [revealingSecrets, setRevealingSecrets] = useState(false);
    const [secretsLoaded, setSecretsLoaded] = useState(false);
    const [showSecrets, setShowSecrets] = useState(false);
    const [editingSecrets, setEditingSecrets] = useState({
        tokenPassword: false,
        soapPassword: false,
        studentInitialPassword: false
    });
    const [credentialDefaults, setCredentialDefaults] = useState({});
    const [defaultsLoadError, setDefaultsLoadError] = useState('');
    const [consoleLines, setConsoleLines] = useState([
        { type: 'muted', text: '等待配置检测…' },
        { type: 'muted', text: '接口凭据由管理员配置并在本地服务端使用。' }
    ]);

    const method = useMemo(() => METHODS.find(item => item.id === config.method) || METHODS[0], [config.method]);
    const isSoap = Boolean(method.profile);
    const isPaasV2 = config.method === 'paasV2';
    const matchingConfigs = useMemo(() => configs.filter(item => (
        safeParse(item.configData).method === config.method && safeParse(item.configData).canaryOnly !== true
    )), [config.method, configs]);

    const loadCredentialDefaults = useCallback(async () => {
        if (!token) return;
        setDefaultsLoadError('');
        try {
            const defaults = await api.get('/sso-config/defaults', { fallback: 'SSO 凭据读取失败' });
            setCredentialDefaults(defaults || {});
            setConfig(current => ({ ...current, ...credentialValuesFor(current.method, defaults) }));
        } catch (error) {
            setDefaultsLoadError(error.message || 'SSO 凭据读取失败');
        }
    }, [token]);

    useEffect(() => {
        loadCredentialDefaults();
    }, [loadCredentialDefaults]);

    useEffect(() => {
        setEditingSecrets({ tokenPassword: false, soapPassword: false, studentInitialPassword: false });
        setShowSecrets(false);
        setSecretsLoaded(false);
        // The list endpoint is ordered by id descending, so the first matching
        // record is the newest configuration for this official adapter.
        const target = matchingConfigs[0] || null;
        setSelectedId(target?.id || null);
        if (!target) {
            setConfig(current => ({
                ...DEFAULT_CONFIG,
                ...credentialValuesFor(current.method, credentialDefaults),
                method: current.method,
                serviceName: METHODS.find(item => item.id === current.method)?.serviceName || METHODS[0].serviceName
            }));
            setDirty(false);
            setConfigName(`${METHODS.find(item => item.id === config.method)?.name || 'SSO'}配置`);
            setConsoleLines([{ type: 'muted', text: '当前接入方式尚未保存，填写后即可启用。' }]);
            return;
        }
        const parsed = safeParse(target.configData);
        const parsedConfig = { ...parsed };
        delete parsedConfig.adapterMode;
        delete parsedConfig.instanceVariant;
        setConfig({
            ...DEFAULT_CONFIG,
            ...credentialValuesFor(config.method, credentialDefaults),
            ...parsedConfig,
            method: config.method,
            serviceName: METHODS.find(item => item.id === config.method)?.serviceName || parsed.serviceName,
            // Credential identifiers are visible to administrators. Password fields
            // stay blank and their saved state is shown through configuredSecrets.
            tokenNumber: parsed.tokenNumber || '',
            tokenPassword: '',
            soapUsername: parsed.soapUsername || '',
            soapPassword: '',
            studentInitialPassword: ''
        });
        setDirty(false);
        setConfigName(target.name || `${METHODS.find(item => item.id === config.method)?.name || 'SSO'}配置`);
        setConsoleLines([{ type: 'success', text: `已加载 ${METHODS.find(item => item.id === config.method)?.name || '当前平台'} 的官方兼容配置` }]);
    }, [config.method, credentialDefaults, matchingConfigs]);

    const update = (field, value) => {
        setConfig(current => ({ ...current, [field]: value }));
        setDirty(true);
    };

    const editSecret = field => {
        setConfig(current => ({ ...current, [field]: '' }));
        setEditingSecrets(current => ({ ...current, [field]: true }));
    };

    const cancelSecretEdit = field => {
        setConfig(current => ({ ...current, [field]: '' }));
        setEditingSecrets(current => ({ ...current, [field]: false }));
    };

    const toggleSecretVisibility = async () => {
        if (showSecrets) {
            setShowSecrets(false);
            return;
        }
        if (secretsLoaded || Object.values(editingSecrets).some(Boolean) || !selectedId || !config.hasSecrets) {
            setShowSecrets(true);
            return;
        }
        setRevealingSecrets(true);
        try {
            const revealed = await api.post(`/sso-config/${selectedId}/reveal-secrets`, {}, { fallback: '读取已保存凭据失败' });
            const secretFields = ['tokenPassword', 'soapPassword', 'studentInitialPassword'];
            setConfig(current => ({
                ...current,
                ...Object.fromEntries(secretFields.map(field => [field, revealed[field] || '']))
            }));
            setSecretsLoaded(true);
            setShowSecrets(true);
        } catch (error) {
            notify(`读取凭据失败：${error.message}`, 'error');
        } finally {
            setRevealingSecrets(false);
        }
    };

    const selectMethod = (item) => {
        const first = configs.find(entry => safeParse(entry.configData).method === item.id && safeParse(entry.configData).canaryOnly !== true);
        setSelectedId(first?.id || null);
        setConfig(current => ({
            ...current,
            method: item.id,
            serviceName: item.serviceName,
            ...credentialValuesFor(item.id, credentialDefaults)
        }));
        setDirty(true);
        setConsoleLines([
            { type: 'success', text: `已切换到 ${item.name}` },
            { type: 'muted', text: item.description }
        ]);
    };

    const validate = () => {
        if (!METHODS.some(item => item.id === config.method)) throw new Error('接入方式无效');
    };

    const save = async () => {
        try { validate(); } catch (error) { notify(error.message, 'warning'); return; }
        setSaving(true);
        try {
            const persistedConfig = { ...config };
            ['baseUrl', 'teacherLoginPassword', 'adapterMode', 'instanceVariant', 'hasSecrets', 'configuredSecrets']
                .forEach(key => delete persistedConfig[key]);
            const payload = {
                name: configName.trim() || `${method.name}配置`,
                baseUrl: '',
                configData: JSON.stringify({
                    ...persistedConfig,
                    serviceName: method.serviceName
                }, null, 2)
            };
            const data = selectedId
                ? await api.put(`/sso-config/${selectedId}`, payload, { fallback: '保存失败' })
                : await api.post('/sso-config', payload, { fallback: '保存失败' });
            await fetchConfigs();
            if (!selectedId && data.id) setSelectedId(data.id);
            setEditingSecrets({ tokenPassword: false, soapPassword: false, studentInitialPassword: false });
            setShowSecrets(false);
            setSecretsLoaded(false);
            setDirty(false);
            setConsoleLines([{ type: 'success', text: '✓ 配置已保存到 Cloudflare D1' }]);
        } catch (error) {
            notify(`保存失败：${error.message}`, 'error');
        } finally { setSaving(false); }
    };

    const run = async () => {
        try { validate(); } catch (error) { setConsoleLines([{ type: 'error', text: error.message }]); return; }
        setConsoleLines([{ type: 'muted', text: '平台地址来自竞赛卡片；保存卡片后可使用 dry-run 完成零网络预检。此处不发起远程请求。' }]);
    };

    return (
        <div className="settings-theme-aware animate-in fade-in duration-500 pb-10">
            <div className="mb-4 space-y-2">
                <LoadErrorNotice message={loadError} onRetry={onRetry} />
                <LoadErrorNotice message={defaultsLoadError} onRetry={loadCredentialDefaults} compact />
            </div>
            <div className="sso-hero mb-6 overflow-hidden rounded-[28px] border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/70 to-blue-50/80 p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="max-w-2xl">
                        <div className="mb-3 flex items-center gap-2 text-[11px] font-black tracking-[0.2em] text-indigo-500"><KeyRound className="h-4 w-4" /> ACCESS GATEWAY</div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900">免密登录配置</h1>
                        <p className="mt-2 text-sm leading-6 text-slate-500">竞赛地址由卡片自动提供，这里统一管理官方兼容接入、账号规则和服务端凭据。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <span className="flex items-center gap-2 rounded-full border border-white bg-white/80 px-3 py-2 text-[10px] font-bold text-slate-600 shadow-sm"><Check className="h-3.5 w-3.5 text-emerald-500" />9 种内置适配器</span>
                        <span className="flex items-center gap-2 rounded-full border border-white bg-white/80 px-3 py-2 text-[10px] font-bold text-slate-600 shadow-sm"><ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />凭据仅服务端使用</span>
                    </div>
                </div>
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
                <section className="rounded-3xl border border-white bg-white/85 p-3 shadow-lg shadow-slate-200/40 backdrop-blur-xl xl:sticky xl:top-6">
                    <div className="px-3 pb-3 pt-2"><h2 className="text-sm font-black text-slate-800">选择接入方式</h2><p className="mt-1 text-[11px] text-slate-400">官方组件内已确认的 9 种适配器</p></div>
                    <div className="space-y-2">
                        {METHODS.map(item => {
                            const Icon = item.icon;
                            const active = item.id === config.method;
                            const tone = tones[item.color];
                            return <button key={item.id} onClick={() => selectMethod(item)} className={`group relative flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${active ? `${tone.active} shadow-md` : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}>
                                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.icon}`}><Icon className="h-5 w-5" /></span>
                                <span className="min-w-0 flex-1"><b className="block text-xs text-slate-800">{item.name}</b><small className="mt-1 block truncate text-[9px] text-slate-400">{item.description}</small></span>
                                <span className={`rounded-full px-2 py-1 text-[8px] font-black ${tone.tag}`}>{item.badge}</span>
                                {active && <CircleDot className="absolute right-2 top-2 h-3 w-3 text-indigo-500" />}
                            </button>;
                        })}
                    </div>
                </section>

                <section className="overflow-hidden rounded-3xl border border-white bg-white/90 shadow-lg shadow-slate-200/50 backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
                        <div className="flex min-w-0 items-center gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tones[method.color].icon}`}>{React.createElement(method.icon, { className: 'h-5 w-5' })}</span><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="text-base font-black text-slate-900">{method.name}</h2><span className={`rounded-full px-2 py-0.5 text-[8px] font-black ${selectedId ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{selectedId ? '已启用' : '待保存'}</span></div><p className="mt-1 truncate font-mono text-[9px] text-slate-400">{method.serviceName} · 官方组件</p></div></div>
                        <div className="flex items-center gap-2"><button onClick={run} className="flex h-9 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-white transition hover:bg-emerald-600"><RadioTower className="h-3.5 w-3.5" />运行检测</button><button onClick={save} disabled={saving} className="flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存</button></div>
                    </div>

                    <div className="space-y-5 p-6">
                        {!selectedId && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                                当前接入方式尚未保存配置。填写凭据并保存后，竞赛卡片会自动绑定该类型的最新配置。
                            </div>
                        )}
                        <div className="grid gap-3 md:grid-cols-2">
                            <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-600 shadow-sm"><Link2 className="h-5 w-5" /></span><div><b className="block text-xs text-slate-800">地址来自竞赛卡片</b><p className="mt-1 text-[9px] leading-4 text-slate-500">自动读取卡片跳转链接，不需要重复配置平台地址。</p></div></div>
                            <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-sm"><ServerCog className="h-5 w-5" /></span><div><b className="block text-xs text-slate-800">内置服务适配器</b><p className="mt-1 truncate font-mono text-[8px] text-slate-500">{method.serviceName}</p></div></div>
                        </div>

                        {isPaasV2 ? (
                            <div className="sso-adapter-panel rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-indigo-50/50 p-4">
                                <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><span className="rounded-lg bg-violet-600 px-2 py-1 text-[9px] font-black text-white">PAAS V2</span><div><b className="block text-xs text-slate-800">大渔智能体免密通道</b><small className="text-[9px] text-slate-400">PaasV2AgentAdapter · GetTokenInfo + POST form</small></div></div><Network className="h-5 w-5 text-violet-500" /></div>
                                <div className="grid min-w-0 gap-3 md:grid-cols-2">
                                    <CredentialField label="接口地址 trainPath / apiBaseUrl" value={config.apiBaseUrl} onChange={value => update('apiBaseUrl', value)} help="用于调用 GetTokenInfo，例如 https://dayu.itmc.org.cn/prod-api/agent/open" />
                                    <CredentialField label="跳转地址 trainJumpPath" value={config.jumpBaseUrl} onChange={value => update('jumpBaseUrl', value)} help="浏览器最终 POST 跳转地址，例如 .../agent/open/enterIndex" />
                                    <CredentialField label="产品编号 productId" value={config.productId} onChange={value => update('productId', value)} help="PT04 系列通常为 PT04" />
                                    <CredentialField label="调用方公钥 publicKey" value={config.publicKey} onChange={value => update('publicKey', value)} help="GetTokenInfo 请求中的 publicKey" />
                                    <CredentialField label="平台公钥 externalPublicKey" value={config.externalPublicKey} onChange={value => update('externalPublicKey', value)} help="用于加密 ticket 和 data" />
                                    <CredentialField label="临时密钥 tempKey JSON" value={typeof config.tempKey === 'string' ? config.tempKey : JSON.stringify(config.tempKey || {})} onChange={value => update('tempKey', value)} help="按你的要求明文保存并回显；含 publicKey/applicationPublicKey 时优先使用。" />
                                    <div className="md:col-span-2 rounded-2xl border border-violet-100 bg-white/70 p-4">
                                        <div className="mb-3 flex items-center justify-between"><b className="text-[10px] text-slate-600">productUserId 结构</b><span className="text-[8px] font-bold text-violet-500">大渔用户身份标识</span></div>
                                        <div className="grid gap-2 sm:grid-cols-4">
                                            <label className="space-y-1"><span className="text-[9px] font-bold text-slate-400">第一部分 · 手机号</span><input value="系统自动生成" readOnly className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-400" /></label>
                                            <label className="space-y-1"><span className="text-[9px] font-bold text-slate-400">第二部分 · 固定标识</span><input value={config.userTypeSegment || 'STU'} onChange={e => update('userTypeSegment', e.target.value)} className="h-9 w-full rounded-lg border border-violet-100 bg-white px-2 text-[10px] font-bold text-violet-700 outline-none focus:border-violet-400" /></label>
                                            <label className="space-y-1"><span className="text-[9px] font-bold text-slate-400">第三部分 · 用户名</span><input value="MC+当前登录用户名" readOnly className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-400" /></label>
                                            <label className="space-y-1"><span className="text-[9px] font-bold text-slate-400">第四部分 · productModuleId</span><input value="由任务卡片决定，如 KJDZSWRJXT" readOnly className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-400" /></label>
                                        </div>
                                        <p className="mt-2 rounded-lg bg-violet-50/70 px-2 py-1.5 font-mono text-[9px] text-slate-500">预览：自动生成手机号-{config.userTypeSegment || 'STU'}-MC当前登录用户名_KJDZSWRJXT（按卡片变化）</p>
                                    </div>
                                </div>

                            </div>
                        ) : null}

                        {isSoap ? (
                            <div className="sso-adapter-panel rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 p-4">
                                <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><span className="rounded-lg bg-blue-600 px-2 py-1 text-[9px] font-black text-white">SOAP</span><div><b className="block text-xs text-slate-800">传统平台网关</b><small className="text-[9px] text-slate-400">{method.profile}</small></div></div><Network className="h-5 w-5 text-blue-500" /></div>
                                <div className="mb-4 grid min-w-0 gap-3 rounded-2xl border border-violet-100 bg-white/60 p-3 sm:grid-cols-2 sm:p-4">
                                    <CredentialField label="SOAP 用户名" value={config.soapUsername} onChange={value => update('soapUsername', value)} help="服务端 clientinfo 用户名。" />
                                    <SecretField label="SOAP 密码" value={config.soapPassword} configured={Boolean(config.configuredSecrets?.soapPassword)} editing={editingSecrets.soapPassword} revealed={showSecrets} revealing={revealingSecrets} placeholder="请输入 SOAP 密码" onChange={value => update('soapPassword', value)} onEdit={() => editSecret('soapPassword')} onCancel={() => cancelSecretEdit('soapPassword')} onToggleVisibility={toggleSecretVisibility} />
                                    <CredentialField label="登录票据类型/密钥" value={config.ticketType || 'itmc'} onChange={value => update('ticketType', value)} help="默认使用 itmc。" />
                                    <SecretField label="新建学生初始密码" value={config.studentInitialPassword} configured={Boolean(config.configuredSecrets?.studentInitialPassword)} editing={editingSecrets.studentInitialPassword} revealed={showSecrets} revealing={revealingSecrets} placeholder="请输入初始密码" onChange={value => update('studentInitialPassword', value)} onEdit={() => editSecret('studentInitialPassword')} onCancel={() => cancelSecretEdit('studentInitialPassword')} onToggleVisibility={toggleSecretVisibility} />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-2"><span className="text-[10px] font-bold text-slate-500">SOAP 执行方式</span><div className="flex h-10 items-center rounded-xl border border-emerald-100 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-700">{method.name}内置完整流程 · 无需绑定工作流</div></div>
                                    <div className="space-y-2"><span className="text-[10px] font-bold text-slate-500">SOAP 地址来源</span><div className="flex h-10 items-center rounded-xl border border-blue-100 bg-white/70 px-3 text-[9px] font-bold text-blue-600">从卡片链接自动推导 NormWebService.asmx</div></div>
                                </div>
                                <div className="mt-4 grid gap-3 rounded-2xl border border-blue-100 bg-white/70 p-4 md:grid-cols-4">
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">班级名称前缀</span><input value={config.classPrefix ?? 'mc'} onChange={e => update('classPrefix', e.target.value)} className="h-9 w-full rounded-lg border border-blue-100 bg-white px-3 text-xs font-bold text-blue-700 outline-none focus:border-blue-400" /><small className="text-[8px] text-slate-400">预览：{config.classPrefix ?? 'mc'}&#123;当前用户名&#125;</small></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">教师账号前缀</span><input value={config.teacherPrefix ?? 'mc'} onChange={e => update('teacherPrefix', e.target.value)} className="h-9 w-full rounded-lg border border-blue-100 bg-white px-3 text-xs font-bold text-blue-700 outline-none focus:border-blue-400" /><small className="text-[8px] text-slate-400">预览：{config.teacherPrefix ?? 'mc'}&#123;当前用户名&#125;</small></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">评委账号前缀</span><input value={config.expertPrefix ?? 'mcpw'} onChange={e => update('expertPrefix', e.target.value)} className="h-9 w-full rounded-lg border border-blue-100 bg-white px-3 text-xs font-bold text-blue-700 outline-none focus:border-blue-400" /><small className="text-[8px] text-slate-400">预览：{config.expertPrefix ?? 'mcpw'}&#123;当前用户名&#125;</small></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">学生账号规则</span><div className="flex gap-2"><input value={config.studentPrefix ?? 'mcs'} onChange={e => update('studentPrefix', e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-blue-100 bg-white px-3 text-xs font-bold text-blue-700 outline-none focus:border-blue-400" /><input value={config.studentSuffix ?? '1'} onChange={e => update('studentSuffix', e.target.value)} title="账号后缀" className="h-9 w-14 rounded-lg border border-blue-100 bg-white px-2 text-center text-xs font-bold text-blue-700 outline-none focus:border-blue-400" /></div><small className="text-[8px] text-slate-400">预览：{config.studentPrefix ?? 'mcs'}&#123;当前用户名&#125;{config.studentSuffix ?? '1'}</small></label>
                                </div>
                                <div className="mt-4 grid gap-2 rounded-xl bg-white/65 p-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {[['01','创建班级'],['02','创建教师'],['03','创建学生'],['04','签发票据并登录']].map(step => <div key={step[0]} className="flex items-center gap-2"><b className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-[8px] text-blue-600">{step[0]}</b><span className="text-[9px] font-bold text-slate-600">{step[1]}</span></div>)}
                                </div>
                                <p className="mt-3 text-[9px] leading-relaxed text-blue-500">点击竞赛卡片后按顺序完成班级、教师、学生账号准备，再提取 <code>loginTicket</code>、<code>ticket</code> 或 <code>data</code>，自动进入目标系统。</p>
                            </div>
                        ) : method.id === 'java' ? (
                            <div className="sso-adapter-panel rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-violet-50/50 p-4">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3"><span className="rounded-lg bg-indigo-600 px-2 py-1 text-[9px] font-black text-white">REST</span><div><b className="block text-xs text-slate-800">JAVA 原生自动建班与账号</b><small className="text-[9px] text-slate-400">NewTrainingInterfaceUtilService · 不使用 SOAP</small></div></div>
                                    <ServerCog className="h-5 w-5 text-indigo-500" />
                                </div>
                                <div className="rounded-xl border border-indigo-100 bg-white/70 p-3 text-[9px] leading-relaxed text-indigo-600">
                                    平台地址从竞赛卡片读取。教师端调用 <code>commonReturnTeacherBaseInfo</code>，学生端调用对应学生接口，不再使用用户名密码登录。
                                </div>
                                <div className="mt-4 rounded-2xl border border-violet-100 bg-white/75 p-4">
                                <div className="mb-3 flex items-center justify-between"><b className="text-[10px] text-slate-600">JAVA 接口凭据</b></div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <CredentialField label="Token 编号" value={config.tokenNumber} onChange={value => update('tokenNumber', value)} help="JAVA platformToken 的 tokenNum。" />
                                    <SecretField label="Token 密码" value={config.tokenPassword} configured={Boolean(config.configuredSecrets?.tokenPassword)} editing={editingSecrets.tokenPassword} revealed={showSecrets} revealing={revealingSecrets} placeholder="请输入 Token 密码" onChange={value => update('tokenPassword', value)} onEdit={() => editSecret('tokenPassword')} onCancel={() => cancelSecretEdit('tokenPassword')} onToggleVisibility={toggleSecretVisibility} />
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-3 rounded-2xl border border-indigo-100 bg-white/70 p-4 md:grid-cols-4">
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">班级名称前缀</span><input value={config.classPrefix ?? 'mc'} onChange={e => update('classPrefix', e.target.value)} className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-xs font-bold text-indigo-700 outline-none focus:border-indigo-400" /><small className="text-[8px] text-slate-400">预览：{config.classPrefix ?? 'mc'}&#123;当前用户名&#125;</small></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">教师账号前缀</span><input value={config.teacherPrefix ?? 'mc'} onChange={e => update('teacherPrefix', e.target.value)} className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-xs font-bold text-indigo-700 outline-none focus:border-indigo-400" /><small className="text-[8px] text-slate-400">预览：{config.teacherPrefix ?? 'mc'}&#123;当前用户名&#125;</small></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">评委账号前缀</span><input value={config.expertPrefix ?? 'mcpw'} onChange={e => update('expertPrefix', e.target.value)} className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-xs font-bold text-indigo-700 outline-none focus:border-indigo-400" /><small className="text-[8px] text-slate-400">预览：{config.expertPrefix ?? 'mcpw'}&#123;当前用户名&#125;</small></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">学生账号规则</span><div className="flex gap-2"><input value={config.studentPrefix ?? 'mcs'} onChange={e => update('studentPrefix', e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-indigo-100 bg-white px-3 text-xs font-bold text-indigo-700 outline-none focus:border-indigo-400" /><input value={config.studentSuffix ?? '1'} onChange={e => update('studentSuffix', e.target.value)} title="账号后缀" className="h-9 w-14 rounded-lg border border-indigo-100 bg-white px-2 text-center text-xs font-bold text-indigo-700 outline-none focus:border-indigo-400" /></div><small className="text-[8px] text-slate-400">预览：{config.studentPrefix ?? 'mcs'}&#123;当前用户名&#125;{config.studentSuffix ?? '1'}</small></label>
                                </div>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">默认进入身份</span><select value={config.loginRole ?? 'student'} onChange={e => update('loginRole', e.target.value)} className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-xs outline-none"><option value="student">学生端（mcs 前缀）</option><option value="teacher">教师端（mc 前缀）</option></select></label>
                                    <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">运行类型</span><select value={config.trainOrExam} onChange={e => update('trainOrExam', e.target.value)} className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-xs outline-none"><option value="train">训练</option><option value="exam">考试</option></select></label>
                                </div>
                                <div className="mt-4 grid gap-2 rounded-xl bg-white/65 p-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {[['01','获取平台 Token'],['02','准备班级与教师'],['03','准备学生账号'],['04','按身份独立登录']].map(step => <div key={step[0]} className="flex items-center gap-2"><b className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-[8px] text-indigo-600">{step[0]}</b><span className="text-[9px] font-bold text-slate-600">{step[1]}</span></div>)}
                                </div>
                            </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-violet-600 shadow-sm"><ShieldCheck className="h-5 w-5" /></span><div><b className="block text-xs text-slate-800">凭据安全保存，可由管理员显式回显</b><p className="mt-1 text-[9px] text-slate-400">配置列表不会携带密码；点击密码输入框右侧眼睛即可查看，读取响应禁止缓存。</p></div></div><label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold text-slate-500"><input type="checkbox" checked={config.allowHttp} onChange={e => update('allowHttp', e.target.checked)} className="h-4 w-4 accent-amber-500" />允许 HTTP 平台</label></div>

                        <div className="overflow-hidden rounded-2xl bg-slate-950"><div className="flex items-center justify-between border-b border-slate-800 px-4 py-2"><span className="flex items-center gap-2 text-[9px] font-bold text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />配置检测</span>{dirty && <span className="text-[9px] font-bold text-amber-400">有未保存修改</span>}</div><div className="min-h-[76px] space-y-1 px-4 py-3 font-mono text-[10px]">{consoleLines.map((line, index) => <p key={index} className={line.type === 'error' ? 'text-red-400' : line.type === 'success' ? 'text-emerald-400' : 'text-slate-500'}>{line.text}</p>)}</div></div>
                    </div>
                </section>

            </div>
        </div>
    );
};

export default SsoManager;
