import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlignCenter, AlignLeft, AlignRight, Check, CheckCircle2, ChevronRight,
    Eye, Image as ImageIcon, LayoutDashboard, LockKeyhole, MessageSquare,
    Mail, Monitor, MousePointer2, Pencil, Quote, RotateCcw, Save, User,
    ShieldCheck, Sparkles, X
} from 'lucide-react';
import { DEFAULT_SITE_CONFIG, GLASS_INPUT, PRIMARY_BTN } from '../../../constants/config';
import BrandLogo, { BRAND_LOGO_PRESETS } from '../../branding/BrandLogo';

const VISUAL_CENTER_PRESETS = [
    { id: 'trophy', value: '🏆', label: '奖杯' },
    { id: 'medal', value: '🥇', label: '金牌' },
    { id: 'rocket', value: '🚀', label: '火箭' },
    { id: 'shield', value: '🛡️', label: '盾牌' },
    { id: 'star', value: '⭐', label: '星标' },
    { id: 'target', value: '🎯', label: '目标' }
];

const FIELD_META = {
    loginBrandName: ['品牌名称', '登录页顶部栏及登录后导航栏显示的品牌名称。'],
    loginVisualTitle: ['左侧视觉主标题', '登录卡片左侧插画下方的核心标语。'],
    loginVisualSubtitle: ['左侧视觉说明', '用于解释 MarchCenter 的统一入口能力。', true],
    loginWelcomeTitle: ['欢迎标题', '登录表单顶部的第一层标题。'],
    loginWelcomeSubtitle: ['欢迎说明', '欢迎标题下方的账号登录提示。'],
    loginPasswordTabText: ['密码登录标签', '密码登录方式的页签名称。'],
    loginCodeTabText: ['验证码登录标签', '邮箱验证码登录方式的页签名称。'],
    loginUsernameLabel: ['账号字段名称', '账号输入框上方的标签。'],
    loginUsernamePlaceholder: ['账号输入提示', '账号输入框中的占位提示。'],
    loginCodeAccountLabel: ['验证码登录邮箱名称', '免密验证码登录时邮箱输入框上方的标签。'],
    loginCodeAccountPlaceholder: ['验证码登录邮箱提示', '免密验证码登录时邮箱输入框中的占位提示。'],
    loginPasswordLabel: ['密码字段名称', '密码输入框上方的标签。'],
    loginPasswordPlaceholder: ['密码输入提示', '密码输入框中的占位提示。'],
    loginCodeLabel: ['验证码字段名称', '验证码输入框上方的标签。'],
    loginCodeSendText: ['发送验证码按钮', '获取邮箱验证码的按钮文案。'],
    loginCodeHint: ['验证码可用提示', '邮件服务启用后显示的辅助说明。', true],
    loginCodeDisabledHint: ['验证码待配置提示', '邮件服务尚未配置时显示的说明。', true],
    loginSubmitText: ['登录按钮', '密码登录的主操作按钮。'],
    loginCodeSubmitText: ['验证码登录按钮', '验证码登录的主操作按钮。'],
    loginLoadingText: ['登录校验状态', '登录请求进行中显示的按钮文案。'],
    loginForgotText: ['忘记密码入口', '密码输入框下方的找回入口。'],
    loginRegisterLead: ['注册引导文案', '注册入口之前的辅助文案。'],
    loginRegisterText: ['注册入口', '打开注册弹窗的链接文案。'],
    loginSecurityText: ['安全提示', '登录卡片底部的安全校验说明。'],
    forgotTitle: ['忘记密码标题', '忘记密码弹窗的标题。'],
    forgotSubtitle: ['忘记密码说明', '说明通过绑定邮箱验证身份并重置密码。', true],
    forgotInstruction: ['验证码有效期说明', '说明密码重置验证码的有效时间。', true],
    forgotCloseText: ['重置按钮', '提交新密码的主操作按钮文案。'],
    registerTitle: ['注册弹窗标题', '注册弹窗顶部标题。'],
    registerSubtitle: ['注册弹窗说明', '注册标题下方的填写指引。'],
    registerSubmitText: ['注册提交按钮', '创建账号的主操作文案。'],
    registerSuccessTitle: ['注册成功标题', '账号创建成功后的状态标题。'],
    registerSuccessSubtitle: ['注册成功说明', '注册完成后引导用户继续登录。', true],
    welcomeTitle: ['主页欢迎标题', '登录后首页的欢迎语，支持 {username} 变量。'],
    welcomeSubtitle: ['主页欢迎说明', '首页欢迎标题下方的辅助说明。'],
    dailyQuote: ['每日一句', '首页顶部展示的短句。', true],
    footerText: ['页脚版权', '登录页与登录后首页共用的版权文案。']
};

const SCENES = [
    { id: 'login', label: '登录页', icon: LockKeyhole },
    { id: 'forgot', label: '忘记密码', icon: MessageSquare },
    { id: 'register', label: '注册弹窗', icon: MousePointer2 },
    { id: 'dashboard', label: '登录后首页', icon: LayoutDashboard },
    { id: 'topbar', label: '顶部栏', icon: Monitor },
    { id: 'footer', label: '页脚', icon: Quote }
];

function textValue(value, fallback = '') {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return value.text || fallback;
    return fallback;
}

function EditableText({ field, value, selected, onSelect, className = '', as = 'span' }) {
    const Tag = as;
    return (
        <Tag
            role="button"
            tabIndex={0}
            onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(field);
            }}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(field);
                }
            }}
            className={`content-editable-target ${selected ? 'is-selected' : ''} ${className}`}
            data-edit-label={FIELD_META[field]?.[0] || '编辑文案'}
        >
            {value || '点击输入文案'}
            <span className="content-edit-pencil"><Pencil /></span>
        </Tag>
    );
}

function VisualCenterPreview({ data, selected, onSelect }) {
    const imageUrl = data.loginVisualCenterImageUrl || '';
    const type = data.loginVisualCenterType || (imageUrl ? 'image' : 'emoji');
    return (
        <div
            role="button"
            tabIndex={0}
            aria-label="编辑中心图案"
            onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onSelect('__visualCenter');
            }}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect('__visualCenter');
                }
            }}
            className={`login-visual-trophy content-visual-center-target ${selected ? 'is-selected' : ''}`}
        >
            {type === 'image' && imageUrl ? (
                <img src={imageUrl} alt="" />
            ) : (
                <span>{data.loginVisualCenterValue || '🏆'}</span>
            )}
            <span className="content-edit-pencil"><Pencil /></span>
        </div>
    );
}

function BrandLogoPreview({ data, selected, onSelect }) {
    return (
        <div
            role="button"
            tabIndex={0}
            aria-label="编辑顶部栏 Logo"
            onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onSelect('__navbarLogo');
            }}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect('__navbarLogo');
                }
            }}
            className={`content-preview-brand-mark content-logo-target ${selected ? 'is-selected' : ''}`}
        >
            <BrandLogo
                type={data.navbarLogoType || 'Trophy'}
                url={data.navbarLogoUrl || ''}
                className="h-5 w-5 text-white"
                imageClassName="h-6 w-6 object-contain"
            />
            <span className="content-edit-pencil"><Pencil /></span>
        </div>
    );
}

function ScaleCanvas({ children, width = 900, height = 500 }) {
    const frameRef = useRef(null);
    const [scale, setScale] = useState(0.72);

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        const update = () => setScale(Math.min(1, frame.clientWidth / width));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(frame);
        return () => observer.disconnect();
    }, [width]);

    return (
        <div ref={frameRef} className="content-canvas-frame" style={{ height: `${height * scale}px` }}>
            <div className="content-canvas-scale" style={{ width, height, transform: `scale(${scale})` }}>
                {children}
            </div>
        </div>
    );
}

function LoginCardPreview({ data, selectedKey, selectField, codeMode = false }) {
    const get = (key, fallback) => textValue(data[key], fallback);
    return (
        <div className="content-login-card">
            <div className="login-horizontal-visual">
                <div className="login-visual-orbit login-visual-orbit-one" />
                <div className="login-visual-orbit login-visual-orbit-two" />
                <div className="login-visual-stage">
                    <div className="login-visual-bridge" />
                    <div className="login-visual-card login-visual-card-left"><span>01</span><i /><i /></div>
                    <VisualCenterPreview data={data} selected={selectedKey === '__visualCenter'} onSelect={selectField} />
                    <div className="login-visual-card login-visual-card-right"><span>02</span><i /><i /></div>
                </div>
                <div className="login-visual-copy">
                    <EditableText field="loginVisualTitle" value={get('loginVisualTitle', '连接每一场竞赛')} selected={selectedKey === 'loginVisualTitle'} onSelect={selectField} as="strong" />
                    <EditableText field="loginVisualSubtitle" value={get('loginVisualSubtitle', '统一管理竞赛入口、账号与训练进度，让每一次出发都更简单。')} selected={selectedKey === 'loginVisualSubtitle'} onSelect={selectField} />
                </div>
            </div>

            <div className="content-preview-form">
                <div>
                    <EditableText field="loginWelcomeTitle" value={get('loginWelcomeTitle', '欢迎回来')} selected={selectedKey === 'loginWelcomeTitle'} onSelect={selectField} as="h2" className="content-form-title" />
                    <EditableText field="loginWelcomeSubtitle" value={get('loginWelcomeSubtitle', '请输入您的 MarchCenter 账号凭证')} selected={selectedKey === 'loginWelcomeSubtitle'} onSelect={selectField} className="content-form-subtitle" />
                </div>

                <div className="content-preview-tabs">
                    <EditableText field="loginPasswordTabText" value={get('loginPasswordTabText', '密码登录')} selected={selectedKey === 'loginPasswordTabText'} onSelect={selectField} className={!codeMode ? 'active' : ''} />
                    <EditableText field="loginCodeTabText" value={get('loginCodeTabText', '免密验证码登录')} selected={selectedKey === 'loginCodeTabText'} onSelect={selectField} className={codeMode ? 'active' : ''} />
                </div>

                <div className="content-preview-fields">
                    <div>
                        <EditableText
                            field={codeMode ? 'loginCodeAccountLabel' : 'loginUsernameLabel'}
                            value={get(codeMode ? 'loginCodeAccountLabel' : 'loginUsernameLabel', codeMode ? '电子邮箱' : '用户名')}
                            selected={selectedKey === (codeMode ? 'loginCodeAccountLabel' : 'loginUsernameLabel')}
                            onSelect={selectField}
                            className="content-preview-label"
                        />
                        <div className="content-preview-input">
                            <span className="content-preview-input-icon">♙</span>
                            <EditableText
                                field={codeMode ? 'loginCodeAccountPlaceholder' : 'loginUsernamePlaceholder'}
                                value={get(codeMode ? 'loginCodeAccountPlaceholder' : 'loginUsernamePlaceholder', codeMode ? '请输入已绑定邮箱' : '请输入用户名或邮箱')}
                                selected={selectedKey === (codeMode ? 'loginCodeAccountPlaceholder' : 'loginUsernamePlaceholder')}
                                onSelect={selectField}
                                className="content-preview-placeholder"
                            />
                        </div>
                    </div>

                    {codeMode ? (
                        <div>
                            <EditableText field="loginCodeLabel" value={get('loginCodeLabel', '邮箱动态验证码')} selected={selectedKey === 'loginCodeLabel'} onSelect={selectField} className="content-preview-label" />
                            <div className="content-preview-input">
                                <span className="content-preview-input-icon">✉</span>
                                <span className="content-preview-placeholder">请输入 6 位验证码</span>
                                <EditableText field="loginCodeSendText" value={get('loginCodeSendText', '获取验证码')} selected={selectedKey === 'loginCodeSendText'} onSelect={selectField} className="content-preview-send" />
                            </div>
                            <EditableText field="loginCodeDisabledHint" value={get('loginCodeDisabledHint', '邮件服务尚未配置，配置完成后即可使用。')} selected={selectedKey === 'loginCodeDisabledHint'} onSelect={selectField} className="content-preview-hint" />
                        </div>
                    ) : (
                        <div className="content-preview-password-field">
                            <div className="content-preview-password-header">
                                <EditableText field="loginPasswordLabel" value={get('loginPasswordLabel', '密码')} selected={selectedKey === 'loginPasswordLabel'} onSelect={selectField} className="content-preview-label" />
                                <EditableText field="loginForgotText" value={get('loginForgotText', '忘记密码？')} selected={selectedKey === 'loginForgotText'} onSelect={selectField} className="content-preview-forgot-link" />
                            </div>
                            <div className="content-preview-input">
                                <span className="content-preview-input-icon">♙</span>
                                <EditableText field="loginPasswordPlaceholder" value={get('loginPasswordPlaceholder', '请输入密码')} selected={selectedKey === 'loginPasswordPlaceholder'} onSelect={selectField} className="content-preview-placeholder" />
                                <span className="content-preview-eye">◉</span>
                            </div>
                        </div>
                    )}
                </div>

                <EditableText
                    field={codeMode ? 'loginCodeSubmitText' : 'loginSubmitText'}
                    value={get(codeMode ? 'loginCodeSubmitText' : 'loginSubmitText', codeMode ? '验证码登录' : '登录')}
                    selected={selectedKey === (codeMode ? 'loginCodeSubmitText' : 'loginSubmitText')}
                    onSelect={selectField}
                    className="content-preview-submit"
                />

                <div className="content-preview-register">
                    <EditableText field="loginRegisterLead" value={get('loginRegisterLead', '还没有账号？')} selected={selectedKey === 'loginRegisterLead'} onSelect={selectField} />
                    <EditableText field="loginRegisterText" value={get('loginRegisterText', '立即注册')} selected={selectedKey === 'loginRegisterText'} onSelect={selectField} className="link" />
                </div>

                <div className="content-preview-security">
                    <ShieldCheck />
                    <EditableText field="loginSecurityText" value={get('loginSecurityText', '256-bit TLS 端到端加密校验')} selected={selectedKey === 'loginSecurityText'} onSelect={selectField} />
                </div>
            </div>
        </div>
    );
}

function PreviewFormField({ label, icon: Icon, placeholder, action = null, className = '' }) {
    return (
        <div className={`content-modal-field ${className}`}>
            <span>{label}</span>
            <div className="content-modal-input-row">
                <div className="content-modal-input">
                    {Icon && <Icon />}
                    <span>{placeholder}</span>
                </div>
                {action && <button type="button" tabIndex={-1}>{action}</button>}
            </div>
        </div>
    );
}

function ModalPreview({ type, data, selectedKey, selectField, modalState = 'form' }) {
    const isForgot = type === 'forgot';
    const get = (key, fallback) => {
        const value = textValue(data[key], fallback);
        if (isForgot && (key === 'forgotSubtitle' || key === 'forgotInstruction') && value.includes('上级账号')) return fallback;
        if (isForgot && key === 'forgotCloseText' && value === '我知道了') return fallback;
        return value;
    };

    if (!isForgot && modalState === 'success') {
        return (
            <div className="content-modal-layer">
                <div className="content-modal-card content-modal-success">
                    <span className="content-modal-close"><X /></span>
                    <CheckCircle2 className="content-modal-success-icon" />
                    <EditableText
                        field="registerSuccessTitle"
                        value={get('registerSuccessTitle', '账号创建成功')}
                        selected={selectedKey === 'registerSuccessTitle'}
                        onSelect={selectField}
                        as="h3"
                        className="content-modal-title"
                    />
                    <EditableText
                        field="registerSuccessSubtitle"
                        value={get('registerSuccessSubtitle', '账号已填入登录表单，请使用刚设置的密码登录。')}
                        selected={selectedKey === 'registerSuccessSubtitle'}
                        onSelect={selectField}
                        className="content-modal-subtitle"
                    />
                    <span className="content-modal-submit">返回登录</span>
                </div>
            </div>
        );
    }

    return (
        <div className="content-modal-layer">
            <div className="content-modal-card">
                <span className="content-modal-close"><X /></span>
                <div className="content-modal-heading">
                    {isForgot && <div className="content-modal-icon"><LockKeyhole /></div>}
                    <EditableText
                        field={isForgot ? 'forgotTitle' : 'registerTitle'}
                        value={get(isForgot ? 'forgotTitle' : 'registerTitle', isForgot ? '重置您的访问密码' : '创建 MarchCenter 账号')}
                        selected={selectedKey === (isForgot ? 'forgotTitle' : 'registerTitle')}
                        onSelect={selectField}
                        as="h3"
                        className="content-modal-title"
                    />
                    <EditableText
                        field={isForgot ? 'forgotSubtitle' : 'registerSubtitle'}
                        value={get(isForgot ? 'forgotSubtitle' : 'registerSubtitle', isForgot ? '通过账号绑定邮箱验证身份并设置新密码。' : '填写以下信息完成新用户注册')}
                        selected={selectedKey === (isForgot ? 'forgotSubtitle' : 'registerSubtitle')}
                        onSelect={selectField}
                        className="content-modal-subtitle"
                    />
                </div>

                {isForgot ? (
                    <div className="content-modal-form">
                        <PreviewFormField label="绑定邮箱" icon={Mail} placeholder="user@example.com" />
                        <PreviewFormField label="邮箱验证码" placeholder="6 位验证码" action="获取验证码" />
                        <div className="content-modal-instruction">
                            <EditableText field="forgotInstruction" value={get('forgotInstruction', '验证码将在 10 分钟内有效。')} selected={selectedKey === 'forgotInstruction'} onSelect={selectField} />
                        </div>
                        <div className="content-modal-two-column">
                            <PreviewFormField label="新密码" placeholder="6–128 位" />
                            <PreviewFormField label="确认新密码" placeholder="再次输入" />
                        </div>
                    </div>
                ) : (
                    <div className="content-modal-form">
                        <div className="content-modal-two-column">
                            <PreviewFormField label="用户名" icon={User} placeholder="yourname" />
                            <PreviewFormField label="电子邮箱" icon={Mail} placeholder="user@example.com" />
                        </div>
                        <PreviewFormField label="邮箱验证码" placeholder="6 位验证码" action="获取验证码" />
                        <PreviewFormField label="设置访问密码" placeholder="6–128 位" />
                        <PreviewFormField label="确认密码" placeholder="再次输入密码" />
                    </div>
                )}

                <EditableText
                    field={isForgot ? 'forgotCloseText' : 'registerSubmitText'}
                    value={get(isForgot ? 'forgotCloseText' : 'registerSubmitText', isForgot ? '重置密码' : '立即注册')}
                    selected={selectedKey === (isForgot ? 'forgotCloseText' : 'registerSubmitText')}
                    onSelect={selectField}
                    className="content-modal-submit"
                />
            </div>
        </div>
    );
}

function DashboardPreview({ data, selectedKey, selectField }) {
    const get = (key, fallback) => textValue(data[key], fallback);
    const alignment = data.dashboardTextAlign || 'left';
    return (
        <div className="content-dashboard-preview">
            <div className="content-dashboard-nav">
                <BrandLogoPreview data={data} selected={selectedKey === '__navbarLogo'} onSelect={selectField} />
                <EditableText field="loginBrandName" value={get('loginBrandName', 'MarchCenter')} selected={selectedKey === 'loginBrandName'} onSelect={selectField} className="content-preview-brand" />
                <div className="content-dashboard-nav-items"><span>竞赛中心</span><span>训练进度</span><span>个人中心</span></div>
                <div className="content-dashboard-avatar">A</div>
            </div>
            <div className={`content-dashboard-hero align-${alignment}`}>
                <EditableText field="dailyQuote" value={get('dailyQuote', '保持热爱，奔赴下一场挑战。')} selected={selectedKey === 'dailyQuote'} onSelect={selectField} className="content-dashboard-quote" />
                <EditableText field="welcomeTitle" value={get('welcomeTitle', 'Hello, {username} 👋')} selected={selectedKey === 'welcomeTitle'} onSelect={selectField} as="h2" className="content-dashboard-title" />
                <EditableText field="welcomeSubtitle" value={get('welcomeSubtitle', '准备好开始今天的挑战了吗？')} selected={selectedKey === 'welcomeSubtitle'} onSelect={selectField} className="content-dashboard-subtitle" />
                <div className="content-dashboard-search">搜索竞赛或考点...</div>
            </div>
            <div className="content-dashboard-cards">
                {[1, 2, 3].map(item => <div key={item}><span /><strong>竞赛工具</strong><small>统一入口与训练资源</small></div>)}
            </div>
        </div>
    );
}

function FooterScenePreview({ data, selectedKey, selectField }) {
    const visibility = data.footerVisibility || 'all';
    const footerText = textValue(data.footerText, '© 2026 MarchCenter. All rights reserved.');
    const pages = [
        { id: 'login', label: '登录页', visible: visibility === 'all' || visibility === 'login_only' },
        { id: 'dashboard', label: '登录后首页', visible: visibility === 'all' || visibility === 'dashboard_only' }
    ];
    return (
        <div className="content-footer-page-grid">
            {pages.map(page => (
                <div className="content-footer-page" key={page.id}>
                    <div className="content-footer-page-label">{page.label}</div>
                    <div className="content-footer-page-skeleton">
                        <span /><span /><span />
                    </div>
                    <div className={`content-footer-page-value ${page.visible ? '' : 'is-hidden'}`}>
                        {page.visible ? (
                            <EditableText
                                field="footerText"
                                value={footerText}
                                selected={selectedKey === 'footerText'}
                                onSelect={selectField}
                                className="content-standalone-footer"
                            />
                        ) : (
                            <span><Eye />当前范围已隐藏</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function LoginPageCanvas({ scene, codeMode, data, selectedKey, selectField, modalState }) {
    const get = (key, fallback) => textValue(data[key], fallback);
    if (scene === 'topbar') {
        return (
            <div className="content-chrome-scene content-topbar-scene">
                <div className="content-preview-header">
                    <BrandLogoPreview data={data} selected={selectedKey === '__navbarLogo'} onSelect={selectField} />
                    <EditableText
                        field="loginBrandName"
                        value={get('loginBrandName', 'MarchCenter')}
                        selected={selectedKey === 'loginBrandName'}
                        onSelect={selectField}
                        className="content-preview-brand"
                    />
                    <div className="content-preview-theme">☾</div>
                </div>
                <div className="content-topbar-page-skeleton" aria-hidden="true">
                    <div><span /><span /></div>
                    <div><span /><span /><span /></div>
                </div>
            </div>
        );
    }

    if (scene === 'footer') {
        return (
            <div className="content-chrome-scene content-footer-scene">
                <FooterScenePreview data={data} selectedKey={selectedKey} selectField={selectField} />
            </div>
        );
    }

    return (
        <div className="content-preview-window">
            {scene === 'dashboard' ? (
                <DashboardPreview data={data} selectedKey={selectedKey} selectField={selectField} />
            ) : (
                <>
                    <LoginCardPreview data={data} selectedKey={selectedKey} selectField={selectField} codeMode={codeMode} />
                    {(scene === 'forgot' || scene === 'register') && (
                        <ModalPreview type={scene} data={data} selectedKey={selectedKey} selectField={selectField} modalState={modalState} />
                    )}
                </>
            )}
        </div>
    );
}

const ContentManager = ({ config, onSave }) => {
    const normalizedConfig = useMemo(() => ({ ...DEFAULT_SITE_CONFIG, ...(config || {}) }), [config]);
    const [formData, setFormData] = useState(normalizedConfig);
    const [scene, setScene] = useState('login');
    const [codeMode, setCodeMode] = useState(false);
    const [modalState, setModalState] = useState('form');
    const [selectedKey, setSelectedKey] = useState('loginWelcomeTitle');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const editorRef = useRef(null);

    useEffect(() => {
        setFormData(normalizedConfig);
    }, [normalizedConfig]);

    const dirty = useMemo(
        () => JSON.stringify(formData) !== JSON.stringify(normalizedConfig),
        [formData, normalizedConfig]
    );

    const handlePatch = patch => {
        setSaved(false);
        setFormData(previous => ({ ...previous, ...patch }));
    };

    const handleChange = (key, value) => {
        handlePatch({ [key]: value });
    };

    const selectField = key => {
        setSelectedKey(key);
    };

    const handleSave = async () => {
        const cleanConfig = { ...formData };
        const brandName = textValue(cleanConfig.loginBrandName, 'MarchCenter');
        cleanConfig.loginBrandName = brandName;
        cleanConfig.loginTitle = typeof cleanConfig.loginTitle === 'object'
            ? { ...cleanConfig.loginTitle, text: brandName }
            : brandName;
        setSaving(true);
        const success = await onSave(cleanConfig);
        setSaving(false);
        if (!success) return;
        setFormData(cleanConfig);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
    };

    const meta = FIELD_META[selectedKey];
    const selectedValue = meta ? textValue(formData[selectedKey]) : '';
    const isMultiline = Boolean(meta?.[2]);

    return (
        <div className="content-studio space-y-5 pb-10">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                        <Sparkles className="h-3 w-3" />所见即所得内容工作台
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">全局文案</h1>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        将鼠标移到预览中的文案上，点击即可编辑对应位置；所有修改保存后立即同步到真实页面。
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`hidden items-center gap-2 text-xs font-bold sm:flex ${dirty ? 'text-amber-600' : 'text-slate-400'}`}>
                        <span className={`h-2 w-2 rounded-full ${dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                        {dirty ? '有未保存修改' : '内容已同步'}
                    </span>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className={`flex min-w-36 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-bold disabled:cursor-wait disabled:opacity-70 ${PRIMARY_BTN}`}
                    >
                        {saved ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-300" /> : <Save className="mr-2 h-4 w-4" />}
                        {saving ? '正在保存...' : saved ? '已保存并生效' : '保存并生效'}
                    </button>
                </div>
            </div>

            <div className="content-studio-toolbar">
                <div className="content-scene-tabs">
                    {SCENES.map(item => (
                        <button
                            type="button"
                            key={item.id}
                            onClick={() => {
                                setScene(item.id);
                                setModalState('form');
                                if (item.id === 'forgot') setSelectedKey('forgotTitle');
                                if (item.id === 'register') setSelectedKey('registerTitle');
                                if (item.id === 'dashboard') setSelectedKey('welcomeTitle');
                                if (item.id === 'topbar') setSelectedKey('loginBrandName');
                                if (item.id === 'footer') setSelectedKey('footerText');
                            }}
                            className={scene === item.id ? 'active' : ''}
                        >
                            <item.icon />{item.label}
                        </button>
                    ))}
                </div>
                {scene === 'login' && (
                    <div className="flex items-center gap-2">
                        <div className="content-mode-toggle">
                            <button type="button" className={!codeMode ? 'active' : ''} onClick={() => setCodeMode(false)}>密码</button>
                            <button type="button" className={codeMode ? 'active' : ''} onClick={() => setCodeMode(true)}>验证码</button>
                        </div>
                    </div>
                )}
                {scene === 'register' && (
                    <div className="content-mode-toggle">
                        <button
                            type="button"
                            className={modalState === 'form' ? 'active' : ''}
                            onClick={() => {
                                setModalState('form');
                                setSelectedKey('registerTitle');
                            }}
                        >
                            注册表单
                        </button>
                        <button
                            type="button"
                            className={modalState === 'success' ? 'active' : ''}
                            onClick={() => {
                                setModalState('success');
                                setSelectedKey('registerSuccessTitle');
                            }}
                        >
                            成功状态
                        </button>
                    </div>
                )}
            </div>

            <div className="content-studio-layout">
                <div className="content-preview-column">
                    <div className="content-login-preview">
                        <ScaleCanvas
                            width={840}
                            height={467}
                        >
                            <LoginPageCanvas scene={scene} codeMode={codeMode} data={formData} selectedKey={selectedKey} selectField={selectField} modalState={modalState} />
                        </ScaleCanvas>
                    </div>
                </div>

                <aside className="content-inspector">
                    {selectedKey === '__visualCenter' ? (
                        <>
                            <div className="content-inspector-heading">
                                <div><Sparkles /></div>
                                <span><strong>中心图案</strong><small>登录窗口左侧插画的视觉焦点</small></span>
                            </div>
                            <div className="content-inspector-field">
                                <span>预设图案</span>
                                <div className="content-center-preset-grid">
                                    {VISUAL_CENTER_PRESETS.map(item => {
                                        const active = (formData.loginVisualCenterType || 'emoji') === 'emoji'
                                            && (formData.loginVisualCenterValue || '🏆') === item.value;
                                        return (
                                            <button
                                                type="button"
                                                key={item.id}
                                                title={item.label}
                                                className={active ? 'active' : ''}
                                                onClick={() => {
                                                    handlePatch({
                                                        loginVisualCenterType: 'emoji',
                                                        loginVisualCenterValue: item.value
                                                    });
                                                }}
                                            >
                                                <span>{item.value}</span>
                                                <small>{item.label}</small>
                                                {active && <Check />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <label className="content-inspector-field">
                                <span>自定义图片 URL</span>
                                <input
                                    className={GLASS_INPUT}
                                    value={formData.loginVisualCenterImageUrl || ''}
                                    onChange={event => {
                                        const value = event.target.value;
                                        handlePatch({
                                            loginVisualCenterImageUrl: value,
                                            loginVisualCenterType: value
                                                ? 'image'
                                                : formData.loginVisualCenterType === 'image' ? 'emoji' : formData.loginVisualCenterType
                                        });
                                    }}
                                    placeholder="https://example.com/icon.png"
                                />
                                <small>建议使用正方形 PNG、WebP 或 SVG，图案会自动保持比例。</small>
                            </label>
                            <div className="content-center-type-actions">
                                <button
                                    type="button"
                                    className={(formData.loginVisualCenterType || 'emoji') === 'emoji' ? 'active' : ''}
                                    onClick={() => handleChange('loginVisualCenterType', 'emoji')}
                                >
                                    使用预设图案
                                </button>
                                <button
                                    type="button"
                                    disabled={!formData.loginVisualCenterImageUrl}
                                    className={formData.loginVisualCenterType === 'image' ? 'active' : ''}
                                    onClick={() => handleChange('loginVisualCenterType', 'image')}
                                >
                                    使用自定义图片
                                </button>
                            </div>
                            <div className="content-variable-tip"><Sparkles />后台编辑预览已关闭浮动动画，便于准确查看图案位置与大小。</div>
                            <button
                                type="button"
                                className="content-reset-field"
                                onClick={() => handlePatch({
                                    loginVisualCenterType: DEFAULT_SITE_CONFIG.loginVisualCenterType,
                                    loginVisualCenterValue: DEFAULT_SITE_CONFIG.loginVisualCenterValue,
                                    loginVisualCenterImageUrl: DEFAULT_SITE_CONFIG.loginVisualCenterImageUrl
                                })}
                            >
                                <RotateCcw />恢复默认奖杯图案
                            </button>
                        </>
                    ) : selectedKey === '__navbarLogo' ? (
                        <>
                            <div className="content-inspector-heading">
                                <div><ImageIcon /></div>
                                <span><strong>顶部栏 Logo</strong><small>登录页顶部与登录后导航栏共用</small></span>
                            </div>
                            <div className="content-inspector-field">
                                <span>预设 Logo</span>
                                <div className="content-logo-grid">
                                    {BRAND_LOGO_PRESETS.map(item => (
                                        <button
                                            type="button"
                                            key={item.id}
                                            title={item.label}
                                            onClick={() => handleChange('navbarLogoType', item.id)}
                                            className={(formData.navbarLogoType || 'Trophy') === item.id ? 'active' : ''}
                                        >
                                            <item.icon className="content-logo-choice-icon" />
                                            <span>{item.label}</span>
                                            {(formData.navbarLogoType || 'Trophy') === item.id && <Check className="content-logo-choice-check" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <label className="content-inspector-field">
                                <span>自定义 Logo 图片 URL</span>
                                <input
                                    className={GLASS_INPUT}
                                    value={formData.navbarLogoUrl || ''}
                                    onChange={event => {
                                        const value = event.target.value;
                                        handlePatch({
                                            navbarLogoUrl: value,
                                            navbarLogoType: value
                                                ? 'custom'
                                                : formData.navbarLogoType === 'custom' ? DEFAULT_SITE_CONFIG.navbarLogoType : formData.navbarLogoType
                                        });
                                    }}
                                    placeholder="https://..."
                                />
                                <small>建议使用透明背景的正方形 PNG、WebP 或 SVG。</small>
                            </label>
                            <button
                                type="button"
                                className="content-reset-field"
                                onClick={() => handlePatch({
                                    navbarLogoType: DEFAULT_SITE_CONFIG.navbarLogoType,
                                    navbarLogoUrl: DEFAULT_SITE_CONFIG.navbarLogoUrl
                                })}
                            >
                                <RotateCcw />恢复默认 Logo
                            </button>
                        </>
                    ) : meta ? (
                        <>
                            <div className="content-inspector-heading">
                                <div><Pencil /></div>
                                <span><strong>{meta[0]}</strong><small>{meta[1]}</small></span>
                            </div>

                            <label className="content-inspector-field">
                                <span>显示文案</span>
                                {isMultiline ? (
                                    <textarea
                                        ref={editorRef}
                                        rows={5}
                                        className={GLASS_INPUT}
                                        value={selectedValue}
                                        onChange={event => handleChange(selectedKey, event.target.value)}
                                    />
                                ) : (
                                    <input
                                        ref={editorRef}
                                        className={GLASS_INPUT}
                                        value={selectedValue}
                                        onChange={event => handleChange(selectedKey, event.target.value)}
                                    />
                                )}
                                <small>{selectedValue.length} 个字符 · 修改会实时显示在左侧预览</small>
                            </label>

                            {['welcomeTitle', 'welcomeSubtitle', 'dailyQuote'].includes(selectedKey) && (
                                <div className="content-inspector-field">
                                    <span>内容对齐</span>
                                    <div className="content-align-picker">
                                        {[
                                            ['left', AlignLeft, '左对齐'],
                                            ['center', AlignCenter, '居中'],
                                            ['right', AlignRight, '右对齐']
                                        ].map(([id, Icon, label]) => (
                                            <button type="button" key={id} title={label} onClick={() => handleChange('dashboardTextAlign', id)} className={(formData.dashboardTextAlign || 'left') === id ? 'active' : ''}>
                                                <Icon />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selectedKey === 'footerText' && (
                                <>
                                    <div className="content-inspector-field">
                                        <span>文字大小</span>
                                        <div className="content-segmented-picker">
                                            {[['small', '小'], ['medium', '中'], ['large', '大']].map(([id, label]) => (
                                                <button type="button" key={id} onClick={() => handleChange('footerSize', id)} className={(formData.footerSize || 'small') === id ? 'active' : ''}>{label}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="content-inspector-field">
                                        <span>显示范围</span>
                                        <div className="content-visibility-list">
                                            {[
                                                ['all', '全部显示', '登录页与登录后首页'],
                                                ['login_only', '仅登录页', '只在登录入口显示'],
                                                ['dashboard_only', '仅登录后首页', '登录成功后显示'],
                                                ['none', '全部隐藏', '两个页面均不显示']
                                            ].map(([id, label, description]) => (
                                                <button type="button" key={id} onClick={() => handleChange('footerVisibility', id)} className={(formData.footerVisibility || 'all') === id ? 'active' : ''}>
                                                    <span className="content-visibility-icon"><Eye /></span>
                                                    <span><strong>{label}</strong><small>{description}</small></span>
                                                    <span className="content-radio-dot">{(formData.footerVisibility || 'all') === id && <Check />}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            {selectedKey === 'welcomeTitle' && (
                                <div className="content-variable-tip"><Sparkles />输入 <code>{'{username}'}</code> 可自动显示当前登录用户名称。</div>
                            )}

                            <button
                                type="button"
                                className="content-reset-field"
                                onClick={() => handleChange(selectedKey, textValue(DEFAULT_SITE_CONFIG[selectedKey]))}
                            >
                                <RotateCcw />恢复该位置默认文案
                            </button>
                        </>
                    ) : (
                        <div className="content-inspector-empty">
                            <MousePointer2 />
                            <strong>选择一个文案位置</strong>
                            <span>将鼠标移到左侧预览，带有高亮反馈的位置都可以点击编辑。</span>
                        </div>
                    )}

                    <div className="content-inspector-path">
                        <span>当前场景</span>
                        <strong>{SCENES.find(item => item.id === scene)?.label}</strong>
                        <ChevronRight />
                        <strong>{selectedKey === '__navbarLogo' ? '顶部栏 Logo' : selectedKey === '__visualCenter' ? '中心图案' : meta?.[0] || '未选择'}</strong>
                    </div>
                </aside>
            </div>
        </div>
    );
};

export default ContentManager;
