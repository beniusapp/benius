import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoiceDocument } from "./invoice-document";

test("invoice keeps the stored late-fee snapshot while showing current accrued amount and historical roll", () => {
  const html = renderInvoiceDocument({
    invoiceNumber: "INV-TEST", status: "Due", createdAt: "2026-10-01T10:00:00Z",
    feeName: "Tuition", feeType: "TUITION", amount: 100, lateFeeAmount: 10,
    currentLateFeeAmount: 25, frequency: null, feePeriodStart: null, feePeriodEnd: null,
    academicYear: "2026–27", dueDate: "2026-10-01", notes: null, breakdown: [],
    lateFeeConfig: null,
    student: {
      name: "Student", digitalStudentId: "S-1", guardianName: null, phone: null,
      className: "Class 4", section: "B", rollNumber: 17,
    },
    school: {
      name: "School", logoUrl: null, addressLine1: null, addressLine2: null, city: null,
      state: null, pinCode: null, country: null, phone: null, email: null,
      affiliationNumber: null, gstin: null, signatureUrl: null, signatoryName: null,
    },
  });
  assert.match(html, /Roll Number<\/span><span>17/);
  assert.match(html, /Invoice amount \(snapshot\)/);
  assert.match(html, /Current accrued late fee/);
  assert.match(html, /Current amount due/);
  assert.match(html, /INR&nbsp;|INR/);
});
