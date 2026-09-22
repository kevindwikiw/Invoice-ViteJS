/* eslint-disable react-refresh/only-export-components -- provider and hook are intentionally colocated. */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { createPortal } from 'react-dom';
import '../components/gallery-modal.css';

export type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    addToast: (message: string, type?: ToastType) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef(new Map<string, number>());

    const removeToast = useCallback((id: string) => {
        const timer = timersRef.current.get(id);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            timersRef.current.delete(id);
        }
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const addToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [...prev, { id, message, type }]);

        const timer = window.setTimeout(() => {
            removeToast(id);
        }, type === 'error' ? 7000 : 4500);
        timersRef.current.set(id, timer);
    }, [removeToast]);

    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            timers.forEach((timer) => window.clearTimeout(timer));
            timers.clear();
        };
    }, []);

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            {createPortal(<div aria-label="Notifications" className="fixed left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] z-[1000] flex max-h-[50dvh] flex-col gap-2 overflow-y-auto pointer-events-none sm:left-auto sm:w-96">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        role={toast.type === 'error' ? 'alert' : 'status'}
                        aria-atomic="true"
                        className={clsx(
                            "orbit-toast pointer-events-auto flex w-full items-center gap-3 px-4 py-3 rounded-lg shadow-lg border bg-[var(--bg-card)] text-[var(--text-primary)] [&>svg]:shrink-0",
                            toast.type === 'success' && "border-emerald-500/50",
                            toast.type === 'error' && "border-rose-500/50",
                            toast.type === 'info' && "border-sky-500/50"
                        )}
                    >
                        {toast.type === 'success' && <CheckCircle size={18} className="text-green-500" />}
                        {toast.type === 'error' && <AlertCircle size={18} className="text-red-500" />}
                        {toast.type === 'info' && <Info size={18} className="text-blue-500" />}

                        <p className="min-w-0 flex-1 break-words text-sm font-medium">{toast.message}</p>

                        <button
                            onClick={() => removeToast(toast.id)}
                            aria-label="Dismiss notification"
                            className="flex h-11 w-11 shrink-0 items-center justify-center hover:bg-black/5 rounded-md transition-colors focus-visible:outline-2"
                        >
                            <X size={14} className="opacity-50" />
                        </button>
                    </div>
                ))}
            </div>, document.body)}
        </ToastContext.Provider>
    );
};
