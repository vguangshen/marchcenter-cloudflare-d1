function append(parent, tagName, { className = '', text = '' } = {}) {
    const element = parent.ownerDocument.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    parent.appendChild(element);
    return element;
}

export function renderLaunchWindow(opened, {
    title = '正在进入竞赛平台',
    message = '正在准备免密登录，请稍候…',
    tone = 'indigo'
} = {}) {
    if (!opened || opened.closed) return;
    const palette = tone === 'amber'
        ? { accent: '#f59e0b', accentEnd: '#f97316', soft: '#fff7ed' }
        : tone === 'violet'
            ? { accent: '#7c3aed', accentEnd: '#4f46e5', soft: '#f5f3ff' }
            : { accent: '#4f46e5', accentEnd: '#2563eb', soft: '#eef2ff' };
    const doc = opened.document;
    doc.title = `MarchCenter · ${title}`;
    doc.documentElement.lang = 'zh-CN';
    doc.documentElement.style.background = palette.soft;
    doc.body.replaceChildren();
    Object.assign(doc.body.style, {
        margin: '0', minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: `linear-gradient(145deg, ${palette.soft} 0%, #ffffff 52%, #f8fafc 100%)`,
        color: '#1e293b', fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif"
    });
    const main = append(doc.body, 'main');
    main.setAttribute('aria-live', 'polite');
    Object.assign(main.style, { width: 'min(440px,calc(100vw - 48px))', textAlign: 'center' });
    const panel = append(main, 'section');
    Object.assign(panel.style, {
        padding: '42px 38px', border: `1px solid ${palette.accent}33`, borderRadius: '28px',
        background: 'rgba(255,255,255,.9)', boxShadow: '0 24px 70px rgba(15,23,42,.13)'
    });
    const icon = append(panel, 'div', { text: '⌁' });
    Object.assign(icon.style, {
        width: '64px', height: '64px', margin: '0 auto 22px', borderRadius: '20px',
        display: 'grid', placeItems: 'center', color: '#fff', fontSize: '29px',
        background: `linear-gradient(135deg,${palette.accent},${palette.accentEnd})`,
        boxShadow: `0 12px 28px ${palette.accent}42`
    });
    const heading = append(panel, 'h1', { text: title });
    Object.assign(heading.style, { fontSize: '24px', margin: '0 0 12px' });
    const copy = append(panel, 'p', { text: message });
    Object.assign(copy.style, { fontSize: '15px', lineHeight: '1.7', color: '#64748b', margin: '0 0 25px' });
    const progress = append(panel, 'div');
    Object.assign(progress.style, {
        height: '6px', borderRadius: '999px', overflow: 'hidden', background: `${palette.accent}20`
    });
    const bar = append(progress, 'i');
    Object.assign(bar.style, {
        display: 'block', width: '46%', height: '100%', borderRadius: 'inherit',
        background: `linear-gradient(90deg,${palette.accent},${palette.accentEnd})`,
        animation: 'marchcenter-launch-progress 1.05s ease-in-out infinite alternate'
    });
    const hint = append(panel, 'p', { text: '窗口会在准备完成后自动跳转，请不要关闭' });
    Object.assign(hint.style, { fontSize: '12px', color: '#94a3b8', margin: '18px 0 0' });
    const style = append(doc.head, 'style');
    style.textContent = '@keyframes marchcenter-launch-progress{from{transform:translateX(-25%)}to{transform:translateX(145%)}}';
}
