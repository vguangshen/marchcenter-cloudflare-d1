import React, { useCallback, useEffect, useState } from 'react';
import {
    AlertTriangle, AtSign, CheckCircle2, Clock3, Loader2,
    KeyRound, Mail, RefreshCw, Save, Send, Eye, EyeOff
} from 'lucide-react';
import { api } from '../../../utils/api';

const DEFAULT_SETTINGS = {
    provider: 'resend',
    enabled: false,
    fromEmail: '',
    fromName: 'MarchCenter',
    replyTo: '',
    resendApiKey: '',
    hasResendApiKey: false,
    verificationSubject: 'MarchCenter 登录验证码',
    verificationHeading: 'MarchCenter 登录验证码',
    verificationIntro: '您正在登录 MarchCenter，请使用下方验证码完成身份校验。',
    verificationFooter: '如非本人操作，请忽略本邮件。请勿将验证码告知他人。',
    codeTtlMinutes: 10,
    resendSeconds: 60
};

const isEmailAddress = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const SAVED_SECRET_MASK = '••••••••••••';

const EmailServiceManager = () => {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [status, setStatus] = useState({ providerAvailable: false, senderConfigured: false, enabled: false, ready: false });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testRecipient, setTestRecipient] = useState('');
    const [notice, setNotice] = useState(null);
    const [resendKeyVisible, setResendKeyVisible] = useState(false);
    const [resendKeyRevealed, setResendKeyRevealed] = useState('');
    const [revealingResendKey, setRevealingResendKey] = useState(false);
    const [resendKeyEdited, setResendKeyEdited] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setNotice(null);
        try {
            const data = await api.get('/email-settings');
            setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
            setStatus(data.status || {});
            setResendKeyEdited(false);
            setResendKeyRevealed('');
            setResendKeyVisible(false);
        } catch (error) {
            setNotice({ type: 'error', text: error.message });
        } finally {
            setLoading(false);
        }
    }, []);

    const toggleResendKey = async () => {
        if (resendKeyVisible) {
            setResendKeyVisible(false);
            return;
        }
        if (resendKeyRevealed) {
            setResendKeyVisible(true);
            return;
        }
        setRevealingResendKey(true);
        setNotice(null);
        try {
            const data = await api.get('/email-settings/reveal', { fallback: '密钥读取失败', retry: 0 });
            setResendKeyRevealed(data.resendApiKey || '');
            setResendKeyVisible(true);
        } catch (error) {
            setNotice({ type: 'error', text: error.message });
        } finally {
            setRevealingResendKey(false);
        }
    };

    useEffect(() => { load(); }, [load]);

    const update = (key, value) => {
        setSettings(current => ({ ...current, [key]: value }));
        setNotice(null);
    };

    const save = async () => {
        setSaving(true);
        setNotice(null);
        try {
            const data = await api.put('/email-settings', settings);
            setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
            setStatus(data.status || {});
            setNotice({ type: 'success', text: data.status?.ready ? '邮件服务已启用，验证码登录现在可用' : '配置已保存' });
        } catch (error) {
            setNotice({ type: 'error', text: error.message });
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async () => {
        if (!isEmailAddress(settings.fromEmail)) {
            setNotice({ type: 'error', text: '发件邮箱必须是完整邮箱地址，例如 noreply@mail.marchcenter.top，不能只填写域名。' });
            return;
        }
        if (!isEmailAddress(testRecipient)) {
            setNotice({ type: 'error', text: '请填写有效的测试收件邮箱。' });
            return;
        }
        if (!settings.resendApiKey && !settings.hasResendApiKey) {
            setNotice({ type: 'error', text: '请先填写 Resend API Key。' });
            return;
        }
        setTesting(true);
        setNotice(null);
        try {
            const data = await api.post('/email-settings/test', { recipient: testRecipient, settings });
            setNotice({ type: 'success', text: data.message || '测试邮件已提交发送' });
        } catch (error) {
            setNotice({ type: 'error', text: error.message });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-500" /></div>;
    }

    const hasSavedKey = Boolean(settings.hasResendApiKey);
    const displayResendKey = resendKeyEdited
        ? settings.resendApiKey
        : resendKeyVisible
            ? resendKeyRevealed
            : (hasSavedKey ? SAVED_SECRET_MASK : settings.resendApiKey);

    const stateItems = [
        {
            label: '发送服务',
            ok: Boolean(status.providerAvailable),
            detail: settings.hasResendApiKey ? 'Resend 密钥已加密保存' : '等待填写 Resend API Key'
        },
        { label: '发件身份', ok: Boolean(settings.fromEmail), detail: settings.fromEmail || '尚未填写发件邮箱' },
        { label: '验证码登录', ok: Boolean(status.ready), detail: status.ready ? '可正常使用' : '等待配置完成' }
    ];

    return (
        <div className="space-y-6">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white/85 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
                <div className="flex flex-col gap-5 border-b border-slate-100 p-6 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-4">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                            <Mail className="h-6 w-6" />
                        </span>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white">邮件服务</h2>
                            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                管理登录验证码邮件的发件身份、模板与安全频率。
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={load} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-indigo-200 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300" title="刷新状态">
                            <RefreshCw className="h-4 w-4" />
                        </button>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200">启用邮件服务</span>
                            <input className="sr-only" type="checkbox" checked={settings.enabled} onChange={event => update('enabled', event.target.checked)} />
                            <span className={`relative h-6 w-11 rounded-full transition ${settings.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </span>
                        </label>
                    </div>
                </div>

                <div className="grid gap-3 p-6 md:grid-cols-3">
                    {stateItems.map(item => (
                        <div key={item.label} className={`rounded-2xl border p-4 ${item.ok ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'}`}>
                            <div className="flex items-center gap-2">
                                {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                                <b className="text-xs text-slate-800 dark:text-slate-100">{item.label}</b>
                            </div>
                            <p className="mt-2 truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">{item.detail}</p>
                        </div>
                    ))}
                </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <section className="space-y-6 rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
                    <Field label="Resend API Key" hint={settings.hasResendApiKey ? '密钥已加密保存；留空表示继续使用原密钥，填写新值可直接替换。' : '请使用仅有 Sending access、并限制到 mail.marchcenter.top 的新密钥。'}>
                        <div className="relative">
                            <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                type={resendKeyVisible ? 'text' : 'password'}
                                autoComplete="new-password"
                                className="account-api-input pl-10 pr-12"
                                value={displayResendKey}
                                onChange={event => {
                                    setResendKeyEdited(true);
                                    setResendKeyVisible(false);
                                    update('resendApiKey', event.target.value);
                                }}
                                placeholder={hasSavedKey && !resendKeyEdited ? '' : '输入新的 Resend API Key'}
                            />
                            <button
                                type="button"
                                onClick={toggleResendKey}
                                disabled={revealingResendKey}
                                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-indigo-600"
                                aria-label={resendKeyVisible ? '隐藏 Resend API Key' : '显示 Resend API Key'}
                                title={resendKeyVisible ? '隐藏密钥' : '显示密钥'}
                            >
                                {revealingResendKey ? <Loader2 className="h-4 w-4 animate-spin" /> : resendKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </Field>

                    <div className="border-t border-slate-100 pt-6 dark:border-slate-800">
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white"><AtSign className="h-4 w-4 text-indigo-500" />发件身份</h3>
                        <p className="mt-1 text-[10px] leading-5 text-slate-400">
                            发件邮箱必须使用已在 Resend 验证的 mail.marchcenter.top 域名。
                        </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="发件邮箱" hint="必须填写完整邮箱，例如 noreply@mail.marchcenter.top；不能只填写 mail.marchcenter.top。">
                            <input type="email" className="account-api-input" value={settings.fromEmail} onChange={event => update('fromEmail', event.target.value)} placeholder="noreply@mail.marchcenter.top" />
                        </Field>
                        <Field label="发件人名称">
                            <input className="account-api-input" value={settings.fromName} onChange={event => update('fromName', event.target.value)} placeholder="MarchCenter" />
                        </Field>
                        <Field label="回复邮箱" hint="可留空；留空时邮件不设置 Reply-To">
                            <input type="email" className="account-api-input" value={settings.replyTo} onChange={event => update('replyTo', event.target.value)} placeholder="support@your-domain.com" />
                        </Field>
                    </div>

                    <div className="border-t border-slate-100 pt-6 dark:border-slate-800">
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white"><AtSign className="h-4 w-4 text-indigo-500" />验证码邮件内容</h3>
                        <p className="mt-1 text-[10px] text-slate-400">正文支持变量：&#123;&#123;code&#125;&#125;、&#123;&#123;username&#125;&#125;、&#123;&#123;minutes&#125;&#125;</p>
                    </div>
                    <Field label="邮件主题">
                        <input className="account-api-input" value={settings.verificationSubject} onChange={event => update('verificationSubject', event.target.value)} />
                    </Field>
                    <Field label="邮件标题">
                        <input className="account-api-input" value={settings.verificationHeading} onChange={event => update('verificationHeading', event.target.value)} />
                    </Field>
                    <Field label="开场说明">
                        <textarea className="account-api-input min-h-24 resize-y py-3" value={settings.verificationIntro} onChange={event => update('verificationIntro', event.target.value)} />
                    </Field>
                    <Field label="安全提示">
                        <textarea className="account-api-input min-h-24 resize-y py-3" value={settings.verificationFooter} onChange={event => update('verificationFooter', event.target.value)} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="验证码有效期">
                            <div className="relative"><Clock3 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="number" min="5" max="30" className="account-api-input pl-10 pr-14" value={settings.codeTtlMinutes} onChange={event => update('codeTtlMinutes', event.target.value)} /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">分钟</span></div>
                        </Field>
                        <Field label="重新发送间隔">
                            <div className="relative"><Clock3 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="number" min="30" max="300" className="account-api-input pl-10 pr-12" value={settings.resendSeconds} onChange={event => update('resendSeconds', event.target.value)} /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">秒</span></div>
                        </Field>
                    </div>
                </section>

                <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
                    <section className="rounded-3xl border border-slate-200 bg-white/85 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white"><Send className="h-4 w-4 text-indigo-500" />发送测试邮件</h3>
                        <p className="mt-2 text-[10px] leading-5 text-slate-400">使用当前表单中的内容测试，无需先保存。</p>
                        <input type="email" className="account-api-input mt-4" value={testRecipient} onChange={event => setTestRecipient(event.target.value)} placeholder="你的收件邮箱" />
                        <button type="button" onClick={sendTest} disabled={testing || !testRecipient} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 py-3 text-xs font-black text-indigo-600 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">
                            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{testing ? '发送中...' : '发送测试邮件'}
                        </button>
                    </section>

                    {notice && (
                        <div role="status" className={`rounded-2xl border p-4 text-xs font-bold leading-5 ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'}`}>
                            {notice.text}
                        </div>
                    )}

                    <button type="button" onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 py-4 text-xs font-black text-white shadow-lg shadow-indigo-200/50 transition hover:brightness-110 disabled:opacity-50 dark:shadow-none">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? '保存中...' : '保存邮件服务配置'}
                    </button>
                </aside>
            </div>
        </div>
    );
};

const Field = ({ label, hint, children }) => (
    <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
        {children}
        {hint && <span className="mt-1.5 block text-[9px] leading-4 text-slate-400">{hint}</span>}
    </label>
);

export default EmailServiceManager;
