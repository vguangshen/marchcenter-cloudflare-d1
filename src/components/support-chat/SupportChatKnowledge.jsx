import React, { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FlaskConical, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import { api } from '../../utils/api';
import LoadErrorNotice from '../feedback/LoadErrorNotice';

const KNOWLEDGE_URL = '/support-chat/knowledge';
const SURFACE = 'settings-surface min-w-0 rounded-2xl p-3 sm:p-4';
const STATUSES = [
    { value: 'all', label: '全部状态' },
    { value: 'enabled', label: '已启用' },
    { value: 'disabled', label: '已停用' }
];
const FIELD_LIMIT = { category: 32, question: 120, answer: 1500, followUp: 1500 };

function makeDraft(entry) {
    return {
        id: entry?.id,
        revision: entry?.revision,
        category: entry?.category || '',
        question: entry?.question || '',
        answer: entry?.answer || '',
        examples: entry?.examples.join('\n') || '',
        keywords: entry?.keywords.join('\n') || '',
        followUp: entry?.followUp || '',
        enabled: entry?.enabled ?? true
    };
}

function splitLines(value) {
    return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

function KnowledgeEditor({ draft, categories, pending, error, onEdit, onSave, onClose }) {
    const categoryChoices = useId();
    const heading = useRef(null);

    useEffect(() => {
        heading.current?.focus();
    }, []);

    return (
        <form onSubmit={onSave} className={`${SURFACE} space-y-4`} aria-label={draft.id ? '编辑语料' : '新增语料'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 ref={heading} tabIndex={-1} className="text-base font-bold text-slate-900 outline-none dark:text-white">{draft.id ? '编辑语料' : '新增语料'}</h3>
                <button type="button" disabled={pending} onClick={onClose} className="mc-button mc-button--ghost mc-button--compact"><ChevronLeft className="h-4 w-4" aria-hidden="true" />返回列表</button>
            </div>
            <fieldset disabled={pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="min-w-0">
                    <span className="mc-field-label">分类</span>
                    <input className="mc-input mc-input--compact" list={categoryChoices} value={draft.category} onChange={event => onEdit('category', event.target.value)} maxLength={FIELD_LIMIT.category} required />
                    <datalist id={categoryChoices}>{categories.map(category => <option key={category} value={category} />)}</datalist>
                </label>
                <label className="min-w-0">
                    <span className="mc-field-label">标准问题</span>
                    <input className="mc-input mc-input--compact" placeholder="例如，如何找回账号密码？" value={draft.question} onChange={event => onEdit('question', event.target.value)} maxLength={FIELD_LIMIT.question} required />
                </label>
                <label className="min-w-0 sm:col-span-2">
                    <span className="mc-field-label">标准答案</span>
                    <textarea className="mc-input resize-y" rows={4} value={draft.answer} onChange={event => onEdit('answer', event.target.value)} maxLength={FIELD_LIMIT.answer} required />
                </label>
                <label className="min-w-0">
                    <span className="mc-field-label">相似问法</span>
                    <textarea className="mc-input resize-y" rows={4} value={draft.examples} onChange={event => onEdit('examples', event.target.value)} placeholder={'一行一个问法\n密码忘了怎么办\n怎么重新设置密码'} />
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">每条意图最多 20 个问法，每行最多 160 个字符。</span>
                </label>
                <label className="min-w-0">
                    <span className="mc-field-label">关键词</span>
                    <textarea className="mc-input resize-y" rows={4} value={draft.keywords} onChange={event => onEdit('keywords', event.target.value)} placeholder={'一行一个短语\n找回密码\n重置登录密码'} />
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">最多 8 个关键词，每行最多 40 个字符。</span>
                </label>
                <label className="min-w-0 sm:col-span-2">
                    <span className="mc-field-label">追问补充答复</span>
                    <textarea className="mc-input resize-y" rows={3} value={draft.followUp} onChange={event => onEdit('followUp', event.target.value)} maxLength={FIELD_LIMIT.followUp} placeholder="可选。用于用户继续问「具体怎么操作」时补充步骤。" />
                </label>
                <label className="inline-flex min-h-8 items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--system-accent)]" checked={draft.enabled} onChange={event => onEdit('enabled', event.target.checked)} />启用此语料
                </label>
            </fieldset>
            <LoadErrorNotice message={error} compact />
            <div className="flex justify-end">
                <button type="submit" disabled={pending} className="mc-button mc-button--primary mc-button--compact">
                    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}保存语料
                </button>
            </div>
        </form>
    );
}

function IntentTest() {
    const [text, setText] = useState('');
    const [lastIntent, setLastIntent] = useState(null);
    const [withContext, setWithContext] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [testing, setTesting] = useState(false);
    const request = useRef(null);

    useEffect(() => () => request.current?.abort(), []);

    const testIntent = async event => {
        event.preventDefault();
        const sentence = text.trim();
        if (!sentence || testing) return;
        const controller = new AbortController();
        request.current = controller;
        const payload = { text: sentence };
        if (withContext && lastIntent) payload.contextIntentId = lastIntent.id;
        setError('');
        setResult(null);
        setTesting(true);
        try {
            const response = await api.post(`${KNOWLEDGE_URL}/test`, payload, { signal: controller.signal, retry: 0, fallback: '意图测试失败' });
            if (controller.signal.aborted) return;
            setResult(response);
            if (response.kind === 'match') setLastIntent(response.entry);
        } catch (failure) {
            if (!controller.signal.aborted) setError(failure.message || '意图测试失败');
        } finally {
            if (!controller.signal.aborted) setTesting(false);
        }
    };

    const score = Number.isFinite(result?.confidence) ? Math.round(result.confidence * 100) : null;
    return (
        <details className={SURFACE}>
            <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-white"><span className="ml-1 inline-flex items-center gap-2"><FlaskConical className="h-4 w-4" aria-hidden="true" />意图测试</span></summary>
            <form onSubmit={testIntent} className="mt-3 space-y-3" aria-label="意图测试">
                <label className="block">
                    <span className="mc-field-label">用户消息</span>
                    <textarea className="mc-input resize-y" rows={2} value={text} onChange={event => setText(event.target.value)} maxLength={2000} placeholder="输入一句用户可能会问的话" required />
                </label>
                {lastIntent && <label className="flex min-w-0 items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <input type="checkbox" checked={withContext} onChange={event => setWithContext(event.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--system-accent)]" />
                    <span className="min-w-0 break-words">带入上一条意图「{lastIntent.question}」</span>
                </label>}
                <button type="submit" disabled={testing || !text.trim()} className="mc-button mc-button--secondary mc-button--compact">
                    {testing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}测试识别
                </button>
            </form>
            <div className="mt-3" aria-live="polite">
                <LoadErrorNotice message={error} compact />
                {result?.kind === 'match' && <div className="space-y-1 rounded-xl bg-emerald-500/10 p-3 text-sm text-slate-700 dark:text-slate-100">
                    <p className="font-bold text-emerald-800 dark:text-emerald-300">已识别{score === null ? '' : ` · 匹配分数 ${score}%`}</p>
                    <p className="break-words font-semibold">{result.entry.question}</p>
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{result.mode === 'followup' ? result.entry.followUp : result.entry.answer}</p>
                </div>}
                {result?.kind === 'clarify' && <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-slate-700 dark:text-slate-100">
                    <p className="font-bold text-amber-800 dark:text-amber-300">需要追问确认</p>
                    <ul className="ml-5 mt-1 list-disc space-y-1">{result.entries.map(entry => <li key={entry.id} className="[overflow-wrap:anywhere]">{entry.question}</li>)}</ul>
                </div>}
                {result?.kind === 'none' && <p className="rounded-xl bg-slate-500/10 p-3 text-sm text-slate-700 dark:text-slate-200">未识别到足够明确的意图。</p>}
            </div>
        </details>
    );
}

function KnowledgeRow({ entry, pending, onEdit, onToggle }) {
    return (
        <li className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-slate-300/40 px-3 py-3 last:border-b-0 dark:border-slate-600/40 sm:px-4">
            <div className="min-w-0 basis-full space-y-1 sm:basis-0 sm:flex-1">
                <h4 className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{entry.question}</h4>
                <p className="line-clamp-2 text-xs text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">{entry.answer}</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>{entry.category}</span><span>{entry.examples.length} 个相似问法</span><span>{entry.builtin ? '内置' : '自定义'}</span>
                    <span className={entry.enabled ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold'}>{entry.enabled ? '已启用' : '已停用'}</span>
                </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
                <button type="button" onClick={() => onEdit(entry)} disabled={pending} aria-label={`编辑「${entry.question}」`} className="mc-button mc-button--secondary mc-button--compact"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />编辑</button>
                <button type="button" onClick={() => onToggle(entry)} disabled={pending} aria-label={`${entry.enabled ? '停用' : '启用'}「${entry.question}」`} className="mc-button mc-button--ghost mc-button--compact">{entry.enabled ? '停用' : '启用'}</button>
            </div>
        </li>
    );
}

export default function SupportChatKnowledge({ active }) {
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState({ q: '', category: '', state: 'all', page: 1 });
    const [catalog, setCatalog] = useState(null);
    const [refresh, setRefresh] = useState(0);
    const [draft, setDraft] = useState(null);
    const [pending, setPending] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [notice, setNotice] = useState('');
    const write = useRef(null);
    const searchInput = useRef(null);
    const query = new URLSearchParams(filters).toString();
    const current = catalog?.query === query ? catalog : null;
    const currentData = current?.dataQuery === query ? current.data : null;
    const categories = catalog?.data?.categories || [];
    const summary = catalog?.data?.summary;

    useEffect(() => {
        if (!active) return undefined;
        const controller = new AbortController();
        api.get(`${KNOWLEDGE_URL}?${query}`, { signal: controller.signal, retry: 0, fallback: '读取问答语料失败' })
            .then(data => {
                if (controller.signal.aborted) return;
                setCatalog({ query, dataQuery: query, data, error: '' });
                const lastPage = Math.max(1, data.totalPages);
                setFilters(currentFilters => currentFilters.page > lastPage ? { ...currentFilters, page: lastPage } : currentFilters);
            })
            .catch(failure => {
                if (!controller.signal.aborted) setCatalog(previous => ({ ...previous, query, error: failure.message || '读取问答语料失败' }));
            });
        return () => controller.abort();
    }, [active, query, refresh]);

    useEffect(() => () => write.current?.abort(), []);

    const openEditor = entry => {
        setNotice('');
        setSaveError('');
        setDraft(makeDraft(entry));
    };

    const closeEditor = () => {
        setDraft(null);
        setSaveError('');
        window.requestAnimationFrame(() => searchInput.current?.focus());
    };

    const changeFilter = (field, value) => setFilters(previous => ({ ...previous, [field]: value, page: 1 }));

    const mutate = async (send, message, onSuccess) => {
        if (pending) return;
        const controller = new AbortController();
        write.current = controller;
        setPending(true);
        setSaveError('');
        setNotice('');
        try {
            await send({ signal: controller.signal, retry: 0, fallback: '保存语料失败' });
            if (controller.signal.aborted) return;
            setNotice(message);
            onSuccess?.();
            setRefresh(value => value + 1);
        } catch (failure) {
            if (!controller.signal.aborted) setSaveError(failure.message || '保存语料失败');
        } finally {
            if (!controller.signal.aborted) setPending(false);
        }
    };

    const saveEntry = event => {
        event.preventDefault();
        const { id, revision, enabled } = draft;
        const category = draft.category.trim();
        const question = draft.question.trim();
        const answer = draft.answer.trim();
        const followUp = draft.followUp.trim();
        const examples = splitLines(draft.examples);
        const keywords = splitLines(draft.keywords);
        if (!category || !question || !answer) {
            setSaveError('请填写分类、标准问题和标准答案。');
            return;
        }
        if (examples.length > 20 || examples.some(value => value.length > 160) || keywords.length > 8 || keywords.some(value => value.length > 40)) {
            setSaveError('请检查相似问法和关键词的条数及长度。');
            return;
        }
        const payload = { category, question, answer, examples, keywords, followUp, enabled };
        if (id) return mutate(options => api.put(`${KNOWLEDGE_URL}/${encodeURIComponent(id)}`, { ...payload, revision }, options), '语料已保存', closeEditor);
        return mutate(options => api.post(KNOWLEDGE_URL, payload, options), '语料已新增', () => {
            setSearch(question);
            setFilters({ q: question, category: '', state: 'all', page: 1 });
            closeEditor();
        });
    };

    if (draft) return <KnowledgeEditor draft={draft} categories={categories} pending={pending} error={saveError} onSave={saveEntry} onClose={closeEditor}
        onEdit={(field, value) => setDraft(previous => ({ ...previous, [field]: value }))} />;

    return (
        <section aria-label="问答语料库" className="min-w-0 space-y-3">
            <header className={`${SURFACE} flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white"><BookOpen className="h-4 w-4 shrink-0 text-[rgb(var(--system-accent-rgb))]" aria-hidden="true" />问答语料库</h3>
                    {summary && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{summary.intents} 个意图 · {summary.enabled} 个已启用 · {summary.examples} 个相似问法</p>}
                </div>
                <button type="button" onClick={() => openEditor()} disabled={pending} className="mc-button mc-button--primary mc-button--compact"><Plus className="h-4 w-4" aria-hidden="true" />新增语料</button>
            </header>
            <IntentTest />
            <section className="settings-surface min-w-0 overflow-hidden rounded-2xl" aria-label="语料列表">
                <div className="space-y-2.5 border-b border-slate-300/40 p-3 dark:border-slate-600/40 sm:px-4">
                    <form role="search" aria-label="搜索问答语料" className="flex gap-1.5" onSubmit={event => { event.preventDefault(); changeFilter('q', search.trim()); }}>
                        <div className="relative min-w-0 flex-1">
                            <input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={120} aria-label="搜索问题、答案或问法" placeholder="搜索问题、答案或问法" className="mc-input mc-input--compact !pr-9" />
                            {search && <button type="button" onClick={() => { setSearch(''); changeFilter('q', ''); searchInput.current?.focus(); }} aria-label="清除语料搜索"
                                className="absolute inset-y-0 right-1 grid w-7 place-items-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                        </div>
                        <button type="submit" aria-label="搜索语料" className="mc-button mc-button--secondary mc-button--compact shrink-0"><Search className="h-4 w-4" aria-hidden="true" /></button>
                    </form>
                    <div className="grid grid-cols-2 gap-2">
                        <select aria-label="按分类筛选" className="mc-input mc-input--compact min-w-0" value={filters.category} onChange={event => changeFilter('category', event.target.value)}>
                            <option value="">全部分类</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>
                        <select aria-label="按状态筛选" className="mc-input mc-input--compact min-w-0" value={filters.state} onChange={event => changeFilter('state', event.target.value)}>
                            {STATUSES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </div>
                    <LoadErrorNotice message={current?.error} onRetry={() => setRefresh(value => value + 1)} compact />
                    <LoadErrorNotice message={saveError} onRetry={() => { setSaveError(''); setRefresh(value => value + 1); }} compact />
                    {notice && <p role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{notice}</p>}
                </div>
                {!current ? <div role="status" aria-label="正在读取语料" className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden="true" /></div>
                    : currentData?.entries.length ? <ul>{currentData.entries.map(entry => <KnowledgeRow key={entry.id} entry={entry} pending={pending} onEdit={openEditor}
                        onToggle={item => mutate(options => api.patch(`${KNOWLEDGE_URL}/${encodeURIComponent(item.id)}`, { enabled: !item.enabled, revision: item.revision }, options), item.enabled ? '语料已停用' : '语料已启用')} />)}</ul>
                        : !current.error && <p className="p-6 text-center text-sm text-slate-600 dark:text-slate-300">没有符合条件的语料。</p>}
                {currentData && <footer aria-label="语料分页" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300/40 px-3 py-2 dark:border-slate-600/40">
                    <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">共 {currentData.total} 条</span>
                    {currentData.totalPages > 1 && <div className="flex items-center gap-1.5">
                        <button type="button" disabled={currentData.page === 1} onClick={() => setFilters(previous => ({ ...previous, page: currentData.page - 1 }))} aria-label="上一页语料" className="mc-button mc-button--ghost mc-button--compact"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                        <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{currentData.page} / {currentData.totalPages}</span>
                        <button type="button" disabled={currentData.page >= currentData.totalPages} onClick={() => setFilters(previous => ({ ...previous, page: currentData.page + 1 }))} aria-label="下一页语料" className="mc-button mc-button--ghost mc-button--compact"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                    </div>}
                </footer>}
            </section>
        </section>
    );
}
