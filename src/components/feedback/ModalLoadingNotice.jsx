import React from 'react';
import { Loader2 } from 'lucide-react';

export default function ModalLoadingNotice() {
    return (
        <div className="mc-modal-backdrop mc-modal-backdrop--top" role="status" aria-live="polite">
            <div className="mc-surface flex items-center gap-3 rounded-2xl px-6 py-5 text-sm font-bold">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                正在打开操作窗口…
            </div>
        </div>
    );
}
