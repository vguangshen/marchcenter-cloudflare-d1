const MAX_QUERY_LENGTH = 384;
const MAX_CANDIDATES = 48;
const MAX_POSTING_LENGTH = 4096;
const MATCH_SCORE = .71;
const CLARIFY_SCORE = .57;
const AMBIGUITY_GAP = .095;
const CONTEXT_BONUS = .025;

const SYNONYMS = [
    [/登陆|登入|sign[ -]?in/giu, '登录'],
    [/忘了(?:账号)?密码|(?:账号)?密码(?:忘(?:记)?了?|想不起(?:来了?)?)|不记得(?:账号)?密码/gu, '忘记密码'],
    [/找回(?:登录)?密码|重置(?:登录)?密码/gu, '找回密码'],
    [/无法登陆|登不上(?:去)?|登录不上(?:去)?|登录不了|无法登录|登录不进去/gu, '登录失败'],
    [/点不开|进不去|打不开|不能打开|开不了|打开不了/gu, '无法打开'],
    [/未显示|没显示|没出现|没看到|没有显示|不显示|找不到|看不见|看不到/gu, '看不到'],
    [/列表(?:是)?空的|列表空白|列表完全空着/gu, '列表为空'],
    [/没有收到|没收到|接收不到|拿不到|未收到/gu, '收不到'],
    [/(?:找回|重置)(?:登录)?密码(?:的)?(?:重置)?邮件|重置邮件/gu, '找回密码邮箱验证码'],
    [/邮箱验证码邮件|邮件验证码|验证码邮件/gu, '邮箱验证码'],
    [/查成绩|查分数|查看得分|查询得分|成绩查询|查看成绩|查分/gu, '查询成绩'],
    [/成绩|分数|得分/gu, '成绩'],
    [/比赛|赛事/gu, '竞赛'],
    [/报障单|技术支持单/gu, '工单'],
    [/登陆邮箱|电子信箱|电子邮件地址|电子邮箱|邮箱地址|e[ -]?mail/giu, '邮箱'],
    [/更换绑定(?:的)?邮箱|换绑定(?:的)?邮箱|更改绑定(?:的)?邮箱|修改绑定(?:的)?邮箱|改绑(?:的)?邮箱|换绑邮箱/gu, '更换绑定邮箱'],
    [/(?:更换|修改|改(?:个|一下)?|换(?:个|一下)?|替换)头像/gu, '更换头像'],
    [/截屏|屏幕截图/gu, '截图'],
    [/附件文件|文件附件/gu, '附件'],
    [/人工坐席|真人客服|人工专员/gu, '人工客服'],
    [/(?:聊天|客服|在线帮助)(?:弹窗|窗口|浮窗|面板|卡片|对话框|框)/gu, '客服窗口'],
    [/在线帮助/gu, '客服'],
    [/(客服窗口)(?:缩回去|缩成图标|折叠成图标)/gu, '收起$1']
];

const FILLER = /请教一下|请问一下|想问一下|我想问|请问|麻烦一下|你好|您好|帮我看下|告诉我|是怎么回事|怎么回事|怎么办|怎么弄|为什么|如何|怎样|怎么|什么地方|在哪里可以|在哪里能|在哪里|在哪儿|从哪里|能不能|可以不可以|麻烦|请帮我|在这边/gu;
const ENGLISH_FILLER = new Set(['the', 'to', 'in', 'on', 'of', 'an', 'is', 'it', 'my', 'me', 'how', 'can', 'could', 'would', 'please', 'do', 'where', 'this', 'thanks', 'and', 'you', 'for', 'help']);
const SHORT_GENERIC = new Set(['账号', '密码', '邮箱', '登录', '工单', '卡片', '页面', '客服', '设置', '竞赛', '管理员', '无法打开', '没有权限', '有什么问题']);

// A small vocabulary of platform subjects and actions lets phrases share
// evidence even when word order or the intervening words are different.
const TOPICS = [
    ['login', /登录|进入账号|上号|\blog[ -]?in\b/u],
    ['account', /账号|帐号|账户|\baccount\b/u],
    ['password', /密码|凭证|口令|\bpassword\b/u],
    ['email', /邮箱|邮件|收件箱|mailbox/u],
    ['code', /验证码|动态码|登录码|校验码|收码|verification code/u],
    ['registration', /注册|自助开户|开(?:个|通|一个)新账号|\bsign[ -]?up\b/u],
    ['profile', /个人资料|个人信息|个人中心|个人主页|\bprofile\b/u],
    ['avatar', /头像|形象图片|\bavatar\b/u],
    ['workbench', /工作台|平台首页|网页首页|竞赛大厅|工作区|首页|\bdashboard\b/u],
    ['card', /卡片|竞赛卡|竞赛入口|平台卡|卡牌|\bcards?\b/u],
    ['class', /班级|教学班|分班|\bclass\b/u],
    ['teacher', /老师|教师|讲师|\bteacher\b/u],
    ['student', /学生|学员|同学|\bstudent\b/u],
    ['contest', /竞赛|\bcontest\b/u],
    ['permissions', /权限|授权|开放范围|访问范围|\bpermissions?\b/u],
    ['ticket', /工单|故障单|\bticket\b/u],
    ['support', /客服|会话|接待|在线帮助|\bsupport chat\b/u],
    ['support-window', /客服窗口|聊天窗|聊天框|客服框|客服.*折叠|收起客服|折叠对话框/u],
    ['human-support', /人工客服|人工接待|转(?:接)?人工/u],
    ['automation', /自动回复|意图识别|语料|常见问题|模板回复|\bfaq\b/u],
    ['ai', /\bai\b|人工智能|机器人/u],
    ['agent', /智能体|\bagent\b/u],
    ['task', /任务|练习|作业|\btask\b/u],
    ['score', /成绩|分值|评分|\bscore\b/u],
    ['attachment', /附件|文件|文档|\battachment\b/u],
    ['image', /截图|图片|照片|屏幕画面|\bscreenshot\b/u],
    ['appearance', /主题|外观|主题色|深色|浅色|暗色|亮色|背景|壁纸|dark mode/u],
    ['theme-mode', /明暗|深色模式|暗黑|亮色|浅色|暗色|深色|dark mode/u],
    ['notice', /公告|站点通知|\bannouncement\b/u],
    ['gift', /礼物|赠送|\bgift\b/u],
    ['browser', /浏览器|网页|chrome|edge|safari/u],
    ['phone', /手机|移动端|手机端|\bmobile\b/u],
    ['settings', /系统工具|系统管理|站点设置|\bsettings\b/u],
    ['session', /设备|会话失效|重新登录|\bsession\b/u]
];
const ACTIONS = [
    ['forgot', /忘记|忘了|忘掉|想不起|记不住|不记得|记不清|找回密码|\bforgot\b/u],
    ['reset', /重置|重设|找回|重新设置|设置新密码|\breset\b/u],
    ['replace', /更换|修改|改掉|改个|换个|换一下|改一下|替换|改绑|换绑|更改|换成|改(?:登录)?密码|(?:密码|邮箱|头像)(?:怎样|如何|怎么|能不能|能|可以)?改|\breplace\b/u],
    ['missing', /看不到|没有任何|列表为空|不见了|没有这张|无卡片|缺少|消失|\bmissing\b/u],
    ['empty-list', /没有任何|列表为空|全部.*看不到|所有.*看不到|一个[^，。]{0,10}都没有|整个[^，。]{0,10}没有|空空的|暂无可显示|一张卡片都没有/u],
    ['specific-item', /某一?(?:个|张)|这张|其中一张|少了一个|少了一张|同学有|同学能看|别人首页有/u],
    ['delivery', /收不到|没等到|等不到|没发到|没有(?:那封|验证邮件)|收件箱没有|发不出来|邮箱里没有|没发过来|发送不了/u],
    ['blocked', /被禁(?:用|止登录|止)|封禁|封停|冻结|被锁定|被限制登录|账号停用|被停用|\bdisabled account\b/u],
    ['unavailable', /灰色|灰了|灰掉|不给发|不能点击|不能点|不可用|还没开放|没有开放|没开启|无法使用|暂不能|\bunavailable\b/u],
    ['expired', /过期|失效|已使用|已经使用|已经用过|已用过|超时|\bexpired\b/u],
    ['operation-failure', /错误提示|弹出[^，。！？]{0,12}错误|出现错误|出错|(?:点|打开|访问|进入|操作|任务)[^，。！？]{0,36}超时/u],
    ['invalid', /无效|提示错误|密码错误|不对|不正确|失败|报错|有误|被拒绝|不识别|\binvalid\b/u],
    ['open-failed', /无法打开|页面白屏|点了没有反应|点击.+没有反应|进入时白屏|打不开/u],
    ['duplicate', /已经被使用|已被使用|被占用|已存在|已经存在|重复|\bduplicate\b/u],
    ['attach', /附上|附加|粘贴|(?:添加|加)附件|上传|拖进|拖文件|发(?:送|一?张|个)?(?:截图|图片|照片|图|附件|文档|文件)|(?:文档|图片|附件|文件)发给|\bupload\b/u],
    ['download', /下载|导出|保存图片|\bdownload\b/u],
    ['search', /怎么找|如何找|搜一下|搜索|筛选|查找|查一下|查询|在哪看|在哪里看|在哪里查|怎么查|\bsearch\b/u],
    ['tracking', /进度|跟踪|当前处理状态|(?:查看|查)处理状态|\btrack(?:ing)?\b/u],
    ['change-view', /切换|调成|改成|换成|调整|改用|设成|设置为|只调|\bswitch\b/u],
    ['remove', /删除|移除|去掉|清空|\bremove\b/u],
    ['close', /关闭|收起|折叠|隐藏|退出|退不出|\bclose\b/u],
    ['minimize', /收起|折叠|缩小|最小化|缩成|缩回|暂时隐藏|\bminimize\b/u],
    ['reopen', /重新打开|再次打开|展开来|重新开启|恢复|\breopen\b/u],
    ['create', /新建|申请|创建|添加|提交|开一个|开个|\bcreate\b/u],
    ['bind', /绑定|关联|绑上|没绑|未绑|没留邮箱|\bbind\b/u],
    ['unbound', /没(?:有)?绑|未绑|没留邮箱|未配置邮箱|没有可用的邮箱|换了邮箱|邮箱用不了/u],
    ['rate-limit', /太频繁|过于频繁|操作频繁|点太多|次数受限|倒计时|too often|rate limit/u],
    ['large', /太大|过大|大小限制|超(?:出|过)大小|上传上限|超过多少兆|多大(?:的|小)附件|too large/u],
    ['file-limit', /文件类型|附件格式|文件格式|上限|最多|能发几个|能加几个|能传几个|多少兆|多大(?:的|小)附件|\b(?:pdf|docx?|xlsx?|txt|zip|csv|log|mb|kb)\b/u]
];
const BROAD_TOPICS = new Set(['account', 'email', 'workbench', 'card', 'browser', 'session', 'support']);
const QUALIFYING_TOPICS = ['ai', 'human-support'];
const PRIORITY_ACTIONS = ['tracking', 'delivery', 'minimize'];
const OPERATION_FAILURE_ACTIONS = ['operation-failure', 'invalid', 'open-failed'];
const ISSUE_ACTIONS = [...OPERATION_FAILURE_ACTIONS, 'delivery', 'blocked', 'expired', 'rate-limit', 'large'];

function normalize(value) {
    return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function canonicalize(value) {
    let text = value.normalize('NFKC').toLowerCase();
    for (const [pattern, replacement] of SYNONYMS) text = text.replace(pattern, replacement);
    return text;
}

function features(value) {
    const terms = new Set();
    const text = value.replace(FILLER, ' ');
    for (const [token] of text.matchAll(/\p{Script=Han}+|[a-z][a-z0-9]+|\d{3,}/gu)) {
        if (/^[a-z\d]/.test(token)) {
            if (!ENGLISH_FILLER.has(token)) terms.add(`word:${token}`);
            continue;
        }
        const chars = Array.from(token);
        for (let index = 1; index < chars.length; index++) terms.add(chars[index - 1] + chars[index]);
    }
    return terms;
}

function selectConcepts(value, dictionary) {
    return dictionary.filter(([, pattern]) => pattern.test(value)).map(([key]) => key);
}

function concepts(value) {
    return { topics: selectConcepts(value, TOPICS), actions: selectConcepts(value, ACTIONS) };
}

function addLookup(map, key, value) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
}

function addPhrase(phrases, canonical, key) {
    if (!phrases.has(key)) phrases.set(key, { terms: features(canonical), concepts: concepts(canonical) });
}

export function buildSupportIntentIndex(entries) {
    const exact = new Map();
    const equivalent = new Map();
    const records = new Map();
    const postings = new Map();
    const keywordOwners = new Map();

    for (const entry of entries) {
        if (!entry?.id || entry.enabled === false || records.has(entry.id)) continue;
        const question = typeof entry.question === 'string' ? entry.question : '';
        const profile = { entry, phrases: new Map(), keywords: new Set(), signature: concepts(canonicalize(question)), actions: new Set() };
        const examples = Array.isArray(entry.examples) ? entry.examples : [];
        const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
        for (const value of [question, ...examples]) {
            if (typeof value !== 'string') continue;
            const raw = normalize(value);
            if (!raw) continue;
            const canonical = canonicalize(value);
            const key = normalize(canonical);
            addLookup(exact, raw, entry.id);
            addLookup(equivalent, key, entry.id);
            addPhrase(profile.phrases, canonical, key);
        }
        for (const keyword of keywords) {
            if (typeof keyword !== 'string') continue;
            const canonical = canonicalize(keyword);
            const key = normalize(canonical);
            if (key.length < 2 || SHORT_GENERIC.has(key)) continue;
            profile.keywords.add(key);
            addLookup(keywordOwners, key, entry.id);
            addPhrase(profile.phrases, canonical, key);
        }
        for (const { terms, concepts: signature } of profile.phrases.values()) {
            for (const term of terms) addLookup(postings, term, entry.id);
            for (const topic of signature.topics) addLookup(postings, `topic:${topic}`, entry.id);
            for (const action of signature.actions) {
                profile.actions.add(action);
                addLookup(postings, `action:${action}`, entry.id);
            }
        }
        records.set(entry.id, profile);
    }

    const weights = new Map();
    for (const [term, owners] of postings) {
        weights.set(term, 1 + Math.log((records.size + 1) / (owners.size + 1)));
    }
    return { exact, equivalent, records, postings, keywordOwners, weights };
}

function result(kind, confidence, gap, entries = []) {
    return {
        kind,
        confidence: Math.round(confidence * 1000) / 1000,
        gap: Math.round(gap * 1000) / 1000,
        ...(kind === 'match' ? { entry: entries[0] } : kind === 'clarify' ? { entries: entries.slice(0, 3) } : {})
    };
}

function exactResult(ids, records, confidence) {
    const entries = [...ids].slice(0, 3).map(id => records.get(id).entry);
    return entries.length === 1 ? result('match', confidence, confidence, entries) : result('clarify', confidence, 0, entries);
}

function phraseScore(queryTerms, phraseTerms, queryWeight, weights) {
    let common = 0;
    let overlap = 0;
    let phraseWeight = 0;
    for (const term of phraseTerms) {
        const weight = weights.get(term);
        phraseWeight += weight;
        if (queryTerms.has(term)) {
            common += weight;
            overlap++;
        }
    }
    if (overlap < 2 || common === 0) return 0;
    const coverage = common / phraseWeight;
    const similarity = common / Math.sqrt(queryWeight * phraseWeight);
    // Two shared character pairs alone can be a generic word or greeting.
    return (overlap === 2 ? .89 : 1) * (.63 * similarity + .37 * coverage);
}

function conceptScore(query, phrase, lexical) {
    const topics = query.topics.filter(topic => phrase.topics.includes(topic));
    const actions = query.actions.filter(action => phrase.actions.includes(action));
    if (!topics.length || !actions.length) return 0;
    if (topics.length === 1 && BROAD_TOPICS.has(topics[0]) && !actions.includes('empty-list') && lexical < .28) return 0;
    if (topics.length === 1 && query.topics.length > 1 && lexical < .42) return 0;
    const queryCoverage = .45 * topics.length / query.topics.length + .55 * actions.length / query.actions.length;
    const phraseCoverage = .45 * topics.length / phrase.topics.length + .55 * actions.length / phrase.actions.length;
    const specificAction = actions.includes('empty-list') || actions.includes('specific-item') ? .025 : 0;
    return .46 + .14 * queryCoverage + .13 * phraseCoverage + .09 * lexical + specificAction + Math.min(.06, (topics.length - 1) * .025);
}

function aliasScore(text, aliases, owners) {
    let score = 0;
    for (const alias of aliases) {
        if (SHORT_GENERIC.has(alias) || !text.includes(alias)) continue;
        if (/^[a-z\d]+$/.test(alias) ? alias.length < 6 : alias.length < 4) continue;
        const count = owners.get(alias).size;
        if (count > 2) continue;
        const lengthBonus = Math.min((alias.length - 4) * .018, .072);
        score = Math.max(score, (count === 1 ? .785 : .69) + lengthBonus);
    }
    return score;
}

function mismatchPenalty(query, primary, actions) {
    if (QUALIFYING_TOPICS.some(topic => primary.topics.includes(topic) && !query.topics.includes(topic))) return .13;
    if (primary.actions.includes('unbound') && !query.actions.includes('unbound')) return .16;
    if (query.actions.includes('operation-failure')) {
        // An exact action name inside a failure report still needs troubleshooting.
        if (!OPERATION_FAILURE_ACTIONS.some(action => actions.has(action))) return 1;
        if (primary.actions.includes('reset') && !query.actions.includes('reset')) return .13;
        if (primary.topics.includes('score') && !query.topics.includes('score')) return .13;
    }
    if (primary.actions.includes('invalid') && !ISSUE_ACTIONS.some(action => query.actions.includes(action))) return .115;
    if (primary.actions.includes('file-limit') && !query.actions.some(action => action === 'file-limit' || action === 'large')) return .12;
    const desired = PRIORITY_ACTIONS.find(action => query.actions.includes(action));
    if (desired && !actions.has(desired)) return .14;
    return 0;
}

function correctedSubject(text) {
    const contrast = /(?:不是|并非|并不是|不想|不需要|不用)[^，,。;；]{2,100}[，,。;；]?\s*(?:而是|我只想|只想|我想|我要|我真正想问的是)/u.exec(text);
    return contrast ? text.slice(contrast.index + contrast[0].length).trim() || text : text;
}

function negatedRequest(key) {
    return /^(?:(?:我|我们)(?:现在)?)?(?:不想|不需要|不用|不要)(?:再)?(?:重置(?:登录)?密码|找回(?:登录)?密码|更换(?:绑定)?邮箱|转人工|改密码|注册(?:新账号)?|登录(?:工作台)?)(?:了|啦|啊|呀|哦)?$/u.test(key);
}

function addOverlap(overlap, postings, weight) {
    if (!postings || postings.size > MAX_POSTING_LENGTH) return;
    for (const id of postings) overlap.set(id, (overlap.get(id) ?? 0) + weight);
}

export function recognizeSupportIntent(text, index, { contextIntentId } = {}) {
    if (typeof text !== 'string' || !index.records.size) return result('none', 0, 0);
    const bounded = text.slice(0, MAX_QUERY_LENGTH);
    const normalized = normalize(bounded);
    if (normalized.length < 2) return result('none', 0, 0);
    const exact = index.exact.get(normalized);
    if (exact) return exactResult(exact, index.records, 1);
    if (negatedRequest(normalized)) return result('none', 0, 0);
    const excerpt = correctedSubject(bounded);
    if (excerpt !== bounded) {
        const corrected = index.exact.get(normalize(excerpt));
        if (corrected) return exactResult(corrected, index.records, .96);
    }
    const canonical = canonicalize(excerpt);
    const key = normalize(canonical);
    const equivalent = index.equivalent.get(key);
    if (equivalent) return exactResult(equivalent, index.records, .96);

    const terms = features(canonical);
    if (!terms.size) return result('none', 0, 0);
    const signature = concepts(canonical);
    const overlap = new Map();
    let queryWeight = 0;
    for (const term of terms) {
        const weight = index.weights.get(term) ?? 1.5;
        queryWeight += weight;
        addOverlap(overlap, index.postings.get(term), weight);
    }
    for (const term of [...signature.topics.map(key => `topic:${key}`), ...signature.actions.map(key => `action:${key}`)]) {
        const weight = index.weights.get(term) ?? 1;
        addOverlap(overlap, index.postings.get(term), weight);
    }
    const candidates = [...overlap].sort((left, right) => right[1] - left[1]).slice(0, MAX_CANDIDATES);
    const ranked = candidates.map(([id]) => {
        const { entry, phrases, keywords, signature: primary, actions } = index.records.get(id);
        let score = aliasScore(key, keywords, index.keywordOwners);
        for (const phrase of phrases.values()) {
            const lexical = phraseScore(terms, phrase.terms, queryWeight, index.weights);
            score = Math.max(score, lexical, conceptScore(signature, phrase.concepts, lexical));
        }
        score = Math.max(0, score - mismatchPenalty(signature, primary, actions));
        if (score >= CLARIFY_SCORE && id === contextIntentId) score += CONTEXT_BONUS;
        return { entry, score: Math.min(score, .95) };
    }).sort((left, right) => right.score - left.score);

    const best = ranked[0]?.score ?? 0;
    const gap = best - (ranked[1]?.score ?? 0);
    if (best < CLARIFY_SCORE) return result('none', best, gap);
    const near = ranked.filter(({ score }) => score >= CLARIFY_SCORE && best - score < AMBIGUITY_GAP);
    if (near.length > 1) return result('clarify', best, gap, near.map(({ entry }) => entry));
    if (best < MATCH_SCORE) return result('none', best, gap);
    return result('match', best, gap, [ranked[0].entry]);
}

export function isSupportIntentFollowUp(text) {
    if (typeof text !== 'string' || text.length > 160) return false;
    const key = normalize(text);
    return /^(?:(?:那|这个|刚才那个|然后)?(?:能(?:不能|否)?|可以|可不可以|请先|请)?(?:具体(?:怎么(?:操作|处理|弄|做)|步骤|一点|点|说说|说一下)|详细(?:说说|说一下|一点|点|步骤)|怎么(?:操作|处理|弄|做)|如何操作|步骤(?:是|是什么|有哪些)?|下一步(?:怎么做)?|接下来(?:怎么做)?|展开说说|再详细一点)(?:啊|呀|呢|吗|嘛|吧)?|(?:can|could)youelaborate|howexactly|what(?:is|s)next|showmethesteps|more(?:details|detail))$/u.test(key);
}
