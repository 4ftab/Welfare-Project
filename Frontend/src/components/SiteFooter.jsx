/** Dark editorial footer with a donate call to action and the existing site links. */
export default function SiteFooter({ tr, go, onDonate, user, isAdmin }) {
  const toContact = () => {
    go("home");
    setTimeout(() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" }), 80);
  };

  return (
    <footer className="x-footer">
      <div className="x-footer-inner">
        <div className="x-footer-top">
          <div className="x-footer-brand">
            <span className="x-brand-mark" aria-hidden="true">NI</span>
            <div>
              <strong>{tr("Nojawan Itehad Welfare", "نوجوان اتحاد ویلفیئر")}</strong>
              <span>{tr("Community welfare · Chitta Batta", "کمیونٹی ویلفیئر · چھٹہ بٹہ")}</span>
            </div>
          </div>
          <button type="button" className="x-donate x-donate-lg" onClick={onDonate}>
            ♡ {tr("Donate now", "ابھی عطیہ دیں")}
          </button>
        </div>

        <nav className="x-footer-cols" aria-label="Footer">
          <div>
            <h4>{tr("Explore", "دیکھیں")}</h4>
            <button onClick={() => go("projects")}>{tr("Projects", "منصوبے")}</button>
            <button onClick={() => go("announcements")}>{tr("News", "خبریں")}</button>
            <button onClick={() => go("report")}>{tr("Financial reports", "مالیاتی رپورٹس")}</button>
          </div>
          <div>
            <h4>{tr("Account", "اکاؤنٹ")}</h4>
            {user ? (
              <>
                <button onClick={() => go("dashboard")}>{tr("My dashboard", "میرا ڈیش بورڈ")}</button>
                <button onClick={() => go("profile")}>{tr("My profile", "میری پروفائل")}</button>
                {isAdmin && <button onClick={() => go("admin")}>{tr("Admin console", "ایڈمن کنسول")}</button>}
              </>
            ) : (
              <button onClick={() => go("donate")}>{tr("Give a gift", "عطیہ دیں")}</button>
            )}
          </div>
          <div>
            <h4>{tr("Reach us", "رابطہ")}</h4>
            <button onClick={toContact}>{tr("Send a message", "پیغام بھیجیں")}</button>
            <span>Chitta Batta</span>
          </div>
        </nav>

        <p className="x-footer-note">{tr("Every confirmed rupee is reported openly.", "ہر تصدیق شدہ روپیہ کھلے عام رپورٹ ہوتا ہے۔")}</p>
        <div className="x-footer-word" aria-hidden="true">NOJAWAN ITEHAD</div>
      </div>
    </footer>
  );
}
