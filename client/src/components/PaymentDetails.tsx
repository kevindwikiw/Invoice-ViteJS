import { X, Upload, Loader2, FileText } from 'lucide-react';
import { useAuthenticatedProofUrls } from '../hooks/useAuthenticatedProofUrls';

interface PaymentDetailsProps {
    isUploadingProofs: boolean;
    existingProofUrls: string[];
    paymentProofs: File[];
    setPaymentProofs: (val: File[] | ((prev: File[]) => File[])) => void;
    onUploadProofs: (files: FileList) => Promise<void> | void;
    onRemoveExistingProof?: (filename: string) => void;
}

export function PaymentDetails({
    isUploadingProofs,
    existingProofUrls,
    paymentProofs,
    setPaymentProofs,
    onUploadProofs,
    onRemoveExistingProof
}: PaymentDetailsProps) {
    const authenticatedProofUrls = useAuthenticatedProofUrls(existingProofUrls);

    return (
        <div className="animate-in fade-in duration-500">
            <div className="relative border-2 border-dashed border-[var(--border)] rounded-2xl p-8 text-center hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.02] transition-all group overflow-hidden">
                <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
                    onChange={(e) => e.target.files && onUploadProofs(e.target.files)}
                />

                <div className="relative z-10 flex flex-col items-center">
                    {isUploadingProofs ? (
                        <div className="flex flex-col items-center gap-4">
                            <div className="p-4 bg-[var(--accent)]/10 rounded-full relative">
                                <Loader2 size={32} className="animate-spin text-[var(--accent)]" />
                                <div className="absolute inset-0 animate-ping bg-[var(--accent)]/20 rounded-full scale-150 opacity-20"></div>
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)] animate-pulse">Processing Evidence</p>
                                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold">Please stand by...</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)] border border-[var(--border)] mb-4 group-hover:scale-110 group-hover:border-[var(--accent)]/40 transition-all duration-500">
                                <Upload size={28} className="group-hover:text-[var(--accent)] transition-colors" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-sm font-bold text-[var(--text-primary)]">Upload Payment Proofs</h3>
                                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-[0.15em] font-medium max-w-xs mx-auto leading-relaxed">
                                    Transfer receipts, transaction screenshots, or confirmation letters in JPEG/PNG format.
                                </p>
                            </div>
                        </>
                    )}
                </div>

                {/* List items if any */}
                {(existingProofUrls.length > 0 || paymentProofs.length > 0) && (
                    <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 relative z-40">
                        {/* Saved Proofs */}
                        {existingProofUrls.map((filename, idx) => (
                            <div key={`exist_${idx}`} className="group/item relative aspect-square rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--bg-deep)]">
                                <img
                                    src={authenticatedProofUrls[filename]}
                                    alt="Proof"
                                    className="w-full h-full object-cover transition-transform duration-700 group-hover/item:scale-110"
                                />
                                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                    <p className="text-[8px] text-white font-bold uppercase tracking-wider truncate">SAVED</p>
                                </div>
                                {onRemoveExistingProof && (
                                    <button
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            onRemoveExistingProof(filename); 
                                        }}
                                        className="absolute top-1 right-1 h-5 w-5 bg-red-500 text-white rounded-lg flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity z-10"
                                    >
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {/* New Pending Proofs */}
                        {paymentProofs.map((file, idx) => {
                            const isImage = file.type.startsWith('image/');
                            const previewUrl = isImage ? URL.createObjectURL(file) : null;
                            
                            return (
                                <div key={`new_${idx}`} className="group/item relative aspect-square rounded-2xl overflow-hidden border border-[var(--accent)]/30 bg-[var(--accent)]/5">
                                    <div className="w-full h-full flex flex-col items-center justify-center p-2">
                                        {isImage ? (
                                            <img src={previewUrl!} alt="Preview" className="w-full h-full object-cover" />
                                        ) : (
                                            <>
                                                <FileText size={24} className="text-[var(--accent)] mb-2" />
                                                <p className="text-[7px] text-[var(--accent)] font-black uppercase tracking-tighter truncate w-full text-center px-1">{file.name}</p>
                                            </>
                                        )}
                                    </div>
                                    <button
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            if (previewUrl) URL.revokeObjectURL(previewUrl);
                                            setPaymentProofs(prev => prev.filter((_, i) => i !== idx)); 
                                        }}
                                        className="absolute top-1 right-1 h-5 w-5 bg-red-500 text-white rounded-lg flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity z-10"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
