const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

export const API_BASE = isLocal
    ? "http://localhost:8787/api"
    : "/api";

// 壁纸内容 URL 带稳定版本参数（?v=内容哈希）。版本变化 ⇒ URL 变化 ⇒
// 边缘缓存键变化，新内容永远不会命中旧版本的缓存；一年 immutable 的
// 浏览器缓存因此是安全的，无需关闭。
export const wallpaperContentUrl = (id, version) => {
    const versionSuffix = version ? `?v=${encodeURIComponent(version)}` : '';
    return `${API_BASE}/wallpapers/${id}/content${versionSuffix}`;
};

export const GLASS_CARD = "bg-white/70 backdrop-blur-xl border border-white/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300";
export const GLASS_INPUT = "theme-form-control bg-white/60 backdrop-blur-md border border-slate-200/60 focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100/50 transition-all outline-none text-slate-700 placeholder:text-slate-400 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-900 dark:focus:border-indigo-500 dark:focus:ring-indigo-950/50";
export const PRIMARY_BTN = "bg-slate-900 hover:bg-black text-white shadow-lg shadow-slate-900/20 active:scale-95 transition-all duration-200 ease-out";
export const INK_TEXT_SHADOW = "dark:text-shadow-[0_0_8px_rgba(255,255,255,0.3)]";

// --- 默认 AI 配置 ---
export const DEFAULT_AI_CONFIG = {
    apiKey: "",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    modelName: "glm-4.6",
    maxTokens: 2000,
    systemPrompt: "你是一个专业的竞赛辅导教练，请根据用户的竞赛信息提供专业的备赛建议。"
};

// --- 默认站点配置 ---
export const DEFAULT_SITE_CONFIG = {
    loginTitle: { text: "MarchCenter", align: "center", fontSize: "2xl" },
    loginSubtitle: { text: "管理你的竞赛工具和入口", align: "center" },
    loginBrandName: "MarchCenter",
    loginVisualTitle: "连接每一场竞赛",
    loginVisualSubtitle: "统一管理竞赛入口、账号与训练进度，让每一次出发都更简单。",
    loginVisualCenterType: "emoji",
    loginVisualCenterValue: "🏆",
    loginVisualCenterImageUrl: "",
    loginWelcomeTitle: "欢迎回来",
    loginWelcomeSubtitle: "请输入您的 MarchCenter 账号凭证",
    loginTextAlign: "left",
    loginPasswordTabText: "密码登录",
    loginCodeTabText: "免密验证码登录",
    loginUsernameLabel: "用户名",
    loginUsernamePlaceholder: "请输入用户名或邮箱",
    loginCodeAccountLabel: "电子邮箱",
    loginCodeAccountPlaceholder: "请输入已绑定邮箱",
    loginPasswordLabel: "密码",
    loginPasswordPlaceholder: "请输入密码",
    loginCodeLabel: "邮箱动态验证码",
    loginCodeSendText: "获取验证码",
    loginCodeHint: "验证码将发送到账号绑定邮箱，10 分钟内有效。",
    loginCodeDisabledHint: "邮件服务尚未配置，配置完成后即可使用。",
    loginSubmitText: "登录",
    loginCodeSubmitText: "验证码登录",
    loginLoadingText: "正在安全校验...",
    loginForgotText: "忘记密码？",
    loginRegisterLead: "还没有账号？",
    loginRegisterText: "立即注册",
    loginSecurityText: "256-bit TLS 端到端加密校验",
    forgotTitle: "重置您的访问密码",
    forgotSubtitle: "通过账号绑定邮箱验证身份并设置新密码。",
    forgotInstruction: "验证码将在 10 分钟内有效。",
    forgotCloseText: "重置密码",
    registerTitle: "创建 MarchCenter 账号",
    registerSubtitle: "填写以下信息完成新用户注册",
    registerSubmitText: "立即注册",
    registerSuccessTitle: "账号创建成功",
    registerSuccessSubtitle: "账号已填入登录表单，请使用刚设置的密码登录。",
    welcomeTitle: "Hello, {username} 👋",
    welcomeSubtitle: "准备好开始今天的挑战了吗？",
    dailyQuote: "保持热爱，奔赴下一场挑战。",
    dashboardTextAlign: "left",
    footerText: "© 2026 MarchCenter. All rights reserved.",
    footerSize: "small",
    footerVisibility: "all",
    navbarLogoType: 'Trophy',
    navbarLogoUrl: '',
    homeWelcomeTitle: { text: "Hello, {username}", align: "left", fontSize: "4xl" },
    homeSubtitle: { text: "\"Talk is cheap, show me the code.\"", align: "left", fontSize: "lg" },
    searchPlaceholder: "搜索竞赛或考点..."
};

export function normalizeSiteConfig(value = {}) {
    const config = value && typeof value === 'object' ? value : {};
    return {
        ...DEFAULT_SITE_CONFIG,
        ...config,
        loginBrandName: config.loginBrandName || DEFAULT_SITE_CONFIG.loginBrandName,
        navbarLogoType: config.navbarLogoType || DEFAULT_SITE_CONFIG.navbarLogoType,
        navbarLogoUrl: config.navbarLogoUrl ?? DEFAULT_SITE_CONFIG.navbarLogoUrl
    };
}

// --- 默认提示词模板 ---
export const DEFAULT_PROMPT_TEMPLATE = `我正在准备参加一个名为“{title}”的竞赛。
它的分类是“{category}”。
简短描述：{description}。

请你作为我的AI竞赛教练，为我生成一份简短的备赛指南。
请包含以下三个部分，每个部分2-3点即可，保持精炼：
1. 【难度评估】：分析这个比赛的含金量或难度级别。
2. 【核心考点】：列出需要掌握的关键知识点或技能树。
3. 【备赛策略】：给出具体的短期或长期准备建议。

请用中文回答，使用Markdown格式，适当使用emoji让阅读更轻松。`;
