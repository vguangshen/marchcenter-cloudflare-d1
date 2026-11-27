import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Loader2, Search, Send, Trophy } from 'lucide-react';
import { api } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { DraftAttachments } from './TicketAttachments';
import {
    MAX_BODY_LENGTH, TICKET_CATEGORIES, UPLOAD_TIMEOUT_MS,
    cardKind, mergeDraftFiles, releaseDraftFiles
} from './ticketShared';

const NO_CARD = '';

function CardPicker({ cards, value, onChange, disabled }) {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return cards;
        return cards.filter(card => `${card.title} ${card.category || ''}`.toLowerCase().includes(needle));
    }, [cards, query]);
    const option = (id, title, meta, Icon) => {
        const selected = value === id;
        return (
            <li key={id || 'none'}>
                <button type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={() => onChange(id)} className={`ticket-card-option ${selected ? 'is-selected' : ''}`}>
                    <span className="ticket-card-option__icon">{Icon ? <Icon className="h-3.5 w-3.5" /> : '—'}</span>
                    <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-xs font-black">{title}</span>
                        {meta && <span className="block truncate text-[10px] font-medium opacity-70">{meta}</span>}
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
            </li>
        );
    };
    return (
        <div className="ticket-card-picker">
            {cards.length > 6 && (
                <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索我的卡片…" aria-label="搜索卡片" className="mc-input !py-2 !pl-8 !text-xs" />
                </div>
            )}
            <ul role="radiogroup" aria-label="关联的卡片" className="ticket-card-list custom-scrollbar">
                {!query && option(NO_CARD, '不涉及具体卡片', '账号、站点等通用问题', null)}
                {filtered.map(card => option(String(card.id), card.title || `卡片 #${card.id}`, [cardKind(card), card.category].filter(Boolean).join(' · '), card.ssoMethod === 'paasV2' ? Bot : Trophy))}
                {query && !filtered.length && <li className="px-3 py-4 text-center text-xs font-medium text-slate-400">没有匹配的卡片</li>}
            </ul>
        </div>
    );
}

/** The new-ticket form. Calls onCreated(ticketId) after a successful submit. */
export default function TicketComposer({ cards, onCreated, onBusyChange }) {
    const [cardId, setCardId] = useState(NO_CARD);
    const [category, setCategory] = useState('');
    const [subject, setSubject] = useState('');
    const [description, setDescription] = useState('');
    const [files, setFiles] = useState([]);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;
    useEffect(() => () => releaseDraftFiles(filesRef.current), []);

    const chooseCategory = id => {
        const previous = TICKET_CATEGORIES.find(item => item.id === category);
        const next = TICKET_CATEGORIES.find(item => item.id === id);
        setCategory(id);
        setError('');
        // Replace the description only while it is still an untouched template.
        if (!description.trim() || description === previous?.template) setDescription(next?.template || '');
    };
    const addFiles = incoming => {
        const { files: merged, problem } = mergeDraftFiles(filesRef.current, incoming);
        setFiles(merged);
        if (problem) notify(problem, 'warning');
    };
    const removeFile = key => setFiles(current => {
        const removed = current.find(item => item.key === key);
        if (removed) releaseDraftFiles([removed]);
        return current.filter(item => item.key !== key);
    });
    const paste = event => {
        const pasted = [...(event.clipboardData?.files || [])];
        if (!pasted.length || submitting) return;
        event.preventDefault();
        addFiles(pasted);
    };

    const selectedCard = cards.find(card => String(card.id) === cardId);
    const categoryLabel = TICKET_CATEGORIES.find(item => item.id === category)?.label;
    const subjectPlaceholder = categoryLabel ? `${selectedCard ? `${selectedCard.title} · ` : ''}${categoryLabel}` : '一句话概括遇到的问题';

    const submit = async event => {
        event.preventDefault();
        if (submitting) return;
        const finalSubject = (subject.trim() || (categoryLabel ? subjectPlaceholder : '')).slice(0, 80);
        if (!category) { setError('请选择问题类型'); return; }
        if (finalSubject.length < 2) { setError('请填写标题'); return; }
        if (description.trim().length < 5) { setError('请把问题描述得详细一些（至少 5 个字）'); return; }
        setSubmitting(true);
        onBusyChange?.(true);
        setError('');
        const form = new FormData();
        if (cardId) form.append('competitionId', cardId);
        form.append('category', category);
        form.append('subject', finalSubject);
        form.append('description', description.trim());
        for (const item of files) form.append('files', item.file, item.file.name);
        try {
            const result = await api.post('/tickets', form, { fallback: '提交工单失败', timeoutMs: UPLOAD_TIMEOUT_MS, retry: 0 });
            notify(result?.message || '工单已提交', 'success');
            releaseDraftFiles(filesRef.current);
            filesRef.current = [];
            onCreated?.(result?.ticket?.id);
        } catch (requestError) {
            setError(requestError.message || '提交工单失败，请稍后重试');
        } finally {
            setSubmitting(false);
            onBusyChange?.(false);
        }
    };

    return (
        <form onSubmit={submit} onPaste={paste} className="ticket-composer flex h-full min-h-0 flex-col" aria-labelledby="ticket-composer-title">
            <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <div>
                    <h3 id="ticket-composer-title" className="text-base font-black text-slate-900 dark:text-white">提交新工单</h3>
                    <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">描述越具体、截图越清晰，管理员处理得越快。</p>
                </div>
                <section>
                    <h4 className="ticket-step-label"><span>1</span>遇到问题的卡片</h4>
                    <CardPicker cards={cards} value={cardId} onChange={setCardId} disabled={submitting} />
                </section>
                <section>
                    <h4 className="ticket-step-label"><span>2</span>问题类型</h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="问题类型">
                        {TICKET_CATEGORIES.map(({ id, label, icon: Icon }) => (
                            <button key={id} type="button" role="radio" aria-checked={category === id} disabled={submitting} onClick={() => chooseCategory(id)} className={`ticket-category ${category === id ? 'is-selected' : ''}`}>
                                <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 text-left leading-snug">{label}</span>
                            </button>
                        ))}
                    </div>
                </section>
                <section className="space-y-3">
                    <h4 className="ticket-step-label"><span>3</span>问题描述</h4>
                    <label className="block">
                        <span className="mc-field-label">标题</span>
                        <input value={subject} onChange={event => { setSubject(event.target.value); setError(''); }} maxLength={80} disabled={submitting} className="mc-input" placeholder={subjectPlaceholder} />
                    </label>
                    <label className="block">
                        <span className="mc-field-label flex items-center justify-between"><span>详细描述</span><span className="font-medium text-slate-400">{description.length}/{MAX_BODY_LENGTH}</span></span>
                        <textarea value={description} onChange={event => { setDescription(event.target.value); setError(''); }} maxLength={MAX_BODY_LENGTH} rows={6} disabled={submitting} className="mc-input min-h-[8.5rem] resize-y leading-6" placeholder="发生了什么？在哪一步出现？有没有错误提示？" />
                    </label>
                </section>
                <section>
                    <h4 className="ticket-step-label"><span>4</span>附件与截图 <em className="font-medium not-italic text-slate-400">（可选）</em></h4>
                    <DraftAttachments files={files} onAdd={addFiles} onRemove={removeFile} disabled={submitting} />
                </section>
            </div>
            <div className="ticket-pane-footer">
                {error ? <p role="alert" className="mr-auto min-w-0 text-xs font-bold text-red-600 dark:text-red-400">{error}</p> : <p className="mr-auto hidden text-[11px] font-medium text-slate-400 sm:block">提交后可在「我的工单」中查看进度</p>}
                <button type="submit" disabled={submitting} className="mc-button mc-button--primary min-w-28">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {submitting ? (files.length ? '正在上传…' : '正在提交…') : '提交工单'}
                </button>
            </div>
        </form>
    );
}
