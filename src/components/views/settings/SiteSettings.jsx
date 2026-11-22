import React, { lazy, Suspense, useState } from 'react';
import { Loader2, Palette, Type } from 'lucide-react';

const ContentManager = lazy(() => import('./ContentManager'));
const AppearanceManager = lazy(() => import('./AppearanceManager'));

const SECTIONS = [
    { id: 'content', label: '全局文案', icon: Type },
    { id: 'appearance', label: '界面外观', icon: Palette }
];

function SectionLoading() {
    return (
        <div className="flex min-h-60 items-center justify-center text-indigo-500" role="status">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">正在加载设置…</span>
        </div>
    );
}

export default function SiteSettings({ config, onSaveContent, settings, effectiveLightDark, onSaveAppearance, token }) {
    const [section, setSection] = useState('content');
    const [appearanceOpened, setAppearanceOpened] = useState(false);

    return (
        <div className="flex min-w-0 flex-col gap-5">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">站点设置</h1>
            <div className="grid max-w-sm grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 dark:border-slate-700 dark:bg-slate-900/50" role="group" aria-label="站点设置分类">
                {SECTIONS.map(({ id, label, icon: Icon }) => {
                    const selected = section === id;
                    return (
                        <button
                            key={id}
                            id={`site-settings-${id}-button`}
                            type="button"
                            aria-pressed={selected}
                            aria-controls={`site-settings-${id}`}
                            onClick={() => {
                                if (id === 'appearance') setAppearanceOpened(true);
                                setSection(id);
                            }}
                            className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${selected
                                ? 'settings-nav-active bg-indigo-600 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'}`}
                        >
                            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {label}
                        </button>
                    );
                })}
            </div>

            <section id="site-settings-content" aria-labelledby="site-settings-content-button" hidden={section !== 'content'}>
                <Suspense fallback={<SectionLoading />}>
                    <ContentManager config={config} onSave={onSaveContent} />
                </Suspense>
            </section>
            <section id="site-settings-appearance" aria-labelledby="site-settings-appearance-button" hidden={section !== 'appearance'}>
                {appearanceOpened && (
                    <Suspense fallback={<SectionLoading />}>
                        <AppearanceManager settings={settings} effectiveLightDark={effectiveLightDark} onSave={onSaveAppearance} token={token} />
                    </Suspense>
                )}
            </section>
        </div>
    );
}
