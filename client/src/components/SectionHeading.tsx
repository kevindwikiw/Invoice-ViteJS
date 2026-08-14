interface SectionHeadingProps {
    title: string;
    subtitle: string;
    className?: string;
}

export function SectionHeading({ title, subtitle, className = '' }: SectionHeadingProps) {
    return (
        <div className={`border-l-2 border-[var(--accent)] pl-4 ${className}`}>
            <h2 className="font-display text-xl font-medium tracking-tight text-[var(--text-primary)]">
                {title}
            </h2>
            <div className="label-xs mt-1 tracking-[0.2em] text-[var(--accent)]">
                {subtitle}
            </div>
        </div>
    );
}
