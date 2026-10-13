
import { useEffect, useState } from "react";
import DonationReport from "./DonationReport";
import { useLanguage } from "./LanguageContext";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

async function api(path, { token, ...options } = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

function money(value) {
  return `PKR ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function App() {
  const { language, toggleLanguage } = useLanguage();
  const isUrdu = language === "ur";
  const tr = (english, urdu) => (isUrdu ? urdu : english);

  const [token, setToken] = useState(
    () => sessionStorage.getItem("welfare_token") || ""
  );
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(
    () => Boolean(sessionStorage.getItem("welfare_token"))
  );

  const [mode, setMode] = useState("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [dashboard, setDashboard] = useState(null);
  const [projects, setProjects] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [donors, setDonors] = useState([]);
  const [donations, setDonations] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [report, setReport] = useState(null);

  useEffect(() => {
    document.documentElement.lang = isUrdu ? "ur" : "en";
    document.documentElement.dir = isUrdu ? "rtl" : "ltr";
    document.body.classList.toggle("urdu-mode", isUrdu);
    localStorage.setItem("website-language", language);
  }, [language, isUrdu]);

  // Open the authentication popup.
  function openAuth(selectedMode = "login") {
    setMode(selectedMode);
    setError("");
    setMessage("");
    setAuthOpen(true);
  }

  function closeAuth() {
    if (busy) return;
    setAuthOpen(false);
    setError("");
  }

  // Close the popup with the Escape key.
  useEffect(() => {
    if (!authOpen) return;

    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) closeAuth();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [authOpen, busy]);

  async function loadPublic() {
    try {
      const [projectData, announcementData] = await Promise.all([
        api("/projects"),
        api("/announcements"),
      ]);
      setProjects(projectData.projects || []);
      setAnnouncements(announcementData.announcements || []);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadDashboard(currentToken = token) {
    if (!currentToken) return;

    try {
      const [profile, summary] = await Promise.all([
        api("/auth/me", { token: currentToken }),
        api("/dashboard", { token: currentToken }),
      ]);
      setUser(profile.user);
      setDashboard(summary);
    } catch (e) {
      if (
        e.message.toLowerCase().includes("token") ||
        e.message.toLowerCase().includes("authentication")
      ) {
        sessionStorage.removeItem("welfare_token");
        setToken("");
        setUser(null);
        setDashboard(null);
      }
      setError(e.message);
    } finally {
      setAuthLoading(false);
    }
  }

  useEffect(() => {
    loadPublic();
  }, []);

  useEffect(() => {
    if (token) {
      setAuthLoading(true);
      loadDashboard(token);
    } else {
      setAuthLoading(false);
    }
  }, [token]);

  async function submitAuth(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await api(
        mode === "login" ? "/auth/login" : "/auth/register",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      if (mode === "register") {
        setMessage(
          result.message ||
            tr(
              "Registration successful. Please sign in.",
              "رجسٹریشن کامیاب ہوگئی۔ براہ کرم لاگ اِن کریں۔"
            )
        );
        setMode("login");
        formElement.reset();
      } else {
        sessionStorage.setItem("welfare_token", result.token);
        setUser(result.user);
        setToken(result.token);
        setPage("dashboard");
        setAuthOpen(false);
        formElement.reset();
        setMessage(
          tr(
            `Welcome back, ${result.user.full_name}!`,
            `خوش آمدید، ${result.user.full_name}!`
          )
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("welfare_token");
    setToken("");
    setUser(null);
    setDashboard(null);
    setDonations([]);
    setExpenses([]);
    setDonors([]);
    setPage("dashboard");
    setMode("login");
    setAuthOpen(false);
    setError("");
    setMessage(
      tr(
        "You have logged out successfully.",
        "آپ کامیابی سے لاگ آؤٹ ہوگئے ہیں۔"
      )
    );
  }

  async function loadAdminData() {
    if (!token || user?.role !== "admin") return;

    try {
      const [donorData, donationData, expenseData] = await Promise.all([
        api("/admin/donors", { token }),
        api("/admin/donations", { token }),
        api("/expenses", { token }),
      ]);
      setDonors(donorData.users || []);
      setDonations(donationData.donations || []);
      setExpenses(expenseData.expenses || []);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadReport() {
    setError("");
    try {
      const result = await api(
        `/reports/monthly?month=${encodeURIComponent(month)}`,
        { token }
      );
      setReport(result);
    } catch (e) {
      setError(e.message);
    }
  }

  async function createDonation(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    setMessage("");

    try {
      const result = await api("/donations", {
        method: "POST",
        token,
        body: JSON.stringify({
          amount: Number(form.get("amount")),
          payment_method: "safepay",
        }),
      });
      setMessage(
        result.message ||
          tr(
            "Donation record created. Payment is not yet confirmed.",
            "عطیہ کا ریکارڈ بن گیا ہے۔ ادائیگی کی ابھی تصدیق نہیں ہوئی۔"
          )
      );
      formElement.reset();
      await loadDashboard(token);
    } catch (e) {
      setError(e.message);
    }
  }

  async function createProject(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    body.budget = Number(body.budget || 0);
    setError("");
    setMessage("");

    try {
      const result = await api("/projects", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMessage(result.message || tr("Project created successfully.", "منصوبہ کامیابی سے بنا دیا گیا۔"));
      formElement.reset();
      await loadPublic();
    } catch (e) {
      setError(e.message);
    }
  }

  async function createAnnouncement(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    setError("");
    setMessage("");

    try {
      const result = await api("/announcements", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMessage(result.message || tr("Announcement published successfully.", "اعلان کامیابی سے شائع ہوگیا۔"));
      formElement.reset();
      await loadPublic();
    } catch (e) {
      setError(e.message);
    }
  }

  async function createExpense(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    body.amount = Number(body.amount);
    body.project_id = body.project_id ? Number(body.project_id) : null;
    setError("");
    setMessage("");

    try {
      const result = await api("/expenses", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMessage(result.message || tr("Expense recorded successfully.", "اخراجات کا اندراج ہوگیا۔"));
      formElement.reset();
      await loadAdminData();
    } catch (e) {
      setError(e.message);
    }
  }

  async function recordOfflineDonation(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    body.user_id = Number(body.user_id);
    body.amount = Number(body.amount);
    setError("");
    setMessage("");

    try {
      const result = await api("/donations/offline", {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMessage(result.message || tr("Offline donation recorded successfully.", "آف لائن عطیہ کامیابی سے درج ہوگیا۔"));
      formElement.reset();
      await loadAdminData();
    } catch (e) {
      setError(e.message);
    }
  }

  function go(nextPage) {
    setPage(nextPage);
    setError("");
    setMessage("");

    if (nextPage === "admin") loadAdminData();
    if (nextPage === "report") loadReport();
  }

  const navItems = [
    { key: "dashboard", label: tr("Dashboard", "ڈیش بورڈ"), icon: "⌂" },
    { key: "projects", label: tr("Welfare Projects", "فلاحی منصوبے"), icon: "◇" },
    { key: "announcements", label: tr("Announcements", "اعلانات"), icon: "◉" },
    { key: "report", label: tr("Financial Reports", "مالیاتی رپورٹس"), icon: "▤" },
    ...(user?.role === "admin"
      ? [{ key: "admin", label: tr("Admin Panel", "ایڈمن پینل"), icon: "⚙" }]
      : []),
  ];

  if (authLoading) {
    return (
      <div className="app-shell">
        <div className="panel" style={{ maxWidth: 480, margin: "100px auto" }}>
          <h2>{tr("Loading your account...", "آپ کا اکاؤنٹ لوڈ ہورہا ہے...")}</h2>
          <p className="muted">
            {tr("Please wait while we verify your session.", "براہ کرم انتظار کریں، ہم آپ کے اکاؤنٹ کی تصدیق کررہے ہیں۔")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            go("dashboard");
          }}
        >
          <span className="brand-mark">NI</span>
          <span>
            <strong>{tr("Nojawan Itehad", "نوجوان اتحاد")}</strong>
            <small>{tr("Welfare · Chitta Batta", "ویلفیئر · چھٹہ بٹہ")}</small>
          </span>
        </a>

        <div className="top-actions">
          <button
            type="button"
            className="button button-light"
            onClick={toggleLanguage}
            aria-label="Change website language"
          >
            {isUrdu ? "English" : "اردو"}
          </button>

          {user ? (
            <>
              <span className="welcome">
                <strong>{user.full_name}</strong>
                <small>
                  {user.role === "admin"
                    ? tr("Administrator", "منتظم")
                    : tr("Donor", "عطیہ دہندہ")}
                </small>
              </span>
              <button className="button button-light" onClick={logout}>
                {tr("Log out", "لاگ آؤٹ")}
              </button>
            </>
          ) : (
            <button
              className="button button-primary"
              onClick={() => openAuth("login")}
            >
              {tr("Sign in", "لاگ اِن")}
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">
            {tr("COMMUNITY · CARE · TRANSPARENCY", "کمیونٹی · خدمت · شفافیت")}
          </span>
          <h1>
            {tr("Small contributions.", "چھوٹا سا تعاون۔")}
            <br />
            {tr("Meaningful change.", "بامعنی تبدیلی۔")}
          </h1>
          <p>
            {tr(
              "Supporting welfare initiatives in Chitta Batta through community participation, responsible record keeping, and financial transparency.",
              "چھٹہ بٹہ میں کمیونٹی کی شرکت، ذمہ دارانہ ریکارڈ اور مالی شفافیت کے ذریعے فلاحی سرگرمیوں کی مدد کرنا۔"
            )}
          </p>

          {!user && (
            <button className="button button-primary" onClick={() => openAuth("register")}>
              {tr("Become a donor", "عطیہ دہندہ بنیں")} <span aria-hidden="true">→</span>
            </button>
          )}
          {user && (
            <button className="button button-primary" onClick={() => go("dashboard")}>
              {tr("Open my dashboard", "میرا ڈیش بورڈ کھولیں")} <span aria-hidden="true">→</span>
            </button>
          )}
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="hero-circle">✦</div>
          <div className="hero-note">{tr("Together, we can help.", "مل کر ہم مدد کرسکتے ہیں۔")}</div>
        </div>
      </section>

      <main className="main-layout">
        <aside className="sidebar">
          <p className="side-label">{tr("MAIN MENU", "مرکزی مینو")}</p>

          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? "active" : ""}`}
              onClick={() => go(item.key)}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-arrow" aria-hidden="true">›</span>
            </button>
          ))}

          {!user && (
            <button className="nav-item" onClick={() => openAuth("login")}>
              <span className="nav-icon" aria-hidden="true">↗</span>
              <span className="nav-label">{tr("Sign in / Register", "لاگ اِن / رجسٹریشن")}</span>
              <span className="nav-arrow" aria-hidden="true">›</span>
            </button>
          )}

          <div className="sidebar-note">
            <div className="trust-icon">✓</div>
            <strong>{tr("Built on trust", "اعتماد کی بنیاد پر")}</strong>
            <p>
              {tr(
                "Clear records help the community understand how contributions are recorded and spent.",
                "شفاف ریکارڈ کمیونٹی کو یہ سمجھنے میں مدد دیتا ہے کہ عطیات کیسے درج اور خرچ کیے جاتے ہیں۔"
              )}
            </p>
          </div>
        </aside>

        <section className="content">
          {message && (
            <div className="notice success" role="status">
              <span aria-hidden="true">✓</span> {message}
              <button className="notice-close" aria-label="Dismiss message" onClick={() => setMessage("")}>×</button>
            </div>
          )}
          {error && !authOpen && (
            <div className="notice error" role="alert">
              <span aria-hidden="true">!</span> {error}
              <button className="notice-close" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
            </div>
          )}

          {page === "dashboard" && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    {user ? tr("YOUR PERSONAL SPACE", "آپ کی ذاتی جگہ") : tr("WELCOME TO OUR COMMUNITY", "ہماری کمیونٹی میں خوش آمدید")}
                  </span>
                  <h2>
                    {user
                      ? tr(`Welcome, ${user.full_name.split(" ")[0]}`, `خوش آمدید، ${user.full_name.split(" ")[0]}`)
                      : tr("Community dashboard", "کمیونٹی ڈیش بورڈ")}
                  </h2>
                  <p className="muted">
                    {user
                      ? tr("Here's an overview of your contributions and recent activity.", "یہاں آپ کے عطیات اور حالیہ سرگرمیوں کا خلاصہ ہے۔")
                      : tr("Discover welfare projects and see how the community works together.", "فلاحی منصوبے دیکھیں اور جانیں کہ کمیونٹی مل کر کیسے کام کرتی ہے۔")}
                  </p>
                </div>
                {user && (
                  <button className="button button-primary" onClick={() => go("donate")}>
                    + {tr("Make a donation", "عطیہ دیں")}
                  </button>
                )}
              </div>

              {user ? (
                <>
                  <div className="stats-grid">
                    <article className="stat-card">
                      <span>{tr("Total donation records", "عطیات کے کل ریکارڈ")}</span>
                      <strong>{dashboard?.summary?.total_donations ?? 0}</strong>
                      <small>{tr("Your recorded contributions", "آپ کے درج شدہ عطیات")}</small>
                    </article>
                    <article className="stat-card">
                      <span>{tr("Completed contributions", "مکمل شدہ عطیات")}</span>
                      <strong>{money(dashboard?.summary?.total_amount)}</strong>
                      <small>{tr("Confirmed donations only", "صرف تصدیق شدہ عطیات")}</small>
                    </article>
                  </div>

                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h3>{tr("Recent donations", "حالیہ عطیات")}</h3>
                        <p className="muted">{tr("A record of your latest contributions.", "آپ کے حالیہ عطیات کا ریکارڈ۔")}</p>
                      </div>
                      <button className="button button-light" onClick={() => loadDashboard(token)}>
                        {tr("Refresh", "تازہ کریں")}
                      </button>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{tr("Date", "تاریخ")}</th>
                            <th>{tr("Amount", "رقم")}</th>
                            <th>{tr("Method", "طریقہ")}</th>
                            <th>{tr("Status", "حیثیت")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(dashboard?.recent_donations || []).map((item) => (
                            <tr key={item.id}>
                              <td>{formatDate(item.donation_date)}</td>
                              <td>{money(item.amount)}</td>
                              <td>{String(item.payment_method || "").replace("_", " ")}</td>
                              <td><span className={`status ${item.payment_status}`}>{item.payment_status}</span></td>
                            </tr>
                          ))}
                          {!dashboard?.recent_donations?.length && (
                            <tr><td colSpan="4">{tr("No donation records yet. Your contributions will appear here.", "ابھی عطیات کا کوئی ریکارڈ نہیں۔ آپ کے عطیات یہاں دکھائی دیں گے۔")}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <DonationReport user={user} donations={dashboard?.recent_donations || []} summary={dashboard?.summary} />
                </>
              ) : (
                <>
                  <div className="stats-grid">
                    <article className="stat-card">
                      <span>{tr("Community initiatives", "کمیونٹی کی سرگرمیاں")}</span>
                      <strong>{projects.length}</strong>
                      <small>{tr("Welfare projects listed", "درج فلاحی منصوبے")}</small>
                    </article>
                    <article className="stat-card">
                      <span>{tr("Latest updates", "تازہ ترین اپ ڈیٹس")}</span>
                      <strong>{announcements.length}</strong>
                      <small>{tr("Published announcements", "شائع شدہ اعلانات")}</small>
                    </article>
                  </div>
                  <section className="panel">
                    <span className="eyebrow">{tr("GET INVOLVED", "شامل ہوں")}</span>
                    <h3>{tr("Your community. Your contribution.", "آپ کی کمیونٹی، آپ کا تعاون۔")}</h3>
                    <p className="muted">
                      {tr(
                        "Register to access your own dashboard, review your donation records, and follow your contributions.",
                        "اپنا ڈیش بورڈ دیکھنے، عطیات کا ریکارڈ چیک کرنے اور اپنی معاونت کی تفصیلات جاننے کے لیے رجسٹر کریں۔"
                      )}
                    </p>
                    <button className="button button-primary" onClick={() => openAuth("register")}>
                      {tr("Create donor account →", "عطیہ دہندہ اکاؤنٹ بنائیں →")}
                    </button>
                  </section>
                </>
              )}
            </>
          )}

          {page === "donate" && (
            <section className="panel">
              <span className="eyebrow">{tr("SUPPORT THE COMMUNITY", "کمیونٹی کی مدد کریں")}</span>
              <h2>{tr("Make a contribution", "عطیہ دیں")}</h2>
              {!user ? (
                <>
                  <p className="muted">{tr("Sign in to create a donation record.", "عطیہ درج کرنے کے لیے لاگ اِن کریں۔")}</p>
                  <button className="button button-primary" onClick={() => openAuth("login")}>
                    {tr("Sign in to continue", "جاری رکھنے کے لیے لاگ اِن کریں")}
                  </button>
                </>
              ) : (
                <>
                  <p className="muted">
                    {tr(
                      "Enter the amount you intend to contribute. This form creates a pending donation record and does not charge your card. Online payments require configured Safepay checkout and verification.",
                      "عطیہ کی رقم درج کریں۔ یہ فارم زیرِ التوا عطیہ ریکارڈ بناتا ہے اور آپ کے کارڈ سے رقم وصول نہیں کرتا۔ آن لائن ادائیگی کے لیے Safepay چیک آؤٹ اور تصدیق کی ترتیب ضروری ہے۔"
                    )}
                  </p>
                  <form className="form-grid" onSubmit={createDonation}>
                    <label className="full-width">
                      {tr("Donation amount (PKR)", "عطیہ کی رقم (روپے)")}
                      <input name="amount" type="number" min="1" max="1000000000" step="0.01" placeholder={tr("Enter amount", "رقم درج کریں")} required />
                    </label>
                    <button className="button button-primary" type="submit">
                      {tr("Create pending donation", "زیرِ التوا عطیہ درج کریں")}
                    </button>
                  </form>
                </>
              )}
            </section>
          )}

          {page === "projects" && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{tr("COMMUNITY DEVELOPMENT", "کمیونٹی کی ترقی")}</span>
                  <h2>{tr("Welfare projects", "فلاحی منصوبے")}</h2>
                  <p className="muted">{tr("Explore initiatives serving the people of Chitta Batta.", "چھٹہ بٹہ کے لوگوں کے لیے جاری فلاحی سرگرمیاں دیکھیں۔")}</p>
                </div>
              </div>
              <div className="cards-grid">
                {projects.map((project) => (
                  <article className="panel project-card" key={project.id}>
                    <span className={`status ${project.status}`}>{project.status}</span>
                    <h3>{project.title}</h3>
                    <p>{project.description || tr("More project details will be shared soon.", "منصوبے کی مزید تفصیلات جلد شیئر کی جائیں گی۔")}</p>
                    <p className="muted"><span aria-hidden="true">⌖</span> {project.location || "Chitta Batta"}</p>
                    <div className="project-budget">
                      <span className="muted">{tr("Planned budget", "منصوبہ بند بجٹ")}</span>
                      <strong>{money(project.budget)}</strong>
                    </div>
                  </article>
                ))}
                {!projects.length && (
                  <div className="panel">
                    <h3>{tr("No projects published yet", "ابھی کوئی منصوبہ شائع نہیں ہوا")}</h3>
                    <p className="muted">{tr("Please check again later for new community initiatives.", "نئے فلاحی منصوبوں کے لیے بعد میں دوبارہ دیکھیں۔")}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {page === "announcements" && (
            <>
              <span className="eyebrow">{tr("NEWS & UPDATES", "خبریں اور اپ ڈیٹس")}</span>
              <h2>{tr("Community announcements", "کمیونٹی کے اعلانات")}</h2>
              <p className="muted">{tr("Stay informed about welfare activities and community updates.", "فلاحی سرگرمیوں اور کمیونٹی کی تازہ خبروں سے باخبر رہیں۔")}</p>
              {announcements.map((item) => (
                <article className="panel announcement" key={item.id}>
                  <span className="eyebrow">{tr("COMMUNITY UPDATE", "کمیونٹی اپ ڈیٹ")}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <small className="muted">{tr("Published", "شائع ہوا")}: {formatDate(item.created_at)}</small>
                </article>
              ))}
              {!announcements.length && (
                <div className="panel">
                  <h3>{tr("No announcements yet", "ابھی کوئی اعلان نہیں")}</h3>
                  <p className="muted">{tr("New announcements will appear here when published.", "نئے اعلانات شائع ہونے پر یہاں دکھائی دیں گے۔")}</p>
                </div>
              )}
            </>
          )}

          {page === "report" && (
            <section className="panel">
              <span className="eyebrow">{tr("PUBLIC ACCOUNTABILITY", "عوامی جواب دہی")}</span>
              <h2>{tr("Monthly financial report", "ماہانہ مالیاتی رپورٹ")}</h2>
              <p className="muted">{tr("Review recorded donations and expenses for a selected month.", "منتخب مہینے کے عطیات اور اخراجات کا ریکارڈ دیکھیں۔")}</p>
              <div className="report-controls">
                <label>
                  {tr("Select month", "مہینہ منتخب کریں")}
                  <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                </label>
                <button className="button button-primary" onClick={loadReport}>{tr("View report", "رپورٹ دیکھیں")}</button>
              </div>
              {report && (
                <>
                  <div className="stats-grid report-grid">
                    <article className="stat-card">
                      <span>{tr("Opening balance", "ابتدائی بیلنس")}</span>
                      <strong>{money(report.opening_balance)}</strong>
                    </article>
                    <article className="stat-card">
                      <span>{tr("Donations received", "وصول شدہ عطیات")}</span>
                      <strong>{money(report.donations_received)}</strong>
                      <small>{report.donation_count} {tr("records", "ریکارڈ")}</small>
                    </article>
                    <article className="stat-card">
                      <span>{tr("Expenses paid", "ادا شدہ اخراجات")}</span>
                      <strong>{money(report.expenses_paid)}</strong>
                      <small>{report.expense_count} {tr("records", "ریکارڈ")}</small>
                    </article>
                    <article className="stat-card">
                      <span>{tr("Closing balance", "اختتامی بیلنس")}</span>
                      <strong>{money(report.closing_balance)}</strong>
                    </article>
                  </div>
                  <p className="muted">
                    {tr("Report period", "رپورٹ کا عرصہ")}: {month}.{" "}
                    {tr("These figures reflect the records currently in the database.", "یہ اعداد و شمار ڈیٹا بیس میں موجودہ ریکارڈ کے مطابق ہیں۔")}
                  </p>
                </>
              )}
              <p className="muted">
                {tr(
                  "Only donations marked completed are counted. Reports depend on the accuracy and completeness of recorded transactions and expenses.",
                  "صرف مکمل قرار دیے گئے عطیات شمار کیے جاتے ہیں۔ رپورٹ درج شدہ لین دین اور اخراجات کے درست اور مکمل ریکارڈ پر منحصر ہے۔"
                )}
              </p>
            </section>
          )}

          {page === "admin" && (
            <>
              {!user || user.role !== "admin" ? (
                <section className="panel">
                  <span className="eyebrow">{tr("RESTRICTED AREA", "محدود رسائی")}</span>
                  <h2>{tr("Administrator access required", "ایڈمن کی اجازت ضروری ہے")}</h2>
                  <p className="muted">{tr("Sign in with an account that has been promoted to administrator.", "ایسے اکاؤنٹ سے لاگ اِن کریں جسے ایڈمن کی اجازت حاصل ہو۔")}</p>
                </section>
              ) : (
                <>
                  <span className="eyebrow">{tr("MANAGE THE ORGANIZATION", "ادارے کا انتظام")}</span>
                  <h2>{tr("Administrator panel", "ایڈمن پینل")}</h2>
                  <p className="muted">{tr("Manage recorded donations, expenses, projects, announcements, and donor records.", "عطیات، اخراجات، منصوبوں، اعلانات اور عطیہ دہندگان کے ریکارڈ کا انتظام کریں۔")}</p>

                  <section className="panel">
                    <h3>{tr("Record a verified offline donation", "تصدیق شدہ آف لائن عطیہ درج کریں")}</h3>
                    <p className="muted">{tr("Record cash or bank donations only after confirming that the funds have actually been received.", "نقد یا بینک عطیہ صرف اس وقت درج کریں جب رقم موصول ہونے کی تصدیق ہو جائے۔")}</p>
                    <form className="form-grid" onSubmit={recordOfflineDonation}>
                      <label>{tr("Donor user ID", "عطیہ دہندہ کی یوزر آئی ڈی")}<input name="user_id" type="number" min="1" required placeholder="1" /></label>
                      <label>{tr("Amount (PKR)", "رقم (روپے)")}<input name="amount" type="number" min="1" step="0.01" required /></label>
                      <label>{tr("Payment method", "ادائیگی کا طریقہ")}
                        <select name="payment_method" required>
                          <option value="cash">{tr("Cash", "نقد")}</option>
                          <option value="bank_transfer">{tr("Bank transfer", "بینک ٹرانسفر")}</option>
                          <option value="other">{tr("Other", "دیگر")}</option>
                        </select>
                      </label>
                      <label>{tr("Receipt / transaction reference", "رسید / لین دین کا حوالہ")}<input name="transaction_reference" maxLength="255" placeholder={tr("Optional reference", "اختیاری حوالہ")} /></label>
                      <button className="button button-primary" type="submit">{tr("Record donation", "عطیہ درج کریں")}</button>
                    </form>
                  </section>

                  <section className="panel">
                    <h3>{tr("Record an expense", "اخراجات درج کریں")}</h3>
                    <p className="muted">{tr("Enter a genuine expense supported by your records.", "اپنے ریکارڈ کے مطابق اصل اخراجات درج کریں۔")}</p>
                    <form className="form-grid" onSubmit={createExpense}>
                      <label>{tr("Expense title", "اخراجات کا عنوان")}<input name="title" required maxLength="200" /></label>
                      <label>{tr("Category", "قسم")}<input name="category" required maxLength="100" /></label>
                      <label>{tr("Amount (PKR)", "رقم (روپے)")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
                      <label>{tr("Expense date", "اخراجات کی تاریخ")}<input name="expense_date" type="date" defaultValue={new Date().toLocaleDateString("en-CA")} required /></label>
                      <label>{tr("Project ID (optional)", "منصوبے کی آئی ڈی (اختیاری)")}<input name="project_id" type="number" min="1" /></label>
                      <label>{tr("Receipt reference", "رسید کا حوالہ")}<input name="receipt_reference" maxLength="255" /></label>
                      <label className="full-width">{tr("Description", "تفصیل")}<textarea name="description" rows="3" /></label>
                      <button className="button button-primary" type="submit">{tr("Save expense", "اخراجات محفوظ کریں")}</button>
                    </form>
                  </section>

                  <section className="panel">
                    <h3>{tr("Create welfare project", "فلاحی منصوبہ بنائیں")}</h3>
                    <form className="form-grid" onSubmit={createProject}>
                      <label>{tr("Project title", "منصوبے کا عنوان")}<input name="title" required maxLength="200" /></label>
                      <label>{tr("Location", "مقام")}<input name="location" maxLength="200" /></label>
                      <label>{tr("Budget (PKR)", "بجٹ (روپے)")}<input name="budget" type="number" min="0" step="0.01" defaultValue="0" /></label>
                      <label>{tr("Status", "حیثیت")}
                        <select name="status" defaultValue="planned">
                          <option value="planned">{tr("Planned", "منصوبہ بند")}</option>
                          <option value="ongoing">{tr("Ongoing", "جاری")}</option>
                          <option value="completed">{tr("Completed", "مکمل")}</option>
                          <option value="cancelled">{tr("Cancelled", "منسوخ")}</option>
                        </select>
                      </label>
                      <label>{tr("Start date", "آغاز کی تاریخ")}<input name="start_date" type="date" /></label>
                      <label>{tr("End date", "اختتام کی تاریخ")}<input name="end_date" type="date" /></label>
                      <label className="full-width">{tr("Project description", "منصوبے کی تفصیل")}<textarea name="description" rows="4" /></label>
                      <button className="button button-primary" type="submit">{tr("Create project", "منصوبہ بنائیں")}</button>
                    </form>
                  </section>

                  <section className="panel">
                    <h3>{tr("Publish announcement", "اعلان شائع کریں")}</h3>
                    <p className="muted">{tr("Share a community update with website visitors.", "ویب سائٹ کے صارفین کے ساتھ کمیونٹی کی خبر شیئر کریں۔")}</p>
                    <form className="form-grid" onSubmit={createAnnouncement}>
                      <label className="full-width">{tr("Announcement title", "اعلان کا عنوان")}<input name="title" required maxLength="200" /></label>
                      <label className="full-width">{tr("Announcement message", "اعلان کا پیغام")}<textarea name="body" rows="5" required /></label>
                      <button className="button button-primary" type="submit">{tr("Publish announcement", "اعلان شائع کریں")}</button>
                    </form>
                  </section>

                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h3>{tr("Registered donors", "رجسٹرڈ عطیہ دہندگان")}</h3>
                        <p className="muted">{tr("Accounts currently registered in the system.", "سسٹم میں رجسٹرڈ اکاؤنٹس۔")}</p>
                      </div>
                      <button className="button button-light" onClick={loadAdminData}>{tr("Refresh records", "ریکارڈ تازہ کریں")}</button>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>{tr("ID", "آئی ڈی")}</th><th>{tr("Name", "نام")}</th><th>{tr("Email", "ای میل")}</th><th>{tr("Role", "کردار")}</th></tr></thead>
                        <tbody>
                          {donors.map((donor) => (
                            <tr key={donor.id}><td>{donor.id}</td><td>{donor.full_name}</td><td>{donor.email}</td><td><span className="status">{donor.role}</span></td></tr>
                          ))}
                          {!donors.length && <tr><td colSpan="4">{tr("No donor records loaded.", "عطیہ دہندگان کا کوئی ریکارڈ لوڈ نہیں ہوا۔")}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="panel">
                    <h3>{tr("Donation records", "عطیات کا ریکارڈ")}</h3>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>{tr("Donor", "عطیہ دہندہ")}</th><th>{tr("Amount", "رقم")}</th><th>{tr("Method", "طریقہ")}</th><th>{tr("Status", "حیثیت")}</th><th>{tr("Date", "تاریخ")}</th></tr></thead>
                        <tbody>
                          {donations.map((item) => (
                            <tr key={item.donation_id}><td>{item.full_name}</td><td>{money(item.amount)}</td><td>{String(item.payment_method || "").replace("_", " ")}</td><td><span className={`status ${item.payment_status}`}>{item.payment_status}</span></td><td>{formatDate(item.donation_date)}</td></tr>
                          ))}
                          {!donations.length && <tr><td colSpan="5">{tr("No donation records loaded.", "عطیات کا کوئی ریکارڈ لوڈ نہیں ہوا۔")}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="panel">
                    <h3>{tr("Expense records", "اخراجات کا ریکارڈ")}</h3>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>{tr("Date", "تاریخ")}</th><th>{tr("Title", "عنوان")}</th><th>{tr("Category", "قسم")}</th><th>{tr("Amount", "رقم")}</th><th>{tr("Receipt", "رسید")}</th></tr></thead>
                        <tbody>
                          {expenses.map((item) => (
                            <tr key={item.id}><td>{formatDate(item.expense_date)}</td><td>{item.title}</td><td>{item.category}</td><td>{money(item.amount)}</td><td>{item.receipt_reference || "—"}</td></tr>
                          ))}
                          {!expenses.length && <tr><td colSpan="5">{tr("No expense records loaded.", "اخراجات کا کوئی ریکارڈ لوڈ نہیں ہوا۔")}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        <strong>{tr("Nojawan Itehad Welfare", "نوجوان اتحاد ویلفیئر")}</strong>
        <span>{tr("Community welfare · Chitta Batta", "کمیونٹی ویلفیئر · چھٹہ بٹہ")}</span>
      </footer>

      {/* SIGN IN / REGISTER MODAL */}
      {authOpen && (
        <div
          className="auth-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAuth();
          }}
        >
          <section
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
          >
            <button
              type="button"
              className="auth-modal-close"
              onClick={closeAuth}
              disabled={busy}
              aria-label="Close sign in dialog"
            >
              ×
            </button>

            <div className="auth-modal-heading">
              <span className="brand-mark">NI</span>
              <span className="eyebrow">
                {tr("YOUR COMMUNITY ACCOUNT", "آپ کا کمیونٹی اکاؤنٹ")}
              </span>
              <h2 id="auth-modal-title">
                {mode === "login"
                  ? tr("Welcome back", "دوبارہ خوش آمدید")
                  : tr("Join our community", "ہماری کمیونٹی میں شامل ہوں")}
              </h2>
              <p className="muted">
                {mode === "login"
                  ? tr(
                      "Sign in to access your dashboard and donation history.",
                      "اپنا ڈیش بورڈ اور عطیات کی تاریخ دیکھنے کے لیے لاگ اِن کریں۔"
                    )
                  : tr(
                      "Create your account to join our welfare community.",
                      "ہماری فلاحی کمیونٹی میں شامل ہونے کے لیے اکاؤنٹ بنائیں۔"
                    )}
              </p>
            </div>

            {error && (
              <div className="notice error" role="alert">
                <span aria-hidden="true">!</span> {error}
              </div>
            )}

            {message && (
              <div className="notice success" role="status">
                <span aria-hidden="true">✓</span> {message}
              </div>
            )}

            <form className="form-grid auth-modal-form" onSubmit={submitAuth}>
              {mode === "register" && (
                <>
                  <label className="full-width">
                    {tr("Full name", "پورا نام")}
                    <input
                      name="full_name"
                      placeholder={tr("Enter your full name", "اپنا پورا نام درج کریں")}
                      required
                      maxLength="100"
                      autoComplete="name"
                    />
                  </label>
                  <label className="full-width">
                    {tr("Phone number", "فون نمبر")}
                    <input
                      name="phone"
                      type="tel"
                      placeholder={tr("Optional", "اختیاری")}
                      autoComplete="tel"
                    />
                  </label>
                </>
              )}

              <label className="full-width">
                {tr("Email address", "ای میل ایڈریس")}
                <input
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </label>

              <label className="full-width">
                {tr("Password", "پاس ورڈ")}
                <input
                  name="password"
                  type="password"
                  placeholder={tr("At least 8 characters", "کم از کم 8 حروف")}
                  minLength="8"
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </label>

              <button
                className="button button-primary full-width"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? tr("Please wait...", "براہ کرم انتظار کریں...")
                  : mode === "login"
                    ? tr("Sign in to your account →", "اپنے اکاؤنٹ میں لاگ اِن کریں →")
                    : tr("Create my account →", "میرا اکاؤنٹ بنائیں →")}
              </button>
            </form>

            <p className="switch-mode auth-modal-switch">
              {mode === "login"
                ? tr("Don't have an account?", "اکاؤنٹ نہیں ہے؟")
                : tr("Already have an account?", "پہلے سے اکاؤنٹ موجود ہے؟")}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError("");
                  setMessage("");
                }}
                disabled={busy}
              >
                {mode === "login"
                  ? tr("Register here", "یہاں رجسٹر کریں")
                  : tr("Sign in", "لاگ اِن کریں")}
              </button>
            </p>

            <p className="auth-modal-footer">
              {tr("Nojawan Itehad Welfare · Chitta Batta", "نوجوان اتحاد ویلفیئر · چھٹہ بٹہ")}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
