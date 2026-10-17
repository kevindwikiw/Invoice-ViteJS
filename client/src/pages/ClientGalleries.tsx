import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  SEGMENT_BUTTON_BASE_CLASS,
  SEGMENT_BUTTON_INACTIVE_CLASS,
  SEGMENT_GROUP_CLASS,
} from '../constants/uiContract';
import type {
  GalleryMode,
  GalleryListMode,
  GalleryWorkflow,
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
  getEditArchivePreparation,
  listGalleries,
  publishEditResults,
  resetGalleryEditResultsLock,
  resetGalleryPinLock,
  retryEditArchivePreparation,
  saveGalleryContact,
  syncGallery,
  syncEditResults,
  updateGallery,
  type GalleryContactSettings,
  type CreateGalleryInput,
} from '../features/culling/culling.admin';
import { formatDateValue } from '../lib/date';
import { GalleryModal as Modal } from '../components/GalleryModal';
import { EditResultPairs } from '../features/culling/EditResultPairs';
type GalleryPageMode = GalleryListMode | 'preview';
function GalleryModeTabs<T extends GalleryPageMode>({ value, onChange, disabled = false, scope, deliveryOnly = false }: { value: T; onChange: (mode: T) => boolean | void; disabled?: boolean; scope: string; deliveryOnly?: boolean }) {
  const options = (scope === 'gallery-list'
    ? [{ value: 'selection', label: 'Selection Events', compactLabel: 'Events' }, { value: 'wedding', label: 'Wedding', compactLabel: 'Wedding' }, { value: 'preview', label: 'Preview Samples', compactLabel: 'Preview' }]
    : [...(deliveryOnly ? [] : [{ value: 'selection', label: 'Photo Selection', compactLabel: 'Selection' }]), { value: 'edited', label: 'Edited Photos', compactLabel: 'Edited' }]) as { value: GalleryPageMode; label: string; compactLabel: string }[];
  return <div role="tablist" aria-label="Gallery area" className="flex overflow-x-auto border-b border-[var(--border)]">
    {options.map((option, index) => <button key={option.value} type="button" role="tab" id={`${scope}-${option.value}-tab`} aria-label={option.label} aria-controls={`${scope}-panel`} aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={disabled}
      onClick={() => onChange(option.value as T)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        const next = options[nextIndex]!.value;
        if (onChange(next as T) !== false) document.getElementById(`${scope}-${next}-tab`)?.focus();
      }}
      className={clsx('min-h-11 border-b-2 px-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 sm:shrink-0 sm:px-5 sm:text-sm', 'min-w-0 flex-1 text-center', value === option.value ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]')}
    ><span className="sm:hidden">{scope === 'gallery-list' ? option.compactLabel : option.label}</span><span className="hidden sm:inline">{option.label}</span></button>)}
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
const publicEditedUrl = (gallery: GallerySummary) => `${publicUrl(gallery)}/edited`;
const driveUrl = (gallery: GallerySummary) => (gallery.driveFolderId?.startsWith('http') ? gallery.driveFolderId : `https://drive.google.com/drive/folders/${gallery.driveFolderId || ''}`);
const editedFolderUrl = (gallery: GallerySummary) => gallery.editResultsFolderId ? (gallery.editResultsFolderId.startsWith('http') ? gallery.editResultsFolderId : `https://drive.google.com/drive/folders/${gallery.editResultsFolderId}`) : null;
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
  if (status === 'open') return 'border-[var(--text-muted)] bg-[var(--bg-elevated)] text-[var(--text-primary)]';
  if (status === 'draft') return 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]';
  return 'border-[var(--border)] bg-transparent text-[var(--text-secondary)]';
}
function useAnchoredMenu(open: boolean, close: () => void, width: number, height: number, direction: 'up' | 'down') {
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(close);
  const keyboardOpenRef = useRef(false);
  closeRef.current = close;
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = menuRef.current?.offsetHeight || height;
      const menuWidth = menuRef.current?.offsetWidth || width;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const openDown = direction === 'down' ? below >= menuHeight + 8 || below >= above : !(above >= menuHeight + 8 || above > below);
      setPosition({
        top: openDown ? Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8) : Math.max(8, rect.top - menuHeight - 4),
        left: Math.min(Math.max(8, rect.right - menuWidth), Math.max(8, window.innerWidth - menuWidth - 8)),
      });
    };
    place();
    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) closeRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [direction, height, open, width]);
  useLayoutEffect(() => {
    if (!open || !position || !keyboardOpenRef.current) return;
    menuRef.current?.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus();
    keyboardOpenRef.current = false;
  }, [open, position]);
  return { ref, triggerRef, menuRef, position, markKeyboardOpen: () => { keyboardOpenRef.current = true; } };
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
  error,
}: {
  close: () => void;
  pending: boolean;
  submit: (input: CreateGalleryInput) => void;
  error?: string;
}) {
  const [workflow, setWorkflow] = useState<GalleryWorkflow>('selection_delivery');
  const [showSelectionPassword, setShowSelectionPassword] = useState(false);
  const deliveryOnly = workflow === 'delivery_only';
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
          if (deliveryOnly) {
            submit({ workflow, title: String(data.get('title') || '').trim(), editResultsFolderId: String(data.get('drive') || '').trim() });
            return;
          }
          submit({
            workflow: 'selection_delivery',
            title: String(data.get('title') || '').trim(),
            driveFolderUrl: String(data.get('drive') || '').trim(),
            pin: String(data.get('pin') || ''),
            status: 'draft',
            maxSelections: Math.min(500, Math.max(0, Number(data.get('limit')) || 0)),
            selectionDurationHours: Math.min(8760, Math.max(1, Number(data.get('duration')) || 72)),
            qrisEnabled: data.get('qrisEnabled') === 'on',
          });
        }}
      >
        <div role="group" aria-label="Gallery workflow" className="grid grid-cols-2 gap-1 rounded-md border border-[var(--border)] p-1">
          {([{ value: 'selection_delivery', label: 'Prewedding' }, { value: 'delivery_only', label: 'Wedding' }] as const).map((option) => <button key={option.value} type="button" aria-pressed={workflow === option.value} disabled={pending} onClick={() => setWorkflow(option.value)} className={clsx('min-h-11 rounded px-3 text-sm font-semibold transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50', workflow === option.value ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}>{option.label}</button>)}
        </div>
        {deliveryOnly && error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <Field label="Gallery name">
          <input name="title" required placeholder={deliveryOnly ? 'Aldian & Panpan Wedding' : 'Aldian & Panpan Prewedding'} className={compactInputClass} />
        </Field>
        <Field label={deliveryOnly ? 'Edited photos Drive folder' : 'Google Drive folder'}>
          <input name="drive" required placeholder="https://drive.google.com/drive/folders/..." className={compactInputClass} />
        </Field>
        {!deliveryOnly && <><div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <label htmlFor="create-selection-password" className="block text-[11px] font-semibold text-[var(--text-secondary)]">Photo Selection password</label>
            <div className="relative">
              <input id="create-selection-password" name="pin" required minLength={4} maxLength={64} type={showSelectionPassword ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" spellCheck={false} style={{ paddingRight: 48 }} className={compactInputClass} />
              <button type="button" aria-label={showSelectionPassword ? 'Hide Photo Selection password' : 'Show Photo Selection password'} aria-pressed={showSelectionPassword} onClick={() => setShowSelectionPassword((current) => !current)} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{showSelectionPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button>
            </div>
          </div>
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
        </>}
      </form>
    </Modal>
  );
}
function GalleryFilters({ filter, setFilter, scope }: { filter: 'all' | GalleryStatus; setFilter: (filter: 'all' | GalleryStatus) => void; scope: GalleryMode }) {
  const options: Array<{ value: 'all' | GalleryStatus; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'draft', label: 'Draft' },
    { value: 'closed', label: 'Closed' },
  ];
  return (
    <div role="group" aria-label={`${scope === 'selection' ? 'Photo Selection' : 'Edited Photos'} status filter`} className={`${SEGMENT_GROUP_CLASS} max-sm:w-full`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={`Filter ${option.label}`}
          aria-pressed={filter === option.value}
          onClick={() => setFilter(option.value)}
          className={clsx(
            SEGMENT_BUTTON_BASE_CLASS,
            'max-sm:min-w-0 max-sm:flex-1 max-sm:px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
            filter === option.value ? 'bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm font-bold' : SEGMENT_BUTTON_INACTIVE_CLASS
          )}
        >
          {option.label}
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
  const { ref, triggerRef, menuRef, position, markKeyboardOpen } = useAnchoredMenu(open, () => setOpen(false), 150, 116, direction);
  const disabled = !gallery.selectionCount;
  const items = <>
    <button type="button" onClick={() => { setOpen(false); void downloadGallerySelections(gallery.id); }} className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><Download size={12} aria-hidden="true" /> CSV</button>
    <button type="button" onClick={() => { setOpen(false); void downloadGallerySelectionsXlsx(gallery.id); }} className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><FileSpreadsheet size={12} aria-hidden="true" /> XLSX</button>
    <button type="button" onClick={() => { setOpen(false); void downloadGallerySelectionCopyScript(gallery.id); }} className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><FileCode2 size={12} aria-hidden="true" /> PS1</button>
  </>;
  return (
    <div ref={ref} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title="Download selections"
        aria-label={`Download ${gallery.title} selections`}
        aria-expanded={open}
        onKeyDown={(event) => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { markKeyboardOpen(); if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } } }}
        onClick={() => setOpen((value) => !value)}
        className={
          className ||
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40'
        }
      >
        <Download size={13} />
        {className && <span>Download</span>}
      </button>
      {open && !disabled && (className
        ? <div ref={menuRef} className={clsx('absolute right-0 z-30 min-w-32 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl', direction === 'down' ? 'top-full mt-1' : 'bottom-full mb-1')}>{items}</div>
        : position && createPortal(<div ref={menuRef} style={{ position: 'fixed', top: position.top, left: position.left, width: 150 }} className="z-[120] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">{items}</div>, document.body))}
    </div>
  );
}
function ClientLinkMenu({ gallery, mode, direction = 'up' }: { gallery: GallerySummary; mode: GalleryMode; direction?: 'up' | 'down' }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const area = mode === 'selection' ? 'Photo Selection' : 'Edited Photos';
  const url = mode === 'edited' ? publicEditedUrl(gallery) : publicUrl(gallery);
  const folderUrl = mode === 'selection' ? gallery.driveFolderId ? driveUrl(gallery) : null : editedFolderUrl(gallery);
  const menuHeight = folderUrl ? 132 : 92;
  const { ref, triggerRef, menuRef, position, markKeyboardOpen } = useAnchoredMenu(open, () => setOpen(false), 240, menuHeight, direction);
  return (
    <div ref={ref} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        title={`${area} client link`}
        aria-label={`${gallery.title} ${area} client link actions`}
        aria-expanded={open}
        onKeyDown={(event) => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { markKeyboardOpen(); if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } } }}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <ExternalLink size={13} />
      </button>
      {open && position && createPortal(
        <div ref={menuRef} role="group" aria-label={`${area} link options`} style={{ position: 'fixed', top: position.top, left: position.left, width: 240 }} className="z-[120] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">
          <div>
            <button type="button" onClick={() => { setOpen(false); void navigator.clipboard.writeText(url).then(() => addToast('Client link copied.', 'success')); }} className="flex min-h-10 w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <Clipboard size={12} aria-hidden="true" /> Copy {area} link
            </button>
            <a href={url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <ExternalLink size={12} aria-hidden="true" /> Open {area} link
            </a>
            {folderUrl && <a href={folderUrl} target="_blank" rel="noreferrer" aria-label={`Open ${mode === 'selection' ? 'source' : 'edited'} Drive folder for ${gallery.title}`} onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border-t border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <FolderSync size={12} aria-hidden="true" /> Open Drive folder
            </a>}
          </div>
        </div>, document.body
      )}
    </div>
  );
}
function MaintenanceMenu({
  gallery,
  area,
  onUnlock,
  onDelete,
  unlockPending,
  deletePending,
  direction = 'up',
}: {
  gallery: GallerySummary;
  area: GalleryMode;
  onUnlock: (id: number) => void;
  onDelete: (gallery: GallerySummary) => void;
  unlockPending: boolean;
  deletePending: boolean;
  direction?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const pending = unlockPending || deletePending;
  const unlockLabel = area === 'selection' ? 'Unlock Selection access' : 'Unlock Edited access';
  const { ref, triggerRef, menuRef, position, markKeyboardOpen } = useAnchoredMenu(open, () => setOpen(false), 200, 92, direction);
  return (
    <div ref={ref} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        title="Maintenance"
        aria-label={`${gallery.title} ${area === 'selection' ? 'Photo Selection' : 'Edited Photos'} maintenance actions`}
        aria-expanded={open}
        onKeyDown={(event) => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { markKeyboardOpen(); if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } } }}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40',
          open && 'border-[var(--accent)] bg-[var(--bg-elevated)]'
        )}
      >
        {pending ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
      </button>
      {open && position && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: position.top, left: position.left, width: 200 }} className="z-[120] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">
          <button
            type="button"
            disabled={unlockPending}
            onClick={() => {
              setOpen(false);
              onUnlock(gallery.id);
            }}
            className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyRound size={12} aria-hidden="true" />
            {unlockLabel}
          </button>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              setOpen(false);
              onDelete(gallery);
            }}
            className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase text-rose-400 hover:bg-rose-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={12} aria-hidden="true" />
            Delete gallery
          </button>
        </div>, document.body
      )}
    </div>
  );
}
function GalleryStatusMenu({ gallery, onChange, onExpiredOpen, pending, pendingStatus, busy, area }: { gallery: GallerySummary; onChange: (status: GalleryStatus) => void; onExpiredOpen: () => void; pending: boolean; pendingStatus: GalleryStatus | null; busy: boolean; area: GalleryMode }) {
  const options: Array<{ status: GalleryStatus; label: string }> = [
    { status: 'open', label: 'Open' },
    { status: 'draft', label: 'Draft' },
    { status: 'closed', label: 'Closed' },
  ];
  const [open, setOpen] = useState(false);
  const { ref, triggerRef, menuRef, position, markKeyboardOpen } = useAnchoredMenu(open, () => setOpen(false), 208, 168, 'down');
  const areaLabel = area === 'selection' ? 'Photo Selection' : 'Edited Photos';
  const current = pendingStatus || gallery.status || 'draft';
  const expired = area === 'selection' && gallery.isExpired;
  const currentLabel = expired && !pending ? 'Expired' : current.charAt(0).toUpperCase() + current.slice(1);
  return (
    <div ref={ref} className="relative inline-flex" onClick={(event) => event.stopPropagation()}>
      <button ref={triggerRef} type="button" disabled={busy} aria-label={`${gallery.title} ${areaLabel} status: ${currentLabel}`} aria-expanded={open} aria-busy={pending} onKeyDown={(event) => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { markKeyboardOpen(); if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } } }} onClick={() => setOpen((value) => !value)} className={clsx('inline-flex h-11 min-w-[88px] items-center justify-between gap-1.5 rounded border px-2.5 text-[11px] font-semibold transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait', statusTone(current))}>
        <span>{pending ? 'Saving…' : currentLabel}</span>{pending ? <Loader2 size={13} aria-hidden="true" className="animate-spin" /> : <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {open && position && createPortal(<div ref={menuRef} role="group" aria-label={`${gallery.title} ${areaLabel} status options`} style={{ position: 'fixed', top: position.top, left: position.left, width: 208 }} className="z-[120] rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-1 text-left shadow-xl">
        <p className="px-2 py-1 text-[10px] text-[var(--text-muted)]">Changes apply immediately</p>
        {options.map((option) => <button key={option.status} type="button" disabled={busy || gallery.status === option.status} onClick={() => {
          setOpen(false);
          if (option.status === 'open' && expired) { onExpiredOpen(); return; }
          if (gallery.status === 'open' && option.status !== 'open' && !window.confirm(`${option.label} ${areaLabel} now? Client access will pause; saved photos remain available to admins.`)) return;
          onChange(option.status);
        }} className={clsx('flex min-h-11 w-full items-center justify-between gap-2 rounded px-3 text-left text-xs font-medium hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50', gallery.status === option.status && !expired && 'bg-[var(--bg-elevated)] text-[var(--text-primary)]')}>
          <span>{option.status === 'open' && expired ? 'Reset window to open…' : option.label}</span>{gallery.status === option.status && !expired && <Check size={14} aria-hidden="true" />}
        </button>)}
      </div>, document.body)}
    </div>
  );
}
function GalleryCountButton({ gallery, area, count, onSelect }: { gallery: GallerySummary; area: GalleryMode; count: number; onSelect: (id: number, area: GalleryMode) => void }) {
  return <button type="button" aria-label={`Open ${area === 'selection' ? 'Photo Selection' : 'Edited Photos'} for ${gallery.title}`} onClick={(event) => { event.stopPropagation(); onSelect(gallery.id, area); }} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-xs font-semibold tabular-nums text-[var(--text-secondary)] hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{count}</button>;
}
function GalleryTable({
  mode,
  galleries,
  selectedId,
  onSelect,
  onStatusChange,
  onExpiredOpen,
  onResetPin,
  onResetEdited,
  onDelete,
  onResetFilters,
  hasActiveFilters,
  statusPendingId,
  statusPendingArea,
  statusPendingStatus,
  statusBusy,
  resetPendingId,
  editedResetPendingId,
  deletePendingId,
}: {
  mode: GalleryMode;
  galleries: GallerySummary[];
  selectedId: number | null;
  onSelect: (id: number, area: GalleryMode) => void;
  onStatusChange: (id: number, status: GalleryStatus, area: GalleryMode) => void;
  onExpiredOpen: (gallery: GallerySummary) => void;
  onResetPin: (id: number) => void;
  onResetEdited: (id: number) => void;
  onDelete: (gallery: GallerySummary) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
  statusPendingId: number | null;
  statusPendingArea: GalleryMode | null;
  statusPendingStatus: GalleryStatus | null;
  statusBusy: boolean;
  resetPendingId: number | null;
  editedResetPendingId: number | null;
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
      <table className={clsx('w-full text-left text-xs', mode === 'selection' ? 'min-w-[960px] table-fixed' : 'min-w-[900px]')}>
        {mode === 'selection' ? (
          <colgroup>
            <col className="w-[180px]" /><col className="w-[96px]" /><col className="w-[50px]" /><col className="w-[60px]" /><col className="w-[45px]" /><col className="w-[90px]" /><col className="w-[105px]" />
            <col className="w-[96px]" /><col className="w-[65px]" /><col className="w-[85px]" /><col className="w-[75px]" />
          </colgroup>
        ) : null}
        {mode === 'selection' ? (
          <thead className="border-y border-[var(--border)] text-[10px] font-medium uppercase text-[var(--text-muted)]">
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
              <th scope="col" rowSpan={2} className="px-4 text-left">Gallery</th>
              <th scope="colgroup" colSpan={6} className="border-l border-[var(--border)] px-4 py-2.5 text-left font-semibold">Photo Selection</th>
              <th scope="colgroup" colSpan={4} className="border-l border-[var(--border)] px-4 py-2.5 text-left font-semibold">Edited Photos</th>
            </tr>
            <tr className="whitespace-nowrap text-[9px]">
              <th scope="col" className="border-l border-[var(--border)] px-1 py-2.5 text-center">Status</th>
              <th scope="col" className="px-1 text-center">Source</th>
              <th scope="col" className="px-1 text-center">Submitted</th>
              <th scope="col" className="px-1 text-center">Limit</th>
              <th scope="col" className="px-1 text-center">Deadline</th>
              <th scope="col" className="px-1 text-center">Actions</th>
              <th scope="col" className="border-l border-[var(--border)] px-1 text-center">Status</th>
              <th scope="col" className="px-1 text-center">Published</th>
              <th scope="col" className="px-1 text-center">Access ends</th>
              <th scope="col" className="px-1 text-center">Actions</th>
            </tr>
          </thead>
        ) : (
          <thead className="border-y border-[var(--border)] text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
            <tr>
              <th className="px-7 py-3.5">Gallery</th>
              <th className="text-center">Status</th>
              <th className="text-center">Items</th>
              <th className="text-center">Access ends</th>
              <th className="text-center">Published</th>
              <th className="px-7 text-center">Actions</th>
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-[var(--border)]">
          {galleries.map((gallery, index) => (
            <tr
              key={gallery.id}
              onClick={(event) => {
                const cell = event.target instanceof Element ? event.target.closest<HTMLTableCellElement>('td[data-gallery-area]') : null;
                const area = cell?.dataset.galleryArea;
                if (area === 'selection' || area === 'edited') onSelect(gallery.id, area);
              }}
              className={clsx('gallery-area-row', selectedId === gallery.id && 'bg-[var(--bg-elevated)]')}
            >
              <td className={clsx('py-5', mode === 'selection' ? 'px-4' : 'max-w-[260px] px-7')}>
                <button type="button" title={`Open ${mode === 'selection' ? 'Photo Selection' : 'Edited Photos'} for ${gallery.title}`} onClick={(event) => { event.stopPropagation(); onSelect(gallery.id, mode); }} className={clsx('block max-w-full text-left text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', mode === 'selection' ? 'break-words leading-5' : 'truncate')}><span>{gallery.title}</span></button>
                {gallery.workflow === 'delivery_only' && <span className="mt-1 inline-block text-[10px] font-medium text-[var(--text-secondary)]">Wedding · Delivery only</span>}
              </td>
              {mode === 'selection' ? <>
                <td data-gallery-area="selection" className="border-l border-[var(--border)] px-1 text-center"><GalleryStatusMenu gallery={gallery} area="selection" pending={statusPendingId === gallery.id && statusPendingArea === 'selection'} pendingStatus={statusPendingId === gallery.id && statusPendingArea === 'selection' ? statusPendingStatus : null} busy={statusBusy} onExpiredOpen={() => onExpiredOpen(gallery)} onChange={(status) => onStatusChange(gallery.id, status, 'selection')} /></td>
                <td data-gallery-area="selection" className="text-center"><GalleryCountButton gallery={gallery} area="selection" count={gallery.photoCount || 0} onSelect={onSelect} /></td>
                <td data-gallery-area="selection" className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.selectionCount}</td>
                <td data-gallery-area="selection" className="text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]">{gallery.maxSelections ? gallery.maxSelections : <span className="inline-flex justify-center"><Unlimited /></span>}</td>
                <td data-gallery-area="selection" className={clsx('px-3 text-center text-[10px] font-medium leading-4', gallery.isExpired ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}>{deadlineLabel(gallery)}</td>
                <td data-gallery-area="selection" className="text-center"><div role="group" aria-label={`${gallery.title} Photo Selection actions`} className="flex items-center justify-center gap-0.5">
                  <ClientLinkMenu gallery={gallery} mode="selection" direction={index < 2 ? 'down' : 'up'} />
                  <DownloadMenu gallery={gallery} direction={index < 2 ? 'down' : 'up'} />
                  <MaintenanceMenu gallery={gallery} area="selection" onUnlock={onResetPin} onDelete={onDelete} unlockPending={resetPendingId === gallery.id} deletePending={deletePendingId === gallery.id} direction={index < 2 ? 'down' : 'up'} />
                </div></td>
                <td data-gallery-area="edited" className="border-l border-[var(--border)] px-1 text-center"><GalleryStatusMenu gallery={{ ...gallery, status: gallery.editResultsStatus ?? 'draft' }} area="edited" pending={statusPendingId === gallery.id && statusPendingArea === 'edited'} pendingStatus={statusPendingId === gallery.id && statusPendingArea === 'edited' ? statusPendingStatus : null} busy={statusBusy} onExpiredOpen={() => onExpiredOpen(gallery)} onChange={(status) => onStatusChange(gallery.id, status, 'edited')} /></td>
                <td data-gallery-area="edited" className="text-center"><GalleryCountButton gallery={gallery} area="edited" count={gallery.editResultsPhotoCount || 0} onSelect={onSelect} /></td>
                <td data-gallery-area="edited" className={clsx('px-2 text-center text-[10px] font-medium leading-4', gallery.editResultsIsExpired ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}>{!gallery.hasEditResults ? 'Not published' : gallery.editResultsExpiresAt ? formatDateValue(gallery.editResultsExpiresAt, dateFormat, 'Expired') : 'Unlimited'}</td>
                <td data-gallery-area="edited" className="text-center"><div role="group" aria-label={`${gallery.title} Edited Photos actions`} className="flex items-center justify-center gap-0.5">
                  <ClientLinkMenu gallery={gallery} mode="edited" direction={index < 2 ? 'down' : 'up'} />
                  <MaintenanceMenu gallery={gallery} area="edited" onUnlock={onResetEdited} onDelete={onDelete} unlockPending={editedResetPendingId === gallery.id} deletePending={deletePendingId === gallery.id} direction={index < 2 ? 'down' : 'up'} />
                </div></td>
              </> : <>
                <td data-gallery-area="edited" className="text-center"><GalleryStatusMenu gallery={{ ...gallery, status: gallery.editResultsStatus ?? 'draft' }} area="edited" pending={statusPendingId === gallery.id && statusPendingArea === 'edited'} pendingStatus={statusPendingId === gallery.id && statusPendingArea === 'edited' ? statusPendingStatus : null} busy={statusBusy} onExpiredOpen={() => onExpiredOpen(gallery)} onChange={(status) => onStatusChange(gallery.id, status, 'edited')} /></td>
                <td data-gallery-area="edited" className="text-center"><GalleryCountButton gallery={gallery} area="edited" count={gallery.editResultsPhotoCount || 0} onSelect={onSelect} /></td>
                <td data-gallery-area="edited" className={clsx('text-center text-[10px] font-medium leading-4', gallery.editResultsIsExpired ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}>{!gallery.hasEditResults ? 'Not published' : gallery.editResultsExpiresAt ? formatDateValue(gallery.editResultsExpiresAt, dateFormat, 'Expired') : 'Unlimited'}</td>
                <td data-gallery-area="edited" className="text-center text-[10px] font-medium leading-4 text-[var(--text-muted)]">{formatDateValue(gallery.editResultsPublishedAt, dateFormat, 'Never')}</td>
              </>}
              {mode === 'edited' && <td data-gallery-area="edited" className="px-7 text-center"><div role="group" aria-label={`${gallery.title} Edited Photos actions`} className="flex justify-center gap-1.5">
                <ClientLinkMenu gallery={gallery} mode="edited" direction={index < 2 ? 'down' : 'up'} />
                <MaintenanceMenu gallery={gallery} area="edited" onUnlock={onResetEdited} onDelete={onDelete} unlockPending={editedResetPendingId === gallery.id} deletePending={deletePendingId === gallery.id} direction={index < 2 ? 'down' : 'up'} />
              </div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const globalPreviewFields = [
  ['tutorialBeforeDriveFileId', 'tutorialAfterDriveFileId'],
  ['tutorialBefore2DriveFileId', 'tutorialAfter2DriveFileId'],
  ['tutorialBefore3DriveFileId', 'tutorialAfter3DriveFileId'],
] as const;
type PreviewSettings = Pick<GalleryContactSettings, 'tutorialBeforeDriveFileId' | 'tutorialAfterDriveFileId' | 'tutorialBefore2DriveFileId' | 'tutorialAfter2DriveFileId' | 'tutorialBefore3DriveFileId' | 'tutorialAfter3DriveFileId'>;
function contactFormValues(form: HTMLFormElement): Pick<GalleryContactSettings, 'contactWhatsappUrl' | 'message' | 'requestMoreMessage'> {
  const values = new FormData(form);
  const text = (name: string) => String(values.get(name) || '').trim();
  return {
    contactWhatsappUrl: text('phone'),
    message: text('message'),
    requestMoreMessage: text('requestMoreMessage'),
  };
}
function ContactSettings({ close }: { close: () => void }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['gallery-contact'], queryFn: getGalleryContact });
  const [dirty, setDirty] = useState(false);
  const save = useMutation({
    mutationFn: saveGalleryContact,
    onSuccess: (result) => {
      qc.setQueryData(['gallery-contact'], result);
      addToast('Admin WhatsApp settings saved.', 'success');
      void qc.invalidateQueries({ queryKey: ['gallery-contact'] });
      close();
    },
  });
  return (
    <Modal title="Admin WhatsApp" close={close} busy={save.isPending} beforeClose={() => !dirty || window.confirm('Discard unsaved admin settings?')} footer={query.isSuccess ? <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {save.isError && <p role="alert" className="w-full text-xs text-rose-500">{save.error instanceof Error ? save.error.message : 'Unable to save settings. Retry.'}</p>}
      <span role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">{dirty ? 'Unsaved changes' : 'No changes to save'}</span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" disabled={save.isPending} onClick={() => { if (!dirty || window.confirm('Discard unsaved admin settings?')) close(); }} className="h-10 rounded-md border border-[var(--border)] px-3 text-xs font-semibold hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50">Cancel</button>
        <button type="submit" form="admin-contact-form" disabled={save.isPending || !dirty} className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--bg-deep)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">
          {save.isPending && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}{save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div> : undefined}>
      {query.isPending ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Loading settings…</div> : query.isError ? <div role="alert" className="space-y-3 text-sm"><p>Unable to load admin settings.</p><button type="button" onClick={() => void query.refetch()} className="h-10 rounded-md border border-[var(--border)] px-3">Retry</button></div> :
      <form
        id="admin-contact-form"
        aria-busy={save.isPending}
        inert={save.isPending}
        key="loaded"
        onChange={(event) => {
          const current = contactFormValues(event.currentTarget);
          setDirty(Object.entries(current).some(([key, value]) => value !== String(query.data?.[key as keyof GalleryContactSettings] || '').trim()));
          save.reset();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(contactFormValues(event.currentTarget));
        }}
        className="space-y-4"
      >
        <p className="text-xs leading-5 text-[var(--text-muted)]">Contact number and message templates for client galleries.</p>
        <Field label="WhatsApp number">
          <input name="phone" required type="tel" autoComplete="tel" defaultValue={query.data?.contactWhatsappUrl || ''} placeholder="081234567890" className={inputClass} />
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
      </form>}
    </Modal>
  );
}
function PreviewSamplesSettings({ formId, showGlobalLabel = true, onDirtyChange, onSavedChange, onSavingChange }: { formId: string; showGlobalLabel?: boolean; onDirtyChange: (dirty: boolean) => void; onSavedChange: (saved: boolean) => void; onSavingChange: (saving: boolean) => void }) {
  const query = useQuery({ queryKey: ['gallery-contact'], queryFn: getGalleryContact, retry: false });
  if (query.isPending) return <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Loading preview samples...</div>;
  if (query.isError) return <div role="alert" className="space-y-3 text-sm"><p>Unable to load preview samples.</p><button type="button" onClick={() => void query.refetch()} className="h-10 rounded-md border border-[var(--border)] px-3">Retry</button></div>;
  return <PreviewSamplesForm formId={formId} settings={query.data} showGlobalLabel={showGlobalLabel} onDirtyChange={onDirtyChange} onSavedChange={onSavedChange} onSavingChange={onSavingChange} />;
}
function PreviewSamplesForm({ formId, settings, showGlobalLabel, onDirtyChange, onSavedChange, onSavingChange }: { formId: string; settings: GalleryContactSettings; showGlobalLabel: boolean; onDirtyChange: (dirty: boolean) => void; onSavedChange: (saved: boolean) => void; onSavingChange: (saving: boolean) => void }) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const initialValues = (source: GalleryContactSettings): PreviewSettings => Object.fromEntries(globalPreviewFields.flatMap(([before, after]) => [[before, source[before] || ''], [after, source[after] || '']])) as PreviewSettings;
  const [values, setValues] = useState<PreviewSettings>(() => initialValues(settings));
  const [baseline, setBaseline] = useState<PreviewSettings>(() => initialValues(settings));
  const [invalidSample, setInvalidSample] = useState<number | null>(null);
  const updateField = (field: keyof PreviewSettings, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    onDirtyChange(globalPreviewFields.some(([before, after]) => next[before].trim() !== baseline[before].trim() || next[after].trim() !== baseline[after].trim()));
    onSavedChange(false);
    setInvalidSample(null);
    save.reset();
  };
  const save = useMutation({
    mutationFn: saveGalleryContact,
    onSuccess: (result) => {
      qc.setQueryData(['gallery-contact'], result);
      void qc.invalidateQueries({ queryKey: ['gallery-contact'] });
      setValues(initialValues(result));
      setBaseline(initialValues(result));
      onDirtyChange(false);
      onSavedChange(true);
      addToast('Preview samples saved for all galleries.', 'success');
    },
    onSettled: () => onSavingChange(false),
  });
  return <form id={formId} aria-busy={save.isPending} inert={save.isPending} onSubmit={(event) => {
    event.preventDefault();
    const current = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])) as PreviewSettings;
    const incomplete = globalPreviewFields.findIndex(([before, after]) => Boolean(current[before]) !== Boolean(current[after]));
    if (incomplete >= 0) {
      setInvalidSample(incomplete + 1);
      const missing = current[globalPreviewFields[incomplete]![0]] ? globalPreviewFields[incomplete]![1] : globalPreviewFields[incomplete]![0];
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${missing}"]`)?.focus();
      return;
    }
    setInvalidSample(null);
    onSavingChange(true);
    save.mutate(current);
  }} className="space-y-4">
    <div className="border-b border-[var(--border)] pb-4">
      {showGlobalLabel && <p className="text-[10px] font-bold uppercase text-[var(--accent)]">Global default · Used by all galleries</p>}
      <h3 className={clsx('text-base font-semibold text-[var(--text-primary)]', showGlobalLabel && 'mt-2')}>Before → Edited examples</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Changes here apply to every client gallery. Add up to three complete pairs for the tutorial.</p>
    </div>
    {save.isError && <p role="alert" className="text-xs text-rose-500">{save.error instanceof Error ? save.error.message : 'Unable to save preview samples. Retry.'}</p>}
    <div className="space-y-3">
      {globalPreviewFields.map(([before, after], index) => {
        const complete = Boolean(values[before]) && Boolean(values[after]);
        const incomplete = Boolean(values[before]) !== Boolean(values[after]);
        const invalid = invalidSample === index + 1;
        return <div key={before} className={clsx('rounded-md border p-3 sm:p-4', invalid ? 'border-rose-400/70' : 'border-[var(--border)]')}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Sample {index + 1}</span>
            <span className={clsx('text-[10px] font-semibold', complete ? 'text-emerald-500' : incomplete ? 'text-amber-500' : 'text-[var(--text-muted)]')}>{complete ? 'Complete' : incomplete ? 'Needs both photos' : 'Optional'}</span>
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Field label="Before photo"><input name={before} value={values[before]} onChange={(event) => updateField(before, event.currentTarget.value)} aria-label={`Sample ${index + 1} before photo`} aria-invalid={invalid} aria-describedby={invalid ? `global-preview-error-${index + 1}` : undefined} placeholder="Drive file link or ID" className={inputClass} /></Field>
            <span aria-hidden="true" className="hidden pb-3 text-lg text-[var(--text-muted)] sm:block">→</span>
            <Field label="Edited photo"><input name={after} value={values[after]} onChange={(event) => updateField(after, event.currentTarget.value)} aria-label={`Sample ${index + 1} edited photo`} aria-invalid={invalid} aria-describedby={invalid ? `global-preview-error-${index + 1}` : undefined} placeholder="Drive file link or ID" className={inputClass} /></Field>
          </div>
          {invalid && <p id={`global-preview-error-${index + 1}`} role="alert" className="mt-2 text-xs text-rose-500">Add both photos for sample {index + 1}, or clear both fields.</p>}
        </div>;
      })}
    </div>
  </form>;
}
function PreviewSamplesPage({ dirty, saved, saving, onDirtyChange, onSavedChange, onSavingChange }: { dirty: boolean; saved: boolean; saving: boolean; onDirtyChange: (dirty: boolean) => void; onSavedChange: (saved: boolean) => void; onSavingChange: (saving: boolean) => void }) {
  const formId = 'global-preview-page-form';
  return <section role="tabpanel" id="gallery-list-panel" aria-labelledby="gallery-list-preview-tab" className={`${PANEL_CARD_CLASS} overflow-hidden !p-0`}>
    <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-7">
      <SectionHeading title="Preview Samples" subtitle="GLOBAL MASTER / ALL GALLERIES" />
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <span role="status" aria-live="polite" className={clsx('text-xs', dirty ? 'font-semibold text-[var(--accent)]' : saved ? 'text-emerald-500' : 'text-[var(--text-muted)]')}>
          {dirty ? 'Unsaved changes' : saved ? 'Preview samples saved' : 'No changes to save'}
        </span>
        <button type="submit" form={formId} disabled={saving || !dirty} className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-deep)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto">
          {saving ? <Loader2 size={14} aria-hidden="true" className="animate-spin" /> : <Check size={14} aria-hidden="true" />}
          {saving ? 'Saving…' : 'Save Preview Samples'}
        </button>
      </div>
    </div>
    <div className="mx-auto max-w-4xl px-5 py-6 md:px-7">
      <PreviewSamplesSettings formId={formId} showGlobalLabel={false} onDirtyChange={onDirtyChange} onSavedChange={onSavedChange} onSavingChange={onSavingChange} />
    </div>
  </section>;
}
function GalleryDetail({ gallery, close, mode, focusSelectionDuration = false }: { gallery: GallerySummary; close: () => void; mode: GalleryMode; focusSelectionDuration?: boolean }) {
  const detail = useQuery({ queryKey: ['gallery-detail', gallery.id], queryFn: () => getGalleryDetail(gallery.id) });
  if (detail.isLoading) {
    return <Modal title={gallery.title} close={close}><div role="status" aria-label="Loading gallery details" className="flex min-h-[60dvh] items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin" /> Loading gallery...</div></Modal>;
  }
  if (!detail.data) {
    return <Modal title={gallery.title} close={close}><div role="alert" className="space-y-4 py-8 text-center text-sm"><p>Unable to load gallery details.</p><button type="button" onClick={() => void detail.refetch()} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-4"><RefreshCw size={16} /> Retry</button></div></Modal>;
  }
  return <GalleryDetailEditor key={gallery.id} data={detail.data.gallery} close={close} initialMode={mode} focusSelectionDuration={focusSelectionDuration} />;
}
function GalleryDetailEditor({ data, close, initialMode, focusSelectionDuration }: { data: GallerySummary; close: () => void; initialMode: GalleryMode; focusSelectionDuration: boolean }) {
  const deliveryOnly = data.workflow === 'delivery_only';
  const detailMode = deliveryOnly ? 'edited' : initialMode;
  const { addToast } = useToast();
  const editFormRef = useRef<HTMLFormElement>(null);
  const qc = useQueryClient();
  const [mode, setMode] = useState<GalleryMode>(detailMode);
  const [restartSelectionWindow, setRestartSelectionWindow] = useState(focusSelectionDuration && Boolean(data.isExpired));
  useEffect(() => {
    if (!focusSelectionDuration) return;
    const input = document.querySelector<HTMLInputElement>('#edit-gallery-form input[name="selection-duration"]');
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'center' });
  }, [focusSelectionDuration]);
  const [selectionStatus, setSelectionStatus] = useState<GalleryStatus>(data.status ?? 'draft');
  const [editedStatus, setEditedStatus] = useState<GalleryStatus>(data.editResultsStatus ?? (data.hasEditResults ? 'open' : 'draft'));
  const draftStatus = mode === 'edited' ? editedStatus : selectionStatus;
  const setDraftStatus = mode === 'edited' ? setEditedStatus : setSelectionStatus;
  const [feedback, setFeedback] = useState({
    selection: { dirty: focusSelectionDuration && Boolean(data.isExpired), saved: false, saveError: '', actionError: '' },
    edited: { dirty: false, saved: false, saveError: '', actionError: '' },
  });
  const { dirty, saved, saveError, actionError } = feedback[mode];
  const setDirty = (value: boolean) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], dirty: value } }));
  const setSaved = (value: boolean) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], saved: value } }));
  const setSaveError = (value: string) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], saveError: value } }));
  const setActionError = (value: string) => setFeedback((current) => ({ ...current, [mode]: { ...current[mode], actionError: value } }));
  const [pendingPin, setPendingPin] = useState(false);
  const [showSelectionPassword, setShowSelectionPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [comparisonEnabled, setComparisonEnabled] = useState(Boolean(data.comparisonEnabled));
  const [comparisonPairs, setComparisonPairs] = useState(data.comparisonPairs || []);
  const [pairsDirty, setPairsDirty] = useState(false);
  const [liveComparisonCount, setLiveComparisonCount] = useState<number | null>(null);
  const [pairsOpen, setPairsOpen] = useState(false);
  const [publishAfterSave, setPublishAfterSave] = useState(false);
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
  const [editedSyncPending, setEditedSyncPending] = useState(false);
  const initialEditDuration = data.editResultsAccessDurationHours;
  const [editAccessPreset, setEditAccessPreset] = useState(() => initialEditDuration === null ? 'unlimited' : [24, 72, 168, 336].includes(Number(initialEditDuration || 168)) ? String(initialEditDuration || 168) : 'custom');
  const [editCustomDays, setEditCustomDays] = useState(() => Math.max(1, Math.round(Number(initialEditDuration || 168) / 24)));
  const [publishWarnings, setPublishWarnings] = useState<string[]>([]);
  const archivePreparation = useQuery({
    queryKey: ['edit-archive-preparation', data.id],
    queryFn: () => getEditArchivePreparation(data.id),
    enabled: mode === 'edited' && editedStatus === 'open',
    refetchInterval: (query) => query.state.data?.ready || query.state.data?.enabled === false ? false : 5000,
  });
  const retryArchivePreparation = useMutation({
    mutationFn: () => retryEditArchivePreparation(data.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['edit-archive-preparation', data.id] }),
    onError: (error) => reportActionError('ZIP preparation', error),
  });
  const markDirty = () => { setDirty(true); setSaved(false); setSaveError(''); setActionError(''); };
  const syncFormDirty = (nextDirty: boolean) => {
    setFeedback((current) => ({ ...current, [mode]: { ...current[mode], dirty: nextDirty, saved: nextDirty ? false : current[mode].saved, saveError: '', actionError: '' } }));
  };
  const selectionFormChanged = (form: HTMLFormElement, status = selectionStatus) => {
    const getValue = (name: string) => String(new FormData(form).get(name) || '').trim();
    const initialDuration = String(data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24);
    return restartSelectionWindow || getValue('title') !== data.title.trim()
      || getValue('driveFolderUrl') !== driveUrl(data)
      || getValue('master-limit') !== (data.maxSelections ? String(data.maxSelections) : '')
      || getValue('selection-duration') !== initialDuration
      || getValue('pin') !== ''
      || status !== data.status
      || addonDirty;
  };
  const editedFormChanged = (form: HTMLFormElement, password = editResultsPassword, status = editedStatus) => {
    const formData = new FormData(form);
    const getValue = (name: string) => String(formData.get(name) || '').trim();
    const initialPreset = initialEditDuration === null ? 'unlimited' : [24, 72, 168, 336].includes(Number(initialEditDuration || 168)) ? String(initialEditDuration || 168) : 'custom';
    return getValue('editResultsFolderId') !== String(data.editResultsFolderId || '').trim()
      || (deliveryOnly && getValue('title') !== data.title.trim())
      || getValue('editResultsZipFileId') !== String(data.editResultsZipFileId || '').trim()
      || status !== (data.editResultsStatus ?? (data.hasEditResults ? 'open' : 'draft'))
      || editAccessPreset !== initialPreset
      || (editAccessPreset === 'custom' && editCustomDays !== Math.max(1, Math.round(Number(initialEditDuration || 168) / 24)))
      || comparisonEnabled !== Boolean(data.comparisonEnabled)
      || pairsDirty
      || password.trim() !== '';
  };
  const changeDraftStatus = (nextStatus: GalleryStatus) => {
    if (draftStatus === nextStatus) return;
    if (mode === 'selection' && nextStatus === 'open' && data.isExpired) setRestartSelectionWindow(true);
    setDraftStatus(nextStatus);
    const form = document.getElementById(mode === 'edited' ? 'edit-delivery-form' : 'edit-gallery-form');
    const nextDirty = form instanceof HTMLFormElement
      ? mode === 'edited'
        ? editedFormChanged(form, editResultsPassword, nextStatus)
        : selectionFormChanged(form, nextStatus)
      : true;
    syncFormDirty(nextDirty);
  };
  const reportActionError = (action: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : 'Please try again.';
    setActionError(`${action} failed. ${detail}`);
  };
  const update = useMutation({
    mutationFn: updateGallery,
    onSuccess: async (result, variables) => {
      const pin = editFormRef.current?.elements.namedItem('pin');
      if (variables.pin && pin instanceof HTMLInputElement && pin.value === variables.pin) {
        pin.value = '';
        setPendingPin(false);
      }
      const needsEditedSync = mode === 'edited' && result.editedSourceChanged && data.hasEditResults && !publishAfterSave;
      addToast(needsEditedSync ? 'Folder saved. Sync Edited Photos to update the client gallery.' : variables.pin ? 'Gallery updated. The new Photo Selection password is active.' : 'Gallery updated.', 'success');
      await qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
      void qc.invalidateQueries({ queryKey: ['galleries'] });
      setDirty(false);
      if (mode === 'selection') { setAddonDirty(false); setRestartSelectionWindow(false); }
      else { setPairsDirty(false); setFolderDirty(false); if (needsEditedSync) setEditedSyncPending(true); }
      setSaved(true);
      setSaveError('');
      setActionError('');
      setLiveComparisonCount(result.comparisonApplied ? Number(result.comparisonCount || 0) : null);
      if (mode === 'edited' && publishAfterSave && editResultsPassword.trim()) {
        setPublishAfterSave(false);
        publishResults.mutate({ id: data.id, password: editResultsPassword.trim() });
      }
    },
    onError: (error) => setSaveError(error instanceof Error ? error.message : 'Unable to save gallery changes.'),
  });
  const resetPin = useMutation({
    mutationFn: resetGalleryPinLock,
    onSuccess: () => addToast('Password attempts reset. The client can try again with the saved password.', 'success'),
    onError: (error) => reportActionError('Reset password attempts', error),
  });
  const resetEdited = useMutation({
    mutationFn: resetGalleryEditResultsLock,
    onSuccess: () => addToast('Edited Photos password attempts reset. The client can try again.', 'success'),
    onError: (error) => reportActionError('Unlock Edited Photos', error),
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
  const editSync = useMutation({
    mutationFn: syncEditResults,
    onSuccess: (result) => {
      addToast(result.published ? `Published snapshot updated with ${result.photoCount} edited items. Access settings unchanged.` : `${result.photoCount} edited items found. Publish to make them available to clients.`, 'success');
      setPublishWarnings(result.warnings || []);
      if (result.published) setEditedSyncPending(false);
      void qc.invalidateQueries({ queryKey: ['galleries'] });
      void qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
      void qc.invalidateQueries({ queryKey: ['public-edit-results'] });
      void qc.invalidateQueries({ queryKey: ['edit-archive-preparation', data.id] });
    },
    onError: (error) => reportActionError('Edited Photos sync', error),
  });
  const [editResultsPassword, setEditResultsPassword] = useState('');
  const [showEditResultsPassword, setShowEditResultsPassword] = useState(false);
  const publishResults = useMutation({
    mutationFn: publishEditResults,
    onSuccess: (result) => {
      setEditResultsPassword('');
      setShowEditResultsPassword(false);
      addToast(`Published ${result.photoCount} edited items across ${(result.folderCount ?? 0) + 1} folders with your delivery password.`, 'success');
      setPublishWarnings(result.warnings || []);
      setEditedStatus('open');
      setDirty(false);
      setSaved(true);
      setEditedSyncPending(false);
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery-detail', data.id] });
      void qc.invalidateQueries({ queryKey: ['edit-archive-preparation', data.id] });
    },
    onError: (error) => {
      setDirty(true);
      setSaved(false);
      reportActionError(data.hasEditResults ? 'Republish' : 'Publish', error);
    },
  });
  const [addonOpen, setAddonOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'paid'>(data.addonStatus === 'paid' ? 'paid' : 'unpaid');
  const [addonDraftLimit, setAddonDraftLimit] = useState(() => Number(data.additionalLimit || 0));
  const [addonUnitPrice, setAddonUnitPrice] = useState(() => Number(data.addon?.unitPrice ?? 10_000));
  const [qrisEnabled, setQrisEnabled] = useState(() => Boolean(data.addon?.qrisEnabled));
  const [addonDirty, setAddonDirty] = useState(false);
  const [masterLimit, setMasterLimit] = useState(() => Number(data.maxSelections || 0));
  const busy = update.isPending || sync.isPending || editSync.isPending || publishResults.isPending || resetPin.isPending || resetEdited.isPending;
  const addonPaid = paymentStatus === 'paid';
  const activeLimit = masterLimit ? masterLimit + (addonPaid ? addonDraftLimit : 0) : 0;
  const discountRules = data.addon?.discountRules;
  const addonEstimatedTotal = calculateAddonQuote(addonDraftLimit, addonUnitPrice, discountRules).total;
  const submittedCount = Number(data.selectionCount || 0);
  const link = mode === 'edited' ? publicEditedUrl(data) : publicUrl(data);
  const sourceDriveUrl = driveUrl(data);
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
          <span role="status" aria-live="polite" className={clsx('inline-flex min-h-5 items-center gap-2 text-xs transition-colors duration-200 motion-reduce:transition-none', dirty ? 'font-semibold text-[var(--accent)]' : mode === 'edited' && editedSyncPending ? 'font-semibold text-[var(--text-primary)]' : saved ? 'text-emerald-500' : 'text-[var(--text-muted)]')}>
            {dirty && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>
            )}
            {dirty ? 'Unsaved changes' : mode === 'edited' && editResultsPassword ? 'Delivery password not published' : mode === 'edited' && editedSyncPending ? 'Saved · Sync to update client photos' : saved && liveComparisonCount !== null ? `Changes saved · Before / After live on ${liveComparisonCount} ${liveComparisonCount === 1 ? 'photo' : 'photos'}` : saved ? 'Changes saved' : 'No changes to save'}
          </span>
          <button type="submit" form={mode === 'edited' ? 'edit-delivery-form' : 'edit-gallery-form'} disabled={busy || !dirty} className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-deep)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none">
            {update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {update.isPending ? 'Saving…' : mode === 'edited' ? 'Save Edited Photos' : 'Save Photo Selection'}
          </button>
        </div>
      </div>
    )}>
      {pairsOpen && <EditResultPairs galleryId={data.id} pairs={comparisonPairs} onApply={(pairs) => { setComparisonPairs(pairs); setPairsDirty(true); setLiveComparisonCount(null); markDirty(); setPairsOpen(false); }} />}
      <div className="space-y-5" hidden={pairsOpen}>
        <GalleryModeTabs value={mode} onChange={setMode} disabled={busy} scope="gallery-detail" deliveryOnly={deliveryOnly} />
        {deliveryOnly && <p className="text-xs font-semibold text-[var(--text-secondary)]">Wedding · Delivery only</p>}
        <div role="tabpanel" id="gallery-detail-panel" aria-labelledby={`gallery-detail-${mode}-tab`} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!deliveryOnly && <div hidden={mode !== 'selection'}>
            <p className="text-xs text-[var(--text-muted)]">
              {data.photoCount} photos, {data.selectionCount} submitted
            </p>
            <p className={clsx('mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold', data.isExpired ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              <Clock3 size={12} /> {deadlineLabel(data)} · {data.selectionDurationHours ?? (data.selectionDurationDays || 3) * 24} hours
            </p>
          </div>}
          <div hidden={mode !== 'edited'}>
            <p className="text-xs text-[var(--text-muted)]">
              {data.hasEditResults ? `${data.editResultsPhotoCount || 0} edited items published` : 'Edited Photos not published'}
            </p>
            {editedSyncPending && <p role="status" className="mt-1 text-xs font-medium text-[var(--text-primary)]">Folder saved. Sync to replace the photos clients see.</p>}
            <p className={clsx('mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold', data.hasEditResults && data.editResultsExpiresAt && Date.parse(data.editResultsExpiresAt) <= Date.now() ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              <Clock3 size={12} aria-hidden="true" /> {!data.hasEditResults ? 'Not published' : !data.editResultsExpiresAt ? 'Unlimited' : Date.parse(data.editResultsExpiresAt) <= Date.now() ? 'Expired' : formatDateValue(data.editResultsExpiresAt, dateFormat, 'Expired')} · {data.editResultsAccessDurationHours ? `${data.editResultsAccessDurationHours} hours` : 'Unlimited'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!deliveryOnly && <button
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
            </button>}
            {mode === 'edited' && <button
              type="button"
              disabled={busy}
              title={dirty ? 'Save changes before syncing' : 'Sync edited photos folder'}
              onClick={() => {
                if (dirty) { setActionError('Sync not started. Save changes first, then click Sync.'); return; }
                setActionError('');
                editSync.mutate(data.id);
              }}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 text-[10px] font-bold text-sky-400 hover:bg-sky-500/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editSync.isPending ? <Loader2 size={13} className="animate-spin" /> : <FolderSync size={13} />}
              {editSync.isPending ? 'Syncing…' : 'Sync'}
            </button>}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  addToast('Client link copied.', 'success');
                }).catch(() => addToast('Unable to copy the client link.', 'error'));
              }}
              className={clsx(
                'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold transition-all duration-150 motion-reduce:transition-none',
                copied
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]'
              )}
            >
              {copied ? <Check size={13} className="text-emerald-400 animate-in zoom-in-50 duration-150" /> : <Clipboard size={13} />}
              <span>{copied ? 'Copied!' : 'Copy link'}</span>
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
              { status: 'open' },
              { status: 'draft' },
              { status: 'closed' },
            ] as const
          ).map((option) => (
            <button
              key={option.status}
              type="button"
              disabled={busy}
              aria-pressed={draftStatus === option.status}
              onClick={() => changeDraftStatus(option.status)}
              className={clsx(
                'inline-flex h-11 cursor-pointer items-center justify-center rounded border text-xs font-semibold capitalize transition-[background-color,border-color,color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45 motion-reduce:transition-none',
                draftStatus === option.status ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              )}
            >
              {option.status}
            </button>
          ))}
        </div>
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          {!deliveryOnly && <><form
            ref={editFormRef}
            id="edit-gallery-form"
            hidden={mode !== 'selection'}
            aria-busy={update.isPending}
            onChange={(event) => syncFormDirty(selectionFormChanged(event.currentTarget))}
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
               driveFolderUrl: String(form.get('driveFolderUrl') || sourceDriveUrl).trim(),
               pin: String(form.get('pin') || ''),
               maxSelections: nextMasterLimit,
                ...(addonDirty ? { additionalSelectionLimit: addonDraftLimit, editAddonPrice: addonUnitPrice, editAddonPricingMode: 'per_photo', editAddonStatus: paymentStatus, qrisEnabled } : {}),
                ...(durationChanged || restartSelectionWindow ? { selectionDurationHours: nextDurationHours } : {}),
              });
            }}
            className="space-y-4"
          >
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <legend className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Photo Selection Setup</legend>
              <Field label="Gallery title">
                <input name="title" required defaultValue={data.title} className={inputClass} />
              </Field>
              <Field label="Google Drive folder URL">
                <input name="driveFolderUrl" required defaultValue={sourceDriveUrl} className={inputClass} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="min-w-0 space-y-2">
                  <label htmlFor="edit-selection-password" className="block text-[11px] font-semibold text-[var(--text-secondary)]">Photo Selection password</label>
                  <div className="relative">
                    <input id="edit-selection-password" name="pin" type={showSelectionPassword ? 'text' : 'password'} minLength={4} maxLength={64} autoComplete="new-password" autoCapitalize="none" spellCheck={false} onChange={(event) => setPendingPin(Boolean(event.currentTarget.value))} aria-describedby="client-pin-save-status" placeholder="New password" style={{ paddingRight: 48 }} className={inputClass} />
                    <button type="button" aria-label={showSelectionPassword ? 'Hide Photo Selection password' : 'Show Photo Selection password'} aria-pressed={showSelectionPassword} onClick={() => setShowSelectionPassword((current) => !current)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{showSelectionPassword ? <EyeOff size={15} aria-hidden="true" className="text-[var(--accent)]" /> : <Eye size={15} aria-hidden="true" />}</button>
                  </div>
                  <span id="client-pin-save-status" role="status" className="block text-xs leading-5 text-[var(--text-muted)]">
                    {pendingPin && <span className="block">New password not saved. Save Photo Selection to activate it.</span>}
                    <span className="block">Leave blank to keep the current password.</span>
                  </span>
                </div>
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
              {data.isExpired && !restartSelectionWindow && <button type="button" onClick={() => { setRestartSelectionWindow(true); syncFormDirty(true); }} className="mt-3 inline-flex min-h-11 items-center rounded-md border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Restart with current duration</button>}
            </fieldset>
          </form>
          <div hidden={mode !== 'selection'} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-4">
            <div><h3 className="text-sm font-semibold">Photo Selection access</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Unlock failed password attempts without changing the saved password.</p></div>
            <button type="button" disabled={busy} onClick={() => { setActionError(''); resetPin.mutate(data.id); }} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50">
              {resetPin.isPending ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <KeyRound size={15} aria-hidden="true" />} Unlock Selection Access
            </button>
          </div></>}
          <section hidden={mode !== 'edited'} aria-label="Edited photos publishing">
            <form id="edit-delivery-form" aria-busy={update.isPending} onInvalid={(event) => {
              if (event.target instanceof HTMLInputElement) setSaveError(`Changes not saved. ${event.target.validationMessage}`);
            }} onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setSaveError('');
              setActionError('');
              const form = new FormData(event.currentTarget);
              if (editResultsPassword.trim() && !String(form.get('editResultsFolderId') || '').trim()) {
                setSaveError('Add an Edited photos Drive folder before publishing.');
                return;
              }
              setPublishAfterSave(Boolean(editResultsPassword.trim()));
              update.mutate({
                id: data.id,
                editResultsStatus: !data.hasEditResults && editResultsPassword.trim() && editedStatus === 'open' ? 'draft' : editedStatus,
                editResultsFolderId: String(form.get('editResultsFolderId') || '').trim(),
                editResultsZipFileId: String(form.get('editResultsZipFileId') || '').trim(),
                editResultsAccessDurationHours: editAccessPreset === 'unlimited' ? null : editAccessPreset === 'custom' ? editCustomDays * 24 : Number(editAccessPreset),
                ...(deliveryOnly ? { title: String(form.get('title') || '').trim() } : { comparisonEnabled, ...(pairsDirty ? { comparisonPairs } : {}) }),
              });
            }}>
            <fieldset disabled={busy} onChange={(event) => {
              if (event.target instanceof HTMLInputElement && event.target.name === 'editResultsPassword') return;
              syncFormDirty(editedFormChanged(event.currentTarget.form || event.currentTarget as unknown as HTMLFormElement));
            }} className="min-w-0 space-y-4">
              <legend className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Edited Photos Delivery</legend>
              {deliveryOnly && <Field label="Gallery title"><input name="title" required defaultValue={data.title} className={inputClass} /></Field>}
              <Field label="Edited photos Drive folder">
                <input form="edit-delivery-form" name="editResultsFolderId" defaultValue={data.editResultsFolderId || ''} onChange={() => setFolderDirty(true)} placeholder="Folder URL or ID" className={inputClass} />
              </Field>
              <div className="min-w-0 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="editResultsZipFileId" className="block text-[11px] font-semibold text-[var(--text-secondary)]">Edited Photos ZIP <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
                  <span id="edited-zip-help" className="text-[10px] text-[var(--text-muted)]">Legacy full-gallery ZIP</span>
                </div>
                <input id="editResultsZipFileId" form="edit-delivery-form" name="editResultsZipFileId" defaultValue={data.editResultsZipFileId || ''} placeholder="Google Drive ZIP file URL or ID" aria-describedby="edited-zip-help" className={inputClass} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <label htmlFor="edit-results-publish-password" className="block text-[11px] font-semibold text-[var(--text-secondary)]">Password for publication</label>
                  <div className="relative">
                    <input id="edit-results-publish-password" name="editResultsPassword" type={showEditResultsPassword ? 'text' : 'password'} value={editResultsPassword} onChange={(event) => { const form = event.currentTarget.form; setEditResultsPassword(event.currentTarget.value.slice(0, 4)); setActionError(''); if (form) syncFormDirty(editedFormChanged(form, event.currentTarget.value)); }} maxLength={4} autoComplete="new-password" autoCapitalize="none" spellCheck={false} placeholder={data.hasEditResults ? 'New password' : 'Up to 4 characters'} aria-describedby="edit-results-publish-help" style={{ paddingRight: 48 }} className={inputClass} />
                    <button type="button" aria-label={showEditResultsPassword ? 'Hide password' : 'Show password'} title={showEditResultsPassword ? 'Hide password' : 'Show password'} aria-controls="edit-results-publish-password" onClick={() => setShowEditResultsPassword((current) => !current)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45">
                      {showEditResultsPassword ? <EyeOff size={15} aria-hidden="true" className="text-[var(--accent)]" /> : <Eye size={15} aria-hidden="true" />}
                    </button>
                  </div>
                  <p id="edit-results-publish-help" className="text-xs leading-5 text-[var(--text-muted)]">{editResultsPassword ? 'New password entered. Save Edited Photos to activate.' : 'Maximum 4 characters. Leave blank to keep the current password.'}</p>
                </div>
                <div className="min-w-0 space-y-4">
                  <Field label="Download access duration">
                    <select form="edit-delivery-form" name="editResultsAccessDurationHours" value={editAccessPreset} onChange={(event) => { setEditAccessPreset(event.currentTarget.value); markDirty(); }} className={inputClass}>
                      <option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option><option value="336">14 days</option><option value="custom">Custom</option><option value="unlimited">Unlimited</option>
                    </select>
                  </Field>
                  {editAccessPreset === 'custom' && <Field label="Custom duration (days)">
                    <input form="edit-delivery-form" name="editResultsCustomDays" type="number" min="1" max="3650" value={editCustomDays} onChange={(event) => { setEditCustomDays(Math.min(3650, Math.max(1, Number(event.currentTarget.value) || 1))); markDirty(); }} className={inputClass} />
                  </Field>}
                </div>
              </div>
              {!deliveryOnly && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/40 p-3.5 transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex cursor-pointer select-none items-center gap-3">
                      <div className="relative inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={comparisonEnabled}
                          onChange={(event) => setComparisonEnabled(event.target.checked)}
                          className="peer sr-only"
                        />
                        <div className="h-6 w-11 rounded-full border border-[var(--border)] bg-[var(--bg-deep)] transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2" />
                        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-[var(--text-muted)] transition-transform peer-checked:translate-x-5 peer-checked:bg-[var(--bg-deep)]" />
                      </div>
                      <div>
                        <span className="block text-xs font-semibold text-[var(--text-primary)]">Before &amp; After Comparison</span>
                        <span className="block text-[10px] text-[var(--text-muted)]">Show interactive slider for edited photos</span>
                      </div>
                    </label>
                    <button
                      ref={managePairsRef}
                      type="button"
                      disabled={!comparisonEnabled || folderDirty || !data.editResultsFolderId}
                      title={folderDirty ? 'Save the folder before managing pairs' : undefined}
                      onClick={() => setPairsOpen(true)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3.5 text-xs font-semibold text-[var(--text-secondary)] shadow-sm transition-all hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Images size={14} className="text-[var(--accent)]" />
                      <span>Manage Pairs</span>
                      {comparisonPairs.length > 0 && (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)]/15 px-1 text-[9px] font-bold text-[var(--accent)]">
                          {comparisonPairs.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
             </form>
            {publishWarnings.map((warning) => <p key={warning} role="status" className="mb-3 text-sm text-amber-600 dark:text-amber-400">{warning}</p>)}
            {mode === 'edited' && archivePreparation.data?.enabled && <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-3 text-xs text-[var(--text-secondary)]">
              <span>{archivePreparation.data.available === false ? 'ZIP preparation unavailable' : archivePreparation.data.ready ? `ZIPs ready (${archivePreparation.data.completed}/${archivePreparation.data.total})` : `Preparing ZIPs (${archivePreparation.data.completed}/${archivePreparation.data.total})${archivePreparation.data.failed ? `, ${archivePreparation.data.failed} failed` : ''}`}</span>
              {(archivePreparation.data.failed || archivePreparation.data.missing || archivePreparation.data.available === false) ? <button type="button" disabled={retryArchivePreparation.isPending} onClick={() => retryArchivePreparation.mutate()} className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50"><RefreshCw size={14} aria-hidden="true" className={retryArchivePreparation.isPending ? 'animate-spin' : undefined} />Retry ZIP preparation</button> : null}
            </div>}
          </section>
          <div hidden={mode !== 'edited'} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <div><h3 className="text-sm font-semibold">Edited Photos access</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Unlock failed password attempts without changing the published password.</p></div>
            <button type="button" disabled={busy} onClick={() => { setActionError(''); resetEdited.mutate(data.id); }} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50">
              {resetEdited.isPending ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <KeyRound size={15} aria-hidden="true" />} Unlock Edited Access
            </button>
          </div>
          {!deliveryOnly && <div hidden={mode !== 'selection'} className="border-t border-[var(--border)] pt-4">
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
          </div>}
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
  const listMode: GalleryMode = mode === 'wedding' ? 'edited' : 'selection';
  const queryMode: GalleryListMode = mode === 'wedding' ? 'wedding' : 'selection';
  const navigate = useNavigate({ from: '/galleries' });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [filter, setFilter] = useState<'all' | GalleryStatus>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<GallerySummary | null>(null);
  const [selectedMode, setSelectedMode] = useState<GalleryMode>('selection');
  const [focusSelectionDuration, setFocusSelectionDuration] = useState(false);
  const selectedId = selected?.id ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [pagePreviewDirty, setPagePreviewDirty] = useState(false);
  const [pagePreviewSaved, setPagePreviewSaved] = useState(false);
  const [pagePreviewSaving, setPagePreviewSaving] = useState(false);
  useEffect(() => { setFilter('all'); setPage(1); }, [mode]);
  useEffect(() => {
    if (!pagePreviewDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [pagePreviewDirty]);
  const query = useQuery({
    queryKey: ['galleries', queryMode, page, filter, debouncedSearch],
    queryFn: () => listGalleries({ mode: queryMode, page, pageSize: PAGE_SIZE, status: filter, search: debouncedSearch }),
    enabled: canManage && mode !== 'preview',
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === queryMode ? previousData : undefined,
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
      setSelectedMode(gallery.workflow === 'delivery_only' ? 'edited' : 'selection');
      setFocusSelectionDuration(false);
      setSelected(gallery);
      void navigate({ search: { mode: gallery.workflow === 'delivery_only' ? 'wedding' : 'selection' } });
      qc.invalidateQueries({ queryKey: ['galleries'] });
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to create gallery.', 'error'),
  });
  const statusUpdate = useMutation({
    mutationFn: updateGallery,
    onSuccess: async (_, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['gallery-detail'] }),
        qc.invalidateQueries({ queryKey: ['galleries'] }),
      ]);
      const areaLabel = variables.editResultsStatus !== undefined ? 'Edited Photos' : 'Photo Selection';
      addToast(`${areaLabel} set to ${variables.editResultsStatus ?? variables.status}.`, 'success');
    },
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to update gallery status.', 'error'),
  });
  const resetPin = useMutation({
    mutationFn: resetGalleryPinLock,
    onSuccess: () => addToast('Selection access unlocked.', 'success'),
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to unlock Selection access.', 'error'),
  });
  const resetEdited = useMutation({
    mutationFn: resetGalleryEditResultsLock,
    onSuccess: () => addToast('Edited Photos password attempts reset. The client can try again.', 'success'),
    onError: (error) => addToast(error instanceof Error ? error.message : 'Unable to unlock Edited Photos.', 'error'),
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
              onClick={() => mode === 'preview' ? void qc.invalidateQueries({ queryKey: ['gallery-contact'] }) : void query.refetch()}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-[10px] font-bold uppercase hover:border-[var(--accent)]"
            >
              <RefreshCw size={13} aria-hidden="true" className={clsx((query.isFetching || pagePreviewSaving) && 'animate-spin')} />
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
          if (mode === 'preview' && pagePreviewDirty && !window.confirm('Discard unsaved Preview Samples?')) return false;
          if (mode === 'preview') { setPagePreviewDirty(false); setPagePreviewSaved(false); }
          setFilter('all'); setPage(1); setSelected(null);
          void navigate({ search: { mode: next } });
          return true;
        }} />
        {mode === 'preview' ? <PreviewSamplesPage dirty={pagePreviewDirty} saved={pagePreviewSaved} saving={pagePreviewSaving} onDirtyChange={setPagePreviewDirty} onSavedChange={setPagePreviewSaved} onSavingChange={setPagePreviewSaving} /> : <section role="tabpanel" id="gallery-list-panel" aria-labelledby={`gallery-list-${mode}-tab`} className={`${PANEL_CARD_CLASS} overflow-clip !p-0`}>
          <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
            <GalleryFilters filter={filter} setFilter={changeFilter} scope={listMode} />
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
            <SectionHeading title={mode === 'wedding' ? 'Wedding' : 'Selection Events'} subtitle={`${pageItems.length} SHOWN / ${total} MATCHING`} />
            {mode === 'selection' && <p className="mt-2 text-xs text-[var(--text-muted)]">Prewedding, Siraman &amp; Sangjit</p>}
          </div>
          {query.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-[var(--accent)]" />
            </div>
          ) : query.isError ? (
            <div className="py-16 text-center text-rose-400">Unable to load galleries.</div>
          ) : (
            <GalleryTable
              mode={listMode}
              galleries={pageItems}
              selectedId={selectedId}
              onSelect={(id, area) => {
                setSelectedMode(area);
                setFocusSelectionDuration(false);
                setSelected(galleries.find((gallery) => gallery.id === id) ?? null);
              }}
              onExpiredOpen={(gallery) => {
                setSelectedMode('selection');
                setFocusSelectionDuration(true);
                setSelected(gallery);
              }}
              onStatusChange={(id, status, area) => statusUpdate.mutate(area === 'edited' ? { id, editResultsStatus: status } : { id, status })}
              onResetPin={(id) => resetPin.mutate(id)}
              onResetEdited={(id) => resetEdited.mutate(id)}
              onDelete={(gallery) => {
                if (window.confirm(`Delete "${gallery.title}"?`)) remove.mutate(gallery.id);
              }}
              onResetFilters={resetFilters}
              hasActiveFilters={Boolean(search.trim()) || filter !== 'all'}
              statusPendingId={statusUpdate.isPending ? statusUpdate.variables?.id ?? null : null}
              statusPendingArea={statusUpdate.isPending ? statusUpdate.variables?.editResultsStatus !== undefined ? 'edited' : 'selection' : null}
              statusPendingStatus={statusUpdate.isPending ? statusUpdate.variables?.editResultsStatus ?? statusUpdate.variables?.status ?? null : null}
              statusBusy={statusUpdate.isPending}
              resetPendingId={resetPin.isPending ? resetPin.variables ?? null : null}
              editedResetPendingId={resetEdited.isPending ? resetEdited.variables ?? null : null}
              deletePendingId={remove.isPending ? remove.variables ?? null : null}
            />
          )}
          {!query.isLoading && !query.isError && <Pager page={currentPage} totalPages={totalPages} total={total} limit={PAGE_SIZE} onChange={setPage} />}
        </section>}
      </div>
      {contactOpen && <ContactSettings close={() => setContactOpen(false)} />}
      {createOpen && <CreateGalleryModal close={() => setCreateOpen(false)} pending={create.isPending} error={create.error?.message} submit={(input) => create.mutate(input)} />}
      {selected && <GalleryDetail key={selected.id} mode={selectedMode} focusSelectionDuration={focusSelectionDuration} gallery={selected} close={() => { setSelected(null); setFocusSelectionDuration(false); }} />}
    </div>
  );
}
