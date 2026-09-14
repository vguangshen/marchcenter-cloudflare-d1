import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
    Sun, Moon, Loader2, User, Lock, ArrowRight, CloudRain,
    Eye, EyeOff, X, ShieldCheck, CheckCircle2, Mail, Ban
} from 'lucide-react';
import { DEFAULT_SYSTEM_EFFECTS, THEMES } from '../../constants/themes';
import { api } from '../../utils/api';
import { mark, measure, logStartupPerfSummary } from '../../utils/startupPerf';
import BrandLogo from '../branding/BrandLogo';
import CdnIndicator from './login/CdnIndicator'; // 👈 确保这个路径正确
import { inferLoginErrorField, LoginFieldError } from './login/LoginFieldError';

const LoginPage = ({
    onLogin,
    activeThemeColor,
    siteConfig,
    isDarkMode,
    onThemeToggle,
    immersiveMode,
    wallpaperActive = false,
    isUnlocking = false,
    onUnlockTransitionEnd,
    systemEffects = DEFAULT_SYSTEM_EFFECTS
}) => {
    const [activeModal, setActiveModal] = useState(null);
    const [loginMethod, setLoginMethod] = useState('password');
    const [username, setUsername] = useState("");
    const [codeEmail, setCodeEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [verificationCode, setVerificationCode] = useState('');
    const [verificationCodeEnabled, setVerificationCodeEnabled] = useState(null);
    const [passwordResetEnabled, setPasswordResetEnabled] = useState(null);
    const [codeSending, setCodeSending] = useState(false);
    const [codeCountdown, setCodeCountdown] = useState(0);
    const [codeWasRequested, setCodeWasRequested] = useState(false);
    const [accountError, setAccountError] = useState(null);
    const [codeEmailError, setCodeEmailError] = useState(null);
    const [codeError, setCodeError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [initialized, setInitialized] = useState(null);
    const [bootstrapSecretConfigured, setBootstrapSecretConfigured] = useState(null);
    const [shake, setShake] = useState(false); // 💡 新增震动状态

    // Register State
    const [regUsername, setRegUsername] = useState("");
    const [regEmail, setRegEmail] = useState("");
    const [regPassword, setRegPassword] = useState("");
    const [regConfirm, setRegConfirm] = useState("");
    const [regCode, setRegCode] = useState("");
    const [regCodeSending, setRegCodeSending] = useState(false);
    const [regCodeCountdown, setRegCodeCountdown] = useState(0);
    const [registrationEnabled, setRegistrationEnabled] = useState(null);
    const [regLoading, setRegLoading] = useState(false);
    const [regError, setRegError] = useState(null);
    const [regErrorField, setRegErrorField] = useState('form');
    const [regSuccess, setRegSuccess] = useState(false);
    const [regBootstrapSecret, setRegBootstrapSecret] = useState('');
    const [showBootstrapSecret, setShowBootstrapSecret] = useState(false);

    // Password reset state
    const [forgotEmail, setForgotEmail] = useState("");
    const [forgotCode, setForgotCode] = useState("");
    const [forgotPassword, setForgotPassword] = useState("");
    const [forgotConfirm, setForgotConfirm] = useState("");
    const [forgotCodeSending, setForgotCodeSending] = useState(false);
    const [forgotCodeCountdown, setForgotCodeCountdown] = useState(0);
    const [forgotCodeWasRequested, setForgotCodeWasRequested] = useState(false);
    const [forgotLoading, setForgotLoading] = useState(false);
    const [forgotError, setForgotError] = useState(null);
    const [forgotErrorField, setForgotErrorField] = useState('form');
    const [forgotSuccess, setForgotSuccess] = useState(false);
    const modalRef = useRef(null);
    const modalTriggerRef = useRef(null);

    const config = siteConfig || {};
    const defaultTheme = THEMES[activeThemeColor] || THEMES.blue;

    // 登录表单首帧渲染标记（非生产调试用，不阻塞渲染）。
    useLayoutEffect(() => {
        mark('loginPageFirstRender');
        // 等首帧绘制与首批请求落定后输出汇总。
        const frame = window.requestAnimationFrame(() => {
            window.setTimeout(logStartupPerfSummary, 0);
        });
        return () => window.cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        // 登录表单不等待 setup-status：请求在后台并行进行，
        // 结果只用于功能开关（验证码/注册/重置），失败时按已初始化回退。
        mark('setupStatusRequestStart');
        api.get('/auth/setup-status', { signal: controller.signal })
            .then(data => {
                const ready = Boolean(data.initialized);
                setInitialized(ready);
                setBootstrapSecretConfigured(Boolean(data.bootstrapSecretConfigured));
                setVerificationCodeEnabled(Boolean(data.verificationCodeEnabled));
                setRegistrationEnabled(Boolean(data.registrationEnabled));
                setPasswordResetEnabled(Boolean(data.passwordResetEnabled));
            })
            .catch(error => {
                // 与上面注释意图一致：请求失败时按"已初始化、功能可用"回退。
                // 若保持 null（null !== true），注册/密码重置的四个按钮会全部
                // 被禁用且不显示"服务未启用"提示，把本可正常工作的功能静默锁死。
                if (error.name !== 'AbortError') {
                    setInitialized(true);
                    setBootstrapSecretConfigured(null);
                    setVerificationCodeEnabled(true);
                    setRegistrationEnabled(true);
                    setPasswordResetEnabled(true);
                }
            })
            .finally(() => {
                mark('setupStatusRequestEnd');
                measure('setupStatusRequest', 'setupStatusRequestStart', 'setupStatusRequestEnd');
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!activeModal) return undefined;
        modalTriggerRef.current = document.activeElement;
        const dialog = modalRef.current;
        const focusableSelector = 'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
        const firstInput = dialog?.querySelector('input:not([disabled])');
        window.requestAnimationFrame(() => firstInput?.focus());
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                setActiveModal(null);
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;
            const focusable = [...dialog.querySelectorAll(focusableSelector)]
                .filter(element => element.getClientRects().length > 0);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            modalTriggerRef.current?.focus?.();
            modalTriggerRef.current = null;
        };
    }, [activeModal]);

    useEffect(() => {
        if (codeCountdown <= 0) return undefined;
        const timer = window.setInterval(() => {
            setCodeCountdown(value => Math.max(0, value - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [codeCountdown]);

    useEffect(() => {
        if (regCodeCountdown <= 0) return undefined;
        const timer = window.setInterval(() => {
            setRegCodeCountdown(value => Math.max(0, value - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [regCodeCountdown]);

    useEffect(() => {
        if (forgotCodeCountdown <= 0) return undefined;
        const timer = window.setInterval(() => {
            setForgotCodeCountdown(value => Math.max(0, value - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [forgotCodeCountdown]);

    // --- 🎨 核心：沉浸式主题样式配置生成器 ---
    const getThemeStyles = () => {
        // 默认样式
        const base = {
            card: `bg-white/70 backdrop-blur-xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:bg-[#151e32]/90 dark:border-slate-700/70 dark:shadow-[0_0_50px_-10px_rgba(0,0,0,0.5)]`,
            title: `text-slate-800 dark:text-white`,
            subtitle: `text-slate-500 dark:text-slate-400`,
            input: `bg-white/50 focus:bg-white focus:border-indigo-400 focus:ring-indigo-100 dark:bg-slate-800 dark:border-slate-700 dark:text-white dark:focus:bg-slate-800 dark:focus:border-indigo-500 dark:focus:ring-slate-700`,
            button: `bg-gradient-to-r ${defaultTheme.gradient} text-white shadow-lg ${defaultTheme.shadow}`,
            activeTab: `text-${activeThemeColor}-600 dark:text-${activeThemeColor}-400`,
            tabBg: `bg-slate-100/50 border-slate-200/50 dark:bg-slate-900/50 dark:border-slate-800`,
            footer: `text-slate-400 dark:text-slate-600`,
            toggleBtn: isDarkMode ? 'bg-slate-700 border-slate-600 text-yellow-400' : 'bg-white border-slate-200 text-slate-500'
        };

        switch (immersiveMode) {
            case 'qingming': // 🌧️ 清明：水墨 + 青瓷 + 烟雨
                return {
                    ...base,
                    card: 'bg-[#f8fafc]/95 backdrop-blur-xl border border-slate-300 shadow-2xl shadow-slate-900/20 grayscale-[0.2]',
                    title: 'text-slate-700',
                    subtitle: 'text-slate-500',
                    input: 'bg-white/80 border-slate-300 text-slate-800 placeholder-slate-400 focus:border-slate-500 focus:ring-slate-200',
                    button: 'bg-gradient-to-r from-slate-600 to-gray-500 text-white shadow-lg shadow-slate-500/30',
                    activeTab: 'text-slate-700',
                    tabBg: 'bg-slate-200/50 border-slate-300',
                    footer: 'text-slate-400',
                    toggleBtn: 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                };
            case 'yuanxiao': // 🍡 元宵
                return {
                    ...base,
                    card: 'bg-white/90 backdrop-blur-xl border-2 border-pink-100 shadow-2xl shadow-pink-500/20',
                    title: 'text-rose-900',
                    subtitle: 'text-rose-400',
                    input: 'bg-white border-pink-100 text-rose-900 placeholder-pink-300 focus:border-rose-400 focus:ring-rose-100',
                    button: 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-lg shadow-rose-500/30',
                    activeTab: 'text-rose-600',
                    tabBg: 'bg-pink-50 border-pink-100',
                    footer: 'text-rose-300',
                    toggleBtn: 'bg-pink-100 border-pink-200 text-rose-500 hover:bg-pink-200'
                };
            case 'christmas': // 🎄 圣诞
                return {
                    ...base,
                    card: 'bg-[#FFFBF7]/95 backdrop-blur-xl border-2 border-red-100 shadow-2xl shadow-red-600/10',
                    title: 'text-red-800',
                    subtitle: 'text-emerald-600',
                    input: 'bg-white border-red-100 text-red-900 placeholder-red-200 focus:border-red-400 focus:ring-red-100',
                    button: 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-600/30',
                    activeTab: 'text-red-700',
                    tabBg: 'bg-red-50 border-red-100',
                    footer: 'text-red-300',
                    toggleBtn: 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                };
            case 'lunar_new_year': // 🏮 春节
                return {
                    ...base,
                    card: 'bg-[#FFF5F5]/95 backdrop-blur-xl border-2 border-red-200 shadow-2xl shadow-red-500/20',
                    title: 'text-red-900',
                    subtitle: 'text-orange-600',
                    input: 'bg-white border-red-200 text-red-900 placeholder-red-300 focus:border-orange-400 focus:ring-orange-100',
                    button: 'bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-600/30',
                    activeTab: 'text-red-700',
                    tabBg: 'bg-orange-50 border-red-100',
                    footer: 'text-red-300',
                    toggleBtn: 'bg-orange-50 border-orange-200 text-red-600 hover:bg-orange-100'
                };
            case 'halloween': // 🎃 万圣节
                return {
                    ...base,
                    card: 'bg-slate-900/90 backdrop-blur-xl border-2 border-purple-500/30 shadow-2xl shadow-purple-900/40',
                    title: 'text-orange-500',
                    subtitle: 'text-purple-400',
                    input: 'bg-slate-800 border-purple-900/50 text-orange-100 placeholder-purple-700 focus:border-orange-500 focus:ring-orange-900/20',
                    button: 'bg-gradient-to-r from-orange-600 to-purple-700 text-white shadow-lg shadow-purple-900/50',
                    activeTab: 'text-orange-500',
                    tabBg: 'bg-slate-950/50 border-purple-900/30',
                    footer: 'text-purple-600',
                    toggleBtn: 'bg-slate-800 border-purple-800 text-orange-500 hover:bg-slate-700'
                };
            case 'mid_autumn': // 🥮 中秋
                return {
                    ...base,
                    card: 'bg-[#0F172A]/90 backdrop-blur-xl border border-blue-400/30 shadow-2xl shadow-blue-900/40',
                    title: 'text-yellow-100',
                    subtitle: 'text-blue-300',
                    input: 'bg-slate-800 border-blue-800 text-blue-100 placeholder-blue-600 focus:border-yellow-200 focus:ring-yellow-900/20',
                    button: 'bg-gradient-to-r from-blue-700 to-indigo-600 text-white border border-blue-400/20 shadow-lg shadow-blue-500/20',
                    activeTab: 'text-yellow-200',
                    tabBg: 'bg-slate-900/50 border-blue-900/50',
                    footer: 'text-blue-700',
                    toggleBtn: 'bg-slate-800 border-blue-800 text-yellow-200 hover:bg-slate-700'
                };
            case 'dragon_boat': // 🛶 端午
                return {
                    ...base,
                    card: 'bg-[#F0FDF4]/95 backdrop-blur-xl border-2 border-emerald-100 shadow-2xl shadow-emerald-600/10',
                    title: 'text-teal-900',
                    subtitle: 'text-emerald-600',
                    input: 'bg-white border-emerald-100 text-teal-900 placeholder-emerald-300 focus:border-emerald-400 focus:ring-emerald-100',
                    button: 'bg-gradient-to-r from-teal-600 to-emerald-500 text-white shadow-lg shadow-emerald-600/20',
                    activeTab: 'text-teal-700',
                    tabBg: 'bg-teal-50 border-emerald-100',
                    footer: 'text-emerald-300',
                    toggleBtn: 'bg-emerald-50 border-emerald-200 text-teal-600 hover:bg-emerald-100'
                };
            default:
                return base;
        }
    };

    const styles = getThemeStyles();

    // --- 文本清洗 ---
    const getSafeText = (data, defaultText) => {
        if (!data) return defaultText;
        if (typeof data === 'string') return data;
        if (typeof data === 'object') return data.text || defaultText;
        return defaultText;
    };

    const showRegistrationError = (message, field) => {
        setRegError(message);
        setRegErrorField(field || inferLoginErrorField(message));
    };

    const showForgotError = (message, field) => {
        setForgotError(message);
        setForgotErrorField(field || inferLoginErrorField(message, 'email'));
    };

    // --- 登录逻辑 ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        const normalizedUsername = username.trim();
        const normalizedEmail = codeEmail.trim();
        const isCodeLogin = loginMethod === 'code';

        setAccountError(null);
        setCodeEmailError(null);
        setError(null);
        setCodeError(null);
        setShake(false);

        if (!isCodeLogin && !normalizedUsername) {
            setAccountError('请输入用户名或邮箱');
            setShake(true);
            window.setTimeout(() => setShake(false), 500);
            return;
        }
        if (!isCodeLogin && !password) {
            setError('请输入密码');
            setShake(true);
            window.setTimeout(() => setShake(false), 500);
            return;
        }
        if (isCodeLogin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            setCodeEmailError('请输入已绑定账号的有效邮箱');
            setShake(true);
            window.setTimeout(() => setShake(false), 500);
            return;
        }
        if (isCodeLogin && !/^\d{6}$/.test(verificationCode)) {
            setCodeError('请输入 6 位验证码');
            setShake(true);
            window.setTimeout(() => setShake(false), 500);
            return;
        }

        setLoading(true);
        try {
            const data = await api.post(
                isCodeLogin ? '/auth/verification-code/login' : '/auth/login',
                isCodeLogin
                    ? { account: normalizedEmail, code: verificationCode }
                    : { username: normalizedUsername, password }
            );
            onLogin(data.user, data.token);
        } catch (err) {
            if (loginMethod === 'code') setCodeError(err.message);
            else setError(err.message);
            setShake(true);
            setTimeout(() => setShake(false), 500);
        } finally {
            setLoading(false);
        }
    };

    const handleSendVerificationCode = async () => {
        const normalizedEmail = codeEmail.trim();
        setCodeEmailError(null);
        setCodeError(null);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            setCodeEmailError('请输入已绑定账号的有效邮箱');
            setShake(true);
            window.setTimeout(() => setShake(false), 500);
            return;
        }
        setCodeSending(true);
        try {
            const data = await api.post('/auth/verification-code/request', { account: normalizedEmail });
            setCodeWasRequested(true);
            setCodeCountdown(Number(data.retryAfter) || 60);
        } catch (requestError) {
            setCodeEmailError(requestError.message);
        } finally {
            setCodeSending(false);
        }
    };

    const clearLoginError = () => {
        if (accountError) setAccountError(null);
        if (error) setError(null);
        if (shake) setShake(false);
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setRegError(null);
        if (regUsername.trim().length < 2) return showRegistrationError('至少输入 2 位', 'username');
        if ((initialized || regEmail.trim()) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) return showRegistrationError('邮箱格式有误', 'email');
        if (initialized && !/^\d{6}$/.test(regCode)) return showRegistrationError('请输入有效的 6 位邮箱验证码', 'code');
        if (regPassword.length < 6 || regPassword.length > 128) return showRegistrationError('密码长度需为 6–128 位', 'password');
        if (regPassword !== regConfirm) return showRegistrationError('两次密码不一致', 'confirm');
        setRegLoading(true);
        try {
            await api.post('/auth/register', {
                username: regUsername,
                email: regEmail,
                password: regPassword,
                code: regCode,
                ...(!initialized ? { bootstrapSecret: regBootstrapSecret } : {})
            });
            setUsername(regUsername);
            setPassword("");
            setRegSuccess(true);
        } catch (err) { showRegistrationError(err.message); } finally { setRegLoading(false); }
    };

    const handleSendRegistrationCode = async () => {
        setRegError(null);
        if (regUsername.trim().length < 2) return showRegistrationError('至少输入 2 位', 'username');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) return showRegistrationError('邮箱格式有误', 'email');
        setRegCodeSending(true);
        try {
            const data = await api.post('/auth/register/verification-code/request', { username: regUsername, email: regEmail });
            setRegCodeCountdown(Number(data.retryAfter) || 60);
        } catch (requestError) {
            showRegistrationError(requestError.message);
        } finally {
            setRegCodeSending(false);
        }
    };

    const handleSendPasswordResetCode = async () => {
        const normalizedEmail = forgotEmail.trim().toLowerCase();
        setForgotError(null);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            showForgotError('请输入账号绑定的有效邮箱', 'email');
            return;
        }
        setForgotCodeSending(true);
        try {
            const data = await api.post('/auth/password-reset/verification-code/request', { email: normalizedEmail });
            setForgotCodeWasRequested(true);
            setForgotCodeCountdown(Number(data.retryAfter) || 60);
        } catch (requestError) {
            showForgotError(requestError.message);
        } finally {
            setForgotCodeSending(false);
        }
    };

    const handlePasswordReset = async event => {
        event.preventDefault();
        const normalizedEmail = forgotEmail.trim().toLowerCase();
        setForgotError(null);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return showForgotError('请输入账号绑定的有效邮箱', 'email');
        }
        if (!/^\d{6}$/.test(forgotCode)) {
            return showForgotError('请输入 6 位邮箱验证码', 'code');
        }
        if (forgotPassword.length < 6 || forgotPassword.length > 128) {
            return showForgotError('新密码长度需为 6–128 位', 'password');
        }
        if (forgotPassword !== forgotConfirm) {
            return showForgotError('两次输入的新密码不一致', 'confirm');
        }

        setForgotLoading(true);
        try {
            await api.post('/auth/password-reset/confirm', {
                email: normalizedEmail,
                code: forgotCode,
                password: forgotPassword
            });
            setUsername(normalizedEmail);
            setPassword("");
            setLoginMethod('password');
            setForgotSuccess(true);
        } catch (requestError) {
            showForgotError(requestError.message);
        } finally {
            setForgotLoading(false);
        }
    };

    const openForgotModal = () => {
        const suggestedEmail = codeEmail.trim() || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim()) ? username.trim() : '');
        if (suggestedEmail) setForgotEmail(suggestedEmail);
        setForgotError(null);
        setForgotErrorField('form');
        setForgotSuccess(false);
        setActiveModal('forgot');
    };

    const openRegisterModal = () => {
        setRegError(null);
        setRegErrorField('form');
        setRegSuccess(false);
        setRegCode("");
        setActiveModal('register');
    };

    const closeModal = () => {
        setActiveModal(null);
        setRegError(null);
        setRegErrorField('form');
        setRegSuccess(false);
        setForgotError(null);
        setForgotErrorField('form');
        setForgotSuccess(false);
    };

    const footerSizeClass = { small: 'text-[10px]', medium: 'text-xs', large: 'text-sm' }[config.footerSize || 'small'];
    const showFooter = ['all', 'login_only'].includes(config.footerVisibility || 'all');
    const alignClass = { left: 'items-start text-left', center: 'items-center text-center', right: 'items-end text-right' }[config.loginTextAlign || 'left'];
    const primaryAccountError = loginMethod === 'code' ? codeEmailError : accountError;

    // --- 节日专属装饰渲染 ---
    const renderDecorations = () => {
        if (immersiveMode === 'qingming') return (
            <>
                <div className="absolute -top-8 -right-4 z-20 animate-bounce" style={{ animationDuration: '6s' }}>
                    <div className="text-4xl filter drop-shadow-md opacity-80" style={{ transform: 'rotate(-10deg)' }}>🪁</div>
                </div>
                <div className="absolute -bottom-4 -left-4 z-20 animate-swing-natural" style={{ animationDuration: '5s' }}>
                    <CloudRain className="w-12 h-12 text-slate-400 opacity-60" />
                </div>
            </>
        );
        if (immersiveMode === 'yuanxiao') return (
            <>
                <div className="absolute -top-12 -right-4 z-20 animate-swing-natural" style={{ transformOrigin: 'top center', animationDuration: '4s' }}>
                    <div className="h-12 w-[1px] bg-pink-300 mx-auto"></div>
                    <div className="text-4xl filter drop-shadow-md">🏮</div>
                </div>
                {/* SVG 兔子灯代码保持不变 */}
            </>
        );
        if (immersiveMode === 'halloween') return (
            <>
                <div className="absolute -top-8 -right-4 z-20 animate-bounce" style={{ animationDuration: '4s' }}>
                    <div className="text-4xl filter drop-shadow-lg opacity-90">🕷️</div>
                </div>
                <div className="absolute -bottom-4 -left-4 z-20 text-4xl filter drop-shadow-md opacity-80 rotate-12">🎃</div>
            </>
        );
        if (immersiveMode === 'christmas') return (
            <>
                <div className="absolute -top-6 -right-6 z-20 animate-swing-natural" style={{ animationDuration: '3s' }}>
                    <div className="text-5xl filter drop-shadow-md">🔔</div>
                </div>
                <div className="absolute -bottom-2 -left-2 z-20 text-4xl filter drop-shadow-md rotate-[-10deg]">🎁</div>
            </>
        );
        if (immersiveMode === 'lunar_new_year') return (
            <>
                <div className="absolute -top-10 -right-4 z-20 animate-swing-natural" style={{ transformOrigin: 'top center', animationDuration: '5s' }}>
                    <div className="h-10 w-[1px] bg-red-300 mx-auto"></div>
                    <div className="text-4xl filter drop-shadow-md">🧧</div>
                </div>
                <div className="absolute -bottom-2 -left-2 z-20 text-4xl filter drop-shadow-md">🍊</div>
            </>
        );
        if (immersiveMode === 'mid_autumn') return (
            <>
                <div className="absolute -top-8 -right-8 w-24 h-24 z-0 opacity-20 bg-yellow-100 rounded-full blur-xl animate-pulse"></div>
                <div className="absolute -top-4 -right-4 z-20 text-4xl filter drop-shadow-[0_0_10px_rgba(255,255,200,0.5)]">🌕</div>
                <div className="absolute -bottom-2 -left-2 z-20 text-4xl filter drop-shadow-md opacity-80 -scale-x-100">🐇</div>
            </>
        );
        if (immersiveMode === 'dragon_boat') return (
            <>
                <div className="absolute -top-4 -right-4 z-20 animate-swing-natural" style={{ animationDuration: '3s' }}>
                    <div className="text-4xl filter drop-shadow-md">🫔</div>
                </div>
                <div className="absolute -bottom-2 -left-2 z-20 text-4xl filter drop-shadow-md rotate-12">🥁</div>
            </>
        );
        return null;
    };

    const text = (key, fallback) => getSafeText(config[key], fallback);
    const forgotText = (key, fallback) => {
        const value = text(key, fallback);
        if ((key === 'forgotSubtitle' || key === 'forgotInstruction') && value.includes('上级账号')) return fallback;
        if (key === 'forgotCloseText' && value === '我知道了') return fallback;
        return value;
    };
    const codeStatusText = codeError || (codeWasRequested
        ? text('loginCodeHint', '验证码将发送到账号绑定邮箱，10 分钟内有效。')
        : '');

    return (
        <div className={`login-portal relative z-50 flex min-h-screen w-full flex-col overflow-x-hidden px-4 pb-14 pt-24 sm:px-6 ${
            systemEffects.loginVisualFloat === false ? 'system-effects-no-login-visual-float' : ''
        }`}>
            <header className={`login-portal-header fixed inset-x-0 top-0 z-[70] ${
                isUnlocking ? 'login-portal-header-unlocking' : ''
            }`} onTransitionEnd={(event) => {
                if (
                    isUnlocking
                    && event.target === event.currentTarget
                    && event.propertyName === 'transform'
                ) onUnlockTransitionEnd?.();
            }} onTransitionCancel={(event) => {
                if (
                    isUnlocking
                    && event.target === event.currentTarget
                    && event.propertyName === 'transform'
                ) onUnlockTransitionEnd?.();
            }}>
                <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
                    <div className="login-navbar-brand flex min-w-0 items-center gap-3">
                        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-tr ${defaultTheme.gradient} text-lg font-black text-white shadow-lg ${defaultTheme.shadow}`}>
                            <BrandLogo
                                type={config.navbarLogoType || 'Trophy'}
                                url={config.navbarLogoUrl || ''}
                                className="h-6 w-6 text-white"
                                imageClassName="h-7 w-7 object-contain"
                            />
                        </div>
                        <span className={`truncate text-lg font-black tracking-tight ${styles.title}`}>
                            {text('loginBrandName', 'MarchCenter')}
                        </span>
                    </div>
                    <div className="login-navbar-login-actions flex shrink-0 items-center gap-2">
                        <CdnIndicator />
                        <button
                            type="button"
                            onClick={onThemeToggle}
                            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-all ${styles.toggleBtn}`}
                            title={`切换到${isDarkMode ? '日间' : '夜间'}模式`}
                        >
                            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex flex-1 items-center justify-center py-6">
                <div className={`login-auth-card glass-motion-surface w-full rounded-3xl transition-all duration-500 ${styles.card} ${
                    wallpaperActive ? 'login-wallpaper-glass' : ''
                } ${isUnlocking ? 'login-auth-card-unlocking' : ''}`}>
                    <div className="login-horizontal-visual" aria-hidden="true">
                        <div className="login-visual-orbit login-visual-orbit-one"></div>
                        <div className="login-visual-orbit login-visual-orbit-two"></div>
                        <div className="login-visual-stage">
                            <div className="login-visual-bridge"></div>
                            <div className="login-visual-card login-visual-card-left">
                                <span>01</span><i></i><i></i>
                            </div>
                            <div className="login-visual-trophy">
                                {(config.loginVisualCenterType === 'image' && config.loginVisualCenterImageUrl) ? (
                                    <img src={config.loginVisualCenterImageUrl} alt="" />
                                ) : (
                                    <span>{config.loginVisualCenterValue || '🏆'}</span>
                                )}
                            </div>
                            <div className="login-visual-card login-visual-card-right">
                                <span>02</span><i></i><i></i>
                            </div>
                        </div>
                        <div className="login-visual-copy">
                            <strong>{text('loginVisualTitle', '连接每一场竞赛')}</strong>
                            <span>{text('loginVisualSubtitle', '统一管理竞赛入口、账号与训练进度，让每一次出发都更简单。')}</span>
                        </div>
                    </div>

                    <div className="login-form-panel">
                        {renderDecorations()}
                        <div className={`login-form-header relative z-10 mb-7 flex flex-col ${alignClass}`}>
                            <h1 className={`text-2xl font-black tracking-tight ${styles.title}`}>
                                {text('loginWelcomeTitle', '欢迎回来')}
                            </h1>
                            <p className={`mt-1.5 text-xs font-medium ${styles.subtitle}`}>
                                {text('loginWelcomeSubtitle', '请输入您的 MarchCenter 账号凭证')}
                            </p>
                        </div>

                        <div className="login-method-tabs relative z-10 mb-5 flex border-b border-slate-200/80 dark:border-slate-700/80">
                            <button
                                type="button"
                                onClick={() => {
                                    setLoginMethod('password');
                                    setCodeEmailError(null);
                                    setCodeError(null);
                                    clearLoginError();
                                }}
                                className={`mr-6 border-b-2 px-1 pb-2.5 text-xs font-black transition-colors ${
                                    loginMethod === 'password'
                                        ? `border-current ${styles.activeTab}`
                                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                }`}
                            >
                                {text('loginPasswordTabText', '密码登录')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setLoginMethod('code');
                                    setAccountError(null);
                                    setError(null);
                                    setShake(false);
                                }}
                                className={`border-b-2 px-1 pb-2.5 text-xs font-black transition-colors ${
                                    loginMethod === 'code'
                                        ? `border-current ${styles.activeTab}`
                                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                }`}
                            >
                                {text('loginCodeTabText', '免密验证码登录')}
                                {verificationCodeEnabled === false && <span className="ml-1 text-[9px] font-bold opacity-60">待配置</span>}
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="login-auth-form relative z-10">
                            <div className="login-auth-field">
                                <label className={`mb-1.5 block text-xs font-bold ${styles.subtitle}`}>
                                    {loginMethod === 'code'
                                        ? text('loginCodeAccountLabel', '电子邮箱')
                                        : text('loginUsernameLabel', '用户名')}
                                </label>
                                <div className={`relative ${primaryAccountError && shake ? 'animate-shake' : ''}`}>
                                    {loginMethod === 'code'
                                        ? <Mail className={`absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 ${primaryAccountError ? 'text-red-500' : `${styles.subtitle.split(' ')[0]} opacity-55`}`} />
                                        : <User className={`absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 ${primaryAccountError ? 'text-red-500' : `${styles.subtitle.split(' ')[0]} opacity-55`}`} />}
                                    <input
                                        id="login-username"
                                        type={loginMethod === 'code' ? 'email' : 'text'}
                                        autoComplete={loginMethod === 'code' ? 'email' : 'username'}
                                        aria-invalid={Boolean(primaryAccountError)}
                                        aria-describedby={primaryAccountError ? 'login-account-error' : undefined}
                                        className={`account-api-input pl-10 transition-all ${styles.input} ${
                                            primaryAccountError
                                                ? 'pr-36 !border-red-400 !bg-red-50/85 !ring-4 !ring-red-100/80 dark:!border-red-500 dark:!bg-red-950/30 dark:!ring-red-900/30'
                                                : ''
                                        }`}
                                        placeholder={loginMethod === 'code'
                                            ? text('loginCodeAccountPlaceholder', '请输入已绑定邮箱')
                                            : text('loginUsernamePlaceholder', '请输入用户名')}
                                        value={loginMethod === 'code' ? codeEmail : username}
                                        onChange={event => {
                                            if (loginMethod === 'code') {
                                                setCodeEmail(event.target.value);
                                                setCodeEmailError(null);
                                            } else {
                                                setUsername(event.target.value);
                                                setAccountError(null);
                                            }
                                            clearLoginError();
                                            setCodeError(null);
                                        }}
                                    />
                                    {primaryAccountError && (
                                        <span
                                            id="login-account-error"
                                            role="alert"
                                            title={primaryAccountError}
                                            className="absolute right-3 top-1/2 flex max-w-[48%] -translate-y-1/2 items-center gap-1 truncate rounded-md bg-red-100/95 px-2 py-1 text-[10px] font-bold text-red-600 dark:bg-red-950/90 dark:text-red-300"
                                        >
                                            <Ban className="h-3.5 w-3.5 shrink-0" />
                                            <span className="truncate">{primaryAccountError}</span>
                                        </span>
                                    )}
                                </div>
                            </div>

                            {loginMethod === 'password' ? (
                                <div className="login-auth-field login-password-field">
                                        <div className={`login-password-field-input relative ${shake ? 'animate-shake' : ''}`}>
                                            <Lock className={`absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 ${
                                                error ? 'text-red-500' : `${styles.subtitle.split(' ')[0]} opacity-55`
                                            }`} />
                                            <input
                                                id="login-password"
                                                type={showPassword ? 'text' : 'password'}
                                                autoComplete="current-password"
                                                aria-invalid={Boolean(error)}
                                                aria-describedby={error ? 'login-password-error' : undefined}
                                                className={`account-api-input pl-10 transition-all ${styles.input} ${
                                                    error
                                                        ? 'pr-36 !border-red-400 !bg-red-50/85 !ring-4 !ring-red-100/80 dark:!border-red-500 dark:!bg-red-950/30 dark:!ring-red-900/30'
                                                        : 'pr-11'
                                                }`}
                                                placeholder={text('loginPasswordPlaceholder', '请输入密码')}
                                                value={password}
                                                onChange={event => {
                                                    setPassword(event.target.value);
                                                    clearLoginError();
                                                }}
                                            />
                                            {error ? (
                                                <span
                                                    id="login-password-error"
                                                    role="alert"
                                                    title={error}
                                                    className="absolute right-3 top-1/2 flex max-w-[48%] -translate-y-1/2 items-center gap-1 truncate rounded-md bg-red-100/95 px-2 py-1 text-[10px] font-bold text-red-600 dark:bg-red-950/90 dark:text-red-300"
                                                >
                                                    <Ban className="h-3.5 w-3.5 shrink-0" />
                                                    <span className="truncate">{error}</span>
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    onClick={() => setShowPassword(value => !value)}
                                                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                                                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                                                >
                                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            )}
                                        </div>
                                    <div className="login-password-field-header">
                                            <label htmlFor="login-password" className={`text-xs font-bold ${styles.subtitle}`}>
                                                {text('loginPasswordLabel', '密码')}
                                            </label>
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => {
                                                    setError(null);
                                                    openForgotModal();
                                                }}
                                                onKeyDown={event => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        setError(null);
                                                        openForgotModal();
                                                    }
                                                }}
                                                style={{ background: 'transparent', border: 'none' }}
                                                className={`login-text-button text-[11px] font-bold hover:underline ${styles.activeTab}`}
                                            >
                                                {text('loginForgotText', '忘记密码？')}
                                            </span>
                                        </div>
                                </div>
                            ) : (
                                <div className="login-auth-field login-code-field">
                                        <div className="login-code-field-header">
                                            <label className={`shrink-0 text-xs font-bold ${styles.subtitle}`}>
                                                {text('loginCodeLabel', '邮箱动态验证码')}
                                            </label>
                                            {codeStatusText && (
                                                <span
                                                    id="login-code-status"
                                                    role={codeError ? 'alert' : 'status'}
                                                    title={codeStatusText}
                                                    className={`h-4 min-w-0 max-w-[72%] truncate rounded-full px-2 text-[9px] font-bold leading-4 ${
                                                        codeError
                                                            ? 'bg-red-100/90 text-red-600 dark:bg-red-950/70 dark:text-red-300'
                                                            : 'bg-slate-100/80 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400'
                                                    }`}
                                                >
                                                    {codeStatusText}
                                                </span>
                                            )}
                                        </div>
                                        <div className={`login-code-field-input flex gap-2 ${codeError && shake ? 'animate-shake' : ''}`}>
                                            <div className="relative min-w-0 flex-1">
                                                <input
                                                    inputMode="numeric"
                                                    autoComplete="one-time-code"
                                                    maxLength={6}
                                                    aria-invalid={Boolean(codeError)}
                                                    aria-describedby={codeStatusText ? 'login-code-status' : undefined}
                                                    className={`account-api-input tracking-[.28em] ${styles.input} ${
                                                        codeError ? '!border-red-400 !ring-4 !ring-red-100/80 dark:!border-red-500 dark:!ring-red-900/30' : ''
                                                    }`}
                                                    placeholder="6 位验证码"
                                                    value={verificationCode}
                                                    onChange={event => {
                                                        setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                                                        setCodeError(null);
                                                    }}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                disabled={codeSending || codeCountdown > 0}
                                                onClick={handleSendVerificationCode}
                                                className="min-w-[104px] rounded-xl border border-slate-200 bg-white/70 px-3 text-[11px] font-black text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300"
                                            >
                                                {codeSending ? '发送中...' : codeCountdown > 0 ? `${codeCountdown}s 后重发` : text('loginCodeSendText', '获取验证码')}
                                            </button>
                                        </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className={`login-auth-submit flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-black transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 ${styles.button}`}
                            >
                                {loading ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" />{text('loginLoadingText', '正在安全校验...')}</>
                                ) : (
                                    <>
                                        {loginMethod === 'code'
                                            ? text('loginCodeSubmitText', '验证码登录')
                                            : text('loginSubmitText', '登录')}
                                        <ArrowRight className="h-3.5 w-3.5" />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className={`relative z-10 mt-3 text-center text-xs ${styles.subtitle}`}>
                            {text('loginRegisterLead', '还没有账号？')}
                            <button
                                type="button"
                                onClick={openRegisterModal}
                                className={`ml-1 font-bold hover:underline ${styles.activeTab}`}
                            >
                                {text('loginRegisterText', '立即注册')}
                            </button>
                        </div>

                        <div className={`relative z-10 mt-5 flex items-center gap-1.5 border-t border-slate-200/70 pt-3 text-[10px] font-semibold dark:border-slate-700/70 ${styles.subtitle}`}>
                            <ShieldCheck className={`h-3.5 w-3.5 ${styles.activeTab}`} />
                            <span>{text('loginSecurityText', '256-bit TLS 端到端加密校验')}</span>
                        </div>
                    </div>
                </div>
            </main>

            {showFooter && (
                <footer className={`text-center font-bold opacity-80 ${footerSizeClass} ${styles.footer}`}>
                    {text('footerText', '© 2026 MarchCenter. All rights reserved.')}
                </footer>
            )}

            {activeModal && (
                <div
                    className="login-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center px-4"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) closeModal();
                    }}
                >
                    <section
                        ref={modalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={`${activeModal}-modal-title`}
                        className={`login-modal-card relative w-full max-w-md rounded-2xl p-6 ${styles.card}`}
                    >
                        <button
                            type="button"
                            onClick={closeModal}
                            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            aria-label="关闭弹窗"
                        >
                            <X className="h-4 w-4" />
                        </button>

                        {activeModal === 'forgot' && (
                            forgotSuccess ? (
                                <div className="py-3 text-center">
                                    <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                                    <h2 id="forgot-modal-title" className={`mt-4 text-lg font-black ${styles.title}`}>密码重置成功</h2>
                                    <p className={`mt-2 text-xs leading-5 ${styles.subtitle}`}>绑定邮箱已填入登录表单，请使用新密码登录。</p>
                                    <button type="button" onClick={closeModal} className={`mt-6 w-full rounded-xl py-3 text-xs font-black ${styles.button}`}>
                                        返回登录
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <div className="mb-4 pr-8">
                                        <div className={`mb-3 grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50 ${styles.activeTab}`}>
                                            <Lock className="h-5 w-5" />
                                        </div>
                                        <h2 id="forgot-modal-title" className={`text-lg font-black ${styles.title}`}>
                                            {text('forgotTitle', '重置您的访问密码')}
                                        </h2>
                                        <p className={`mt-1.5 text-xs leading-5 ${styles.subtitle}`}>
                                            {forgotText('forgotSubtitle', '通过账号绑定邮箱验证身份并设置新密码。')}
                                        </p>
                                    </div>
                                    <form onSubmit={handlePasswordReset} className="space-y-3">
                                        <div>
                                            <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>绑定邮箱</label>
                                            <div className="relative">
                                                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                 <input
                                                     type="email"
                                                     autoComplete="email"
                                                     aria-invalid={forgotErrorField === 'email'}
                                                     aria-describedby={forgotErrorField === 'email' ? 'forgot-email-error' : undefined}
                                                     className={`account-api-input !pl-10 ${forgotErrorField === 'email' ? '!pr-44 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`}
                                                     value={forgotEmail}
                                                     onChange={event => {
                                                         setForgotEmail(event.target.value);
                                                         if (forgotErrorField === 'email') { setForgotError(null); setForgotErrorField('form'); }
                                                     }}
                                                    placeholder="user@example.com"
                                                     required
                                                 />
                                                 <LoginFieldError id="forgot-email-error" message={forgotErrorField === 'email' ? forgotError : ''} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>邮箱验证码</label>
                                            <div className="flex gap-2">
                                                <div className="relative min-w-0 flex-1">
                                                    <input
                                                        inputMode="numeric"
                                                        autoComplete="one-time-code"
                                                        maxLength={6}
                                                        aria-invalid={forgotErrorField === 'code'}
                                                        aria-describedby={forgotErrorField === 'code' ? 'forgot-code-error' : undefined}
                                                        className={`account-api-input w-full tracking-[.22em] ${forgotErrorField === 'code' ? '!pr-40 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`}
                                                        value={forgotCode}
                                                        onChange={event => {
                                                            setForgotCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                                                            if (forgotErrorField === 'code') { setForgotError(null); setForgotErrorField('form'); }
                                                        }}
                                                        placeholder="6 位验证码"
                                                        required
                                                    />
                                                    <LoginFieldError id="forgot-code-error" message={forgotErrorField === 'code' ? forgotError : ''} />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleSendPasswordResetCode}
                                                    disabled={forgotCodeSending || forgotCodeCountdown > 0 || passwordResetEnabled !== true}
                                                    className="min-w-[112px] rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-black text-indigo-600 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
                                                >
                                                    {forgotCodeSending ? '发送中...' : forgotCodeCountdown > 0 ? `${forgotCodeCountdown} 秒后重发` : '获取验证码'}
                                                </button>
                                            </div>
                                            {forgotCodeWasRequested && (
                                                <p className={`mt-1.5 text-[10px] ${styles.subtitle}`}>
                                                    {forgotText('forgotInstruction', '验证码将在 10 分钟内有效。')}
                                                </p>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div>
                                                <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>新密码</label>
                                                <div className="relative">
                                                    <input type="password" autoComplete="new-password" aria-invalid={forgotErrorField === 'password'} aria-describedby={forgotErrorField === 'password' ? 'forgot-password-error' : undefined} className={`account-api-input ${forgotErrorField === 'password' ? '!pr-44 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`} value={forgotPassword} onChange={event => { setForgotPassword(event.target.value); if (forgotErrorField === 'password') { setForgotError(null); setForgotErrorField('form'); } }} placeholder="6–128 位" required />
                                                    <LoginFieldError id="forgot-password-error" message={forgotErrorField === 'password' ? forgotError : ''} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>确认新密码</label>
                                                <div className="relative">
                                                    <input type="password" autoComplete="new-password" aria-invalid={forgotErrorField === 'confirm'} aria-describedby={forgotErrorField === 'confirm' ? 'forgot-confirm-error' : undefined} className={`account-api-input ${forgotErrorField === 'confirm' ? '!pr-44 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`} value={forgotConfirm} onChange={event => { setForgotConfirm(event.target.value); if (forgotErrorField === 'confirm') { setForgotError(null); setForgotErrorField('form'); } }} placeholder="再次输入" required />
                                                    <LoginFieldError id="forgot-confirm-error" message={forgotErrorField === 'confirm' ? forgotError : ''} />
                                                </div>
                                            </div>
                                        </div>
                                        {passwordResetEnabled === false && (
                                            <p className="text-[10px] text-amber-600 dark:text-amber-300">密码重置邮件服务尚未启用，请联系管理员。</p>
                                        )}
                                        <div className="h-4" aria-live="polite">
                                            {forgotError && forgotErrorField === 'form' && <span className="block truncate text-[10px] font-bold text-red-600 dark:text-red-300">{forgotError}</span>}
                                        </div>
                                        <button type="submit" disabled={forgotLoading || passwordResetEnabled !== true} className={`flex w-full items-center justify-center rounded-xl py-3 text-xs font-black disabled:opacity-50 ${styles.button}`}>
                                            {forgotLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在重置...</> : forgotText('forgotCloseText', '重置密码')}
                                        </button>
                                    </form>
                                </div>
                            )
                        )}

                        {activeModal === 'register' && (
                            regSuccess ? (
                                <div className="py-3 text-center">
                                    <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                                    <h2 id="register-modal-title" className={`mt-4 text-lg font-black ${styles.title}`}>
                                        {text('registerSuccessTitle', '账号创建成功')}
                                    </h2>
                                    <p className={`mt-2 text-xs ${styles.subtitle}`}>
                                        {text('registerSuccessSubtitle', '账号已填入登录表单，请使用刚设置的密码登录。')}
                                    </p>
                                    <button type="button" onClick={closeModal} className={`mt-6 w-full rounded-xl py-3 text-xs font-black ${styles.button}`}>
                                        返回登录
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <div className="mb-4 pr-8">
                                        <h2 id="register-modal-title" className={`text-lg font-black ${styles.title}`}>
                                            {text('registerTitle', '创建 MarchCenter 账号')}
                                        </h2>
                                        <p className={`mt-1.5 text-xs ${styles.subtitle}`}>
                                            {text('registerSubtitle', '填写以下信息完成新用户注册')}
                                        </p>
                                    </div>
                                    <form onSubmit={handleRegister} className="space-y-3">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div>
                                                <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>用户名</label>
                                                <div className="relative">
                                                    <input aria-invalid={regErrorField === 'username'} aria-describedby={regErrorField === 'username' ? 'register-username-error' : undefined} className={`account-api-input ${regErrorField === 'username' ? '!pr-40 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`} required value={regUsername} onChange={event => { setRegUsername(event.target.value); if (regErrorField === 'username') { setRegError(null); setRegErrorField('form'); } }} placeholder="yourname" />
                                                    <LoginFieldError id="register-username-error" message={regErrorField === 'username' ? regError : ''} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>电子邮箱</label>
                                                <div className="relative">
                                                    <input type="email" aria-invalid={regErrorField === 'email'} aria-describedby={regErrorField === 'email' ? 'register-email-error' : undefined} className={`account-api-input ${regErrorField === 'email' ? '!pr-40 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`} value={regEmail} onChange={event => { setRegEmail(event.target.value); if (regErrorField === 'email') { setRegError(null); setRegErrorField('form'); } }} placeholder="user@example.com" />
                                                    <LoginFieldError id="register-email-error" message={regErrorField === 'email' ? regError : ''} />
                                                </div>
                                            </div>
                                        </div>
                                        {initialized && (
                                            <div>
                                                <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>邮箱验证码</label>
                                                <div className="flex gap-2">
                                                    <div className="relative min-w-0 flex-1">
                                                        <input
                                                            inputMode="numeric"
                                                            maxLength={6}
                                                            aria-invalid={regErrorField === 'code'}
                                                            aria-describedby={regErrorField === 'code' ? 'register-code-error' : undefined}
                                                            className={`account-api-input w-full ${regErrorField === 'code' ? '!pr-40 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`}
                                                            required
                                                            value={regCode}
                                                            onChange={event => { setRegCode(event.target.value.replace(/\D/g, '').slice(0, 6)); if (regErrorField === 'code') { setRegError(null); setRegErrorField('form'); } }}
                                                            placeholder="6 位验证码"
                                                        />
                                                        <LoginFieldError id="register-code-error" message={regErrorField === 'code' ? regError : ''} />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={handleSendRegistrationCode}
                                                        disabled={regCodeSending || regCodeCountdown > 0 || registrationEnabled !== true}
                                                        className="min-w-[112px] rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-black text-indigo-600 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
                                                    >
                                                        {regCodeSending ? '发送中...' : regCodeCountdown > 0 ? `${regCodeCountdown} 秒后重发` : '获取验证码'}
                                                    </button>
                                                </div>
                                                {registrationEnabled === false && (
                                                    <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-300">注册邮件服务尚未启用，请联系管理员。</p>
                                                )}
                                            </div>
                                        )}
                                        {initialized === false && (
                                            <div>
                                                <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>系统初始化密钥</label>
                                                <div className="relative">
                                                    <input
                                                        type={showBootstrapSecret ? 'text' : 'password'}
                                                        autoComplete="one-time-code"
                                                        className={`account-api-input pr-11 ${styles.input}`}
                                                        required
                                                        value={regBootstrapSecret}
                                                        onChange={event => setRegBootstrapSecret(event.target.value)}
                                                        placeholder="由部署管理员提供"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowBootstrapSecret(value => !value)}
                                                        aria-label={showBootstrapSecret ? '隐藏初始化密钥' : '显示初始化密钥'}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-indigo-600"
                                                    >
                                                        {showBootstrapSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                                <p className={`mt-1.5 text-[10px] ${bootstrapSecretConfigured === false ? 'text-amber-600' : styles.subtitle}`}>
                                                    {bootstrapSecretConfigured === false
                                                        ? '部署端尚未设置初始化密钥，当前无法创建首个管理员。'
                                                        : '仅首次创建超级管理员时使用，初始化完成后自动失效。'}
                                                </p>
                                            </div>
                                        )}
                                        <div>
                                            <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>设置访问密码</label>
                                            <div className="relative">
                                                <input type="password" aria-invalid={regErrorField === 'password'} aria-describedby={regErrorField === 'password' ? 'register-password-error' : undefined} className={`account-api-input ${regErrorField === 'password' ? '!pr-44 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`} required value={regPassword} onChange={event => { setRegPassword(event.target.value); if (regErrorField === 'password') { setRegError(null); setRegErrorField('form'); } }} placeholder="6–128 位" />
                                                <LoginFieldError id="register-password-error" message={regErrorField === 'password' ? regError : ''} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={`mb-1 block text-xs font-bold ${styles.subtitle}`}>确认密码</label>
                                            <div className="relative">
                                                <input type="password" aria-invalid={regErrorField === 'confirm'} aria-describedby={regErrorField === 'confirm' ? 'register-confirm-error' : undefined} className={`account-api-input ${regErrorField === 'confirm' ? '!pr-44 !border-red-400 !ring-4 !ring-red-100/80' : ''} ${styles.input}`} required value={regConfirm} onChange={event => { setRegConfirm(event.target.value); if (regErrorField === 'confirm') { setRegError(null); setRegErrorField('form'); } }} placeholder="再次输入密码" />
                                                <LoginFieldError id="register-confirm-error" message={regErrorField === 'confirm' ? regError : ''} />
                                            </div>
                                        </div>
                                        <div className="h-4" aria-live="polite">
                                            {regError && regErrorField === 'form' && <span className="block truncate text-[10px] font-bold text-red-600 dark:text-red-300">{regError}</span>}
                                        </div>
                                        <button type="submit" disabled={regLoading || (initialized && registrationEnabled !== true)} className={`flex w-full items-center justify-center rounded-xl py-3 text-xs font-black disabled:opacity-50 ${styles.button}`}>
                                            {regLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />注册中...</> : text('registerSubmitText', '立即注册')}
                                        </button>
                                    </form>
                                </div>
                            )
                        )}
                    </section>
                </div>
            )}

            <style>{`
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-5px); }
                    75% { transform: translateX(5px); }
                }
                .animate-shake { animation: shake .4s ease-in-out; }
            `}</style>
        </div>
    );
};

export default LoginPage;
