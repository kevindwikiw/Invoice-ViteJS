import { useState, useEffect } from 'react';
import { Plus, Trash2, X, Loader2, Shield, Users, AlertCircle } from 'lucide-react';
import { useAuth, getRoleLabel, getRoleColor, type UserRole } from '../context/auth';
import clsx from 'clsx';

export default function UserManagement() {
    const { user, allUsers, fetchUsers, addUser, removeUser, hasPermission } = useAuth();
    const [showModal, setShowModal] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'employee' as UserRole
    });

    // Fetch users on mount
    useEffect(() => {
        if (hasPermission('manage_users')) {
            fetchUsers();
        }
    }, [hasPermission]);

    // Only Admin/SuperAdmin can access this
    if (!hasPermission('manage_users')) {
        return (
            <div className="min-h-screen flex items-center justify-center p-8">
                <div className="text-center">
                    <AlertCircle size={48} className="mx-auto text-red-400 mb-4" />
                    <h1 className="text-2xl text-[var(--text-primary)] mb-2">Access Denied</h1>
                    <p className="text-[var(--text-muted)]">You don't have permission to manage users.</p>
                </div>
            </div>
        );
    }

    const handleSubmit = async () => {
        if (!formData.name || !formData.email || !formData.password) {
            setError('Please fill all fields');
            return;
        }

        setLoading(true);
        setError('');

        const result = await addUser({
            name: formData.name,
            email: formData.email,
            password: formData.password,
            role: formData.role
        });

        if (result.success) {
            setFormData({ name: '', email: '', password: '', role: 'employee' });
            setShowModal(false);
        } else {
            setError(result.error || 'Failed to create user');
        }

        setLoading(false);
    };

    const handleDelete = async (userId: number) => {
        if (userId === user?.id) {
            alert("You can't delete yourself!");
            return;
        }
        if (confirm('Are you sure you want to delete this user?')) {
            const result = await removeUser(userId);
            if (!result.success) {
                alert(result.error || 'Failed to delete user');
            }
        }
    };

    // Filter out superadmin users for admin view (already done server-side, but keep client filter too)
    const visibleUsers = user?.role === 'superadmin'
        ? allUsers
        : allUsers.filter(u => u.role !== 'superadmin');

    return (
        <div className="min-h-screen bg-[var(--bg-deep)] p-6 md:p-10">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-10">
                    <div>
                        <h1 className="text-3xl text-[var(--text-primary)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                            User Management
                        </h1>
                        <p className="text-[var(--text-muted)] text-sm">Manage team members and their roles</p>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="bg-[var(--accent)] text-[var(--bg-deep)] px-5 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2 shadow-lg"
                    >
                        <Plus size={16} /> Add User
                    </button>
                </div>

                {/* Users Grid */}
                <div className="grid gap-4">
                    {visibleUsers.map(u => (
                        <div
                            key={u.id}
                            className={clsx(
                                "bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 flex items-center justify-between",
                                u.id === user?.id && "ring-2 ring-[var(--accent)]/30"
                            )}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-[var(--accent)] flex items-center justify-center text-[var(--bg-deep)] font-bold text-lg">
                                    {u.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-[var(--text-primary)] font-medium">{u.name}</p>
                                        {u.id === user?.id && (
                                            <span className="text-[9px] uppercase font-bold text-[var(--accent)] border border-[var(--accent)] px-1.5 py-0.5 rounded">You</span>
                                        )}
                                    </div>
                                    <p className="text-[var(--text-muted)] text-sm">{u.email}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border", getRoleColor(u.role))}>
                                    <Shield size={12} />
                                    {getRoleLabel(u.role)}
                                </div>
                                {u.id !== user?.id && (
                                    <button
                                        onClick={() => handleDelete(u.id)}
                                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                        title="Delete User"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Empty State */}
                {visibleUsers.length === 0 && (
                    <div className="text-center py-20">
                        <Users size={48} className="mx-auto text-[var(--text-muted)] mb-4" />
                        <p className="text-[var(--text-muted)]">No users found</p>
                    </div>
                )}
            </div>

            {/* Add User Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" onClick={() => setShowModal(false)}>
                    <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-5 border-b border-[var(--border)] flex justify-between items-center">
                            <h3 className="text-xl text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Add New User</h3>
                            <button onClick={() => setShowModal(false)}><X size={20} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" /></button>
                        </div>

                        <div className="p-6 space-y-5">
                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                                    <AlertCircle size={16} />
                                    {error}
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Full Name</label>
                                <input
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="John Doe"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Email</label>
                                <input
                                    type="email"
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="john@orbit.com"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Password</label>
                                <input
                                    type="password"
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    placeholder="••••••••"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Role</label>
                                <select
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
                                    value={formData.role}
                                    onChange={e => setFormData({ ...formData, role: e.target.value as UserRole })}
                                >
                                    <option value="employee">Karyawan</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-3">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading}
                                className="px-6 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-sm font-bold uppercase tracking-widest rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shadow-lg"
                            >
                                {loading && <Loader2 size={14} className="animate-spin" />} Add User
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
