import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { LANDING_CONFIG } from '../config/landing'

const navigation = [
  { label: 'Wedding', to: '/wedding-photographer-jakarta' },
  { label: 'Prewedding', to: '/prewedding-bali' },
  { label: 'Portfolio', to: '/portfolio' },
  { label: 'Packages', to: '/packages' },
] as const

const inquiryHref = `mailto:${LANDING_CONFIG.contact.email}`

export function MarketingShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="marketing-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <Link
            to="/"
            className="brand-lockup"
            aria-label={`${LANDING_CONFIG.businessName} home`}
            onClick={() => setMenuOpen(false)}
          >
            <span className="brand-lockup__mark" aria-hidden="true">
              O
            </span>
            <span className="brand-lockup__name">{LANDING_CONFIG.businessName}</span>
          </Link>

          <nav className="desktop-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <Link key={item.to} to={item.to} activeProps={{ className: 'is-active' }}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="site-header__actions">
            <a className="header-cta" href={inquiryHref}>
              Inquire <span aria-hidden="true">↗</span>
            </a>
            <button
              type="button"
              className="menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true" className="menu-toggle__icon">
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>

        <div
          id="mobile-navigation"
          className={`mobile-nav ${menuOpen ? 'is-open' : ''}`}
          hidden={!menuOpen}
        >
          <nav aria-label="Mobile navigation">
            <Link to="/" onClick={() => setMenuOpen(false)}>
              Home
            </Link>
            {navigation.map((item) => (
              <Link key={item.to} to={item.to} onClick={() => setMenuOpen(false)}>
                {item.label}
              </Link>
            ))}
            <a href={inquiryHref} onClick={() => setMenuOpen(false)}>
              Start a conversation <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </div>
      </header>

      <div className="site-content">{children}</div>

      <footer className="site-footer">
        <div className="site-footer__top">
          <div className="footer-intro">
            <p className="eyebrow">The Orbit Photo</p>
            <p className="footer-title">For the moments that keep moving.</p>
          </div>
          <a className="footer-cta" href={inquiryHref}>
            {LANDING_CONFIG.contact.email} <span aria-hidden="true">↗</span>
          </a>
        </div>

        <div className="site-footer__grid">
          <div>
            <p className="footer-label">Explore</p>
            <nav className="footer-links" aria-label="Footer navigation">
              {navigation.map((item) => (
                <Link key={item.to} to={item.to}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div>
            <p className="footer-label">Services</p>
            <nav className="footer-links" aria-label="Services navigation">
              <Link to="/wedding-photographer-jakarta">Wedding photography</Link>
              <Link to="/prewedding-bali">Prewedding Bali</Link>
              <Link to="/sangjit-photography-jakarta">Sangjit photography</Link>
              <Link to="/wedding-videographer-jakarta">Wedding videography</Link>
            </nav>
          </div>
          <div>
            <p className="footer-label">Elsewhere</p>
            <div className="footer-links">
              {LANDING_CONFIG.social.instagram ? (
                <a href={LANDING_CONFIG.social.instagram} target="_blank" rel="noreferrer">
                  Instagram <span aria-hidden="true">↗</span>
                </a>
              ) : null}
              <a href={`${LANDING_CONFIG.urls.app}/login`}>Client login <span aria-hidden="true">↗</span></a>
            </div>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>© {new Date().getFullYear()} {LANDING_CONFIG.businessName}</span>
          <span>Jakarta · Bali · Everywhere worth remembering</span>
        </div>
      </footer>
    </div>
  )
}
