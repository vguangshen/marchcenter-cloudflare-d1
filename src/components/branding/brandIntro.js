import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../../utils/motionPreferences';

// The brand (logo tile + wordmark) makes its entrance once per page load:
// on the login header, or on the dashboard navbar when the session is
// restored. The login → dashboard hand-off must not replay it.
let brandIntroPlayed = false;

export function useBrandIntro() {
    const [intro] = useState(() => !brandIntroPlayed && !prefersReducedMotion());
    useEffect(() => {
        if (intro) brandIntroPlayed = true;
    }, [intro]);
    return intro;
}
