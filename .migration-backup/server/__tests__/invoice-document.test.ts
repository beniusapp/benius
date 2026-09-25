import { describe, expect, it } from "vitest";
import { renderInvoiceDocument, type InvoiceDocumentData } from "../invoice-document";

const invoice: InvoiceDocumentData = {
  invoiceNumber: "INV-0094",
  status: "Due",
  createdAt: "2026-08-19T15:38:34.000Z",
  feeName: "Tuition Fee",
  feeType: "Tuition",
  amount: 1000,
  lateFeeAmount: 0,
  frequency: "monthly",
  feePeriodStart: "2026-08-01",
  feePeriodEnd: "2026-08-31",
  academicYear: "2026-27",
  dueDate: "2026-08-31",
  notes: null,
  breakdown: [{ name: "Instruction", purpose: "Monthly tuition", amount: 1000 }],
  lateFeeConfig: { enabled: false, type: "NONE" },
  student: {
    name: "Ananya Sharma",
    digitalStudentId: "MIS-101",
    guardianName: "Rohan Sharma",
    phone: "+91 98765 43210",
    className: "8",
    section: "A",
  },
  school: {
    name: "Benius Public School",
    logoUrl: null,
    addressLine1: "1 Learning Road",
    addressLine2: null,
    city: "Delhi",
    state: "Delhi",
    pinCode: "110001",
    country: "India",
    phone: null,
    email: null,
    affiliationNumber: null,
    gstin: null,
    signatureUrl: null,
    signatoryName: null,
  },
};

describe("renderInvoiceDocument", () => {
  it("renders canonical invoice metadata and the persisted creation timestamp", () => {
    const html = renderInvoiceDocument(invoice);

    expect(html).toContain("INVOICE");
    expect(html).toContain("INV-0094");
    expect(html).toContain("STATUS: DUE");
    expect(html).toContain("19 Aug 2026, 09:08:34 PM IST");
    expect(html).toContain("Rohan Sharma");
    expect(html).toContain("Student Phone");
    expect(html).toContain("+91 98765 43210");
    expect(html).toContain("Tuition Fee");
    expect(html).toContain("Amount in Words");
    expect(html).toContain("One Thousand Rupees Only");
    expect(html).toContain("Component subtotal");
  });

  it.each([
    ["2026-08-21T18:29:59Z", "21 Aug 2026, 11:59:59 PM IST"],
    ["2026-08-21T18:30:00Z", "22 Aug 2026, 12:00:00 AM IST"],
    ["2026-08-21T18:30:01Z", "22 Aug 2026, 12:00:01 AM IST"],
    ["2026-08-22T18:29:59Z", "22 Aug 2026, 11:59:59 PM IST"],
    ["2026-08-22T18:30:00Z", "23 Aug 2026, 12:00:00 AM IST"],
  ])("renders the persisted invoice instant at the IST boundary: %s", (createdAt, expected) => {
    const html = renderInvoiceDocument({ ...invoice, createdAt });
    expect(html).toContain(expected);
    expect(html).toContain("31 Aug 2026");
    expect(html).toContain("August 2026");
  });

  it("renders the persisted invoice frequency in the invoice details table", () => {
    const html = renderInvoiceDocument({ ...invoice, frequency: "quarterly" });

    expect(html).toContain("<td>Quarterly</td>");
    expect(html).not.toContain("<td>—</td>");
  });

  it("does not fabricate guardian information when none is stored", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      student: { ...invoice.student, guardianName: null },
    });

    expect(html).toContain("Not available");
    expect(html).not.toContain("undefined");
  });

  it("renders a professional fallback when the student has no phone number", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      student: { ...invoice.student, phone: null },
    });

    expect(html).toContain("Student Phone");
    expect(html).toContain("Not available");
    expect(html).not.toContain("undefined");
  });

  it("shows the signature image when a signatureUrl is provided", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      school: {
        ...invoice.school,
        signatureUrl: "https://cdn.example.com/sig-school-42.png",
        signatoryName: "Dr. Priya Menon",
      },
    });

    expect(html).toContain("https://cdn.example.com/sig-school-42.png");
    expect(html).toContain("Dr. Priya Menon");
    expect(html).toContain("Authorized Signatory");
    // Must not render blank sig-space placeholder when image is present
    expect(html).not.toContain('class="sig-space"');
  });

  it("renders a clean blank signature area when no signature is configured", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      school: { ...invoice.school, signatureUrl: null, signatoryName: null },
    });

    expect(html).toContain("Authorized Signatory");
    expect(html).toContain('class="sig-space"');
    // Must not output an img tag for the signature
    expect(html).not.toContain('alt="Authorized Signature"');
  });

  it("renders the signatory name label when provided without a signature image", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      school: { ...invoice.school, signatureUrl: null, signatoryName: "Principal" },
    });

    expect(html).toContain("Principal");
    expect(html).toContain("Authorized Signatory");
  });

  it("includes the computer-generated footer statement", () => {
    const html = renderInvoiceDocument(invoice);
    expect(html).toContain("Computer-generated document");
  });

  it("uses compact A4 print rules and keeps the signature/footer together", () => {
    const html = renderInvoiceDocument(invoice);

    expect(html).toContain("@page{size:210mm 297mm;margin:8mm}");
    expect(html).toContain(".invoice{width:194mm;max-width:194mm;margin:0 auto;box-shadow:none;padding:0}");
    expect(html).toContain('class="end-matter"');
    expect(html).toContain("thead{display:table-header-group}");
    expect(html).toContain("tr{break-inside:avoid;page-break-inside:avoid}");
    expect(html).toContain("Amount in Words");
  });

  it("HTML-escapes signatory name to prevent injection", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      school: {
        ...invoice.school,
        signatureUrl: null,
        signatoryName: '<script>alert("xss")</script>',
      },
    });

    // The payload must appear only in its escaped form inside the sig-name element.
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    // The raw unescaped payload tag must not appear anywhere as an HTML element
    // (the legitimate window.print() script tag is distinct and expected).
    expect(html).not.toContain('<script>alert("xss")</script>');
  });
});
