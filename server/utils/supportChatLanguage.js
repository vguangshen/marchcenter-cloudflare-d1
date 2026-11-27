const CHINESE_AGENT = '(?:(?:人工|真人)(?:客服|坐席|专员)|客服人员)';
const CHINESE_BARE_AGENT = '(?:人工|真人)(?=$|[吧吗嘛啊呀呢]+$|请|谢谢|一下|帮(?:我|忙)|来(?:处理|回复))';
const CHINESE_ACTION = '(?:转接?(?:到|给)?|接(?:通|到)?|切换(?:到|成)?|联系|找|叫|换(?:成|个)?)';
const CHINESE_TRANSFER = new RegExp(
    `^(?:${CHINESE_AGENT}|人工服务|人工|真人)(?:谢谢|麻烦了)?$|(?:${CHINESE_ACTION}|想(?:要|找|联系)?|要|需要|希望|有)(?:一?[个位名])?(?:${CHINESE_AGENT}|${CHINESE_BARE_AGENT})|(?:人工客服|真人客服)(?:接入|帮(?:我|忙)|来(?:处理|回复))`
);
const CHINESE_DECLINE = new RegExp(
    `(?:没必要|没有必要|没说要|没说要我|不(?:用|要|需要|想|必|麻烦|希望|打算|愿意)?|无须|无需|别)(?:让|给我|帮我)?(?:${CHINESE_ACTION})?(?:一?[个位名])?(?:${CHINESE_AGENT}|${CHINESE_BARE_AGENT})`
);
const TRANSFER_EXPLANATION = /(?:转(?:接)?人工|人工客服)(?:是什么|是啥|什么意思|的意思|的流程|的规则)/;

const ENGLISH_AGENT = '(?:(?:a|an|the|any) +)?(?:human (?:agent|support|rep(?:resentative)?)|real person|live (?:agent|person|support|rep(?:resentative)?)|support (?:agent|representative)|human(?=$| (?:please|now|instead|not a bot|to (?:help|respond|reply|look|assist|handle))))';
const ENGLISH_ACTION = '(?:(?:speak|talk|chat) (?:to|with)|(?:connect|transfer|switch|escalate)(?: me| this| my (?:case|request))? (?:to|with)|get(?: me)?|reach|contact)';
const ENGLISH_TRANSFER = new RegExp(
    `^${ENGLISH_AGENT}(?: please)?$|\\b(?:${ENGLISH_ACTION}|want|need|may i have|can i have|i'd like|let me speak to) +${ENGLISH_AGENT}\\b`, 'i'
);
const ENGLISH_DECLINE = new RegExp(
    `\\b(?:don['’]?t|do not|didn['’]?t|no need to|no need for|never|without|avoid|no) +(?:(?:want|need|require|wish)(?: to)? +)?(?:${ENGLISH_ACTION} +)?${ENGLISH_AGENT}\\b`, 'i'
);

export function supportHandoffIntent(message) {
    let declined = false;
    for (const raw of message.normalize('NFKC').toLowerCase().split(/[。；!?;\n，,、：:]+/u)) {
        const clause = raw.trim().replace(/\s+/g, ' ');
        if (!clause) continue;
        const compact = clause.replace(/ /g, '');
        if (CHINESE_DECLINE.test(compact) || ENGLISH_DECLINE.test(clause)) {
            declined = true;
            continue;
        }
        if ((!TRANSFER_EXPLANATION.test(compact) && CHINESE_TRANSFER.test(compact)) || ENGLISH_TRANSFER.test(clause)) return 'request';
    }
    return declined ? 'decline' : null;
}

export function isSupportAcknowledgment(message) {
    const words = message.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    return !words || /^(?:(?:hi|hello|hey|ok(?:ay)?|gotit|thank(?:you|s)|thx|allset|imgood|(?:it)?works(?:now)?|(?:problem)?resolved|fixed|nothingelse|你好[啊呀]?|您好|嗨|哈喽|在吗|好[的滴]?|行|明白(?:了)?|知道了|收到|没问题|(?:已经|已)?解决了?|不用了?|不需要了|可以了|搞定了?|谢谢(?:你|您|啦|了)?|感谢(?:你|您)?|多谢|再见))+$/u.test(words);
}

export function isUnresolvedSupportFollowup(message) {
    const compact = message.normalize('NFKC').replace(/\s+/g, '');
    return /(?:还是|依旧|仍然|仍旧|仍|照样)[^。！；，!?;,.]{0,24}(?:不行|不可以|打不开|进不去|登不上|无法|不能|报错|失败|有问题|不成功|(?:同样|相同|一样)的问题|同一个问题)|(?:没(?:有)?(?:能)?|未能?)解决|解决不了|试(?:过|了)[^。！？!?]{0,16}(?:不行|没用|不管用|没效果)|(?:步骤|方法|建议|回复)[^。！？!?]{0,12}(?:不行|不对|没用)|(?:不管用|没效果|没用|答非所问)/u.test(compact)
        || /\b(?:still (?:not working|doesn['’]?t work|can['’]?t|unable|broken|failing|the same (?:problem|issue|error)|have the same (?:problem|issue|error))|(?:didn['’]?t|doesn['’]?t|did not|does not|won['’]?t) (?:work|help|fix)|not (?:helpful|solved|fixed|resolved)|no luck)\b/i.test(message);
}
