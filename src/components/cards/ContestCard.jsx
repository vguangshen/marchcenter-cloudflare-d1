import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import {
    Clock, Ban, Hourglass, CheckCircle2, Edit2, Trash2, Sparkles,
    CalendarX, Lock, UserPlus, RotateCcw, X,
    Trophy, Target, Zap, BookOpen, Cloud, GraduationCap, Gavel, UserRound, ExternalLink,
    KeyRound, Copy, ChevronDown, Loader2
} from 'lucide-react';
import { THEMES } from '../../constants/themes';
import { SYSTEM_ICONS } from '../../constants/icons';
import { confirmAction } from '../../utils/uiFeedback';
import { ConnectorLine, StepItem, STEP_HEIGHT, TOTAL_ITEM_HEIGHT } from './CompetitionLaunchProgress';
import ClassActionOverlay from './ClassActionOverlay';

const MANUAL_PANEL_TOP_OFFSET = 36;
const MANUAL_PANEL_FALLBACK_HEIGHT = 112;
const SIDE_PANEL_ROW_OFFSET = 270;
const MANUAL_COLUMN_TRANSITION_MS = 500;
const manualColumnSettleTimers = new WeakMap();

const getManualPanelOffset = (card) => {
    const panel = card.querySelector('.manual-login-panel');
    const measuredHeight = panel?.getBoundingClientRect().height;
    const panelHeight = Number.isFinite(measuredHeight) && measuredHeight > 0
        ? Math.ceil(measuredHeight)
        : MANUAL_PANEL_FALLBACK_HEIGHT;
    return MANUAL_PANEL_TOP_OFFSET + panelHeight;
};

const markManualColumnMoving = (card) => {
    card.classList.add('manual-column-moving');

    if (typeof window === 'undefined') return;

    const previousTimer = manualColumnSettleTimers.get(card);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);

    const settleTimer = window.setTimeout(() => {
        card.classList.remove('manual-column-moving');
        manualColumnSettleTimers.delete(card);
    }, MANUAL_COLUMN_TRANSITION_MS + 60);
    manualColumnSettleTimers.set(card, settleTimer);
};

/**
 * Keep the manual credential panel out of the grid's row sizing. A CSS grid
 * row would otherwise grow for every column when one card opens; instead,
 * only cards below an open card in the same visual column receive a relative
 * top offset. The whole competition grid is treated as one flow container so
 * categorized sections also move cards in later sections out of the way.
 * Measuring the rendered rectangles keeps this correct for flat, categorized,
 * and responsive layouts without duplicating breakpoint math in React.
 */
const updateManualPanelColumnOffsets = () => {
    if (typeof document === 'undefined') return;

    const flowCards = Array.from(document.querySelectorAll('.competition-flow-card'));
    // The flow-card wrapper itself is not transformed, so its rectangle remains
    // the layout position even while its category/card children are moving.
    // Calculate the complete next state first; resetting existing offsets to
    // zero before measuring created a visible 123px -> 0px -> 260px animation
    // when the credential content expanded.
    const nextOffsets = new Map(flowCards.map(card => [card, '0px']));
    const nextRowOffsets = new Map(flowCards.map(card => [card, '0px']));

    const byContainer = new Map();
    flowCards.forEach(card => {
        const container = card.closest('.competition-flow-grid');
        if (!container) return;
        const cards = byContainer.get(container) || [];
        cards.push(card);
        byContainer.set(container, cards);
    });

    byContainer.forEach(cards => {
        const entries = cards.map(card => ({
            card,
            open: card.dataset.manualPanelOpen === 'true',
            offset: card.dataset.manualPanelOpen === 'true' ? getManualPanelOffset(card) : 0,
            rect: card.getBoundingClientRect()
        }));

        entries.forEach(({ card, rect }) => {
            const openCardsAbove = entries.filter(candidate => (
                candidate.open
                && candidate.rect.top < rect.top - 2
                && Math.abs(candidate.rect.left - rect.left) < 4
            ));

            if (openCardsAbove.length > 0) {
                const nextOffset = `${Math.round(openCardsAbove.reduce((total, candidate) => total + candidate.offset, 0))}px`;
                nextOffsets.set(card, nextOffset);
            }
        });
    });

    const byRowContainer = new Map();
    flowCards.forEach(card => {
        const container = card.closest('.competition-flow-items');
        if (!container) return;
        const cards = byRowContainer.get(container) || [];
        cards.push(card);
        byRowContainer.set(container, cards);
    });

    byRowContainer.forEach(cards => {
        const entries = cards.map(card => {
            const rect = card.getBoundingClientRect();
            const currentOffset = Number.parseFloat(card.style.getPropertyValue('--side-panel-row-offset')) || 0;
            return {
                card,
                open: card.dataset.sidePanelOpen === 'true',
                layoutLeft: rect.left - currentOffset,
                layoutTop: rect.top
            };
        });

        entries.forEach(({ card, layoutLeft, layoutTop }) => {
            const openCardsToLeft = entries.filter(candidate => (
                candidate.open
                && candidate.layoutLeft < layoutLeft - 2
                && Math.abs(candidate.layoutTop - layoutTop) < 4
            ));
            if (openCardsToLeft.length > 0) {
                nextRowOffsets.set(card, `${openCardsToLeft.length * SIDE_PANEL_ROW_OFFSET}px`);
            }
        });
    });

    // Commit each changed offset once. During the existing transform transition,
    // disable only the moving card's live backdrop sample; the translucent
    // matte fill remains visible and the static blur returns after it settles.
    flowCards.forEach(card => {
        const currentOffset = card.style.getPropertyValue('--manual-column-offset').trim() || '0px';
        const nextOffset = nextOffsets.get(card) || '0px';
        if (currentOffset === nextOffset) return;

        markManualColumnMoving(card);
        card.style.setProperty('--manual-column-offset', nextOffset);
    });

    flowCards.forEach(card => {
        const currentOffset = card.style.getPropertyValue('--side-panel-row-offset').trim() || '0px';
        const nextOffset = nextRowOffsets.get(card) || '0px';
        if (currentOffset === nextOffset) return;

        markManualColumnMoving(card);
        card.style.setProperty('--side-panel-row-offset', nextOffset);
    });
};

// 🚀 ContestCard 主组件
const ContestCard = ({
    link, isAdmin, userRole, onEdit, onDelete, onAiGuide, overrideTime, onOpen, createPanel, setCreatePanel, immersiveMode,
    isCardEditMode, categoryArrangeEnabled = false, studentAccounts = [], expertTargets = [], onCreateStudent, isCreatingStudent, onDeleteStudent, deletingStudentKey,
    openingCompetitionKeys = new Set(), onLaunchPrepared, onRequestManualCredential, onOpenAdminEntry, aiGuideAvailable = false,
    onDeleteClass, onInitializeClass, onRepairAccountReadiness, onRestoreClass, onUnsupportedClassDelete, classActionKey = null
}) => {
    const theme = THEMES[link.color || 'blue'] || THEMES.blue;
    const cardSurfaceMode = link.color === 'transparent' ? 'transparent' : link.color === 'white' ? 'white' : 'tinted';
    const logoTheme = THEMES[link.logoBackground] || null;
    const hasWhiteLogoBackground = link.logoBackground === 'white';
    const [now, setNow] = useState(new Date());
    const [studentMenuOpen, setStudentMenuOpen] = useState(false);
    const [teacherMenuOpen, setTeacherMenuOpen] = useState(false);
    const [roleActionsHover, setRoleActionsHover] = useState(false);
    const [manualPanelOpen, setManualPanelOpen] = useState(false);
    const [manualCredential, setManualCredential] = useState(null);
    const [manualLoading, setManualLoading] = useState(false);
    const [manualError, setManualError] = useState('');
    const [copiedField, setCopiedField] = useState('');
    const [deleteArmed, setDeleteArmed] = useState(false);
    const [pressProgress, setPressProgress] = useState(0);
    const manualTriggerRef = useRef(null);
    const manualPanelRef = useRef(null);
    const cardRootRef = useRef(null);
    const longPressTimerRef = useRef(null);
    const copyFeedbackTimerRef = useRef(null);
    const deleteStageRef = useRef('idle'); // 'idle' | 'initiating' | 'in_progress'
    const cardBodyRef = useRef(null);
    const [cardDimensions, setCardDimensions] = useState({ width: 280, height: 230 });
    const isStudentUser = userRole === 'student' || userRole === 'user';
    const isClassRemoved = link.classRemoved === true || Number(link.classRemoved) === 1;
    const isTeacherOpening = openingCompetitionKeys.has(`${link.id}:teacher:`);
    const isStudentOpening = openingCompetitionKeys.has(`${link.id}:student:`);
    const isExpertOpening = Array.from(openingCompetitionKeys).some(key => (
        String(key).startsWith(`${link.id}:expert:`)
    ));
    const isAdminEntryOpening = openingCompetitionKeys.has(`${link.id}:admin-entry:`);
    const credentialPanelOpen = manualPanelOpen;

    const setManualPanelVisibility = useCallback((visible) => {
        setManualPanelOpen(visible);
        if (!visible) {
            setManualCredential(null);
            setManualError('');
            setCopiedField('');
            if (copyFeedbackTimerRef.current) {
                clearTimeout(copyFeedbackTimerRef.current);
                copyFeedbackTimerRef.current = null;
            }
        }
    }, []);

    useLayoutEffect(() => {
        const flowCard = cardRootRef.current?.closest('.competition-flow-card');
        if (!flowCard) return undefined;

        if (credentialPanelOpen) flowCard.dataset.manualPanelOpen = 'true';
        else delete flowCard.dataset.manualPanelOpen;

        const frame = window.requestAnimationFrame(updateManualPanelColumnOffsets);
        return () => window.cancelAnimationFrame(frame);
    }, [credentialPanelOpen, categoryArrangeEnabled]);

    useEffect(() => {
        if (!credentialPanelOpen || typeof window.ResizeObserver !== 'function') return undefined;
        const panel = manualPanelRef.current;
        if (!panel) return undefined;

        let frame = null;
        const scheduleOffsetUpdate = () => {
            if (frame !== null) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                frame = null;
                updateManualPanelColumnOffsets();
            });
        };
        const observer = new window.ResizeObserver(scheduleOffsetUpdate);
        observer.observe(panel);
        scheduleOffsetUpdate();

        return () => {
            observer.disconnect();
            if (frame !== null) window.cancelAnimationFrame(frame);
        };
    }, [credentialPanelOpen]);

    useEffect(() => {
        if (!credentialPanelOpen) return undefined;

        const handleResize = () => updateManualPanelColumnOffsets();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [credentialPanelOpen]);

    useEffect(() => {
        if (!credentialPanelOpen) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setManualPanelVisibility(false);
                setManualPanelVisibility(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [credentialPanelOpen, setManualPanelVisibility]);

    // 节日模式判断
    const isChristmas = immersiveMode === 'christmas';
    const isLunar = immersiveMode === 'lunar_new_year';
    const isHalloween = immersiveMode === 'halloween';
    const isMidAutumn = immersiveMode === 'mid_autumn';
    const isDragonBoat = immersiveMode === 'dragon_boat';
    const isYuanxiao = immersiveMode === 'yuanxiao';
    const isQingming = immersiveMode === 'qingming';

    useEffect(() => {
        const updateNow = () => setNow(new Date());
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') updateNow();
        }, 30000);
        document.addEventListener('visibilitychange', updateNow);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', updateNow);
        };
    }, []);

    useEffect(() => {
        return () => {
            if (longPressTimerRef.current) {
                clearInterval(longPressTimerRef.current);
            }
            if (copyFeedbackTimerRef.current) {
                clearTimeout(copyFeedbackTimerRef.current);
            }
        };
    }, []);

    // 自适应监控卡片真实的渲染物理宽高（避免由于 flex 容器拉伸/缩短引发的 hardcoded 像素溢出或裁剪问题）
    useEffect(() => {
        const updateDimensions = () => {
            if (cardBodyRef.current) {
                setCardDimensions({
                    width: cardBodyRef.current.offsetWidth || 280,
                    height: cardBodyRef.current.offsetHeight || 230
                });
            }
        };
        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    // 删除操作完成后自动关闭确认层（成功 → 虚影；失败 → 恢复原样），彻底避免 React 状态同步间隙引发的过早复位弹窗
    useEffect(() => {
        if (!deleteArmed) {
            deleteStageRef.current = 'idle';
            return;
        }
        const isDeleting = classActionKey === `remove:${link.id}`
            || classActionKey === `initialize:${link.id}`
            || classActionKey === `repair:${link.id}`;
        if (deleteStageRef.current === 'initiating') {
            if (isDeleting) {
                deleteStageRef.current = 'in_progress';
            }
        } else if (deleteStageRef.current === 'in_progress') {
            if (!isDeleting) {
                deleteStageRef.current = 'idle';
                setDeleteArmed(false);
            }
        } else if (isDeleting && deleteStageRef.current === 'idle') {
            deleteStageRef.current = 'in_progress';
        }
    }, [classActionKey, deleteArmed, link.id]);

    // 成功变为已删除状态时，自动确保退出编辑/等待浮层进入虚影展示
    useEffect(() => {
        if (isClassRemoved && deleteArmed) {
            setDeleteArmed(false);
            deleteStageRef.current = 'idle';
        }
    }, [isClassRemoved, deleteArmed]);

    const finalUnlockTime = overrideTime?.unlockTime ?? link.unlockTime;
    const finalLockTime = overrideTime?.lockTime ?? link.lockTime;
    const unlockDate = finalUnlockTime ? new Date(finalUnlockTime) : null;
    const lockDate = finalLockTime ? new Date(finalLockTime) : null;
    const isPending = unlockDate && now < unlockDate;
    const isEnded = lockDate && now > lockDate;
    const isLocked = isPending || isEnded;

    const handleRoleOpen = (e, loginRole, studentIndex = null) => {
        e.preventDefault();
        e.stopPropagation();
        if (isClassRemoved) {
            if (onRestoreClass) onRestoreClass(link);
            return;
        }
        if (isAdmin && isCardEditMode) return;
        if (isLocked && !isAdmin) return;
        if (onOpen) onOpen(link, loginRole, studentIndex);
    };

    const handleCreateStudent = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isCreatingStudent && onCreateStudent) onCreateStudent(link);
    };

    const handleDeleteStudent = (e, account) => {
        e.preventDefault();
        e.stopPropagation();
        if (onDeleteStudent) onDeleteStudent(link, account);
    };

    const handleIssueManualCredential = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!onRequestManualCredential || manualLoading) return;
        // A credential request is an explicit interaction. Keep the drawer
        // pinned while its content changes and after the parent link is updated.
        setManualPanelOpen(true);
        setManualLoading(true);
        setManualError('');
        if (manualCredential && !await confirmAction({
            title: '重置教师账号密码',
            message: '重置后旧密码会立即失效，确定继续吗？',
            confirmText: '重置'
        })) {
            setManualLoading(false);
            return;
        }
        try {
            const result = await onRequestManualCredential(link, { reset: true });
            setManualCredential(result);
            setManualPanelOpen(true);
        } catch (error) {
            setManualError(error.message || '提取登录信息失败');
            setManualPanelOpen(true);
        } finally {
            setManualLoading(false);
        }
    };

    const handleOpenManualPanel = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!onRequestManualCredential || manualLoading) return;
        setManualPanelVisibility(true);
        setManualError('');
        setManualLoading(true);
        try {
            const result = await onRequestManualCredential(link, { reset: false });
            setManualCredential(result);
        } catch (error) {
            setManualError(error.message || '读取登录信息失败');
        } finally {
            setManualLoading(false);
        }
    };

    const handleOpenAdminCredential = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setManualPanelVisibility(false);
        if (!onOpenAdminEntry || isAdminEntryOpening) return;
        await onOpenAdminEntry(link);
    };

    const handleToggleManualPanel = (event) => {
        if (!manualPanelOpen) {
            handleOpenManualPanel(event);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        setManualPanelVisibility(false);
    };

    const copyText = async (value, field) => {
        if (!value) return;
        if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
            await navigator.clipboard.writeText(value);
            setCopiedField(field);
        } catch {
            setCopiedField('复制失败');
        }
        copyFeedbackTimerRef.current = setTimeout(() => {
            setCopiedField('');
            copyFeedbackTimerRef.current = null;
        }, 1600);
    };

    const supportsRoleLogin = [
        'java', 'net', 'marketing', 'commerce',
        'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement', 'paasV2'
    ].includes(link.ssoMethod);
    const supportsStudentAccounts = [
        'java', 'net', 'marketing', 'commerce',
        'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement'
    ].includes(link.ssoMethod);
    const supportsExpertLogin = ['java', 'net'].includes(link.ssoMethod);
    const supportsClassDelete = !isStudentUser && !isClassRemoved && !isLocked && [
        'java', 'net', 'marketing', 'commerce',
        'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement'
    ].includes(link.ssoMethod);
    const canAttemptClassDelete = supportsClassDelete
        || (!isStudentUser && !isClassRemoved && !isLocked && link.ssoMethod === 'direct');
    // JAVA 平台长按删除进度条用蓝色，与 .NET/SOAP 的红色做区分。
    const isJavaDelete = link.ssoMethod === 'java';
    const deleteActionKey = `remove:${link.id}`;
    const initializeActionKey = `initialize:${link.id}`;
    const isDeletingClass = classActionKey === deleteActionKey;
    const isInitializingClass = classActionKey === initializeActionKey;
    const isRepairingAccount = classActionKey === `repair:${link.id}`;
    const isClassActionRunning = isDeletingClass || isInitializingClass || isRepairingAccount;
    const canInitializeClass = ['admin', 'super_admin'].includes(userRole)
        && link.ssoMethod === 'java';
    const canRepairAccountReadiness = !isStudentUser && [
        'java', 'net', 'marketing', 'commerce', 'managementAccounting',
        'crossBorderCommerce', 'enterpriseManagement'
    ].includes(link.ssoMethod);
    const hasReadyAccount = Boolean(link.teacherReady || link.studentReady
        || studentAccounts.some(account => Boolean(Number(account.platformReady))));
    const manualCredentialEnabled = link.manualCredentialEnabled === true
        || Number(link.manualCredentialEnabled) === 1;
    const adminEntryAvailable = Boolean(
        isAdmin
        && ['java', 'net'].includes(link.ssoMethod)
        && (link.adminEntryEnabled === true || Number(link.adminEntryEnabled) === 1)
        && link.hasAdminEntryPassword
        && onOpenAdminEntry
    );
    const adminEntryLabel = link.ssoMethod === 'java' ? 'Admin' : 'Root';
    const expertEntryAvailable = supportsExpertLogin && !isLocked && !isClassRemoved;

    useEffect(() => {
        if (!manualCredentialEnabled || !link.manualCredentialActive) setManualCredential(null);
    }, [manualCredentialEnabled, link.manualCredentialActive]);

    const formatTime = (date) => {
        if (!date) return "";
        const timeStr = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        return date.toDateString() === now.toDateString() ? `今天 ${timeStr}` : `${date.getMonth() + 1}月${date.getDate()}日`;
    };

    const renderIcon = () => {
        const iconClass = `w-7 h-7 drop-shadow-md ${hasWhiteLogoBackground ? 'text-slate-700' : 'text-white'}`;
        const iconStyle = hasWhiteLogoBackground ? { color: `rgb(${theme.rgb})` } : undefined;
        if (link.customIcon?.startsWith("sys:")) {
            const SystemIcon = SYSTEM_ICONS[link.customIcon.split(":")[1]]?.icon || Sparkles;
            return <SystemIcon className={iconClass} style={iconStyle} />;
        }
        if (link.customIcon?.startsWith("http") || link.customIcon?.startsWith("data:")) return <img src={link.customIcon} alt="icon" className="block h-full w-full object-contain p-1" />;
        switch (link.category) {
            case 'A类竞赛': return <Trophy className={iconClass} style={iconStyle} />;
            case 'B类竞赛': return <Target className={iconClass} style={iconStyle} />;
            case '实训平台': return <Zap className={iconClass} style={iconStyle} />;
            default: return <BookOpen className={iconClass} style={iconStyle} />;
        }
    };

    const renderStatus = () => {
        if (isClassRemoved) return <><RotateCcw className="w-3 h-3 mr-1 inline" /> 班级已从平台删除</>;
        if (isPending) return <><Clock className="w-3 h-3 mr-1" /> {formatTime(unlockDate)} 开启</>;
        if (isEnded) return <><Ban className="w-3 h-3 mr-1" /> 已结束</>;
        if (lockDate) {
            const diff = lockDate - now;
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            if (days === 0) return <span className="flex items-center animate-pulse font-bold text-orange-600"><Hourglass className="w-3 h-3 mr-1" /> 剩 {hours}h</span>;
            return <><Hourglass className="w-3 h-3 mr-1" /> 剩 {days}天 {hours}小时</>;
        }
        return <><CheckCircle2 className="w-3 h-3 mr-1" /> {link.statusText || "长期开放"}</>;
    };

    const startDeletePress = (event) => {
        if (!canAttemptClassDelete || deleteArmed) return;
        if (event.target.closest('button, a, input, select, textarea')) return;
        if (cardBodyRef.current) {
            setCardDimensions({
                width: cardBodyRef.current.offsetWidth || 280,
                height: cardBodyRef.current.offsetHeight || 230
            });
        }
        const started = Date.now();
        setPressProgress(0);
        longPressTimerRef.current = setInterval(() => {
            const progress = Math.min(100, ((Date.now() - started) / 650) * 100);
            setPressProgress(progress);
            if (progress >= 100) {
                clearInterval(longPressTimerRef.current);
                longPressTimerRef.current = null;
                if (supportsClassDelete) setDeleteArmed(true);
                else if (onUnsupportedClassDelete) onUnsupportedClassDelete(link);
            }
        }, 30);
    };

    const cancelDeletePress = () => {
        if (longPressTimerRef.current) {
            clearInterval(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        setPressProgress(0);
    };

    const handleDeleteClassClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // 设置状态为 initiating，防止状态更新回调之间的间隙致使弹窗被错误地立即销毁
        deleteStageRef.current = 'initiating';
        if (onDeleteClass) onDeleteClass(link);
    };

    const handleInitializeClassClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteStageRef.current = 'initiating';
        if (onInitializeClass) onInitializeClass(link);
    };

    const handleRepairAccountClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteStageRef.current = 'initiating';
        if (onRepairAccountReadiness) onRepairAccountReadiness(link);
    };

    const handleRestoreClass = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (onRestoreClass) onRestoreClass(link);
    };

    const isPanelVisible = createPanel?.visible && createPanel.linkId === link.id;
    const currentStep = createPanel?.step || 0;
    const isError = !!createPanel?.error;
    const isReady = Boolean(createPanel?.launchUrl) && !isError;

    useLayoutEffect(() => {
        const flowCard = cardRootRef.current?.closest('.competition-flow-card');
        if (!flowCard) return undefined;

        if (isPanelVisible) flowCard.dataset.sidePanelOpen = 'true';
        else delete flowCard.dataset.sidePanelOpen;

        const frame = window.requestAnimationFrame(updateManualPanelColumnOffsets);
        return () => window.cancelAnimationFrame(frame);
    }, [isPanelVisible, categoryArrangeEnabled]);

    useEffect(() => {
        if (!isPanelVisible) return undefined;
        const handleResize = () => updateManualPanelColumnOffsets();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isPanelVisible]);
    const activeIndex = Math.min(3, Math.max(0, currentStep - 1));
    // 以面板内容区的中心线为基准，而不是以步骤列表自身高度计算百分比。
    // 这样第一步出现时就在正中央，后续步骤沿同一中心点平滑接替。
    const translateY = `-${STEP_HEIGHT / 2 + activeIndex * TOTAL_ITEM_HEIGHT}px`;

    // 🌟 重新设计的“外围悬浮炫光轨道 (Outer Neon Orbit)”边框动画参数
    // 采用超出卡片 12px 的外部开放空间 (svgPad = 12)，在卡片外围悬浮 2px 处绘制 3.5px 粗的赛博风格高亮导轨与光脉冲
    const svgPad = 12;
    const outerGap = 2; // 悬浮于外部边框的间隙
    const strokeWidth = 3.5;
    const shift = outerGap + strokeWidth / 2; // 2 + 1.75 = 3.75px
    const rectX = svgPad - shift;
    const rectY = svgPad - shift;
    const rectW = (cardDimensions.width || 280) + 2 * shift;
    const rectH = (cardDimensions.height || 230) + 2 * shift;
    const rectRadius = 24 + shift; // 同心膨胀的外置圆角 27.75px (完美匹配卡片 rounded-3xl 的 24px 弧度)
    const perimeter = 2 * ((rectW - 2 * rectRadius) + (rectH - 2 * rectRadius)) + 2 * Math.PI * rectRadius;
    const strokeLength = (perimeter * pressProgress) / 100;

    return (
        <>
        <div
            ref={cardRootRef}
            className={`contest-card-shell group/card relative mx-auto h-[230px] w-[280px] shrink-0 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isPanelVisible || studentMenuOpen ? 'z-40' : 'z-0'} ${roleActionsHover ? 'contest-card-shell--role-actions-hover' : ''}`}
        >

            {/* ① 卡片主体 */}
            <div
                ref={cardBodyRef}
                style={{ '--contest-theme-rgb': theme.rgb }}
                className={`
                    contest-card relative group flex flex-col h-full rounded-3xl
                    ${isLocked && !isAdmin ? "grayscale-[0.5] opacity-80" : ""}
                    ${isClassRemoved ? "border-2 border-dashed border-slate-300/80 dark:border-slate-700/80 bg-slate-100/60 dark:bg-slate-900/60 shadow-none opacity-85" : ""}
                    ${deleteArmed ? `card-delete-armed ring-4 ${isJavaDelete ? 'ring-blue-400/80' : 'ring-red-400/80'} shadow-2xl scale-[1.02]` : ""}
                    ${pressProgress > 0 && !deleteArmed ? "scale-[0.98]" : ""}
                    z-10 transition-all duration-300
                    ${isChristmas ? 'overflow-visible bg-[#fdfbf7] shadow-xl shadow-red-900/10 border-2 border-red-50 dark:border-red-900/20' : ''}
                    ${isLunar ? 'overflow-visible bg-[#fffcf5] shadow-xl shadow-red-600/20 border-2 border-[#e6cba8]' : ''}
                    ${isHalloween ? 'overflow-visible bg-slate-900 shadow-xl shadow-purple-900/30 border-2 border-purple-900/50' : ''}
                    ${isMidAutumn ? 'overflow-visible bg-[#0F172A] shadow-xl shadow-blue-500/20 border-2 border-blue-400/30' : ''}
                    ${isDragonBoat ? 'overflow-visible bg-[#f0fdf4] shadow-xl shadow-emerald-500/10 border-2 border-emerald-100' : ''}
                    ${isYuanxiao ? 'overflow-visible bg-[#fff0f5] shadow-xl shadow-pink-500/10 border-2 border-pink-100' : ''}
                    ${isQingming ? 'overflow-visible bg-[#f8fafc] shadow-xl shadow-slate-400/20 border border-slate-300/60' : ''} // 🌧️ 清明：水墨灰白风格
                    ${!isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? `contest-card-glass contest-card-surface--${cardSurfaceMode} overflow-visible` : ''}
                `}
            >
                {/* 🎄 圣诞皮肤层 */}
                {isChristmas && (
                    <>
                        <div className="absolute -top-9 right-5 w-7 h-11 z-10">
                            <div className="w-full h-full rounded-sm border border-[#5d2e0d]/30 relative overflow-hidden shadow-sm" style={{ backgroundColor: '#8B4513', backgroundImage: `linear-gradient(335deg, #b9462a 23px, transparent 23px), linear-gradient(335deg, #a5381f 23px, transparent 23px), linear-gradient(155deg, #c7563a 23px, transparent 23px), linear-gradient(155deg, #96341c 23px, transparent 23px)`, backgroundSize: '58px 58px', backgroundPosition: '-10px -10px, -2px -2px, -10px -5px, -2px -13px' }}></div>
                            <div className="absolute -top-2 -left-1.5 -right-1.5 h-4 bg-white rounded-full shadow-sm filter drop-shadow-sm z-20"></div>
                            <Cloud className="absolute -top-5 left-0 text-white/70 w-4 h-4 animate-smoke" style={{animationDuration: '3s'}} />
                        </div>
                        <div className="absolute -top-[20px] -left-[4%] w-[108%] h-[35px] z-20 pointer-events-none" style={{ filter: 'drop-shadow(0px 4px 3px rgba(139, 69, 19, 0.12))' }}>
                            <svg viewBox="0 0 108 35" preserveAspectRatio="none" className="w-full h-full">
                                <path d="M0 35 C 2 25, 5 15, 25 15 Q 54 -5, 83 15 C 103 15, 106 25, 108 35 L 108 38 H 0 Z" fill="white" />
                                <path d="M0 35 C 10 38, 20 33, 30 35 C 40 37, 50 33, 60 35 C 70 37, 80 33, 90 35 C 100 33, 105 38, 108 35" fill="white" />
                            </svg>
                        </div>
                        <div className="absolute -top-1 left-4 text-xl z-30 animate-swing-natural" style={{animationDuration: '3s'}}>🔔</div>
                        <div className="absolute -top-0 right-10 text-xl z-30 animate-swing-natural" style={{animationDuration: '4s'}}>🧦</div>
                        <div className="absolute -bottom-1 -right-1 text-lg opacity-80 z-20">🎁</div>
                    </>
                )}

                {/* 🏮 农历新年皮肤层 */}
                {isLunar && (
                    <>
                        <div className="absolute -top-[28px] -left-[8%] w-[116%] h-[45px] z-20 pointer-events-none" style={{ filter: 'drop-shadow(0px 4px 4px rgba(180, 40, 40, 0.3))' }}>
                            <svg viewBox="0 0 116 45" preserveAspectRatio="none" className="w-full h-full">
                                <defs>
                                    <linearGradient id="roofTile" x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" style={{stopColor:'#e6b32e', stopOpacity:1}} />
                                        <stop offset="50%" style={{stopColor:'#d49a1f', stopOpacity:1}} />
                                        <stop offset="100%" style={{stopColor:'#b8860b', stopOpacity:1}} />
                                    </linearGradient>
                                </defs>
                                <path d="M0 45 C 5 25, 15 5, 35 10 L 81 10 C 101 5, 111 25, 116 45 L 116 48 L 0 48 Z" fill="url(#roofTile)" />
                                <path d="M35 10 L 81 10" stroke="#8B4513" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                        </div>
                        <div className="absolute -top-2 left-2 text-3xl z-30 animate-swing-natural filter drop-shadow-md" style={{animationDuration: '4s', transformOrigin: 'top center'}}>🏮</div>
                        <div className="absolute -top-3 right-4 text-2xl z-30 animate-swing-natural filter drop-shadow-md" style={{animationDuration: '5s', transformOrigin: 'top center'}}>🧧</div>
                        <div className="absolute -bottom-2 -right-1 text-xl z-20 opacity-90 filter drop-shadow-sm">🍊</div>
                    </>
                )}

                {/* 🎃 万圣节皮肤层 */}
                {isHalloween && (
                    <>
                        <div className="absolute -top-[30px] -left-[5%] w-[110%] h-[50px] z-20 pointer-events-none" style={{ filter: 'drop-shadow(0px 4px 5px rgba(0, 0, 0, 0.6))' }}>
                            <svg viewBox="0 0 110 50" preserveAspectRatio="none" className="w-full h-full">
                                <path d="M0 50 L 20 20 L 35 35 L 55 5 L 75 35 L 90 20 L 110 50 Z" fill="#2d3748" />
                                <path d="M55 5 L 55 50" stroke="#1a202c" strokeWidth="1" />
                            </svg>
                        </div>
                        <div className="absolute -top-1 left-4 text-2xl z-30 animate-swing-natural filter drop-shadow-md" style={{animationDuration: '3.5s'}}>👻</div>
                        <div className="absolute -top-2 right-6 text-xl z-30 animate-swing-natural filter drop-shadow-md" style={{animationDuration: '4.5s'}}>🦇</div>
                        <div className="absolute -bottom-1 -right-1 text-xl z-20 opacity-90">🎃</div>
                    </>
                )}

                {/* 🥮 中秋节皮肤层 */}
                {isMidAutumn && (
                    <>
                        <div className="absolute -top-8 -right-8 w-24 h-24 z-0 opacity-90 animate-pulse" style={{ animationDuration: '4s', filter: 'drop-shadow(0 0 15px rgba(255, 223, 100, 0.6))' }}>
                            <svg viewBox="0 0 100 100" className="w-full h-full fill-yellow-100">
                                <circle cx="50" cy="50" r="48" />
                                <circle cx="30" cy="40" r="8" fill="#FDE68A" opacity="0.6"/>
                                <circle cx="70" cy="60" r="12" fill="#FDE68A" opacity="0.5"/>
                                <circle cx="60" cy="25" r="5" fill="#FDE68A" opacity="0.7"/>
                            </svg>
                        </div>
                        <div className="absolute -top-6 left-2 text-3xl z-30 filter drop-shadow-lg" style={{ transform: 'scaleX(-1)' }}>🐇</div>
                        <div className="absolute bottom-0 w-full h-12 z-0 opacity-20 pointer-events-none overflow-hidden rounded-b-3xl">
                            <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-full fill-white">
                                <path d="M0 20 C 20 10, 30 15, 50 10 C 70 5, 80 15, 100 10 V 20 Z" />
                            </svg>
                        </div>
                    </>
                )}

                {/* 🛶 端午节皮肤层 */}
                {isDragonBoat && (
                    <>
                        <div className="absolute -top-[25px] -left-[5%] w-[110%] h-[40px] z-20 pointer-events-none" style={{ filter: 'drop-shadow(0px 4px 4px rgba(20, 80, 40, 0.2))' }}>
                            <svg viewBox="0 0 110 40" preserveAspectRatio="none" className="w-full h-full">
                                <path d="M0 40 Q 55 -10 110 40 L 110 45 L 0 45 Z" fill="#10B981" />
                                <path d="M55 5 L 55 40" stroke="#059669" strokeWidth="2" />
                                <path d="M25 15 L 25 40" stroke="#059669" strokeWidth="1" opacity="0.5"/>
                                <path d="M85 15 L 85 40" stroke="#059669" strokeWidth="1" opacity="0.5"/>
                            </svg>
                        </div>
                        <div className="absolute -top-1 left-6 text-2xl z-30 animate-swing-natural filter drop-shadow-md" style={{animationDuration: '3s'}}>🫔</div>
                        <div className="absolute -top-1 right-6 text-2xl z-30 animate-swing-natural filter drop-shadow-md" style={{animationDuration: '4.5s'}}>🥁</div>
                        <div className="absolute bottom-0 w-full h-12 z-0 opacity-20 pointer-events-none overflow-hidden rounded-b-3xl">
                            <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-full fill-teal-500">
                                <path d="M0 20 Q 25 5, 50 15 T 100 10 V 20 Z" />
                            </svg>
                        </div>
                    </>
                )}

                {/* 🍡 元宵节皮肤层 */}
                {isYuanxiao && (
                    <>
                        <div className="absolute -top-2 left-4 w-6 h-16 bg-red-400 z-20 shadow-sm animate-swing-natural flex flex-col items-center justify-center border-t-4 border-yellow-300" style={{animationDuration: '3s', transformOrigin: 'top center'}}>
                            <div className="w-[1px] h-full bg-red-300/30"></div>
                            <span className="text-[8px] text-white font-bold writing-vertical-rl">元宵</span>
                        </div>
                        <div className="absolute -top-1 left-12 w-6 h-12 bg-pink-400 z-20 shadow-sm animate-swing-natural flex flex-col items-center justify-center border-t-4 border-yellow-300" style={{animationDuration: '4s', transformOrigin: 'top center'}}>
                            <div className="w-[1px] h-full bg-pink-300/30"></div>
                            <span className="text-[8px] text-white font-bold writing-vertical-rl">团圆</span>
                        </div>
                        <div className="absolute -bottom-2 -right-2 w-16 h-16 z-20 filter drop-shadow-md">
                            <svg viewBox="0 0 100 100" className="w-full h-full">
                                <path d="M10 50 Q 50 100, 90 50" fill="#fff" stroke="#FFD700" strokeWidth="2"/>
                                <ellipse cx="50" cy="50" rx="40" ry="10" fill="#f0f0f0" />
                                <circle cx="35" cy="48" r="8" fill="white" />
                                <circle cx="50" cy="52" r="8" fill="white" />
                                <circle cx="65" cy="48" r="8" fill="white" />
                            </svg>
                        </div>
                    </>
                )}

                {/* 🌧️ 清明节皮肤层 (新) */}
                {isQingming && (
                    <>
                        {/* 水墨山水背景 (SVG) */}
                        <div className="absolute bottom-0 left-0 w-full h-32 z-0 opacity-15 pointer-events-none overflow-hidden rounded-b-3xl">
                            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-full">
                                <path d="M0 40 L 20 20 Q 30 15, 40 25 T 60 20 T 100 30 V 40 Z" fill="#64748b" opacity="0.6"/>
                                <path d="M0 40 L 10 30 Q 20 25, 30 35 T 50 30 T 100 35 V 40 Z" fill="#334155" opacity="0.8"/>
                            </svg>
                        </div>
                        {/* 左上角垂柳 */}
                        <div className="absolute -top-3 -left-3 z-20 animate-swing-natural" style={{animationDuration: '6s', transformOrigin: 'top left'}}>
                            <div className="text-4xl text-emerald-700/80 drop-shadow-sm" style={{ transform: 'rotate(135deg)' }}>🌿</div>
                        </div>
                        {/* 右上角纸鸢 */}
                        <div className="absolute -top-5 -right-5 z-20 animate-bounce" style={{animationDuration: '5s'}}>
                            <div className="text-3xl opacity-80" style={{ transform: 'rotate(-20deg)' }}>🪁</div>
                        </div>
                    </>
                )}

                {/* 锁定遮罩 */}
                {isLocked && !isAdmin && (
                    <div className="absolute inset-0 z-20 bg-white/50 backdrop-blur-sm flex items-center justify-center rounded-3xl">
                        <div className="px-4 py-2 bg-white rounded-xl shadow-lg flex flex-col items-center border border-slate-100">
                            {isEnded ? <CalendarX className="w-6 h-6 text-slate-400" /> : <Lock className="w-6 h-6 text-blue-400" />}
                            <span className="text-xs font-bold text-slate-600 mt-1">{isEnded ? "已结束" : formatTime(unlockDate)}</span>
                        </div>
                    </div>
                )}

                {/* 管理员按钮 */}
                {isAdmin && isCardEditMode && !isClassRemoved && (
                    <div className="absolute top-2 right-2 flex gap-1 z-30 animate-in fade-in zoom-in duration-300">
                        <button onClick={(e) => { e.preventDefault(); onEdit(link); }} className="p-1.5 bg-white/90 hover:bg-indigo-50 text-indigo-600 rounded-lg shadow-sm border border-slate-200"><Edit2 className="w-3 h-3" /></button>
                        <button onClick={(e) => { e.preventDefault(); onDelete(link.id); }} className="p-1.5 bg-white/90 hover:bg-red-50 text-red-600 rounded-lg shadow-sm border border-slate-200"><Trash2 className="w-3 h-3" /></button>
                    </div>
                )}

                {/* 🌟 重新设计的长按删除进度边框：外置悬浮流光能量圈 (Outer Neon Orbit) */}
                {pressProgress > 0 && pressProgress < 100 && !deleteArmed && !isClassRemoved && (
                    <svg
                        className="pointer-events-none absolute z-50 overflow-visible transition-opacity duration-200"
                        style={{
                            top: `-${svgPad}px`,
                            left: `-${svgPad}px`,
                            width: `calc(100% + ${svgPad * 2}px)`,
                            height: `calc(100% + ${svgPad * 2}px)`
                        }}
                    >
                        <defs>
                            {/* 炫光霓虹能量渐变（JAVA 蓝 / .NET 红） */}
                            <linearGradient id={`outerOrbitGrad-${link.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor={isJavaDelete ? '#38bdf8' : '#ff4d4f'} />
                                <stop offset="50%" stopColor={isJavaDelete ? '#2563eb' : '#ff0055'} />
                                <stop offset="100%" stopColor={isJavaDelete ? '#1d4ed8' : '#ff2472'} />
                            </linearGradient>
                            {/* 强复合层高斯激光渲染 filter */}
                            <filter id={`neonGlow-${link.id}`} x="-40%" y="-40%" width="180%" height="180%">
                                <feGaussianBlur stdDeviation="3.5" result="blur1" />
                                <feGaussianBlur stdDeviation="1.5" result="blur2" />
                                <feMerge>
                                    <feMergeNode in="blur1" />
                                    <feMergeNode in="blur2" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        {/* 底层：未来感脉冲能量虚影轨道 (未触发的休眠能量轮廓) */}
                        <rect
                            x={rectX}
                            y={rectY}
                            width={rectW}
                            height={rectH}
                            rx={rectRadius}
                            ry={rectRadius}
                            fill="none"
                            stroke={`url(#outerOrbitGrad-${link.id})`}
                            strokeWidth="1.5"
                            strokeDasharray="4 6"
                            className="opacity-30 animate-pulse"
                        />

                        {/* 中层：强辉光等离子态环形激光束 (主流程线) */}
                        <rect
                            x={rectX}
                            y={rectY}
                            width={rectW}
                            height={rectH}
                            rx={rectRadius}
                            ry={rectRadius}
                            fill="none"
                            stroke={`url(#outerOrbitGrad-${link.id})`}
                            strokeWidth={strokeWidth}
                            strokeDasharray={`${strokeLength} ${perimeter}`}
                            strokeDashoffset="0"
                            strokeLinecap="round"
                            filter={`url(#neonGlow-${link.id})`}
                        />

                        {/* 顶层：激光主纹芯亮芒 (粉白色极亮线芯，铸就电影感赛博光刃质感) */}
                        <rect
                            x={rectX}
                            y={rectY}
                            width={rectW}
                            height={rectH}
                            rx={rectRadius}
                            ry={rectRadius}
                            fill="none"
                            stroke={isJavaDelete ? '#e0f2fe' : '#ffe6f0'}
                            strokeWidth="1.2"
                            strokeDasharray={`${strokeLength} ${perimeter}`}
                            strokeDashoffset="0"
                            strokeLinecap="round"
                            className="opacity-95"
                        />
                    </svg>
                )}

                {/* 删除模式确认层（纯净玻璃高斯模糊 + 警示微光 + 弹性缩放动画） */}
                {deleteArmed && !isClassRemoved && (
                    <ClassActionOverlay
                        running={isClassActionRunning || isRepairingAccount}
                        initializing={isInitializingClass}
                        deleting={isDeletingClass}
                        repairing={isRepairingAccount}
                        accountReady={hasReadyAccount}
                        javaResync={link.ssoMethod === 'java'}
                        canInitialize={canInitializeClass}
                        canRepair={canRepairAccountReadiness}
                        onDelete={handleDeleteClassClick}
                        onInitialize={handleInitializeClassClick}
                        onRepair={handleRepairAccountClick}
                        onCancel={() => setDeleteArmed(false)}
                    />
                )}

                <div
                    className={`flex flex-col flex-grow p-5 transition-all duration-300 ${deleteArmed ? "filter blur-sm opacity-15 scale-95 pointer-events-none" : ""} ${isLocked && !isAdmin ? "pointer-events-none" : ""} ${isChristmas || isLunar || isHalloween || isMidAutumn || isDragonBoat || isYuanxiao || isQingming ? 'pt-8' : ''}`}
                    onPointerDown={startDeletePress}
                    onPointerUp={cancelDeletePress}
                    onPointerLeave={cancelDeletePress}
                    onPointerCancel={cancelDeletePress}
                >
                    <div className={`flex items-start justify-between mb-4 relative z-10 transition-opacity duration-500 ${isClassRemoved ? 'opacity-40 grayscale-[0.4]' : ''}`}>
                        <div className={`contest-card-logo relative w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]
                            ${hasWhiteLogoBackground ? 'border border-slate-200/80 bg-white shadow-md shadow-slate-300/30' : logoTheme ? `shadow-md bg-gradient-to-br ${logoTheme.gradient}` : 'bg-transparent shadow-none'}
                            ${isLunar ? '!from-red-600 !to-orange-500' : ''}
                            ${isHalloween ? '!from-purple-800 !to-orange-600' : ''}
                            ${isMidAutumn ? '!from-blue-900 !to-indigo-800 border border-blue-400/20' : ''}
                            ${isDragonBoat ? '!from-teal-500 !to-emerald-600 border border-teal-200' : ''}
                            ${isYuanxiao ? '!from-pink-500 !to-rose-500 border border-pink-200' : ''}
                            ${isQingming ? '!from-slate-400 !to-slate-600 border border-slate-200' : ''} // 清明水墨图标背景
                        `}>
                            {isChristmas && <div className="absolute top-0 left-0 w-full h-1 bg-white/60 blur-[1px]"></div>}
                            {renderIcon()}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${theme.soft}
                                ${isLunar ? '!bg-red-50 !text-red-700 !border-red-200' : ''}
                                ${isHalloween ? '!bg-slate-800 !text-orange-400 !border-purple-800' : ''}
                                ${isMidAutumn ? '!bg-blue-900/50 !text-blue-200 !border-blue-700' : ''}
                                ${isDragonBoat ? '!bg-emerald-50 !text-teal-700 !border-emerald-200' : ''}
                                ${isYuanxiao ? '!bg-pink-50 !text-pink-600 !border-pink-200' : ''}
                                ${isQingming ? '!bg-slate-100 !text-slate-600 !border-slate-300' : ''} // 清明标签
                                ${isClassRemoved ? '!bg-slate-200/70 dark:!bg-slate-800 !text-slate-500 dark:!text-slate-400 !border-slate-300/70 dark:!border-slate-700 shadow-none' : ''}
                            `}>
                                {renderStatus()}
                            </span>
                        </div>
                    </div>

                    <div className={`relative z-10 h-[60px] flex-none overflow-hidden transition-opacity duration-500 ${isClassRemoved ? 'opacity-40 grayscale-[0.4]' : ''}`}>
                        <h3 className={`contest-card-title mb-1 line-clamp-2 text-base font-black leading-5 transition-colors duration-300
                            ${isChristmas ? 'text-red-700 group-hover:text-indigo-600' : ''}
                            ${isLunar ? 'text-transparent bg-clip-text bg-gradient-to-r from-red-800 to-orange-600 group-hover:from-red-600 group-hover:to-orange-500' : ''}
                            ${isHalloween ? 'text-orange-400 group-hover:text-purple-400' : ''}
                            ${isMidAutumn ? 'text-yellow-100 group-hover:text-white' : ''}
                            ${isDragonBoat ? 'text-teal-800 group-hover:text-emerald-600' : ''}
                            ${isYuanxiao ? 'text-pink-600 group-hover:text-rose-600' : ''}
                            ${isQingming ? 'text-slate-700 group-hover:text-emerald-700' : ''} // 清明标题
                            ${!isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'text-slate-800 dark:text-slate-100' : ''}
                        `}>
                            {link.title}
                        </h3>
                        <p className={`line-clamp-2 text-xs leading-4
                            ${isChristmas ? 'text-slate-600 font-bold' : ''}
                            ${isLunar ? 'text-red-800/70 font-medium' : ''}
                            ${isHalloween ? 'text-purple-300/80 font-medium' : ''}
                            ${isMidAutumn ? 'text-blue-200/70 font-medium' : ''}
                            ${isDragonBoat ? 'text-teal-700/80 font-medium' : ''}
                            ${isYuanxiao ? 'text-pink-500/70 font-medium' : ''}
                            ${isQingming ? 'text-slate-500/90 font-medium' : ''} // 清明描述
                            ${!isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'text-slate-500 dark:text-slate-400 font-medium' : ''}
                        `}>
                            {link.description || "暂无描述"}
                        </p>
                    </div>

                    <div className={`relative z-10 mt-auto flex items-center justify-between border-t pt-3
                        ${isChristmas ? 'border-red-100' : ''}
                        ${isLunar ? 'border-red-200/50' : ''}
                        ${isHalloween ? 'border-purple-800/50' : ''}
                        ${isMidAutumn ? 'border-blue-800/50' : ''}
                        ${isDragonBoat ? 'border-emerald-200/60' : ''}
                        ${isYuanxiao ? 'border-pink-200/50' : ''}
                        ${isQingming ? 'border-slate-200' : ''}
                        ${!isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'border-slate-100 dark:border-slate-700/50' : ''}
                    `}>
                        <div className="contest-card-guide-viewport flex h-7 w-[58px] shrink-0 items-center overflow-hidden">
                            <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAiGuide(link); }}
                                className={`contest-card-action contest-card-guide-action ${aiGuideAvailable && !isLocked && !isClassRemoved && !isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'contest-card-action--guide-default' : ''} flex h-7 w-[58px] shrink-0 items-center justify-center whitespace-nowrap rounded border px-2 text-[10px] font-bold
                                ${adminEntryAvailable && teacherMenuOpen ? 'contest-card-guide-action--exiting pointer-events-none' : ''}
                                ${!aiGuideAvailable || isLocked || isClassRemoved ? "!bg-slate-200/60 dark:!bg-slate-800/50 !text-slate-400 dark:!text-slate-500 !border-slate-300/50 dark:!border-slate-700/50 !cursor-not-allowed pointer-events-none !shadow-none opacity-50" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isChristmas ? "bg-red-50 text-red-600 border-red-100 hover:bg-red-600 hover:text-white" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isLunar ? "bg-gradient-to-r from-red-50 to-orange-50 text-red-700 border-red-200 hover:from-red-600 hover:to-orange-500 hover:text-white hover:border-transparent shadow-sm" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isHalloween ? "bg-slate-800 text-purple-400 border-purple-800 hover:bg-purple-900 hover:text-orange-400" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isMidAutumn ? "bg-blue-900/50 text-blue-300 border-blue-700 hover:bg-blue-800 hover:text-white" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isDragonBoat ? "bg-emerald-50 text-teal-700 border-teal-200 hover:bg-teal-600 hover:text-white" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isYuanxiao ? "bg-pink-50 text-pink-600 border-pink-200 hover:bg-pink-500 hover:text-white" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && isQingming ? "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-500 hover:text-white" : ""}
                                ${aiGuideAvailable && !isLocked && !isClassRemoved && !isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? "bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-600 hover:text-white" : ""}
                            `}
                                disabled={!aiGuideAvailable || isLocked || isClassRemoved}
                                tabIndex={adminEntryAvailable && teacherMenuOpen ? -1 : undefined}
                                aria-hidden={adminEntryAvailable && teacherMenuOpen}
                                title={isClassRemoved ? '班级已删除，请先添加回来' : !aiGuideAvailable ? '请先由超级管理员完成 AI 配置' : '生成 AI 竞赛攻略'}
                            >
                                <Sparkles className="mr-1 h-3 w-3 shrink-0" />
                                <span>攻略</span>
                            </button>
                        </div>
                        {isClassRemoved ? (
                            <div className="ml-auto flex items-center gap-1.5 relative z-20">
                                <button
                                    type="button"
                                    onClick={handleRestoreClass}
                                    disabled={classActionKey === `restore:${link.id}`}
                                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 px-4 py-1.5 text-[10px] font-black text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-200 hover:scale-[1.03] active:scale-95 disabled:opacity-70 pointer-events-auto"
                                >
                                    {classActionKey === `restore:${link.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/90" /> : <RotateCcw className="h-3.5 w-3.5 text-indigo-100 transition-transform duration-300 group-hover:rotate-180" />}
                                    <span>{classActionKey === `restore:${link.id}` ? '正在添加...' : '添加回来'}</span>
                                </button>
                            </div>
                        ) : supportsRoleLogin ? (
                            <div
                                className="contest-card-role-actions relative z-50 ml-auto flex items-center justify-end gap-1.5"
                                onMouseEnter={() => setRoleActionsHover(true)}
                                onMouseLeave={() => setRoleActionsHover(false)}
                                onFocus={() => setRoleActionsHover(true)}
                                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setRoleActionsHover(false); }}
                            >
                                    {!isStudentUser && <div
                                        className="relative"
                                        onMouseEnter={() => setTeacherMenuOpen(true)}
                                        onMouseLeave={() => setTeacherMenuOpen(false)}
                                        onFocus={() => setTeacherMenuOpen(true)}
                                        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setTeacherMenuOpen(false); }}
                                    >
                                        {adminEntryAvailable && (
                                            <div className={`absolute right-full top-0 box-border flex h-7 items-center overflow-hidden pr-1.5 transition-[width,opacity,transform] duration-300 ease-out ${teacherMenuOpen ? 'w-[78px] translate-x-0 opacity-100' : 'pointer-events-none w-0 translate-x-2 opacity-0'}`}>
                                                <button
                                                    type="button"
                                                    onClick={handleOpenAdminCredential}
                                                    disabled={isAdminEntryOpening}
                                                    aria-busy={isAdminEntryOpening}
                                                    aria-label={`打开 ${adminEntryLabel} 管理员账户服务`}
                                                    className="contest-card-action contest-card-action--admin flex h-7 w-[72px] shrink-0 items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50/95 text-[10px] font-bold text-amber-700 shadow-sm shadow-amber-100/60 transition-all duration-200 disabled:cursor-wait disabled:opacity-70 dark:border-amber-700/70 dark:bg-amber-950/45 dark:text-amber-300"
                                                >
                                                    {isAdminEntryOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                                                    {isAdminEntryOpening ? '进入中' : adminEntryLabel}
                                                </button>
                                            </div>
                                        )}
                                        {expertEntryAvailable && (
                                            <div
                                                className={`absolute left-full top-0 z-30 box-border flex w-[78px] flex-col items-start pl-1.5 ${teacherMenuOpen ? '' : 'pointer-events-none'}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleRoleOpen(e, 'expert')}
                                                    disabled={isExpertOpening}
                                                    aria-busy={isExpertOpening}
                                                    aria-hidden={!teacherMenuOpen}
                                                    tabIndex={teacherMenuOpen ? undefined : -1}
                                                    className={`contest-card-action contest-card-action--expert contest-card-expert-action flex h-7 w-[72px] shrink-0 items-center justify-center gap-1 rounded-xl border border-violet-200 bg-violet-50/95 text-[10px] font-bold text-violet-700 shadow-sm shadow-violet-100/60 disabled:cursor-wait disabled:opacity-70 dark:border-violet-800 dark:bg-violet-950/45 dark:text-violet-300 ${teacherMenuOpen ? 'contest-card-expert-action--visible' : ''}`}
                                                >
                                                    {isExpertOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gavel className="h-3 w-3" />}
                                                    {isExpertOpening ? '进入中' : '评委端'}
                                                </button>
                                                <div className={`w-[72px] pt-1.5 transition-all duration-200 ${teacherMenuOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-1 opacity-0'}`}>
                                                    <div className="flex flex-col gap-1">
                                                        {expertTargets.map(target => (
                                                            <button
                                                                key={target.studentIndex || target.rosterIndex || target.accountName}
                                                                type="button"
                                                                title={`评审 ${target.displayName || target.accountName}`}
                                                                onClick={(e) => handleRoleOpen(e, 'expert', target)}
                                                                disabled={isExpertOpening}
                                                                className="h-7 w-[72px] truncate rounded-xl border border-violet-200/80 bg-white/80 px-1 text-[9px] font-bold text-violet-700 shadow-lg backdrop-blur-md transition-all hover:border-violet-600 hover:bg-violet-600 hover:text-white disabled:cursor-wait disabled:opacity-60"
                                                            >
                                                                {target.displayName || target.accountName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => handleRoleOpen(e, 'teacher')}
                                            disabled={isTeacherOpening}
                                            aria-busy={isTeacherOpening}
                                            className="contest-card-action contest-card-action--teacher w-[72px] h-7 flex items-center justify-center gap-1 text-[10px] font-bold rounded-xl border border-blue-200 bg-blue-50/95 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shadow-sm shadow-blue-100/60 disabled:cursor-wait disabled:opacity-70"
                                        >
                                            {isTeacherOpening ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}
                                            {isTeacherOpening ? '进入中' : '教师端'}
                                        </button>
                                    </div>}
                                    <div
                                        className="relative"
                                        onMouseEnter={() => setStudentMenuOpen(true)}
                                        onMouseLeave={() => setStudentMenuOpen(false)}
                                        onFocus={() => setStudentMenuOpen(true)}
                                        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setStudentMenuOpen(false); }}
                                    >
                                        <div className="h-7 w-[72px] overflow-hidden rounded-xl">
                                            <button
                                                type="button"
                                                onClick={(e) => handleRoleOpen(e, 'student')}
                                                disabled={isStudentOpening}
                                                aria-busy={isStudentOpening}
                                                aria-hidden={expertEntryAvailable && teacherMenuOpen}
                                                tabIndex={expertEntryAvailable && teacherMenuOpen ? -1 : undefined}
                                                className={`contest-card-action contest-card-action--student contest-card-student-action flex h-7 w-[72px] items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50/90 text-[10px] font-bold text-emerald-700 shadow-sm disabled:cursor-wait disabled:opacity-70 ${expertEntryAvailable && teacherMenuOpen ? 'contest-card-student-action--exiting pointer-events-none' : ''}`}
                                            >
                                                {isStudentOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserRound className="h-3 w-3" />}
                                                {isStudentOpening ? '进入中' : '学生端'}
                                            </button>
                                        </div>
                                        {!isStudentUser && <div className={`absolute top-full right-0 pt-1.5 w-[72px] transition-all duration-200 ${studentMenuOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible -translate-y-1'}`}>
                                            <div className="flex flex-col gap-1">
                                                {studentAccounts.map(account => (
                                                    <div key={account.studentIndex} className="relative group/student-account w-[72px] h-7">
                                                        <button
                                                            type="button"
                                                            title={`进入 ${account.accountName}`}
                                                            onClick={(e) => handleRoleOpen(e, 'student', account.studentIndex)}
                                                            className="w-[72px] h-7 px-1 rounded-xl border border-emerald-200/80 bg-white/75 backdrop-blur-md text-[9px] font-bold text-emerald-700 shadow-lg hover:bg-emerald-600 hover:text-white transition-all truncate"
                                                        >
                                                            {account.accountName}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            title={`删除 ${account.accountName}`}
                                                            aria-label={`删除 ${account.accountName}`}
                                                            onClick={(e) => handleDeleteStudent(e, account)}
                                                            disabled={deletingStudentKey === `${link.id}:${account.studentIndex}`}
                                                            className="absolute left-full ml-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg border border-red-200 bg-white/90 backdrop-blur-md text-red-500 shadow-lg flex items-center justify-center opacity-0 invisible translate-x-1 group-hover/student-account:opacity-100 group-hover/student-account:visible group-hover/student-account:translate-x-0 focus:opacity-100 focus:visible focus:translate-x-0 hover:bg-red-500 hover:text-white transition-all disabled:opacity-60"
                                                        >
                                                            {deletingStudentKey === `${link.id}:${account.studentIndex}`
                                                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                                                : <Trash2 className="w-3 h-3" />}
                                                        </button>
                                                    </div>
                                                ))}
                                                {supportsStudentAccounts && <button
                                                    type="button"
                                                    onClick={handleCreateStudent}
                                                    disabled={isCreatingStudent}
                                                    className="w-[72px] h-7 rounded-xl border border-dashed border-emerald-300 bg-white/60 backdrop-blur-md text-[10px] font-bold text-emerald-700 shadow-lg hover:bg-emerald-50 transition-all disabled:opacity-60 flex items-center justify-center gap-1"
                                                >
                                                    {isCreatingStudent ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                                                    {isCreatingStudent ? '创建中' : '新增学生'}
                                                </button>}
                                            </div>
                                        </div>}
                                    </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            {manualCredentialEnabled && supportsRoleLogin && !isStudentUser && !isLocked && !isClassRemoved && onRequestManualCredential && (
                <>
                <div ref={manualTriggerRef} className="manual-login-trigger-host pointer-events-none absolute inset-x-0 bottom-0 z-30 h-8">
                        <button
                            type="button"
                            onClick={handleToggleManualPanel}
                            title="提取系统地址、教师账号和长期密码"
                            aria-label="提取教师账号信息"
                            aria-expanded={manualPanelOpen}
                            className={`manual-login-trigger group/manual-login pointer-events-auto absolute left-1/2 bottom-0 flex items-center justify-center gap-1.5 border px-4 text-[10px] font-black shadow-lg backdrop-blur-md transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${manualPanelOpen ? 'manual-login-trigger--open border-indigo-300 bg-indigo-600 text-white shadow-indigo-500/25' : 'border-white/70 bg-white/90 text-indigo-600 shadow-slate-900/10 dark:border-slate-600/80 dark:bg-slate-800/95 dark:text-indigo-300'}`}
                        >
                            <ChevronDown className={`manual-login-trigger__arrow h-3.5 w-3.5 transition-transform duration-300 ${manualPanelOpen ? 'rotate-180' : ''}`} />
                        </button>
                </div>
                </>
            )}

            {/* ② ✨ 侧滑面板 */}
            <div className={`absolute left-0 top-4 bottom-4 w-[280px] bg-white/95 backdrop-blur-xl border border-slate-200/50 shadow-2xl rounded-r-2xl glass-motion-surface z-0 flex flex-col transition-all duration-500 overflow-hidden ${isPanelVisible ? 'translate-x-[calc(100%-10px)] opacity-100 visible' : 'translate-x-0 opacity-0 invisible'}`}>
                <div className={`px-4 py-3 border-b flex justify-between items-center ${isError ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <span className={`text-xs font-bold ${isError ? 'text-red-500' : isReady ? 'text-emerald-600' : 'text-slate-700'}`}>{isError ? '出错了' : isReady ? '准备完成' : '正在准备环境...'}</span>
                    <button onClick={(e) => { e.stopPropagation(); setCreatePanel({ visible: false, step: 0 }); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 relative overflow-hidden w-full bg-slate-50/50">
                    <div className="absolute left-0 top-1/2 w-full px-4 transition-transform duration-700 ease-out" style={{ transform: `translateY(${translateY})` }}>
                        <StepItem stepNumber={1} currentStep={currentStep} label="检查连接" subLabel={currentStep === 1 ? (createPanel.message || '正在检查平台连接…') : '等待开始'} icon={Cloud} isErrorState={isError} />
                        <ConnectorLine isActive={currentStep >= 1} isDone={currentStep > 1} />
                        <StepItem stepNumber={2} currentStep={currentStep} label="检查班级" subLabel={currentStep === 2 ? (createPanel.message || '正在检查班级与账号状态…') : '等待连接检查'} icon={GraduationCap} isErrorState={isError} />
                        <ConnectorLine isActive={currentStep >= 2} isDone={currentStep > 2} isErrorLine={isError && currentStep === 2} />
                        <StepItem stepNumber={3} currentStep={currentStep} label="创建账号" subLabel={currentStep === 3 ? (createPanel.message || '正在创建或关联平台账号…') : '等待班级检查'} icon={UserPlus} isErrorState={isError} />
                        <ConnectorLine isActive={currentStep >= 3} isDone={currentStep > 3} isErrorLine={isError && currentStep === 3} />
                        <StepItem stepNumber={4} currentStep={currentStep} label="准备入口" subLabel={currentStep >= 4 ? (createPanel.message || '可以进入系统') : '等待账号创建'} icon={ExternalLink} isErrorState={isError} />
                    </div>
                    {isError && <div className="absolute bottom-4 left-4 right-4 bg-white p-3 rounded-lg border border-red-100 text-xs text-red-600 shadow-sm">{createPanel.error}</div>}
                    {isReady && (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onLaunchPrepared?.(createPanel.launchUrl, link.id);
                            }}
                            className="absolute bottom-4 left-4 right-4 flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-black text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-600"
                        >
                            <ExternalLink className="h-4 w-4" />立即进入系统
                        </button>
                    )}
                </div>
            </div>
        </div>

        {manualCredentialEnabled && supportsRoleLogin && !isStudentUser && !isLocked && !isClassRemoved && onRequestManualCredential && manualPanelOpen && (
            <div
                ref={manualPanelRef}
                onClick={(event) => event.stopPropagation()}
                className="manual-login-panel manual-login-panel-enter glass-motion-surface absolute left-0 top-[calc(100%+2.25rem)] z-40 w-full rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95"
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-white"><KeyRound className="h-4 w-4 text-indigo-500" />教师账号登录信息</div>
                    <div className="flex min-w-0 items-center gap-1.5">
                        {copiedField && <span role="status" aria-live="polite" className={`max-w-[112px] truncate rounded-md px-1.5 py-0.5 text-[9px] font-bold ${copiedField === '复制失败' ? 'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'}`} title={copiedField === '复制失败' ? copiedField : `已复制${copiedField}`}>{copiedField === '复制失败' ? copiedField : `已复制${copiedField}`}</span>}
                        <button type="button" onClick={() => setManualPanelVisibility(false)} className="shrink-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                    </div>
                </div>
                {manualCredential && <>
                    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-2.5 py-1.5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                        <span className="shrink-0 whitespace-nowrap text-[10px] font-black text-indigo-700 dark:text-indigo-300">教师主账号</span>
                        <span className="min-w-0 truncate whitespace-nowrap text-[9px] leading-4 text-slate-500 dark:text-slate-400" title="进入目标系统后，再由教师分配学生账号。">进入目标系统后，再由教师分配学生账号。</span>
                    </div>
                    <p className="mt-1.5 text-[9px] leading-4 text-amber-600 dark:text-amber-300">密码长期加密存储，仅在目标系统修改或重置后失效。</p>
                </>}
                {manualError && <div className="mt-2 rounded-lg bg-red-50 p-2 text-[10px] leading-4 text-red-600 dark:bg-red-950/40 dark:text-red-300">{manualError}</div>}
                {!manualCredential && (
                    <button type="button" onClick={handleIssueManualCredential} disabled={manualLoading} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[11px] font-black text-white transition hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60">
                        {manualLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{manualLoading ? '正在读取账号信息…' : '点击提取账号信息'}
                    </button>
                )}
                {manualCredential && (
                    <div className="mt-2 space-y-1.5 text-[10px]">
                        {[['系统地址', manualCredential.loginUrl], ['账号', manualCredential.username]].map(([label, value]) => <div key={label} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800"><span className="w-12 shrink-0 text-slate-400">{label}</span><span className="min-w-0 flex-1 break-all whitespace-normal font-mono font-bold text-slate-700 dark:text-slate-200" title={value}>{value}</span><button type="button" onClick={() => copyText(value, label)} title={copiedField === label ? '已复制' : `复制${label}`} aria-label={copiedField === label ? `已复制${label}` : `复制${label}`} className={`mt-0.5 shrink-0 transition ${copiedField === label ? 'text-emerald-500' : 'text-slate-400 hover:text-indigo-500'}`}>{copiedField === label ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button></div>)}
                        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 dark:bg-emerald-950/30"><span className="w-12 shrink-0 text-emerald-600 dark:text-emerald-300">长期密码</span><span className="min-w-0 flex-1 font-mono text-sm font-black tracking-[0.2em] text-emerald-700 dark:text-emerald-200">{manualCredential.password}</span><button type="button" onClick={handleIssueManualCredential} disabled={manualLoading} title="重置密码" aria-label="重置密码" className="text-emerald-500 transition hover:text-indigo-500 disabled:cursor-wait disabled:opacity-50">{manualLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}</button><button type="button" onClick={() => copyText(manualCredential.password, '长期密码')} title={copiedField === '长期密码' ? '已复制' : '复制密码'} aria-label={copiedField === '长期密码' ? '已复制长期密码' : '复制密码'} className={`transition ${copiedField === '长期密码' ? 'text-emerald-500' : 'text-emerald-500 hover:text-emerald-600'}`}>{copiedField === '长期密码' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button></div>
                    </div>
                )}
            </div>
        )}

        </>
    );
};

export default ContestCard;
