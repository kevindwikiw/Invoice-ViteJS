import { useState, type ReactNode } from 'react';
import {
    AlertTriangle,
    Check,
    Eye,
    EyeOff,
    Key,
    Loader2,
    Shield,
    Trash2,
    UserPlus,
} from 'lucide-react';
import { ModalShell } from '../../components/ui/ModalShell';
import type { User, UserRole } from '../../context/auth';
import type { CreateMemberInput } from './model';

const INPUT_CLASS = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3.5 py-2.5 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]';
const SECONDARY_BUTTON = 'rounded-lg border border-[var(--border)] px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]';
const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-[var(--bg-deep)] transition-opacity disabled:opacity-40';

function ErrorMessage({ message }: { message?: string }) {
    if (!message) return null;
    return (
        <div className="mb-4 border-l-2 border-rose-500 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
            {message}
        </div>
    );
}

export function AddMemberModal({
    open,
    allowSuperadmin,
    loading,
    error,
    onClose,
    onSubmit,
}: {
    open: boolean;
    allowSuperadmin: boolean;
    loading: boolean;
    error?: string;
    onClose: () => void;
    onSubmit: (input: CreateMemberInput) => void;
}) {
    const [form, setForm] = useState<CreateMemberInput>({
        name: '',
        email: '',
        password: '',
        role: 'employee',
    });
    const [validationError, setValidationError] = useState('');

    const submit = () => {
        if (!form.name.trim() || !form.email.trim() || !form.password) {
            setValidationError('Name, email, and password are required.');
            return;
        }
        if (form.password.length < 8) {
            setValidationError('Password must be at least 8 characters.');
            return;
        }
        setValidationError('');
        onSubmit({
            ...form,
            name: form.name.trim(),
            email: form.email.trim(),
        });
    };

    return (
        <ModalShell
            open={open}
            title="Add member"
            description="Create a workspace account and assign its starting role."
            icon={UserPlus}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>Cancel</button>
                    <button type="button" className={PRIMARY_BUTTON} disabled={loading} onClick={submit}>
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        Add member
                    </button>
                </>
            )}
        >
            <ErrorMessage message={validationError || error} />
            <div className="space-y-4">
                <Field label="Full name" htmlFor="new-member-name">
                    <input
                        id="new-member-name"
                        value={form.name}
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Alex Rivera"
                        className={INPUT_CLASS}
                    />
                </Field>
                <Field label="Email address" htmlFor="new-member-email">
                    <input
                        id="new-member-email"
                        type="email"
                        value={form.email}
                        onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                        placeholder="alex@company.com"
                        className={INPUT_CLASS}
                    />
                </Field>
                <Field label="Initial password" htmlFor="new-member-password">
                    <input
                        id="new-member-password"
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                        placeholder="Minimum 6 characters"
                        className={INPUT_CLASS}
                    />
                </Field>
                <Field label="Workspace role" htmlFor="new-member-role">
                    <select
                        id="new-member-role"
                        value={form.role}
                        onChange={(event) => setForm((current) => ({
                            ...current,
                            role: event.target.value as UserRole,
                        }))}
                        className={INPUT_CLASS}
                    >
                        <option value="employee">Employee</option>
                        <option value="admin">Admin</option>
                        {allowSuperadmin && <option value="superadmin">Super admin</option>}
                    </select>
                </Field>
            </div>
        </ModalShell>
    );
}

export function ResetPasswordModal({
    member,
    loading,
    error,
    onClose,
    onSubmit,
}: {
    member: User | null;
    loading: boolean;
    error?: string;
    onClose: () => void;
    onSubmit: (password: string) => void;
}) {
    const [password, setPassword] = useState('');
    const [visible, setVisible] = useState(false);
    const [validationError, setValidationError] = useState('');

    const submit = () => {
        if (password.length < 8) {
            setValidationError('Password must be at least 8 characters.');
            return;
        }
        setValidationError('');
        onSubmit(password);
    };

    return (
        <ModalShell
            open={member !== null}
            title="Reset password"
            description={member ? `Set a new password for ${member.name}.` : undefined}
            icon={Key}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>Cancel</button>
                    <button type="button" className={PRIMARY_BUTTON} disabled={loading} onClick={submit}>
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        Update password
                    </button>
                </>
            )}
        >
            <ErrorMessage message={validationError || error} />
            <Field label="New password" htmlFor="reset-member-password">
                <div className="relative">
                    <input
                        id="reset-member-password"
                        type={visible ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={`${INPUT_CLASS} pr-10`}
                        placeholder="Minimum 6 characters"
                    />
                    <button
                        type="button"
                        aria-label={visible ? 'Hide password' : 'Show password'}
                        onClick={() => setVisible((current) => !current)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </div>
            </Field>
        </ModalShell>
    );
}

export function ConfirmAccessModal({
    member,
    loading,
    error,
    onClose,
    onConfirm,
}: {
    member: User | null;
    loading: boolean;
    error?: string;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <ModalShell
            open={member !== null}
            title="Apply access changes?"
            description="The updated feature policy takes effect immediately."
            icon={Shield}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>Cancel</button>
                    <button type="button" className={PRIMARY_BUTTON} disabled={loading} onClick={onConfirm}>
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Apply changes
                    </button>
                </>
            )}
        >
            <ErrorMessage message={error} />
            {member && <MemberSummary member={member} />}
        </ModalShell>
    );
}

export function DeleteMemberModal({
    member,
    loading,
    error,
    onClose,
    onConfirm,
}: {
    member: User | null;
    loading: boolean;
    error?: string;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <ModalShell
            open={member !== null}
            title="Remove member?"
            description="This account will lose workspace access and cannot be restored automatically."
            icon={AlertTriangle}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>Cancel</button>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={onConfirm}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-4 py-2.5 text-xs font-bold text-white transition-opacity disabled:opacity-40"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Remove member
                    </button>
                </>
            )}
        >
            <ErrorMessage message={error} />
            {member && <MemberSummary member={member} />}
        </ModalShell>
    );
}

function MemberSummary({ member }: { member: User }) {
    return (
        <div className="flex items-center gap-3 border-y border-[var(--border)] py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] font-semibold text-[var(--accent)]">
                {member.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{member.name}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">{member.email}</p>
            </div>
        </div>
    );
}

function Field({
    label,
    htmlFor,
    children,
}: {
    label: string;
    htmlFor: string;
    children: ReactNode;
}) {
    return (
        <div>
            <label htmlFor={htmlFor} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {label}
            </label>
            {children}
        </div>
    );
}

