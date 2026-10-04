import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Clipboard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  FileSpreadsheet,
  FolderSync,
  Images,
  Infinity as InfinityIcon,
  KeyRound,
  Lightbulb,
  LightbulbOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/auth';
import { useToast } from '../context/ToastContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { SectionHeading } from '../components/SectionHeading';
import { PANEL_CARD_CLASS } from '../constants/invoice';
import {
  PAGE_SHELL_CLASS,
  SEGMENT_BUTTON_ACTIVE_CLASS,
  SEGMENT_BUTTON_BASE_CLASS,
  SEGMENT_BUTTON_INACTIVE_CLASS,
  SEGMENT_GROUP_CLASS,
} from '../constants/uiContract';

import type {
  GalleryMode,
  GalleryStatus,
  GallerySummary
} from '../features/culling/culling.types';

import {
  calculateAddonQuote
} from '../features/culling/culling.public';

import {
  createGallery,
  deleteGallery,
  downloadGallerySelectionCopyScript,
  downloadGallerySelections,
  downloadGallerySelectionsXlsx,
  getGalleryContact,
  getGalleryDetail,
  listGalleries,
  publishEditResults,
  resetGalleryPinLock,
  saveGalleryContact,
  syncGallery,
  unpublishEditResults,
  updateGallery,
} from '../features/culling/culling.admin';
import { formatDateValue } from '../lib/date';
import { GalleryModal as Modal } from '../components/GalleryModal';
import { EditResultPairs } from '../features/culling/EditResultPairs';


function GalleryModeTabs({ value, onChange, disabled = false, scope }: { value: GalleryMode; onChange: (mode: GalleryMode) => void; disabled?: boolean; scope: string }) {
  const options = [{ value: 'selection', label: 'Photo Selection' }, { value: 'edited', label: 'Edited Photos' }] as const;
  return <div role="tablist" aria-label="Gallery area" className="flex border-b border-[var(--border)]">
    {options.map((option) => <button key={option.value} type="button" role="tab" id={`${scope}-${option.value}-tab`} aria-controls={`${scope}-panel`} aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={disabled}
      onClick={() => onChange(option.value)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'selection' : event.key === 'End' ? 'edited' : value === 'selection' ? 'edited' : 'selection';
        onChange(next);
        document.getElementById(`${scope}-${next}-tab`)?.focus();
      }}
      className={clsx('min-h-11 flex-1 border-b-2 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 sm:flex-none sm:px-5', value === option.value ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]')}
    >{option.label}</button>)}
  </div>;
}

const PAGE_SIZE = 10;
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const idrFormat = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const inputClass = 'h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]/60 hover:border-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]';
const compactInputClass = inputClass;
const unitInputShellClass = 'grid h-11 grid-cols-[minmax(0,1fr)_4.5rem] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-deep)] transition-colors hover:border-[var(--text-muted)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]';
const compactUnitInputShellClass = unitInputShellClass;
const unitInputClass = 'h-full min-w-0 border-0 bg-transparent px-3.5 text-sm tabular-nums text-[var(--text-primary)] outline-none';
const unitInputSuffixClass = 'flex h-full items-center justify-center border-l border-[var(--border)] px-2 text-[11px] font-medium text-[var(--text-muted)]';
const publicUrl = (gallery: GallerySummary) => `${window.location.origin}/culling/${gallery.publicKey || gallery.id}`;
const driveUrl = (gallery: GallerySummary) => (gallery.driveFolderId.startsWith('http') ? gallery.driveFolderId : `https://drive.google.com/drive/folders/${gallery.driveFolderId}`);
const parseIdr = (value: FormDataEntryValue | null) => Number(String(value || '').replace(/\D/g, '')) || 0;

function deadlineLabel(gallery: Pick<GallerySummary, 'selectionDeadlineAt' | 'isExpired'>): string {
  if (!gallery.selectionDeadlineAt) return 'Not set';
  if (gallery.isExpired) return 'Expired';
  return formatDateValue(gallery.selectionDeadlineAt, dateFormat, 'Not set');
}

const Unlimited = () => (
  <span title="Unlimited" aria-label="Unlimited">
    <InfinityIcon size={18} strokeWidth={2.5} />
  </span>
);

function statusTone(status: string) {
  if (status === 'open') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400';
  if (status === 'closed') return 'border-rose-500/25 bg-rose-500/10 text-rose-400';
  return 'border-amber-500/25 bg-amber-500/10 text-amber-400';
}

function useDismissableMenu(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  return ref;
}

function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-2">
      <span className="block text-[11px] font-semibold text-[var(--text-secondary)]" title={title}>{label}</span>
      {children}
    </label>
  );
}

function Pager({ page, totalPages, total, limit, onChange }: { page: number; totalPages: number; total: number; limit: number; onChange: (page: number) => void }) {
  if (total <= 0) return null;
  const firstItem = (page - 1) * limit + 1;
  const lastItem = Math.min(page * limit, total);

  return (
    <footer className="flex flex-col gap-3 border-t border-[var(--border)] px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="inline-flex items-center gap-2 text-[10px] font-medium text-[var(--text-muted)]">
        Showing {firstItem}-{lastItem} of {total} galleries
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={13} />
          Previous
        </button>
        <span className="min-w-[78px] text-center text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight size={13} />
        </button>
      </div>
    </footer>
  );
}

function CreateGalleryModal({
  close,
  pending,
  submit,
}: {
  close: () => void;
  pending: boolean;
  submit: (input: { title: string; driveFolderUrl: string; pin: string; status: GalleryStatus; maxSelections: number; selectionDurationHours: number; qrisEnabled?: boolean; tutorialBeforeDriveFileId?: string; tutorialAfterDriveFileId?: string; tutorialBefore2DriveFileId?: string; tutorialAfter2DriveFileId?: string; tutorialBefore3DriveFileId?: string; tutorialAfter3DriveFileId?: string }) => void;
}) {
  return (
    <Modal title="Create gallery" close={close} busy={pending} widthClass="max-w-lg" maxHeightClass="max-h-[min(90dvh,620px)]" footer={(
      <>
        <button type="button" disabled={pending} onClick={close} className="h-11 rounded-md px-4 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50">Cancel</button>
        <button type="submit" form="create-gallery-form" disabled={pending} className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-deep)] disabled:opacity-50">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {pending ? 'Creating...' : 'Create gallery'}
        </button>
      </>
    )}>
      <form
        id="create-gallery-form"
        aria-busy={pending}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const data = new FormData(event.currentTarget);
          submit({
            title: String(data.get('title') || '').trim(),
            driveFolderUrl: String(data.get('drive') || '').trim(),
            pin: String(data.get('pin') || ''),
            status: 'draft',
            maxSelections: Math.min(500, Math.max(0, Number(data.get('limit')) || 0)),
            selectionDurationHours: Math.min(8760, Math.max(1, Number(data.get('duration')) || 72)),
            qrisEnabled: data.get('qrisEnabled') === 'on',
            tutorialBeforeDriveFileId: String(data.get('tutorialBeforeDriveFileId') || '').trim(),
            tutorialAfterDriveFileId: String(data.get('tutorialAfterDriveFileId') || '').trim(),
            tutorialBefore2DriveFileId: String(data.get('tutorialBefore2DriveFileId') || '').trim(),
            tutorialAfter2DriveFileId: String(data.get('tutorialAfter2DriveFileId') || '').trim(),
            tutorialBefore3DriveFileId: String(data.get('tutorialBefore3DriveFileId') || '').trim(),
            tutorialAfter3DriveFileId: String(data.get('tutorialAfter3DriveFileId') || '').trim(),
          });
        }}
      >
        <Field label="Gallery name">
          <input name="title" required placeholder="Aldian & Panpan Prewedding" className={compactInputClass} />
        </Field>
        <Field label="Google Drive folder">
          <input name="drive" required placeholder="https://drive.google.com/drive/folders/..." className={compactInputClass} />
        </Field>
        <details className="border-y border-[var(--border)] py-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">Before / edited preview <span className="font-normal text-[var(--text-muted)]">(optional)</span></summary>
          <div className="mt-3 space-y-3">
            {[1, 2, 3].map((slot) => {
              const suffix = slot === 1 ? '' : String(slot);
              return (
                <div key={slot} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
                  <span className="pb-2 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">{String(slot).padStart(2, '0')}</span>
                  <Field label="Before photo">
                    <input name={`tutorialBefore${suffix}DriveFileId`} placeholder="Before file link or ID" className={compactInputClass} />
                  </Field>
                  <Field label="Edited photo">
                    <input name={`tutorialAfter${suffix}DriveFileId`} placeholder="Edited file link or ID" className={compactInputClass} />
                  </Field>
                </div>
              );
            })}
          </div>
        </details>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client PIN">
            <input name="pin" required minLength={4} inputMode="numeric" autoComplete="off" placeholder="4821" className={compactInputClass} />
          </Field>
          <Field label="Selection window">
            <div className={compactUnitInputShellClass}>
              <input name="duration" required type="number" min="1" max="8760" defaultValue="72" className={unitInputClass} />
              <span className={unitInputSuffixClass}>hours</span>
            </div>
          </Field>
        </div>
        <Field label="Selection limit">
          <div className={compactUnitInputShellClass}>
            <input name="limit" required type="number" min="0" max="500" defaultValue="50" className={unitInputClass} />
            <span className={unitInputSuffixClass}>photos</span>
          </div>
          <span className="block text-[10px] leading-4 text-[var(--text-muted)]">Use 0 for unlimited selections.</span>
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/35 p-3 transition-colors hover:border-[var(--accent)]/45">
          <input name="qrisEnabled" type="checkbox" className="mt-0.5 h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-[var(--text-primary)]">Butuh QRIS self-service?</span>
            <span className="mt-1 block text-[10px] leading-4 text-[var(--text-muted)]">Client bisa bayar tambahan foto langsung lewat QRIS. Kalau mati, tombol request tetap lewat WhatsApp manual.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

function GalleryFilters({ filter, setFilter }: { filter: 'all' | GalleryStatus; setFilter: (filter: 'all' | GalleryStatus) => void }) {
  const options: Array<{ value: 'all' | GalleryStatus; label: string; icon: ReactNode }> = [
    { value: 'all', label: 'All', icon: <Images size={14} /> },
    { value: 'open', label: 'Open', icon: <Lightbulb size={14} /> },
    { value: 'draft', label: 'Draft', icon: <Settings2 size={14} /> },
    { value: 'closed', label: 'Closed', icon: <LightbulbOff size={14} /> },
  ];
  return (
    <div className={SEGMENT_GROUP_CLASS}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={`Filter ${option.label}`}
          onClick={() => setFilter(option.value)}
          className={clsx(
            SEGMENT_BUTTON_BASE_CLASS,
            'inline-flex cursor-pointer items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
            filter === option.value ? SEGMENT_BUTTON_ACTIVE_CLASS : SEGMENT_BUTTON_INACTIVE_CLASS
          )}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function DownloadMenu({
  gallery,
  className,
  direction = 'up',
}: {
  gallery: GallerySummary;
  className?: string;
  direction?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useDismissableMenu(open, () => setOpen(false));
  const disabled = !gallery.selectionCount;
  return (
    <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        title="Download selections"
        aria-label={`Download ${gallery.title} selections`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          className ||
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40'
        }
      >
        <Download size={13} />
        {className && <span>Download</span>}
      </button>
      {open && !disabled && (
        <div
          className={clsx(
            'absolute right-0 z-30 min-w-32 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl',
            direction === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'
          )}
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void downloadGallerySelections(gallery.id);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)]"
          >
            <Download size={12} />
            CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void downloadGallerySelectionsXlsx(gallery.id);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)]"
          >
            <FileSpreadsheet size={12} />
            XLSX
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void downloadGallerySelectionCopyScript(gallery.id);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)]"
          >
            <FileCode2 size={12} />
            PS1
          </button>
        </div>
      )}
    </div>
  );
}

function ClientLinkMenu({ gallery, mode }: { gallery: GallerySummary; mode: GalleryMode }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useDismissableMenu(open, () => setOpen(false));
  const link = publicUrl(gallery) + (mode === 'edited' ? '?view=edit-results' : '');
  return (
    <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        title="Client link"
        aria-label={`${gallery.title} client link actions`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <ExternalLink size={13} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 z-30 min-w-36 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigator.clipboard.writeText(link).then(() => addToast('Client link copied.', 'success'));
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)]"
          >
            <Clipboard size={12} />
            Copy link
          </button>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)]"
          >
            <ExternalLink size={12} />
            Open link
          </a>
        </div>
      )}
    </div>
  );
}

function MaintenanceMenu({
  gallery,
  onResetPin,
  onDelete,
  resetPending,
  deletePending,
}: {
  gallery: GallerySummary;
  onResetPin: (id: number) => void;
  onDelete: (gallery: GallerySummary) => void;
  resetPending: boolean;
  deletePending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useDismissableMenu(open, () => setOpen(false));
  const pending = resetPending || deletePending;
  return (
    <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        title="Maintenance"
        aria-label={`${gallery.title} maintenance actions`}
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40',
          open && 'border-[var(--accent)] bg-[var(--bg-elevated)]'
        )}
      >
        {pending ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 z-30 min-w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">
          <button
            type="button"
            disabled={resetPending}
            onClick={() => {
              setOpen(false);
              onResetPin(gallery.id);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyRound size={12} />
            Unlock PIN
          </button>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              setOpen(false);
              onDelete(gallery);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase text-rose-400 hover:bg-rose-500/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={12} />
            Delete gallery
          </button>
        </div>
      )}
    </div>
  );
}

function StatusQuickActions({ gallery, onChange, pending }: { gallery: GallerySummary; onChange: (status: GalleryStatus) => void; pending: boolean }) {
  const options: Array<{ status: GalleryStatus; label: string; icon: ReactNode }> = [
    { status: 'open', label: 'Open', icon: <Lightbulb size={13} /> },
    { status: 'draft', label: 'Draft', icon: <Settings2 size={13} /> },
    { status: 'closed', label: 'Closed', icon: <LightbulbOff size={13} /> },
  ];
  return (
    <div aria-busy={pending} className="flex items-center justify-center gap-1" onClick={(event) => event.stopPropagation()}>
      {options.map((option) => (
        <button
          key={option.status}
          type="button"
          disabled={pending || gallery.status === option.status}
          title={option.label}
          aria-label={`${gallery.title}: set ${option.label}`}
          aria-pressed={gallery.status === option.status}
          onClick={() => onChange(option.status)}
          className={clsx(
            'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed',
            gallery.status === option.status ? `${statusTone(option.status)} opacity-100` : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-100'
          )}
        >
          {pending && gallery.status === option.status ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : option.icon}
        </button>
      ))}
    </div>
  );
}

function GalleryTable({
  mode,
  galleries,
  selectedId,
  onSelect,
  onStatusChange,
  onResetPin,
  onDelete,
  onResetFilters,
  hasActiveFilters,
  statusPendingId,
  resetPendingId,
  deletePendingId,
}: {
  mode: GalleryMode;
  galleries: GallerySummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onStatusChange: (id: number, status: GalleryStatus) => void;
  onResetPin: (id: number) => void;
  onDelete: (gallery: GallerySummary) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
  statusPendingId: number | null;
  resetPendingId: number | null;
  deletePendingId: number | null;
}) {
  if (!galleries.length) {
    return (
      <div className="border-t border-[var(--border)] px-6 py-16 text-center">
        <Images size={28} className="mx-auto mb-3 text-[var(--text-muted)]" />
        <p className="font-display text-xl text-[var(--text-primary)]">No galleries found</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">Try another search or create a new gallery.</p>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-4 inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold uppercase text-[var(--accent)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Clear Search & Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto min-h-[300px]">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="border-y border-[var(--border)] text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
          <tr>
            <th className="px-7 py-3.5">Gallery</th>
            <th className="text-center">Status</th>
            <th className="text-center">Photos</th>
            {mode === 'selection' && <><th className="text-center">Submitted</th><th className="text-center">Master limit</th></>}
            <th className="text-center">Deadline</th>
            <th className="text-center">{mode === 'edited' ? 'Published' : 'Last synced'}</th>
            <th className="px-7 text-center">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {galleries.map((gallery, index) => (
            <tr
              key={gallery.id}
              onClick={() => onSelect(gallery.id)}
              className={clsx('cursor-pointer transition-colors hover:bg-[var(--bg-elevated)] focus-within:bg-[var(--bg-elevated)]', selectedId === gallery.id && 'bg-[var(--bg-elevated)]')}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(gallery.id);
                }
              }}
            >
              <td className="max-w-[260px] px-7 py-5">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]" title={gallery.title}>{gallery.title}</p>
                {(mode === 'edited' ? gallery.editResultsIsExpired : gallery.isExpired) && <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] text-rose-400"><Clock3 size={10} /> Expired</span>}
                <a
                  href={mode === 'edited' ? (gallery.editResultsFolderId ? `https://drive.google.com/drive/folders/${gallery.editResultsFolderId}` : undefined) : driveUrl(gallery)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open Google Drive folder"
                  aria-label={`Open Google Drive folder for ${gallery.title}`}
                  onClick={(event) => event.stopPropagation()}
                  className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                    <FolderSync size={10} />
                  </span>
                  <span className="truncate">Google Drive folder</span>
                </a>
              </td>
              <td className="text-center">
                <StatusQuickActions gallery={mode === 'edited' ? { ...gallery, status: gallery.editResultsStatus ?? 'draft' } : gallery} pending={statusPendingId === gallery.id} onChange={(status) => onStatusChange(gallery.id, status)} />
              </td>
              <td className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{mode === 'edited' ? gallery.editResultsPhotoCount || 0 : gallery.photoCount}</td>
              {mode === 'selection' && <><td className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.selectionCount}</td>
              <td className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.maxSelections ? gallery.maxSelections : <span className="inline-flex justify-center"><Unlimited /></span>}</td></>}
              <td className={clsx('text-center text-[10px] font-medium leading-4', (mode === 'edited' ? gallery.editResultsIsExpired : gallery.isExpired) ? 'text-rose-400' : 'text-[var(--text-muted)]')}>{mode === 'edited' ? !gallery.hasEditResults ? 'Not published' : gallery.editResultsExpiresAt ? formatDateValue(gallery.editResultsExpiresAt, dateFormat, 'Expired') : 'Unlimited' : deadlineLabel(gallery)}</td>
              <td className="text-center text-[10px] font-medium leading-4 text-[var(--text-muted)]">{formatDateValue(mode === 'edited' ? gallery.editResultsPublishedAt : gallery.syncedAt, dateFormat, 'Never')}</td>
              <td className="px-7 text-center">
                <div className="flex justify-center gap-1.5">
                  <ClientLinkMenu gallery={gallery} mode={mode} />
                  {mode === 'selection' && <DownloadMenu gallery={gallery} direction={index < 2 ? 'down' : 'up'} />}
                  {mode === 'selection' && <MaintenanceMenu
                    gallery={gallery}
                    onResetPin={onResetPin}
                    onDelete={onDelete}
                    resetPending={resetPendingId === gallery.id}
                    deletePending={deletePendingId === gallery.id}
                  />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactSettings({ close }: { close: () => void }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['gallery-contact'], queryFn: getGalleryContact });
  const save = useMutation({
    mutationFn: (data: FormData) => saveGalleryContact({ contactWhatsappUrl: String(data.get('phone') || ''), message: String(data.get('message') || ''), requestMoreMessage: String(data.get('requestMoreMessage') || '') }),
    onSuccess: () => {
      addToast('WhatsApp settings saved.', 'success');
      qc.invalidateQueries({ queryKey: ['gallery-contact'] });
      close();
    },
  });

  return (
    <Modal title="Admin WhatsApp" close={close}>
      <form
        key={query.data ? 'loaded' : 'loading'}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(new FormData(event.currentTarget));
        }}
        className="space-y-4"
      >
        <p className="text-xs leading-5 text-[var(--text-muted)]">Contact number and WhatsApp templates for gallery access and add-on requests.</p>
        <Field label="WhatsApp number">
          <input name="phone" required defaultValue={query.data?.contactWhatsappUrl || ''} placeholder="081234567890" className={inputClass} />
        </Field>
        <Field label="Access / unlock message template">
          <textarea
            name="message"
            maxLength={500}
            defaultValue={query.data?.message || ''}
            rows={5}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </Field>
        <Field label="Request more message template">
          <textarea
            name="requestMoreMessage"
            maxLength={800}
            defaultValue={query.data?.requestMoreMessage || ''}
            placeholder="Use {{gallery_url}}, {{gallery_title}}, {{selected_count}}, {{requested_count}}, {{promo_label}}, {{normal_price}}, {{estimated_price}}"
            rows={6}
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </Field>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={close}
            className="h-10 cursor-pointer rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Cancel
          </button>
          <button disabled={save.isPending} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[10px] font-black uppercase text-[var(--bg-deep)] disabled:cursor-not-allowed disabled:opacity-50">
            {save.isPending && <Loader2 size={13} className="animate-spin" />}
            Save settings
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GalleryDetail({ gallery, close, mode }: { gallery: GallerySummary; close: () => void; mode: GalleryMode }) {
  const detail = useQuery({ queryKey: ['gallery-detail', gallery.id], queryFn: () => getGalleryDetail(gallery.id) });
  if (detail.isLoading) {
    return <Modal title={gallery.title} close={close}><div role="status" aria-label="Loading gallery details" className="flex min-h-[60dvh] items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin" /> Loading gallery...</div></Modal>;
  }
  if (!detail.data) {
    return <Modal title={gallery.title} close={close}><div role="alert" className="space-y-4 py-8 text-center text-sm"><p>Unable to load gallery details.</p><button type="button" onClick={() => void detail.refetch()} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-4"><RefreshCw size={16} /> Retry</button></div></Modal>;
  }
  return <GalleryDetailEditor key={gallery.id} data={detail.data.gallery} close={close} initialMode={mode} />;
}

function GalleryDetailEditor({ data, close, initialMode }: { data: GallerySummary; close: () => void; initialMode: GalleryMode }) {
  const { addToast } = useToast();
  const editFormRef = useRef<HTMLFormElement>(null);
  const qc = useQueryClient();
  const [mode, setMode] = useState<GalleryMode>(initialMode);
  const [selectionStatus, setSelectionStatus] = useState(data.status);
  const [editedStatus, setEditedStatus] = useState<GalleryStatus>(data.editResultsStatus ?? (data.hasEditResults ? 'open' : 'draft'));
  const draftStatus = mode === 'edited' ? editedStatus : selectionStatus;
  const setDraftStatus = mode === 'edited' ? setEditedStatus : setSelectionStatus;
  const [feedback, setFeedback] = useState({
    selection: { dirty: false, saved: false, saveError: '', actionError: '' },
    edited: { dirty: false, saved: false, saveError: '', actionError: '' },
  });
  const { dirty, saved, saveError, actionError } = feedback[mode];
  const setDirty = (value: boolean) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], dirty: value } }));
  const setSaved = (value: boolean) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], saved: value } }));
  const setSaveError = (value: string) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], saveError: value } }));
  const setActionError = (value: string) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], actionError: value } }));
  const [pendingPin, setPendingPin] = useState(false);
  const [comparisonEnabled, setComparisonEnabled] = useState(Boolean(data.comparisonEnabled));
  const [comparisonPairs, setComparisonPairs] = useState(data.comparisonPairs || []);
  const [pairsDirty, setPairsDirty] = useState(false);
  const [pairsOpen, setPairsOpen] = useState(false);
  const managePairsRef = useRef<HTMLButtonElement>(null);
  const wasPairsOpen = useRef(false);
  useEffect(() => {
    if (pairsOpen) {
      managePairsRef.current?.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true });
    } else if (wasPairsOpen.current) {
      managePairsRef.current?.focus({ preventScroll: true });
    }
    wasPairsOpen.current = pairsOpen;
  }, [pairsOpen]);
  const [folderDirty, setFolderDirty] = useState(false);
  const initialEditDuration = data.editResultsAccessDurationHours;
  const [editAccessPreset, setEditAccessPreset] = useState(() => initialEditDuration === null ? 'unlimited' : [24, 72, 168, 336].includes(Number(initialEditDuration || 168)) ? String(initialEditDuration || 168) : 'custom');
  const [editCustomDays, setEditCustomDays] = useState(() => Math.max(1, Math.round(Number(initialEditDuration || 168) / 24)));
  const [publishWarnings, setPublishWarnings] = useState<string[]>([]);
  const markDirty = () => { setDirty(true); setSaved(false); setSaveError(''); setActionError(''); };
  const reportActionError = (action: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : 'Please try again.';
    setActionError(`${action} failed. ${detail}`);
  };

  const update = useMutation({
    mutationFn: updateGallery,
    onSuccess: async (_result, variables) => {
      const pin = editFormRef.current?.elements.namedItem('pin');
      if (variables.pin && pin instanceof HTMLInputElement && pin.value === variables.pin) {
        pin.value = '';
        setPendingPin(false);
      }
      addToast(variables.pin ? 'Gallery updated. The new client PIN is now active.' : 'Gallery updated.', 'success');
      await qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
      void qc.invalidateQueries({ queryKey: ['galleries'] });
      setDirty(false);
      if (mode === 'selection') setAddonDirty(false);
      else { setPairsDirty(false); setFolderDirty(false); }
      setSaved(true);
      setSaveError('');
      setActionError('');
    },
    onError: (error) => setSaveError(error instanceof Error ? error.message : 'Unable to save gallery changes.'),
  });

  const resetPin = useMutation({
    mutationFn: resetGalleryPinLock,
    onSuccess: () => addToast('PIN attempts reset. The client can try again with the saved PIN.', 'success'),
    onError: (error) => reportActionError('Reset PIN attempts', error),
  });

  const sync = useMutation({
    mutationFn: syncGallery,
    onSuccess: (result) => {
      addToast(`Drive folder synced. ${result.changes ?? 0} changes.`, 'success');
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
    },
    onError: (error) => reportActionError('Sync', error),
  });

  const [editResultsPassword, setEditResultsPassword] = useState('');
  const [showEditResultsPassword, setShowEditResultsPassword] = useState(false);
  const publishResults = useMutation({
    mutationFn: publishEditResults,
    onSuccess: (result) => {
      setEditResultsPassword('');
      setShowEditResultsPassword(false);
      addToast(`Published ${result.photoCount} edited photos across ${(result.folderCount ?? 0) + 1} folders with your delivery password.`, 'success');
      setPublishWarnings(result.warnings || []);
      setEditedStatus('open');
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
    },
    onError: (error) => reportActionError(data.hasEditResults ? 'Republish' : 'Publish', error),
  });
  const unpublishResults = useMutation({
    mutationFn: unpublishEditResults,
    onSuccess: () => {
      setEditResultsPassword('');
      setShowEditResultsPassword(false);
      addToast('Edited photos unpublished in the app. Google Drive links remain available.', 'success');
      setEditedStatus('draft');
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
    },
    onError: (error) => reportActionError('Unpublish', error),
  });

  const [addonOpen, setAddonOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'paid'>(data.addonStatus === 'paid' ? 'paid' : 'unpaid');
  const [addonDraftLimit, setAddonDraftLimit] = useState(() => Number(data.additionalLimit || 0));
  const [addonUnitPrice, setAddonUnitPrice] = useState(() => Number(data.addon?.unitPrice ?? 10_000));
  const [qrisEnabled, setQrisEnabled] = useState(() => Boolean(data.addon?.qrisEnabled));
  const [addonDirty, setAddonDirty] = useState(false);
  const [masterLimit, setMasterLimit] = useState(() => Number(data.maxSelections || 0));
  const busy = update.isPending || sync.isPending || publishResults.isPending || unpublishResults.isPending || resetPin.isPending;
  const publishBlockReason = dirty
    ? 'Save changes first, then click Publish or Republish. Saving alone does not publish edited photos.'
    : !data.editResultsFolderId
      ? 'Add an Edited photos Drive folder and save changes before publishing.'
      : editResultsPassword.trim().length < 6
        ? 'Enter an Edited Photos password with at least 6 characters to publish or republish.'
        : '';

  const addonPaid = paymentStatus === 'paid';
  const activeLimit = masterLimit ? masterLimit + (addonPaid ? addonDraftLimit : 0) : 0;
  const discountRules = data.addon?.discountRules;
  const addonEstimatedTotal = calculateAddonQuote(addonDraftLimit, addonUnitPrice, discountRules).total;
  const submittedCount = Number(data.selectionCount || 0);
  const link = publicUrl(data) + (mode === 'edited' ? '?view=edit-results' : '');
  const driveUrl = data.driveFolderId.startsWith('http') ? data.driveFolderId : `https://drive.google.com/drive/folders/${data.driveFolderId}`;

  return (
    <Modal title={pairsOpen ? 'Manage Pairs' : data.title} close={close} busy={busy} beforeClose={() => {
      if (pairsOpen) { setPairsOpen(false); return false; }
      return !(feedback.selection.dirty || feedback.edited.dirty || editResultsPassword) || window.confirm('Discard unsaved gallery changes and any unpublished password?');
    }} footer={pairsOpen ? <>
      <button type="button" onClick={() => setPairsOpen(false)} className="min-h-11 rounded-md border border-[var(--border)] px-4 text-sm">Cancel</button>
      <button type="submit" form="edit-result-pairs-form" className="min-h-11 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--bg-deep)]">Apply Pairs</button>
    </> : (
      <div className="w-full space-y-2">
        {saveError && <p role="alert" className="flex items-start gap-2 text-xs leading-5 text-rose-500"><AlertCircle size={15} className="mt-0.5 shrink-0" />{saveError}</p>}
        {actionError && <p role="alert" className="flex items-start gap-2 text-xs leading-5 text-rose-500"><AlertCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{actionError}</p>}
        <div className="flex items-center justify-between gap-3">
          <span role="status" className="text-xs text-[var(--text-muted)]">{dirty ? 'Unsaved changes' : mode === 'edited' && editResultsPassword ? 'Delivery password not published' : saved ? 'Changes saved' : ''}</span>
          <button type="submit" form={mode === 'edited' ? 'edit-delivery-form' : 'edit-gallery-form'} disabled={busy} className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-deep)] disabled:opacity-50">
            {update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {update.isPending ? 'Saving...' : mode === 'edited' ? 'Save Edited Photos' : 'Save Photo Selection'}
          </button>
        </div>
      </div>
    )}>
      {pairsOpen && <EditResultPairs galleryId={data.id} pairs={comparisonPairs} onApply={(pairs) => { setComparisonPairs(pairs); setPairsDirty(true); markDirty(); setPairsOpen(false); }} />}
      <div className="space-y-5" hidden={pairsOpen}>
        <GalleryModeTabs value={mode} onChange={setMode} disabled={busy} scope="gallery-detail" />
        <div role="tabpanel" id="gallery-detail-panel" aria-labelledby={`gallery-detail-${mode}-tab`} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div hidden={mode !== 'selection'}>
            <p className="text-xs text-[var(--text-muted)]">
              {data.photoCount} photos, {data.selectionCount} submitted
            </p>
            <p className={clsx('mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold', data.isExpired ? 'text-rose-400' : 'text-[var(--text-secondary)]')}>
              <Clock3 size={12} /> {deadlineLabel(data)} · {data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24} hours
            </p>
          </div>
          <p hidden={mode !== 'edited'} className={clsx('mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold', data.hasEditResults && data.editResultsExpiresAt && Date.parse(data.editResultsExpiresAt) <= Date.now() ? 'text-rose-400' : 'text-[var(--text-muted)]')}>
            <Clock3 size={12} /> Edited Photos access: {!data.hasEditResults ? 'Not published' : !data.editResultsExpiresAt ? 'Unlimited' : Date.parse(data.editResultsExpiresAt) <= Date.now() ? 'Expired' : `expires ${formatDateValue(data.editResultsExpiresAt, dateFormat, 'Expired')}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              hidden={mode !== 'selection'}
              title={dirty ? 'Save changes before syncing' : 'Sync Google Drive'}
              onClick={() => {
                if (dirty) { setActionError('Sync not started. Save changes first, then click Sync.'); return; }
                setActionError('');
                sync.mutate(data.id);
              }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 text-[10px] font-bold text-sky-400 hover:bg-sky-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sync.isPending ? <Loader2 size={13} className="animate-spin" /> : <FolderSync size={13} />}
              {sync.isPending ? 'Syncing...' : 'Sync'}
            </button>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(link).then(() => addToast('Client link copied.', 'success')).catch(() => addToast('Unable to copy the client link.', 'error')); }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold hover:border-[var(--accent)]"
            >
              <Clipboard size={13} />
              Copy link
            </button>
            {mode === 'selection' && <DownloadMenu
              gallery={data}
              direction="down"
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            />}
          </div>
        </div>

        <div role="group" aria-label={mode === 'edited' ? 'Edited Photos status' : 'Photo Selection status'} className="grid grid-cols-3 gap-1 rounded-md border border-[var(--border)] p-1">
          {(
            [
              { status: 'open', icon: <Lightbulb size={13} /> },
              { status: 'draft', icon: <Settings2 size={13} /> },
              { status: 'closed', icon: <LightbulbOff size={13} /> },
            ] as const
          ).map((option) => (
            <button
              key={option.status}
              type="button"
              disabled={busy}
              aria-pressed={draftStatus === option.status}
              onClick={() => { if (draftStatus !== option.status) { setDraftStatus(option.status); markDirty(); } }}
              className={clsx(
                'inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded border text-xs font-semibold capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45',
                draftStatus === option.status ? statusTone(option.status) : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              {option.icon}
              {option.status}
            </button>
          ))}
        </div>

        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <form
            ref={editFormRef}
            id="edit-gallery-form"
            hidden={mode !== 'selection'}
            aria-busy={update.isPending}
            onChange={markDirty}
            onInvalid={(event) => {
              if (event.target instanceof HTMLInputElement) setSaveError(`Changes not saved. ${event.target.validationMessage}`);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setSaveError('');
              setActionError('');
              const form = new FormData(event.currentTarget);
              const nextMasterLimit = Math.min(500, Math.max(0, Number(form.get('master-limit')) || 0));
              const nextDurationHours = Math.min(8760, Math.max(1, Number(form.get('selection-duration')) || 72));
              const nextActiveLimit = nextMasterLimit ? nextMasterLimit + (addonPaid ? addonDraftLimit : 0) : 0;
              if (nextActiveLimit && submittedCount > nextActiveLimit) {
                setSaveError(`Active limit cannot be lower than ${submittedCount} submitted selections.`);
                return;
              }
              const currentDurationHours = Number(data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24);
              const durationChanged = nextDurationHours !== currentDurationHours;
              update.mutate({
               id: data.id,
               status: selectionStatus,
               title: String(form.get('title') || data.title).trim(),
               driveFolderUrl: String(form.get('driveFolderUrl') || driveUrl).trim(),
               pin: String(form.get('pin') || ''),
               maxSelections: nextMasterLimit,
                ...(addonDirty ? { additionalSelectionLimit: addonDraftLimit, editAddonPrice: addonUnitPrice, editAddonPricingMode: 'per_photo', editAddonStatus: paymentStatus, qrisEnabled } : {}),
                tutorialBeforeDriveFileId: String(form.get('tutorialBeforeDriveFileId') || '').trim(),
                tutorialAfterDriveFileId: String(form.get('tutorialAfterDriveFileId') || '').trim(),
                tutorialBefore2DriveFileId: String(form.get('tutorialBefore2DriveFileId') || '').trim(),
                tutorialAfter2DriveFileId: String(form.get('tutorialAfter2DriveFileId') || '').trim(),
                tutorialBefore3DriveFileId: String(form.get('tutorialBefore3DriveFileId') || '').trim(),
                tutorialAfter3DriveFileId: String(form.get('tutorialAfter3DriveFileId') || '').trim(),
                ...(durationChanged ? { selectionDurationHours: nextDurationHours } : {}),
              });
            }}
            className="space-y-4"
          >
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <Field label="Gallery title">
                <input name="title" required defaultValue={data.title} className={inputClass} />
              </Field>
              <Field label="Google Drive folder URL">
                <input name="driveFolderUrl" required defaultValue={driveUrl} className={inputClass} />
              </Field>
              <details className="border-y border-[var(--border)] py-4">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">Before / edited preview <span className="font-normal text-[var(--text-muted)]">(optional)</span></summary>
                <div className="mt-3 space-y-2">
                  {[1, 2, 3].map((slot) => {
                    const suffix = slot === 1 ? '' : String(slot);
                    const beforeKey = `tutorialBefore${suffix}DriveFileId` as keyof typeof data;
                    const afterKey = `tutorialAfter${suffix}DriveFileId` as keyof typeof data;
                    return (
                      <div key={slot} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
                        <span className="pb-2 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">{String(slot).padStart(2, '0')}</span>
                        <Field label="Before photo">
                          <input name={String(beforeKey)} defaultValue={String(data[beforeKey] || '')} placeholder="Before file link or ID" className={inputClass} />
                        </Field>
                        <Field label="Edited photo">
                          <input name={String(afterKey)} defaultValue={String(data[afterKey] || '')} placeholder="Edited file link or ID" className={inputClass} />
                        </Field>
                      </div>
                    );
                  })}
                </div>
              </details>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Client PIN">
                  <input name="pin" minLength={4} onChange={(event) => setPendingPin(Boolean(event.currentTarget.value))} aria-describedby="client-pin-save-status" placeholder="Set a new PIN (optional)" className={inputClass} />
                  <span id="client-pin-save-status" role="status" className="block text-xs leading-5 text-[var(--text-muted)]">{pendingPin ? 'New PIN not saved. Click Save changes to activate it.' : 'Leave blank to keep the current PIN.'}</span>
                </Field>
                <Field label="Master limit (0 = Unlimited)" title="Master selection limit (0 = Unlimited)">
                  <input name="master-limit" type="number" min="0" max="500" value={masterLimit || ''} onChange={(event) => setMasterLimit(Math.min(500, Math.max(0, Number(event.currentTarget.value) || 0)))} placeholder="Unlimited" className={inputClass} />
                </Field>
                <Field label="Selection window">
                  <div className={unitInputShellClass}>
                    <input name="selection-duration" required type="number" min="1" max="8760" defaultValue={data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24} className={unitInputClass} />
                    <span className={unitInputSuffixClass}>hours</span>
                  </div>
                </Field>
              </div>
            </fieldset>
          </form>

          <div hidden={mode !== 'selection'} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-4">
            <div><h3 className="text-sm font-semibold">Client Access</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Reset unlocks PIN attempts immediately. It does not change or save a new PIN.</p></div>
            <button type="button" disabled={busy} onClick={() => { setActionError(''); resetPin.mutate(data.id); }} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)] disabled:opacity-50">
              {resetPin.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Reset PIN Attempts
            </button>
          </div>

          <section hidden={mode !== 'edited'} aria-label="Edited photos publishing" className="pb-4">
            <form id="edit-delivery-form" aria-busy={update.isPending} onInvalid={(event) => {
              if (event.target instanceof HTMLInputElement) setSaveError(`Changes not saved. ${event.target.validationMessage}`);
            }} onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setSaveError('');
              setActionError('');
              const form = new FormData(event.currentTarget);
              update.mutate({
                id: data.id,
                editResultsStatus: editedStatus,
                editResultsFolderId: String(form.get('editResultsFolderId') || '').trim(),
                editResultsZipFileId: String(form.get('editResultsZipFileId') || '').trim(),
                editResultsAccessDurationHours: editAccessPreset === 'unlimited' ? null : editAccessPreset === 'custom' ? editCustomDays * 24 : Number(editAccessPreset),
                comparisonEnabled,
                ...(pairsDirty ? { comparisonPairs } : {}),
              });
            }}>
            <fieldset disabled={busy} onChange={markDirty} className="mb-5 min-w-0 space-y-4">
              <legend className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Edited Photos Delivery</legend>
              <Field label="Edited photos Drive folder">
                <input form="edit-delivery-form" name="editResultsFolderId" defaultValue={data.editResultsFolderId || ''} onChange={() => setFolderDirty(true)} placeholder="Folder URL or ID" className={inputClass} />
              </Field>
              <Field label="Edited Photos ZIP (optional)">
                <input form="edit-delivery-form" name="editResultsZipFileId" defaultValue={data.editResultsZipFileId || ''} placeholder="Google Drive ZIP file URL or ID" aria-describedby="edited-zip-help" className={inputClass} />
              </Field>
              <p id="edited-zip-help" className="text-xs text-[var(--text-muted)]">Optional ZIP used for the client's Download All button.</p>
              <Field label="Download access duration">
                <select form="edit-delivery-form" name="editResultsAccessDurationHours" value={editAccessPreset} onChange={(event) => { setEditAccessPreset(event.currentTarget.value); markDirty(); }} className={inputClass}>
                  <option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option><option value="336">14 days</option><option value="custom">Custom</option><option value="unlimited">Unlimited</option>
                </select>
              </Field>
              {editAccessPreset === 'custom' && <Field label="Custom duration (days)">
                <input form="edit-delivery-form" name="editResultsCustomDays" type="number" min="1" max="3650" value={editCustomDays} onChange={(event) => { setEditCustomDays(Math.min(3650, Math.max(1, Number(event.currentTarget.value) || 1))); markDirty(); }} className={inputClass} />
              </Field>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" checked={comparisonEnabled} onChange={(event) => setComparisonEnabled(event.target.checked)} style={{ width: 16, height: 16, padding: 0, flexShrink: 0 }} className="accent-[var(--accent)]" /><span>Enable Before / After</span></label>
                <button ref={managePairsRef} type="button" disabled={!comparisonEnabled || folderDirty || !data.editResultsFolderId} title={folderDirty ? 'Save the folder before managing pairs' : undefined} onClick={() => setPairsOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"><Images size={16} /> Manage Pairs</button>
              </div>
            </fieldset>
             </form>
            {publishWarnings.map((warning) => <p key={warning} role="status" className="mb-3 text-sm text-amber-600 dark:text-amber-400">{warning}</p>)}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">Publication</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                  {data.hasEditResults ? `${data.editResultsPhotoCount || 0} published · ${data.editResultsPublishedAt ? formatDateValue(data.editResultsPublishedAt, dateFormat, 'Published') : 'Published'}` : 'Not published'}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-72">
                <div className="space-y-1.5">
                  <label htmlFor="edit-results-publish-password" className="block text-[10px] font-semibold text-[var(--text-secondary)]">Edited Photos password</label>
                  <div className="relative">
                    <input id="edit-results-publish-password" name="editResultsPassword" type={showEditResultsPassword ? 'text' : 'password'} disabled={busy} value={editResultsPassword} onChange={(event) => setEditResultsPassword(event.currentTarget.value.slice(0, 64))} minLength={6} maxLength={64} autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder={data.hasEditResults ? 'Enter password to republish' : 'Minimum 6 characters'} className={clsx(inputClass, 'pr-12')} />
                    <button type="button" disabled={busy} aria-label={showEditResultsPassword ? 'Hide password' : 'Show password'} title={showEditResultsPassword ? 'Hide password' : 'Show password'} aria-controls="edit-results-publish-password" onClick={() => setShowEditResultsPassword((current) => !current)} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45">
                      {showEditResultsPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" aria-describedby={publishBlockReason ? 'publish-requirements' : undefined} disabled={busy} onClick={() => {
                    if (publishBlockReason) { setActionError(publishBlockReason); return; }
                    setActionError('');
                    publishResults.mutate({ id: data.id, password: editResultsPassword.trim() });
                  }} className="inline-flex h-11 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--bg-deep)] disabled:opacity-45">
                    {publishResults.isPending ? <Loader2 size={13} className="animate-spin" /> : <Images size={13} />}
                    {publishResults.isPending ? 'Publishing...' : data.hasEditResults ? 'Republish' : 'Publish'}
                  </button>
                  {data.hasEditResults && <button type="button" disabled={busy} onClick={() => {
                    if (dirty) { setActionError('Unpublish not started. Save changes first, then click Unpublish.'); return; }
                    if (window.confirm('Unpublish edited photos from this app? Google Drive links will remain accessible until you change the folder sharing settings.')) { setActionError(''); unpublishResults.mutate(data.id); }
                  }} className="inline-flex h-11 items-center gap-1.5 rounded-md border border-rose-500/30 px-3 text-xs font-semibold text-rose-400 disabled:opacity-45">
                    {unpublishResults.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Unpublish
                  </button>}
                </div>
                {publishBlockReason && <p id="publish-requirements" className="text-xs leading-5 text-[var(--text-muted)]">{publishBlockReason}</p>}
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-4 text-[var(--text-muted)]">Set the Drive folder to Anyone with the link · Viewer. The password is stored only as a secure hash and is never shown again. Republishing replaces the previous password. Anyone with a Google Drive file URL can still open it directly.</p>
          </section>

          <div hidden={mode !== 'selection'} className="border-t border-[var(--border)] pt-4">
            <button type="button" onClick={() => setAddonOpen((value) => !value)} className="flex w-full cursor-pointer items-center justify-between text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Additional Photos &amp; Payment</span>
              </span>
              <ChevronDown size={16} className={clsx('text-[var(--text-muted)] transition-transform', addonOpen && 'rotate-180')} />
            </button>
            {addonOpen && (
              <fieldset
                disabled={busy}
                onChange={() => { setAddonDirty(true); markDirty(); }}
                className="mt-4 min-w-0"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-muted)]">Quota active after payment</span>
                  <span className={clsx('rounded-md border px-2 py-1 text-[9px] font-bold uppercase', addonPaid ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400')}>
                    {addonPaid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/35 p-3 transition-colors hover:border-[var(--accent)]/45 sm:col-span-2">
                    <input type="checkbox" checked={qrisEnabled} onChange={(event) => setQrisEnabled(event.currentTarget.checked)} className="mt-0.5 h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--text-primary)]">Butuh QRIS self-service?</span>
                      <span className="mt-1 block text-[10px] leading-4 text-[var(--text-muted)]">Aktifkan tombol bayar instan di modal request tambahan foto client.</span>
                    </span>
                  </label>
                  <Field label="Add-on edited photos">
                    <input form="edit-gallery-form" name="addon-limit" type="number" min="0" max="500" value={addonDraftLimit} onChange={(event) => setAddonDraftLimit(Math.min(500, Math.max(0, Number(event.currentTarget.value) || 0)))} className={inputClass} />
                  </Field>
                  <Field label="Price per edited photo">
                    <input
                      name="addon-price"
                      type="text"
                      inputMode="numeric"
                      value={idrFormat.format(addonUnitPrice)}
                      onChange={(event) => {
                        const value = parseIdr(event.currentTarget.value);
                        setAddonUnitPrice(value);
                      }}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Payment status">
                    <div className="grid h-10 grid-cols-2 overflow-hidden rounded-lg border border-[var(--border)]">
                      <input type="hidden" name="addon-status" value={paymentStatus} />
                      <button
                        type="button"
                        aria-pressed={paymentStatus === 'unpaid'}
                        onClick={() => { setPaymentStatus('unpaid'); setAddonDirty(true); markDirty(); }}
                        className={clsx('cursor-pointer text-[10px] font-bold uppercase transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', paymentStatus === 'unpaid' ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]')}
                      >
                        Unpaid
                      </button>
                      <button
                        type="button"
                        aria-pressed={paymentStatus === 'paid'}
                        onClick={() => { setPaymentStatus('paid'); setAddonDirty(true); markDirty(); }}
                        className={clsx('cursor-pointer text-[10px] font-bold uppercase transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', paymentStatus === 'paid' ? 'bg-emerald-500/15 text-emerald-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]')}
                      >
                        Paid
                      </button>
                    </div>
                  </Field>
                </div>
                <div className="mt-4 flex items-center justify-between border-y border-[var(--border)] py-3 text-xs">
                  <span className="text-[var(--text-muted)]">Estimated add-on total</span>
                  <strong className="tabular-nums text-[var(--text-primary)]">{idrFormat.format(addonEstimatedTotal)}</strong>
                </div>
                <div className="mt-3 grid grid-cols-3 divide-x divide-[var(--border)] border-y border-[var(--border)] py-3 text-center">
                  <div><p className="text-[9px] uppercase text-[var(--text-muted)]">+5 · Regular</p><p className="mt-1 text-xs font-semibold tabular-nums">{idrFormat.format(addonUnitPrice * 5)}</p></div>
                  <div><p className="text-[9px] uppercase text-[var(--text-primary)]">+10 · Save 10%</p><p className="mt-1 text-xs font-semibold tabular-nums">{idrFormat.format(addonUnitPrice * 9)}</p></div>
                  <div><p className="text-[9px] uppercase text-[var(--text-primary)]">+20 · Save 20%</p><p className="mt-1 text-xs font-semibold tabular-nums">{idrFormat.format(addonUnitPrice * 16)}</p></div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-4 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-[var(--text-muted)]">Master limit</dt>
                    <dd className="mt-1 flex items-center font-semibold text-[var(--text-primary)]">{masterLimit || <Unlimited />}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-muted)]">Add-on limit</dt>
                    <dd className="mt-1 font-semibold text-[var(--text-primary)]">{addonDraftLimit}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-muted)]">Active limit</dt>
                    <dd className="mt-1 flex items-center font-semibold text-[var(--accent)]">{activeLimit || <Unlimited />}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-muted)]">Submitted</dt>
                    <dd className="mt-1 font-semibold text-[var(--text-primary)]">{submittedCount}</dd>
                  </div>
                </dl>
              </fieldset>
            )}
          </div>
        </div>
      </div>
        </div>
    </Modal>
  );
}

export default function ClientGalleries() {
  const { user, hasPermission } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const canManage = hasPermission('manage_client_galleries');
  const { mode } = useSearch({ from: '/_layout/galleries' });
  const navigate = useNavigate({ from: '/galleries' });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filter, setFilter] = useState<'all' | GalleryStatus>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<GallerySummary | null>(null);
  const selectedId = selected?.id ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  useEffect(() => { setFilter('all'); setPage(1); setSelected(null); }, [mode]);
  const query = useQuery({
    queryKey: ['galleries', mode, page, filter, debouncedSearch],
    queryFn: () => listGalleries({ mode, page, pageSize: PAGE_SIZE, status: filter, search: debouncedSearch }),
    enabled: canManage,
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === mode ? previousData : undefined,
    staleTime: 60 * 1000,
    refetchInterval: 15 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
  const galleries = query.data?.items || [];
  const total = query.data?.total || 0;
  const totalPages = query.data?.totalPages || 1;

  // Menjaga agar halaman aktif selalu valid jika jumlah data/filter berubah
  useEffect(() => {
    if (page > totalPages) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- A delete or filter can shrink the server-side page range.
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const currentPage = Math.min(page, totalPages);
  const pageItems = galleries;

  const create = useMutation({
    mutationFn: createGallery,
    onSuccess: (gallery) => {
      addToast('Gallery created.', 'success');
      setCreateOpen(false);
      setSelected(gallery);
      qc.invalidateQueries({ queryKey: ['galleries'] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to create gallery.', 'error'),
  });

  const statusUpdate = useMutation({
    mutationFn: updateGallery,
    onSuccess: () => {
      addToast(`${mode === 'edited' ? 'Edited Photos' : 'Photo Selection'} status updated.`, 'success');
      qc.invalidateQueries({ queryKey: ['gallery-detail'] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to update gallery status.', 'error'),
  });

  const resetPin = useMutation({
    mutationFn: resetGalleryPinLock,
    onSuccess: () => addToast('PIN unlocked.', 'success'),
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to unlock PIN.', 'error'),
  });

  const remove = useMutation({
    mutationFn: deleteGallery,
    onSuccess: (_, id) => {
      addToast('Gallery deleted.', 'success');
      setSelected((current) => (current?.id === id ? null : current));
      qc.invalidateQueries({ queryKey: ['galleries'] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to delete gallery.', 'error'),
  });

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setSelected(null);
  };

  const changeFilter = (value: 'all' | GalleryStatus) => {
    setFilter(value);
    setPage(1);
    setSelected(null);
  };

  const resetFilters = () => {
    setSearch('');
    setFilter('all');
    setPage(1);
  };

  if (!canManage || !user) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <div className="mx-auto max-w-4xl border border-[var(--border)] bg-[var(--bg-card)] px-6 py-20 text-center">
          <AlertCircle size={30} className="mx-auto mb-4 text-rose-400" />
          <h1 className="font-display text-2xl text-[var(--text-primary)]">Access denied</h1>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL_CLASS}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="mb-2 font-display text-2xl font-medium tracking-tight text-[var(--text-primary)] sm:text-3xl md:text-4xl">Client Galleries</h1>
            <p className="label-xs font-sans text-[var(--text-muted)]">GOOGLE DRIVE WORKSPACE / CLIENT SELECTION CONTROL</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold uppercase hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <Settings2 size={13} />
              Admin WhatsApp
            </button>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold uppercase hover:border-[var(--accent)]"
            >
              <RefreshCw size={13} className={clsx(query.isFetching && 'animate-spin')} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[10px] font-black uppercase text-[var(--bg-deep)]"
            >
              <Plus size={14} />
              Create gallery
            </button>
          </div>
        </header>

        <GalleryModeTabs value={mode} scope="gallery-list" onChange={(next) => {
          setFilter('all'); setPage(1); setSelected(null);
          void navigate({ search: { mode: next } });
        }} />
        <section role="tabpanel" id="gallery-list-panel" aria-labelledby={`gallery-list-${mode}-tab`} className={`${PANEL_CARD_CLASS} overflow-hidden !p-0`}>
          <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
            <GalleryFilters filter={filter} setFilter={changeFilter} />
            <div className="flex items-center gap-3">
              <div className="relative w-full md:w-72">
                <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => changeSearch(event.target.value)}
                  placeholder="Search galleries..."
                  aria-label="Search galleries"
                  style={{ paddingLeft: '2.75rem', paddingRight: '0.75rem' }}
                  className={`${inputClass} h-10`}
                />
              </div>
            </div>
          </div>
          <div className="border-b border-[var(--border)] px-5 py-6 md:px-7">
            <SectionHeading title={mode === 'edited' ? 'Edited Photos' : 'Photo Selection'} subtitle={`${pageItems.length} SHOWN / ${total} MATCHING`} />
          </div>
          {query.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-[var(--accent)]" />
            </div>
          ) : query.isError ? (
            <div className="py-16 text-center text-rose-400">Unable to load galleries.</div>
          ) : (
            <GalleryTable
              mode={mode}
              galleries={pageItems}
              selectedId={selectedId}
              onSelect={(id) => setSelected(galleries.find((gallery) => gallery.id === id) ?? null)}
              onStatusChange={(id, status) => statusUpdate.mutate(mode === 'edited' ? { id, editResultsStatus: status } : { id, status })}
              onResetPin={(id) => resetPin.mutate(id)}
              onDelete={(gallery) => {
                if (window.confirm(`Delete "${gallery.title}"?`)) remove.mutate(gallery.id);
              }}
              onResetFilters={resetFilters}
              hasActiveFilters={Boolean(search.trim()) || filter !== 'all'}
              statusPendingId={statusUpdate.isPending ? statusUpdate.variables?.id ?? null : null}
              resetPendingId={resetPin.isPending ? resetPin.variables ?? null : null}
              deletePendingId={remove.isPending ? remove.variables ?? null : null}
            />
          )}
          {!query.isLoading && !query.isError && <Pager page={currentPage} totalPages={totalPages} total={total} limit={PAGE_SIZE} onChange={setPage} />}
        </section>
      </div>

      {contactOpen && <ContactSettings close={() => setContactOpen(false)} />}
      {createOpen && <CreateGalleryModal close={() => setCreateOpen(false)} pending={create.isPending} submit={(input) => create.mutate(input)} />}
      {selected && <GalleryDetail key={selected.id} mode={mode} gallery={selected} close={() => setSelected(null)} />}
    </div>
  );
}
