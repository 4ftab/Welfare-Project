// Shows what Brevo did with an email after accepting it, so you can see where the delay is.
//
//   npm run email-trace -- "<202610141200.123456@smtp-relay.mailin.fr>"     (the messageId from the log)
//   npm run email-trace -- someone@gmail.com                                (recent emails to that address)
//   npm run email-trace -- someone@gmail.com --days 1
//
// Needs BREVO_API_KEY in backend/.env. Times are UTC, the same clock as the [otp] log lines.
require("dotenv").config({ quiet: true });

const { getEmailEvents, isConfigured } = require("../services/mailer");

const MEANING = {
  requests: "Brevo accepted the send request",
  delivered: "the recipient's mail server accepted it",
  deferred: "the recipient's server said \"try later\" (Brevo is retrying)",
  softBounces: "temporary failure",
  hardBounces: "permanent failure",
  blocked: "Brevo blocked it",
  invalid: "invalid address",
  spam: "recipient marked it as spam",
  error: "Brevo hit an error"
};

const seconds = (from, to) => ((new Date(to) - new Date(from)) / 1000).toFixed(1);

async function run() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf("--days");
  const days = daysIndex >= 0 ? Number(args.splice(daysIndex, 2)[1]) || 2 : 2;
  const target = args[0];

  if (!target) {
    console.error('Usage: npm run email-trace -- "<messageId>"   or   npm run email-trace -- you@example.com');
    process.exitCode = 1;
    return;
  }

  if (!isConfigured()) {
    console.error("BREVO_API_KEY is not set in backend/.env, so Brevo cannot be asked about this email.");
    process.exitCode = 1;
    return;
  }

  const events = await getEmailEvents(
    target.startsWith("<") ? { messageId: target, days } : { email: target, days }
  );

  if (!events.length) {
    console.log("Brevo has no events for that. Check the id/address, and that it was sent in the last", days, "day(s).");
    return;
  }

  const byMessage = new Map();
  for (const event of events) {
    if (!byMessage.has(event.messageId)) byMessage.set(event.messageId, []);
    byMessage.get(event.messageId).push(event);
  }

  for (const [messageId, list] of byMessage) {
    list.sort((a, b) => new Date(a.date) - new Date(b.date));
    const first = list[0].date;
    console.log(`\nMessage ${messageId}  ->  ${list[0].email}`);
    console.log(`Subject: ${(list[0].subject || "").replace(/\d{6}/, "••••••")}`);

    for (const event of list) {
      const note = MEANING[event.event] || "";
      const reason = event.reason ? `  reason: ${event.reason}` : "";
      console.log(
        `  ${event.date}  +${seconds(first, event.date).padStart(7)}s  ${event.event.padEnd(11)} ${note}${reason}`
      );
    }

    const requested = list.find((e) => e.event === "requests");
    const delivered = list.find((e) => e.event === "delivered");
    const deferrals = list.filter((e) => e.event === "deferred").length;

    if (requested && delivered) {
      console.log(`  => Brevo accepted it, and the recipient's server took it ${seconds(requested.date, delivered.date)}s later` +
        (deferrals ? ` (after ${deferrals} deferral${deferrals > 1 ? "s" : ""})` : "") + ".");
    } else if (requested && !delivered) {
      console.log("  => Accepted by Brevo but not delivered yet" + (deferrals ? ` (deferred ${deferrals} time(s))` : "") + ".");
    }
  }
}

run().catch((error) => {
  console.error("Could not read Brevo's event log:", error.message);
  if (error.hint) console.error(error.hint);
  process.exitCode = 1;
});
