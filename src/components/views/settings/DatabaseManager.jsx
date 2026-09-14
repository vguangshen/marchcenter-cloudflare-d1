import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cloud, Database, Download, HardDrive, Loader2, RefreshCw, Server } from 'lucide-react';
import { api } from '../../../utils/api';
import { notify } from '../../../utils/uiFeedback';

const DatabaseManager = ({ token }) => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [backingUp, setBackingUp] = useState(false);

    const loadStatus = async () => {
        setLoading(true);
        try {
            const data = await api.get('/database/status');
            setStatus(data);
        } catch (error) {
            setStatus({ connected: false, error: error.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadStatus(); }, [token]);

    const downloadBackup = async () => {
        setBackingUp(true);
        try {
            const { blob, headers } = await api.blob('/database/backup', { method: 'POST', fallback: '备份失败' });
            const disposition = headers.get('content-disposition') || '';
            const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `marchcenter-d1-${Date.now()}.sql`;
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            notify(error.message, 'error');
        } finally {
            setBackingUp(false);
        }
    };

    const metrics = [
        { icon: Activity, label: '连接状态', value: loading ? '检测中' : status?.connected ? '连接正常' : '连接异常' },
        { icon: Cloud, label: '数据库类型', value: 'Cloudflare D1' },
        { icon: HardDrive, label: '数据库大小', value: status?.connected && status.sizeMb != null ? `${status.sizeMb} MB` : '控制台查看' },
        { icon: Server, label: '数据表', value: status?.connected ? `${status.tableCount} 张` : '--' }
    ];

    return <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><Database className="h-6 w-6 text-indigo-500" />Cloudflare D1</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">数据库连接由 Cloudflare Worker 的 DB binding 管理。</p>
            </div>
            <div className="flex gap-2">
                <button onClick={loadStatus} disabled={loading} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</button>
                <button onClick={downloadBackup} disabled={backingUp || !status?.connected} className="flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-bold text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}下载 SQL 备份</button>
            </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(item => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70"><div className="flex items-center gap-2"><item.icon className="h-4 w-4 text-indigo-500" /><span className="text-[10px] font-bold text-slate-400">{item.label}</span></div><div className="mt-2 text-lg font-black text-slate-800 dark:text-slate-100">{item.value}</div></div>)}</div>

        {status?.error && <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{status.error}</div>}

        <section className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h2 className="font-black text-slate-800 dark:text-white">绑定信息</h2>
                    <p className="mt-1 text-xs text-slate-400">修改数据库名称或绑定时，请编辑 wrangler.jsonc 后重新部署。</p>
                </div>
                {status?.connected && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />{status.version || 'D1 SQLite'}</span>}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
                {[['Binding', status?.binding || 'DB'], ['Database', status?.databaseName || status?.database || 'marchcenter-db'], ['响应延迟', status?.connected ? `${status.latencyMs} ms` : '--']].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div><div className="mt-2 break-all text-sm font-black text-slate-700 dark:text-slate-200">{value}</div></div>)}
            </div>
        </section>

        <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-xs leading-5 text-blue-800 dark:border-blue-900 dark:bg-blue-950/25 dark:text-blue-300"><Cloud className="h-4 w-4 shrink-0" /><span>D1 不需要填写主机、端口、用户名或密码。生产数据库由 Cloudflare 控制台和 Wrangler 管理，页面只负责查看状态与导出小型 SQL 备份。</span></div>
    </div>;
};

export default DatabaseManager;
