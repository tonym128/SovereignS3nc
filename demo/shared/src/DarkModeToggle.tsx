import React, { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

export function getSystemTheme(): 'light' | 'dark' {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

export function applyTheme(theme: ThemeMode) {
    if (typeof document === 'undefined') return;
    const resolved = theme === 'auto' ? getSystemTheme() : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-bs-theme', resolved);
    if (resolved === 'dark') {
        document.documentElement.classList.add('dark-theme');
        document.body?.classList.add('dark-theme');
    } else {
        document.documentElement.classList.remove('dark-theme');
        document.body?.classList.remove('dark-theme');
    }
}

export function useDarkMode() {
    const [theme, setTheme] = useState<ThemeMode>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('sov-theme') as ThemeMode;
            if (saved) return saved;
        }
        return 'auto';
    });

    useEffect(() => {
        applyTheme(theme);
        if (typeof window !== 'undefined') {
            localStorage.setItem('sov-theme', theme);
        }
    }, [theme]);

    const toggle = () => {
        setTheme(prev => {
            const current = prev === 'auto' ? getSystemTheme() : prev;
            return current === 'dark' ? 'light' : 'dark';
        });
    };

    const isDark = theme === 'dark' || (theme === 'auto' && getSystemTheme() === 'dark');

    return { theme, setTheme, toggle, isDark };
}

export const DarkModeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { toggle, isDark } = useDarkMode();

    return (
        <button
            type="button"
            className={`btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 sov-dark-mode-btn ${className}`}
            onClick={toggle}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
            <i className={`bi ${isDark ? 'bi-sun-fill text-warning' : 'bi-moon-stars-fill'}`}></i>
            <span className="d-none d-sm-inline">{isDark ? 'Light' : 'Dark'}</span>
        </button>
    );
};
