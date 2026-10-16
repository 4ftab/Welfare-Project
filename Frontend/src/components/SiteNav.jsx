import { useEffect, useState } from "react";
import { Icon } from "./Glyphs";

/**
 * Floating liquid-glass navigation used on every page. One component renders the desktop pill
 * and the mobile sheet, so role-based items (dashboard, profile, admin) stay in a single place.
 */
export default function SiteNav({ tr, items, page, user, isAdmin, isUrdu, go, onDonate, onSignIn, onLogout, onToggleLanguage }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const navigate = (key) => {
    setOpen(false);
    go(key);
  };

  const links = items.filter((i) => i.key !== "donate");

  return (
    <header className="x-nav" data-open={open || undefined}>
      <div className="x-nav-bar">
        <a className="x-brand" href="#/home" onClick={(e) => { e.preventDefault(); navigate("home"); }}>
          <span className="x-brand-mark" aria-hidden="true">NI</span>
          <span className="x-brand-text">
            <strong>{tr("Nojawan Itehad", "نوجوان اتحاد")}</strong>
            <small>{tr("Welfare · Chitta Batta", "ویلفیئر · چھٹہ بٹہ")}</small>
          </span>
        </a>

        <nav className="x-links" aria-label={tr("Main", "مرکزی")}>
          {links.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`x-link${page === item.key ? " is-active" : ""}`}
              aria-current={page === item.key ? "page" : undefined}
              onClick={() => navigate(item.key)}
            >
              {item.short || item.label}
            </button>
          ))}
        </nav>

        <div className="x-actions">
          <button type="button" className="x-donate" data-magnetic onClick={() => { setOpen(false); onDonate(); }}>
            <Icon name="donate" size={16} />
            <span>{tr("Donate", "عطیہ")}</span>
          </button>
          <button type="button" className="x-chip x-lang" onClick={onToggleLanguage} aria-label="Change website language">
            {isUrdu ? "EN" : "اردو"}
          </button>
          {user ? (
            <>
              <span className="x-user" title={user.email}>
                <span className="x-avatar" aria-hidden="true">{(user.full_name || "?").trim().charAt(0).toUpperCase()}</span>
                <span className="x-user-text">
                  <strong>{user.full_name}</strong>
                  <small>{isAdmin ? tr("Administrator", "منتظم") : tr("Donor", "عطیہ دہندہ")}</small>
                </span>
              </span>
              <button type="button" className="x-chip x-logout" onClick={onLogout}>{tr("Log out", "لاگ آؤٹ")}</button>
            </>
          ) : (
            <button type="button" className="x-chip x-signin" onClick={onSignIn}>{tr("Sign in", "لاگ اِن")}</button>
          )}
          <button
            type="button"
            className="x-burger"
            aria-expanded={open}
            aria-controls="x-sheet"
            aria-label={open ? tr("Close menu", "مینو بند کریں") : tr("Open menu", "مینو کھولیں")}
            onClick={() => setOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>

      <div className="x-sheet" id="x-sheet" hidden={!open}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`x-sheet-link${page === item.key ? " is-active" : ""}`}
            aria-current={page === item.key ? "page" : undefined}
            onClick={() => navigate(item.key)}
          >
            <span className="x-sheet-icon" aria-hidden="true"><Icon name={item.icon} size={18} /></span>
            {item.label}
          </button>
        ))}
        {!user && (
          <button type="button" className="x-sheet-link" onClick={() => { setOpen(false); onSignIn(); }}>
            <span className="x-sheet-icon" aria-hidden="true"><Icon name="signin" size={18} /></span>
            {tr("Sign in / Register", "لاگ اِن / رجسٹریشن")}
          </button>
        )}
      </div>
    </header>
  );
}
