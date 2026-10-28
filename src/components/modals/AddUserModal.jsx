import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Calculator, CheckCheck, Eraser, Eye, EyeOff, Loader2, ShieldCheck, UserPlus, X, Search } from 'lucide-react';
import { notify } from '../../utils/uiFeedback';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import ModulePermissionSelector, { BatchPermissionTimeEditor } from './ModulePermissionSelector';
import { applySelectedTimeRules, clearSelectedTimeRules, getPermissionCounts } from '../../utils/permissionTime';

const ROLE_LABELS = { admin: '管理员', teacher: '教师', student: '学生' };
const ROLE_OPTIONS = {
    super_admin: ['admin', 'teacher', 'student'],
    admin: ['teacher', 'student'],
    teacher: ['student']
};
const defaultRoleFor = actorRole => {
    const roles = ROLE_OPTIONS[actorRole] || [];
    if (roles.includes('teacher')) return 'teacher';
    if (roles.includes('student')) return 'student';
    return roles[0] || 'student';
};
const EMPTY_SINGLE_FORM = { username: '', email: '', password: '' };
const DEFAULT_BATCH_FORM = {
    prefix: 'ST',
    startNum: 1,
    count: 20,
    password: '',
    emailSuffix: '@student.com'
};

const AddUserModal = ({ isOpen, onClose, onAdd, currentUser, classes = [], allLinks = [], agentPlatforms = [] }) => {
    const [mode, setMode] = useState('single');
    const [loading, setLoading] = useState(false);
    const allowedRoles = useMemo(() => ROLE_OPTIONS[currentUser?.role] || [], [currentUser?.role]);
    const [selectedRole, setSelectedRole] = useState(() => defaultRoleFor(currentUser?.role));
    const [selectedClassId, setSelectedClassId] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [permissionIds, setPermissionIds] = useState([]);
    const [permissionTimeRules, setPermissionTimeRules] = useState({});
    const [expandedPermissionTimeId, setExpandedPermissionTimeId] = useState(null);
    const [showBatchTimeEditor, setShowBatchTimeEditor] = useState(false);
    const [batchTime, setBatchTime] = useState({ unlockTime: '', lockTime: '' });
    const [permissionSearchTerm, setPermissionSearchTerm] = useState('');
    const [singleForm, setSingleForm] = useState(EMPTY_SINGLE_FORM);
    const [batchForm, setBatchForm] = useState(DEFAULT_BATCH_FORM);
    const dialogRef = useModalAccessibility(isOpen, onClose);

    useEffect(() => {
        if (!isOpen) return;
        setMode('single');
        setLoading(false);
        setSingleForm(EMPTY_SINGLE_FORM);
        setBatchForm(DEFAULT_BATCH_FORM);
        setShowPassword(false);
        setSelectedRole(defaultRoleFor(currentUser?.role));
        setSelectedClassId(classes[0]?.id ? String(classes[0].id) : '');
        setPermissionIds([]);
        setPermissionTimeRules({});
        setExpandedPermissionTimeId(null);
        setShowBatchTimeEditor(false);
        setBatchTime({ unlockTime: '', lockTime: '' });
        setPermissionSearchTerm('');
    }, [isOpen, allowedRoles, classes, currentUser?.role]);

    const batchPreview = useMemo(() => {
        const prefix = batchForm.prefix.trim();
        const start = Number.parseInt(batchForm.startNum, 10);
        const count = Number.parseInt(batchForm.count, 10);
        const rawSuffix = batchForm.emailSuffix.trim();
        if (!prefix || !Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count < 1 || count > 200 || !rawSuffix) return [];

        const suffix = rawSuffix.startsWith('@') ? rawSuffix : `@${rawSuffix}`;
        const last = start + count - 1;
        const digits = Math.max(2, String(last).length);
        return Array.from({ length: count }, (_, offset) => {
            const username = `${prefix}${String(start + offset).padStart(digits, '0')}`;
            return {
                username,
                email: `${username.toLowerCase()}${suffix}`,
                password: batchForm.password,
                valid: true
            };
        });
    }, [batchForm]);

    const updateSingle = (field, value) => setSingleForm(current => ({ ...current, [field]: value }));
    const updateBatch = (field, value) => setBatchForm(current => ({ ...current, [field]: value }));
    const togglePermissionId = id => setPermissionIds(prev => (prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]));
    const updatePermissionTimeRule = (linkId, type, value) => setPermissionTimeRules(prev => ({ ...prev, [linkId]: { ...prev[linkId], [type]: value } }));
    const updateBatchTime = (field, value) => setBatchTime(previous => ({ ...previous, [field]: value }));
    const applyBatchTime = () => {
        if (!permissionIds.length || (!batchTime.unlockTime && !batchTime.lockTime)) return;
        setPermissionTimeRules(previous => applySelectedTimeRules(previous, permissionIds, batchTime));
        setShowBatchTimeEditor(false);
        notify(`已为 ${permissionIds.length} 个模块统一设置时间`, 'success');
    };
    const clearBatchTime = () => {
        if (!permissionIds.length) return;
        setPermissionTimeRules(previous => clearSelectedTimeRules(previous, permissionIds));
        setBatchTime({ unlockTime: '', lockTime: '' });
        setShowBatchTimeEditor(false);
        notify(`已清空 ${permissionIds.length} 个模块的专属时间`, 'success');
    };

    const handleSubmit = async () => {
        setLoading(true);
        try {
            let usersToAdd;
            if (mode === 'single') {
                if (!singleForm.username.trim() || !singleForm.password || !singleForm.email.trim()) throw new Error('请填写完整信息');
                if (singleForm.password.length < 6) throw new Error('密码至少需要 6 位');
                usersToAdd = [{
                    username: singleForm.username.trim(),
                    email: singleForm.email.trim(),
                    password: singleForm.password,
                    ...(selectedRole === 'teacher' ? { permissions: permissionIds, timeRules: permissionTimeRules } : {})
                }];
            } else {
                if (!batchPreview.length) throw new Error('请检查账号前缀、起始编号、生成数量和邮箱后缀');
                if (batchForm.password.length < 6) throw new Error('统一密码至少需要 6 位');
                usersToAdd = batchPreview.map(user => ({
                    ...user,
                    ...(selectedRole === 'teacher' ? { permissions: permissionIds, timeRules: permissionTimeRules } : {})
                }));
            }

            if (selectedRole === 'student' && !selectedClassId) throw new Error('请先选择学生所属班级；如果没有班级，请先创建教师账号');
            await onAdd(usersToAdd.map(user => ({
                ...user,
                role: selectedRole,
                classId: selectedRole === 'student' ? Number(selectedClassId) : null
            })));
            onClose();
        } catch (error) {
            notify(`操作失败：${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const firstBatchAccount = batchPreview[0];
    const lastBatchAccount = batchPreview[batchPreview.length - 1];
    const allPermissionsSelected = allLinks.length > 0 && allLinks.every(link => permissionIds.includes(link.id));
    const permissionCounts = getPermissionCounts(allLinks, permissionIds);
    const selectedPermissionCount = permissionCounts.selectedPlatform + permissionCounts.selectedAgent;
    const permissionControl = (
        <section className={`flex min-h-0 h-full flex-col rounded-2xl border p-3 ${selectedRole === 'teacher' ? 'border-violet-100 bg-violet-50/30' : 'border-slate-200 bg-slate-50/80'}`} aria-labelledby="add-user-permission-title">
            <div className="mb-2.5 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${selectedRole === 'teacher' ? 'bg-violet-100 text-violet-600' : 'bg-slate-200 text-slate-500'}`}><ShieldCheck className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0">
                        <h4 id="add-user-permission-title" className="text-sm font-black text-slate-700">模块权限与时间控制</h4>
                        <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{selectedRole === 'teacher' ? '为新教师分配可见模块，并按需设置专属开放时间。' : selectedRole === 'student' ? '新建学生默认无模块权限，请创建后在用户列表中分配。' : `${ROLE_LABELS[selectedRole] || '当前角色'}账号默认拥有全部模块权限。`}</p>
                    </div>
                </div>
                {selectedRole === 'teacher' && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold"><span className="text-slate-400">已选</span><span className="text-indigo-600">{permissionCounts.selectedPlatform} 个平台</span><span className="text-slate-300">·</span><span className="text-violet-600">{permissionCounts.selectedAgent} 个智能体</span></div>}
            </div>
            {selectedRole === 'teacher' ? <>
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input type="text" value={permissionSearchTerm} onChange={event => setPermissionSearchTerm(event.target.value)} placeholder="搜索模块 / 类目名称" className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs outline-none focus:border-violet-400" />
                    </div>
                    <span className="shrink-0 text-[10px] font-bold text-slate-400">共 {permissionCounts.totalPlatform} 个平台 · {permissionCounts.totalAgent} 个智能体</span>
                </div>
                <div className="min-h-0 max-h-[24rem] flex-1 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 bg-white p-2.5 lg:max-h-none">
                    <ModulePermissionSelector allLinks={allLinks} selectedIds={permissionIds} timeRules={permissionTimeRules} expandedTimeId={expandedPermissionTimeId} searchTerm={permissionSearchTerm} agentPlatforms={agentPlatforms} onToggleId={togglePermissionId} onUpdateTimeRule={updatePermissionTimeRule} onToggleTime={setExpandedPermissionTimeId} />
                </div>
                <div className="mt-2 rounded-xl border border-slate-200 bg-white/90 px-2.5 py-2 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2"><span className="text-[10px] font-medium text-slate-400">批量操作</span><span className="text-[10px] font-bold text-slate-500">已选 {permissionCounts.selectedPlatform} 个平台 · {permissionCounts.selectedAgent} 个智能体</span></div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <button type="button" onClick={() => setPermissionIds(allPermissionsSelected ? [] : allLinks.map(link => link.id))} disabled={!allLinks.length} className={`mc-button mc-button--secondary mc-button--compact !px-2.5 !text-[10px] disabled:opacity-40 ${allPermissionsSelected ? '!border-rose-200 !text-rose-600 hover:!bg-rose-50' : '!border-indigo-200 !text-indigo-600 hover:!bg-indigo-50'}`} aria-label={allPermissionsSelected ? '清空已选模块' : '全选模块'}>{allPermissionsSelected ? <Eraser className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />}{allPermissionsSelected ? '清空' : '全选'}</button>
                            <button type="button" onClick={() => setShowBatchTimeEditor(previous => !previous)} disabled={selectedPermissionCount === 0} aria-expanded={showBatchTimeEditor} aria-controls="add-user-batch-time-editor" className="mc-button mc-button--secondary mc-button--compact !border-violet-200 !px-2.5 !text-[10px] !text-violet-600 hover:!bg-violet-50 disabled:opacity-40"><CalendarClock className="h-3.5 w-3.5" />{showBatchTimeEditor ? '收起时间' : '统一设置时间'}</button>
                        </div>
                    </div>
                    {showBatchTimeEditor && <div id="add-user-batch-time-editor"><BatchPermissionTimeEditor selectedCount={selectedPermissionCount} selectedPlatformCount={permissionCounts.selectedPlatform} selectedAgentCount={permissionCounts.selectedAgent} unlockTime={batchTime.unlockTime} lockTime={batchTime.lockTime} onChange={updateBatchTime} onApply={applyBatchTime} onClear={clearBatchTime} /></div>}
                </div>
            </> : <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 px-5 text-center text-xs leading-5 text-slate-400">{ROLE_LABELS[selectedRole] || '当前角色'}的权限由系统角色和班级规则自动决定。</div>}
        </section>
    );


    return (
        <div className="mc-modal-backdrop mc-modal-backdrop--critical animate-in zoom-in-95">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-user-title" tabIndex={-1} className="mc-modal mc-modal--wide max-h-[84vh]">
                <div className="mc-modal__header">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-600"><UserPlus className="h-4 w-4" /></div>
                        <div>
                            <h3 id="add-user-title" className="text-base font-bold text-slate-800">添加账号</h3>
                            <p className="text-[11px] text-slate-400">左侧创建账号，右侧配置模块权限与时间控制。</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="关闭添加账号窗口" className="mc-icon-button mc-modal__close"><X className="h-5 w-5" /></button>
                </div>

                <div className="mc-modal__body custom-scrollbar flex-1 overflow-y-auto p-4 lg:flex lg:min-h-0 lg:overflow-hidden lg:p-0">
                    <div className="min-h-0 min-w-0 lg:flex-[0.9] lg:overflow-y-auto lg:p-5 lg:pr-4">
                    <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1 shadow-inner">
                        <button type="button" onClick={() => setMode('single')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold transition-all ${mode === 'single' ? 'bg-white text-indigo-600 shadow' : 'text-slate-500 hover:text-slate-700'}`}>
                            <UserPlus className="h-4 w-4" /> 单条添加
                        </button>
                        <button type="button" onClick={() => setMode('batch')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold transition-all ${mode === 'batch' ? 'bg-white text-indigo-600 shadow' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Calculator className="h-4 w-4" /> 批量生成
                        </button>
                    </div>

                    <div className="mb-5">
                        <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">账号角色</label>
                        <select className="theme-form-control w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-indigo-400" value={selectedRole} onChange={event => setSelectedRole(event.target.value)}>
                            {allowedRoles.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                        </select>
                    </div>

                    {selectedRole === 'student' && (
                        <div className="mb-5 rounded-xl border border-cyan-100 bg-cyan-50/50 p-4">
                            <label className="mb-1.5 block text-xs font-bold text-slate-600">所属班级</label>
                            <select
                                className="theme-form-control w-full rounded-xl border border-cyan-200 bg-white px-4 py-3 text-sm outline-none focus:border-cyan-500"
                                value={selectedClassId}
                                onChange={event => setSelectedClassId(event.target.value)}
                                disabled={currentUser?.role === 'teacher'}
                            >
                                {!classes.length && <option value="">暂无班级，请先创建教师账号</option>}
                                {classes.map(item => <option key={item.id} value={item.id}>{item.name}（教师：{item.teacherUsername}）</option>)}
                            </select>
                            <p className="mt-2 text-[11px] text-slate-500">教师创建的学生会自动加入自己的班级；管理员创建时需要指定班级。</p>
                        </div>
                    )}

                    {mode === 'single' ? (
                        <div className="space-y-4 animate-in slide-in-from-left-3 duration-300">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">用户名</label>
                                    <input className="mc-input" value={singleForm.username} onChange={event => updateSingle('username', event.target.value)} placeholder={selectedRole === 'teacher' ? '例如：teacher01' : selectedRole === 'admin' ? '例如：admin01' : '例如：student01'} autoFocus />
                                </div>
                                <div>
                                    <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">登录邮箱</label>
                                    <input type="email" className="mc-input" value={singleForm.email} onChange={event => updateSingle('email', event.target.value)} placeholder="user@example.com" />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">初始密码</label>
                                <div className="relative">
                                    <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="mc-input pr-11" value={singleForm.password} onChange={event => updateSingle('password', event.target.value)} placeholder="至少 6 位" />
                                    <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏初始密码' : '显示初始密码'} title={showPassword ? '隐藏初始密码' : '显示初始密码'} className="mc-icon-button !absolute !inset-y-0 !right-0 !h-full !w-11 !min-w-11 !rounded-xl !text-slate-400 hover:!text-indigo-600">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in slide-in-from-right-3 duration-300">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">账号前缀</label>
                                    <input className="mc-input font-mono" value={batchForm.prefix} onChange={event => updateBatch('prefix', event.target.value)} placeholder="例如：ST" />
                                </div>
                                <div>
                                    <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">统一密码</label>
                                    <div className="relative">
                                        <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="mc-input pr-11" value={batchForm.password} onChange={event => updateBatch('password', event.target.value)} placeholder="至少 6 位" />
                                        <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏统一密码' : '显示统一密码'} title={showPassword ? '隐藏统一密码' : '显示统一密码'} className="mc-icon-button !absolute !inset-y-0 !right-0 !h-full !w-11 !min-w-11 !rounded-xl !text-slate-400 hover:!text-indigo-600">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">起始编号</label>
                                    <input type="number" min="0" className="theme-form-control w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" value={batchForm.startNum} onChange={event => updateBatch('startNum', event.target.value)} />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">生成数量</label>
                                    <input type="number" min="1" max="200" className="theme-form-control w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" value={batchForm.count} onChange={event => updateBatch('count', event.target.value)} />
                                </div>
                                <p className="sm:col-span-2 text-[11px] text-slate-400">编号自动补零，一次最多创建 200 个账号。</p>
                            </div>

                            <div>
                                <label className="mb-1.5 ml-1 block text-xs font-bold text-slate-500">邮箱后缀</label>
                                <input className="mc-input" value={batchForm.emailSuffix} onChange={event => updateBatch('emailSuffix', event.target.value)} placeholder="@student.com" />
                            </div>

                            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-800">
                                {batchPreview.length ? (
                                    <><span className="font-black">将创建 {batchPreview.length} 个账号</span><span className="ml-2 font-mono text-indigo-600">{firstBatchAccount.username}{batchPreview.length > 1 ? ` — ${lastBatchAccount.username}` : ''}</span></>
                                ) : (
                                    <span className="text-indigo-500">填写有效的账号范围后，这里会显示生成摘要。</span>
                                )}
                            </div>
                        </div>
                    )}
                    </div>
                    <div className="my-4 hidden w-px shrink-0 bg-gradient-to-b from-transparent via-slate-200 to-transparent lg:block" role="separator" aria-orientation="vertical" />
                    <div className="min-h-0 min-w-0 lg:flex-[1.1] lg:overflow-hidden lg:p-5 lg:pl-4">{permissionControl}</div>
                </div>

                <div className="mc-modal__footer">
                    <button type="button" onClick={onClose} className="mc-button mc-button--secondary">取消</button>
                    <button type="button" onClick={handleSubmit} disabled={loading} className="mc-button mc-button--primary">
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                        {loading ? '处理中…' : mode === 'single' ? '添加账号' : `批量生成 (${batchPreview.length})`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddUserModal;
