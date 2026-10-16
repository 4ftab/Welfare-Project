import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadFile, formatDate, methodLabel, money } from "../api";
import { DonutChart, ProgressBar, TrendChart } from "./Charts";
import { Icon } from "./Glyphs";

const PROJECT_STATUSES = ["planned", "ongoing", "completed", "cancelled"];

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA");
}

export default function AdminPanel({ token, tr, projects, reloadPublic, notify, fail, currentUserId }) {
  const [tab, setTab] = useState("overview");
  // Which datasets have arrived. The console appears at once and each tab fills in when its data lands.
  const [loaded, setLoaded] = useState({});

  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [donations, setDonations] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);

  const [editingProject, setEditingProject] = useState(null);
  const [editingAnn, setEditingAnn] = useState(null);

  const [donationSearch, setDonationSearch] = useState("");
  const [donationFilter, setDonationFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [expenseSearch, setExpenseSearch] = useState("");

  // All requests start together; each one updates its own part of the screen as soon as it answers,
  // so a slow request (or one that fails) never holds back the others.
  const refresh = useCallback(async () => {
    const failures = new Set();
    const load = (key, path, apply) =>
      api(path, { token })
        .then((data) => {
          apply(data);
          setLoaded((current) => ({ ...current, [key]: true }));
        })
        .catch((e) => failures.add(e.message));

    await Promise.all([
      load("overview", "/admin/overview", setOverview),
      load("users", "/admin/donors", (d) => setUsers(d.users || [])),
      load("donations", "/admin/donations", (d) => setDonations(d.donations || [])),
      load("expenses", "/expenses", (d) => setExpenses(d.expenses || [])),
      load("announcements", "/announcements/all", (d) => setAnnouncements(d.announcements || [])),
      load("messages", "/admin/messages", (d) => setMessages(d.messages || [])),
      load("activity", "/admin/audit-logs", (d) => setLogs(d.logs || [])),
    ]);

    if (failures.size) fail([...failures][0]);
  }, [token, fail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Run a mutation, then reload data and show feedback.
  async function act(fn, successMessage, { alsoPublic = false } = {}) {
    try {
      const result = await fn();
      notify(result?.message || successMessage);
      await refresh();
      if (alsoPublic) await reloadPublic();
      return true;
    } catch (e) {
      fail(e.message);
      return false;
    }
  }

  const post = (path, body, method = "POST") =>
    api(path, { method, token, body: JSON.stringify(body) });

  function formBody(event) {
    event.preventDefault();
    return {
      form: event.currentTarget,
      body: Object.fromEntries(new FormData(event.currentTarget).entries()),
    };
  }

  async function saveOffline(event) {
    const { form, body } = formBody(event);
    body.user_id = Number(body.user_id);
    body.amount = Number(body.amount);
    body.project_id = body.project_id ? Number(body.project_id) : null;
    if (await act(() => post("/donations/offline", body), tr("Offline donation recorded.", "آف لائن عطیہ درج ہوگیا۔"))) form.reset();
  }

  async function saveExpense(event) {
    const { form, body } = formBody(event);
    body.amount = Number(body.amount);
    body.project_id = body.project_id ? Number(body.project_id) : null;
    if (await act(() => post("/expenses", body), tr("Expense recorded.", "اخراجات درج ہوگئے۔"))) form.reset();
  }

  async function saveProject(event) {
    const { form, body } = formBody(event);
    body.budget = Number(body.budget || 0);
    const ok = editingProject
      ? await act(() => post(`/projects/${editingProject.id}`, body, "PUT"), tr("Project updated.", "منصوبہ اپ ڈیٹ ہوگیا۔"), { alsoPublic: true })
      : await act(() => post("/projects", body), tr("Project created.", "منصوبہ بن گیا۔"), { alsoPublic: true });
    if (ok) {
      setEditingProject(null);
      form.reset();
    }
  }

  async function saveAnnouncement(event) {
    const { form, body } = formBody(event);
    const ok = editingAnn
      ? await act(
          () => post(`/announcements/${editingAnn.id}`, { ...body, is_published: Boolean(editingAnn.is_published) }, "PUT"),
          tr("Announcement updated.", "اعلان اپ ڈیٹ ہوگیا۔"),
          { alsoPublic: true }
        )
      : await act(() => post("/announcements", body), tr("Announcement published.", "اعلان شائع ہوگیا۔"), { alsoPublic: true });
    if (ok) {
      setEditingAnn(null);
      form.reset();
    }
  }

  async function exportCsv(kind) {
    try {
      await downloadFile(`/admin/export/${kind}.csv`, `${kind}.csv`, token);
      notify(tr("Export downloaded.", "فائل ڈاؤن لوڈ ہوگئی۔"));
    } catch (e) {
      fail(e.message);
    }
  }

  const confirmThen = (text, fn) => {
    if (window.confirm(text)) fn();
  };

  const filteredDonations = useMemo(() => {
    const q = donationSearch.trim().toLowerCase();
    return donations.filter(
      (d) =>
        (donationFilter === "all" || d.payment_status === donationFilter) &&
        (!q ||
          `${d.full_name} ${d.email} ${d.transaction_reference || ""} ${d.project_title || ""}`
            .toLowerCase()
            .includes(q))
    );
  }, [donations, donationSearch, donationFilter]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => !q || `${u.full_name} ${u.email} ${u.phone || ""}`.toLowerCase().includes(q));
  }, [users, userSearch]);

  const filteredExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    return expenses.filter((e) => !q || `${e.title} ${e.category} ${e.project_title || ""}`.toLowerCase().includes(q));
  }, [expenses, expenseSearch]);

  const categoryTotals = useMemo(() => {
    const map = new Map();
    expenses.forEach((e) => map.set(e.category, (map.get(e.category) || 0) + Number(e.amount)));
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [expenses]);

  const pendingCount = donations.filter((d) => d.payment_status === "pending").length;
  const unread = messages.filter((m) => !m.is_read).length;

  const tabs = [
    { key: "overview", label: tr("Overview", "جائزہ") },
    { key: "donations", label: tr("Donations", "عطیات"), badge: pendingCount },
    { key: "expenses", label: tr("Expenses", "اخراجات") },
    { key: "projects", label: tr("Projects", "منصوبے") },
    { key: "announcements", label: tr("Announcements", "اعلانات") },
    { key: "users", label: tr("Members", "اراکین") },
    { key: "messages", label: tr("Inbox", "پیغامات"), badge: unread },
    { key: "activity", label: tr("Activity log", "سرگرمی لاگ") },
  ];

  const projectOptions = (
    <>
      <option value="">{tr("— None / general fund —", "— کوئی نہیں / عمومی فنڈ —")}</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.title}</option>
      ))}
    </>
  );

  const tabReady = {
    overview: loaded.overview,
    donations: loaded.donations && loaded.users,
    expenses: loaded.expenses,
    projects: true,
    announcements: loaded.announcements,
    users: loaded.users,
    messages: loaded.messages,
    activity: loaded.activity,
  };

  return (
    <>
      <span className="eyebrow">{tr("MANAGE THE ORGANIZATION", "ادارے کا انتظام")}</span>
      <h2>{tr("Administrator console", "ایڈمن کنسول")}</h2>
      <p className="muted">
        {tr(
          "Everything you do here is written to the activity log for accountability.",
          "یہاں کی ہر کارروائی جواب دہی کے لیے سرگرمی لاگ میں درج ہوتی ہے۔"
        )}
      </p>

      <div className="tabs x-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.badge > 0 && <span className="badge">{t.badge}</span>}
          </button>
        ))}
        <button className="tab refresh" onClick={() => { refresh(); notify(tr("Data refreshed.", "ڈیٹا تازہ ہوگیا۔")); }}>
          ↻ {tr("Refresh", "تازہ کریں")}
        </button>
      </div>

      {/* ───────── OVERVIEW ───────── */}
      {!tabReady[tab] && (
        <section className="panel" aria-busy="true" aria-label={tr("Loading", "لوڈ ہو رہا ہے")}>
          <div className="skeleton-line wide" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </section>
      )}

      {tab === "overview" && tabReady.overview && overview && (
        <>
          <div className="stats-grid four x-stats">
            <article className="stat-card"><span>{tr("Funds raised", "جمع شدہ فنڈز")}</span><strong>{money(overview.raised)}</strong><small>{tr("Completed donations", "مکمل عطیات")}</small></article>
            <article className="stat-card"><span>{tr("Expenses paid", "ادا شدہ اخراجات")}</span><strong>{money(overview.spent)}</strong><small>{tr("All recorded expenses", "تمام درج اخراجات")}</small></article>
            <article className="stat-card"><span>{tr("Available balance", "دستیاب بیلنس")}</span><strong>{money(overview.balance)}</strong><small>{tr("Raised minus spent", "جمع منفی خرچ")}</small></article>
            <article className="stat-card"><span>{tr("Pending pledges", "زیرِ التوا عطیات")}</span><strong>{overview.pending_count}</strong><small>{money(overview.pending_amount)} {tr("awaiting confirmation", "تصدیق کے منتظر")}</small></article>
          </div>

          {overview.pending_count > 0 && (
            <div className="notice warn" role="status">
              <span aria-hidden="true"><Icon name="hourglass" size={18} /></span>
              {tr(
                `${overview.pending_count} pledge(s) are waiting for confirmation.`,
                `${overview.pending_count} عطیات تصدیق کے منتظر ہیں۔`
              )}
              <button className="text-button" onClick={() => { setDonationFilter("pending"); setTab("donations"); }}>
                {tr("Review now", "ابھی دیکھیں")} →
              </button>
            </div>
          )}

          <div className="two-col">
            <section className="panel">
              <h3>{tr("Last 6 months", "گزشتہ 6 ماہ")}</h3>
              <p className="muted">{tr("Donations received against expenses paid.", "وصول شدہ عطیات بمقابلہ ادا شدہ اخراجات۔")}</p>
              <TrendChart
                series={overview.series}
                labels={{
                  title: tr("Monthly donations and expenses", "ماہانہ عطیات اور اخراجات"),
                  donations: tr("Donations", "عطیات"),
                  expenses: tr("Expenses", "اخراجات"),
                  peak: tr("Peak", "زیادہ سے زیادہ"),
                }}
              />
            </section>
            <section className="panel">
              <h3>{tr("Where the money goes", "رقم کہاں خرچ ہوتی ہے")}</h3>
              <p className="muted">{tr("Expenses by category.", "قسم کے لحاظ سے اخراجات۔")}</p>
              <DonutChart data={categoryTotals} emptyText={tr("No expenses recorded yet.", "ابھی کوئی اخراجات درج نہیں۔")} />
            </section>
          </div>

          <div className="two-col">
            <section className="panel">
              <h3>{tr("Top donors", "سرفہرست عطیہ دہندگان")}</h3>
              <ol className="leaderboard">
                {overview.top_donors.map((d, i) => (
                  <li key={d.id}>
                    <span className="rank">{i + 1}</span>
                    <span>{d.full_name}</span>
                    <strong>{money(d.total)}</strong>
                  </li>
                ))}
                {!overview.top_donors.length && <li className="muted">{tr("No completed donations yet.", "ابھی کوئی مکمل عطیہ نہیں۔")}</li>}
              </ol>
            </section>
            <section className="panel">
              <h3>{tr("Community", "کمیونٹی")}</h3>
              <ul className="facts">
                <li><span>{tr("Registered donors", "رجسٹرڈ عطیہ دہندگان")}</span><strong>{overview.donor_total}</strong></li>
                <li><span>{tr("Active accounts", "فعال اکاؤنٹس")}</span><strong>{overview.donor_active}</strong></li>
                <li><span>{tr("Unread messages", "نہ پڑھے پیغامات")}</span><strong>{overview.unread_messages}</strong></li>
                <li><span>{tr("Projects", "منصوبے")}</span><strong>{projects.length}</strong></li>
              </ul>
            </section>
          </div>
        </>
      )}

      {/* ───────── DONATIONS ───────── */}
      {tab === "donations" && tabReady.donations && (
        <>
          <section className="panel">
            <h3>{tr("Record a verified offline donation", "تصدیق شدہ آف لائن عطیہ درج کریں")}</h3>
            <p className="muted">{tr("Record cash or bank donations only after confirming that the funds have actually been received.", "نقد یا بینک عطیہ صرف اس وقت درج کریں جب رقم موصول ہونے کی تصدیق ہو جائے۔")}</p>
            <form className="form-grid" onSubmit={saveOffline}>
              <label>{tr("Donor", "عطیہ دہندہ")}
                <select name="user_id" required defaultValue="">
                  <option value="" disabled>{tr("Select a donor", "عطیہ دہندہ منتخب کریں")}</option>
                  {users.filter((u) => u.is_active).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>
                  ))}
                </select>
              </label>
              <label>{tr("Amount (PKR)", "رقم (روپے)")}<input name="amount" type="number" min="1" step="0.01" required /></label>
              <label>{tr("Payment method", "ادائیگی کا طریقہ")}
                <select name="payment_method" required>
                  <option value="cash">{tr("Cash", "نقد")}</option>
                  <option value="bank_transfer">{tr("Bank transfer", "بینک ٹرانسفر")}</option>
                  <option value="other">{tr("Other", "دیگر")}</option>
                </select>
              </label>
              <label>{tr("For project", "منصوبے کے لیے")}<select name="project_id" defaultValue="">{projectOptions}</select></label>
              <label>{tr("Receipt / transaction reference", "رسید / لین دین کا حوالہ")}<input name="transaction_reference" maxLength="150" placeholder={tr("Optional, must be unique", "اختیاری، منفرد ہونا ضروری")} /></label>
              <button className="button button-primary" type="submit">{tr("Record donation", "عطیہ درج کریں")}</button>
            </form>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <h3>{tr("All donations", "تمام عطیات")}</h3>
                <p className="muted">{filteredDonations.length} / {donations.length} {tr("records", "ریکارڈ")}</p>
              </div>
              <button className="button button-light" onClick={() => exportCsv("donations")}>⬇ {tr("Export CSV", "CSV ایکسپورٹ")}</button>
            </div>
            <div className="toolbar x-toolbar">
              <input type="search" placeholder={tr("Search donor, email, reference…", "نام، ای میل، حوالہ تلاش کریں…")} value={donationSearch} onChange={(e) => setDonationSearch(e.target.value)} />
              <div className="chips">
                {["all", "pending", "completed", "failed", "cancelled", "expired", "refunded"].map((s) => (
                  <button key={s} className={`chip ${donationFilter === s ? "active" : ""}`} onClick={() => setDonationFilter(s)}>{s}</button>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{tr("Donor", "عطیہ دہندہ")}</th><th>{tr("Amount", "رقم")}</th><th>{tr("Project", "منصوبہ")}</th><th>{tr("Method", "طریقہ")}</th><th>{tr("Status", "حیثیت")}</th><th>{tr("Date", "تاریخ")}</th><th>{tr("Action", "کارروائی")}</th></tr></thead>
                <tbody>
                  {filteredDonations.map((d) => (
                    <tr key={d.donation_id}>
                      <td><strong>{d.full_name}</strong><br /><small className="muted">{d.email}</small></td>
                      <td>{money(d.amount)}</td>
                      <td>{d.project_title || "—"}</td>
                      <td>{methodLabel(d.payment_method, d.payment_channel)}</td>
                      <td><span className={`status ${d.payment_status}`}>{d.payment_status}</span></td>
                      <td>{formatDate(d.donation_date)}</td>
                      <td>
                        <select
                          className="mini-select"
                          value=""
                          aria-label={tr("Change status", "حیثیت تبدیل کریں")}
                          onChange={(e) => {
                            const status = e.target.value;
                            if (!status) return;
                            const ref = status === "completed" && d.payment_method !== "safepay" ? window.prompt(tr("Receipt / transaction reference (optional):", "رسید / حوالہ (اختیاری):")) : null;
                            act(() => post(`/admin/donations/${d.donation_id}/status`, { status, transaction_reference: ref || undefined }, "PATCH"), tr("Donation updated.", "عطیہ اپ ڈیٹ ہوگیا۔"));
                          }}
                        >
                          <option value="">{tr("Set status…", "حیثیت…")}</option>
                          {["pending", "completed", "failed", "cancelled", "refunded"].filter((s) => s !== d.payment_status).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {!filteredDonations.length && <tr><td colSpan="7">{tr("No donations match.", "کوئی عطیہ نہیں ملا۔")}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ───────── EXPENSES ───────── */}
      {tab === "expenses" && tabReady.expenses && (
        <>
          <section className="panel">
            <h3>{tr("Record an expense", "اخراجات درج کریں")}</h3>
            <p className="muted">{tr("Enter a genuine expense supported by your records.", "اپنے ریکارڈ کے مطابق اصل اخراجات درج کریں۔")}</p>
            <form className="form-grid" onSubmit={saveExpense}>
              <label>{tr("Expense title", "اخراجات کا عنوان")}<input name="title" required maxLength="150" /></label>
              <label>{tr("Category", "قسم")}
                <input name="category" required maxLength="100" list="expense-categories" />
                <datalist id="expense-categories">
                  {["Food & ration", "Education", "Medical", "Transport", "Utilities", "Events", "Administration"].map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>{tr("Amount (PKR)", "رقم (روپے)")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label>{tr("Expense date", "اخراجات کی تاریخ")}<input name="expense_date" type="date" defaultValue={new Date().toLocaleDateString("en-CA")} required /></label>
              <label>{tr("Project (optional)", "منصوبہ (اختیاری)")}<select name="project_id" defaultValue="">{projectOptions}</select></label>
              <label>{tr("Receipt reference", "رسید کا حوالہ")}<input name="receipt_reference" maxLength="255" /></label>
              <label className="full-width">{tr("Description", "تفصیل")}<textarea name="description" rows="3" /></label>
              <button className="button button-primary" type="submit">{tr("Save expense", "اخراجات محفوظ کریں")}</button>
            </form>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <h3>{tr("Expense records", "اخراجات کا ریکارڈ")}</h3>
                <p className="muted">{tr("Total", "کل")}: <strong>{money(filteredExpenses.reduce((s, e) => s + Number(e.amount), 0))}</strong></p>
              </div>
              <button className="button button-light" onClick={() => exportCsv("expenses")}>⬇ {tr("Export CSV", "CSV ایکسپورٹ")}</button>
            </div>
            <div className="toolbar x-toolbar">
              <input type="search" placeholder={tr("Search title, category, project…", "عنوان، قسم، منصوبہ تلاش کریں…")} value={expenseSearch} onChange={(e) => setExpenseSearch(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{tr("Date", "تاریخ")}</th><th>{tr("Title", "عنوان")}</th><th>{tr("Category", "قسم")}</th><th>{tr("Project", "منصوبہ")}</th><th>{tr("Amount", "رقم")}</th><th>{tr("Receipt", "رسید")}</th><th /></tr></thead>
                <tbody>
                  {filteredExpenses.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.expense_date)}</td><td>{e.title}</td><td>{e.category}</td><td>{e.project_title || "—"}</td><td>{money(e.amount)}</td><td>{e.receipt_reference || "—"}</td>
                      <td><button className="icon-btn danger" aria-label={tr("Delete expense", "اخراجات حذف کریں")} onClick={() => confirmThen(tr("Delete this expense?", "کیا یہ اخراجات حذف کریں؟"), () => act(() => api(`/expenses/${e.id}`, { method: "DELETE", token }), tr("Expense deleted.", "اخراجات حذف ہوگئے۔")))}><Icon name="trash" size={16} /></button></td>
                    </tr>
                  ))}
                  {!filteredExpenses.length && <tr><td colSpan="7">{tr("No expenses match.", "کوئی اخراجات نہیں ملے۔")}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ───────── PROJECTS ───────── */}
      {tab === "projects" && (
        <>
          <section className="panel">
            <div className="section-heading">
              <h3>{editingProject ? tr("Edit project", "منصوبہ ترمیم کریں") : tr("Create welfare project", "فلاحی منصوبہ بنائیں")}</h3>
              {editingProject && <button className="button button-light" onClick={() => setEditingProject(null)}>{tr("Cancel edit", "ترمیم منسوخ کریں")}</button>}
            </div>
            <form className="form-grid" key={editingProject?.id ?? "new"} onSubmit={saveProject}>
              <label>{tr("Project title", "منصوبے کا عنوان")}<input name="title" required maxLength="150" defaultValue={editingProject?.title || ""} /></label>
              <label>{tr("Location", "مقام")}<input name="location" maxLength="200" defaultValue={editingProject?.location || ""} /></label>
              <label>{tr("Budget (PKR)", "بجٹ (روپے)")}<input name="budget" type="number" min="0" step="0.01" defaultValue={editingProject?.budget ?? 0} /></label>
              <label>{tr("Status", "حیثیت")}
                <select name="status" defaultValue={editingProject?.status || "planned"}>
                  <option value="planned">{tr("Planned", "منصوبہ بند")}</option>
                  <option value="ongoing">{tr("Ongoing", "جاری")}</option>
                  <option value="completed">{tr("Completed", "مکمل")}</option>
                  <option value="cancelled">{tr("Cancelled", "منسوخ")}</option>
                </select>
              </label>
              <label>{tr("Start date", "آغاز کی تاریخ")}<input name="start_date" type="date" defaultValue={toDateInput(editingProject?.start_date)} /></label>
              <label>{tr("End date", "اختتام کی تاریخ")}<input name="end_date" type="date" defaultValue={toDateInput(editingProject?.end_date)} /></label>
              <label className="full-width">{tr("Project description", "منصوبے کی تفصیل")}<textarea name="description" rows="4" defaultValue={editingProject?.description || ""} /></label>
              <button className="button button-primary" type="submit">{editingProject ? tr("Save changes", "تبدیلیاں محفوظ کریں") : tr("Create project", "منصوبہ بنائیں")}</button>
            </form>
          </section>

          <section className="panel">
            <h3>{tr("All projects", "تمام منصوبے")}</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{tr("Project", "منصوبہ")}</th><th>{tr("Status", "حیثیت")}</th><th>{tr("Funding", "فنڈنگ")}</th><th>{tr("Spent", "خرچ")}</th><th /></tr></thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.title}</strong><br /><small className="muted">{p.location || "—"}</small></td>
                      <td>
                        <select className="mini-select" value={p.status} onChange={(e) => act(() => post(`/projects/${p.id}/status`, { status: e.target.value }, "PATCH"), tr("Status updated.", "حیثیت اپ ڈیٹ ہوگئی۔"), { alsoPublic: true })}>
                          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ minWidth: 150 }}>{money(p.raised)} / {money(p.budget)}<ProgressBar value={p.budget > 0 ? Math.min(100, (p.raised / p.budget) * 100) : 0} label={p.title} /></td>
                      <td>{money(p.spent)}</td>
                      <td className="row-actions">
                        <button className="icon-btn" aria-label={tr("Edit project", "منصوبہ ترمیم")} onClick={() => { setEditingProject(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Icon name="edit" size={16} /></button>
                        <button className="icon-btn danger" aria-label={tr("Delete project", "منصوبہ حذف")} onClick={() => confirmThen(tr("Delete this project?", "کیا یہ منصوبہ حذف کریں؟"), () => act(() => api(`/projects/${p.id}`, { method: "DELETE", token }), tr("Project deleted.", "منصوبہ حذف ہوگیا۔"), { alsoPublic: true }))}><Icon name="trash" size={16} /></button>
                      </td>
                    </tr>
                  ))}
                  {!projects.length && <tr><td colSpan="5">{tr("No projects yet.", "ابھی کوئی منصوبہ نہیں۔")}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ───────── ANNOUNCEMENTS ───────── */}
      {tab === "announcements" && tabReady.announcements && (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h3>{editingAnn ? tr("Edit announcement", "اعلان ترمیم کریں") : tr("Publish announcement", "اعلان شائع کریں")}</h3>
                <p className="muted">{tr("Share a community update with website visitors.", "ویب سائٹ کے صارفین کے ساتھ کمیونٹی کی خبر شیئر کریں۔")}</p>
              </div>
              {editingAnn && <button className="button button-light" onClick={() => setEditingAnn(null)}>{tr("Cancel edit", "ترمیم منسوخ کریں")}</button>}
            </div>
            <form className="form-grid" key={editingAnn?.id ?? "new"} onSubmit={saveAnnouncement}>
              <label className="full-width">{tr("Announcement title", "اعلان کا عنوان")}<input name="title" required maxLength="200" defaultValue={editingAnn?.title || ""} /></label>
              <label className="full-width">{tr("Announcement message", "اعلان کا پیغام")}<textarea name="body" rows="5" required defaultValue={editingAnn?.body || ""} /></label>
              <button className="button button-primary" type="submit">{editingAnn ? tr("Save changes", "تبدیلیاں محفوظ کریں") : tr("Publish announcement", "اعلان شائع کریں")}</button>
            </form>
          </section>

          <section className="panel">
            <h3>{tr("All announcements", "تمام اعلانات")}</h3>
            {announcements.map((a) => (
              <article className="list-row" key={a.id}>
                <div>
                  <strong>{a.title}</strong> {!a.is_published && <span className="status pending">{tr("hidden", "پوشیدہ")}</span>}
                  <p className="muted clamp">{a.body}</p>
                  <small className="muted">{formatDate(a.created_at)}</small>
                </div>
                <div className="row-actions">
                  <button className="icon-btn" aria-label={tr("Edit", "ترمیم")} onClick={() => { setEditingAnn(a); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Icon name="edit" size={16} /></button>
                  <button className="icon-btn" aria-label={a.is_published ? tr("Hide", "چھپائیں") : tr("Show", "دکھائیں")} onClick={() => act(() => post(`/announcements/${a.id}`, { title: a.title, body: a.body, is_published: !a.is_published }, "PUT"), tr("Visibility changed.", "ظاہری حیثیت تبدیل ہوگئی۔"), { alsoPublic: true })}><Icon name={a.is_published ? "eyeoff" : "eye"} size={16} /></button>
                  <button className="icon-btn danger" aria-label={tr("Delete", "حذف")} onClick={() => confirmThen(tr("Delete this announcement?", "کیا یہ اعلان حذف کریں؟"), () => act(() => api(`/announcements/${a.id}`, { method: "DELETE", token }), tr("Announcement deleted.", "اعلان حذف ہوگیا۔"), { alsoPublic: true }))}><Icon name="trash" size={16} /></button>
                </div>
              </article>
            ))}
            {!announcements.length && <p className="muted">{tr("No announcements yet.", "ابھی کوئی اعلان نہیں۔")}</p>}
          </section>
        </>
      )}

      {/* ───────── USERS ───────── */}
      {tab === "users" && tabReady.users && (
        <section className="panel">
          <h3>{tr("Registered members", "رجسٹرڈ اراکین")}</h3>
          <p className="muted">{tr("Deactivate accounts that should no longer sign in, or promote trusted members to administrator.", "جن اکاؤنٹس کو لاگ اِن نہیں کرنا چاہیے انہیں غیر فعال کریں یا قابلِ اعتماد رکن کو ایڈمن بنائیں۔")}</p>
          <div className="toolbar x-toolbar">
            <input type="search" placeholder={tr("Search name, email, phone…", "نام، ای میل، فون تلاش کریں…")} value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>{tr("Name", "نام")}</th><th>{tr("Contact", "رابطہ")}</th><th>{tr("Donated", "عطیہ")}</th><th>{tr("Role", "کردار")}</th><th>{tr("Account", "اکاؤنٹ")}</th></tr></thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const self = u.id === currentUserId;
                  return (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td><strong>{u.full_name}</strong><br /><small className="muted">{tr("Joined", "شمولیت")} {formatDate(u.created_at)}</small></td>
                      <td>{u.email}<br /><small className="muted">{u.phone || "—"}</small></td>
                      <td>{money(u.total_donated)}<br /><small className="muted">{u.donation_count} {tr("records", "ریکارڈ")}</small></td>
                      <td>
                        <select className="mini-select" value={u.role} disabled={self} onChange={(e) => confirmThen(tr(`Change ${u.full_name}'s role to ${e.target.value}?`, `${u.full_name} کا کردار ${e.target.value} کریں؟`), () => act(() => post(`/admin/users/${u.id}`, { role: e.target.value }, "PATCH"), tr("Role updated.", "کردار اپ ڈیٹ ہوگیا۔")))}>
                          <option value="donor">donor</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td>
                        <button className={`switch ${u.is_active ? "on" : ""}`} role="switch" aria-checked={Boolean(u.is_active)} disabled={self} aria-label={tr("Toggle account active", "اکاؤنٹ فعال/غیر فعال")} onClick={() => act(() => post(`/admin/users/${u.id}`, { is_active: !u.is_active }, "PATCH"), tr("Account updated.", "اکاؤنٹ اپ ڈیٹ ہوگیا۔"))}>
                          <span />
                        </button>
                        <small className="muted"> {u.is_active ? tr("Active", "فعال") : tr("Inactive", "غیر فعال")}</small>
                      </td>
                    </tr>
                  );
                })}
                {!filteredUsers.length && <tr><td colSpan="6">{tr("No members match.", "کوئی رکن نہیں ملا۔")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ───────── MESSAGES ───────── */}
      {tab === "messages" && tabReady.messages && (
        <section className="panel">
          <h3>{tr("Contact inbox", "رابطہ پیغامات")}</h3>
          <p className="muted">{tr("Messages sent through the website contact form.", "ویب سائٹ کے رابطہ فارم سے بھیجے گئے پیغامات۔")}</p>
          {messages.map((m) => (
            <article className={`list-row ${m.is_read ? "" : "unread"}`} key={m.id}>
              <div>
                <strong>{m.name}</strong> <a className="link" href={`mailto:${m.email}`}>{m.email}</a>
                {!m.is_read && <span className="badge inline">{tr("new", "نیا")}</span>}
                <p className="pre">{m.message}</p>
                <small className="muted">{formatDate(m.created_at)}</small>
              </div>
              <div className="row-actions">
                <button className="icon-btn" aria-label={m.is_read ? tr("Mark unread", "نہ پڑھا") : tr("Mark read", "پڑھا ہوا")} onClick={() => act(() => post(`/admin/messages/${m.id}`, { is_read: !m.is_read }, "PATCH"), tr("Message updated.", "پیغام اپ ڈیٹ ہوگیا۔"))}><Icon name={m.is_read ? "mail" : "mailopen"} size={16} /></button>
                <button className="icon-btn danger" aria-label={tr("Delete message", "پیغام حذف")} onClick={() => confirmThen(tr("Delete this message?", "کیا یہ پیغام حذف کریں؟"), () => act(() => api(`/admin/messages/${m.id}`, { method: "DELETE", token }), tr("Message deleted.", "پیغام حذف ہوگیا۔")))}><Icon name="trash" size={16} /></button>
              </div>
            </article>
          ))}
          {!messages.length && <p className="muted">{tr("Your inbox is empty.", "کوئی پیغام نہیں۔")}</p>}
        </section>
      )}

      {/* ───────── ACTIVITY ───────── */}
      {tab === "activity" && tabReady.activity && (
        <section className="panel">
          <h3>{tr("Activity log", "سرگرمی لاگ")}</h3>
          <p className="muted">{tr("The latest 200 administrative actions.", "تازہ ترین 200 انتظامی کارروائیاں۔")}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{tr("When", "کب")}</th><th>{tr("Who", "کس نے")}</th><th>{tr("Action", "کارروائی")}</th><th>{tr("Details", "تفصیل")}</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>{l.full_name}</td>
                    <td><span className="status">{l.action.replaceAll("_", " ").toLowerCase()}</span></td>
                    <td>{l.details}</td>
                  </tr>
                ))}
                {!logs.length && <tr><td colSpan="4">{tr("No activity recorded yet.", "ابھی کوئی سرگرمی درج نہیں۔")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
