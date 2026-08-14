import { useEffect, useState } from 'react';

export function useDarkMode() {
    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('darkMode');
            if (saved !== null) return saved === 'true';
        }
        return true;
    });

    useEffect(() => {
        document.documentElement.classList.toggle('dark', darkMode);
        document.documentElement.classList.toggle('light', !darkMode);
        localStorage.setItem('darkMode', String(darkMode));
    }, [darkMode]);

    return [darkMode, setDarkMode] as const;
}
