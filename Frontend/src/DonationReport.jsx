
import { useEffect } from "react";

// jsPDF is large and only needed when a report is requested, so it is fetched separately from the main
// bundle (and pre-fetched as soon as the report buttons are on screen).
let jsPDF;
let autoTable;
let pdfLoading;

function loadPdfLibraries() {
  pdfLoading ||= Promise.all([import("jspdf"), import("jspdf-autotable")]).then(([core, table]) => {
    jsPDF = core.jsPDF;
    autoTable = table.default;
  });
  return pdfLoading;
}

const COLORS = {
  emerald: [5, 100, 78],
  teal: [13, 148, 136],
  dark: [25, 45, 43],
  muted: [105, 123, 120],
  light: [241, 248, 246],
  border: [222, 235, 231],
  white: [255, 255, 255],
  gold: [245, 190, 70],
};

const money = (value) =>
  `PKR ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  if (!value) return "N/A";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const getStatus = (donation) =>
  String(
    firstValue(donation.status, donation.payment_status, "Pending")
  );

function drawGradient(doc, x, y, width, height) {
  // jsPDF does not directly provide a standard gradient fill.
  // Narrow adjacent rectangles create a smooth-looking PDF gradient.
  const steps = 100;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);

    const color = COLORS.emerald.map((start, index) =>
      Math.round(start + (COLORS.teal[index] - start) * t)
    );

    doc.setFillColor(...color);
    doc.rect(
      x + (width * i) / steps,
      y,
      width / steps + 0.15,
      height,
      "F"
    );
  }
}

function drawSummaryCard(doc, x, y, width, label, value, accent) {
  doc.setFillColor(...COLORS.white);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, width, 31, 2.5, 2.5, "FD");

  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 2.2, 31, 1, 1, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(label.toUpperCase(), x + 7, y + 9);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(value.length > 19 ? 10 : 13);
  doc.setTextColor(...COLORS.dark);
  doc.text(value, x + 7, y + 21);
}

function createDonationPDF({ user, donations, summary }) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  const name = firstValue(user?.name, user?.full_name, "Valued Donor");
  const email = firstValue(user?.email, "Not provided");

  const totalDonated = Number(
    firstValue(
      summary?.total_donated,
      summary?.total_amount,
      summary?.total_donations_amount,
      summary?.completed_amount,
      donations
        .filter((d) => getStatus(d).toLowerCase() === "paid" ||
          getStatus(d).toLowerCase() === "completed" ||
          getStatus(d).toLowerCase() === "success")
        .reduce((sum, d) => sum + Number(d.amount || 0), 0)
    )
  );

  const donationCount = Number(
    firstValue(
      summary?.total_donations,
      summary?.donation_count,
      donations.length
    )
  );

  const completedCount = donations.filter((d) =>
    ["paid", "completed", "success"].includes(
      getStatus(d).toLowerCase()
    )
  ).length;

  const generatedAt = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // ─── Premium gradient header ──────────────────────────
  drawGradient(doc, 0, 0, pageWidth, 57);

  // Decorative accent
  doc.setFillColor(...COLORS.gold);
  doc.roundedRect(margin, 11, 1.5, 26, 0.75, 0.75, "F");

  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("NOJAWAN ITEHAD WELFARE", margin + 5, 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  doc.text("Donation Report", margin + 5, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Your generosity. Our shared mission.", margin + 5, 36);

  doc.setFontSize(8);
  doc.text(`GENERATED ${generatedAt.toUpperCase()}`, margin + 5, 46);

  // Report identifier on the right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("DONOR STATEMENT", pageWidth - margin, 17, {
    align: "right",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("OFFICIAL RECORD", pageWidth - margin, 23, {
    align: "right",
  });

  // ─── Summary cards ────────────────────────────────────
  const cardsY = 65;
  const cardGap = 4;
  const cardWidth = (contentWidth - cardGap * 2) / 3;

  drawSummaryCard(
    doc,
    margin,
    cardsY,
    cardWidth,
    "Total donated",
    money(totalDonated),
    COLORS.emerald
  );

  drawSummaryCard(
    doc,
    margin + cardWidth + cardGap,
    cardsY,
    cardWidth,
    "Total records",
    String(donationCount),
    COLORS.teal
  );

  drawSummaryCard(
    doc,
    margin + (cardWidth + cardGap) * 2,
    cardsY,
    cardWidth,
    "Completed in list",
    String(completedCount),
    COLORS.gold
  );

  // ─── Donor information panel ──────────────────────────
  const infoY = 105;

  doc.setFillColor(...COLORS.light);
  doc.roundedRect(margin, infoY, contentWidth, 27, 2.5, 2.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.emerald);
  doc.text("DONOR INFORMATION", margin + 6, infoY + 7);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.dark);
  doc.text(String(name), margin + 6, infoY + 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(String(email), margin + 6, infoY + 21);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Private donor statement", pageWidth - margin - 6, infoY + 15, {
    align: "right",
  });

  // ─── Transactions table ───────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.dark);
  doc.text("Donation History", margin, 143);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(
    "A detailed record of donations available in your account",
    margin,
    149
  );

  const rows = donations.map((donation, index) => {
    const reference = firstValue(
      donation.reference,
      donation.transaction_id,
      donation.tracker,
      donation.id,
      "N/A"
    );

    const method = firstValue(
      donation.payment_method,
      donation.method,
      donation.gateway,
      "N/A"
    );

    return [
      String(index + 1).padStart(2, "0"),
      formatDate(
        firstValue(
          donation.created_at,
          donation.donation_date,
          donation.date
        )
      ),
      String(reference),
      String(method),
      getStatus(donation).toUpperCase(),
      money(donation.amount),
    ];
  });

  autoTable(doc, {
    startY: 154,
    margin: { left: margin, right: margin, bottom: 20 },
    head: [[
      "#",
      "DATE",
      "REFERENCE",
      "METHOD",
      "STATUS",
      "AMOUNT",
    ]],
    body: rows.length
      ? rows
      : [["—", "—", "No donations found", "—", "—", "PKR 0.00"]],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 3.2,
      textColor: COLORS.dark,
      lineColor: COLORS.border,
      lineWidth: 0.2,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: COLORS.emerald,
      textColor: COLORS.white,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: 3.5,
      lineColor: COLORS.emerald,
    },
    alternateRowStyles: {
      fillColor: [246, 250, 248],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 23 },
      2: { cellWidth: 36 },
      3: { cellWidth: 23 },
      4: { cellWidth: 24 },
      5: { halign: "right" },
    },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 4) {
        const status = String(data.cell.raw).toLowerCase();

        if (["paid", "completed", "success"].includes(status)) {
          data.cell.styles.textColor = [5, 120, 75];
          data.cell.styles.fontStyle = "bold";
        } else if (["failed", "cancelled", "canceled"].includes(status)) {
          data.cell.styles.textColor = [185, 48, 48];
          data.cell.styles.fontStyle = "bold";
        } else {
          data.cell.styles.textColor = [170, 116, 20];
          data.cell.styles.fontStyle = "bold";
        }
      }

      if (data.section === "body" && data.column.index === 5) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "right";
      }
    },
    didDrawPage() {
      const currentPage = doc.internal.getNumberOfPages();

      // Elegant footer rule
      doc.setDrawColor(...COLORS.border);
      doc.setLineWidth(0.4);
      doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.emerald);
      doc.text("NOJAWAN ITEHAD WELFARE", margin, pageHeight - 9);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COLORS.muted);
      doc.text(
        "Thank you for supporting our mission",
        pageWidth / 2,
        pageHeight - 9,
        { align: "center" }
      );

      doc.text(
        `PAGE ${currentPage}`,
        pageWidth - margin,
        pageHeight - 9,
        { align: "right" }
      );
    },
  });

  return doc;
}

export default function DonationReport({ user, donations = [], summary }) {
  useEffect(() => {
    loadPdfLibraries().catch(() => {});
  }, []);

  const handleDownload = async () => {
    await loadPdfLibraries();
    const doc = createDonationPDF({ user, donations, summary });

    const safeName = String(
      firstValue(user?.name, user?.full_name, "Donor")
    )
      .trim()
      .replace(/[^a-z0-9_-]/gi, "_");

    doc.save(`Nojawan_Itehad_Donation_Report_${safeName}.pdf`);
  };

  const handlePrint = async () => {
    await loadPdfLibraries();
    const doc = createDonationPDF({ user, donations, summary });
    const blobUrl = doc.output("bloburl");
    const printWindow = window.open(blobUrl, "_blank");

    if (!printWindow) {
      window.alert(
        "Your browser blocked the print window. Please allow pop-ups and try again."
      );
    }
  };

  return (
    <section
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        marginTop: "18px",
      }}
    >
      <button
        type="button"
        onClick={handleDownload}
        style={{
          border: "none",
          borderRadius: "10px",
          padding: "12px 20px",
          color: "#fff",
          fontWeight: 700,
          cursor: "pointer",
          background: "linear-gradient(110deg, #05644e 0%, #0d9488 100%)",
          boxShadow: "0 5px 14px rgba(5, 100, 78, 0.22)",
        }}
      >
        Download PDF Report
      </button>

      <button
        type="button"
        onClick={handlePrint}
        style={{
          border: "1px solid #cbded7",
          borderRadius: "10px",
          padding: "12px 20px",
          color: "#075e4b",
          fontWeight: 700,
          cursor: "pointer",
          background: "#ffffff",
        }}
      >
        Print Report
      </button>
    </section>
  );
}
