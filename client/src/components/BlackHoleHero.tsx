import { memo, useEffect, useRef } from "react"
import clsx from "clsx"

type BlackHoleHeroProps = {
    className?: string
    contentClassName?: string
    parallax?: number
    style?: React.CSSProperties
}

function generateStars(count: number) {
    const stars = []
    for (let i = 0; i < count; i++) {
        stars.push({
            cx: Math.random() * 100,
            cy: Math.random() * 100,
            r: Math.random() * 2 + 0.5,
            opacity: Math.random() * 0.6 + 0.3,
            delay: Math.random() * 3
        })
    }
    return stars
}

const STARS = generateStars(80)
const PARTICLE_IDS = Array.from({ length: 12 }, (_, index) => index + 1)

function BlackHoleHero({ className, contentClassName, parallax = 0.6, style }: BlackHoleHeroProps) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = wrapRef.current
        const content = contentRef.current
        if (!el || !content) return
        const contentElement: HTMLDivElement = content

        const finePointer = window.matchMedia('(pointer: fine)')
        if (!finePointer.matches) return

        let raf = 0, mx = 0, my = 0, tx = 0, ty = 0
        let isActive = false
        let bounds = el.getBoundingClientRect()

        const startLoop = () => {
            if (!isActive) {
                isActive = true
                raf = requestAnimationFrame(loop)
            }
        }

        const updateBounds = () => {
            bounds = el.getBoundingClientRect()
        }

        const onMove = (e: PointerEvent) => {
            mx = ((e.clientX - bounds.left) / bounds.width - 0.5) * 2
            my = ((e.clientY - bounds.top) / bounds.height - 0.5) * 2
            startLoop()
        }

        const onLeave = () => {
            mx = 0; my = 0
            startLoop()
        }

        function loop() {
            tx += (mx - tx) * 0.05
            ty += (my - ty) * 0.05

            const settled = Math.abs(mx - tx) < 0.001 && Math.abs(my - ty) < 0.001
            if (settled) {
                tx = mx
                ty = my
            }

            if (tx === 0 && ty === 0) {
                contentElement.style.transform = "none"
            } else {
                const s = 15 * parallax
                contentElement.style.transform = `translate3d(${tx * s}px, ${ty * s * 0.5}px, 0) rotateZ(${tx * 3}deg) rotateX(${ty * -2}deg)`
            }

            if (settled) {
                isActive = false
                raf = 0
                return
            }

            raf = requestAnimationFrame(loop)
        }

        const onVisibilityChange = () => {
            if (!document.hidden) return
            cancelAnimationFrame(raf)
            raf = 0
            isActive = false
            mx = 0
            my = 0
            tx = 0
            ty = 0
            contentElement.style.transform = "none"
        }

        const resizeObserver = new ResizeObserver(updateBounds)
        resizeObserver.observe(el)
        el.addEventListener("pointerenter", updateBounds, { passive: true })
        el.addEventListener("pointermove", onMove, { passive: true })
        el.addEventListener("pointerleave", onLeave, { passive: true })
        document.addEventListener("visibilitychange", onVisibilityChange)

        return () => {
            resizeObserver.disconnect()
            el.removeEventListener("pointerenter", updateBounds)
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerleave", onLeave)
            document.removeEventListener("visibilitychange", onVisibilityChange)
            cancelAnimationFrame(raf)
        }
    }, [parallax])

    useEffect(() => {
        const el = wrapRef.current
        if (!el) return

        let isVisible = true

        const syncPlayback = () => {
            el.classList.toggle("blackhole-paused", document.hidden || !isVisible)
        }

        const observer = new IntersectionObserver(([entry]) => {
            isVisible = entry.isIntersecting
            syncPlayback()
        }, { rootMargin: "80px" })

        observer.observe(el)
        document.addEventListener("visibilitychange", syncPlayback)
        syncPlayback()

        return () => {
            observer.disconnect()
            document.removeEventListener("visibilitychange", syncPlayback)
        }
    }, [])

    return (
        <div ref={wrapRef} className={clsx("blackhole-space", className)} style={style}>
            <div className="stars-container">
                {STARS.map((star, i) => (
                    <div key={i} className="star" style={{
                        left: `${star.cx}%`, top: `${star.cy}%`,
                        width: `${star.r}px`, height: `${star.r}px`,
                        opacity: star.opacity, animationDelay: `${star.delay}s`
                    }} />
                ))}
            </div>

            <div ref={contentRef} className={clsx("blackhole-content", contentClassName)}>
                <div className="gargantua">
                    <div className="orbit-lines">
                        <div className="orbit orbit-1" />
                        <div className="orbit orbit-2" />
                        <div className="orbit orbit-3" />
                    </div>
                    <div className="bot-photon-ring" />
                    <div className="image-disk" />
                    <div className="image-disk-lines" />
                    <div className="accretion-disk" />
                    <div className="top-photon-ring" />
                    <div className="particles">
                        {PARTICLE_IDS.map(id => <div key={id} className={`particle particle-${id}`} />)}
                    </div>
                </div>
            </div>


            <style>{`
                .blackhole-interaction-shell {
                    background: radial-gradient(ellipse at 30% 50%, #0a0606 0%, #030408 48%, #000 100%);
                    transition: background-color 0.3s ease;
                }
                .light .blackhole-interaction-shell {
                    background: var(--bg-deep);
                }
                @media (max-width: 1023px) {
                    .blackhole-interaction-shell {
                        background: radial-gradient(ellipse at 50% 18%, #0a0606 0%, #030408 40%, #000 78%);
                    }
                }

                .blackhole-space {
                    --white: #fffff2;
                    --yellow: #fffcb7;
                    --yellow-rgb: 255, 252, 183;
                    --white-bright: #fff;
                    --yellow-bright: #ffffdc;
                    --black: #000;
                    --star-color: #fff;
                    position: relative; width: 100%; height: 100%;
                    background: transparent;
                    overflow: hidden; perspective: 1000px;
                    transition: background 0.5s ease;
                    contain: layout paint style;
                    isolation: isolate;
                }
                .blackhole-space.blackhole-paused,
                .blackhole-space.blackhole-paused * {
                    animation-play-state: paused !important;
                }
                .blackhole-interaction-shell:focus-within .blackhole-space .orbit,
                .blackhole-interaction-shell:focus-within .blackhole-space .bot-photon-ring,
                .blackhole-interaction-shell:focus-within .blackhole-space,
                .blackhole-interaction-shell:focus-within .blackhole-space * {
                    animation-play-state: paused !important;
                }

                /* ---- LIGHT MODE OVERRIDES ---- */
                .light .blackhole-space {
                    --white: #010101;
                    --yellow: #070707;
                    --yellow-rgb: 7, 7, 7;
                    --white-bright: #010101;
                    --yellow-bright: #080808;
                    --black: #fff;
                    --star-color: #000;
                    background: transparent;
                }
                /* ---- END LIGHT MODE OVERRIDES ---- */

                .stars-container { position: absolute; inset: 0; pointer-events: none; }
                .star {
                    position: absolute; background: var(--star-color); border-radius: 50%;
                    animation: twinkle 3s ease-in-out infinite;
                }
                @keyframes twinkle {

                    0%, 100% { opacity: 0.3; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.2); }
                }
                .blackhole-content {
                    position: absolute; inset: 0; display: flex;
                    justify-content: center; align-items: center;
                    transition: transform 0.1s ease-out;
                    will-change: transform;
                }

                /* RESPONSIVE GARGANTUA */
                .gargantua {
                    --gargantua-scale: 0.7;

                    width: 70vmin;
                    height: 50vmin;

                    display: flex;
                    justify-content: center;
                    align-items: center;

                    position: relative;

                    animation: float 8s ease-in-out infinite;
                }

                /* Tablet */
                @media (min-width: 640px) {
                    .gargantua {
                        --gargantua-scale: 0.85;
                        width: 80vmin;
                        height: 55vmin;
                    }
                }

                /* Desktop */
                @media (min-width: 1024px) {
                    .gargantua {
                        --gargantua-scale: 1;
                        width: 90vmin;
                        height: 60vmin;
                    }
                }

                @keyframes float {
                    0%,
                    100% {
                        transform: rotate(-5deg)
                            translateY(0)
                            scale(var(--gargantua-scale));
                    }

                    50% {
                        transform: rotate(-5deg)
                            translateY(-10px)
                            scale(var(--gargantua-scale));
                    }
                }

                .gargantua > div {
                    position: absolute;
                }

                /* Orbits - responsive */
                .orbit-lines { position: absolute; width: 100%; height: 100%; animation: spin 60s linear infinite; }
                @keyframes spin { from { transform: rotateZ(0deg); } to { transform: rotateZ(360deg); } }
                .orbit {
                    position: absolute; border: 1px solid rgba(var(--yellow-rgb), 0.15);
                    border-radius: 50%; left: 50%; top: 50%; transform: translate(-50%,-50%);
                }
                .orbit-1 { width: 55vmin; height: 8vmin; animation: pulse 4s ease-in-out infinite; }
                .orbit-2 { width: 65vmin; height: 10vmin; animation: pulse 5s ease-in-out infinite 0.5s; }
                .orbit-3 { width: 75vmin; height: 12vmin; animation: pulse 6s ease-in-out infinite 1s; }
                
                @media (min-width: 1024px) {
                    .orbit-1 { width: 65vmin; height: 10vmin; }
                    .orbit-2 { width: 75vmin; height: 12vmin; }
                    .orbit-3 { width: 85vmin; height: 14vmin; }
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 0.1; border-color: rgba(var(--yellow-rgb), 0.1); }
                    50% { opacity: 0.3; border-color: rgba(var(--yellow-rgb), 0.3); }
                }

                /* Photon rings - responsive */
                .bot-photon-ring {
                    width: 14vmin; height: 8vmin;
                    border-radius: 1vmin 1vmin 16vmin 16vmin;
                    top: 23vmin; border: 1.5px solid var(--white); border-top: 0;
                    background: var(--black); margin-left: 0.6vmin;
                    box-shadow: 0 0 4px 1.5px var(--black), 0 0 4px 1.5px var(--yellow), 0 -2px 8px -2px var(--yellow) inset;
                    animation: photon 3s ease-in-out infinite;
                }
                
                @media (min-width: 1024px) {
                    .bot-photon-ring {
                        width: 18vmin; height: 10vmin;
                        border-radius: 1vmin 1vmin 20vmin 20vmin;
                        top: 28.5vmin; border-width: 2px; margin-left: 0.75vmin;
                        box-shadow: 0 0 5px 2px var(--black), 0 0 5px 2px var(--yellow), 0 -3px 10px -3px var(--yellow) inset;
                    }
                }
                
                @keyframes photon {
                    0%, 100% { box-shadow: 0 0 5px 2px var(--black), 0 0 5px 2px var(--yellow), 0 -3px 10px -3px var(--yellow) inset; }
                    50% { box-shadow: 0 0 5px 2px var(--black), 0 0 15px 5px var(--yellow), 0 -3px 15px -3px var(--yellow) inset; }
                }

                /* Image disk - responsive */
                .image-disk {
                    width: 17vmin; height: 17vmin; border-radius: 100%; top: 15.5vmin;
                    border: 1.5vmin solid var(--white);
                    box-shadow: 0 0 12px 2px var(--yellow), 0 0 4px 1.5px var(--yellow) inset, 0 0 20px 8px rgba(var(--yellow-rgb), 0.3);
                    animation: glow 4s ease-in-out infinite;
                }
                
                @media (min-width: 1024px) {
                    .image-disk {
                        width: 22vmin; height: 22vmin; top: 19vmin;
                        border-width: 2vmin;
                        box-shadow: 0 0 15px 3px var(--yellow), 0 0 5px 2px var(--yellow) inset, 0 0 30px 10px rgba(var(--yellow-rgb), 0.3);
                    }
                }
                
                @keyframes glow {
                    0%, 100% { box-shadow: 0 0 15px 3px var(--yellow), 0 0 5px 2px var(--yellow) inset, 0 0 30px 10px rgba(var(--yellow-rgb), 0.3); }
                    50% { box-shadow: 0 0 25px 8px var(--yellow), 0 0 10px 4px var(--yellow) inset, 0 0 50px 20px rgba(var(--yellow-rgb), 0.5); }
                }
                
                .image-disk:before, .image-disk:after {
                    content: ""; position: absolute;
                    left: -4vmin; top: 3vmin;
                    width: 2.8vmin; height: 3.5vmin;
                    border-radius: 0 0 28px 8px; transform: rotate(23deg);
                    box-shadow: 12px 1.5px 0 0.5px var(--white);
                }
                .image-disk:after { left: 15.5vmin; transform: rotateY(180deg) rotateZ(23deg); }
                
                @media (min-width: 1024px) {
                    .image-disk:before, .image-disk:after {
                        left: -5.365vmin; top: 3.85vmin;
                        width: 3.5vmin; height: 4.5vmin;
                        border-radius: 0 0 34px 10px;
                        box-shadow: 16px 2px 0 1px var(--white);
                    }
                    .image-disk:after { left: 19.885vmin; }
                }

                /* Image disk lines - responsive */
                .image-disk-lines {
                    width: 17vmin; height: 17vmin; border-radius: 100%; top: 15.5vmin;
                    background: radial-gradient(circle at 50% 50%,
                        transparent, transparent 7.2vmin,
                        var(--yellow) 7.4vmin, var(--yellow) 7.44vmin,
                        var(--white) 7.44vmin, var(--white) 7.75vmin,
                        var(--yellow) 7.75vmin, var(--yellow) 7.83vmin,
                        var(--white) 7.83vmin, var(--white) 8.1vmin,
                        var(--yellow) 8.1vmin, var(--yellow) 8.15vmin,
                        var(--white) 8.15vmin, var(--white) 8.4vmin,
                        transparent 8.5vmin
                    );
                    animation: linesRot 20s linear infinite;
                }
                
                @media (min-width: 1024px) {
                    .image-disk-lines {
                        width: 22vmin; height: 22vmin; top: 19vmin;
                        background: radial-gradient(circle at 50% 50%,
                            transparent, transparent 9.25vmin,
                            var(--yellow) 9.5vmin, var(--yellow) 9.55vmin,
                            var(--white) 9.55vmin, var(--white) 9.95vmin,
                            var(--yellow) 9.95vmin, var(--yellow) 10.05vmin,
                            var(--white) 10.05vmin, var(--white) 10.35vmin,
                            var(--yellow) 10.35vmin, var(--yellow) 10.42vmin,
                            var(--white) 10.42vmin, var(--white) 10.75vmin,
                            var(--yellow) 10.75vmin, var(--yellow) 10.79vmin,
                            var(--white) 10.79vmin, var(--white) 10.95vmin,
                            transparent 11vmin
                        );
                    }
                }
                
                @keyframes linesRot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

                /* Accretion disk - responsive */
                .accretion-disk {
                    background:
                        radial-gradient(ellipse at 49.5% 40%,
                            transparent, transparent 8.7vmin,
                            var(--white) 8.7vmin, var(--yellow) 8.7vmin,
                            var(--yellow) 8.75vmin, var(--white) 8.75vmin,
                            var(--white) 9.75vmin, var(--yellow) 9.75vmin,
                            var(--yellow) 9.85vmin, var(--white) 9.85vmin,
                            var(--white) 10.5vmin, var(--yellow) 10.5vmin,
                            var(--yellow) 10.55vmin, var(--white) 10.55vmin,
                            var(--white) 11.25vmin, var(--yellow) 11.25vmin,
                            var(--yellow) 11.35vmin, var(--white) 11.35vmin,
                            var(--white) 12.1vmin, var(--yellow) 12.1vmin,
                            var(--yellow) 12.2vmin, var(--white) 12.2vmin,
                            transparent 13vmin
                        ),
                        radial-gradient(ellipse at 49.5% 37%,
                            var(--black), var(--black) 7.2vmin,
                            var(--white) 7.4vmin, var(--white)
                        );
                    width: 42vmin; height: 4.5vmin; border-radius: 100%; top: 23vmin;
                    box-shadow: 0 0 2px 0 var(--white), 0 0 10px 2px var(--yellow), 0 10px 8px 8px var(--black);
                    animation: accretion 5s ease-in-out infinite;
                }
                
                @media (min-width: 1024px) {
                    .accretion-disk {
                        background:
                            radial-gradient(ellipse at 49.5% 40%,
                                transparent, transparent 11.15vmin,
                                var(--white) 11.15vmin, var(--yellow) 11.15vmin,
                                var(--yellow) 11.2vmin, var(--white) 11.2vmin,
                                var(--white) 12.5vmin, var(--yellow) 12.5vmin,
                                var(--yellow) 12.65vmin, var(--white) 12.65vmin,
                                var(--white) 13.5vmin, var(--yellow) 13.5vmin,
                                var(--yellow) 13.55vmin, var(--white) 13.55vmin,
                                var(--white) 14.45vmin, var(--yellow) 14.45vmin,
                                var(--yellow) 14.55vmin, var(--white) 14.55vmin,
                                var(--white) 15.5vmin, var(--yellow) 15.5vmin,
                                var(--yellow) 15.65vmin, var(--white) 15.65vmin,
                                var(--white) 16.5vmin, var(--yellow) 16.5vmin,
                                var(--yellow) 16.65vmin, var(--white) 16.65vmin,
                                var(--white) 17.6vmin, var(--yellow) 17.6vmin,
                                var(--yellow) 17.65vmin, var(--white) 17.65vmin,
                                var(--white) 18.25vmin, var(--yellow) 18.25vmin,
                                var(--yellow) 18.35vmin, var(--white) 18.35vmin,
                                transparent 19vmin
                            ),
                            radial-gradient(ellipse at 49.5% 37%,
                                var(--black), var(--black) 9.25vmin,
                                var(--white) 9.5vmin, var(--white)
                            );
                        width: 54vmin; height: 6vmin; top: 28.5vmin;
                        box-shadow: 0 0 3px 0 var(--white), 0 0 15px 3px var(--yellow), 0 15px 10px 10px var(--black);
                    }
                }
                
                @keyframes accretion {
                    0%, 100% { box-shadow: 0 0 3px 0 var(--white), 0 0 15px 3px var(--yellow), 0 15px 10px 10px var(--black); }
                    50% { box-shadow: 0 0 8px 2px var(--white-bright), 0 0 25px 8px var(--yellow-bright), 0 15px 10px 10px var(--black); }
                }

                /* Top photon ring - responsive */
                .top-photon-ring {
                    width: 13vmin; height: 7vmin;
                    border-radius: 16vmin 16vmin 1vmin 1vmin;
                    background: var(--black); top: 17.5vmin;
                    box-shadow: 0 4px 0 1.5px var(--black), -2px 4px 0 1.5px var(--black), 3px 4px 0 1.5px var(--black), -1.5px 2px 2px 0 var(--yellow);
                }
                
                @media (min-width: 1024px) {
                    .top-photon-ring {
                        width: 17vmin; height: 9vmin;
                        border-radius: 20vmin 20vmin 1vmin 1vmin;
                        top: 21.5vmin;
                        box-shadow: 0 5px 0 2px var(--black), -3px 5px 0 2px var(--black), 4px 5px 0 2px var(--black), -2px 3px 3px 0 var(--yellow);
                    }
                }
                
                .top-photon-ring:before {
                    content: ""; width: 14vmin; height: 2.5vmin;
                    background: var(--black); left: -0.4vmin; border-radius: 100%;
                    bottom: -6vmin; box-shadow: 0 0 1px 1px var(--black);
                    position: relative; display: block;
                }
                
                @media (min-width: 1024px) {
                    .top-photon-ring:before {
                        width: 18vmin; height: 3vmin;
                        left: -0.5vmin; bottom: -7.6vmin;
                    }
                }

                /* Particles - hide some on mobile */
                .particles { position: absolute; width: 100%; height: 100%; pointer-events: none; }
                .particle {
                    position: absolute; width: 2px; height: 2px;
                    background: var(--yellow); border-radius: 50%;
                    box-shadow: 0 0 4px 1.5px var(--yellow);
                    animation: pFloat 8s ease-in-out infinite;
                }
                
                @media (min-width: 1024px) {
                    .particle { width: 3px; height: 3px; box-shadow: 0 0 5px 2px var(--yellow); }
                }
                
                .particle-1 { left: 10%; top: 30%; } 
                .particle-2 { left: 85%; top: 25%; animation-delay: 0.5s; }
                .particle-3 { left: 15%; top: 65%; animation-delay: 1s; } 
                .particle-4 { left: 80%; top: 70%; animation-delay: 1.5s; }
                .particle-5 { left: 25%; top: 20%; animation-delay: 2s; display: none; } 
                .particle-6 { left: 75%; top: 40%; animation-delay: 2.5s; display: none; }
                .particle-7 { left: 30%; top: 75%; animation-delay: 3s; display: none; } 
                .particle-8 { left: 70%; top: 55%; animation-delay: 3.5s; display: none; }
                .particle-9 { left: 5%; top: 50%; animation-delay: 4s; display: none; } 
                .particle-10 { left: 95%; top: 45%; animation-delay: 4.5s; display: none; }
                .particle-11 { left: 40%; top: 15%; animation-delay: 5s; display: none; } 
                .particle-12 { left: 60%; top: 80%; animation-delay: 5.5s; display: none; }
                
                @media (min-width: 1024px) {
                    .particle-5, .particle-6, .particle-7, .particle-8,
                    .particle-9, .particle-10, .particle-11, .particle-12 { display: block; }
                }
                
                @keyframes pFloat {
                    0%, 100% { transform: translate3d(0,0,0) scale(1); opacity: 0.5; }
                    25% { transform: translate3d(20px,-30px,0) scale(1.5); opacity: 1; }
                    50% { transform: translate3d(-10px,-50px,0) scale(0.8); opacity: 0.7; }
                    75% { transform: translate3d(-30px,-20px,0) scale(1.2); opacity: 0.9; }
                }
            `}</style>
        </div>
    )
}

export default memo(BlackHoleHero)
