import React from 'react';
import { X, Image as ImageIcon, Loader2, Download, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../lib/api';
import { useAuthenticatedProofUrls } from '../hooks/useAuthenticatedProofUrls';
import { useToast } from '../context/ToastContext';
import { compressImage } from '../utils/image';
import clsx from 'clsx';

interface ProofsSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    invoiceId: string;
    isPreviewMode: boolean;
    invoice: { id?: string | number } | null;
    proofs: string[];
    rawPreviewData: string | null;
}

export const ProofsSidebar = React.memo(({
    isOpen,
    onClose,
    invoiceId,
    isPreviewMode,
    invoice,
    proofs,
    rawPreviewData
}: ProofsSidebarProps) => {
    const queryClient = useQueryClient();
    const { addToast } = useToast();
    const authenticatedProofUrls = useAuthenticatedProofUrls(proofs);

    // === PROOF MANAGEMENT MUTATIONS ===
    const uploadProofMutation = useMutation({
        mutationFn: async (files: FileList) => {
            const targetId = invoice?.id || invoiceId;
            let successCount = 0;
            const fileArray = Array.from(files);

            for (const file of fileArray) {
                const compressedFile = await compressImage(file);
                if (compressedFile.size > 5 * 1024 * 1024) {
                    addToast(`File ${file.name} too large (max 5MB)`, 'error');
                    continue;
                }

                const formData = new FormData();
                formData.append('file', compressedFile);

                const res = await fetchWithAuth(`/invoices/${targetId}/proofs`, {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) successCount++;
            }
            return successCount;
        },
        onSuccess: (count) => {
            if (count > 0) {
                queryClient.invalidateQueries({ queryKey: ['invoice', String(invoice?.id || invoiceId)] });
                addToast(`${count} proof(s) uploaded`, 'success');
            }
        },
        onError: (err) => {
            console.error(err);
            addToast('Error uploading proofs', 'error');
        }
    });

    const deleteProofMutation = useMutation({
        mutationFn: async (filename: string) => {
            if (isPreviewMode) {
                if (!rawPreviewData) return;
                const data = JSON.parse(rawPreviewData);
                const currentProofs = data.paymentProofs ? JSON.parse(data.paymentProofs) : [];
                const updatedProofs = currentProofs.filter((p: string) => p !== filename);
                const updatedData = { ...data, paymentProofs: JSON.stringify(updatedProofs) };
                sessionStorage.setItem('invoice_preview', JSON.stringify(updatedData));
                return { isPreview: true };
            }

            const res = await fetchWithAuth(`/invoices/${invoice?.id || invoiceId}/proofs`, {
                method: 'DELETE',
                body: JSON.stringify({ proof: filename })
            });
            if (!res.ok) throw new Error('Failed to delete proof');
            return { isPreview: false };
        },
        onSuccess: (res) => {
            if (res?.isPreview) {
                addToast('Proof removed from preview', 'success');
                window.location.reload();
            } else {
                addToast('Proof deleted', 'success');
                queryClient.invalidateQueries({ queryKey: ['invoice', String(invoice?.id || invoiceId)] });
            }
        },
        onError: (err) => {
            console.error(err);
            addToast('Error deleting proof', 'error');
        }
    });

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        uploadProofMutation.mutate(files);
        e.target.value = '';
    };

    const handleDeleteProof = (filename: string) => {
        if (!window.confirm('Delete this proof?')) return;
        deleteProofMutation.mutate(filename);
    };

    return (
        <>
            <div className={clsx(
                "fixed inset-y-0 right-0 w-80 bg-[var(--bg-card)] shadow-2xl transform transition-transform duration-300 ease-in-out z-50 border-l border-[var(--border)] flex flex-col",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}
            style={{ willChange: 'transform' }} // Optimization for animations
            >
                <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
                    <h3 className="font-bold text-[var(--text-primary)]">Payment Proofs</h3>
                    <button onClick={onClose} className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {proofs.length === 0 ? (
                        <div className="text-center py-8 text-[var(--text-muted)] text-sm border-2 border-dashed border-[var(--border)] rounded-lg">
                            <ImageIcon className="mx-auto mb-2 opacity-50" size={24} />
                            No proofs uploaded yet
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {proofs.map((filename, idx) => {
                                if (typeof filename !== 'string') return null;
                                const source = authenticatedProofUrls[filename];
                                return (
                                    <div key={idx} className="group relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-deep)]">
                                        <a href={source || '#'} target="_blank" rel="noopener noreferrer" className="block aspect-video">
                                            <img
                                                src={source}
                                                alt="Proof"
                                                className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                                                loading="lazy"
                                            />
                                        </a>
                                        <div className="absolute bottom-0 inset-x-0 bg-black/60 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-center backdrop-blur-sm">
                                            <span className="text-[10px] text-white truncate max-w-[60%]">{filename.split('_').slice(2).join('_') || filename}</span>
                                            <div className="flex items-center gap-2">
                                                <a
                                                    href={source || '#'}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-white hover:text-[var(--accent)]"
                                                    title="Download"
                                                >
                                                    <Download size={14} />
                                                </a>
                                                <button
                                                    onClick={() => handleDeleteProof(filename)}
                                                    className="text-white hover:text-red-400 transition-colors"
                                                    title="Delete Proof"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
                    <label className={clsx(
                        "flex items-center justify-center gap-2 w-full px-4 py-3 bg-[var(--bg-card)] border border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] hover:shadow-[0_0_20px_rgba(196,163,90,0.1)] rounded-xl cursor-pointer transition-all text-xs font-bold uppercase tracking-widest",
                        uploadProofMutation.isPending ? "opacity-50 cursor-wait" : "active:scale-[0.98]"
                    )}>
                        {uploadProofMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        {uploadProofMutation.isPending ? "Uploading..." : "Upload New Proof"}
                        <input
                            type="file"
                            multiple
                            className="hidden"
                            accept="image/*,application/pdf"
                            onChange={handleUpload}
                            disabled={uploadProofMutation.isPending}
                        />
                    </label>
                    <p className="text-[10px] text-[var(--text-muted)] text-center mt-3 font-light italic">
                        Support JPG, PNG (Max 5MB)
                    </p>
                </div>
            </div>
            {/* Backdrop for mobile mobile/overlay */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 md:hidden animate-in fade-in duration-300" 
                    onClick={onClose}
                />
            )}
        </>
    );
});

ProofsSidebar.displayName = 'ProofsSidebar';
