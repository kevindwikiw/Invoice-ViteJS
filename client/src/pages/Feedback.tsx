import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, CheckCircle2, Loader2, Moon, Star, Sun, X } from 'lucide-react';
import orbitLogo from '../assets/pdf/logo.png';
import { FEEDBACK_TAGS, submitPublicFeedback, type FeedbackTag, type PublicFeedbackInput } from '../features/feedback/data';
import { useDarkMode } from '../hooks/useDarkMode';

const RATINGS = [1, 2, 3, 4, 5] as const;
const RATING_REACTIONS: Record<(typeof RATINGS)[number], { emoji: string; label: string }> = {
    1: { emoji: '😕', label: 'Could be better' },
    2: { emoji: '🙂', label: 'Okay' },
    3: { emoji: '😊', label: 'Good' },
    4: { emoji: '✨', label: 'Great!' },
    5: { emoji: '🥰', label: 'Absolutely amazing!' },
};
const MAX_SOURCE_PHOTO_BYTES = 20_000_000;

function PublicPageHeader({ darkMode, toggleTheme }: { darkMode: boolean; toggleTheme: () => void }) {
    return (
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3 sm:px-8 sm:py-6">
            <img src={orbitLogo} alt="Orbit" width={792} height={296} className="h-auto w-24 object-contain sm:w-32 lg:w-36" style={{ filter: darkMode ? 'none' : 'invert(1)' }} />
            <button type="button" onClick={toggleTheme} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]" aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
                {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
        </header>
    );
}

function PolaroidStack({ loading }: { loading: boolean }) {
    return (
        <span className="relative h-[72px] w-[82px] shrink-0 [perspective:500px]" aria-hidden="true">
            <span className="absolute left-2 top-2 h-[58px] w-[46px] -rotate-[11deg] border border-black/10 bg-[#ded8ca] shadow-md transition-transform duration-300 ease-out group-hover:-translate-x-1.5 group-hover:-rotate-[15deg] motion-reduce:transition-none" />
            <span className="absolute right-1 top-1.5 h-[59px] w-[47px] rotate-[10deg] border border-black/10 bg-[#eee9de] shadow-md transition-transform duration-300 ease-out group-hover:translate-x-1.5 group-hover:rotate-[14deg] motion-reduce:transition-none" />
            <span className="absolute left-[17px] top-0 flex h-[64px] w-[50px] -rotate-2 flex-col bg-[#faf7ef] p-1 pb-2 shadow-[0_10px_24px_rgba(0,0,0,0.24)] transition-transform duration-300 ease-out [transform-style:preserve-3d] group-hover:-translate-y-1 group-hover:rotate-0 group-hover:scale-[1.04] motion-reduce:transition-none">
                <span className="flex flex-1 items-center justify-center bg-[#27231c] text-[#d1b46c]">
                    {loading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                </span>
                <span className="mx-auto mt-1 h-px w-5 bg-black/20" />
            </span>
        </span>
    );
}

async function preparePhoto(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error('Choose a photo smaller than 20 MB.');
    return file;
}

export default function Feedback() {
    const [darkMode, setDarkMode] = useDarkMode();
    const [clientName, setClientName] = useState('');
    const [rating, setRating] = useState<PublicFeedbackInput['rating'] | 0>(0);
    const [hoverRating, setHoverRating] = useState<PublicFeedbackInput['rating'] | 0>(0);
    const [tags, setTags] = useState<FeedbackTag[]>([]);
    const [note, setNote] = useState('');
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState('');
    const [preparingPhoto, setPreparingPhoto] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const ratingRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const photoInputRef = useRef<HTMLInputElement | null>(null);
    const previewUrlRef = useRef('');

    useEffect(() => () => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    }, []);

    const selectRating = (value: PublicFeedbackInput['rating']) => {
        setRating(value);
        setError('');
    };

    const handleRatingKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = RATINGS.length - 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextIndex = (index - 1 + RATINGS.length) % RATINGS.length;
        else nextIndex = (index + 1) % RATINGS.length;
        selectRating(RATINGS[nextIndex]);
        ratingRefs.current[nextIndex]?.focus();
    };

    const toggleTag = (tag: FeedbackTag) => {
        if (tags.includes(tag)) {
            setTags(tags.filter((item) => item !== tag));
            setError('');
            return;
        }
        if (tags.length >= 3) return;
        setTags([...tags, tag]);
        setError('');
    };

    const replacePhoto = (nextPhoto: File | null) => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const nextUrl = nextPhoto ? URL.createObjectURL(nextPhoto) : '';
        previewUrlRef.current = nextUrl;
        setPhoto(nextPhoto);
        setPhotoPreview(nextUrl);
    };

    const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selected = event.target.files?.[0];
        event.target.value = '';
        if (!selected) return;
        setPreparingPhoto(true);
        setError('');
        try {
            replacePhoto(await preparePhoto(selected));
        } catch (photoError) {
            setError(photoError instanceof Error ? photoError.message : 'Unable to prepare this photo.');
        } finally {
            setPreparingPhoto(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!rating) {
            setError('Choose a rating before submitting.');
            return;
        }
        setError('');
        setSubmitting(true);
        try {
            await submitPublicFeedback({ clientName, rating, tags, note, photo });
            setSubmitted(true);
        } catch (submissionError) {
            setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit feedback.');
        } finally {
            setSubmitting(false);
        }
    };

    const previewRating = hoverRating || rating;
    const tagLimitReached = tags.length === 3;

    return (
        <div className="min-h-[100svh] overflow-x-hidden bg-[var(--bg-deep)] text-[var(--text-primary)]">
            <PublicPageHeader darkMode={darkMode} toggleTheme={() => setDarkMode((current) => !current)} />
            <main className="mx-auto grid w-full max-w-6xl px-5 pb-8 pt-1 sm:px-8 sm:pt-3 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16 lg:pb-16 lg:pt-6">
                <section className="border-b border-[var(--border)] pb-5 lg:min-h-[650px] lg:border-b-0 lg:border-r lg:pb-0 lg:pr-14">
                    <p className="label-xs mb-5 hidden text-[var(--accent)] lg:block">ORBIT CLIENT EXPERIENCE</p>
                    <h1 aria-label="How was it working with us?" className="max-w-md font-display text-[2.5rem] font-medium leading-[0.96] tracking-[-0.035em] text-[var(--text-primary)] md:text-5xl lg:text-[3.75rem]">
                        <span className="block">How was it</span>
                        <span className="block">working with us?</span>
                    </h1>
                    <p className="mt-3 max-w-[19rem] text-xs leading-5 text-[var(--text-muted)] md:mt-5 md:max-w-sm md:text-sm md:leading-6">Tap the tags that match your vibe, then leave a note if you'd like.</p>
                </section>

                <section className="pt-5 md:pt-6 lg:pt-0">
                    {submitted ? (
                        <div className="flex min-h-[390px] flex-col items-start justify-center" role="status">
                            <span className="mb-7 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Check size={22} /></span>
                            <p className="label-xs text-[var(--accent)]">RESPONSE RECEIVED</p>
                            <h2 className="mt-4 font-display text-3xl font-medium text-[var(--text-primary)]">Thank you for sharing.</h2>
                            <p className="mt-4 max-w-md text-sm leading-7 text-[var(--text-muted)]">Your note has been shared privately with the Orbit team.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-[22px] md:space-y-6" noValidate>
                            <div className="hidden lg:block">
                                <p className="label-xs text-[var(--accent)]">A NOTE FROM YOUR SIDE</p>
                                <h2 className="mt-3 font-display text-2xl font-medium text-[var(--text-primary)] sm:text-3xl">Your experience, in your words.</h2>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-baseline gap-2">
                                    <label htmlFor="feedback-name" className="label-xs text-[var(--text-muted)]">Your names</label>
                                    <span className="text-[10px] font-normal tracking-normal text-[var(--text-muted)]">optional</span>
                                </div>
                                <p className="text-[10px] leading-4 text-[var(--text-muted)]">Stay anonymous if you prefer — we'd love to know your names. ✨</p>
                                <input id="feedback-name" type="text" value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={80} autoComplete="name" placeholder="e.g. Jack & Rose" className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 text-sm leading-5 text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] md:h-12" />
                            </div>

                            <fieldset>
                                <legend className="flex items-baseline gap-2"><span className="label-xs text-[var(--text-muted)]">Overall rating</span><span className="text-[10px] font-normal tracking-normal text-[var(--text-muted)]">required</span></legend>
                                <div className="mt-3 flex items-center gap-2" role="radiogroup" aria-label="Overall rating" onMouseLeave={() => setHoverRating(0)}>
                                    {RATINGS.map((value, index) => {
                                        const active = value <= previewRating;
                                        return (
                                            <button key={value} ref={(element) => { ratingRefs.current[index] = element; }} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} stars, ${RATING_REACTIONS[value].label}`} tabIndex={rating === value || (!rating && value === 1) ? 0 : -1} onClick={() => selectRating(value)} onMouseEnter={() => setHoverRating(value)} onFocus={() => setHoverRating(value)} onBlur={() => setHoverRating(0)} onKeyDown={(event) => handleRatingKey(event, index)} className={`flex h-11 w-11 items-center justify-center rounded-lg border transition-[transform,color,border-color,background-color] duration-150 active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:h-12 sm:w-12 ${active ? 'scale-[1.04] border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50'}`}>
                                                <Star size={18} fill={active ? 'currentColor' : 'none'} />
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-2.5 min-h-7" aria-live="polite">
                                    {previewRating ? (
                                        <div key={previewRating} className="feedback-rating-reaction inline-flex items-center gap-2 text-xs font-medium text-[var(--accent)]">
                                            <span className="text-lg leading-none" aria-hidden="true">{RATING_REACTIONS[previewRating].emoji}</span>
                                            <span>{RATING_REACTIONS[previewRating].label}</span>
                                        </div>
                                    ) : <span className="text-[10px] text-[var(--text-muted)]">Tap a star to rate your experience.</span>}
                                </div>
                            </fieldset>

                            <fieldset>
                                <div className="flex items-center justify-between gap-4">
                                    <legend className="label-xs text-[var(--text-muted)]">What matched your vibe?</legend>
                                    <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{tags.length} / 3 selected</span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {FEEDBACK_TAGS.map((tag) => {
                                        const active = tags.includes(tag);
                                        const disabled = tagLimitReached && !active;
                                        return (
                                            <button key={tag} type="button" aria-pressed={active} disabled={disabled} onClick={() => toggleTag(tag)} className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[10px] font-semibold leading-4 transition-[transform,color,border-color,background-color,opacity] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${active ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : disabled ? 'cursor-not-allowed border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] opacity-35' : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--text-primary)]'}`}>
                                                {active && <CheckCircle2 size={13} className="shrink-0" />}
                                                <span>{tag}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-baseline gap-2"><label htmlFor="feedback-note" className="label-xs text-[var(--text-muted)]">Anything else you'd like to share?</label><span className="text-[10px] font-normal tracking-normal text-[var(--text-muted)]">optional</span></div>
                                    <span className="text-[8px] tabular-nums text-[var(--text-muted)] opacity-75">{note.length} / 1000</span>
                                </div>
                                <textarea id="feedback-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1_000} rows={3} placeholder="A favorite moment, a team shout-out, or something we could improve." className="h-[5.5rem] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm leading-5 text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] md:h-28" />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-baseline gap-2">
                                    <span className="label-xs text-[var(--text-muted)]">A photo from your day</span>
                                    <span className="text-[10px] font-normal tracking-normal text-[var(--text-muted)]">optional</span>
                                </div>
                                <p className="max-w-lg text-[10px] leading-[1.65] text-[var(--text-muted)]">Share a happy selfie together — rings welcome. We'd love to print it for our private Polaroid board, a little memory of every couple who shared their story with us.</p>
                                <input ref={photoInputRef} type="file" accept="image/*,.heic,.heif" onChange={handlePhoto} className="hidden" aria-label="Choose a photo from your day" />
                                {photo && photoPreview ? (
                                    <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                                        <span className="relative h-[68px] w-[56px] shrink-0 -rotate-2 bg-[#faf7ef] p-1 pb-3 shadow-[0_8px_20px_rgba(0,0,0,0.2)]">
                                            <img src={photoPreview} alt="Selected memory preview" className="h-full w-full object-cover" />
                                            <span className="absolute bottom-1.5 left-1/2 h-px w-5 -translate-x-1/2 bg-black/20" aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{photo.name}</p>
                                            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">Ready for the Orbit Polaroid board · {Math.ceil(photo.size / 1024)} KB</p>
                                        </div>
                                        <button type="button" onClick={() => photoInputRef.current?.click()} className="hidden h-9 shrink-0 items-center rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] sm:flex">Replace</button>
                                        <button type="button" onClick={() => replacePhoto(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-rose-400/40 hover:text-rose-400" aria-label="Remove selected photo"><X size={15} /></button>
                                    </div>
                                ) : (
                                    <button type="button" disabled={preparingPhoto} onClick={() => photoInputRef.current?.click()} className="group flex min-h-24 w-full items-center gap-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-left transition-[transform,border-color,background-color] duration-200 hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated)] active:scale-[0.99] disabled:opacity-50">
                                        <PolaroidStack loading={preparingPhoto} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-display text-lg leading-tight text-[var(--text-primary)]">Choose your photo</span>
                                            <span className="mt-1.5 block text-[10px] leading-4 text-[var(--text-muted)]">We'll prepare it for our Polaroid board.</span>
                                        </span>
                                        <ArrowRight size={15} className="shrink-0 text-[var(--accent)] transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none" />
                                    </button>
                                )}
                            </div>

                            {error && <p className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-400" role="alert">{error}</p>}
                            <button type="submit" disabled={submitting || preparingPhoto} className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[var(--accent)] px-6 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--bg-deep)] transition-[transform,opacity] active:scale-[0.99] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 md:h-12">
                                {submitting ? <Loader2 size={17} className="animate-spin" /> : <>Send feedback <ArrowRight size={17} /></>}
                            </button>
                        </form>
                    )}
                </section>
            </main>
        </div>
    );
}
