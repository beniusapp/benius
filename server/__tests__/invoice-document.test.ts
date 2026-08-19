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
    expect(html).toContain("Tuition Fee");
    expect(html).toContain("Amount in Words");
    expect(html).toContain("One Thousand Rupees Only");
    expect(html).toContain("Component subtotal");
  });

  it("does not fabricate guardian information when none is stored", () => {
    const html = renderInvoiceDocument({
      ...invoice,
      student: { ...invoice.student, guardianName: null },
    });

    expect(html).toContain("Not available");
    expect(html).not.toContain("undefined");
  });
});