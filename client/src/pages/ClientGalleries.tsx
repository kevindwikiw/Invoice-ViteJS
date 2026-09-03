import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Clipboard,
  Download,
  ExternalLink,
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
  X,
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
  GalleryStatus,
  GallerySummary
} from '../features/culling/culling.types';

import {
  calculateAddonQuote
} from '../features/culling/culling.public';

import {
  createGallery,
  deleteGallery,
  downloadGallerySelections,
  downloadGallerySelectionsXlsx,
  getGalleryContact,
  getGalleryDetail,
  listGalleries,
  resetGalleryPinLock,
  saveGalleryContact,
  syncGallery,
  updateGallery,
} from '../features/culling/culling.admin';

const PAGE_SIZE = 10;
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const idrFormat = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const inputClass = 'h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]/60 hover:border-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]';
const publicUrl = (gallery: GallerySummary) => `${window.location.origin}/culling/${gallery.publicKey || gallery.id}`;
const driveUrl = (gallery: GallerySummary) => (gallery.driveFolderId.startsWith('http') ? gallery.driveFolderId : `https://drive.google.com/drive/folders/${gallery.driveFolderId}`);
const parseIdr = (value: FormDataEntryValue | null) => Number(String(value || '').replace(/\D/g, '')) || 0;

function deadlineLabel(gallery: Pick<GallerySummary, 'selectionDeadlineAt' | 'isExpired'>): string {
  if (!gallery.selectionDeadlineAt) return 'Not set';
  if (gallery.isExpired) return 'Expired';
  return dateFormat.format(new Date(gallery.selectionDeadlineAt));
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

function Modal({ title, close, children, widthClass = 'max-w-2xl' }: { title: string; close: () => void; children: ReactNode; widthClass?: string }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={clsx('max-h-[90vh] w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl', widthClass)}>
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <h2 className="font-display text-xl text-[var(--text-primary)]">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={`Close ${title}`}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
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
  submit: (input: { title: string; driveFolderUrl: string; pin: string; status: GalleryStatus; maxSelections: number; selectionDurationHours: number }) => void;
}) {
  return (
    <Modal title="Create gallery" close={close} widthClass="max-w-lg">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          submit({
            title: String(data.get('title') || '').trim(),
            driveFolderUrl: String(data.get('drive') || '').trim(),
            pin: String(data.get('pin') || ''),
            status: 'draft',
            maxSelections: Math.min(500, Math.max(0, Number(data.get('limit')) || 0)),
            selectionDurationHours: Math.min(8760, Math.max(1, Number(data.get('duration')) || 72)),
          });
        }}
      >
        <Field label="Gallery name">
          <input name="title" required placeholder="Aldian & Panpan Prewedding" className={inputClass} />
        </Field>
        <Field label="Google Drive folder">
          <input name="drive" required placeholder="https://drive.google.com/drive/folders/..." className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client PIN">
            <input name="pin" required minLength={4} inputMode="numeric" autoComplete="off" placeholder="4821" className={inputClass} />
          </Field>
          <Field label="Selection window">
            <div className="relative">
              <input name="duration" required type="number" min="1" max="8760" defaultValue="72" className={clsx(inputClass, 'pr-16 tabular-nums')} />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[11px] font-medium text-[var(--text-muted)]">hours</span>
            </div>
          </Field>
        </div>
        <Field label="Selection limit">
          <div className="relative">
            <input name="limit" required type="number" min="0" max="500" defaultValue="50" className={clsx(inputClass, 'pr-16 tabular-nums')} />
            <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[11px] font-medium text-[var(--text-muted)]">photos</span>
          </div>
          <span className="block text-[10px] leading-4 text-[var(--text-muted)]">Use 0 for unlimited selections.</span>
        </Field>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button type="button" onClick={close} className="h-10 cursor-pointer rounded-md px-4 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
          <button disabled={pending} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[11px] font-bold text-[var(--bg-deep)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create gallery
          </button>
        </div>
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

function DownloadMenu({ gallery }: { gallery: GallerySummary }) {
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
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Download size={13} />
      </button>
      {open && !disabled && (
        <div className="absolute bottom-full right-0 mb-1 z-30 min-w-32 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">
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
        </div>
      )}
    </div>
  );
}

function ClientLinkMenu({ gallery }: { gallery: GallerySummary }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useDismissableMenu(open, () => setOpen(false));
  const link = publicUrl(gallery);
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
    <div className="flex items-center justify-center gap-1" onClick={(event) => event.stopPropagation()}>
      {options.map((option) => (
        <button
          key={option.status}
          type="button"
          disabled={pending || gallery.status === option.status}
          title={option.label}
          aria-label={`${gallery.title}: set ${option.label}`}
          onClick={() => onChange(option.status)}
          className={clsx(
            'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed',
            gallery.status === option.status ? `${statusTone(option.status)} opacity-100` : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-100'
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

function GalleryTable({
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
            <th className="text-center">Submitted</th>
            <th className="text-center">Master limit</th>
            <th className="text-center">Deadline</th>
            <th className="text-center">Last synced</th>
            <th className="px-7 text-center">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {galleries.map((gallery) => (
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
                {gallery.isExpired && <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] text-rose-400"><Clock3 size={10} /> Expired</span>}
                <a
                  href={driveUrl(gallery)}
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
                <StatusQuickActions gallery={gallery} pending={statusPendingId === gallery.id} onChange={(status) => onStatusChange(gallery.id, status)} />
              </td>
              <td className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.photoCount}</td>
              <td className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.selectionCount}</td>
              <td className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.maxSelections ? gallery.maxSelections : <span className="inline-flex justify-center"><Unlimited /></span>}</td>
              <td className={clsx('text-center text-[10px] font-medium leading-4', gallery.isExpired ? 'text-rose-400' : 'text-[var(--text-muted)]')}>{deadlineLabel(gallery)}</td>
              <td className="text-center text-[10px] font-medium leading-4 text-[var(--text-muted)]">{gallery.syncedAt ? dateFormat.format(new Date(gallery.syncedAt)) : 'Never'}</td>
              <td className="px-7 text-center">
                <div className="flex justify-center gap-1.5">
                  <ClientLinkMenu gallery={gallery} />
                  <DownloadMenu gallery={gallery} />
                  <MaintenanceMenu
                    gallery={gallery}
                    onResetPin={onResetPin}
                    onDelete={onDelete}
                    resetPending={resetPendingId === gallery.id}
                    deletePending={deletePendingId === gallery.id}
                  />
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

function GalleryDetail({ gallery, close }: { gallery: GallerySummary; close: () => void }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['gallery-detail', gallery.id], queryFn: () => getGalleryDetail(gallery.id) });
  const data = detail.data?.gallery || gallery;

  const update = useMutation({
    mutationFn: updateGallery,
    onSuccess: () => {
      addToast('Gallery updated.', 'success');
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to save gallery changes.', 'error'),
  });

  const sync = useMutation({
    mutationFn: syncGallery,
    onSuccess: (result) => {
      addToast(`Drive folder synced. ${result.changes ?? 0} changes.`, 'success');
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
    },
  });

  const [addonOpen, setAddonOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'paid'>(data.addonStatus === 'paid' ? 'paid' : 'unpaid');
  const [addonDraftLimit, setAddonDraftLimit] = useState(() => Number(data.additionalLimit || 0));
  const [addonUnitPrice, setAddonUnitPrice] = useState(() => Number(data.addon?.unitPrice ?? 10_000));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Refresh the local add-on draft from newly fetched gallery data.
    setPaymentStatus(data.addonStatus === 'paid' ? 'paid' : 'unpaid');
    setAddonDraftLimit(Number(data.additionalLimit || 0));
    setAddonUnitPrice(Number(data.addon?.unitPrice ?? 10_000));
  }, [data.additionalLimit, data.addon?.unitPrice, data.addonStatus]);

  const addonPaid = paymentStatus === 'paid';
  const masterLimit = Number(data.maxSelections || 0);
  const addonLimit = Number(data.additionalLimit || 0);
  const activeLimit = masterLimit ? masterLimit + (addonPaid ? addonLimit : 0) : 0;
  const discountRules = data.addon?.discountRules;
  const addonEstimatedTotal = calculateAddonQuote(addonDraftLimit, addonUnitPrice, discountRules).total;
  const submittedCount = Number(data.selectionCount || 0);
  const link = publicUrl(data);
  const driveUrl = data.driveFolderId.startsWith('http') ? data.driveFolderId : `https://drive.google.com/drive/folders/${data.driveFolderId}`;

  if (detail.isLoading) {
    return (
      <Modal title="Gallery details" close={close}>
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-[var(--accent)]" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={data.title} close={close}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)]">
              {data.photoCount} photos, {data.selectionCount} submitted
            </p>
            <p className={clsx('mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold', data.isExpired ? 'text-rose-400' : 'text-[var(--text-secondary)]')}>
              <Clock3 size={12} /> {deadlineLabel(data)} · {data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24} hours
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={sync.isPending}
              onClick={() => sync.mutate(data.id)}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 text-[10px] font-bold text-sky-400 hover:bg-sky-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderSync size={13} />
              Sync
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(link).then(() => addToast('Client link copied.', 'success'))}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold hover:border-[var(--accent)]"
            >
              <Clipboard size={13} />
              Copy link
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
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
              disabled={update.isPending || data.status === option.status}
              onClick={() => update.mutate({ id: data.id, status: option.status })}
              className={clsx(
                'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-[10px] font-bold uppercase hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45',
                data.status === option.status ? statusTone(option.status) : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              {option.icon}
              {option.status}
            </button>
          ))}
        </div>

        {/* Memasang key={data.updatedAt || data.id} memastikan form ter-refresh jika data server berubah */}
        <div key={`${data.id}-${data.updatedAt}-${data.maxSelections}-${data.selectionDurationHours}-${data.additionalLimit}-${data.addonStatus}`} className="space-y-4 rounded-xl border border-[var(--border)] p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const nextMasterLimit = Math.min(500, Math.max(0, Number(form.get('master-limit')) || 0));
              const nextDurationHours = Math.min(8760, Math.max(1, Number(form.get('selection-duration')) || 72));
              const nextActiveLimit = nextMasterLimit ? nextMasterLimit + (data.addonStatus === 'paid' ? addonLimit : 0) : 0;
              if (nextActiveLimit && submittedCount > nextActiveLimit) {
                addToast(`Active limit cannot be lower than ${submittedCount} submitted selections.`, 'error');
                return;
              }
              const currentDurationHours = Number(data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24);
              const durationChanged = nextDurationHours !== currentDurationHours;
              update.mutate({
                id: data.id,
                title: String(form.get('title') || data.title).trim(),
                driveFolderUrl: String(form.get('driveFolderUrl') || driveUrl).trim(),
                pin: String(form.get('pin') || ''),
                maxSelections: nextMasterLimit,
                ...(durationChanged ? { selectionDurationHours: nextDurationHours } : {}),
              });
            }}
            className="space-y-4"
          >
            <div className="space-y-4">
              <Field label="Gallery title">
                <input name="title" required defaultValue={data.title} className={inputClass} />
              </Field>
              <Field label="Google Drive folder URL">
                <input name="driveFolderUrl" required defaultValue={driveUrl} className={inputClass} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Client PIN">
                  <input name="pin" minLength={4} placeholder="Set a new PIN (optional)" className={inputClass} />
                </Field>
                <Field label="Master limit (0 = Unlimited)" title="Master selection limit (0 = Unlimited)">
                  <input name="master-limit" type="number" min="0" max="500" defaultValue={masterLimit || ''} placeholder="Unlimited" className={inputClass} />
                </Field>
                <Field label="Selection window">
                  <div className="relative">
                    <input name="selection-duration" required type="number" min="1" max="8760" defaultValue={data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24} className={clsx(inputClass, 'pr-16 tabular-nums')} />
                    <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[11px] font-medium text-[var(--text-muted)]">hours</span>
                  </div>
                </Field>
              </div>
            </div>
            <div className="flex justify-end border-t border-[var(--border)] pt-4">
              <button disabled={update.isPending} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[10px] font-black uppercase text-[var(--bg-deep)] disabled:cursor-not-allowed disabled:opacity-50">
                {update.isPending && <Loader2 size={13} className="animate-spin" />}
                Save master
              </button>
            </div>
          </form>

          <div className="border-t border-[var(--border)] pt-4">
            <button type="button" onClick={() => setAddonOpen((value) => !value)} className="flex w-full cursor-pointer items-center justify-between text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <span>
                <span className="label-xs text-[var(--accent)]">ORBIT ADD-ON</span>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">Optional edited photos and payment tracking.</span>
              </span>
              <ChevronDown size={16} className={clsx('text-[var(--text-muted)] transition-transform', addonOpen && 'rotate-180')} />
            </button>
            {addonOpen && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const nextAddonLimit = Math.min(500, Math.max(0, Number(form.get('addon-limit')) || 0));
                  const nextAddonPrice = Math.max(0, parseIdr(form.get('addon-price')));
                  const nextAddonStatus = String(form.get('addon-status') || 'unpaid');
                  const nextActiveLimit = masterLimit ? masterLimit + (nextAddonStatus === 'paid' ? nextAddonLimit : 0) : 0;
                  if (nextActiveLimit && submittedCount > nextActiveLimit) {
                    addToast(`Active limit cannot be lower than ${submittedCount} submitted selections.`, 'error');
                    return;
                  }
                  if (!window.confirm('Save Orbit add-on changes? The add-on quota becomes active for the client only when payment is marked Paid.')) return;
                  update.mutate({ id: data.id, additionalSelectionLimit: nextAddonLimit, editAddonPrice: nextAddonPrice, editAddonPricingMode: 'per_photo', editAddonStatus: nextAddonStatus });
                }}
                className="mt-4"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-muted)]">Quota active after payment</span>
                  <span className={clsx('rounded-md border px-2 py-1 text-[9px] font-bold uppercase', addonPaid ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400')}>
                    {addonPaid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Add-on edited photos">
                    <input name="addon-limit" type="number" min="0" max="500" value={addonDraftLimit} onChange={(event) => setAddonDraftLimit(Math.min(500, Math.max(0, Number(event.currentTarget.value) || 0)))} className={inputClass} />
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
                        onClick={() => setPaymentStatus('unpaid')}
                        className={clsx('cursor-pointer text-[10px] font-bold uppercase transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', paymentStatus === 'unpaid' ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]')}
                      >
                        Unpaid
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentStatus('paid')}
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
                    <dd className="mt-1 font-semibold text-[var(--text-primary)]">{addonLimit}</dd>
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
                <div className="mt-4 flex justify-end border-t border-[var(--border)] pt-4">
                  <button disabled={update.isPending} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[10px] font-black uppercase text-[var(--bg-deep)] disabled:cursor-not-allowed disabled:opacity-50">
                    {update.isPending && <Loader2 size={13} className="animate-spin" />}
                    Save add-on
                  </button>
                </div>
              </form>
            )}
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
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filter, setFilter] = useState<'all' | GalleryStatus>('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const query = useQuery({
    queryKey: ['galleries', page, filter, debouncedSearch],
    queryFn: () => listGalleries({ page, pageSize: PAGE_SIZE, status: filter, search: debouncedSearch }),
    enabled: canManage,
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 1000,
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
  const selected = galleries.find((gallery) => gallery.id === selectedId);

  const create = useMutation({
    mutationFn: createGallery,
    onSuccess: (gallery) => {
      addToast('Gallery created.', 'success');
      setCreateOpen(false);
      setSelectedId(gallery.id);
      qc.invalidateQueries({ queryKey: ['galleries'] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to create gallery.', 'error'),
  });

  const statusUpdate = useMutation({
    mutationFn: updateGallery,
    onSuccess: () => {
      addToast('Gallery status updated.', 'success');
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
      setSelectedId((current) => (current === id ? null : current));
      qc.invalidateQueries({ queryKey: ['galleries'] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to delete gallery.', 'error'),
  });

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setSelectedId(null);
  };

  const changeFilter = (value: 'all' | GalleryStatus) => {
    setFilter(value);
    setPage(1);
    setSelectedId(null);
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

        <section className={`${PANEL_CARD_CLASS} overflow-hidden !p-0`}>
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
            <SectionHeading title="Gallery Workspace" subtitle={`${pageItems.length} SHOWN / ${total} MATCHING`} />
          </div>
          {query.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-[var(--accent)]" />
            </div>
          ) : query.isError ? (
            <div className="py-16 text-center text-rose-400">Unable to load galleries.</div>
          ) : (
            <GalleryTable
              galleries={pageItems}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onStatusChange={(id, status) => statusUpdate.mutate({ id, status })}
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
      {selected && <GalleryDetail gallery={selected} close={() => setSelectedId(null)} />}
    </div>
  );
}
