import { ChartColumn, CircleHelp, KeyRound, LayoutGrid, LogIn, TriangleAlert } from 'lucide-react';

export const TICKET_CATEGORIES = [
    {
        id: 'open_failed', label: '无法打开 / 登录失败', icon: TriangleAlert,
        template: '【问题现象】点击卡片后页面打不开 / 提示登录失败\n【出现时间】\n【是否每次都会出现】\n【提示信息】'
    },
    {
        id: 'auto_login', label: '自动登录失败', icon: LogIn,
        template: '【问题现象】自动登录没有成功，停留在登录页 / 提示账号或密码错误\n【使用的浏览器】\n【提示信息】'
    },
    {
        id: 'score', label: '成绩 / 分数异常', icon: ChartColumn,
        template: '【问题现象】成绩没有显示 / 分数与实际不符\n【任务或模块名称】\n【期望的成绩】'
    },
    {
        id: 'account', label: '账号与密码', icon: KeyRound,
        template: '【问题现象】忘记密码 / 账号被锁定 / 需要修改绑定邮箱\n【补充说明】'
    },
    {
        id: 'card_display', label: '卡片显示 / 权限', icon: LayoutGrid,
        template: '【问题现象】看不到应有的卡片 / 卡片显示不正确\n【应该看到的卡片】'
    },
    { id: 'other', label: '其他问题', icon: CircleHelp, template: '' }
];

export const CATEGORY_LABELS = Object.fromEntries(TICKET_CATEGORIES.map(category => [category.id, category.label]));

export const STATUS_META = {
    open: { label: '待处理', tone: 'amber' },
    in_progress: { label: '处理中', tone: 'sky' },
    resolved: { label: '已解决', tone: 'emerald' },
    closed: { label: '已关闭', tone: 'slate' }
};

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_BODY_LENGTH = 5000;
export const ACCEPT_ATTACHMENTS = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.log,.csv,.zip,.docx,.xlsx';
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp|gif|pdf|txt|log|csv|zip|docx|xlsx)$/i;
// Uploads can take far longer than an ordinary API call.
export const UPLOAD_TIMEOUT_MS = 180_000;

/** D1 stores UTC as "YYYY-MM-DD HH:MM:SS". */
export function parseServerTime(value) {
    if (!value) return null;
    const text = String(value);
    const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelativeTime(value, now = Date.now()) {
    const date = parseServerTime(value);
    if (!date) return '';
    const seconds = Math.round((now - date.getTime()) / 1000);
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatFullTime(value) {
    const date = parseServerTime(value);
    return date ? date.toLocaleString('zh-CN', { hour12: false }) : '';
}

export function formatBytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Adds picked, dropped or pasted files to a draft list. Returns the new list
 * and a message for anything that was skipped. The server re-checks every
 * file by its content; this only spares the user a failed upload.
 */
export function mergeDraftFiles(current, incoming) {
    const next = [...current];
    const problems = [];
    let total = current.reduce((sum, item) => sum + item.file.size, 0);
    for (const raw of incoming) {
        // Pasted screenshots arrive as "image.png"; give them a readable name.
        const file = raw.name && raw.name !== 'image.png'
            ? raw
            : new File([raw], `截图-${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}.png`, { type: raw.type || 'image/png' });
        if (next.length >= MAX_FILES) { problems.push(`最多添加 ${MAX_FILES} 个附件`); break; }
        if (!ALLOWED_EXTENSIONS.test(file.name)) { problems.push(`「${file.name}」格式不受支持`); continue; }
        if (file.size > MAX_FILE_BYTES) { problems.push(`「${file.name}」超过 10MB`); continue; }
        if (total + file.size > MAX_TOTAL_BYTES) { problems.push('附件合计不能超过 20MB'); continue; }
        total += file.size;
        next.push({
            key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
            file,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
        });
    }
    return { files: next, problem: [...new Set(problems)].join('；') };
}

export function releaseDraftFiles(files) {
    for (const item of files) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

export function cardKind(link) {
    return link?.ssoMethod === 'paasV2' ? '智能体' : '竞赛';
}
