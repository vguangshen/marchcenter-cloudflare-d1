import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save, Check, Settings, Cpu, Sparkles, Key, Globe, Activity, Loader2, RefreshCw } from 'lucide-react';
import { GLASS_INPUT, PRIMARY_BTN } from '../../../constants/config';

const OpenAILogo = () => (
    <Sparkles className="h-full w-full" aria-label="OpenAI" />
);

const DeepSeekLogo = () => (
    <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600"/>
    </svg>
);

const AnthropicLogo = () => (
    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
        <path d="M18.667 3.333H5.333L2 20.667h3.333l1.556-8.111h10.222l1.556 8.111H22L18.667 3.333zM7.556 9.444L12 5.556l4.444 3.889H7.556z"/>
    </svg>
);

const GoogleLogo = () => (
    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
        <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81z"/>
    </svg>
);

const MoonshotLogo = () => (
    <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" className="text-indigo-500"/>
        <path d="M12 3C12 3 16 8 16 12C16 16 12 21 12 21" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 3C12 3 8 8 8 12C8 16 12 21 12 21" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round"/>
    </svg>
);

// 🎨 定义模型列表
const PROVIDERS = [
    {
        id: 'openai',
        name: 'OpenAI',
        icon: OpenAILogo,
        desc: '行业标准，智能最强',
        color: 'text-slate-800 dark:text-white',
        defaultApiUrl: 'https://api.openai.com/v1/chat/completions'
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        icon: DeepSeekLogo,
        desc: '性价比之王，国产之光',
        color: 'text-blue-600',
        defaultApiUrl: 'https://api.deepseek.com/chat/completions'
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        icon: AnthropicLogo,
        desc: '代码与长文本能力卓越',
        color: 'text-stone-800 dark:text-stone-200',
        defaultApiUrl: 'https://api.anthropic.com/v1/messages'
    },
    {
        id: 'google',
        name: 'Google Gemini',
        icon: GoogleLogo,
        desc: 'Google 生态原生集成',
        color: 'text-blue-500',
        defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    },
    {
        id: 'moonshot',
        name: 'Kimi (Moonshot)',
        icon: MoonshotLogo,
        desc: '超长上下文支持',
        color: 'text-indigo-500',
        defaultApiUrl: 'https://api.moonshot.cn/v1/chat/completions'
    },
    {
        id: 'custom',
        name: 'Custom / 其他',
        icon: Settings, // 使用 Lucide 的 Settings 图标
        desc: '手动配置任意兼容 OpenAI 接口的模型',
        color: 'text-indigo-600',
        defaultApiUrl: ''
    }
];

const ApiEngine = ({ aiConfig, setAiConfig, onSave, onTest, onDiscoverModels }) => {
    // 确保有一个默认选中的 provider
    const [selectedProviderId, setSelectedProviderId] = useState(aiConfig?.provider || 'openai');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [discovering, setDiscovering] = useState(false);
    const [discoveredModels, setDiscoveredModels] = useState([]);
    const [discoveryError, setDiscoveryError] = useState('');
    const [discoverySignature, setDiscoverySignature] = useState('');
    const discoveryRequestRef = useRef(0);

    const activeProvider = PROVIDERS.find(p => p.id === selectedProviderId) || PROVIDERS[0];

    const handleProviderChange = (providerId) => {
        discoveryRequestRef.current += 1;
        setDiscovering(false);
        setDiscoveredModels([]);
        setDiscoveryError('');
        setDiscoverySignature('');
        setSelectedProviderId(providerId);
        // 切换时，如果 Base URL 是空的或者还是旧的默认值，则自动填充新厂商的默认值
        const newProvider = PROVIDERS.find(p => p.id === providerId);
        const currentApiUrl = aiConfig.apiUrl;

        // 简单的智能填充逻辑：如果当前 URL 是其他厂商的默认 URL，则替换为新厂商的
        const isDefaultUrlOfOthers = PROVIDERS.some(p => p.defaultApiUrl === currentApiUrl);

        let newApiUrl = currentApiUrl;
        if (!currentApiUrl || isDefaultUrlOfOthers) {
            newApiUrl = newProvider.defaultApiUrl;
        }

        setAiConfig({
            ...aiConfig,
            provider: providerId,
            apiUrl: newApiUrl
        });
    };

    const updateConfig = (key, value) => {
        if (key === 'apiKey' || key === 'apiUrl') {
            discoveryRequestRef.current += 1;
            setDiscovering(false);
            setDiscoveredModels([]);
            setDiscoveryError('');
            setDiscoverySignature('');
        }
        setAiConfig({ ...aiConfig, [key]: value });
        setFeedback(null);
    };

    const discoverModels = useCallback(async ({ automatic = false } = {}) => {
        const apiKey = String(aiConfig.apiKey || '').trim();
        const apiUrl = String(aiConfig.apiUrl || '').trim();
        if (!apiKey || !apiUrl || discovering) return;
        const signature = `${aiConfig.provider || selectedProviderId}\n${apiKey}\n${apiUrl}`;
        const requestId = discoveryRequestRef.current + 1;
        discoveryRequestRef.current = requestId;
        setDiscovering(true);
        setDiscoveryError('');
        if (!automatic) setFeedback({ type: 'progress', message: '正在读取上游可用模型…' });
        let result;
        try {
            result = await onDiscoverModels({ ...aiConfig, apiKey, apiUrl });
        } catch (error) {
            result = { success: false, error: error?.message || '上游模型识别失败' };
        }
        if (discoveryRequestRef.current !== requestId) return;
        setDiscovering(false);
        setDiscoverySignature(signature);
        if (!result?.success) {
            setDiscoveryError(result?.error || '上游模型识别失败，可继续手动填写');
            if (!automatic) setFeedback({ type: 'error', message: result?.error || '上游模型识别失败' });
            return;
        }
        const models = Array.isArray(result.models) ? result.models : [];
        setDiscoveredModels(models);
        const selected = models.find(model => model.id === aiConfig.modelName) || models[0];
        if (selected) {
            setAiConfig(previous => ({
                ...previous,
                modelName: models.some(model => model.id === previous.modelName)
                    ? previous.modelName
                    : selected.id,
                ...(Number(selected.maxOutputTokens) > 0
                    ? { maxTokens: Number(selected.maxOutputTokens) }
                    : {})
            }));
        }
        setFeedback({
            type: 'success',
            message: `已识别 ${models.length} 个可用模型${selected?.maxOutputTokens ? '，并同步最大输出长度' : '；上游未提供长度信息，保留当前 Max Tokens'}`
        });
    }, [aiConfig, discovering, onDiscoverModels, selectedProviderId, setAiConfig]);

    useEffect(() => {
        const apiKey = String(aiConfig.apiKey || '').trim();
        const apiUrl = String(aiConfig.apiUrl || '').trim();
        const signature = `${aiConfig.provider || selectedProviderId}\n${apiKey}\n${apiUrl}`;
        if (!apiKey || !apiUrl || signature === discoverySignature) return undefined;
        const timer = window.setTimeout(() => discoverModels({ automatic: true }), 900);
        return () => window.clearTimeout(timer);
    }, [aiConfig.apiKey, aiConfig.apiUrl, aiConfig.provider, discoverModels, discoverySignature, selectedProviderId]);

    const selectedDiscoveredModel = useMemo(() => (
        discoveredModels.find(model => model.id === aiConfig.modelName) || null
    ), [aiConfig.modelName, discoveredModels]);

    const handleModelChange = (modelName) => {
        const selected = discoveredModels.find(model => model.id === modelName);
        setAiConfig(previous => ({
            ...previous,
            modelName,
            ...(Number(selected?.maxOutputTokens) > 0
                ? { maxTokens: Number(selected.maxOutputTokens) }
                : {})
        }));
        setFeedback(null);
    };

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        setFeedback({ type: 'progress', message: '正在保存到数据库…' });
        const result = await onSave(aiConfig);
        setSaving(false);
        setFeedback(result?.success
            ? { type: 'success', message: '配置已保存，前端攻略功能已同步启用。' }
            : { type: 'error', message: result?.error || '保存失败' });
    };

    const handleTest = async () => {
        if (testing) return;
        setTesting(true);
        setFeedback({ type: 'progress', message: '正在请求当前模型验证连接…' });
        const result = await onTest(aiConfig);
        setTesting(false);
        setFeedback(result?.success
            ? { type: 'success', message: `连接正常 · ${result.latencyMs} ms · ${result.modelName}` }
            : { type: 'error', message: result?.error || '连接测试失败' });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Sparkles className="w-6 h-6 text-indigo-500"/> AI 引擎中枢 <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-bold">PRO</span>
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">配置 LLM 核心参数，支持一键接入主流模型厂商。</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleTest}
                        disabled={testing || saving}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                        {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Activity className="w-4 h-4 mr-2"/>}
                        {testing ? '检测中…' : '测试连接'}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || testing}
                        className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-wait ${PRIMARY_BTN}`}
                    >
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
                        {saving ? '保存中…' : '保存配置'}
                    </button>
                </div>
            </div>

            {feedback && (
                <div className={`rounded-xl border px-4 py-3 text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-200 ${
                    feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                    feedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-600' :
                    'border-indigo-200 bg-indigo-50 text-indigo-600'
                }`}>
                    {feedback.message}
                </div>
            )}

            {/* 快速接入卡片网格 */}
            <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">快速接入 (Quick Select)</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {PROVIDERS.map((provider) => {
                        const isActive = selectedProviderId === provider.id;
                        const Icon = provider.icon; // 获取组件

                        return (
                            <button
                                key={provider.id}
                                onClick={() => handleProviderChange(provider.id)}
                                className={`
                                    relative group p-4 rounded-2xl border-2 text-left transition-all duration-300
                                    ${isActive
                                        ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20 shadow-md ring-2 ring-indigo-500/20'
                                        : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-indigo-200 dark:hover:border-slate-600 hover:shadow-sm'}
                                `}
                            >
                                <div className="flex items-center gap-3 mb-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 dark:bg-slate-700 ${provider.color}`}>
                                        <div className="w-6 h-6 text-current">
                                            <Icon />
                                        </div>
                                    </div>
                                    <div className="font-bold text-slate-700 dark:text-slate-200">{provider.name}</div>
                                </div>
                                <div className="text-[10px] text-slate-400 font-medium leading-relaxed">
                                    {provider.desc}
                                </div>
                                {isActive && (
                                    <div className="absolute top-3 right-3 text-indigo-500">
                                        <Check className="w-4 h-4"/>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 详细配置区域 */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 md:p-8 space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
                        <Settings className="h-4 w-4"/>
                        {activeProvider.name} 参数配置
                    </h3>
                    <button
                        type="button"
                        onClick={() => discoverModels()}
                        disabled={discovering || !String(aiConfig.apiKey || '').trim() || !String(aiConfig.apiUrl || '').trim()}
                        className="inline-flex h-9 w-fit items-center gap-1.5 self-end rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-[10px] font-black text-indigo-600 transition hover:border-indigo-400 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
                    >
                        {discovering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {discovering ? '识别中' : '识别模型'}
                    </button>
                </div>

                <div className="grid grid-cols-1 items-start gap-x-6 gap-y-6 md:grid-cols-2">
                    <div className="grid gap-2">
                        <label className="flex h-5 items-center text-xs font-bold uppercase text-slate-500 dark:text-slate-400">API Key (令牌)</label>
                        <div className="relative group">
                            <input
                                type="text"
                                value={aiConfig.apiKey || ''}
                                onChange={(e) => updateConfig('apiKey', e.target.value)}
                                placeholder={`请输入 ${activeProvider.name} API Key`}
                                autoComplete="off"
                                spellCheck="false"
                                className={`h-12 w-full rounded-xl py-3 pl-10 pr-4 text-sm font-mono outline-none transition-all ${GLASS_INPUT} dark:bg-slate-900 dark:border-slate-600 dark:text-white focus:border-indigo-500`}
                            />
                            <div className="absolute left-3 top-3 text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                                <Key className="w-4 h-4"/>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400">四项参数均保存在数据库中；API Key 加密存储，仅向超级管理员完整回显。</p>
                    </div>

                    <div className="grid gap-2">
                        <label className="flex h-5 items-center text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Base URL (接口地址)</label>
                        <div className="relative group">
                            <input
                                type="text"
                                value={aiConfig.apiUrl || ''}
                                onChange={(e) => updateConfig('apiUrl', e.target.value)}
                                placeholder="例如: https://api.openai.com/v1"
                                className={`h-12 w-full rounded-xl py-3 pl-10 pr-4 text-sm font-mono outline-none transition-all ${GLASS_INPUT} dark:bg-slate-900 dark:border-slate-600 dark:text-white focus:border-indigo-500`}
                            />
                            <div className="absolute left-3 top-3 text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                                <Globe className="w-4 h-4"/>
                            </div>
                        </div>
                        {discoveryError && <p className="text-[10px] font-bold text-amber-600">{discoveryError}</p>}
                    </div>

                    <div className="grid gap-2">
                        <label className="flex h-5 items-center text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Model Name (模型名称)</label>
                        <div className="relative group">
                            {discoveredModels.length > 0 ? (
                                <select
                                    value={aiConfig.modelName || ''}
                                    onChange={(e) => handleModelChange(e.target.value)}
                                    className={`h-12 w-full appearance-none rounded-xl py-3 pl-10 pr-10 text-sm font-mono outline-none transition-all ${GLASS_INPUT} dark:bg-slate-900 dark:border-slate-600 dark:text-white focus:border-indigo-500`}
                                >
                                    {!discoveredModels.some(model => model.id === aiConfig.modelName) && aiConfig.modelName && (
                                        <option value={aiConfig.modelName}>{aiConfig.modelName}（当前配置）</option>
                                    )}
                                    {discoveredModels.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {model.label === model.id ? model.id : `${model.label} · ${model.id}`}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="text"
                                    value={aiConfig.modelName || ''}
                                    onChange={(e) => updateConfig('modelName', e.target.value)}
                                    placeholder="识别后可选择，也可手动填写模型名称"
                                    className={`h-12 w-full rounded-xl py-3 pl-10 pr-4 text-sm font-mono outline-none transition-all ${GLASS_INPUT} dark:bg-slate-900 dark:border-slate-600 dark:text-white focus:border-indigo-500`}
                                />
                            )}
                            <div className="absolute left-3 top-3 text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                                <Cpu className="w-4 h-4"/>
                            </div>
                        </div>
                        {discoveredModels.length > 0 && (
                            <p className="text-[10px] text-slate-400">来自上游模型列表，共 {discoveredModels.length} 项。</p>
                        )}
                    </div>

                    <div className="grid gap-2">
                        <label className="flex h-5 items-center text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Max Tokens (最大长度)</label>
                        <input
                            type="number"
                            value={aiConfig.maxTokens || 2000}
                            onChange={(e) => updateConfig('maxTokens', parseInt(e.target.value))}
                            className={`h-12 w-full rounded-xl px-4 py-3 text-sm font-mono outline-none transition-all ${GLASS_INPUT} dark:bg-slate-900 dark:border-slate-600 dark:text-white focus:border-indigo-500`}
                        />
                        <p className="text-[10px] text-slate-400">
                            {selectedDiscoveredModel?.maxOutputTokens
                                ? `上游提供的最大输出长度：${selectedDiscoveredModel.maxOutputTokens.toLocaleString()}`
                                : selectedDiscoveredModel?.contextWindow
                                    ? `上游仅提供上下文窗口 ${selectedDiscoveredModel.contextWindow.toLocaleString()}，最大输出长度需手动设置。`
                                    : '仅在上游明确返回最大输出长度时自动填充；否则保留手动值。'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ApiEngine;
