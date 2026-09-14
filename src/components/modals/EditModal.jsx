import React, { useState, useEffect, useRef } from 'react';
import {
    X, Save, Edit2, Plus, CheckCircle2, Sparkles,
    CalendarClock, Network, Key, Loader2, Eye, EyeOff
} from 'lucide-react';

// 引入常量
import { THEMES } from '../../constants/themes';
import { SYSTEM_ICONS } from '../../constants/icons';
import { GLASS_INPUT, PRIMARY_BTN, DEFAULT_PROMPT_TEMPLATE } from '../../constants/config';
import { api } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { matchAccountApiService, matchPlatformDatabase, platformIdentity } from '../../utils/databaseAutoMatch';
import {
    ACCOUNT_SSO_METHODS, CLASS_TYPE_METHODS, PASSWORD_ALGORITHM_OPTIONS,
    SOAP_SSO_METHODS, SSO_METHOD_OPTIONS, defaultClassType,
    describeLinkTransport, parseSsoConfig
} from './competitionEditConfig';

const EditModal = ({ isOpen, onClose, onSave, initialData, existingCategories = [], existingTitles = [], ssoConfigs = [], authToken }) => {
    const dialogRef = useModalAccessibility(isOpen, onClose);
    const [formData, setFormData] = useState({
        title: '',
        subtitle: '',
        url: '',
        category: '默认',
        statusText: '长期开放',
        description: '',
        color: 'blue',
        logoBackground: 'transparent',
        customIcon: '',
        unlockTime: '',
        lockTime: '',
        customPrompt: '',
        ssoConfigId: '',
        ssoMethod: '',
        classType: '',
        accountApiId: '',
        accountDbProvider: '',
        accountDbName: '',
        accountTableName: '',
        accountUsernameColumn: '',
        accountPasswordColumn: '',
        accountPasswordAlgorithm: '',
        manualCredentialEnabled: false,
        restoreOriginalPasswordBeforeSso: false,
        restoreOriginalPasswordCiphertext: '',
        hasRestoreOriginalPasswordCiphertext: false,
        adminEntryEnabled: false,
        adminEntryUsername: '',
        adminEntryPassword: '',
        hasAdminEntryPassword: false,
        classDeleteMapping: null
    });
    const [showRestoreCiphertext, setShowRestoreCiphertext] = useState(false);
    const [showAdminEntryPassword, setShowAdminEntryPassword] = useState(false);
    const [adminEntryPasswordLoading, setAdminEntryPasswordLoading] = useState(false);
    const [adminEntryPasswordError, setAdminEntryPasswordError] = useState('');
    const [iconMode, setIconMode] = useState('system');
    const [logoLibrary, setLogoLibrary] = useState([]);
    const [logoLibraryLoading, setLogoLibraryLoading] = useState(false);
    const [logoLibraryError, setLogoLibraryError] = useState('');
    const [accountDatabases, setAccountDatabases] = useState([]);
    const [accountApiServices, setAccountApiServices] = useState([]);
    const [accountApiServicesError, setAccountApiServicesError] = useState('');
    const [accountDatabasesLoading, setAccountDatabasesLoading] = useState(false);
    const [accountDatabasesError, setAccountDatabasesError] = useState('');
    const [accountTables, setAccountTables] = useState([]);
    const [accountTablesLoading, setAccountTablesLoading] = useState(false);
    const [accountTablesError, setAccountTablesError] = useState('');
    const [accountColumns, setAccountColumns] = useState([]);
    const [accountColumnsLoading, setAccountColumnsLoading] = useState(false);
    const [accountColumnsError, setAccountColumnsError] = useState('');
    const [classDeleteDatabases, setClassDeleteDatabases] = useState([]);
    const [classDeleteDatabasesLoading, setClassDeleteDatabasesLoading] = useState(false);
    const [classDeleteDatabasesError, setClassDeleteDatabasesError] = useState('');
    const [classDeleteTables, setClassDeleteTables] = useState([]);
    const [classDeleteTablesLoading, setClassDeleteTablesLoading] = useState(false);
    const [classDeleteTablesError, setClassDeleteTablesError] = useState('');
    const [classDeleteColumns, setClassDeleteColumns] = useState([]);
    const [classDeleteColumnsLoading, setClassDeleteColumnsLoading] = useState(false);
    const [classDeleteColumnsError, setClassDeleteColumnsError] = useState('');
    const [classDeleteUserColumns, setClassDeleteUserColumns] = useState([]);
    const [classDeleteUserColumnsLoading, setClassDeleteUserColumnsLoading] = useState(false);
    const [classDeleteUserColumnsError, setClassDeleteUserColumnsError] = useState('');
    const [aiMappingScope, setAiMappingScope] = useState('');
    const [aiMappingMessage, setAiMappingMessage] = useState(null);
    const [connectionAutoMessage, setConnectionAutoMessage] = useState('');
    const matchingSsoConfigs = ssoConfigs.filter(item => (
        parseSsoConfig(item).method === formData.ssoMethod && parseSsoConfig(item).canaryOnly !== true
    ));
    // /sso-config is returned newest-first. Cards bind the latest saved
    // official configuration for the selected method without another chooser.
    const selectedSsoConfig = matchingSsoConfigs[0] || null;
    const usesOfficialAddress = Boolean(formData.ssoMethod);
    const linkTransport = describeLinkTransport(formData.url, formData.ssoMethod);
    const adminEntryUsesPlainHttp = (() => {
        try {
            return new URL(formData.url).protocol === 'http:';
        } catch {
            return false;
        }
    })();
    const supportsManualCredentials = ACCOUNT_SSO_METHODS.has(formData.ssoMethod);
    const requiresAccountDatabase = supportsManualCredentials && formData.manualCredentialEnabled;
    const hasSelectedSsoInstance = !formData.ssoMethod || Boolean(selectedSsoConfig);
    const requiresClassDeleteMapping = formData.ssoMethod === 'java' && Boolean(formData.classDeleteMapping?.enabled);
    const supportsAdminEntry = ['java', 'net'].includes(formData.ssoMethod);
    const requiresAdminEntry = supportsAdminEntry && formData.adminEntryEnabled;
    const hasCompleteClassDeleteMapping = Boolean(
        formData.classDeleteMapping?.apiId
        && formData.classDeleteMapping?.databaseName
        && formData.classDeleteMapping?.classTable
        && formData.classDeleteMapping?.classNameColumn
        && formData.classDeleteMapping?.classIdColumn
        && formData.classDeleteMapping?.userTable
        && formData.classDeleteMapping?.userClassColumn
    );
    const canSave = Boolean(formData.title && formData.url && hasSelectedSsoInstance && (!requiresAccountDatabase || (
        formData.accountApiId && formData.accountDbProvider && formData.accountDbName && formData.accountTableName &&
        formData.accountUsernameColumn && formData.accountPasswordColumn && formData.accountPasswordAlgorithm
    )) && (!requiresClassDeleteMapping || hasCompleteClassDeleteMapping) && (!requiresAdminEntry || (
        formData.adminEntryUsername && (formData.adminEntryPassword || formData.hasAdminEntryPassword)
    )));

    const fileInputRef = useRef(null);

    // 辅助函数：格式化时间
    const formatDateForInput = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const getNow = () => formatDateForInput(new Date());
    const addHour = (ts) => {
        const d = ts ? new Date(ts) : new Date();
        d.setHours(d.getHours() + 1);
        return formatDateForInput(d);
    };

    useEffect(() => {
        if (isOpen) {
            const data = initialData || {};
            setAiMappingScope('');
            setAiMappingMessage(null);
            setConnectionAutoMessage('');
            setFormData({
                title: data.title ?? '',
                subtitle: data.subtitle ?? '',
                url: data.url ?? '',
                category: data.category ?? '默认',
                statusText: data.statusText ?? '长期开放',
                description: data.description ?? '',
                color: data.color ?? 'blue',
                logoBackground: data.logoBackground ?? 'transparent',
                customIcon: data.customIcon ?? '',
                unlockTime: formatDateForInput(data.unlockTime),
                lockTime: formatDateForInput(data.lockTime),
                customPrompt: data.customPrompt ?? '',
                ssoConfigId: data.ssoConfigId || '',
                ssoMethod: data.ssoMethod || '',
                classType: data.classType ? String(data.classType) : (CLASS_TYPE_METHODS.has(data.ssoMethod) ? defaultClassType(data.ssoMethod) : ''),
                accountApiId: data.accountApiId || '',
                accountDbProvider: data.accountDbProvider || '',
                accountDbName: data.accountDbName || '',
                accountTableName: data.accountTableName || '',
                accountUsernameColumn: data.accountUsernameColumn || '',
                accountPasswordColumn: data.accountPasswordColumn || '',
                accountPasswordAlgorithm: data.accountPasswordAlgorithm || '',
                manualCredentialEnabled: data.manualCredentialEnabled === true || Number(data.manualCredentialEnabled) === 1,
                restoreOriginalPasswordBeforeSso: Boolean(data.restoreOriginalPasswordBeforeSso),
                restoreOriginalPasswordCiphertext: data.restoreOriginalPasswordCiphertext || '',
                hasRestoreOriginalPasswordCiphertext: Boolean(data.hasRestoreOriginalPasswordCiphertext),
                adminEntryEnabled: data.adminEntryEnabled === true || Number(data.adminEntryEnabled) === 1,
                adminEntryUsername: data.adminEntryUsername || '',
                adminEntryPassword: '',
                hasAdminEntryPassword: Boolean(data.hasAdminEntryPassword),
                classDeleteMapping: data.classDeleteMapping || null
            });
            setShowRestoreCiphertext(false);
            setShowAdminEntryPassword(false);
            setAdminEntryPasswordLoading(false);
            setAdminEntryPasswordError('');

            setIconMode((data.customIcon && data.customIcon.startsWith('sys:')) || !data.customIcon ? 'system' : 'upload');
        }
    }, [initialData, isOpen]);

    useEffect(() => {
        const cardId = Number(initialData?.id);
        const canRevealStoredPassword = isOpen
            && authToken
            && Number.isInteger(cardId)
            && cardId > 0
            && Boolean(initialData?.hasAdminEntryPassword)
            && Boolean(initialData?.adminEntryUsername)
            && ['java', 'net'].includes(initialData?.ssoMethod);
        if (!canRevealStoredPassword) return undefined;

        const controller = new AbortController();
        setAdminEntryPasswordLoading(true);
        setAdminEntryPasswordError('');
        api.get(`/sso/admin-credential/${cardId}`, {
            signal: controller.signal,
            fallback: '已保存密码读取失败',
            retry: 0
        }).then(data => {
            const credential = data?.credential;
            if (!credential || typeof credential.password !== 'string' || !credential.password) {
                throw new Error('平台未返回已保存密码');
            }
            setFormData(previous => ({
                ...previous,
                adminEntryUsername: String(credential.username || previous.adminEntryUsername),
                adminEntryPassword: credential.password,
                hasAdminEntryPassword: true
            }));
        }).catch(error => {
            if (error.name !== 'AbortError') {
                setAdminEntryPasswordError(error.message || '已保存密码读取失败');
            }
        }).finally(() => {
            if (!controller.signal.aborted) setAdminEntryPasswordLoading(false);
        });
        return () => controller.abort();
    }, [authToken, initialData, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const latest = formData.ssoMethod
            ? ssoConfigs.find(item => (
                parseSsoConfig(item).method === formData.ssoMethod
                && parseSsoConfig(item).canaryOnly !== true
            ))
            : null;
        const nextId = latest?.id || '';
        setFormData(previous => (
            String(previous.ssoConfigId || '') === String(nextId)
                ? previous
                : { ...previous, ssoConfigId: nextId }
        ));
    }, [formData.ssoMethod, isOpen, ssoConfigs]);

    useEffect(() => {
        if (!isOpen || !authToken) return undefined;
        const controller = new AbortController();
        setLogoLibraryLoading(true);
        setLogoLibraryError('');
        api.get('/logo-library', { signal: controller.signal }).then(data => {
            setLogoLibrary(Array.isArray(data) ? data : []);
        }).catch(error => {
            if (error.name !== 'AbortError') setLogoLibraryError(error.message || 'Logo 素材加载失败');
        }).finally(() => {
            if (!controller.signal.aborted) setLogoLibraryLoading(false);
        });
        return () => controller.abort();
    }, [authToken, isOpen]);

    useEffect(() => {
        if (!isOpen || !formData.manualCredentialEnabled || formData.accountApiId || !formData.url) return;
        const matched = matchAccountApiService(formData.url, accountApiServices);
        if (!matched) return;
        const identity = platformIdentity(formData.url);
        setFormData(previous => previous.accountApiId ? previous : {
            ...previous,
            accountApiId: matched.id,
            accountDbName: '', accountTableName: '', accountUsernameColumn: '', accountPasswordColumn: ''
        });
        setConnectionAutoMessage(`已根据跳转地址 ${identity.hostname} 匹配“${matched.name}”`);
    }, [accountApiServices, formData.accountApiId, formData.manualCredentialEnabled, formData.url, isOpen]);

    useEffect(() => {
        if (!isOpen || !authToken) return undefined;
        const controller = new AbortController();
        setAccountApiServicesError('');
        api.get('/account-management/services', { signal: controller.signal }).then(data => {
            const services = Array.isArray(data.services) ? data.services : [];
            setAccountApiServices(services);
            setFormData(previous => previous.accountApiId || services.filter(item => item.enabled).length !== 1
                ? previous : { ...previous, accountApiId: services.find(item => item.enabled).id });
        }).catch(error => {
            if (error.name !== 'AbortError') setAccountApiServicesError(error.message || '账号管理 API 列表读取失败');
        });
        return () => controller.abort();
    }, [authToken, isOpen]);

    useEffect(() => {
        if (!isOpen || !authToken || !formData.manualCredentialEnabled || !formData.accountApiId || !formData.accountDbProvider) {
            setAccountDatabases([]);
            setAccountDatabasesError('');
            return undefined;
        }
        const controller = new AbortController();
        setAccountDatabasesLoading(true);
        setAccountDatabasesError('');
        api.get(`/account-management/databases?apiId=${encodeURIComponent(formData.accountApiId)}&provider=${encodeURIComponent(formData.accountDbProvider)}`, {
            signal: controller.signal
        }).then(data => {
            setAccountDatabases(Array.isArray(data.databases) ? data.databases : []);
        }).catch(error => {
            if (error.name !== 'AbortError') {
                setAccountDatabases([]);
                setAccountDatabasesError(error.message || '数据库列表读取失败');
            }
        }).finally(() => {
            if (!controller.signal.aborted) setAccountDatabasesLoading(false);
        });
        return () => controller.abort();
    }, [authToken, formData.manualCredentialEnabled, formData.accountApiId, formData.accountDbProvider, isOpen]);

    useEffect(() => {
        if (!isOpen || !formData.manualCredentialEnabled || !formData.accountApiId || formData.accountDbName || accountDatabasesLoading) return;
        const matched = matchPlatformDatabase(formData.url, accountDatabases);
        if (!matched) return;
        const identity = platformIdentity(formData.url);
        setFormData(previous => previous.accountDbName ? previous : {
            ...previous,
            accountDbName: matched,
            accountTableName: '', accountUsernameColumn: '', accountPasswordColumn: ''
        });
        setConnectionAutoMessage(previous => `${previous ? `${previous}；` : ''}已根据软件代号 ${identity.code} 匹配数据库 ${matched}`);
    }, [accountDatabases, accountDatabasesLoading, formData.accountApiId, formData.accountDbName, formData.manualCredentialEnabled, formData.url, isOpen]);

    useEffect(() => {
        if (!isOpen || !formData.classDeleteMapping?.enabled || formData.accountDbProvider !== 'mysql') return;
        if (!formData.accountApiId || !formData.accountDbName) return;
        setFormData(previous => {
            const mapping = previous.classDeleteMapping || {};
            if (mapping.apiId && mapping.databaseName) return previous;
            return {
                ...previous,
                classDeleteMapping: {
                    ...mapping,
                    apiId: mapping.apiId || previous.accountApiId,
                    databaseName: mapping.databaseName || previous.accountDbName
                }
            };
        });
    }, [formData.accountApiId, formData.accountDbName, formData.accountDbProvider, formData.classDeleteMapping?.enabled, isOpen]);

    useEffect(() => {
        if (!isOpen || !authToken || !formData.manualCredentialEnabled || !formData.accountDbProvider || !formData.accountDbName) {
            setAccountTables([]);
            setAccountTablesError('');
            return undefined;
        }
        const controller = new AbortController();
        setAccountTablesLoading(true);
        setAccountTablesError('');
        api.get(`/account-management/tables?apiId=${encodeURIComponent(formData.accountApiId)}&provider=${encodeURIComponent(formData.accountDbProvider)}&databaseName=${encodeURIComponent(formData.accountDbName)}`, {
            signal: controller.signal
        }).then(data => {
            setAccountTables(Array.isArray(data.tables) ? data.tables : []);
        }).catch(error => {
            if (error.name !== 'AbortError') {
                setAccountTables([]);
                setAccountTablesError(error.message || '数据表列表读取失败');
            }
        }).finally(() => {
            if (!controller.signal.aborted) setAccountTablesLoading(false);
        });
        return () => controller.abort();
    }, [authToken, formData.manualCredentialEnabled, formData.accountApiId, formData.accountDbProvider, formData.accountDbName, isOpen]);

    useEffect(() => {
        if (!isOpen || !authToken || !formData.manualCredentialEnabled || !formData.accountDbProvider || !formData.accountDbName || !formData.accountTableName) {
            setAccountColumns([]);
            setAccountColumnsError('');
            return undefined;
        }
        const controller = new AbortController();
        setAccountColumnsLoading(true);
        setAccountColumnsError('');
        api.get(`/account-management/columns?apiId=${encodeURIComponent(formData.accountApiId)}&provider=${encodeURIComponent(formData.accountDbProvider)}&databaseName=${encodeURIComponent(formData.accountDbName)}&accountTable=${encodeURIComponent(formData.accountTableName)}`, {
            signal: controller.signal
        }).then(data => {
            setAccountColumns(Array.isArray(data.columns) ? data.columns : []);
        }).catch(error => {
            if (error.name !== 'AbortError') {
                setAccountColumns([]);
                setAccountColumnsError(error.message || '字段列表读取失败');
            }
        }).finally(() => {
            if (!controller.signal.aborted) setAccountColumnsLoading(false);
        });
        return () => controller.abort();
    }, [authToken, formData.manualCredentialEnabled, formData.accountApiId, formData.accountDbProvider, formData.accountDbName, formData.accountTableName, isOpen]);

    const {
        apiId: classDeleteApiId = '',
        databaseName: classDeleteDatabaseName = '',
        classTable: classDeleteClassTable = '',
        classIdColumn: classDeleteClassIdColumn = '',
        userTable: classDeleteUserTable = '',
        userClassColumn: classDeleteUserClassColumn = ''
    } = formData.classDeleteMapping || {};
    const classDeleteCascadeReady = Boolean(
        classDeleteClassIdColumn && classDeleteUserTable && classDeleteUserClassColumn
    );

    // Java 班级删除映射的数据库/班级表/班级名列选择器（JAVA 一律 MySQL）
    useEffect(() => {
        if (!isOpen || !authToken || !classDeleteApiId) {
            setClassDeleteDatabases([]); setClassDeleteDatabasesError(''); return undefined;
        }
        const controller = new AbortController();
        setClassDeleteDatabasesLoading(true); setClassDeleteDatabasesError('');
        api.get(`/account-management/databases?apiId=${encodeURIComponent(classDeleteApiId)}&provider=mysql`, { signal: controller.signal })
            .then(data => setClassDeleteDatabases(Array.isArray(data.databases) ? data.databases : []))
            .catch(error => { if (error.name !== 'AbortError') { setClassDeleteDatabases([]); setClassDeleteDatabasesError(error.message || '数据库列表读取失败'); } })
            .finally(() => { if (!controller.signal.aborted) setClassDeleteDatabasesLoading(false); });
        return () => controller.abort();
    }, [authToken, classDeleteApiId, isOpen]);

    useEffect(() => {
        if (!isOpen || !authToken || !classDeleteApiId || !classDeleteDatabaseName) {
            setClassDeleteTables([]); setClassDeleteTablesError(''); return undefined;
        }
        const controller = new AbortController();
        setClassDeleteTablesLoading(true); setClassDeleteTablesError('');
        api.get(`/account-management/tables?apiId=${encodeURIComponent(classDeleteApiId)}&provider=mysql&databaseName=${encodeURIComponent(classDeleteDatabaseName)}`, { signal: controller.signal })
            .then(data => setClassDeleteTables(Array.isArray(data.tables) ? data.tables : []))
            .catch(error => { if (error.name !== 'AbortError') { setClassDeleteTables([]); setClassDeleteTablesError(error.message || '数据表列表读取失败'); } })
            .finally(() => { if (!controller.signal.aborted) setClassDeleteTablesLoading(false); });
        return () => controller.abort();
    }, [authToken, classDeleteApiId, classDeleteDatabaseName, isOpen]);

    useEffect(() => {
        if (!isOpen || !authToken || !classDeleteApiId || !classDeleteDatabaseName || !classDeleteClassTable) {
            setClassDeleteColumns([]); setClassDeleteColumnsError(''); return undefined;
        }
        const controller = new AbortController();
        setClassDeleteColumnsLoading(true); setClassDeleteColumnsError('');
        api.get(`/account-management/columns?apiId=${encodeURIComponent(classDeleteApiId)}&provider=mysql&databaseName=${encodeURIComponent(classDeleteDatabaseName)}&accountTable=${encodeURIComponent(classDeleteClassTable)}`, { signal: controller.signal })
            .then(data => setClassDeleteColumns(Array.isArray(data.columns) ? data.columns : []))
            .catch(error => { if (error.name !== 'AbortError') { setClassDeleteColumns([]); setClassDeleteColumnsError(error.message || '字段列表读取失败'); } })
            .finally(() => { if (!controller.signal.aborted) setClassDeleteColumnsLoading(false); });
        return () => controller.abort();
    }, [authToken, classDeleteApiId, classDeleteDatabaseName, classDeleteClassTable, isOpen]);

    // 级联删除用户的"用户表字段"选择器
    useEffect(() => {
        if (!isOpen || !authToken || !classDeleteApiId || !classDeleteDatabaseName || !classDeleteUserTable) {
            setClassDeleteUserColumns([]); setClassDeleteUserColumnsError(''); return undefined;
        }
        const controller = new AbortController();
        setClassDeleteUserColumnsLoading(true); setClassDeleteUserColumnsError('');
        api.get(`/account-management/columns?apiId=${encodeURIComponent(classDeleteApiId)}&provider=mysql&databaseName=${encodeURIComponent(classDeleteDatabaseName)}&accountTable=${encodeURIComponent(classDeleteUserTable)}`, { signal: controller.signal })
            .then(data => setClassDeleteUserColumns(Array.isArray(data.columns) ? data.columns : []))
            .catch(error => { if (error.name !== 'AbortError') { setClassDeleteUserColumns([]); setClassDeleteUserColumnsError(error.message || '字段列表读取失败'); } })
            .finally(() => { if (!controller.signal.aborted) setClassDeleteUserColumnsLoading(false); });
        return () => controller.abort();
    }, [authToken, classDeleteApiId, classDeleteDatabaseName, classDeleteUserTable, isOpen]);

    const updateClassDelete = (key, value) => {
        setAiMappingMessage(null);
        setFormData(previous => {
            const mapping = { ...(previous.classDeleteMapping || {}), [key]: value };
            if (key === 'apiId') {
                Object.assign(mapping, {
                    databaseName: '', classTable: '', classNameColumn: '',
                    classIdColumn: '', userTable: '', userClassColumn: ''
                });
            } else if (key === 'databaseName') {
                Object.assign(mapping, {
                    classTable: '', classNameColumn: '', classIdColumn: '',
                    userTable: '', userClassColumn: ''
                });
            } else if (key === 'classTable') {
                Object.assign(mapping, { classNameColumn: '', classIdColumn: '' });
            } else if (key === 'userTable') {
                mapping.userClassColumn = '';
            }
            return { ...previous, classDeleteMapping: mapping };
        });
    };
    const toggleClassDelete = (enabled) => {
        setAiMappingMessage(null);
        setFormData(previous => ({
            ...previous,
            classDeleteMapping: {
                ...(previous.classDeleteMapping || {}),
                enabled,
                ...(!previous.classDeleteMapping?.apiId && previous.accountDbProvider === 'mysql' && previous.accountApiId
                    ? { apiId: previous.accountApiId } : {}),
                ...(!previous.classDeleteMapping?.databaseName && previous.accountDbProvider === 'mysql' && previous.accountDbName
                    ? { databaseName: previous.accountDbName } : {})
            }
        }));
    };
    const runAiMapping = async (scope) => {
        const isClassDelete = scope === 'classDelete';
        const apiId = isClassDelete ? classDeleteApiId : formData.accountApiId;
        const databaseName = isClassDelete ? classDeleteDatabaseName : formData.accountDbName;
        const provider = isClassDelete ? 'mysql' : formData.accountDbProvider;
        if (!apiId || !databaseName || !provider) {
            setAiMappingMessage({ type: 'error', scope, text: '请先选择 API 服务器和数据库名称' });
            return;
        }
        setAiMappingScope(scope);
        setAiMappingMessage({ type: 'loading', scope, text: 'AI 正在读取表结构并识别映射…' });
        try {
            const result = await api.post('/ai/database-mapping', {
                scope, apiId, provider, databaseName,
                ssoMethod: formData.ssoMethod,
                title: formData.title,
                category: formData.category
            }, { timeoutMs: 150_000 });
            const suggestion = result.suggestion || {};
            if (isClassDelete) {
                setFormData(previous => ({
                    ...previous,
                    classDeleteMapping: {
                        ...(previous.classDeleteMapping || {}),
                        apiId,
                        databaseName,
                        classTable: suggestion.classTable || '',
                        classNameColumn: suggestion.classNameColumn || '',
                        classIdColumn: suggestion.classIdColumn || '',
                        userTable: suggestion.userTable || '',
                        userClassColumn: suggestion.userClassColumn || ''
                    }
                }));
            } else {
                setFormData(previous => ({
                    ...previous,
                    accountTableName: suggestion.accountTableName || '',
                    accountUsernameColumn: suggestion.accountUsernameColumn || '',
                    accountPasswordColumn: suggestion.accountPasswordColumn || '',
                    accountPasswordAlgorithm: suggestion.accountPasswordAlgorithm || ''
                }));
            }
            setAiMappingMessage({
                type: 'success', scope,
                text: `AI 已填充${suggestion.confidence === 'high' ? '高可信' : suggestion.confidence === 'low' ? '低可信' : '中等可信'}映射${suggestion.reason ? `：${suggestion.reason}` : ''}`
            });
        } catch (error) {
            setAiMappingMessage({ type: 'error', scope, text: error.message || 'AI 自动识别失败' });
        } finally {
            setAiMappingScope('');
        }
    };
    const rememberUploadedLogo = async (dataUrl) => {
        const optimistic = { id: `local-${Date.now()}`, dataUrl };
        setLogoLibrary(previous => [optimistic, ...previous.filter(item => item.dataUrl !== dataUrl)]);
        setLogoLibraryError('');
        try {
            const item = await api.post('/logo-library', { dataUrl });
            setLogoLibrary(previous => [item, ...previous.filter(entry => entry.dataUrl !== dataUrl)]);
        } catch (error) {
            setLogoLibraryError(`${error.message || 'Logo 素材保存失败'}，本次仍可用于当前卡片`);
        }
    };

    const handleFile = (e) => {
        const file = e.target.files[0];
        const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
        if (file && !supportedTypes.has(file.type)) {
            notify('仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片', 'warning');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
        if (file && file.size <= 100 * 1024) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = String(reader.result || '');
                setFormData(previous => ({ ...previous, customIcon: dataUrl }));
                setIconMode('upload');
                rememberUploadedLogo(dataUrl);
                if (fileInputRef.current) fileInputRef.current.value = '';
            };
            reader.readAsDataURL(file);
        } else { notify('图片需小于 100KB', 'warning'); }
    };

    const renderPreview = () => {
        if (formData.customIcon?.startsWith('sys:')) {
            const Icon = SYSTEM_ICONS[formData.customIcon.split(':')[1]]?.icon || Sparkles;
            return <Icon className="h-8 w-8" style={{ color: `rgb(${THEMES[formData.color]?.rgb || THEMES.blue.rgb})` }} />;
        }
        if (formData.customIcon) return <img src={formData.customIcon} className="block h-full w-full object-contain p-1.5" alt="preview" />;
        return <span className="text-xl font-bold text-slate-400">{formData.category?.[0]?.toUpperCase()}</span>;
    };

    const handleSetForever = () => {
        setFormData({ ...formData, unlockTime: '', lockTime: '' });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-competition-title" tabIndex={-1} className="edit-competition-modal flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl outline-none duration-200 animate-in zoom-in-95">
                <div className="edit-competition-modal__header flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4 backdrop-blur-md">
                    <h3 id="edit-competition-title" className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        {initialData ? <Edit2 className="w-5 h-5 text-indigo-500"/> : <Plus className="w-5 h-5 text-indigo-500"/>}
                        {initialData ? '编辑竞赛卡片' : '添加新竞赛'}
                    </h3>
                    <button onClick={onClose} aria-label="关闭竞赛卡片编辑窗口" className="bg-slate-200/50 hover:bg-slate-300/50 p-1.5 rounded-full transition-colors"><X className="w-4 h-4 text-slate-600" /></button>
                </div>

                <div className="edit-competition-modal__body custom-scrollbar space-y-6 overflow-y-auto bg-white p-6">
                    {/* 1. 图标选择 */}
                    <div className="flex gap-4">
                        <div className={`edit-logo-preview ${formData.logoBackground === 'white' ? 'edit-logo-white-surface bg-white' : ''} w-20 h-20 rounded-2xl border-2 flex items-center justify-center shrink-0 overflow-hidden ${formData.logoBackground !== 'white' && formData.logoBackground !== 'transparent' ? `bg-gradient-to-br ${THEMES[formData.logoBackground]?.gradient || THEMES.blue.gradient}` : formData.logoBackground === 'transparent' ? 'bg-transparent' : ''} ${formData.customIcon ? 'border-indigo-500' : 'border-dashed border-slate-300'}`}>
                            {renderPreview()}
                        </div>
                        <div className="flex-1 space-y-2">
                            <div className="relative flex bg-slate-200/60 p-1 rounded-lg isolate">
                                <div className={`absolute inset-y-1 w-[calc(50%-4px)] bg-white shadow-sm rounded-md transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-0 ${iconMode === 'system' ? 'left-1' : 'left-[calc(50%+2px)]'}`}/>
                                <button type="button" onClick={() => setIconMode('system')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors duration-300 z-10 relative ${iconMode === 'system' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>系统图标</button>
                                <button type="button" onClick={() => setIconMode('upload')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors duration-300 z-10 relative ${iconMode === 'upload' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>上传图片</button>
                            </div>
                            {iconMode === 'system' ? (
                                <div className="grid grid-cols-6 gap-2 h-20 overflow-y-auto custom-scrollbar p-1">
                                    {Object.entries(SYSTEM_ICONS).map(([k, {icon: I}]) => (
                                        <button key={k} onClick={() => setFormData({...formData, customIcon: `sys:${k}`})} className={`p-1.5 rounded-lg hover:bg-slate-100 flex justify-center ${formData.customIcon === `sys:${k}` ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400'}`}><I className="w-4 h-4"/></button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => fileInputRef.current.click()} className="flex-1 bg-slate-50 border border-slate-200 text-xs py-2 rounded-lg hover:bg-slate-100 font-medium text-slate-600">选择文件</button>
                                        <input type="file" ref={fileInputRef} hidden accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={handleFile} />
                                        <input value={!formData.customIcon?.startsWith('sys:') ? formData.customIcon : ''} onChange={e=>setFormData({...formData, customIcon: e.target.value})} placeholder="或输入URL" className="theme-form-control flex-[2] bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs outline-none focus:border-indigo-500"/>
                                    </div>
                                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-2">
                                        <div className="mb-1.5 flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-slate-500">已上传 Logo</span>
                                            <span className="text-[9px] text-slate-400">点击即可复用</span>
                                        </div>
                                        {logoLibraryLoading ? (
                                            <div className="flex h-10 items-center justify-center gap-1.5 text-[10px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在加载素材</div>
                                        ) : logoLibrary.length ? (
                                            <div className="grid max-h-[92px] grid-cols-6 gap-1.5 overflow-y-auto p-0.5 custom-scrollbar">
                                                {logoLibrary.map(item => (
                                                    <button
                                                        type="button"
                                                        key={item.id}
                                                        title="使用这个 Logo"
                                                        onClick={() => setFormData(previous => ({ ...previous, customIcon: item.dataUrl }))}
                                                        className={`edit-logo-white-surface relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-white p-1 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm ${formData.customIcon === item.dataUrl ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'}`}
                                                    >
                                                        <img src={item.dataUrl} alt="已上传 Logo" className="h-full w-full object-contain" />
                                                        {formData.customIcon === item.dataUrl && <CheckCircle2 className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white text-indigo-600" />}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex h-10 items-center justify-center text-[10px] text-slate-400">上传后的 Logo 会保存在这里</div>
                                        )}
                                        {logoLibraryError && <p className="mt-1 text-[9px] leading-3 text-amber-600">{logoLibraryError}</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 2. Logo 背景色 */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-3 block tracking-wider">Logo 背景色</label>
                        <div className="flex gap-3 overflow-x-auto py-4 px-2 custom-scrollbar items-center">
                            <button
                                type="button"
                                title="透明"
                                onClick={() => setFormData({...formData, logoBackground: 'transparent'})}
                                className={`relative w-9 h-9 rounded-full flex-shrink-0 overflow-hidden border border-slate-200 transition-all ${formData.logoBackground === 'transparent' ? 'ring-2 ring-offset-2 ring-slate-300 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'}`}
                                style={{ backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)', backgroundSize: '10px 10px', backgroundPosition: '0 0,0 5px,5px -5px,-5px 0' }}
                            >
                                <span className="absolute inset-0 m-auto w-7 h-0.5 bg-red-400 -rotate-45 rounded-full" />
                                {formData.logoBackground === 'transparent' && <CheckCircle2 className="w-4 h-4 text-slate-700 absolute inset-0 m-auto drop-shadow-sm" />}
                            </button>
                            <button
                                type="button"
                                title="白色"
                                onClick={() => setFormData({...formData, logoBackground: 'white'})}
                                className={`edit-logo-white-surface relative h-9 w-9 flex-shrink-0 rounded-full border border-slate-300 bg-white shadow-inner transition-all ${formData.logoBackground === 'white' ? 'scale-110 ring-2 ring-slate-300 ring-offset-2' : 'opacity-70 hover:scale-105 hover:opacity-100'}`}
                            >
                                {formData.logoBackground === 'white' && <CheckCircle2 className="absolute inset-0 m-auto h-4 w-4 text-indigo-600" />}
                            </button>
                            {Object.entries(THEMES).map(([key, theme]) => (
                                <button type="button" key={key} onClick={() => setFormData({...formData, logoBackground: key})}
                                        className={`relative w-9 h-9 rounded-full bg-gradient-to-br ${theme.gradient} flex-shrink-0 transition-all ${formData.logoBackground === key ? 'ring-2 ring-offset-2 ring-slate-300 scale-110' : 'opacity-60 hover:opacity-100 hover:scale-105'}`}>
                                    {formData.logoBackground === key && <CheckCircle2 className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow-sm" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 3. 基础信息 */}
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-3 block tracking-wider">卡片主题色</label>
                            <div className="flex gap-3 overflow-x-auto py-4 px-2 custom-scrollbar items-center">
                                <button
                                    type="button"
                                    title="无背景色"
                                    aria-label="无背景色"
                                    onClick={() => setFormData({...formData, color: 'transparent'})}
                                    className={`relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full border border-slate-200 transition-all ${formData.color === 'transparent' ? 'scale-110 ring-2 ring-slate-300 ring-offset-2' : 'opacity-70 hover:scale-105 hover:opacity-100'}`}
                                    style={{ backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)', backgroundSize: '10px 10px', backgroundPosition: '0 0,0 5px,5px -5px,-5px 0' }}
                                >
                                    <span className="absolute inset-0 m-auto h-0.5 w-7 -rotate-45 rounded-full bg-red-400" />
                                    {formData.color === 'transparent' && <CheckCircle2 className="absolute inset-0 m-auto h-4 w-4 text-slate-700 drop-shadow-sm" />}
                                </button>
                                <button
                                    type="button"
                                    title="白色"
                                    aria-label="白色"
                                    onClick={() => setFormData({...formData, color: 'white'})}
                                    className={`relative h-9 w-9 flex-shrink-0 rounded-full border border-slate-300 bg-white shadow-inner transition-all ${formData.color === 'white' ? 'scale-110 ring-2 ring-slate-300 ring-offset-2' : 'opacity-70 hover:scale-105 hover:opacity-100'}`}
                                >
                                    {formData.color === 'white' && <CheckCircle2 className="absolute inset-0 m-auto h-4 w-4 text-indigo-600" />}
                                </button>
                                {Object.entries(THEMES).map(([key, theme]) => (
                                    <button type="button" key={key} onClick={() => setFormData({...formData, color: key})}
                                            className={`relative w-9 h-9 rounded-full bg-gradient-to-br ${theme.gradient} flex-shrink-0 transition-all ${formData.color === key ? 'ring-2 ring-offset-2 ring-slate-300 scale-110' : 'opacity-60 hover:opacity-100 hover:scale-105'}`}>
                                        {formData.color === key && <CheckCircle2 className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow-sm" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">竞赛名称</label>
                                <input list="competition-title-history" value={formData.title} onChange={e=>setFormData({...formData, title: e.target.value})} className={`w-full px-3 py-2 rounded-xl text-sm ${GLASS_INPUT}`} placeholder="LeetCode 周赛" />
                                <datalist id="competition-title-history">{existingTitles.map(title => <option key={title} value={title} />)}</datalist>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 mb-1 block">分类</label>
                                <input list="competition-category-history" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} className={`w-full px-3 py-2 rounded-xl text-sm ${GLASS_INPUT}`} placeholder="算法" />
                                <datalist id="competition-category-history">{existingCategories.map(category => <option key={category} value={category} />)}</datalist>
                            </div>
                        </div>

                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1.5 ml-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> AI 专属提示词 (可选)
                            </label>
                            <div className="relative">
                                <textarea
                                    value={formData.customPrompt}
                                    onChange={e => setFormData({...formData, customPrompt: e.target.value})}
                                    rows="4"
                                    className={`w-full px-4 py-3 rounded-xl text-xs font-mono leading-relaxed ${GLASS_INPUT} resize-y min-h-[100px] border-indigo-100 focus:border-indigo-400`}
                                    placeholder={DEFAULT_PROMPT_TEMPLATE}
                                ></textarea>
                                <div className="absolute bottom-2 right-2 text-[10px] text-slate-400 bg-white/80 px-1 rounded">支持变量: {'{title}'}, {'{category}'}, {'{description}'}</div>
                            </div>
                        </div>

                        {/* 4. 时间控制 */}
                        <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100/50">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 text-orange-800 font-bold text-xs">
                                    <CalendarClock className="w-4 h-4" /> 时间控制 (可选)
                                </div>
                                <button type="button" onClick={handleSetForever} className="px-2 py-1 bg-white border border-orange-200 text-orange-600 rounded-lg text-[10px] font-bold hover:bg-orange-100 transition-colors shadow-sm">
                                    ♾️ 长期可用
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs font-bold text-slate-500">开始时间</label>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setFormData({ ...formData, unlockTime: getNow() })} className="text-[10px] text-blue-600 hover:underline font-bold">此刻</button>
                                            <button onClick={() => setFormData({ ...formData, unlockTime: addHour(formData.unlockTime) })} className="text-[10px] text-blue-600 hover:underline font-bold">+1小时</button>
                                        </div>
                                    </div>
                                    <input type="datetime-local" value={formData.unlockTime} onChange={e => setFormData({ ...formData, unlockTime: e.target.value })} className="theme-form-control w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:border-orange-400 outline-none" />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs font-bold text-slate-500">结束时间</label>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setFormData({ ...formData, lockTime: getNow() })} className="text-[10px] text-blue-600 hover:underline font-bold">此刻</button>
                                            <button onClick={() => setFormData({ ...formData, lockTime: addHour(formData.lockTime) })} className="text-[10px] text-blue-600 hover:underline font-bold">+1小时</button>
                                        </div>
                                    </div>
                                    <input type="datetime-local" value={formData.lockTime} onChange={e => setFormData({ ...formData, lockTime: e.target.value })} className="theme-form-control w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:border-orange-400 outline-none" />
                                </div>
                            </div>
                        </div>

                        {/* 5. 跳转链接 / official 编排接口地址 */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 mb-1 block">跳转链接 / 编排接口地址</label>
                            <input
                                value={formData.url}
                                onChange={e => setFormData({ ...formData, url: e.target.value })}
                                className={`w-full px-3 py-2 rounded-xl text-sm font-mono text-indigo-600 ${GLASS_INPUT}`}
                                placeholder={usesOfficialAddress && formData.ssoMethod === 'java'
                                    ? '例如：http://8.138.27.219:8872/DS50109'
                                    : usesOfficialAddress && SOAP_SSO_METHODS.has(formData.ssoMethod)
                                        ? '例如：http://8.138.27.219:8872/YX030105'
                                        : 'https://...'}
                            />
                            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                                {usesOfficialAddress && formData.ssoMethod !== 'direct'
                                    ? '填写被跳转系统的项目根地址。系统会根据所选接入方式自动拼接建班、建号和免密登录接口；不要填写 /open、WSDL 或具体接口方法。'
                                    : '直接跳转地址将作为最终地址使用；所有地址仍会经过服务端 URL 安全校验。'}
                            </p>
                            <div className={`mt-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                                linkTransport.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : linkTransport.tone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-700'
                                        : linkTransport.tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                            : linkTransport.tone === 'red' ? 'border-red-200 bg-red-50 text-red-700'
                                                : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}>
                                <div className="flex min-w-0 items-center gap-2">
                                    <Network className="h-4 w-4 shrink-0" />
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black">请求方式：{linkTransport.label}</div>
                                        <div className="mt-0.5 truncate text-[9px] opacity-75">{linkTransport.detail}</div>
                                    </div>
                                </div>
                                {['标准 Fetch', '受限服务端 Fetch'].includes(linkTransport.label) && (
                                    <span className="shrink-0 rounded-full bg-blue-200/70 px-2 py-1 font-mono text-[8px] font-black">FETCH</span>
                                )}
                            </div>
                        </div>

                        {/* ==================== 7. SSO 免密登录模块 ==================== */}
                        <div className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100/50 mt-4">
                            <label className="text-xs font-bold text-emerald-900 mb-2 block flex items-center gap-2">
                                <Key className="w-4 h-4"/> 免密一键登录配置 (SSO)
                            </label>

                            <div className="bg-white p-1 rounded-lg border border-emerald-100 shadow-sm">
                                <select
                                    className={`theme-form-control w-full px-3 py-2 rounded-md text-xs font-bold outline-none cursor-pointer ${formData.ssoMethod ? 'text-emerald-700 bg-emerald-50' : 'text-slate-400'}`}
                                    value={formData.ssoMethod}
                                    onChange={e => {
                                        const ssoMethod = e.target.value;
                                        setFormData({
                                            ...formData,
                                            ssoMethod,
                                            ssoConfigId: (() => {
                                                const matches = ssoConfigs.filter(item => parseSsoConfig(item).method === ssoMethod && parseSsoConfig(item).canaryOnly !== true);
                                                return matches[0]?.id || '';
                                            })(),
                                            classType: CLASS_TYPE_METHODS.has(ssoMethod) ? (formData.classType || defaultClassType(ssoMethod)) : '',
                                            accountDbProvider: ssoMethod === 'java' ? 'mysql' : SOAP_SSO_METHODS.has(ssoMethod) ? 'sqlserver' : '',
                                            accountApiId: formData.accountApiId || '',
                                            accountDbName: '',
                                            accountTableName: '',
                                            accountUsernameColumn: '',
                                            accountPasswordColumn: '',
                                            accountPasswordAlgorithm: '',
                                            manualCredentialEnabled: false,
                                            adminEntryEnabled: ['java', 'net'].includes(ssoMethod) ? formData.adminEntryEnabled : false,
                                            adminEntryUsername: ['java', 'net'].includes(ssoMethod) ? formData.adminEntryUsername : '',
                                            adminEntryPassword: ['java', 'net'].includes(ssoMethod) ? formData.adminEntryPassword : '',
                                            hasAdminEntryPassword: ['java', 'net'].includes(ssoMethod) ? formData.hasAdminEntryPassword : false,
                                            classDeleteMapping: ssoMethod === 'java' ? (formData.classDeleteMapping || null) : null
                                        });
                                    }}
                                >
                                    <option value="">-- 不启用 SSO 免密登录 --</option>
                                    {SSO_METHOD_OPTIONS.map(method => <option key={method.id} value={method.id}>🚀 {method.name} · {method.detail}</option>)}
                                </select>
                            </div>

                            {formData.ssoMethod && !selectedSsoConfig && (
                                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-700 animate-in slide-in-from-top-2">
                                    当前接入方式尚无可用配置。请先在“免密登录配置”中保存凭据，卡片将自动绑定该类型的最新配置。
                                </div>
                            )}

                            {CLASS_TYPE_METHODS.has(formData.ssoMethod) && (
                                <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-3 animate-in slide-in-from-top-2">
                                    <div className="mb-2 text-[11px] font-bold text-slate-600">班级类型</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { value: '1', label: '实训班' },
                                            { value: '2', label: '考评班' },
                                            { value: '3', label: '大赛班' }
                                        ].map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, classType: option.value })}
                                                className={`rounded-lg border px-2 py-2 text-xs font-bold transition-all ${formData.classType === option.value ? 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-200' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'}`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                                        {formData.ssoMethod === 'crossBorderCommerce'
                                            ? '跨境电商的实训班与考评班均调用官方 AddGroup，大赛班调用 AddMegagameGroup。'
                                            : '应与远程系统当前启用的运行模式保持一致。'}
                                    </p>
                                </div>
                            )}

                            {formData.ssoMethod && (
                                <div className="mt-2 text-[10px] text-emerald-600 px-1 animate-in slide-in-from-top-1">
                                    <span className="font-bold">已启用：</span> 点击卡片时将使用所选适配方式，并自动读取该卡片的跳转链接。
                                </div>
                            )}
                        </div>

                        {supportsAdminEntry && (
                            <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 via-white/85 to-indigo-50/70 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                                <label className="flex cursor-pointer items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-xs font-black text-violet-950">
                                            <Key className="h-4 w-4 text-violet-500" />管理员接口账户服务
                                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] text-violet-700">{formData.ssoMethod === 'java' ? 'Admin' : 'Root'}</span>
                                        </div>
                                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">为该卡片单独保存平台管理员账号；仅超级管理员可读取和使用。</p>
                                        {formData.adminEntryEnabled && adminEntryUsesPlainHttp && (
                                            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[9px] font-bold leading-4 text-amber-700">
                                                兼容性提示：该旧平台仅支持通过 HTTP GET 登录，账号凭据会短暂出现在目标地址中。请使用专用、最小权限且可定期更换的 Admin/Root 账号。
                                            </p>
                                        )}
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={formData.adminEntryEnabled}
                                        onChange={event => setFormData(previous => ({ ...previous, adminEntryEnabled: event.target.checked }))}
                                        className="h-5 w-5 shrink-0 accent-violet-600"
                                    />
                                </label>
                                <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${formData.adminEntryEnabled ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`} aria-hidden={!formData.adminEntryEnabled}>
                                    <div className="min-h-0 overflow-hidden">
                                        <div className="grid gap-3 border-t border-violet-100 pt-3 sm:grid-cols-2">
                                            <div>
                                                <label className="mb-1 block text-[9px] font-bold text-slate-500">{formData.ssoMethod === 'java' ? 'Admin' : 'Root'} 账号</label>
                                                <input
                                                    value={formData.adminEntryUsername}
                                                    onChange={event => setFormData(previous => ({ ...previous, adminEntryUsername: event.target.value }))}
                                                    placeholder={formData.ssoMethod === 'java' ? '输入 Admin 账户' : '输入 Root 账户'}
                                                    className={`w-full rounded-xl px-3 py-2 text-xs ${GLASS_INPUT}`}
                                                />
                                            </div>
                                            <div>
                                                <div className="mb-1 flex items-center justify-between gap-2">
                                                    <label className="text-[9px] font-bold text-slate-500">账户密码</label>
                                                    {adminEntryPasswordLoading ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[8px] font-black text-indigo-600"><Loader2 className="h-2.5 w-2.5 animate-spin" />读取中</span>
                                                    ) : formData.hasAdminEntryPassword && (
                                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[8px] font-black text-emerald-600">{formData.adminEntryPassword ? '已回显' : '已保存'}</span>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    <input
                                                        type={showAdminEntryPassword ? 'text' : 'password'}
                                                        autoComplete="new-password"
                                                        value={formData.adminEntryPassword}
                                                        onChange={event => setFormData(previous => ({ ...previous, adminEntryPassword: event.target.value }))}
                                                        placeholder={adminEntryPasswordLoading ? '正在读取已保存密码…' : formData.hasAdminEntryPassword ? '已保存；读取失败时留空可保留原值' : '输入管理员账户密码'}
                                                        className={`w-full rounded-xl py-2 pl-3 pr-10 text-xs ${GLASS_INPUT}`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAdminEntryPassword(previous => !previous)}
                                                        disabled={adminEntryPasswordLoading || !formData.adminEntryPassword}
                                                        title={showAdminEntryPassword ? '隐藏密码' : '显示密码'}
                                                        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 transition hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-30"
                                                    >
                                                        {showAdminEntryPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                    </button>
                                                </div>
                                                {adminEntryPasswordError && <p className="mt-1 text-[9px] font-bold text-amber-600">{adminEntryPasswordError}；留空保存不会覆盖原密码。</p>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {supportsManualCredentials && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                                <label className="flex cursor-pointer items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-black text-slate-800">提取账号信息（可选）</p>
                                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">开启后可生成并保存教师账号密码；关闭时不读取数据库，也不影响免密登录。</p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={formData.manualCredentialEnabled}
                                        onChange={event => setFormData(previous => ({
                                            ...previous,
                                            manualCredentialEnabled: event.target.checked
                                        }))}
                                        className="h-5 w-5 shrink-0 accent-indigo-600"
                                    />
                                </label>
                            </div>
                        )}

                        {supportsManualCredentials && formData.manualCredentialEnabled && (
                            <div className={`ai-mapping-card rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white/80 to-violet-50/60 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 ${aiMappingScope === 'account' ? 'is-ai-scanning' : ''}`}>
                                <div className="flex items-center justify-between gap-3 border-b border-indigo-100/80 px-4 py-3">
                                    <div>
                                        <div className="flex items-center gap-2 text-xs font-black text-indigo-950"><Network className="h-4 w-4 text-indigo-500" />账号数据库连接与定位</div>
                                        <p className="mt-1 text-[10px] text-slate-500">先选服务与数据库；AI 仅分析表名与字段名，不读取账号内容，也可随时手动调整。</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <span className="hidden rounded-full border border-indigo-100 bg-white/80 px-2.5 py-1 text-[9px] font-black text-indigo-600 sm:inline-flex">{formData.accountTableName ? '映射已就绪' : '2 步连接'}</span>
                                        <button
                                            type="button"
                                            onClick={() => runAiMapping('account')}
                                            disabled={Boolean(aiMappingScope) || !formData.accountApiId || !formData.accountDbProvider || !formData.accountDbName}
                                            title={!formData.accountApiId || !formData.accountDbName ? '选择 API 服务和数据库后可使用' : 'AI 自动识别账号表与字段'}
                                            className="ai-mapping-trigger"
                                        >
                                            {aiMappingScope === 'account' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                            <span>{aiMappingScope === 'account' ? '识别中' : 'AI 填充'}</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2.5 p-3">
                                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_140px]">
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold text-slate-600">API 服务器</label>
                                            <select value={formData.accountApiId} onChange={event => {
                                                setConnectionAutoMessage('');
                                                setFormData(previous => ({ ...previous, accountApiId: event.target.value, accountDbName: '', accountTableName: '', accountUsernameColumn: '', accountPasswordColumn: '' }));
                                            }} className={`w-full rounded-lg px-2.5 py-2 text-[11px] font-bold ${GLASS_INPUT}`}>
                                                <option value="">-- 请选择账号服务 --</option>
                                                {accountApiServices.map(service => <option key={service.id} value={service.id} disabled={!service.enabled}>{service.name} · {service.endpointUrl || '未填写地址'}{service.enabled ? '' : '（已停用）'}</option>)}
                                            </select>
                                            {accountApiServicesError && <p className="mt-1 text-[9px] text-red-600">{accountApiServicesError}</p>}
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold text-slate-600">数据库类型</label>
                                            <div className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[10px] font-black transition-all duration-300 ${formData.accountApiId ? 'border-indigo-200 bg-white text-indigo-700 shadow-sm' : 'border-slate-200 bg-slate-100 text-slate-400'}`}>
                                                <span className={`h-2 w-2 rounded-full ${formData.accountApiId ? 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]' : 'bg-slate-300'}`} />
                                                {formData.accountDbProvider === 'mysql' ? 'MySQL · JAVA' : formData.accountDbProvider === 'sqlserver' ? 'SQL Server' : '自动识别'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold text-slate-600">对应数据库名称</label>
                                            <select value={formData.accountDbName} onChange={event => {
                                                setConnectionAutoMessage('');
                                                setFormData(previous => ({ ...previous, accountDbName: event.target.value, accountTableName: '', accountUsernameColumn: '', accountPasswordColumn: '' }));
                                            }} disabled={!formData.accountApiId || !formData.accountDbProvider || accountDatabasesLoading} className={`w-full rounded-lg px-2.5 py-2 text-[11px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                <option value="">{accountDatabasesLoading ? '读取中…' : !formData.accountApiId ? '-- 请先选择 API --' : '-- 请选择数据库 --'}</option>
                                                {accountDatabases.map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                            {accountDatabasesError && <p className="mt-1 text-[9px] text-red-600">{accountDatabasesError}</p>}
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold text-slate-600">对应账号数据表</label>
                                            <select value={formData.accountTableName} onChange={event => setFormData(previous => ({ ...previous, accountTableName: event.target.value, accountUsernameColumn: '', accountPasswordColumn: '' }))} disabled={!formData.accountDbName || accountTablesLoading} className={`w-full rounded-lg px-2.5 py-2 text-[11px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                <option value="">{accountTablesLoading ? '读取中…' : !formData.accountDbName ? '-- 请先选择数据库 --' : '-- 请选择账号表 --'}</option>
                                                {accountTables.map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                            {accountTablesError && <p className="mt-1 text-[9px] text-red-600">{accountTablesError}</p>}
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-indigo-100 bg-white/65 p-2.5">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <div>
                                                <div className="text-[10px] font-black text-slate-700">账号定位字段</div>
                                                <p className="mt-0.5 text-[9px] text-slate-400">AI 一次识别账号表、用户名、密码字段和算法。</p>
                                            </div>
                                            {(accountTablesLoading || accountColumnsLoading) && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                            <div>
                                                <label className="mb-1 block text-[9px] font-bold text-slate-500">用户名字段</label>
                                                <select value={formData.accountUsernameColumn} onChange={event => setFormData(previous => ({ ...previous, accountUsernameColumn: event.target.value }))} disabled={!formData.accountTableName || accountColumnsLoading} className={`w-full rounded-lg px-2.5 py-2 text-[10px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                    <option value="">{accountColumnsLoading ? '读取中…' : !formData.accountTableName ? '-- 请先选择账号表 --' : '-- 请选择用户名字段 --'}</option>
                                                    {accountColumns.map(name => <option key={`username-${name}`} value={name}>{name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[9px] font-bold text-slate-500">密码字段</label>
                                                <select value={formData.accountPasswordColumn} onChange={event => setFormData(previous => ({ ...previous, accountPasswordColumn: event.target.value }))} disabled={!formData.accountTableName || accountColumnsLoading} className={`w-full rounded-lg px-2.5 py-2 text-[10px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                    <option value="">{accountColumnsLoading ? '读取中…' : !formData.accountTableName ? '-- 请先选择账号表 --' : '-- 请选择密码字段 --'}</option>
                                                    {accountColumns.map(name => <option key={`password-${name}`} value={name}>{name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[9px] font-bold text-slate-500">密码算法</label>
                                                <select value={formData.accountPasswordAlgorithm} onChange={event => setFormData(previous => ({ ...previous, accountPasswordAlgorithm: event.target.value }))} disabled={!formData.accountTableName} className={`w-full rounded-lg px-2.5 py-2 text-[10px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                    <option value="">{!formData.accountTableName ? '-- 请先选择账号表 --' : '-- 请选择密码算法 --'}</option>
                                                    {PASSWORD_ALGORITHM_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name} · {option.detail}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        {accountColumnsError && <p className="mt-1.5 text-[9px] text-red-600">{accountColumnsError}</p>}
                                    </div>

                                    {connectionAutoMessage && <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50/80 px-2.5 py-1.5 text-[9px] font-bold text-emerald-700 animate-in fade-in"><CheckCircle2 className="h-3 w-3 shrink-0" /><span>{connectionAutoMessage}</span></div>}
                                    {aiMappingMessage?.scope === 'account' && <p className={`rounded-lg px-2.5 py-1.5 text-[9px] font-bold animate-in fade-in ${aiMappingMessage.type === 'error' ? 'bg-red-50 text-red-600' : aiMappingMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50/80 text-violet-700'}`}>{aiMappingMessage.text}</p>}

                                    <div className="rounded-xl border border-indigo-100 bg-white/55 px-2.5 py-2 transition-colors hover:border-indigo-200">
                                        <label className="flex cursor-pointer items-center justify-between gap-3">
                                            <span className="min-w-0">
                                                <span className="block text-[10px] font-bold text-slate-700">提取密码后自动恢复免密登录</span>
                                                <span className="block truncate text-[9px] text-slate-400">未手动填写时，首次提取会自动备份并回填原始密文</span>
                                            </span>
                                            <input
                                                type="checkbox"
                                                checked={formData.restoreOriginalPasswordBeforeSso}
                                                onChange={event => {
                                                    const checked = event.target.checked;
                                                    setFormData(previous => ({ ...previous, restoreOriginalPasswordBeforeSso: checked }));
                                                    if (!checked) setShowRestoreCiphertext(false);
                                                }}
                                                className="h-4 w-4 shrink-0 accent-indigo-600"
                                            />
                                        </label>
                                        <div
                                            aria-hidden={!formData.restoreOriginalPasswordBeforeSso}
                                            className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${formData.restoreOriginalPasswordBeforeSso ? 'mt-2 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}
                                        >
                                            <div className="min-h-0 overflow-hidden">
                                                <div className="border-t border-indigo-100/80 pt-2">
                                                    <div className="mb-1 flex items-center justify-between gap-2">
                                                        <label htmlFor="restore-original-password-ciphertext" className="text-[9px] font-bold text-slate-500">原始密码密文（可选）</label>
                                                        {formData.hasRestoreOriginalPasswordCiphertext && (
                                                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[8px] font-black text-emerald-600">已保存</span>
                                                        )}
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            id="restore-original-password-ciphertext"
                                                            type={showRestoreCiphertext ? 'text' : 'password'}
                                                            autoComplete="new-password"
                                                            value={formData.restoreOriginalPasswordCiphertext}
                                                            onChange={event => setFormData(previous => ({ ...previous, restoreOriginalPasswordCiphertext: event.target.value }))}
                                                            disabled={!formData.restoreOriginalPasswordBeforeSso}
                                                            placeholder="粘贴账号原始密码字段中的密文"
                                                            className={`w-full rounded-lg py-2 pl-2.5 pr-9 font-mono text-[10px] ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-55`}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowRestoreCiphertext(previous => !previous)}
                                                            disabled={!formData.restoreOriginalPasswordBeforeSso || !formData.restoreOriginalPasswordCiphertext}
                                                            title={showRestoreCiphertext ? '隐藏密文' : '显示密文'}
                                                            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-slate-400 transition-colors hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30"
                                                        >
                                                            {showRestoreCiphertext ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                        </button>
                                                    </div>
                                                    <p className="mt-1 text-[8px] leading-relaxed text-slate-400">该值按目标系统的原始密文直接保存；留空时由执行端首次提取后自动写入，仅管理员可查看。</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {formData.ssoMethod === 'java' && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                                <label className="flex cursor-pointer items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-black text-slate-800">Java 班级删除映射（可选）</p>
                                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">开启后可配置长按删除班级时的数据库映射；如上方已选择 Java 账号数据库，会自动沿用服务与数据库。</p>
                                    </div>
                                    <input type="checkbox" checked={Boolean(formData.classDeleteMapping?.enabled)} onChange={e => toggleClassDelete(e.target.checked)} className="h-5 w-5 shrink-0 accent-indigo-600" />
                                </label>
                            </div>
                        )}
                        {formData.ssoMethod === 'java' && formData.classDeleteMapping?.enabled && (
                            <div className={`ai-mapping-card rounded-2xl border border-indigo-100 bg-gradient-to-br from-white/90 via-indigo-50/70 to-cyan-50/50 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 ${aiMappingScope === 'classDelete' ? 'is-ai-scanning' : ''}`}>
                                <div className="flex items-start justify-between gap-3 border-b border-indigo-100/80 px-4 py-3">
                                    <div>
                                        <div className="flex items-center gap-2 text-xs font-black text-indigo-950"><Network className="h-4 w-4 text-indigo-500" />基础映射</div>
                                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">四项始终展示。先选 API 与数据库，再由 AI 自动识别班级表和字段，或直接手动选择。</p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <span className={`hidden rounded-full px-2 py-1 text-[9px] font-black sm:inline-flex ${hasCompleteClassDeleteMapping ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-600'}`}>
                                            {hasCompleteClassDeleteMapping ? '映射已就绪' : '等待配置'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => runAiMapping('classDelete')}
                                            disabled={Boolean(aiMappingScope) || !classDeleteApiId || !classDeleteDatabaseName}
                                            title={!classDeleteApiId || !classDeleteDatabaseName ? '选择 API 服务和数据库后可使用' : 'AI 自动识别班级与关联账号映射'}
                                            className="ai-mapping-trigger"
                                        >
                                            {aiMappingScope === 'classDelete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                            <span>{aiMappingScope === 'classDelete' ? '识别中' : 'AI 填充'}</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-3 p-4">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[9px] text-indigo-700">1</span>账号管理 API 服务器</label>
                                        <select value={formData.classDeleteMapping?.apiId || ''} onChange={e => updateClassDelete('apiId', e.target.value)} className={`w-full rounded-xl px-3 py-2.5 text-xs font-bold ${GLASS_INPUT}`}>
                                            <option value="">-- 请选择软件所在的 API 服务器 --</option>
                                            {accountApiServices.map(service => <option key={service.id} value={service.id} disabled={!service.enabled}>{service.name} · {service.endpointUrl || '未填写地址'}{service.enabled ? '' : '（已停用）'}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[9px] text-indigo-700">2</span>班级所在数据库</label>
                                            <select value={formData.classDeleteMapping?.databaseName || ''} onChange={e => updateClassDelete('databaseName', e.target.value)} disabled={!classDeleteApiId || classDeleteDatabasesLoading} className={`w-full rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-300 ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                <option value="">{classDeleteDatabasesLoading ? '正在读取数据库列表…' : !classDeleteApiId ? '-- 请先选择 API 服务器 --' : '-- 请选择班级所在数据库 --'}</option>
                                                {classDeleteDatabases.map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                            {classDeleteDatabasesError && <p className="mt-2 text-[10px] text-red-600">{classDeleteDatabasesError}</p>}
                                    </div>
                                    <div>
                                            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[9px] text-indigo-700">3</span>班级数据表</label>
                                            <select value={formData.classDeleteMapping?.classTable || ''} onChange={e => updateClassDelete('classTable', e.target.value)} disabled={!classDeleteDatabaseName || classDeleteTablesLoading} className={`w-full rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-300 ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                <option value="">{classDeleteTablesLoading ? '正在读取数据表列表…' : !classDeleteDatabaseName ? '-- 请先选择数据库 --' : '-- 请选择班级数据表 --'}</option>
                                                {classDeleteTables.map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                            {classDeleteTablesError && <p className="mt-2 text-[10px] text-red-600">{classDeleteTablesError}</p>}
                                    </div>
                                    <div>
                                            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-[9px] text-indigo-700">4</span>班级名称字段</label>
                                            <select value={formData.classDeleteMapping?.classNameColumn || ''} onChange={e => updateClassDelete('classNameColumn', e.target.value)} disabled={!classDeleteClassTable || classDeleteColumnsLoading} className={`w-full rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-300 ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                <option value="">{classDeleteColumnsLoading ? '正在读取字段列表…' : !classDeleteClassTable ? '-- 请先选择班级表 --' : '-- 请选择存放班级名称的字段 --'}</option>
                                                {classDeleteColumns.map(name => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                            {classDeleteColumnsError && <p className="mt-2 text-[10px] text-red-600">{classDeleteColumnsError}</p>}
                                    </div>
                                    </div>
                                    <p className="text-[9px] leading-relaxed text-slate-400">班级名称字段用于按真实班级名找到班级行，例如 class_name 或 uc_name；班级主键用于关联账号表，两者含义不同。</p>
                                    {aiMappingMessage?.scope === 'classDelete' && <p className={`rounded-lg px-2.5 py-2 text-[9px] font-bold animate-in fade-in slide-in-from-top-1 ${aiMappingMessage.type === 'error' ? 'bg-red-50 text-red-600' : aiMappingMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50/80 text-violet-700'}`}>{aiMappingMessage.text}</p>}
                                    <div className="rounded-xl border border-indigo-100 bg-white/70">
                                            <div className="flex items-center justify-between gap-3 border-b border-indigo-100 p-3 text-[11px] font-bold text-slate-600">
                                                <span>同时删除关联账号</span>
                                                {classDeleteCascadeReady && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">已配置</span>}
                                            </div>
                                            <div className="px-3 pb-3 pt-2">
                                                <p className="mb-3 text-[9px] leading-relaxed text-slate-400">删除班级时会同步删除该班级关联的学生、教师账号。AI 自动填充会一次识别下方三项，也可手动调整。</p>
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                    <div>
                                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">班级主键字段</label>
                                                        <select value={formData.classDeleteMapping?.classIdColumn || ''} onChange={e => updateClassDelete('classIdColumn', e.target.value)} disabled={!classDeleteClassTable || classDeleteColumnsLoading} className={`w-full rounded-lg px-2.5 py-2 text-[11px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                            <option value="">{classDeleteColumnsLoading ? '读取中…' : !classDeleteClassTable ? '-- 请先选择班级表 --' : '-- 请选择班级主键 --'}</option>
                                                            {classDeleteColumns.map(name => <option key={`cid-${name}`} value={name}>{name}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">账号数据表</label>
                                                        <select value={formData.classDeleteMapping?.userTable || ''} onChange={e => updateClassDelete('userTable', e.target.value)} disabled={!classDeleteDatabaseName || classDeleteTablesLoading} className={`w-full rounded-lg px-2.5 py-2 text-[11px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                            <option value="">{classDeleteTablesLoading ? '读取中…' : !classDeleteDatabaseName ? '-- 请先选择数据库 --' : '-- 请选择账号表 --'}</option>
                                                            {classDeleteTables.map(name => <option key={`ut-${name}`} value={name}>{name}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">账号关联字段</label>
                                                        <select value={formData.classDeleteMapping?.userClassColumn || ''} onChange={e => updateClassDelete('userClassColumn', e.target.value)} disabled={!classDeleteUserTable || classDeleteUserColumnsLoading} className={`w-full rounded-lg px-2.5 py-2 text-[11px] font-bold ${GLASS_INPUT} disabled:cursor-not-allowed disabled:opacity-50`}>
                                                            <option value="">{classDeleteUserColumnsLoading ? '读取中…' : !classDeleteUserTable ? '-- 请先选择账号表 --' : '-- 请选择关联字段 --'}</option>
                                                            {classDeleteUserColumns.map(name => <option key={`uc-${name}`} value={name}>{name}</option>)}
                                                        </select>
                                                        {classDeleteUserColumnsError && <p className="mt-1 text-[9px] text-red-600">{classDeleteUserColumnsError}</p>}
                                                    </div>
                                                </div>
                                                {!classDeleteCascadeReady && (
                                                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[9px] font-bold text-amber-700">关联账号三项属于完整删除映射，需由 AI 一次识别或手动全部填写后才能保存。</p>
                                                )}
                                            </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 8. 简短描述 */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 mb-1 block">简短描述</label>
                            <textarea
                                rows="2"
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className={`w-full px-3 py-2 rounded-xl text-sm ${GLASS_INPUT}`}
                                placeholder="备注..."
                            />
                        </div>
                    </div>
                </div>

                {/* 底部按钮 */}
                <div className="edit-competition-modal__footer flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors">取消</button>
                    <button
                        onClick={() => {
                            const payload = {
                                ...formData,
                                // Keep the database relation as an internal field;
                                // administrators no longer need to select it twice.
                                ssoConfigId: selectedSsoConfig?.id || null,
                                ssoMethod: formData.ssoMethod || null,
                                classType: CLASS_TYPE_METHODS.has(formData.ssoMethod) ? Number(formData.classType || defaultClassType(formData.ssoMethod)) : null
                            };
                            onSave(payload);
                        }}
                        disabled={!canSave}
                        className={`edit-competition-save flex items-center rounded-xl px-6 py-2.5 text-sm font-bold ${PRIMARY_BTN} ${
                            !canSave && 'opacity-50 cursor-not-allowed'
                        }`}
                    >
                        <Save className="w-4 h-4 mr-2" /> 保存
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditModal;
