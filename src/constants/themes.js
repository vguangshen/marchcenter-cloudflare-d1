// src/constants/themes.js

export const THEMES = {
    // 1. 科技蓝
    blue: {
        label: '科技蓝',
        rgb: '59 130 246',
        gradient: 'from-blue-500 to-indigo-600',
        shadow: 'shadow-blue-500/30',
        border: 'border-blue-200',
        soft: 'bg-blue-50 text-blue-600 border-blue-200'
    },
    // 2. 节日 - 祥瑞红 (春节/圣诞)
    red: {
        label: '祥瑞红',
        rgb: '239 68 68',
        gradient: 'from-red-500 to-rose-600',
        shadow: 'shadow-red-500/30',
        border: 'border-red-200',
        soft: 'bg-red-50 text-red-600 border-red-200'
    },
    // 3. 节日 - 活力橙 (万圣节)
    orange: {
        label: '活力橙',
        rgb: '249 115 22',
        gradient: 'from-orange-400 to-red-500',
        shadow: 'shadow-orange-500/30',
        border: 'border-orange-200',
        soft: 'bg-orange-50 text-orange-600 border-orange-200'
    },
    // 4. 节日 - 明亮黄 (中秋)
    yellow: {
        label: '明亮黄',
        rgb: '234 179 8',
        gradient: 'from-yellow-400 to-orange-500',
        shadow: 'shadow-yellow-500/30',
        border: 'border-yellow-200',
        soft: 'bg-yellow-50 text-yellow-700 border-yellow-200' // 文字深一点保证可读性
    },
    // 5. 节日 - 清新绿 (圣诞)
    green: {
        label: '清新绿',
        rgb: '34 197 94',
        gradient: 'from-emerald-400 to-green-600',
        shadow: 'shadow-green-500/30',
        border: 'border-green-200',
        soft: 'bg-green-50 text-green-600 border-green-200'
    },
    // 6. 节日 - 翡翠青 (端午)
    teal: {
        label: '翡翠青',
        rgb: '20 184 166',
        gradient: 'from-teal-400 to-emerald-600',
        shadow: 'shadow-teal-500/30',
        border: 'border-teal-200',
        soft: 'bg-teal-50 text-teal-600 border-teal-200'
    },
    // 7. 通用 - 天际蓝
    cyan: {
        label: '天际蓝',
        rgb: '6 182 212',
        gradient: 'from-cyan-400 to-blue-500',
        shadow: 'shadow-cyan-500/30',
        border: 'border-cyan-200',
        soft: 'bg-cyan-50 text-cyan-600 border-cyan-200'
    },
    // 8. 通用 - 静谧蓝
    indigo: {
        label: '静谧蓝',
        rgb: '99 102 241',
        gradient: 'from-indigo-500 to-purple-600',
        shadow: 'shadow-indigo-500/30',
        border: 'border-indigo-200',
        soft: 'bg-indigo-50 text-indigo-600 border-indigo-200'
    },
    // 9. 节日 - 梦幻紫 (万圣节)
    purple: {
        label: '梦幻紫',
        rgb: '168 85 247',
        gradient: 'from-purple-500 to-indigo-600',
        shadow: 'shadow-purple-500/30',
        border: 'border-purple-200',
        soft: 'bg-purple-50 text-purple-600 border-purple-200'
    },
    // 10. 节日 - 浪漫粉 (元宵)
    pink: {
        label: '浪漫粉',
        rgb: '236 72 153',
        gradient: 'from-pink-400 to-rose-500',
        shadow: 'shadow-pink-500/30',
        border: 'border-pink-200',
        soft: 'bg-pink-50 text-pink-600 border-pink-200'
    },
    // 11. 通用 - 玫瑰红
    rose: {
        label: '玫瑰红',
        rgb: '244 63 94',
        gradient: 'from-rose-500 to-red-600',
        shadow: 'shadow-rose-500/30',
        border: 'border-rose-200',
        soft: 'bg-rose-50 text-rose-600 border-rose-200'
    },
    // 12. 节日 - 水墨灰 (清明)
    slate: {
        label: '水墨灰',
        rgb: '100 116 139',
        gradient: 'from-slate-500 to-gray-700',
        shadow: 'shadow-slate-500/30',
        border: 'border-slate-200',
        soft: 'bg-slate-100 text-slate-600 border-slate-200'
    }
};

export const DEFAULT_SYSTEM_EFFECTS = Object.freeze({
    loginVisualFloat: true,
    loginEntrance: true,
    dashboardCardReveal: true,
    wallpaperReveal: true
});
