import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DonationReport from "./DonationReport";
import { CountUp, DonutChart, ProgressBar, TrendChart } from "./components/Charts";
import { Confetti, Ring } from "./components/Effects";
import { Glyph, Icon } from "./components/Glyphs";
import { glyphFor } from "./components/glyphRules";
import Village from "./components/Village";
import { useAmbient } from "./useAmbient";
import { useLanguage } from "./LanguageContext";
import {
  api,
  compactMoney,
  currentMonth,
  CHANNEL_NAMES,
  formatDate,
  methodLabel,
  money,
  monthLabel,
  pct,
  shiftMonth,
} from "./api";

// The admin console is only for administrators, so it is downloaded only when it is opened.
const AdminPanel = lazy(() => import("./components/AdminPanel"));

const PAGES = ["home", "dashboard", "donate", "projects", "announcements", "report", "profile", "admin"];
const PRESETS = [500, 1000, 2500, 5000, 10000];

// Headline split into words so each one can rise into place with a stagger (--i).
function Words({ text, start = 0, className = "" }) {
  return (
    <span className={`words ${className}`}>
      {text.split(" ").map((word, i) => (
        <Fragment key={i}>
          <span className="w" style={{ "--i": start + i }}><span>{word}</span></span>{" "}
        </Fragment>
      ))}
    </span>
  );
}

function pageFromHash() {
  const key = window.location.hash.replace("#/", "").replace("#", "");
  return PAGES.includes(key) ? key : "home";
}

export default function App() {
  const { language, toggleLanguage } = useLanguage();
  const isUrdu = language === "ur";
  const tr = (english, urdu) => (isUrdu ? urdu : english);

  const [token, setToken] = useState(() => sessionStorage.getItem("welfare_token") || "");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(() => Boolean(sessionStorage.getItem("welfare_token")));
  // True once the signed-in user is known, so later token changes refresh data quietly instead of blanking the page.
  const hasSession = useRef(false);
  // True right after sign-in, when the login response already carried the profile (no /auth/me needed).
  const profileFresh = useRef(false);
  // Blocks a second submit in the instant before React disables the button.
  const submitting = useRef(false);

  const [mode, setMode] = useState("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [authLeaving, setAuthLeaving] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingAuth = useRef(null);
  const [page, setPage] = useState(pageFromHash);

  const [toasts, setToasts] = useState([]);

  const [dashboard, setDashboard] = useState(null);
  const [projects, setProjects] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [stats, setStats] = useState(null);
  const [publicLoading, setPublicLoading] = useState(true);
  const [config, setConfig] = useState({ online_payments: false });
  const [recent, setRecent] = useState([]);
  const [burst, setBurst] = useState(0);
  const [paying, setPaying] = useState(false);
  const donating = useRef(false);

  useAmbient();

  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState(null);

  const [projectFilter, setProjectFilter] = useState("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [announcementSearch, setAnnouncementSearch] = useState("");
  const [donationFilter, setDonationFilter] = useState("all");

  const [selectedAmount, setSelectedAmount] = useState("");
  const [donateProject, setDonateProject] = useState("");
  const [channel, setChannel] = useState("card");
  const [lastPledge, setLastPledge] = useState(null);


  /* ───────── toasts ───────── */

  const pushToast = useCallback((type, text) => {
    const id = Date.now() + Math.random();
    const ttl = type === "error" ? 6500 : 4200;
    setToasts((list) => [...list.slice(-3), { id, type, text }]);
    setTimeout(() => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), ttl - 260);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ttl);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 240);
  }, []);

  const notify = useCallback((text) => pushToast("success", text), [pushToast]);
  const fail = useCallback((text) => pushToast("error", text), [pushToast]);

  /* ───────── language + routing ───────── */

  useEffect(() => {
    document.documentElement.lang = isUrdu ? "ur" : "en";
    document.documentElement.dir = isUrdu ? "rtl" : "ltr";
    document.body.classList.toggle("urdu-mode", isUrdu);
    localStorage.setItem("website-language", language);
    document.title = isUrdu ? "نوجوان اتحاد ویلفیئر" : "Nojawan Itehad Welfare";
  }, [language, isUrdu]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next) => {
    window.location.hash = `#/${next}`;
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* ───────── auth modal ───────── */

  function openAuth(selectedMode = "login") {
    setMode(selectedMode);
    setAuthError("");
    setAuthMessage("");
    setAuthOpen(true);
  }

  function closeAuth() {
    if (busy) return;
    setAuthLeaving(true);
    setTimeout(() => {
      setAuthOpen(false);
      setAuthLeaving(false);
      setAuthError("");
    }, 190);
  }

  useEffect(() => {
    if (!authOpen) return;
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) {
        setAuthOpen(false);
        setAuthError("");
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [authOpen, busy]);

  /* ───────── data loading ───────── */

  const loadPublic = useCallback(async () => {
    try {
      const [projectData, announcementData, statData, configData, recentData] = await Promise.all([
        api("/projects"),
        api("/announcements"),
        api("/public/stats"),
        api("/public/config").catch(() => ({ online_payments: false })),
        api("/public/recent").catch(() => ({ gifts: [] })),
      ]);
      setProjects(projectData.projects || []);
      setAnnouncements(announcementData.announcements || []);
      setStats(statData);
      setConfig(configData);
      setRecent(recentData.gifts || []);
    } catch (e) {
      fail(e.message);
    } finally {
      setPublicLoading(false);
    }
  }, [fail]);

  const loadDashboard = useCallback(
    async (currentToken, { skipProfile = false } = {}) => {
      if (!currentToken) return;
      try {
        // Both requests start together; the profile one is skipped when sign-in just returned it.
        const profilePromise = skipProfile ? null : api("/auth/me", { token: currentToken });
        const summary = await api("/dashboard", { token: currentToken });
        if (profilePromise) setUser((await profilePromise).user);
        setDashboard(summary);
      } catch (e) {
        if (e.status === 401) {
          sessionStorage.removeItem("welfare_token");
          setToken("");
          setUser(null);
          setDashboard(null);
          fail(tr("Your session has expired. Please sign in again.", "آپ کا سیشن ختم ہوگیا ہے۔ دوبارہ لاگ اِن کریں۔"));
        } else {
          fail(e.message);
        }
      } finally {
        setAuthLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fail]
  );

  useEffect(() => {
    loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    if (token) {
      if (!hasSession.current) setAuthLoading(true);
      const skipProfile = profileFresh.current;
      profileFresh.current = false;
      loadDashboard(token, { skipProfile }).finally(() => { hasSession.current = true; });
    } else {
      hasSession.current = false;
      setAuthLoading(false);
    }
  }, [token, loadDashboard]);

  const loadReport = useCallback(async () => {
    try {
      setReport(await api(`/reports/monthly?month=${encodeURIComponent(month)}`));
    } catch (e) {
      fail(e.message);
    }
  }, [month, fail]);

  useEffect(() => {
    if (page === "report") loadReport();
  }, [page, loadReport]);

  // Returning from Safepay checkout: confirm the payment with the server, never trust the URL alone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("payment");
    const donationId = params.get("donation");
    if (!kind || !donationId) return;

    window.history.replaceState(null, "", window.location.pathname + window.location.hash);

    if (!token) {
      fail("Please sign in to confirm your payment.");
      return;
    }

    if (kind === "cancel") {
      fail("Payment was cancelled. Your pledge is still pending and can be completed any time from your dashboard.");
      return;
    }

    (async () => {
      try {
        let result = await api(`/donations/${donationId}/verify`, { method: "POST", token });
        for (let attempt = 0; attempt < 3 && result.payment_status === "pending"; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          result = await api(`/donations/${donationId}/verify`, { method: "POST", token });
        }
        if (result.payment_status === "completed") {
          notify("Payment confirmed. Thank you for your generosity!");
          setBurst((n) => n + 1);
          loadPublic();
        } else {
          fail(result.message);
        }
        await loadDashboard(token);
      } catch (e) {
        fail(e.message);
      }
    })();
  }, [token, notify, fail, loadDashboard, loadPublic]);

  /* ───────── actions ───────── */

  // Switches the modal to the code-entry step for an account whose email is not verified yet.
  function askForCode(credentials) {
    pendingAuth.current = credentials;
    setMode("verify");
    setAuthMessage(tr(
      `We emailed a 6-digit code to ${credentials.email}. Enter it below to continue.`,
      `ہم نے ${credentials.email} پر 6 ہندسوں کا کوڈ بھیجا ہے۔ جاری رکھنے کے لیے اسے نیچے درج کریں۔`
    ));
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const formElement = event.currentTarget;
    const body = Object.fromEntries(new FormData(formElement).entries());
    const credentials = mode === "verify" ? pendingAuth.current : { email: body.email, password: body.password };

    setBusy(true);
    setAuthError("");
    setAuthMessage("");

    try {
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: JSON.stringify(body) });
        askForCode(credentials);
        return;
      }

      const result = mode === "verify"
        ? await api("/auth/verify-otp", { method: "POST", body: JSON.stringify({ ...credentials, otp: body.otp }) })
        : await api("/auth/login", { method: "POST", body: JSON.stringify(body) });

      pendingAuth.current = null;
      sessionStorage.setItem("welfare_token", result.token);
      hasSession.current = true;
      profileFresh.current = true;
      setUser(result.user);
      setToken(result.token);
      setAuthOpen(false);
      formElement.reset();
      go("dashboard");
      notify(mode === "verify"
        ? tr(`Email verified. Welcome, ${result.user.full_name}!`, `ای میل کی تصدیق ہوگئی۔ خوش آمدید، ${result.user.full_name}!`)
        : tr(`Welcome back, ${result.user.full_name}!`, `خوش آمدید، ${result.user.full_name}!`));
    } catch (e) {
      if (e.code === "EMAIL_NOT_VERIFIED") {
        askForCode(credentials);
      } else {
        setAuthError(e.message);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setAuthError("");
    setAuthMessage("");

    try {
      await api("/auth/resend-otp", { method: "POST", body: JSON.stringify(pendingAuth.current) });
      setAuthMessage(tr("A new code is on its way to your email.", "نیا کوڈ آپ کی ای میل پر بھیج دیا گیا ہے۔"));
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("welfare_token");
    setToken("");
    setUser(null);
    setDashboard(null);
    setLastPledge(null);
    go("home");
    notify(tr("You have logged out successfully.", "آپ کامیابی سے لاگ آؤٹ ہوگئے ہیں۔"));
  }

  async function createDonation(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(selectedAmount || form.get("amount"));

    if (!Number.isInteger(amount) || amount < 10) {
      fail(tr("Please choose or enter a whole amount of at least PKR 10.", "براہ کرم کم از کم 10 روپے کی پوری رقم منتخب یا درج کریں۔"));
      return;
    }

    // Ignore a second click while the first request is still running.
    if (donating.current) return;
    donating.current = true;

    try {
      const result = await api("/donations", {
        method: "POST",
        token,
        body: JSON.stringify({
          amount,
          payment_method: "safepay",
          project_id: donateProject ? Number(donateProject) : undefined,
          note: form.get("note") || undefined,
          payment_channel: channel,
        }),
      });
      if (result.checkout_url) {
        setPaying(true);
        window.location.assign(result.checkout_url);
        return;
      }

      setLastPledge({
        id: result.donation_id,
        amount,
        project: projects.find((p) => String(p.id) === String(donateProject))?.title,
        message: result.message,
      });
      setSelectedAmount("");
      setDonateProject("");
      setChannel("card");
      event.currentTarget.reset();
      await loadDashboard(token);
    } catch (e) {
      fail(e.message);
    } finally {
      donating.current = false;
    }
  }

  async function payNow(donationId) {
    try {
      setPaying(true);
      const result = await api(`/donations/${donationId}/pay`, { method: "POST", token });
      window.location.assign(result.checkout_url);
    } catch (e) {
      setPaying(false);
      if (e.status === 409) {
        notify(e.message);
        await loadDashboard(token);
      } else {
        fail(e.message);
      }
    }
  }

  async function checkPayment(donationId) {
    try {
      const result = await api(`/donations/${donationId}/verify`, { method: "POST", token });
      if (result.payment_status === "completed") {
        notify(result.message);
        setBurst((n) => n + 1);
        loadPublic();
      } else {
        notify(result.message);
      }
      await loadDashboard(token);
    } catch (e) {
      fail(e.message);
    }
  }

  async function cancelDonation(id) {
    if (!window.confirm(tr("Cancel this pending donation?", "کیا یہ زیرِ التوا عطیہ منسوخ کریں؟"))) return;
    try {
      const result = await api(`/donations/${id}`, { method: "DELETE", token });
      notify(result.message);
      await loadDashboard(token);
    } catch (e) {
      fail(e.message);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api("/auth/me", { method: "PATCH", token, body: JSON.stringify(body) });
      notify(result.message);
      await loadDashboard(token);
    } catch (e) {
      fail(e.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const body = Object.fromEntries(new FormData(formElement).entries());
    if (body.new_password !== body.confirm_password) {
      fail(tr("The new passwords do not match.", "نئے پاس ورڈ مماثل نہیں ہیں۔"));
      return;
    }
    try {
      const result = await api("/auth/change-password", {
        method: "POST",
        token,
        body: JSON.stringify({ current_password: body.current_password, new_password: body.new_password }),
      });
      notify(result.message);
      formElement.reset();
    } catch (e) {
      fail(e.message);
    }
  }

  async function sendContact(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const body = Object.fromEntries(new FormData(formElement).entries());
    setBusy(true);
    try {
      const result = await api("/public/contact", { method: "POST", body: JSON.stringify(body) });
      notify(result.message);
      formElement.reset();
    } catch (e) {
      fail(e.message);
    } finally {
      setBusy(false);
    }
  }

  function donateTo(projectId) {
    setDonateProject(projectId ? String(projectId) : "");
    setLastPledge(null);
    go("donate");
  }

  /* ───────── derived ───────── */

  const isAdmin = user?.role === "admin";

  const navItems = [
    { key: "home", label: tr("Home", "ہوم"), icon: "home" },
    ...(user ? [{ key: "dashboard", label: tr("My dashboard", "میرا ڈیش بورڈ"), icon: "dashboard" }] : []),
    { key: "projects", label: tr("Welfare Projects", "فلاحی منصوبے"), icon: "projects" },
    { key: "announcements", label: tr("Announcements", "اعلانات"), icon: "announcements" },
    { key: "report", label: tr("Financial Reports", "مالیاتی رپورٹس"), icon: "report" },
    { key: "donate", label: tr("Donate", "عطیہ دیں"), icon: "donate" },
    ...(user ? [{ key: "profile", label: tr("My profile", "میری پروفائل"), icon: "profile" }] : []),
    ...(isAdmin ? [{ key: "admin", label: tr("Admin Console", "ایڈمن کنسول"), icon: "admin" }] : []),
  ];

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (projectFilter === "all" || p.status === projectFilter) &&
        (!q || `${p.title} ${p.description || ""} ${p.location || ""}`.toLowerCase().includes(q))
    );
  }, [projects, projectFilter, projectSearch]);

  const filteredAnnouncements = useMemo(() => {
    const q = announcementSearch.trim().toLowerCase();
    return announcements.filter((a) => !q || `${a.title} ${a.body}`.toLowerCase().includes(q));
  }, [announcements, announcementSearch]);

  const myDonations = useMemo(() => dashboard?.recent_donations || [], [dashboard]);
  const filteredMyDonations = myDonations.filter((d) => donationFilter === "all" || d.payment_status === donationFilter);
  const pendingMine = myDonations.filter((d) => d.payment_status === "pending").length;
  const projectsSupported = new Set(myDonations.filter((d) => d.project_id && d.payment_status === "completed").map((d) => d.project_id)).size;

  const myMonthly = useMemo(() => {
    const months = [];
    const base = currentMonth();
    for (let i = 5; i >= 0; i -= 1) months.push(shiftMonth(base, -i));
    return months.map((m) => ({
      month: m,
      donations: myDonations
        .filter((d) => d.payment_status === "completed" && String(new Date(d.donation_date).toLocaleDateString("en-CA")).startsWith(m))
        .reduce((s, d) => s + Number(d.amount), 0),
      expenses: 0,
    }));
  }, [myDonations]);

  const budgetTotal = projects.filter((p) => p.status !== "cancelled").reduce((s, p) => s + Number(p.budget), 0);
  const fundedPct = pct(stats?.total_raised, budgetTotal);

  const amountNum = Number(selectedAmount);
  const amountOk = Number.isInteger(amountNum) && amountNum >= 10 && amountNum <= 1000000;
  const donateProjectTitle = projects.find((p) => String(p.id) === String(donateProject))?.title;

  const featured = projects.filter((p) => p.status === "ongoing" || p.status === "planned").slice(0, 3);

  const trendLabels = {
    title: tr("Monthly donations", "ماہانہ عطیات"),
    donations: tr("Donations", "عطیات"),
    expenses: tr("Expenses", "اخراجات"),
    peak: tr("Peak", "زیادہ سے زیادہ"),
  };

  const statusLabel = (s) => ({
    planned: tr("Planned", "منصوبہ بند"),
    ongoing: tr("Ongoing", "جاری"),
    completed: tr("Completed", "مکمل"),
    cancelled: tr("Cancelled", "منسوخ"),
  }[s] || s);

  /* ───────── render helpers ───────── */

  function renderProject(project) {
    const progress = pct(project.raised, project.budget);
    const accepting = project.status === "planned" || project.status === "ongoing";
    return (
      <article className="panel project-card" key={project.id}>
        <div className="project-art" data-tone={project.id % 4}>
          <span className="art-glyph"><Glyph name={glyphFor(`${project.title} ${project.description || ""}`)} size={30} /></span>
          <span className={`status ${project.status}`}>{statusLabel(project.status)}</span>
        </div>
        <div className="project-body">
        <h3>{project.title}</h3>
        <p>{project.description || tr("More project details will be shared soon.", "منصوبے کی مزید تفصیلات جلد شیئر کی جائیں گی۔")}</p>
        <p className="muted"><span aria-hidden="true">⌖</span> {project.location || "Chitta Batta"}
          {project.start_date && <> · {formatDate(project.start_date)}{project.end_date ? ` → ${formatDate(project.end_date)}` : ""}</>}
        </p>
        <div className="project-funding">
          <div className="funding-head">
            <span className="muted">{tr("Raised", "جمع شدہ")} <strong>{money(project.raised)}</strong></span>
            <span className="muted">{Math.round(progress)}%</span>
          </div>
          <ProgressBar value={progress} label={project.title} />
          <div className="funding-head">
            <span className="muted">{tr("Planned budget", "منصوبہ بند بجٹ")}</span>
            <strong>{money(project.budget)}</strong>
          </div>
          {Number(project.spent) > 0 && (
            <div className="funding-head">
              <span className="muted">{tr("Spent so far", "اب تک خرچ")}</span>
              <strong>{money(project.spent)}</strong>
            </div>
          )}
        </div>
        {accepting && (
          <button className="button button-light card-cta" onClick={() => donateTo(project.id)}>
            ♡ {tr("Support this project", "اس منصوبے کی مدد کریں")}
          </button>
        )}
        </div>
      </article>
    );
  }

  // Reloading the page with a saved session: the public home page does not need the account, so show it
  // straight away instead of a blank "loading" screen.
  if (authLoading && page !== "home") {
    return (
      <div className="app-shell">
        <div className="panel" style={{ maxWidth: 480, margin: "100px auto" }}>
          <h2>{tr("Loading your account...", "آپ کا اکاؤنٹ لوڈ ہورہا ہے...")}</h2>
          <p className="muted">{tr("Please wait while we verify your session.", "براہ کرم انتظار کریں، ہم آپ کے اکاؤنٹ کی تصدیق کررہے ہیں۔")}</p>
          <div className="skeleton-line wide" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div id="scroll-progress" aria-hidden="true" />
      <Confetti burst={burst} />
      {paying && (
        <div className="redirect-overlay" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <strong>{tr("Taking you to Safepay's secure checkout…", "آپ کو Safepay کے محفوظ چیک آؤٹ پر لے جایا جا رہا ہے…")}</strong>
          <small>{tr("Please don't close this window.", "براہ کرم یہ ونڈو بند نہ کریں۔")}</small>
        </div>
      )}
      <a className="skip-link" href="#main-content">{tr("Skip to content", "مواد پر جائیں")}</a>

      <header className="topbar">
        <a className="brand" href="#/home" onClick={(e) => { e.preventDefault(); go("home"); }}>
          <span className="brand-mark">NI</span>
          <span>
            <strong>{tr("Nojawan Itehad", "نوجوان اتحاد")}</strong>
            <small>{tr("Welfare · Chitta Batta", "ویلفیئر · چھٹہ بٹہ")}</small>
          </span>
        </a>

        <div className="top-actions">
          <button className="button button-light nav-donate" data-magnetic onClick={() => donateTo("")}>♡ {tr("Donate", "عطیہ")}</button>
          <button type="button" className="button button-light" onClick={toggleLanguage} aria-label="Change website language">
            {isUrdu ? "English" : "اردو"}
          </button>

          {user ? (
            <>
              <span className="welcome">
                <strong>{user.full_name}</strong>
                <small>{isAdmin ? tr("Administrator", "منتظم") : tr("Donor", "عطیہ دہندہ")}</small>
              </span>
              <button className="button button-light" onClick={logout}>{tr("Log out", "لاگ آؤٹ")}</button>
            </>
          ) : (
            <button className="button button-primary" onClick={() => openAuth("login")}>{tr("Sign in", "لاگ اِن")}</button>
          )}
        </div>
      </header>

      <main className="main-layout" id="main-content">
        <aside className="sidebar">
          <p className="side-label">{tr("MAIN MENU", "مرکزی مینو")}</p>

          {navItems.map((item) => (
            <button key={item.key} className={`nav-item ${page === item.key ? "active" : ""}`} aria-current={page === item.key ? "page" : undefined} onClick={() => go(item.key)}>
              <span className="nav-icon" aria-hidden="true"><Icon name={item.icon} /></span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-arrow" aria-hidden="true">›</span>
            </button>
          ))}

          {!user && (
            <button className="nav-item" onClick={() => openAuth("login")}>
              <span className="nav-icon" aria-hidden="true"><Icon name="signin" /></span>
              <span className="nav-label">{tr("Sign in / Register", "لاگ اِن / رجسٹریشن")}</span>
              <span className="nav-arrow" aria-hidden="true">›</span>
            </button>
          )}

          <div className="sidebar-note">
            <div className="trust-icon"><Icon name="check" size={18} /></div>
            <strong>{tr("Built on trust", "اعتماد کی بنیاد پر")}</strong>
            <p>{tr("Clear records help the community understand how contributions are recorded and spent.", "شفاف ریکارڈ کمیونٹی کو یہ سمجھنے میں مدد دیتا ہے کہ عطیات کیسے درج اور خرچ کیے جاتے ہیں۔")}</p>
            {stats && <p className="sidebar-stat">{tr("Raised so far", "اب تک جمع")}: <strong>PKR {compactMoney(stats.total_raised)}</strong></p>}
          </div>
        </aside>

        <section className="content" key={page}>
          {/* ════════════ HOME ════════════ */}
          {page === "home" && (
            <>
              <section className="hero hero-x">
                <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
                <div className="hero-pattern" aria-hidden="true" />

                <div className="hero-copy">
                  <span className="pill hero-in" style={{ "--i": 0 }}><span className="pulse" />{tr("Live · open books · community-led", "براہِ راست · کھلا حساب · کمیونٹی کی قیادت")}</span>
                  <h1>
                    <Words text={tr("Small contributions.", "چھوٹا سا تعاون۔")} start={1} />
                    <br />
                    <Words className="grad-text" text={tr("Meaningful change.", "بامعنی تبدیلی۔")} start={4} />
                  </h1>
                  <p className="hero-in" style={{ "--i": 6 }}>{tr("Supporting welfare initiatives in Chitta Batta through community participation, responsible record keeping, and financial transparency.", "چھٹہ بٹہ میں کمیونٹی کی شرکت، ذمہ دارانہ ریکارڈ اور مالی شفافیت کے ذریعے فلاحی سرگرمیوں کی مدد کرنا۔")}</p>
                  <div className="hero-actions hero-in" style={{ "--i": 7 }}>
                    <button className="button button-gold" data-magnetic onClick={() => donateTo("")}>♡ {tr("Donate now", "ابھی عطیہ دیں")}</button>
                    <button className="button button-ghost" data-magnetic onClick={() => go("projects")}>{tr("Explore our projects", "ہمارے منصوبے دیکھیں")} →</button>
                  </div>
                  <ul className="trust-row hero-in" style={{ "--i": 8 }}>
                    <li><span aria-hidden="true"><Icon name="lock" size={13} /></span>{config.online_payments ? tr("Secure checkout by Safepay", "Safepay کے ذریعے محفوظ ادائیگی") : tr("Pledge in seconds", "چند سیکنڈ میں عطیہ")}</li>
                    <li><span aria-hidden="true"><Icon name="report" size={13} /></span>{tr("Public monthly reports", "عوامی ماہانہ رپورٹس")}</li>
                    <li><span aria-hidden="true"><Icon name="check" size={13} /></span>{tr("Only confirmed gifts are counted", "صرف تصدیق شدہ عطیات شمار ہوتے ہیں")}</li>
                  </ul>
                </div>

                <div className="hero-stage">
                  <div className="hero-scene hero-in" style={{ "--i": 3 }}>
                    <Village />
                    <span className="scene-tag"><span className="pulse" />{tr("Chitta Batta", "چھٹہ بٹہ")}</span>
                  </div>
                  <div className="hero-ring-card hero-in" style={{ "--i": 9 }}>
                    <Ring size={112} stroke={10} value={fundedPct}>
                      <strong>{Math.round(fundedPct)}%</strong>
                    </Ring>
                    <div className="ring-meta">
                      <span>{tr("of project budgets funded", "منصوبوں کا بجٹ پورا")}</span>
                      <strong>PKR {compactMoney(stats?.total_raised)}</strong>
                      <small>{tr("raised so far", "اب تک جمع")}</small>
                    </div>
                  </div>
                  <div className="hero-glass g2 hero-in" style={{ "--i": 10 }}>
                    <small>{tr("Community donors", "عطیہ دہندگان")}</small>
                    <strong><CountUp value={stats?.donor_count} /></strong>
                  </div>
                  <div className="hero-glass g3 hero-in" style={{ "--i": 11 }}>
                    <small>{tr("Active projects", "جاری منصوبے")}</small>
                    <strong><CountUp value={stats?.projects_ongoing} /></strong>
                  </div>
                </div>
              </section>

              <div className="ticker" aria-label={tr("Recent gifts", "حالیہ عطیات")}>
                <span className="ticker-label"><span className="pulse" />{tr("Recent gifts", "حالیہ عطیات")}</span>
                <div className="ticker-track">
                  <div className="ticker-move">
                    {(recent.length ? [...recent, ...recent] : [null, null, null, null]).map((gift, i) => (
                      <span className="ticker-item" key={i}>
                        {gift ? (
                          <>
                            <b>♡</b> {tr("A supporter gave", "ایک عطیہ دہندہ نے دیا")} <strong>{money(gift.amount)}</strong>
                            {gift.project ? ` ${tr("to", "برائے")} ${gift.project}` : ""} · {formatDate(gift.donated_at)}
                          </>
                        ) : (
                          <><b>✦</b> {tr("Be the first to give — every contribution is recorded and reported openly.", "پہلے عطیہ دہندہ بنیں — ہر عطیہ درج اور کھلے عام رپورٹ ہوتا ہے۔")}</>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <section className="impact-strip" aria-label={tr("Our impact", "ہمارا اثر")}>
                <article><strong><CountUp value={stats?.total_raised} format={(n) => `PKR ${compactMoney(n)}`} /></strong><span>{tr("Funds raised", "جمع شدہ فنڈز")}</span></article>
                <article><strong><CountUp value={stats?.donor_count} /></strong><span>{tr("Generous donors", "فراخ دل عطیہ دہندگان")}</span></article>
                <article><strong><CountUp value={stats?.projects_total} /></strong><span>{tr("Welfare projects", "فلاحی منصوبے")}</span></article>
                <article><strong><CountUp value={stats?.total_spent} format={(n) => `PKR ${compactMoney(n)}`} /></strong><span>{tr("Spent on the community", "کمیونٹی پر خرچ")}</span></article>
              </section>

              <section className="panel about" id="about">
                <span className="eyebrow">{tr("WHO WE ARE", "ہم کون ہیں")}</span>
                <h2>{tr("Neighbours helping neighbours", "پڑوسی، پڑوسیوں کے مددگار")}</h2>
                <p className="muted lead">
                  {tr(
                    "Nojawan Itehad is a youth-led welfare committee serving the people of Chitta Batta. Contributions are pooled, recorded and spent on local needs — and every rupee is reported openly so that donors can see the difference they make.",
                    "نوجوان اتحاد چھٹہ بٹہ کے لوگوں کی خدمت کرنے والی نوجوانوں کی فلاحی کمیٹی ہے۔ عطیات جمع، درج اور مقامی ضرورتوں پر خرچ کیے جاتے ہیں، اور ہر روپے کی رپورٹ کھلے عام دی جاتی ہے۔"
                  )}
                </p>
                <div className="value-grid">
                  <div className="value"><span className="value-icon">◈</span><h3>{tr("Transparent", "شفاف")}</h3><p className="muted">{tr("Monthly public reports show opening balance, donations, expenses and closing balance.", "ماہانہ عوامی رپورٹس میں ابتدائی بیلنس، عطیات، اخراجات اور اختتامی بیلنس دکھایا جاتا ہے۔")}</p></div>
                  <div className="value"><span className="value-icon">❖</span><h3>{tr("Accountable", "جواب دہ")}</h3><p className="muted">{tr("Every administrative action is written to an activity log.", "ہر انتظامی کارروائی سرگرمی لاگ میں درج ہوتی ہے۔")}</p></div>
                  <div className="value"><span className="value-icon">✿</span><h3>{tr("Community-led", "کمیونٹی کی قیادت")}</h3><p className="muted">{tr("Projects are chosen by and for the people of Chitta Batta.", "منصوبے چھٹہ بٹہ کے لوگوں کی طرف سے اور انہی کے لیے منتخب ہوتے ہیں۔")}</p></div>
                </div>
              </section>

              <section className="panel">
                <span className="eyebrow">{tr("HOW IT WORKS", "یہ کیسے کام کرتا ہے")}</span>
                <h2>{tr("Giving in three simple steps", "تین آسان مراحل میں عطیہ")}</h2>
                <ol className="steps">
                  <li><span className="step-no">1</span><div><h3>{tr("Create an account", "اکاؤنٹ بنائیں")}</h3><p className="muted">{tr("Register free to keep your own donation history.", "اپنی عطیات کی تاریخ محفوظ رکھنے کے لیے مفت رجسٹر کریں۔")}</p></div></li>
                  <li><span className="step-no">2</span><div><h3>{config.online_payments ? tr("Give securely", "محفوظ طریقے سے عطیہ دیں") : tr("Pledge your gift", "عطیہ درج کریں")}</h3><p className="muted">{config.online_payments ? tr("Choose an amount and a project, then pay on Safepay's secure page.", "رقم اور منصوبہ منتخب کریں، پھر Safepay کے محفوظ صفحے پر ادائیگی کریں۔") : tr("Choose an amount and, if you like, a specific project.", "رقم اور چاہیں تو کوئی مخصوص منصوبہ منتخب کریں۔")}</p></div></li>
                  <li><span className="step-no">3</span><div><h3>{tr("See it counted", "اسے شمار ہوتا دیکھیں")}</h3><p className="muted">{config.online_payments ? tr("Once Safepay confirms your payment it is counted automatically and appears in the public reports.", "Safepay کی تصدیق کے بعد آپ کا عطیہ خود بخود شمار ہوتا ہے اور عوامی رپورٹس میں شامل ہو جاتا ہے۔") : tr("Once received, an administrator confirms it and it appears in the public reports.", "رقم ملنے پر ایڈمن تصدیق کرتا ہے اور یہ عوامی رپورٹس میں شامل ہو جاتی ہے۔")}</p></div></li>
                </ol>
              </section>

              {featured.length > 0 && (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">{tr("WHERE YOUR GIFT GOES", "آپ کا عطیہ کہاں جاتا ہے")}</span>
                      <h2>{tr("Projects needing support", "مدد کے منتظر منصوبے")}</h2>
                    </div>
                    <button className="button button-light" onClick={() => go("projects")}>{tr("All projects", "تمام منصوبے")} →</button>
                  </div>
                  <div className="cards-grid three">{featured.map((p) => renderProject(p))}</div>
                </>
              )}

              <div className="two-col">
                <section className="panel">
                  <span className="eyebrow">{tr("OPEN BOOKS", "کھلا حساب")}</span>
                  <h3>{tr("Where the money goes", "رقم کہاں خرچ ہوتی ہے")}</h3>
                  <DonutChart
                    data={(stats?.expense_categories || []).map((c) => ({ label: c.category, value: c.total }))}
                    emptyText={tr("Expense categories will appear here once expenses are recorded.", "اخراجات درج ہونے پر قسمیں یہاں دکھائی دیں گی۔")}
                  />
                  <button className="button button-light" style={{ marginTop: 14 }} onClick={() => go("report")}>{tr("View monthly report", "ماہانہ رپورٹ دیکھیں")} →</button>
                </section>

                <section className="panel">
                  <span className="eyebrow">{tr("LATEST NEWS", "تازہ خبریں")}</span>
                  <h3>{tr("Community updates", "کمیونٹی اپ ڈیٹس")}</h3>
                  {announcements.slice(0, 3).map((a) => (
                    <article className="mini-news" key={a.id}>
                      <strong>{a.title}</strong>
                      <p className="muted clamp">{a.body}</p>
                      <small className="muted">{formatDate(a.created_at)}</small>
                    </article>
                  ))}
                  {!announcements.length && !publicLoading && <p className="muted">{tr("No announcements yet.", "ابھی کوئی اعلان نہیں۔")}</p>}
                  <button className="button button-light" style={{ marginTop: 10 }} onClick={() => go("announcements")}>{tr("All announcements", "تمام اعلانات")} →</button>
                </section>
              </div>

              <section className="panel">
                <span className="eyebrow">FAQ</span>
                <h2>{tr("Questions, answered", "آپ کے سوالات")}</h2>
                <div className="faq">
                  <details><summary>{tr("How do I know my donation was received?", "مجھے کیسے پتا چلے گا کہ میرا عطیہ موصول ہوگیا؟")}</summary><p className="muted">{config.online_payments ? tr("Your gift shows as pending until Safepay confirms the payment. Then it turns completed in your dashboard and counts in the public reports. You can press “Check status” at any time.", "Safepay کی تصدیق تک آپ کا عطیہ زیرِ التوا رہتا ہے۔ پھر وہ ڈیش بورڈ میں مکمل ہو جاتا ہے اور عوامی رپورٹس میں شمار ہوتا ہے۔ آپ کسی بھی وقت ”حیثیت چیک کریں“ دبا سکتے ہیں۔") : tr("Your pledge first appears as pending in your dashboard. After the committee receives the funds, an administrator marks it completed, and it then counts in the public reports.", "آپ کا عطیہ پہلے ڈیش بورڈ میں زیرِ التوا نظر آتا ہے۔ کمیٹی کو رقم ملنے کے بعد ایڈمن اسے مکمل کر دیتا ہے اور پھر وہ عوامی رپورٹس میں شامل ہوتا ہے۔")}</p></details>
                  <details><summary>{tr("Can I support a specific project?", "کیا میں کسی مخصوص منصوبے کی مدد کر سکتا ہوں؟")}</summary><p className="muted">{tr("Yes. Pick a project on the donation form, or press “Support this project” on any project card.", "جی ہاں۔ عطیہ فارم میں منصوبہ منتخب کریں یا کسی بھی منصوبے کے کارڈ پر ”اس منصوبے کی مدد کریں“ دبائیں۔")}</p></details>
                  <details><summary>{tr("Who can see my donation details?", "میرے عطیات کی تفصیل کون دیکھ سکتا ہے؟")}</summary><p className="muted">{tr("Only you and the committee administrators. Public reports show totals only, never donor names.", "صرف آپ اور کمیٹی کے ایڈمنز۔ عوامی رپورٹس میں صرف مجموعی رقم ہوتی ہے، عطیہ دہندہ کا نام نہیں۔")}</p></details>
                  <details><summary>{tr("Can I download a statement?", "کیا میں اپنا اسٹیٹمنٹ ڈاؤن لوڈ کر سکتا ہوں؟")}</summary><p className="muted">{tr("Yes. Your dashboard has a PDF donation report you can download or print.", "جی ہاں۔ آپ کے ڈیش بورڈ پر PDF رپورٹ موجود ہے جسے ڈاؤن لوڈ یا پرنٹ کیا جا سکتا ہے۔")}</p></details>
                </div>
              </section>

              <section className="panel contact" id="contact">
                <div>
                  <span className="eyebrow">{tr("GET IN TOUCH", "رابطہ کریں")}</span>
                  <h2>{tr("We'd love to hear from you", "ہمیں آپ کے پیغام کا انتظار ہے")}</h2>
                  <p className="muted">{tr("Questions, ideas for a project, or want to volunteer? Send us a message and the committee will get back to you.", "سوال، کسی منصوبے کا مشورہ یا رضاکار بننا چاہتے ہیں؟ پیغام بھیجیں، کمیٹی آپ سے رابطہ کرے گی۔")}</p>
                  <p className="muted"><span aria-hidden="true">⌖</span> Chitta Batta</p>
                </div>
                <form className="form-grid single" onSubmit={sendContact}>
                  <label>{tr("Your name", "آپ کا نام")}<input name="name" required maxLength="100" autoComplete="name" defaultValue={user?.full_name || ""} /></label>
                  <label>{tr("Email address", "ای میل ایڈریس")}<input name="email" type="email" required autoComplete="email" defaultValue={user?.email || ""} /></label>
                  <label>{tr("Message", "پیغام")}<textarea name="message" rows="4" required maxLength="3000" /></label>
                  <button className="button button-primary" type="submit" disabled={busy}>{tr("Send message", "پیغام بھیجیں")} →</button>
                </form>
              </section>
            </>
          )}

          {/* ════════════ DASHBOARD ════════════ */}
          {page === "dashboard" && (
            <>
              {!user ? (
                <section className="panel">
                  <span className="eyebrow">{tr("YOUR PERSONAL SPACE", "آپ کی ذاتی جگہ")}</span>
                  <h2>{tr("Sign in to see your dashboard", "ڈیش بورڈ دیکھنے کے لیے لاگ اِن کریں")}</h2>
                  <p className="muted">{tr("Register to review your donation records and follow your contributions.", "اپنے عطیات کا ریکارڈ دیکھنے کے لیے رجسٹر کریں۔")}</p>
                  <button className="button button-primary" onClick={() => openAuth("login")}>{tr("Sign in", "لاگ اِن")}</button>
                </section>
              ) : (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">{tr("YOUR PERSONAL SPACE", "آپ کی ذاتی جگہ")}</span>
                      <h2>{tr(`Welcome, ${user.full_name.split(" ")[0]}`, `خوش آمدید، ${user.full_name.split(" ")[0]}`)}</h2>
                      <p className="muted">{tr("Here's an overview of your contributions and recent activity.", "یہاں آپ کے عطیات اور حالیہ سرگرمیوں کا خلاصہ ہے۔")}</p>
                    </div>
                    <button className="button button-primary" onClick={() => donateTo("")}>+ {tr("Make a donation", "عطیہ دیں")}</button>
                  </div>

                  <div className="stats-grid four">
                    <article className="stat-card"><span>{tr("Total contributed", "کل عطیہ")}</span><strong>{money(dashboard?.summary?.total_amount)}</strong><small>{tr("Confirmed donations only", "صرف تصدیق شدہ عطیات")}</small></article>
                    <article className="stat-card"><span>{tr("Donation records", "عطیات کے ریکارڈ")}</span><strong>{dashboard?.summary?.total_donations ?? 0}</strong><small>{tr("Including pending", "زیرِ التوا سمیت")}</small></article>
                    <article className="stat-card"><span>{tr("Pending", "زیرِ التوا")}</span><strong>{pendingMine}</strong><small>{tr("Awaiting confirmation", "تصدیق کے منتظر")}</small></article>
                    <article className="stat-card"><span>{tr("Projects supported", "معاونت شدہ منصوبے")}</span><strong>{projectsSupported}</strong><small>{tr("With completed gifts", "مکمل عطیات کے ساتھ")}</small></article>
                  </div>

                  <div className="two-col wide-left">
                    <section className="panel">
                      <h3>{tr("Your giving, last 6 months", "آپ کے عطیات، گزشتہ 6 ماہ")}</h3>
                      <TrendChart series={myMonthly} labels={trendLabels} />
                    </section>
                    <section className="panel">
                      <h3>{tr("Your member card", "آپ کا ممبر کارڈ")}</h3>
                      <div className="member-card">
                        <span className="brand-mark">NI</span>
                        <strong>{user.full_name}</strong>
                        <small>{user.email}</small>
                        <small>{tr("Member since", "رکن بنے")} {formatDate(user.created_at)}</small>
                      </div>
                    </section>
                  </div>

                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h3>{tr("Donation history", "عطیات کی تاریخ")}</h3>
                        <p className="muted">{tr("A record of your latest contributions.", "آپ کے حالیہ عطیات کا ریکارڈ۔")}</p>
                      </div>
                      <button className="button button-light" onClick={() => loadDashboard(token)}>↻ {tr("Refresh", "تازہ کریں")}</button>
                    </div>
                    <div className="chips">
                      {["all", "pending", "completed", "failed", "cancelled", "expired", "refunded"].map((s) => (
                        <button key={s} className={`chip ${donationFilter === s ? "active" : ""}`} onClick={() => setDonationFilter(s)}>{s}</button>
                      ))}
                    </div>
                    <div className="table-wrap stack">
                      <table>
                        <thead><tr><th>{tr("Date", "تاریخ")}</th><th>{tr("Amount", "رقم")}</th><th>{tr("Project", "منصوبہ")}</th><th>{tr("Method", "طریقہ")}</th><th>{tr("Status", "حیثیت")}</th><th /></tr></thead>
                        <tbody>
                          {filteredMyDonations.map((item) => (
                            <tr key={item.id}>
                              <td data-label={tr("Date", "تاریخ")}>{formatDate(item.donation_date)}</td>
                              <td data-label={tr("Amount", "رقم")}>{money(item.amount)}</td>
                              <td data-label={tr("Project", "منصوبہ")}>{item.project_title || tr("General fund", "عمومی فنڈ")}</td>
                              <td data-label={tr("Method", "طریقہ")}>{methodLabel(item.payment_method, item.payment_channel)}</td>
                              <td data-label={tr("Status", "حیثیت")}><span className={`status ${item.payment_status}`}>{item.payment_status}</span></td>
                              <td className="row-actions">
                                {item.payment_status === "pending" && config.online_payments && item.payment_method === "safepay" && (
                                  <>
                                    <button className="button button-primary mini" onClick={() => payNow(item.id)}>{tr("Pay now", "ادائیگی کریں")}</button>
                                    <button className="text-button" onClick={() => checkPayment(item.id)}>{tr("Check status", "حیثیت چیک کریں")}</button>
                                  </>
                                )}
                                {item.payment_status === "pending" && <button className="text-button danger-text" onClick={() => cancelDonation(item.id)}>{tr("Cancel", "منسوخ")}</button>}
                              </td>
                            </tr>
                          ))}
                          {!filteredMyDonations.length && (
                            <tr className="empty-row"><td colSpan="6">
                              <div className="empty-state">
                                <span className="empty-icon"><Glyph name="donate" size={26} /></span>
                                <strong>{myDonations.length ? tr("Nothing matches this filter", "اس فلٹر سے کچھ نہیں ملا") : tr("Your giving story starts here", "آپ کی خدمت کی کہانی یہاں سے شروع ہوتی ہے")}</strong>
                                <p className="muted">{myDonations.length ? tr("Try another status above.", "اوپر سے کوئی اور حیثیت منتخب کریں۔") : tr("Your contributions will appear here, with their payment status.", "آپ کے عطیات ادائیگی کی حیثیت کے ساتھ یہاں دکھائی دیں گے۔")}</p>
                                {!myDonations.length && <button className="button button-primary mini" onClick={() => donateTo("")}>♡ {tr("Make your first donation", "پہلا عطیہ دیں")}</button>}
                              </div>
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <DonationReport user={user} donations={myDonations} summary={dashboard?.summary} />
                </>
              )}
            </>
          )}

          {/* ════════════ DONATE ════════════ */}
          {page === "donate" && (
            <div className="two-col wide-left">
              <section className="panel">
                <span className="eyebrow">{tr("SUPPORT THE COMMUNITY", "کمیونٹی کی مدد کریں")}</span>
                <h2>{tr("Make a contribution", "عطیہ دیں")}</h2>

                {!user ? (
                  <>
                    <p className="muted">{tr("Sign in to create a donation record.", "عطیہ درج کرنے کے لیے لاگ اِن کریں۔")}</p>
                    <button className="button button-primary" onClick={() => openAuth("login")}>{tr("Sign in to continue", "جاری رکھنے کے لیے لاگ اِن کریں")}</button>
                  </>
                ) : lastPledge ? (
                  <div className="pledge-done">
                    <div className="check-ring">✓</div>
                    <h3>{tr("Thank you! Your pledge is recorded.", "شکریہ! آپ کا عطیہ درج ہوگیا۔")}</h3>
                    <p className="muted">
                      {tr(
                        `Pledge #${lastPledge.id} for ${money(lastPledge.amount)}${lastPledge.project ? ` to “${lastPledge.project}”` : ""} is pending. No money has been taken online. ${config.online_payments ? "You can pay any time from your dashboard." : "Please hand over the amount to the committee; an administrator will mark it completed once received."}`,
                        `عطیہ نمبر ${lastPledge.id}، رقم ${money(lastPledge.amount)}${lastPledge.project ? ` (${lastPledge.project})` : ""} زیرِ التوا ہے۔ آن لائن کوئی رقم وصول نہیں کی گئی۔ ${config.online_payments ? "آپ ڈیش بورڈ سے کسی بھی وقت ادائیگی کر سکتے ہیں۔" : "براہ کرم رقم کمیٹی کے حوالے کریں؛ موصول ہونے پر ایڈمن اسے مکمل کر دے گا۔"}`
                      )}
                    </p>
                    <div className="hero-actions">
                      <button className="button button-primary" onClick={() => go("dashboard")}>{tr("View my donations", "میرے عطیات دیکھیں")}</button>
                      <button className="button button-light" onClick={() => setLastPledge(null)}>{tr("Give again", "دوبارہ عطیہ دیں")}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="muted">
                      {config.online_payments
                        ? tr("Choose an amount, then you'll be taken to Safepay's secure page to complete your payment. Your gift is counted only after Safepay confirms it.", "رقم منتخب کریں، پھر آپ کو ادائیگی مکمل کرنے کے لیے Safepay کے محفوظ صفحے پر لے جایا جائے گا۔ آپ کا عطیہ Safepay کی تصدیق کے بعد ہی شمار ہوگا۔")
                        : tr("This form creates a pending pledge and does not charge your card. An administrator marks it completed once the funds are received.", "یہ فارم زیرِ التوا عطیہ بناتا ہے اور آپ کے کارڈ سے رقم نہیں کاٹتا۔ رقم موصول ہونے پر ایڈمن اسے مکمل کر دیتا ہے۔")}
                    </p>
                    {config.online_payments && config.sandbox && (
                      <p className="sandbox-note"><Icon name="alert" size={16} /> {tr("Test mode: payments use Safepay's sandbox, so no real money moves. Use Safepay's test card.", "ٹیسٹ موڈ: ادائیگیاں Safepay کے سینڈ باکس پر ہوتی ہیں، اصل رقم منتقل نہیں ہوتی۔")}</p>
                    )}
                    <form onSubmit={createDonation} className="donate-form">
                      <fieldset>
                        <legend>{tr("Choose an amount (PKR)", "رقم منتخب کریں (روپے)")}</legend>
                        <div className="presets">
                          {PRESETS.map((value) => (
                            <button type="button" key={value} className={`preset ${Number(selectedAmount) === value ? "active" : ""}`} onClick={() => setSelectedAmount(String(value))}>
                              {value.toLocaleString("en-PK")}
                            </button>
                          ))}
                        </div>
                        <label className="custom-amount">
                          {tr("Or enter another amount", "یا کوئی اور رقم درج کریں")}
                          <input name="amount" type="number" min="10" max="1000000" step="1" inputMode="numeric" value={selectedAmount} onChange={(e) => setSelectedAmount(e.target.value)} placeholder={tr("Enter amount", "رقم درج کریں")} required aria-invalid={selectedAmount !== "" && !amountOk} aria-describedby="amount-help" />
                        </label>
                        <small id="amount-help" className={`field-help ${selectedAmount !== "" && !amountOk ? "bad" : ""}`} role={selectedAmount !== "" && !amountOk ? "alert" : undefined}>
                          {selectedAmount !== "" && !amountOk
                            ? tr("Enter a whole number of rupees between 10 and 1,000,000.", "10 سے 10,00,000 کے درمیان پوری رقم روپوں میں درج کریں۔")
                            : tr("Whole rupees, from PKR 10 up to PKR 1,000,000.", "پوری رقم روپوں میں، کم از کم 10 اور زیادہ سے زیادہ 10,00,000۔")}
                        </small>
                      </fieldset>

                      {config.online_payments && (config.channels || []).length > 1 && (
                        <fieldset>
                          <legend>{tr("Pay with", "ادائیگی کا طریقہ")}</legend>
                          <div className="channels" role="radiogroup">
                            {config.channels.map((c) => (
                              <button type="button" role="radio" aria-checked={channel === c} key={c} className={`channel ${channel === c ? "active" : ""}`} onClick={() => setChannel(c)}>
                                <span className={`channel-badge ${c}`} aria-hidden="true">{c === "card" ? "▭" : c === "easypaisa" ? "e" : "J"}</span>
                                {CHANNEL_NAMES[c]}
                              </button>
                            ))}
                          </div>
                          <small className="muted">{tr("You will finish the payment on Safepay's secure page.", "ادائیگی Safepay کے محفوظ صفحے پر مکمل ہوگی۔")}</small>
                        </fieldset>
                      )}

                      <label>{tr("Dedicate to a project (optional)", "منصوبے کے لیے مختص کریں (اختیاری)")}
                        <select value={donateProject} onChange={(e) => setDonateProject(e.target.value)}>
                          <option value="">{tr("General fund — where it's needed most", "عمومی فنڈ — جہاں سب سے زیادہ ضرورت ہو")}</option>
                          {projects.filter((p) => p.status === "planned" || p.status === "ongoing").map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                      </label>

                      <label>{tr("Note (optional)", "نوٹ (اختیاری)")}<input name="note" maxLength="255" placeholder={tr("e.g. in memory of…", "مثلاً کسی کی یاد میں…")} /></label>

                      <div className="donate-summary" aria-live="polite">
                        <div className="sum-row"><span>{tr("Your gift", "آپ کا عطیہ")}</span><strong className="sum-amount">{amountOk ? money(amountNum) : "—"}</strong></div>
                        <div className="sum-row"><span>{tr("Goes to", "کہاں جائے گا")}</span><strong>{donateProjectTitle || tr("General fund", "عمومی فنڈ")}</strong></div>
                        <div className="sum-row"><span>{tr("Paid with", "ادائیگی")}</span><strong>{config.online_payments ? `Safepay · ${CHANNEL_NAMES[channel] || channel}` : tr("Pledge (no payment now)", "عہد (ابھی ادائیگی نہیں)")}</strong></div>
                        <p className="muted">{config.online_payments ? tr("You'll review and pay on Safepay's secure page. Your card details never touch this website.", "آپ Safepay کے محفوظ صفحے پر ادائیگی کا جائزہ لے کر مکمل کریں گے۔ آپ کے کارڈ کی تفصیلات اس ویب سائٹ تک نہیں پہنچتیں۔") : tr("No money is taken now. The committee will confirm once the funds are received.", "ابھی کوئی رقم نہیں لی جاتی۔ رقم موصول ہونے پر کمیٹی تصدیق کرے گی۔")}</p>
                      </div>

                      <button className="button button-primary pay-btn" type="submit" disabled={paying || !amountOk}>
                        {config.online_payments ? <>🔒 {tr("Continue to secure payment", "محفوظ ادائیگی کی طرف بڑھیں")}</> : <>♡ {tr("Create pledge", "عطیہ درج کریں")}</>}
                        {selectedAmount ? ` · ${money(selectedAmount)}` : ""}
                      </button>
                    </form>
                  </>
                )}
              </section>

              <aside className="panel impact-side">
                <h3>{tr("Why it matters", "یہ کیوں اہم ہے")}</h3>
                <ul className="facts">
                  <li><span>{tr("Funds raised", "جمع شدہ فنڈز")}</span><strong>{money(stats?.total_raised)}</strong></li>
                  <li><span>{tr("Donors", "عطیہ دہندگان")}</span><strong>{stats?.donor_count ?? 0}</strong></li>
                  <li><span>{tr("Projects running", "جاری منصوبے")}</span><strong>{stats?.projects_ongoing ?? 0}</strong></li>
                </ul>
                <p className="muted">{tr("Every donation is recorded, reported monthly, and spent only on documented community needs.", "ہر عطیہ درج ہوتا ہے، ماہانہ رپورٹ میں شامل ہوتا ہے اور صرف دستاویزی کمیونٹی ضرورتوں پر خرچ ہوتا ہے۔")}</p>
                <ul className="assurances">
                  {config.online_payments && <li><Icon name="lock" size={16} /><span>{tr("Payment happens on Safepay's hosted page. We never see your card.", "ادائیگی Safepay کے محفوظ صفحے پر ہوتی ہے۔ ہم آپ کا کارڈ نہیں دیکھتے۔")}</span></li>}
                  <li><Icon name="check" size={16} /><span>{config.online_payments ? tr("A gift counts only after Safepay confirms it.", "عطیہ Safepay کی تصدیق کے بعد ہی شمار ہوتا ہے۔") : tr("A gift counts once the committee confirms it.", "عطیہ کمیٹی کی تصدیق کے بعد شمار ہوتا ہے۔")}</span></li>
                  <li><Icon name="report" size={16} /><span>{tr("Confirmed gifts appear in the monthly report. Donor names stay private.", "تصدیق شدہ عطیات ماہانہ رپورٹ میں شامل ہوتے ہیں۔ عطیہ دہندگان کے نام خفیہ رہتے ہیں۔")}</span></li>
                </ul>
              </aside>
            </div>
          )}

          {/* ════════════ PROJECTS ════════════ */}
          {page === "projects" && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{tr("COMMUNITY DEVELOPMENT", "کمیونٹی کی ترقی")}</span>
                  <h2>{tr("Welfare projects", "فلاحی منصوبے")}</h2>
                  <p className="muted">{tr("Explore initiatives serving the people of Chitta Batta.", "چھٹہ بٹہ کے لوگوں کے لیے جاری فلاحی سرگرمیاں دیکھیں۔")}</p>
                </div>
              </div>
              <div className="toolbar">
                <input type="search" placeholder={tr("Search projects…", "منصوبے تلاش کریں…")} value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} />
                <div className="chips">
                  {["all", "ongoing", "planned", "completed", "cancelled"].map((s) => (
                    <button key={s} className={`chip ${projectFilter === s ? "active" : ""}`} onClick={() => setProjectFilter(s)}>{s === "all" ? tr("All", "سب") : statusLabel(s)}</button>
                  ))}
                </div>
              </div>
              <div className="cards-grid">
                {publicLoading && [1, 2].map((i) => <div className="panel" key={i}><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line" /></div>)}
                {filteredProjects.map((p) => renderProject(p))}
                {!publicLoading && !filteredProjects.length && (
                  <div className="panel">
                    <h3>{tr("No projects found", "کوئی منصوبہ نہیں ملا")}</h3>
                    <p className="muted">{tr("Try a different filter, or check again later for new community initiatives.", "کوئی اور فلٹر آزمائیں یا نئے منصوبوں کے لیے بعد میں دیکھیں۔")}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ════════════ ANNOUNCEMENTS ════════════ */}
          {page === "announcements" && (
            <>
              <span className="eyebrow">{tr("NEWS & UPDATES", "خبریں اور اپ ڈیٹس")}</span>
              <h2>{tr("Community announcements", "کمیونٹی کے اعلانات")}</h2>
              <p className="muted">{tr("Stay informed about welfare activities and community updates.", "فلاحی سرگرمیوں اور کمیونٹی کی تازہ خبروں سے باخبر رہیں۔")}</p>
              <div className="toolbar">
                <input type="search" placeholder={tr("Search announcements…", "اعلانات تلاش کریں…")} value={announcementSearch} onChange={(e) => setAnnouncementSearch(e.target.value)} />
              </div>
              {filteredAnnouncements.map((item) => (
                <article className="panel announcement" key={item.id}>
                  <time className="ann-date" dateTime={item.created_at}>
                    <b>{new Date(item.created_at).getDate() || "—"}</b>
                    <span>{new Date(item.created_at).toLocaleDateString("en-GB", { month: "short" })}</span>
                    <small>{new Date(item.created_at).getFullYear() || ""}</small>
                  </time>
                  <div className="ann-body">
                    <span className="eyebrow">{tr("COMMUNITY UPDATE", "کمیونٹی اپ ڈیٹ")}</span>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <small className="muted">{tr("Published", "شائع ہوا")}: {formatDate(item.created_at)}</small>
                  </div>
                </article>
              ))}
              {!filteredAnnouncements.length && (
                <div className="panel">
                  <h3>{tr("No announcements found", "کوئی اعلان نہیں ملا")}</h3>
                  <p className="muted">{tr("New announcements will appear here when published.", "نئے اعلانات شائع ہونے پر یہاں دکھائی دیں گے۔")}</p>
                </div>
              )}
            </>
          )}

          {/* ════════════ REPORT ════════════ */}
          {page === "report" && (
            <>
              <section className="panel">
                <span className="eyebrow">{tr("PUBLIC ACCOUNTABILITY", "عوامی جواب دہی")}</span>
                <h2>{tr("Monthly financial report", "ماہانہ مالیاتی رپورٹ")}</h2>
                <p className="muted">{tr("Review recorded donations and expenses for a selected month.", "منتخب مہینے کے عطیات اور اخراجات کا ریکارڈ دیکھیں۔")}</p>
                <div className="month-nav">
                  <button className="button button-light" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={tr("Previous month", "پچھلا مہینہ")}>‹</button>
                  <label>
                    <span className="sr-only">{tr("Select month", "مہینہ منتخب کریں")}</span>
                    <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
                  </label>
                  <button className="button button-light" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()} aria-label={tr("Next month", "اگلا مہینہ")}>›</button>
                  <button className="button button-light" onClick={() => setMonth(currentMonth())}>{tr("This month", "یہ مہینہ")}</button>
                </div>

                {!report && (
                  <div aria-busy="true" aria-label={tr("Loading report", "رپورٹ لوڈ ہو رہی ہے")}>
                    <div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line" />
                  </div>
                )}

                {report && (
                  <>
                    <h3 className="report-title">{monthLabel(report.month, true)}</h3>
                    <div className="stats-grid four report-grid">
                      <article className="stat-card opening"><span>{tr("Opening balance", "ابتدائی بیلنس")}</span><strong>{money(report.opening_balance)}</strong></article>
                      <i className="op" aria-hidden="true">+</i>
                      <article className="stat-card donations"><span>{tr("Donations received", "وصول شدہ عطیات")}</span><strong>{money(report.donations_received)}</strong><small>{report.donation_count} {report.donation_count === 1 ? tr("record", "ریکارڈ") : tr("records", "ریکارڈ")}</small></article>
                      <i className="op" aria-hidden="true">−</i>
                      <article className="stat-card expenses"><span>{tr("Expenses paid", "ادا شدہ اخراجات")}</span><strong>{money(report.expenses_paid)}</strong><small>{report.expense_count} {report.expense_count === 1 ? tr("record", "ریکارڈ") : tr("records", "ریکارڈ")}</small></article>
                      <i className="op" aria-hidden="true">=</i>
                      <article className="stat-card closing"><span>{tr("Closing balance", "اختتامی بیلنس")}</span><strong>{money(report.closing_balance)}</strong></article>
                    </div>

                    <div className="flow">
                      <div className="flow-head">
                        <span>{tr("Funds used this month", "اس ماہ استعمال شدہ فنڈز")}</span>
                        <strong>{Math.round(pct(report.expenses_paid, report.opening_balance + report.donations_received))}%</strong>
                      </div>
                      <ProgressBar value={pct(report.expenses_paid, report.opening_balance + report.donations_received)} tone="amber" label={tr("Funds used", "استعمال شدہ فنڈز")} />
                      <small className="muted">{tr("Expenses as a share of opening balance plus donations.", "اخراجات بطور حصہ ابتدائی بیلنس اور عطیات۔")}</small>
                    </div>
                    <p className="muted">{tr("Report period", "رپورٹ کا عرصہ")}: {month}. {tr("These figures reflect the records currently in the database.", "یہ اعداد و شمار ڈیٹا بیس میں موجودہ ریکارڈ کے مطابق ہیں۔")}</p>
                  </>
                )}
                <p className="muted">{tr("Only donations marked completed are counted. Reports depend on the accuracy and completeness of recorded transactions and expenses.", "صرف مکمل قرار دیے گئے عطیات شمار کیے جاتے ہیں۔ رپورٹ درج شدہ لین دین اور اخراجات کے درست اور مکمل ریکارڈ پر منحصر ہے۔")}</p>
              </section>

              <div className="two-col">
                <section className="panel">
                  <h3>{tr("Since the beginning", "آغاز سے اب تک")}</h3>
                  <ul className="facts">
                    <li><span>{tr("Total raised", "کل جمع")}</span><strong>{money(stats?.total_raised)}</strong></li>
                    <li><span>{tr("Total spent", "کل خرچ")}</span><strong>{money(stats?.total_spent)}</strong></li>
                    <li><span>{tr("Balance in hand", "موجودہ بیلنس")}</span><strong>{money(stats?.balance)}</strong></li>
                    <li><span>{tr("Completed donations", "مکمل عطیات")}</span><strong>{stats?.donation_count ?? 0}</strong></li>
                  </ul>
                </section>
                <section className="panel">
                  <h3>{tr("Spending by category", "قسم کے لحاظ سے خرچ")}</h3>
                  <DonutChart data={(stats?.expense_categories || []).map((c) => ({ label: c.category, value: c.total }))} emptyText={tr("No expenses recorded yet.", "ابھی کوئی اخراجات درج نہیں۔")} />
                </section>
              </div>
            </>
          )}

          {/* ════════════ PROFILE ════════════ */}
          {page === "profile" && (
            <>
              {!user ? (
                <section className="panel">
                  <h2>{tr("Sign in to manage your profile", "پروفائل کے لیے لاگ اِن کریں")}</h2>
                  <button className="button button-primary" onClick={() => openAuth("login")}>{tr("Sign in", "لاگ اِن")}</button>
                </section>
              ) : (
                <>
                  <span className="eyebrow">{tr("ACCOUNT", "اکاؤنٹ")}</span>
                  <h2>{tr("My profile", "میری پروفائل")}</h2>
                  <div className="two-col">
                    <section className="panel">
                      <h3>{tr("Personal details", "ذاتی تفصیلات")}</h3>
                      <form className="form-grid single" key={user.id + user.full_name} onSubmit={saveProfile}>
                        <label>{tr("Full name", "پورا نام")}<input name="full_name" required maxLength="100" defaultValue={user.full_name} /></label>
                        <label>{tr("Phone number", "فون نمبر")}<input name="phone" type="tel" maxLength="25" defaultValue={user.phone || ""} /></label>
                        <label>{tr("Email address", "ای میل ایڈریس")}<input value={user.email} disabled readOnly /></label>
                        <button className="button button-primary" type="submit">{tr("Save changes", "تبدیلیاں محفوظ کریں")}</button>
                      </form>
                    </section>
                    <section className="panel">
                      <h3>{tr("Change password", "پاس ورڈ تبدیل کریں")}</h3>
                      <form className="form-grid single" onSubmit={changePassword}>
                        <label>{tr("Current password", "موجودہ پاس ورڈ")}<input name="current_password" type="password" required autoComplete="current-password" /></label>
                        <label>{tr("New password", "نیا پاس ورڈ")}<input name="new_password" type="password" required minLength="8" autoComplete="new-password" /></label>
                        <label>{tr("Confirm new password", "نئے پاس ورڈ کی تصدیق")}<input name="confirm_password" type="password" required minLength="8" autoComplete="new-password" /></label>
                        <button className="button button-primary" type="submit">{tr("Update password", "پاس ورڈ اپ ڈیٹ کریں")}</button>
                      </form>
                    </section>
                  </div>
                </>
              )}
            </>
          )}

          {/* ════════════ ADMIN ════════════ */}
          {page === "admin" && (
            !isAdmin ? (
              <section className="panel">
                <span className="eyebrow">{tr("RESTRICTED AREA", "محدود رسائی")}</span>
                <h2>{tr("Administrator access required", "ایڈمن کی اجازت ضروری ہے")}</h2>
                <p className="muted">{tr("Sign in with an account that has been promoted to administrator.", "ایسے اکاؤنٹ سے لاگ اِن کریں جسے ایڈمن کی اجازت حاصل ہو۔")}</p>
                {!user && <button className="button button-primary" onClick={() => openAuth("login")}>{tr("Sign in", "لاگ اِن")}</button>}
              </section>
            ) : (
              <Suspense fallback={<section className="panel" aria-busy="true"><div className="skeleton-line wide" /><div className="skeleton-line" /></section>}>
                <AdminPanel token={token} tr={tr} projects={projects} reloadPublic={loadPublic} notify={notify} fail={fail} currentUserId={user.id} />
              </Suspense>
            )
          )}
        </section>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true">NI</span>
          <div>
            <strong>{tr("Nojawan Itehad Welfare", "نوجوان اتحاد ویلفیئر")}</strong>
            <span>{tr("Community welfare · Chitta Batta", "کمیونٹی ویلفیئر · چھٹہ بٹہ")}</span>
            <small>{tr("Every confirmed rupee is reported openly.", "ہر تصدیق شدہ روپیہ کھلے عام رپورٹ ہوتا ہے۔")}</small>
          </div>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <button onClick={() => go("projects")}>{tr("Projects", "منصوبے")}</button>
          <button onClick={() => go("report")}>{tr("Reports", "رپورٹس")}</button>
          <button onClick={() => go("announcements")}>{tr("News", "خبریں")}</button>
          <button onClick={() => { go("home"); setTimeout(() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" }), 80); }}>{tr("Contact", "رابطہ")}</button>
        </nav>
      </footer>

      {page !== "donate" && !authOpen && (
        <button type="button" className="button button-gold mobile-donate" onClick={() => donateTo("")}>♡ {tr("Donate", "عطیہ دیں")}</button>
      )}

      {/* Toasts */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}${t.leaving ? " leaving" : ""}`} role={t.type === "error" ? "alert" : "status"}>
            <span aria-hidden="true">{t.type === "error" ? "!" : "✓"}</span>
            <p>{t.text}</p>
            <button aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>

      {/* Sign in / Register modal */}
      {authOpen && (
        <div className={`auth-modal-overlay${authLeaving ? " leaving" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) closeAuth(); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
            <button type="button" className="auth-modal-close" onClick={closeAuth} disabled={busy} aria-label="Close sign in dialog">×</button>

            <div className="auth-modal-heading">
              <span className="brand-mark">NI</span>
              <span className="eyebrow">{tr("YOUR COMMUNITY ACCOUNT", "آپ کا کمیونٹی اکاؤنٹ")}</span>
              <h2 id="auth-modal-title">{mode === "verify" ? tr("Verify your email", "اپنی ای میل کی تصدیق کریں") : mode === "login" ? tr("Welcome back", "دوبارہ خوش آمدید") : tr("Join our community", "ہماری کمیونٹی میں شامل ہوں")}</h2>
              <p className="muted">
                {mode === "verify"
                  ? tr("Your account opens once you enter the code we emailed you.", "ای میل پر بھیجا گیا کوڈ درج کرنے کے بعد آپ کا اکاؤنٹ کھل جائے گا۔")
                  : mode === "login"
                  ? tr("Sign in to access your dashboard and donation history.", "اپنا ڈیش بورڈ اور عطیات کی تاریخ دیکھنے کے لیے لاگ اِن کریں۔")
                  : tr("Create your account to join our welfare community.", "ہماری فلاحی کمیونٹی میں شامل ہونے کے لیے اکاؤنٹ بنائیں۔")}
              </p>
            </div>

            {authError && <div className="notice error" role="alert"><span aria-hidden="true">!</span> {authError}</div>}
            {authMessage && <div className="notice success" role="status"><span aria-hidden="true">✓</span> {authMessage}</div>}

            <form className="form-grid auth-modal-form" onSubmit={submitAuth}>
              {mode === "verify" ? (
                <label className="full-width">{tr("Verification code", "تصدیقی کوڈ")}<input key="otp" className="otp-input" name="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="000000" required autoComplete="one-time-code" autoFocus /></label>
              ) : (
                <>
                  {mode === "register" && (
                    <>
                      <label className="full-width">{tr("Full name", "پورا نام")}<input name="full_name" placeholder={tr("Enter your full name", "اپنا پورا نام درج کریں")} required maxLength="100" autoComplete="name" autoFocus /></label>
                      <label className="full-width">{tr("Phone number", "فون نمبر")}<input name="phone" type="tel" placeholder={tr("Optional", "اختیاری")} autoComplete="tel" /></label>
                    </>
                  )}
                  <label className="full-width">{tr("Email address", "ای میل ایڈریس")}<input name="email" type="email" placeholder="you@example.com" required autoComplete="email" autoFocus={mode === "login"} /></label>
                  <label className="full-width">{tr("Password", "پاس ورڈ")}<input name="password" type="password" placeholder={tr("At least 8 characters", "کم از کم 8 حروف")} minLength="8" required autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
                </>
              )}
              <button className="button button-primary full-width" type="submit" disabled={busy}>
                {busy ? tr("Please wait...", "براہ کرم انتظار کریں...") : mode === "verify" ? tr("Verify and continue →", "تصدیق کریں اور جاری رکھیں →") : mode === "login" ? tr("Sign in to your account →", "اپنے اکاؤنٹ میں لاگ اِن کریں →") : tr("Create my account →", "میرا اکاؤنٹ بنائیں →")}
              </button>
            </form>

            {mode === "verify" ? (
              <p className="switch-mode auth-modal-switch">
                {tr("Didn't get the code?", "کوڈ نہیں ملا؟")}{" "}
                <button type="button" className="text-button" onClick={resendCode} disabled={busy}>{tr("Send again", "دوبارہ بھیجیں")}</button>
                {" · "}
                <button type="button" className="text-button" onClick={() => openAuth("register")} disabled={busy}>{tr("Use a different email", "دوسری ای میل استعمال کریں")}</button>
              </p>
            ) : (
              <p className="switch-mode auth-modal-switch">
                {mode === "login" ? tr("Don't have an account?", "اکاؤنٹ نہیں ہے؟") : tr("Already have an account?", "پہلے سے اکاؤنٹ موجود ہے؟")}{" "}
                <button type="button" className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setAuthError(""); setAuthMessage(""); }} disabled={busy}>
                  {mode === "login" ? tr("Register here", "یہاں رجسٹر کریں") : tr("Sign in", "لاگ اِن کریں")}
                </button>
              </p>
            )}
            <p className="auth-modal-footer">{tr("Nojawan Itehad Welfare · Chitta Batta", "نوجوان اتحاد ویلفیئر · چھٹہ بٹہ")}</p>
          </section>
        </div>
      )}
    </div>
  );
}
