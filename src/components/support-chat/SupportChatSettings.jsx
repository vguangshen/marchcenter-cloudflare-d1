import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../utils/api';

const MAX_TEMPLATES = 20;
const MAX_QUESTION_LENGTH = 120;
const MAX_ANSWER_LENGTH = 1500;
const MAX_KEYWORD_LENGTH = 40;
const MAX_KEYWORDS = 8;

function toDraft(options) {
    return {
        aiEnabled: options.aiEnabled,
        aiConfigured: options.aiConfigured,
        templates: options.templates.map(template => ({
            id: template.id,
            question: template.question,
            answer: template.answer,
            keywords: template.keywords.join('，')
        }))
    };
}

function TemplateFields({ template, onChange, onRemove }) {
    return (
        <fieldset className="min-w-0 space-y-2.5 rounded-xl border border-slate-300/50 bg-white/40 p-3 dark:border-slate-600/50 dark:bg-slate-800/30">
            <legend className="sr-only">常见问题模板</legend>
            <div className="flex items-end gap-2">
                <label className="min-w-0 flex-1">
                    <span className="mc-field-label">问题</span>
                    <input value={template.question} onChange={event => onChange('question', event.target.value)}
                        data-faq-question={template.id} className="mc-input !py-2 text-sm" placeholder="例如，如何找回密码？"
                        maxLength={MAX_QUESTION_LENGTH} required />
                </label>
                <button type="button" onClick={onRemove} className="mc-button mc-button--ghost mc-button--compact !h-9 shrink-0"
                    aria-label={template.question ? '删除常见问题：' + template.question : '删除空白常见问题'}>
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>
            <label className="block">
                <span className="mc-field-label">模板回复</span>
                <textarea value={template.answer} onChange={event => onChange('answer', event.target.value)}
                    rows={3} className="mc-input min-h-16 resize-y !py-2 text-sm" maxLength={MAX_ANSWER_LENGTH} required />
            </label>
            <label className="block">
                <span className="mc-field-label">匹配关键词 <span className="font-normal text-slate-500 dark:text-slate-400">（选填）</span></span>
                <input value={template.keywords} onChange={event => onChange('keywords', event.target.value)}
                    className="mc-input !py-2 text-sm" placeholder="用逗号分隔，例如：忘记密码，密码重置" />
            </label>
        </fieldset>
    );
}

export default function SupportChatSettings({ active, onSaved }) {
    const [draft, setDraft] = useState(null);
    const [retry, setRetry] = useState(0);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const editorRef = useRef(null);
    const loadRef = useRef(null);
    const saveRef = useRef(null);
    const dirtyRef = useRef(false);

    useEffect(() => {
        if (!active) return undefined;
        const controller = new AbortController();
        loadRef.current = controller;
        api.get('/support-chat/options', { signal: controller.signal, retry: 0, fallback: '读取客服设置失败' })
            .then(options => {
                if (controller.signal.aborted) return;
                setDraft(current => current && dirtyRef.current ? { ...current, aiConfigured: options.aiConfigured } : toDraft(options));
                setError('');
            })
            .catch(failure => { if (!controller.signal.aborted) setError(failure.message || '读取客服设置失败'); });
        return () => controller.abort();
    }, [active, retry]);
    useEffect(() => () => saveRef.current?.abort(), []);

    const edit = update => {
        dirtyRef.current = true;
        setDraft(update);
        setDirty(true);
        setSaved(false);
        setError('');
    };

    const addTemplate = () => {
        const id = crypto.randomUUID();
        edit(current => ({ ...current, templates: [...current.templates, { id, question: '', answer: '', keywords: '' }] }));
        window.requestAnimationFrame(() => {
            const editor = editorRef.current;
            const field = editor?.querySelector(`[data-faq-question="${id}"]`);
            if (!field) return;
            field.focus({ preventScroll: true });
            editor.scrollTop += field.getBoundingClientRect().top - editor.getBoundingClientRect().top - 24;
        });
    };

    const save = async event => {
        event.preventDefault();
        if (!draft || !dirty || saving) return;
        const templates = draft.templates.map(template => ({
            id: template.id,
            question: template.question.trim(),
            answer: template.answer.trim(),
            keywords: [...new Set(template.keywords.split(/[,，]/).map(word => word.trim()).filter(Boolean))]
        }));
        if (templates.some(template => !template.question || !template.answer)) {
            setError('请填写每个常见问题及其模板回复。');
            return;
        }
        if (templates.some(template => template.keywords.length > MAX_KEYWORDS || template.keywords.some(word => word.length > MAX_KEYWORD_LENGTH))) {
            setError('每个问题最多 8 个关键词，每个关键词最多 40 个字符。');
            return;
        }
        const controller = new AbortController();
        loadRef.current?.abort();
        saveRef.current = controller;
        const { signal } = controller;
        setSaving(true);
        setError('');
        try {
            const result = await api.put('/support-chat/options', { aiEnabled: draft.aiEnabled, templates }, {
                signal, retry: 0, fallback: '保存客服设置失败'
            });
            if (signal.aborted) return;
            dirtyRef.current = false;
            setDraft(toDraft(result));
            setDirty(false);
            setSaved(true);
            onSaved?.(result);
        } catch (failure) {
            if (!signal.aborted) setError(failure.message || '保存客服设置失败');
        } finally {
            if (!signal.aborted) setSaving(false);
        }
    };

    if (!draft) {
        return error ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-5 text-sm text-red-700 dark:text-red-300" role="alert">
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }} className="mc-button mc-button--ghost mc-button--compact">重试</button>
            </div>
        ) : <div className="flex justify-center p-6" role="status" aria-label="正在读取客服设置"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>;
    }

    return (
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" aria-label="自动回复设置">
            <div ref={editorRef} className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-300/50 bg-white/40 p-3 dark:border-slate-600/50 dark:bg-slate-800/30">
                    <input type="checkbox" checked={draft.aiEnabled}
                        disabled={saving || (!draft.aiConfigured && !draft.aiEnabled)} onChange={event => {
                        const aiEnabled = event.target.checked;
                        edit(current => ({ ...current, aiEnabled }));
                    }} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--system-accent)]" />
                    <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">启用 mcgo AI 自动回复</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {draft.aiConfigured ? '模板未匹配时将对话文字发送到已配置的 AI 服务。用户可随时转人工。' : '请先在系统工具中配置 AI 服务。'}
                        </span>
                    </span>
                </label>
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">常见问题</h3>
                    <button type="button" onClick={addTemplate} disabled={saving || draft.templates.length >= MAX_TEMPLATES}
                        title={draft.templates.length >= MAX_TEMPLATES ? '最多配置 20 个常见问题' : undefined} className="mc-button mc-button--secondary mc-button--compact">
                        <Plus className="h-4 w-4" />添加常见问题
                    </button>
                </div>
                <fieldset disabled={saving} className="min-w-0 space-y-3">
                    {draft.templates.map(template => (
                        <TemplateFields key={template.id} template={template}
                            onChange={(field, value) => edit(current => ({
                                ...current,
                                templates: current.templates.map(item => item.id === template.id ? { ...item, [field]: value } : item)
                            }))}
                            onRemove={() => edit(current => ({
                                ...current, templates: current.templates.filter(item => item.id !== template.id)
                            }))} />
                    ))}
                </fieldset>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-300/35 px-3 py-2.5 dark:border-slate-600/40">
                {error ? <p role="alert" className="min-w-0 break-words text-xs text-red-700 dark:text-red-300">{error}</p>
                    : <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{saved ? '设置已保存' : ''}</span>}
                <button type="submit" disabled={!dirty || saving} className="mc-button mc-button--primary mc-button--compact shrink-0">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    保存设置
                </button>
            </div>
        </form>
    );
}
