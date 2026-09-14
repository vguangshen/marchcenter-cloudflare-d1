const cleanText = (value, limit = 160) => String(value || '').trim().slice(0, limit);

const PASSWORD_ALGORITHMS = new Set([
    'itmc-java-long-md5', 'itmc-des', 'itmc-sandbox-des', 'plain',
    'md5-lower', 'md5-upper', 'double-md5-lower', 'sha1-lower', 'sha1-upper',
    'sha256-lower', 'sha256-upper'
]);

export function extractAiJson(text) {
    const source = String(text || '').trim();
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    const candidate = fenced || source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1);
    if (!candidate) throw new Error('AI 未返回可解析的映射结果');
    try { return JSON.parse(candidate); }
    catch { throw new Error('AI 返回的映射格式无效，请重试'); }
}

export function normalizeCandidateTables(value, availableTables, limit = 8) {
    const exact = new Map(availableTables.map(table => [String(table).toLowerCase(), String(table)]));
    const requested = Array.isArray(value) ? value : [];
    return [...new Set(requested
        .map(item => exact.get(cleanText(item).toLowerCase()))
        .filter(Boolean))].slice(0, limit);
}

export function rankDatabaseTables(availableTables, scope, limit = 12) {
    const words = scope === 'classDelete'
        ? ['class', 'group', 'grade', 'student', 'teacher', 'user', 'account', '班级', '用户']
        : ['user', 'account', 'member', 'teacher', 'student', 'login', 'operator', 'admin', '用户', '账号'];
    return availableTables
        .map((table, index) => {
            const name = String(table).toLowerCase();
            const score = words.reduce((total, word, wordIndex) => total + (name.includes(word) ? words.length - wordIndex : 0), 0);
            return { table: String(table), score, index };
        })
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map(item => item.table);
}

const findColumn = (columns, patterns) => {
    const values = (columns || []).map(String);
    for (const pattern of patterns) {
        const exact = values.find(value => value.toLowerCase() === pattern);
        if (exact) return exact;
    }
    for (const pattern of patterns) {
        const partial = values.find(value => value.toLowerCase().includes(pattern));
        if (partial) return partial;
    }
    return '';
};

export function inferDatabaseMappingFromSchema(schemas, { scope, provider, ssoMethod } = {}) {
    if (scope === 'account') {
        for (const item of schemas || []) {
            const accountUsernameColumn = findColumn(item.columns, ['username', 'user_name', 'uname', 'loginname', 'login_name', 'account', 'sname']);
            const accountPasswordColumn = findColumn(item.columns, ['password', 'passwd', 'pwd', 'user_password', 'spassword', 'lpass']);
            if (!accountUsernameColumn || !accountPasswordColumn) continue;
            const sandbox = new Set(['marketing', 'commerce', 'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement']);
            return {
                accountTableName: item.table,
                accountUsernameColumn,
                accountPasswordColumn,
                accountPasswordAlgorithm: ssoMethod === 'java' ? 'itmc-java-long-md5' : sandbox.has(ssoMethod) ? 'itmc-sandbox-des' : provider === 'sqlserver' ? 'itmc-des' : '',
                confidence: 'low',
                reason: 'AI 暂时不可用，已按真实字段结构完成规则匹配，请保存前复核'
            };
        }
    }
    if (scope === 'classDelete') {
        const classItem = (schemas || []).find(item => findColumn(item.columns, ['classname', 'class_name', 'groupname', 'group_name', 'uc_name', 'name']));
        if (classItem) {
            const classNameColumn = findColumn(classItem.columns, ['classname', 'class_name', 'groupname', 'group_name', 'uc_name', 'name']);
            const classIdColumn = findColumn(classItem.columns, ['classid', 'class_id', 'groupid', 'group_id', 'uc_id', 'id']);
            const userItem = (schemas || []).find(item => item.table !== classItem.table && findColumn(item.columns, ['classid', 'class_id', 'groupid', 'group_id', 'uc_id']));
            const userClassColumn = userItem ? findColumn(userItem.columns, ['classid', 'class_id', 'groupid', 'group_id', 'uc_id']) : '';
            return {
                classTable: classItem.table,
                classNameColumn,
                classIdColumn: classIdColumn && userItem && userClassColumn ? classIdColumn : '',
                userTable: classIdColumn && userItem && userClassColumn ? userItem.table : '',
                userClassColumn: classIdColumn && userItem && userClassColumn ? userClassColumn : '',
                confidence: 'low',
                reason: 'AI 暂时不可用，已按真实字段结构完成规则匹配，请保存前复核'
            };
        }
    }
    return null;
}

export function validateDatabaseMappingSuggestion(raw, schemas, { scope, provider, ssoMethod } = {}) {
    const schemaMap = new Map((schemas || []).map(item => [
        String(item.table),
        new Map((item.columns || []).map(column => [String(column).toLowerCase(), String(column)]))
    ]));
    const tableLookup = new Map([...schemaMap.keys()].map(name => [name.toLowerCase(), name]));
    const table = value => {
        const name = cleanText(value).toLowerCase();
        return tableLookup.get(name) || '';
    };
    const column = (tableName, value) => {
        const name = cleanText(value);
        return schemaMap.get(tableName)?.get(name.toLowerCase()) || '';
    };
    const confidence = ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'medium';
    const reason = cleanText(raw?.reason, 300);

    if (scope === 'account') {
        const accountTableName = table(raw?.accountTableName);
        const accountUsernameColumn = column(accountTableName, raw?.accountUsernameColumn);
        const accountPasswordColumn = column(accountTableName, raw?.accountPasswordColumn);
        const sandboxMethods = new Set(['marketing', 'commerce', 'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement']);
        const fallbackAlgorithm = ssoMethod === 'java' ? 'itmc-java-long-md5'
            : sandboxMethods.has(ssoMethod) ? 'itmc-sandbox-des'
                : provider === 'sqlserver' ? 'itmc-des' : '';
        const proposedAlgorithm = cleanText(raw?.accountPasswordAlgorithm, 60).toLowerCase();
        const accountPasswordAlgorithm = PASSWORD_ALGORITHMS.has(proposedAlgorithm)
            ? proposedAlgorithm : fallbackAlgorithm;
        if (!accountTableName || !accountUsernameColumn || !accountPasswordColumn || !accountPasswordAlgorithm) {
            throw new Error('AI 没有找到完整且可信的账号表映射，请保留手动选择或重试');
        }
        return { scope, confidence, reason, accountTableName, accountUsernameColumn, accountPasswordColumn, accountPasswordAlgorithm };
    }

    if (scope === 'classDelete') {
        const classTable = table(raw?.classTable);
        const classNameColumn = column(classTable, raw?.classNameColumn);
        const classIdColumn = column(classTable, raw?.classIdColumn);
        const userTable = table(raw?.userTable);
        const userClassColumn = column(userTable, raw?.userClassColumn);
        if (!classTable || !classNameColumn || !classIdColumn || !userTable || !userClassColumn) {
            throw new Error('AI 没有找到完整的班级与关联账号映射，请手动选择或重试');
        }
        return {
            scope, confidence, reason, classTable, classNameColumn,
            classIdColumn, userTable, userClassColumn
        };
    }

    throw new Error('AI 映射范围无效');
}

export function databaseMappingPrompts({ scope, title, category, ssoMethod, provider, databaseName, tables, schemas = [] }) {
    const context = {
        competitionTitle: cleanText(title, 200),
        category: cleanText(category, 100),
        ssoMethod: cleanText(ssoMethod, 40),
        provider,
        databaseName: cleanText(databaseName, 128)
    };
    if (!schemas.length) {
        return {
            system: '你是数据库结构识别助手。只能从提供的表名中选择，不得编造。只输出 JSON。',
            user: `${JSON.stringify(context)}\n可用表名：${JSON.stringify(tables)}\n${scope === 'account'
                ? '找出最可能保存登录账号、用户名和密码的表，返回 {"candidateTables":["表名"],"reason":"简短依据"}，候选不超过 6 个。'
                : '找出最可能保存班级信息及关联学生/教师账号的表，返回 {"candidateTables":["表名"],"reason":"简短依据"}，候选不超过 8 个。'}`
        };
    }
    return {
        system: '你是数据库映射助手。只能使用提供的表名和字段名，不得编造。字段含义不确定时宁可留空。只输出 JSON。',
        user: `${JSON.stringify(context)}\n候选表结构：${JSON.stringify(schemas)}\n${scope === 'account'
            ? '识别账号表、用户名字段、密码字段和密码算法。返回 {"accountTableName":"","accountUsernameColumn":"","accountPasswordColumn":"","accountPasswordAlgorithm":"","confidence":"high|medium|low","reason":"简短依据"}。JAVA 通常使用 itmc-java-long-md5；普通 .NET 通常使用 itmc-des；沙盘类可能使用 itmc-sandbox-des。'
            : '一次性识别班级表、班级名称字段、班级主键、账号表及账号表中的班级外键。五项都必须从候选结构中选择且不得留空。返回 {"classTable":"","classNameColumn":"","classIdColumn":"","userTable":"","userClassColumn":"","confidence":"high|medium|low","reason":"简短依据"}。'}`
    };
}
