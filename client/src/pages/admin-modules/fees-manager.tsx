import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CreditCard, Plus, Search, Loader2, Trash2, Pencil, CheckCircle2, AlertTriangle, Clock,
  Receipt, DollarSign, TrendingUp, TrendingDown, Banknote, Wallet, BookOpen, Bell, ExternalLink,
  Shield, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Lock, X, Printer, History, Download, FileText,
  FileCheck2, Building2, QrCode, Monitor, MessageSquare, Mail, Send, Eye, EyeOff, Zap, Phone, BarChart2, Calendar, Users,
  PenLine, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, sessionFetch, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { amountInWords, formatIndianRupees } from "@/lib/amount-in-words";
import { formatPersistedInvoiceDateTimeIST } from "@/lib/invoice-date-time";

// ─── Types ────────────────────────────────────────────────────────────────────
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface StudentItem {
  id: number;
  name: string;
  class: string;
  section: string;
  digitalStudentId: string;
  isActive: boolean;
}

interface FeeRecordWithStudent {
  id: number;
  studentId: number;
  schoolId: number;
  feeType: string;
  feeName: string;          // resolved server-side: always current structure name
  amount: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
  paymentMethod: string | null;
  receiptNumber: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  academicYear: string | null;
  createdAt: string;
  student: { name: string; class: string; section: string; digitalStudentId: string } | null;
}

interface LedgerPageResponse {
  records: FeeRecordWithStudent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface FeeStructure {
  id: number;
  schoolId: number;
  name: string;
  feeType: string;
  amount: number;
  frequency: string;
  applicableClasses: string[];
  dueDayOfMonth: number | null;
  breakdown: Array<{ name: string; purpose: string; amount: number }>;
  lateFeeConfig?: {
    enabled?: boolean;
    type?: "NONE" | "FLAT" | "DAILY" | "TIERED";
    grace_period_days?: number;
    flat_amount?: number;
    daily_rate?: number;
    max_cap?: number;
    tiered_slabs?: Array<{ from_day: number; to_day: number; amount: number }>;
  } | null;
  lastInvoicesGeneratedAt: string | null;
  latestGeneratedFeePeriodStart: string | null;
  latestGeneratedFeePeriodEnd: string | null;
  createdAt: string;
}

type InvoiceBreakdownRow = { name: string; purpose: string; amount: string };

type InvoicePeriodOption = {
  value: string;
  label: string;
  start: string;
  end: string;
};

function addInvoicePeriodOptionsForSession(
  frequency: string,
  session: { startDate?: string | null; endDate?: string | null } | null,
): InvoicePeriodOption[] {
  const sessionStart = String(session?.startDate ?? "").slice(0, 10);
  const sessionEnd = String(session?.endDate ?? "").slice(0, 10);
  if (!sessionStart || !sessionEnd) return [];
  if (frequency === "annual" || frequency === "one-time") {
    return [{
      value: "active-session",
      label: (session as AcademicSession | null)?.sessionName ?? `${sessionStart} – ${sessionEnd}`,
      start: sessionStart,
      end: sessionEnd,
    }];
  }

  const isWithinSession = (start: string, end: string) =>
    start >= sessionStart && end <= sessionEnd;
  const options: InvoicePeriodOption[] = [];
  const monthPeriod = (year: number, month: number): InvoicePeriodOption => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return {
      value: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      end: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  };
  const quarterPeriod = (year: number, quarterStartMonth: number): InvoicePeriodOption => {
    const quarterStart = new Date(year, quarterStartMonth, 1);
    const quarterEnd = new Date(year, quarterStartMonth + 2, 1);
    const lastDay = new Date(year, quarterStartMonth + 3, 0).getDate();
    return {
      value: `${year}-Q${Math.floor(quarterStartMonth / 3) + 1}`,
      label: `${quarterStart.toLocaleDateString("en-IN", { month: "long" })}–${quarterEnd.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`,
      start: `${year}-${String(quarterStartMonth + 1).padStart(2, "0")}-01`,
      end: `${quarterEnd.getFullYear()}-${String(quarterEnd.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  };

  const startDate = new Date(`${sessionStart}T00:00:00`);
  const endDate = new Date(`${sessionEnd}T00:00:00`);
  if (frequency === "quarterly") {
    let current = new Date(
      startDate.getFullYear(),
      Math.floor(startDate.getMonth() / 3) * 3,
      1,
    );
    while (current <= endDate) {
      const candidate = quarterPeriod(current.getFullYear(), current.getMonth());
      if (isWithinSession(candidate.start, candidate.end)) options.push(candidate);
      current = new Date(current.getFullYear(), current.getMonth() + 3, 1);
    }
    return options;
  }

  let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (current <= endDate) {
    const candidate = monthPeriod(current.getFullYear(), current.getMonth());
    if (isWithinSession(candidate.start, candidate.end)) options.push(candidate);
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }
  return options;
}

function preferredInvoicePeriod(options: InvoicePeriodOption[]): InvoicePeriodOption | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return options.find(option => option.start <= today && option.end >= today) ?? options[0];
}

interface AuditLogEntry {
  id: number;
  schoolId: number;
  actorId: number | null;
  actorName: string | null;
  ipAddress: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string | null;
  createdAt: string;
}

interface ExternalSettings {
  isEnabled: boolean;
  gatewayUrl: string | null;
  bannerMessage: string | null;
  maxOvercollectionPercent: number | null;
  razorpayEnabled: boolean;
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  razorpayMode: string;
  feeReceiptSignatureUrl: string | null;
}

interface NotifConfig {
  smsEnabled: boolean;
  msg91AuthKey: string | null;
  msg91SenderId: string | null;
  waEnabled: boolean;
  msg91WaNumber: string | null;
  msg91WaTemplate: string | null;
  emailEnabled: boolean;
  sendgridApiKey: string | null;
  sendgridFromEmail: string | null;
  sendgridFromName: string | null;
}

interface DunningLogEntry {
  id: number;
  feeRecordId: number;
  channel: string;
  stage: string;
  sentAt: string;
  status: string;
  errorMessage: string | null;
  recipient: string | null;
  studentName: string | null;
}

interface DunningTemplateRow {
  id: number;
  stage: string;
  channel: string;
  bodyText: string;
  subjectText: string | null;
}

interface DunningJobStatusData {
  isRunning: boolean;
  startedAt: string | null;
  lastCompletedAt: string | null;
}

interface AcademicSession {
  id: number;
  sessionName: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

interface FeeSummary {
  totalRevenue: number;
  outstanding: number;
  collectionRate: number;
  offlinePaymentsCount: number;
}

interface UnpaidInvoice {
  id: number;
  studentId: number;
  feeType: string;
  feeName?: string | null;
  amount: number;
  dueDate: string;
  status: string;
  invoiceNumber: string | null;
  feePeriodStart: string | null;
  feePeriodEnd: string | null;
  lateFeeAmount: number;
  academicYear: string | null;
  accruedLateFee: number;
  totalDue: number;  // amount + accruedLateFee
}

interface PaymentRecord {
  id: number;
  feeRecordId: number | null;
  studentId: number;
  paymentMethod: string;
  amount: number;
  lateFeePaid?: number;
  receivedDate: string;
  referenceNumber: string | null;
  cashierNotes: string | null;
  receiptNumber: string | null;
  invoiceNumber?: string | null;
  // Razorpay metadata (populated for online payments)
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  razorpaySignature?: string | null;
  paymentMode?: string | null;
  bankName?: string | null;
  cardLast4?: string | null;
  vpa?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  payerContact?: string | null;
  gatewayStatus?: string | null;
  createdAt?: string;
}

interface TransactionDetail {
  feeRecord: {
    id: number;
    feeType: string;
    feeName: string;
    amount: number;
    lateFeeAmount: number;
    dueDate: string;
    paidDate: string | null;
    status: string;
    academicYear: string | null;
    notes: string | null;
    invoiceNumber: string | null;
    frequency: string | null;
    feePeriodStart: string | null;
    feePeriodEnd: string | null;
    lateFeeConfig: {
      enabled?: boolean;
      type?: "NONE" | "FLAT" | "DAILY" | "TIERED";
      grace_period_days?: number;
      flat_amount?: number;
      daily_rate?: number;
      max_cap?: number;
      tiered_slabs?: Array<{ from_day: number; to_day: number; amount: number }>;
    } | null;
    createdAt: string;
    createdBy: number | null;
    breakdown: Array<{ name: string; purpose: string; amount: number }>;
  };
  payments: PaymentRecord[];
  payment: PaymentRecord | null;
  student: {
    name: string;
    digitalStudentId: string;
    class: string;
    section: string;
    rollNumber: number | null;
    guardianName: string | null;
    phone: string | null;
    email: string | null;
  };
  school: {
    name: string;
    logoUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    affiliationNumber: string | null;
    gstin: string | null;
  };
  auditEntries: Array<{
    id: number;
    action: string;
    actorName: string | null;
    actorId: number | null;
    ipAddress: string | null;
    description: string | null;
    createdAt: string;
  }>;
}
function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function invoiceFrequencyLabel(frequency: string | null): string {
  const labels: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
    "one-time": "One-Time",
  };
  return frequency ? (labels[frequency] ?? frequency) : "—";
}

function lateFeeRuleLabel(type: string | undefined): string {
  if (type === "FLAT") return "Flat One-Time Penalty";
  if (type === "DAILY") return "Daily Accumulating Fine";
  if (type === "TIERED") return "Tiered Schedule";
  return type ?? "—";
}

function invoiceFeePeriodLabel(feeRecord: Pick<TransactionDetail["feeRecord"], "feePeriodStart" | "feePeriodEnd" | "frequency" | "academicYear">): string {
  if (!feeRecord.feePeriodStart || !feeRecord.feePeriodEnd) return "—";
  if ((feeRecord.frequency === "annual" || feeRecord.frequency === "one-time") && feeRecord.academicYear) {
    return feeRecord.academicYear;
  }
  return clientFeePeriodLabel(feeRecord.feePeriodStart, feeRecord.feePeriodEnd);
}

function escapeInvoiceHtml(value: unknown): string {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printCreatedInvoice(detail: TransactionDetail, existingWindow?: Window | null): boolean {
  const { feeRecord, student, school } = detail;
  const lateFee = feeRecord.lateFeeConfig;
  const lateFeeEnabled = lateFee?.enabled === true;
  const feePeriod = invoiceFeePeriodLabel(feeRecord);
  const invoiceAmount = Number(feeRecord.amount);
  const assessedLateFee = Math.max(0, Number(feeRecord.lateFeeAmount ?? 0));
  const totalPayable = invoiceAmount + assessedLateFee;
  const fmtInvoiceAmount = (amount: number) => formatIndianRupees(amount);
  const componentSubtotal = feeRecord.breakdown.reduce(
    (total, component) => total + Number(component.amount ?? 0),
    0,
  );
  const formatIssueDate = (value: string | null) => {
    if (!value) return "—";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value);
    return date.toLocaleDateString("en-IN", {
      timeZone: dateOnly ? "UTC" : "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };
  const schoolAddress = [
    school.addressLine1,
    school.addressLine2,
    [school.city, school.state, school.pinCode].filter(Boolean).join(", "),
    school.country && school.country !== "India" ? school.country : null,
  ].filter(Boolean);
  const schoolContact = [
    school.phone ? `Phone: ${school.phone}` : null,
    school.email ? `Email: ${school.email}` : null,
  ].filter(Boolean);
  const schoolRegulatoryDetails = [
    school.affiliationNumber ? `Affiliation No. ${school.affiliationNumber}` : null,
    school.gstin ? `GSTIN ${school.gstin}` : null,
  ].filter(Boolean);
  const lateFeePolicy = !lateFeeEnabled
    ? `<div class="policy policy-disabled"><span>Late Fee &amp; Penalty</span><strong>Disabled</strong></div>`
    : `
      <section class="policy">
        <div class="policy-heading"><span>Late Fee &amp; Penalty</span><strong>Enabled</strong></div>
        <dl class="policy-grid">
          <div><dt>Rule type</dt><dd>${escapeInvoiceHtml(lateFeeRuleLabel(lateFee?.type))}</dd></div>
          ${lateFee?.type === "FLAT" ? `<div><dt>Penalty amount</dt><dd>${escapeInvoiceHtml(fmt(Number(lateFee.flat_amount ?? 0)))}</dd></div>` : ""}
          ${lateFee?.type === "DAILY" ? `<div><dt>Daily penalty</dt><dd>${escapeInvoiceHtml(fmt(Number(lateFee.daily_rate ?? 0)))} / day</dd></div>` : ""}
          ${lateFee?.type === "DAILY" && Number(lateFee.grace_period_days ?? 0) > 0 ? `<div><dt>Grace period</dt><dd>${escapeInvoiceHtml(lateFee.grace_period_days)} day(s)</dd></div>` : ""}
          ${lateFee?.type === "DAILY" && Number(lateFee.max_cap ?? 0) > 0 ? `<div><dt>Maximum cap</dt><dd>${escapeInvoiceHtml(fmt(Number(lateFee.max_cap)))}</dd></div>` : ""}
          ${lateFee?.type === "TIERED" && lateFee.tiered_slabs?.length ? `<div class="policy-full"><dt>Penalty schedule</dt><dd>${lateFee.tiered_slabs.map(slab => `${escapeInvoiceHtml(slab.from_day)}–${escapeInvoiceHtml(slab.to_day)} days: ${escapeInvoiceHtml(fmt(Number(slab.amount)))}`).join(" &nbsp;•&nbsp; ")}</dd></div>` : ""}
        </dl>
      </section>
    `;
  const componentRows = feeRecord.breakdown.length > 0
    ? `
      <section class="document-section component-section">
        <div class="section-label">Fee Breakdown</div>
        <table class="invoice-table">
          <thead><tr><th>Component</th><th>Description</th><th class="amount-cell">Amount</th></tr></thead>
          <tbody>${feeRecord.breakdown.map(component => `
            <tr>
              <td>${escapeInvoiceHtml(component.name)}</td>
              <td>${escapeInvoiceHtml(component.purpose || "—")}</td>
              <td class="amount-cell">${escapeInvoiceHtml(fmt(Number(component.amount)))}</td>
            </tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="2">Component subtotal</td><td class="amount-cell">${escapeInvoiceHtml(fmt(componentSubtotal))}</td></tr></tfoot>
        </table>
      </section>`
    : "";
  const logo = school.logoUrl
    ? `<img class="school-logo" src="${escapeInvoiceHtml(school.logoUrl)}" alt="" onerror="this.style.display='none'">`
    : "";
  const printWindow = existingWindow ?? window.open("", "_blank");
  if (!printWindow) return false;
  // Keep a usable same-origin document reference for printing while preventing
  // the printed tab from retaining access back to the admin portal.
  printWindow.opener = null;
  printWindow.document.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice ${escapeInvoiceHtml(feeRecord.invoiceNumber)}</title>
<style>
  @page{size:A4;margin:15mm}
  :root{color-scheme:light} *{box-sizing:border-box}
  body{margin:0;background:#edf1f5;color:#172033;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:10.5pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .invoice{width:min(100%,180mm);min-height:267mm;margin:24px auto;background:#fff;box-shadow:0 8px 28px rgba(15,39,71,.14);padding:0 11mm 8mm}
  .invoice-header{display:flex;justify-content:space-between;gap:18mm;padding:11mm 0 8mm;border-bottom:2px solid #183b61}
  .school-identity{display:flex;gap:12px;min-width:0}.school-logo{width:42px;height:42px;object-fit:contain;flex:0 0 auto}.school-name{font-size:16pt;line-height:1.15;font-weight:800;letter-spacing:-.025em;color:#102b49;margin:0 0 5px}.school-address,.school-contact,.school-regulatory{font-size:8.6pt;color:#536579;margin:0;overflow-wrap:anywhere}.school-contact{margin-top:3px}.school-regulatory{margin-top:2px;color:#75869a}
  .document-title{text-align:right;flex:0 0 auto}.document-title h1{font-size:24pt;letter-spacing:.15em;line-height:1;margin:0 0 9px;color:#102b49;font-weight:850}.invoice-number-label,.section-label,.metadata-label{display:block;font-size:8.2pt;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#708196}.invoice-number{font-size:17pt;font-weight:850;color:#102b49;letter-spacing:.035em;overflow-wrap:anywhere}.status-badge{display:inline-block;margin-top:8px;border:1px solid #c78b24;background:#fff7e8;color:#8b5a08;padding:3px 8px;font-size:8pt;line-height:1.25;font-weight:800;letter-spacing:.1em}
  .metadata-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:8mm 0 6mm;border-bottom:1px solid #d9e1e8}.metadata-card{min-width:0}.metadata-card+.metadata-card{border-left:1px solid #d9e1e8;padding-left:16px}.metadata-title{margin:0 0 8px;color:#102b49;font-size:8.2pt;text-transform:uppercase;letter-spacing:.13em;font-weight:800}.student-name{font-size:13pt;color:#172033;font-weight:800;margin:0 0 3px}.student-id{margin:0;color:#627386;font-size:9pt}.metadata-rows{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin:10px 0 0}.metadata-label{font-size:7.6pt;align-self:baseline}.metadata-value{font-size:9.3pt;font-weight:650;text-align:right;overflow-wrap:anywhere;color:#26384a}
  .document-section{padding-top:7mm;break-inside:avoid}.invoice-table{width:100%;border-collapse:collapse;table-layout:fixed}.invoice-table th{background:#102b49;color:#fff;font-size:7.8pt;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-align:left;padding:8px 9px}.invoice-table td{padding:9px;border-bottom:1px solid #dce4eb;vertical-align:top;font-size:9.4pt;overflow-wrap:anywhere}.invoice-table td:first-child{font-weight:700;color:#26384a}.invoice-table th:first-child{width:29%}.invoice-table th:nth-child(2){width:18%}.invoice-table th:nth-child(3){width:17%}.invoice-table th:nth-child(4){width:21%}.amount-cell{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap}.invoice-table tfoot td{border-top:1px solid #aab8c5;border-bottom:0;background:#f6f8fa;font-size:8.8pt;font-weight:800}.component-section .invoice-table th:first-child{width:30%}.component-section .invoice-table th:nth-child(2){width:auto}.component-section .invoice-table th:nth-child(3){width:22%}
  .summary-layout{display:grid;grid-template-columns:minmax(0,1fr) 68mm;gap:16px;padding-top:7mm;align-items:start}.policy{border:1px solid #dce4eb;border-left:3px solid #3b6388;padding:10px 11px;break-inside:avoid}.policy-disabled{display:flex;align-items:center;justify-content:space-between;gap:12px;border-left-color:#aab8c5;background:#fafbfc;color:#4d5f72;font-size:9pt}.policy-heading{display:flex;justify-content:space-between;gap:12px;color:#102b49;font-size:9.2pt;font-weight:800}.policy-heading strong{color:#8b5a08}.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin:9px 0 0}.policy-grid div{min-width:0}.policy-grid .policy-full{grid-column:1/-1}.policy-grid dt{font-size:7.4pt;text-transform:uppercase;letter-spacing:.09em;color:#708196;font-weight:800}.policy-grid dd{margin:2px 0 0;font-size:8.8pt;color:#314457;overflow-wrap:anywhere}
  .amount-summary{border:1px solid #b9c7d4;break-inside:avoid}.amount-summary-header{padding:8px 10px;background:#eef4f8;color:#102b49;font-size:8pt;font-weight:800;text-transform:uppercase;letter-spacing:.12em}.summary-rows{padding:7px 10px 0}.summary-row{display:flex;justify-content:space-between;gap:14px;padding:4px 0;color:#536579;font-size:9pt}.summary-row strong{font-variant-numeric:tabular-nums;color:#26384a}.amount-words{margin-top:7px;padding:8px 10px;border-top:1px solid #dce4eb;background:#fafbfc}.amount-words-label{display:block;color:#708196;font-size:7.4pt;text-transform:uppercase;letter-spacing:.09em;font-weight:800}.amount-words-value{display:block;margin-top:3px;color:#26384a;font-size:8.7pt;font-weight:700;line-height:1.35;overflow-wrap:anywhere}.summary-total{display:flex;justify-content:space-between;gap:14px;margin-top:7px;padding:9px 10px;background:#102b49;color:#fff;font-size:9.4pt;font-weight:800;text-transform:uppercase;letter-spacing:.055em}.summary-total strong{font-size:14pt;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:0}.payment-status{padding:8px 10px;font-size:8.2pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8b5a08;background:#fffaf0;border-top:1px solid #efd6a3}
  .notes{margin-top:7mm;border:1px solid #dce4eb;padding:10px 11px;break-inside:avoid}.notes p{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#34485b;font-size:9.2pt}.invoice-footer{margin-top:8mm;padding-top:5mm;border-top:1px solid #d9e1e8;color:#617387;font-size:8.1pt;text-align:center}.invoice-footer p{margin:2px 0}.invoice-footer .invoice-notice{color:#394e63;font-weight:650}
  thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}h1,h2,h3,p{orphans:3;widows:3}
  @media print{body{background:#fff}.invoice{width:auto;min-height:0;margin:0;box-shadow:none;padding:0}.invoice-header{padding-top:0}.document-section,.policy,.amount-summary,.notes{break-inside:avoid;page-break-inside:avoid}}
  @media screen and (max-width:720px){body{background:#fff}.invoice{width:100%;margin:0;padding:0 20px 24px;box-shadow:none}.invoice-header{gap:18px}.metadata-grid,.summary-layout{grid-template-columns:1fr}.metadata-card+.metadata-card{border-left:0;border-top:1px solid #d9e1e8;padding:14px 0 0}.document-title h1{font-size:18pt}.invoice-table{font-size:8.5pt}.policy-grid{grid-template-columns:1fr}}
</style></head><body>
<article class="invoice">
   <header class="invoice-header">
     <div class="school-identity">
       ${logo}
       <div>
         <p class="school-name">${escapeInvoiceHtml(school.name)}</p>
         ${schoolAddress.length ? `<p class="school-address">${schoolAddress.map(line => escapeInvoiceHtml(line)).join("<br>")}</p>` : ""}
         ${schoolContact.length ? `<p class="school-contact">${schoolContact.map(item => escapeInvoiceHtml(item)).join(" &nbsp;|&nbsp; ")}</p>` : ""}
         ${schoolRegulatoryDetails.length ? `<p class="school-regulatory">${schoolRegulatoryDetails.map(item => escapeInvoiceHtml(item)).join(" &nbsp;|&nbsp; ")}</p>` : ""}
       </div>
     </div>
     <div class="document-title">
       <h1>INVOICE</h1>
       <span class="invoice-number-label">Invoice No.</span>
       <div class="invoice-number">${escapeInvoiceHtml(feeRecord.invoiceNumber)}</div>
       <span class="status-badge">Status: ${escapeInvoiceHtml(feeRecord.status.toUpperCase())}</span>
     </div>
  </header>
   <section class="metadata-grid">
     <div class="metadata-card">
       <h2 class="metadata-title">Billed To / Student Details</h2>
       <p class="student-name">${escapeInvoiceHtml(student.name)}</p>
       <p class="student-id">Student ID / MIS ID: ${escapeInvoiceHtml(student.digitalStudentId)}</p>
       <div class="metadata-rows">
         <span class="metadata-label">Parent / Guardian</span><span class="metadata-value">${escapeInvoiceHtml(student.guardianName?.trim() || "Not available")}</span>
         <span class="metadata-label">Class</span><span class="metadata-value">${escapeInvoiceHtml(student.class)}</span>
         <span class="metadata-label">Section</span><span class="metadata-value">${escapeInvoiceHtml(student.section)}</span>
       </div>
     </div>
     <div class="metadata-card">
       <h2 class="metadata-title">Invoice Metadata</h2>
       <div class="metadata-rows">
         <span class="metadata-label">Invoice Date &amp; Time</span><span class="metadata-value">${escapeInvoiceHtml(formatPersistedInvoiceDateTimeIST(feeRecord.createdAt))}</span>
         <span class="metadata-label">Academic Session</span><span class="metadata-value">${escapeInvoiceHtml(feeRecord.academicYear)}</span>
         <span class="metadata-label">Fee Period</span><span class="metadata-value">${escapeInvoiceHtml(feePeriod)}</span>
         <span class="metadata-label">Due Date</span><span class="metadata-value">${escapeInvoiceHtml(formatIssueDate(feeRecord.dueDate))}</span>
         <span class="metadata-label">Frequency</span><span class="metadata-value">${escapeInvoiceHtml(invoiceFrequencyLabel(feeRecord.frequency))}</span>
       </div>
     </div>
   </section>
   <section class="document-section">
     <div class="section-label">Invoice Details</div>
     <table class="invoice-table">
       <thead><tr><th>Description</th><th>Fee Type</th><th>Frequency</th><th>Fee Period</th><th class="amount-cell">Amount</th></tr></thead>
       <tbody><tr><td>${escapeInvoiceHtml(feeRecord.feeName)}</td><td>${escapeInvoiceHtml(feeRecord.feeType)}</td><td>${escapeInvoiceHtml(invoiceFrequencyLabel(feeRecord.frequency))}</td><td>${escapeInvoiceHtml(feePeriod)}</td><td class="amount-cell">${escapeInvoiceHtml(fmtInvoiceAmount(invoiceAmount))}</td></tr></tbody>
     </table>
   </section>
   ${componentRows}
   <section class="summary-layout">
     <div>${lateFeePolicy}</div>
     <aside class="amount-summary">
       <div class="amount-summary-header">Amount Summary</div>
       <div class="summary-rows">
         <div class="summary-row"><span>Invoice amount</span><strong>${escapeInvoiceHtml(fmtInvoiceAmount(invoiceAmount))}</strong></div>
         ${assessedLateFee > 0 ? `<div class="summary-row"><span>Late fee assessed</span><strong>${escapeInvoiceHtml(fmtInvoiceAmount(assessedLateFee))}</strong></div>` : ""}
       </div>
       <div class="amount-words"><span class="amount-words-label">Amount in Words</span><span class="amount-words-value">${escapeInvoiceHtml(amountInWords(invoiceAmount))}</span></div>
       <div class="summary-total"><span>Total Payable</span><strong>${escapeInvoiceHtml(fmtInvoiceAmount(totalPayable))}</strong></div>
       <div class="payment-status">Payment Status: ${escapeInvoiceHtml(feeRecord.status.toUpperCase())}</div>
     </aside>
   </section>
   ${feeRecord.notes ? `<section class="notes"><span class="section-label">Notes</span><p>${escapeInvoiceHtml(feeRecord.notes)}</p></section>` : ""}
   <footer class="invoice-footer">
     <p class="invoice-notice">This document is an invoice and confirms the amount due. A payment receipt will be issued separately after successful payment.</p>
     ${schoolContact.length ? `<p>${schoolContact.map(item => escapeInvoiceHtml(item)).join(" &nbsp;|&nbsp; ")}</p>` : ""}
     <p>Computer-generated invoice. No signature is required.</p>
   </footer>
</article>
<script>
  (function () {
    var printDocument = function () { window.setTimeout(function () { window.print(); }, 180); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(printDocument);
    else if (document.readyState === "complete") printDocument();
    else window.addEventListener("load", printDocument, { once: true });
  })();
</script></body></html>`);
  printWindow.document.close();
  return true;
}

// IST helpers — always use Asia/Kolkata so the time is correct regardless of
// the server's or browser's local timezone.
function fmtDateTimeIST(ts: string | Date | null | undefined): string {
  return formatPersistedInvoiceDateTimeIST(ts);
}

/** Returns the current wall-clock time formatted in IST, e.g. "09:15 PM IST" */
function nowIST(): string {
  return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase() + " IST";
}

function StatusChip({ status }: { status: string }) {
  const variants: Record<string, { cls: string; icon: React.ReactNode }> = {
    Paid:    { cls: "bg-emerald-900/40 text-emerald-400 border-emerald-700/40", icon: <CheckCircle2 className="w-3 h-3" /> },
    Overdue: { cls: "bg-red-900/40 text-red-400 border-red-700/40",           icon: <AlertTriangle className="w-3 h-3" /> },
    Due:     { cls: "bg-amber-900/40 text-amber-400 border-amber-700/40",     icon: <Clock className="w-3 h-3" /> },
  };
  const v = variants[status] ?? variants.Due;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${v.cls}`}>
      {v.icon} {status}
    </span>
  );
}

function PaymentMethodBadge({ method }: { method: string | null }) {
  const variants: Record<string, { cls: string; icon?: React.ReactNode }> = {
    Cash: {
      cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
      icon: <Wallet className="w-3 h-3" />,
    },
    Cheque: {
      cls: "bg-blue-500/10 text-blue-300 border-blue-500/25",
      icon: <FileCheck2 className="w-3 h-3" />,
    },
    "Bank Transfer": {
      cls: "bg-indigo-500/10 text-indigo-300 border-indigo-500/25",
      icon: <Building2 className="w-3 h-3" />,
    },
    "Demand Draft": {
      cls: "bg-amber-500/10 text-amber-300 border-amber-500/25",
      icon: <FileText className="w-3 h-3" />,
    },
    "UPI / QR": {
      cls: "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
      icon: <QrCode className="w-3 h-3" />,
    },
    "Portal Payment": {
      cls: "bg-violet-500/10 text-violet-300 border-violet-500/25",
      icon: <Monitor className="w-3 h-3" />,
    },
    "—": {
      cls: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    },
  };
  const label = method ?? "—";
  const variant = variants[label] ?? variants["—"];

  return (
    <span
      className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium leading-4 whitespace-nowrap ${variant.cls}`}
      title={label}
    >
      {variant.icon && <span aria-hidden="true">{variant.icon}</span>}
      {label}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    create:           "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
    update:           "bg-blue-900/40 text-blue-400 border-blue-700/40",
    delete:           "bg-red-900/40 text-red-400 border-red-700/40",
    payment:          "bg-cyan-900/40 text-cyan-400 border-cyan-700/40",
    settings_change:  "bg-purple-900/40 text-purple-400 border-purple-700/40",
    waiver:           "bg-amber-900/40 text-amber-400 border-amber-700/40",
    blocked_payment:  "bg-orange-900/40 text-orange-400 border-orange-700/40",
    payment_failed:   "bg-red-900/60 text-red-400 border-red-700/60",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${map[action] ?? "bg-white/10 text-white/60 border-white/10"}`}>
      {action}
    </span>
  );
}

function TxnDetailRow({ label, value }: { label: string; value: React.ReactNode | string | null | undefined }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-white/35 w-28 shrink-0 leading-snug">{label}</span>
      <span className="text-white/80 font-medium leading-snug break-all">
        {value == null || value === "" ? <span className="text-white/25 italic">—</span> : value}
      </span>
    </div>
  );
}
function MetricBar({ viewSessionId }: { viewSessionId: number | null }) {
  const { data, isLoading } = useQuery<FeeSummary>({
    queryKey: ["/api/admin/fees/summary", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/summary");
      if (!r.ok) throw new Error("Failed to fetch fee summary");
      return r.json();
    },
    staleTime: 30_000,
  });

  const cards = [
    { label: "Total Revenue",     value: isLoading ? "…" : fmt(data?.totalRevenue ?? 0),            Icon: DollarSign,    ib: "border-[#D4AF37]/30 bg-[#D4AF37]/5",  ic: "text-[#D4AF37]" },
    { label: "Outstanding",       value: isLoading ? "…" : fmt(data?.outstanding ?? 0),             Icon: TrendingDown,  ib: "border-red-500/30 bg-red-500/5",       ic: "text-red-400"   },
    { label: "Collection Rate",   value: isLoading ? "…" : `${data?.collectionRate ?? 0}%`,         Icon: TrendingUp,    ib: "border-emerald-500/30 bg-emerald-500/5",ic: "text-emerald-400"},
    { label: "Offline Payments",  value: isLoading ? "…" : String(data?.offlinePaymentsCount ?? 0), Icon: Banknote,      ib: "border-cyan-500/30 bg-cyan-500/5",     ic: "text-cyan-400"  },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ label, value, Icon, ib, ic }) => (
        <div key={label} className={`rounded-xl border ${ib} p-4 flex items-center gap-3`}>
          <div className={`p-2 rounded-lg bg-white/5 ${ic}`}><Icon className="w-5 h-5" /></div>
          <div>
            <p className="text-white/50 text-xs mb-0.5">{label}</p>
            <p className="text-white font-bold text-lg leading-none">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Denomination face values (₹) for cash payment counting */
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

// ─── Standalone Offline Payment Modal (Invoice-Picker) ────────────────────────
// Admin selects a student → sees their unpaid invoices → picks one invoice →
// enters payment method/date → one payment is created for that invoice.
// No free-form fee-type or amount entry — amounts come exclusively from invoices.

interface StandaloneOfflinePayModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function StandaloneOfflinePayModal({ open, onClose, onSuccess }: StandaloneOfflinePayModalProps) {
  const { toast } = useToast();
  type Step = "search" | "select" | "payment" | "done";
  const [step, setStep] = useState<Step>("search");

  // Student search — backend-driven; two separate fields (invoice number vs name/DSID)
  const [searchInvoice, setSearchInvoice] = useState("");
  const [searchQ,       setSearchQ]       = useState("");
  const [searching,     setSearching]     = useState(false);
  const [searchResults, setSearchResults] = useState<StudentItem[] | null>(null);
  const [searchError,   setSearchError]   = useState<string | null>(null);
  const [selStudent,    setSelStudent]    = useState<StudentItem | null>(null);

  // Unpaid invoices for selected student
  const [invoices,       setInvoices]       = useState<UnpaidInvoice[]>([]);
  const [invoicesLoading,setInvoicesLoading] = useState(false);

  // A single offline payment must be linked to a single invoice.
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  // Payment details
  const [method,   setMethod]   = useState("Cash");
  const [ref,      setRef]      = useState("");
  const [date,     setDate]     = useState(() => new Date().toISOString().split("T")[0]);
  const [notes,    setNotes]    = useState("");
  // Cash denomination state — keys are denomination face values, values are counts
  const [denomQty,   setDenomQty]   = useState<Record<number, number>>(() => Object.fromEntries(DENOMS.map(d => [d, 0])));
  // Method-specific extra fields (Cheque / BankTransfer / DemandDraft / UpiQr)
  const [instrDate,  setInstrDate]  = useState("");   // instrument date (cheque / DD / transfer / UPI payment date)
  const [bankName,   setBankName]   = useState("");
  const [branchName, setBranchName] = useState("");
  const [payerName,  setPayerName]  = useState("");
  const [payerUpiId, setPayerUpiId] = useState("");   // UPI / QR: payer's UPI ID / VPA

  // Submit state
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [donePayments, setDonePayments] = useState<Array<{ id: number; receipt: string; feeType: string; amount: number }>>([]);

  // Idempotency key — one per modal open and one selected invoice
  const [baseKey, setBaseKey] = useState("");

  // Reset on every open
  useEffect(() => {
    if (!open) return;
    setStep("search");
    setSearchInvoice(""); setSearchQ(""); setSearching(false); setSearchResults(null); setSearchError(null); setSelStudent(null);
    setInvoices([]); setInvoicesLoading(false);
    setSelectedInvoiceId(null);
    setMethod("Cash"); setRef(""); setDate(new Date().toISOString().split("T")[0]); setNotes("");
    setDenomQty(Object.fromEntries(DENOMS.map(d => [d, 0])));
    setInstrDate(""); setBankName(""); setBranchName(""); setPayerName(""); setPayerUpiId("");
    setSubmitting(false); setSubmitError(null); setDonePayments([]);
    setBaseKey(`idem-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [open]);

  // Search students — invoice number uses dedicated param; name/DSID uses ?q=
  async function doSearch() {
    const inv = searchInvoice.trim();
    const q   = searchQ.trim();
    if (!inv && !q)   { setSearchError("Enter an invoice number or student name / DSID to search"); return; }
    if (inv && q)     { setSearchError("Use only one field at a time"); return; }
    if ((inv || q).length < 2) { setSearchError("Enter at least 2 characters to search"); return; }

    setSearching(true); setSearchError(null); setSearchResults(null);
    try {
      const param = inv
        ? `invoiceNumber=${encodeURIComponent(inv)}`
        : `q=${encodeURIComponent(q)}`;
      const r    = await sessionFetch(`/api/admin/fees/students/search?${param}`);
      const body = await r.json();
      if (!r.ok) { setSearchError(body.message ?? "Search failed"); return; }
      setSearchResults(body as StudentItem[]);
    } catch (e: any) { setSearchError(e?.message ?? "Network error — please try again"); }
    finally  { setSearching(false); }
  }

  // Fetch unpaid invoices for a student
  async function fetchInvoices(studentId: number) {
    setInvoicesLoading(true);
    try {
      const r = await sessionFetch(`/api/admin/fees/students/${studentId}/unpaid-invoices`);
      if (!r.ok) { toast({ title: "Error", description: "Failed to load invoices", variant: "destructive" }); return; }
      const data: UnpaidInvoice[] = await r.json();
      setInvoices(data);
      // An admin must deliberately choose the one invoice being settled.
      setSelectedInvoiceId(null);
      setStep("select");
    } catch { toast({ title: "Error", description: "Network error", variant: "destructive" }); }
    finally   { setInvoicesLoading(false); }
  }

  const selectedInvoice = invoices.find(i => i.id === selectedInvoiceId) ?? null;
  const totalAmount = selectedInvoice?.totalDue ?? 0;

  // Cash denomination totals — used in the payment step verification panel
  const cashTotal = DENOMS.reduce((s, d) => s + d * (denomQty[d] ?? 0), 0);
  const cashDiff  = cashTotal - totalAmount;
  const cashMatch = cashTotal > 0 && cashDiff === 0;
  // Submit guard per spec req 20:
  //  Cash         — denomination total matches invoice + received date
  //  Cheque       — cheque number + cheque date + received date
  //  BankTransfer — UTR + transfer date + received date
  //  DemandDraft  — DD number + DD date + received date
  const canSubmit = selectedInvoice != null && (method === "Cash"
    ? cashMatch && date.length > 0
    : ref.trim().length > 0 && instrDate.length > 0 && date.length > 0);

  async function doSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    if (!selectedInvoice) {
      setSubmitError("Select one unpaid invoice before recording the payment.");
      setSubmitting(false);
      return;
    }
    const inv = selectedInvoice;
    const payload: Record<string, any> = {
      feeRecordId:    inv.id,
      studentId:      inv.studentId,
      paymentMethod:  method,
      receivedDate:   date,
      amount:         inv.totalDue,
      lateFeePaid:    inv.accruedLateFee,
      cashierNotes:   notes || null,
      idempotencyKey: baseKey,
    };

    if (method === "Cash") {
      payload.denominationBreakdown = denomQty;
      payload.denominationTotal     = totalAmount;
    } else if (method === "UpiQr") {
      payload.referenceNumber = ref        || null;  // UTR
      payload.chequeDate      = instrDate  || null;  // Payment Date
      payload.bankName        = bankName   || null;  // Bank / UPI App
      payload.payerName       = payerName  || null;
      payload.payerUpiId      = payerUpiId || null;
    } else {
      payload.referenceNumber = ref        || null;
      payload.chequeDate      = instrDate  || null;
      payload.bankName        = bankName   || null;
      payload.branchName      = branchName || null;
      payload.payerName       = payerName  || null;
    }

    try {
      const r    = await sessionFetch("/api/admin/fees/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Payment failed");
      setDonePayments([{ id: body.id, receipt: body.receipt_number ?? "—", feeType: inv.feeType, amount: inv.totalDue }]);
    } catch (e: any) {
      setSubmitError(e.message);
      setSubmitting(false);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/failed-counts"] });
    onSuccess?.();
    setSubmitting(false);
    setStep("done");
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cyan-400">
            <Banknote className="w-5 h-5" />
            {step === "done" ? "Payment Recorded" : "Record Offline Payment"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Search student ──────────────────────────────────────────── */}
        {step === "search" && (
          <div className="space-y-4">
            {selStudent ? (
              /* ── Selected student chip ───────────────────────────────── */
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{selStudent.name}</p>
                  <p className="text-white/40 text-xs">{selStudent.digitalStudentId} · Class {selStudent.class}-{selStudent.section}</p>
                </div>
                <button type="button"
                  onClick={() => { setSelStudent(null); setSearchResults(null); setSearchError(null); }}
                  className="text-white/40 hover:text-red-400 shrink-0 text-lg leading-none">✕</button>
              </div>
            ) : (
              /* ── Search form ─────────────────────────────────────────── */
              <div className="space-y-3">
                {/* Invoice Number row */}
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Invoice Number</label>
                  <input
                    value={searchInvoice}
                    onChange={e => { setSearchInvoice(e.target.value); setSearchError(null); }}
                    onKeyDown={e => e.key === "Enter" && doSearch()}
                    placeholder="e.g. INV-0071"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20"
                  />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-white/10" />
                  <span className="text-white/20 text-xs">or</span>
                  <div className="flex-1 border-t border-white/10" />
                </div>

                {/* Student Name / DSID row */}
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Student Name / DSID</label>
                  <input
                    value={searchQ}
                    onChange={e => { setSearchQ(e.target.value); setSearchError(null); }}
                    onKeyDown={e => e.key === "Enter" && doSearch()}
                    placeholder="e.g. Rahul or MIS-0003"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20"
                  />
                </div>

                {/* Error */}
                {searchError && (
                  <p className="text-red-400 text-xs flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />{searchError}
                  </p>
                )}

                {/* Results */}
                {searchResults !== null && !searchError && (
                  searchResults.length === 0
                    ? <p className="text-white/40 text-xs">No students found.</p>
                    : <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
                        {searchResults.map(s => (
                          <button key={s.id} type="button"
                            onClick={() => { setSelStudent(s); setSearchResults(null); }}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors">
                            <p className="text-white text-sm">{s.name}</p>
                            <p className="text-white/40 text-xs">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                          </button>
                        ))}
                      </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose} className="text-white/60">Cancel</Button>
              {!selStudent ? (
                <button type="button" onClick={doSearch} disabled={searching}
                  className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-1">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Search
                </button>
              ) : (
                <Button
                  disabled={invoicesLoading}
                  onClick={() => fetchInvoices(selStudent!.id)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
                  {invoicesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  View Unpaid Invoices →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Select one invoice ───────────────────────────────────────── */}
        {step === "select" && selStudent && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">{selStudent.name}</p>
                <p className="text-white/40 text-xs">{selStudent.digitalStudentId} · Class {selStudent.class}-{selStudent.section}</p>
              </div>
              <button type="button" onClick={() => { setSelStudent(null); setInvoices([]); setStep("search"); }}
                className="text-white/40 hover:text-cyan-400 text-xs">← Change</button>
            </div>

            {invoices.length === 0 ? (
              <div className="p-6 rounded-lg bg-white/5 border border-white/10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-white/60 text-sm">No unpaid invoices for this student.</p>
                <p className="text-white/30 text-xs mt-1">All invoices are paid or there are no invoices yet.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {invoices.map(inv => {
                    const checked = selectedInvoiceId === inv.id;
                    return (
                      <button key={inv.id} type="button" role="radio" aria-checked={checked}
                        onClick={() => setSelectedInvoiceId(inv.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          checked
                            ? "bg-cyan-900/20 border-cyan-600/50"
                            : "bg-white/3 border-white/10 hover:border-white/20"
                        }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                              checked ? "bg-cyan-500 border-cyan-500" : "border-white/30"
                            }`}>
                              {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                            <div>
                              <p className="text-white text-sm font-medium">{inv.feeName || inv.feeType}</p>
                              <p className="text-white/40 text-[11px]">
                                {inv.invoiceNumber ?? "—"}
                                {inv.feePeriodStart && inv.feePeriodEnd && (
                                  <> · {clientFeePeriodLabel(inv.feePeriodStart, inv.feePeriodEnd)}</>
                                )}
                              </p>
                              <p className="text-white/30 text-[11px]">Session: {inv.academicYear ?? "—"}</p>
                              <p className="text-white/30 text-[11px]">Due: {fmtDate(inv.dueDate)}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {inv.accruedLateFee > 0 ? (
                              <>
                                <p className="text-white text-sm font-semibold">{fmt(inv.totalDue)}</p>
                                <p className="text-amber-400/70 text-[10px]">+{fmt(inv.accruedLateFee)} fine</p>
                              </>
                            ) : (
                              <p className="text-white text-sm font-semibold">{fmt(inv.amount)}</p>
                            )}
                            <span className={`text-[10px] font-medium ${inv.status === "Overdue" ? "text-red-400" : "text-amber-400"}`}>
                              {inv.status}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

              </>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setStep("search")} className="text-white/60">← Back</Button>
              {invoices.length > 0 && (
                <Button
                  disabled={selectedInvoiceId === null}
                  onClick={() => setStep("payment")}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white">
                  Payment Details →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Payment details ─────────────────────────────────────────── */}
        {step === "payment" && (
          <div className="space-y-4">
            {/* ── Selected invoice summary ─────────────────────────────────────── */}
            {selectedInvoice && (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1.5">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">Selected Invoice</p>
                <div className="flex justify-between text-sm">
                  <span className="text-white/70">{selectedInvoice.feeName || selectedInvoice.feeType}
                    {selectedInvoice.feePeriodStart && selectedInvoice.feePeriodEnd && (
                      <span className="text-white/30 text-xs ml-1">({clientFeePeriodLabel(selectedInvoice.feePeriodStart, selectedInvoice.feePeriodEnd)})</span>
                    )}
                  </span>
                  <span className="text-white font-medium">{fmt(selectedInvoice.totalDue)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-white/40">{selectedInvoice.invoiceNumber ?? "—"}</span>
                  <span className="text-white/40">Session: {selectedInvoice.academicYear ?? "—"}</span>
                </div>
              </div>
            )}

            {/* ── Method selector (5 buttons, Online/Razorpay excluded) ──────── */}
            <div>
              <label className="text-xs text-white/60 mb-1.5 block">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "Cash",         label: "Cash" },
                  { value: "Cheque",       label: "Cheque" },
                  { value: "BankTransfer", label: "Bank Transfer" },
                  { value: "DemandDraft",  label: "Demand Draft" },
                ].map(({ value, label }) => (
                  <button key={value} type="button"
                    onClick={() => { setMethod(value); setRef(""); setInstrDate(""); setBankName(""); setBranchName(""); setPayerName(""); setPayerUpiId(""); }}
                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                      method === value
                        ? "bg-cyan-900/40 border-cyan-500/60 text-cyan-300"
                        : "bg-[#0A1628] border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"
                    }`}>
                    {label}
                  </button>
                ))}
                {/* UPI / QR Payment — full-width on its own row */}
                <button type="button"
                  onClick={() => { setMethod("UpiQr"); setRef(""); setInstrDate(""); setBankName(""); setBranchName(""); setPayerName(""); setPayerUpiId(""); }}
                  className={`col-span-2 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                    method === "UpiQr"
                      ? "bg-cyan-900/40 border-cyan-500/60 text-cyan-300"
                      : "bg-[#0A1628] border-white/15 text-white/60 hover:border-white/30 hover:text-white/80"
                  }`}>
                  UPI / QR Payment
                </button>
              </div>
            </div>

            {/* ── Received date (always shown) ─────────────────────────────────── */}
            <div>
              <label className="text-xs text-white/60 mb-1 block">Received Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
            </div>

            {/* ── Cash: denomination grid + verification panel ──────────────────── */}
            {method === "Cash" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Denomination Count</p>
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-white/5 border-b border-white/10">
                        <th className="text-left px-3 py-1.5 text-white/40 font-medium text-[11px]">Note / Coin</th>
                        <th className="text-center px-3 py-1.5 text-white/40 font-medium text-[11px]">Qty</th>
                        <th className="text-right px-3 py-1.5 text-white/40 font-medium text-[11px]">Sub-total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {DENOMS.map(d => (
                        <tr key={d}>
                          <td className="px-3 py-1 text-white/70 text-sm">₹{d}</td>
                          <td className="px-3 py-1 text-center">
                            <input
                              type="number" min="0" step="1"
                              value={denomQty[d] || ""}
                              onChange={e => {
                                const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                setDenomQty(prev => ({ ...prev, [d]: v }));
                              }}
                              className="w-16 text-center bg-[#0A1628] border border-white/15 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-cyan-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-1 text-right text-white/60 font-mono text-xs tabular-nums">
                            {d * (denomQty[d] ?? 0) > 0 ? fmt(d * (denomQty[d] ?? 0)) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Cash verification panel */}
                <div className={`p-3 rounded-lg border text-xs space-y-1 ${
                  cashMatch ? "bg-emerald-900/20 border-emerald-700/40"
                            : cashTotal > 0 ? "bg-red-900/15 border-red-700/30"
                            : "bg-white/3 border-white/10"
                }`}>
                  <div className="flex justify-between">
                    <span className="text-white/50">Invoice Due</span>
                    <span className="text-white font-medium">{fmt(totalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Cash Counted</span>
                    <span className="text-white font-medium">{cashTotal > 0 ? fmt(cashTotal) : "—"}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                    <span className="text-white/50">Difference</span>
                    <span className={`font-semibold ${cashDiff === 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {cashDiff === 0 ? "₹0 ✓" : cashDiff > 0 ? `+${fmt(cashDiff)} excess` : `${fmt(Math.abs(cashDiff))} short`}
                    </span>
                  </div>
                  {cashTotal > 0 && !cashMatch && (
                    <p className="text-red-400 flex items-center gap-1 pt-1 border-t border-white/10 mt-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Cash must exactly match the invoice due amount
                    </p>
                  )}
                  {cashMatch && (
                    <p className="text-emerald-400 flex items-center gap-1 pt-1 border-t border-white/10 mt-1">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      Cash matches — ready to record
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── UPI / QR Payment fields ──────────────────────────────────────── */}
            {method === "UpiQr" && (
              <div className="space-y-3">
                {/* UPI Transaction ID / UTR — required */}
                <div>
                  <label className="text-xs text-white/60 mb-1 block">
                    UPI Transaction ID / UTR <span className="text-red-400">*</span>
                  </label>
                  <input value={ref} onChange={e => setRef(e.target.value)}
                    placeholder="e.g. 123456789012"
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 font-mono" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Payment Date — required */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      Payment Date <span className="text-red-400">*</span>
                    </label>
                    <input type="date" value={instrDate} onChange={e => setInstrDate(e.target.value)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                  </div>
                  {/* Bank / UPI App — supporting detail */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Bank / UPI App</label>
                    <input value={bankName} onChange={e => setBankName(e.target.value)}
                      placeholder="e.g. GPay, PhonePe, HDFC"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Payer Name — supporting detail */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Payer Name</label>
                    <input value={payerName} onChange={e => setPayerName(e.target.value)}
                      placeholder="Account holder name"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                  {/* Payer UPI ID — supporting detail */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Payer UPI ID</label>
                    <input value={payerUpiId} onChange={e => setPayerUpiId(e.target.value)}
                      placeholder="e.g. name@upi"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 font-mono" />
                  </div>
                </div>
              </div>
            )}

            {/* ── Cheque / Bank Transfer / Demand Draft fields ──────────────────── */}
            {method !== "Cash" && method !== "UpiQr" && (
              <div className="space-y-3">
                {/* Reference number — required */}
                <div>
                  <label className="text-xs text-white/60 mb-1 block">
                    {method === "Cheque" ? "Cheque Number" : method === "BankTransfer" ? "UTR / Transaction Reference" : "DD Number"}
                    <span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <input value={ref} onChange={e => setRef(e.target.value)}
                    placeholder={
                      method === "Cheque" ? "e.g. 123456"
                      : method === "BankTransfer" ? "e.g. HDFC12345678901"
                      : "e.g. DD/2024/00123"
                    }
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      {method === "Cheque" ? "Cheque Date" : method === "BankTransfer" ? "Transfer Date" : "DD Date"}
                      <span className="text-red-400 ml-0.5">*</span>
                    </label>
                    <input type="date" value={instrDate} onChange={e => setInstrDate(e.target.value)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      {method === "BankTransfer" ? "Sender's Bank" : "Bank Name"}
                    </label>
                    <input value={bankName} onChange={e => setBankName(e.target.value)}
                      placeholder="e.g. SBI, HDFC"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">Branch</label>
                    <input value={branchName} onChange={e => setBranchName(e.target.value)}
                      placeholder="Branch name"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">
                      {method === "BankTransfer" ? "Sender Name" : "Payer Name"}
                    </label>
                    <input value={payerName} onChange={e => setPayerName(e.target.value)}
                      placeholder="Account holder"
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                  </div>
                </div>
              </div>
            )}

            {/* ── Notes ───────────────────────────────────────────────────────── */}
            <div>
              <label className="text-xs text-white/60 mb-1 block">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes, Collected by"
                className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
            </div>

            {/* ── Payment verification card (spec §5/6/7) ─────────────────────── */}
            <div className={`rounded-lg border transition-colors ${
              canSubmit ? "border-emerald-700/40 bg-emerald-900/10" : "border-white/10 bg-white/3"
            }`}>
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-white/30 uppercase tracking-widest">
                Payment Verification
              </p>
              <div className="px-3 pb-3 space-y-1.5 text-xs">
                {/* Student */}
                <div className="flex justify-between">
                  <span className="text-white/50">Student</span>
                  <span className="text-white font-medium">{selStudent?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">DSID</span>
                  <span className="text-white/80 font-mono">{selStudent?.digitalStudentId}</span>
                </div>

                {selectedInvoice && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-white/50">Invoice</span>
                      <span className="text-white font-mono">{selectedInvoice.invoiceNumber ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Fee</span>
                      <span className="text-white">{selectedInvoice.feeName || selectedInvoice.feeType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Outstanding</span>
                      <span className="text-white font-semibold">{fmt(selectedInvoice.totalDue)}</span>
                    </div>
                  </>
                )}

                {/* Method + dates */}
                <div className="flex justify-between">
                  <span className="text-white/50">Payment Method</span>
                  <span className="text-white">
                    {method === "BankTransfer" ? "Bank Transfer"
                     : method === "DemandDraft" ? "Demand Draft"
                     : method === "UpiQr" ? "UPI / QR Payment"
                     : method}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Received Date</span>
                  <span className="text-white">{date ? `${fmtDate(date)}, ${nowIST()}` : "—"}</span>
                </div>

                {/* UPI-specific: show UTR in verification */}
                {method === "UpiQr" && (
                  <div className="flex justify-between">
                    <span className="text-white/50">UPI Transaction ID</span>
                    <span className="text-white font-mono">{ref.trim() || "—"}</span>
                  </div>
                )}

                {/* Cash-specific mini-summary inside verification */}
                {method === "Cash" && cashTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Cash Counted</span>
                    <span className={cashMatch ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                      {fmt(cashTotal)}
                    </span>
                  </div>
                )}

                {/* Verification status */}
                <div className={`flex items-center gap-1.5 pt-1.5 border-t border-white/10 mt-0.5 font-medium ${
                  canSubmit ? "text-emerald-400" : "text-white/25"
                }`}>
                  {canSubmit
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    : <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-white/20 inline-block" />
                  }
                  Amount verified
                </div>
              </div>
            </div>

            {/* ── Error ────────────────────────────────────────────────────────── */}
            {submitError && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-600/50 text-xs text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setStep("select")} className="text-white/60">← Back</Button>
              <Button
                disabled={submitting || !canSubmit}
                onClick={() => doSubmit()}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white gap-1">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                Record Payment
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Done ────────────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-emerald-400 font-semibold text-lg">
                Payment Recorded
              </p>
            </div>

            {/* Receipt for the recorded invoice */}
            {donePayments.length > 0 && (
              <div className="rounded-lg border border-white/10 overflow-hidden divide-y divide-white/5">
                {donePayments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <p className="text-white text-sm">{p.feeType}</p>
                      <p className="font-mono text-xs text-cyan-300">{p.receipt}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white/60 text-sm">{fmt(p.amount)}</span>
                      {p.id && (
                        <button type="button"
                          onClick={() => window.open(`/api/admin/fees/payments/${p.id}/receipt`, "_blank")}
                          className="text-white/40 hover:text-cyan-400 transition-colors" title="Print receipt">
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Payment History Modal ────────────────────────────────────────────────────

interface PaymentHistoryModalProps {
  open: boolean;
  onClose: () => void;
  feeRecord: FeeRecordWithStudent | null;
}

function PaymentHistoryModal({ open, onClose, feeRecord }: PaymentHistoryModalProps) {
  const { toast } = useToast();
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterMethod, setFilterMethod] = useState("All");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Fetch payments directly inside the modal with polling so the list stays
  // live while the modal is open — no manual refresh needed.
  const { data: payments = [], isFetching } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/admin/fees/payments", feeRecord?.id],
    queryFn: async () => {
      if (!feeRecord) return [];
      const r = await sessionFetch(`/api/admin/fees/payments?feeRecordId=${feeRecord.id}`);
      if (!r.ok) return [];
      const data = await r.json();
      setLastRefreshed(new Date());
      return data;
    },
    enabled: open && !!feeRecord,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });

  // Reset filters whenever the modal is opened/closed
  useEffect(() => {
    if (!open) {
      setFilterFrom("");
      setFilterTo("");
      setFilterMethod("All");
      setLastRefreshed(null);
    }
  }, [open]);

  const methodLabel: Record<string, string> = {
    Cash: "Cash", Cheque: "Cheque", BankTransfer: "Bank Transfer",
    DemandDraft: "Demand Draft", UpiQr: "UPI / QR", Online: "Portal Payment",
  };

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const outstanding = Math.max(0, (feeRecord?.amount ?? 0) - totalPaid);

  // Apply filters
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      if (filterMethod !== "All" && p.paymentMethod !== filterMethod) return false;
      const date = p.receivedDate.split("T")[0];
      if (filterFrom && date < filterFrom) return false;
      if (filterTo && date > filterTo) return false;
      return true;
    });
  }, [payments, filterFrom, filterTo, filterMethod]);

  const filteredTotal = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const isFiltered = filterMethod !== "All" || filterFrom !== "" || filterTo !== "";

  if (!feeRecord) return null;

  function clearFilters() {
    setFilterFrom("");
    setFilterTo("");
    setFilterMethod("All");
  }

  function exportToCSV() {
    if (filteredPayments.length === 0) {
      toast({ title: "Nothing to export", description: "No transactions match the current filters.", variant: "destructive" });
      return;
    }
    const studentName = feeRecord!.student?.name ?? "student";
    const headers = ["#", "Invoice No.", "Date", "Amount (INR)", "Method", "Reference No.", "Notes", "Receipt No."];
    const dataRows = filteredPayments.map((p, idx) => [
      idx + 1,
      p.invoiceNumber ?? "—",
      fmtDate(p.receivedDate),
      p.amount,
      methodLabel[p.paymentMethod] ?? p.paymentMethod,
      p.referenceNumber ?? "",
      p.cashierNotes ?? "",
      p.receiptNumber ?? "—",
    ]);
    // Summary footer rows
    dataRows.push(["", "", "", "", "", "", "", ""]);
    dataRows.push(["", "", "Filtered Total", filteredTotal, "", "", "", ""]);
    if (isFiltered) {
      dataRows.push(["", "", "Overall Total", feeRecord!.amount, "", "", "", ""]);
    }

    const csvContent = [headers, ...dataRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = studentName.replace(/[^a-zA-Z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    a.download = `payment-history-${safeName}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportToPDF() {
    if (filteredPayments.length === 0) {
      toast({ title: "Nothing to export", description: "No transactions match the current filters.", variant: "destructive" });
      return;
    }
    const studentName = feeRecord!.student?.name ?? "—";
    const studentInfo = feeRecord!.student ? `${feeRecord!.student.class}-${feeRecord!.student.section}` : "";
    const feeTypeLabel = feeRecord!.feeType;
    const esc = (s: string | null | undefined) =>
      (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const filterDesc = [
      filterFrom ? `From: ${fmtDate(filterFrom)}` : "",
      filterTo ? `To: ${fmtDate(filterTo)}` : "",
      filterMethod !== "All" ? `Method: ${methodLabel[filterMethod] ?? filterMethod}` : "",
    ].filter(Boolean).join(" · ");

    const rows = filteredPayments.map((p, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="inv">${esc(p.invoiceNumber ?? "—")}</td>
        <td>${esc(fmtDate(p.receivedDate))}</td>
        <td class="amount">₹${p.amount.toLocaleString("en-IN")}</td>
        <td>${esc(methodLabel[p.paymentMethod] ?? p.paymentMethod)}</td>
        <td>${esc(p.referenceNumber ?? "—")}</td>
        <td>${esc(p.cashierNotes ?? "—")}</td>
        <td class="mono">${esc(p.receiptNumber ?? "—")}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Payment History – ${esc(studentName)}</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;font-size:13px;}
  h1{font-size:18px;margin:0 0 4px;color:#0891b2;}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px;}
  .filter-badge{display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;padding:2px 8px;font-size:11px;color:#0369a1;margin-bottom:12px;}
  table{width:100%;border-collapse:collapse;margin-top:4px;}
  th{background:#0891b2;color:#fff;text-align:left;padding:8px 6px;font-size:12px;}
  td{padding:7px 6px;border-bottom:1px solid #f1f5f9;}
  tr:nth-child(even) td{background:#f8fafc;}
  .amount{font-weight:700;}
  .mono{font-family:monospace;font-size:11px;color:#94a3b8;}
  .inv{font-family:monospace;font-size:11px;color:#7c3aed;}
  .total-row td{border-top:2px solid #0891b2;font-weight:700;background:#f0f9ff;}
  .footer{margin-top:20px;font-size:11px;color:#94a3b8;text-align:center;}
  @media print{body{padding:0;}}
</style></head><body>
<h1>Payment History</h1>
<div class="meta">
  <strong>${esc(studentName)}</strong> · ${esc(studentInfo)} · ${esc(feeTypeLabel)}<br>
  Invoice: ₹${feeRecord!.amount.toLocaleString("en-IN")} · Status: ${esc(feeRecord!.status)}
</div>
${filterDesc ? `<div class="filter-badge">Filtered: ${esc(filterDesc)}</div>` : ""}
<table>
  <thead><tr>
    <th>#</th><th>Invoice No.</th><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th><th>Receipt No.</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row">
    <td colspan="3">${isFiltered ? `Filtered Total (${filteredPayments.length} of ${payments.length})` : "Total"}</td>
    <td class="amount">₹${filteredTotal.toLocaleString("en-IN")}</td>
    <td colspan="4"></td>
  </tr></tfoot>
</table>
<div class="footer">Generated ${new Date().toLocaleString("en-IN")} · BENIUS</div>
<script>window.print();</script>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-cyan-400">
            <History className="w-5 h-5" />
            Payment History
            {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500/60 ml-1" />}
          </DialogTitle>
          {lastRefreshed && !isFetching && (
            <p className="text-white/30 text-[10px] mt-0.5">
              Updated {lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · auto-refreshes every 30 s
            </p>
          )}
        </DialogHeader>

        {/* Fee record summary */}
        <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm shrink-0">
          <p className="text-white font-semibold">{feeRecord.student?.name ?? "—"}</p>
          <p className="text-white/50 text-xs">{feeRecord.feeType} · {feeRecord.student?.class}-{feeRecord.student?.section}</p>
          <div className="mt-2 flex items-center gap-4 flex-wrap">
            <span className="text-white/40 text-xs">Invoice: <span className="text-white font-medium">{fmt(feeRecord.amount)}</span></span>
            <span className="text-white/40 text-xs">Paid: <span className="text-emerald-400 font-medium">{fmt(totalPaid)}</span></span>
            {outstanding > 0 && (
              <span className="text-white/40 text-xs">Outstanding: <span className="text-amber-400 font-medium">{fmt(outstanding)}</span></span>
            )}
            <StatusChip status={feeRecord.status} />
          </div>
        </div>

        {/* Filters */}
        <div className="shrink-0 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
              <label className="text-white/40 text-xs shrink-0">From</label>
              <input
                type="date"
                value={filterFrom}
                onChange={e => setFilterFrom(e.target.value)}
                className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
              <label className="text-white/40 text-xs shrink-0">To</label>
              <input
                type="date"
                value={filterTo}
                onChange={e => setFilterTo(e.target.value)}
                className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]"
              />
            </div>
            <select
              value={filterMethod}
              onChange={e => setFilterMethod(e.target.value)}
              className="bg-[#0A1628] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="All">All Methods</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="BankTransfer">Bank Transfer</option>
              <option value="DemandDraft">Demand Draft</option>
              <option value="UpiQr">UPI / QR Payment</option>
              <option value="Online">Online</option>
            </select>
            {isFiltered && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-white/40 hover:text-red-400 text-xs flex items-center gap-1 transition-colors"
              >
                <X className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
          {isFiltered && (
            <div className="flex items-center gap-3 px-1">
              <span className="text-white/40 text-xs">
                {filteredPayments.length} of {payments.length} transaction{payments.length !== 1 ? "s" : ""}
              </span>
              <span className="text-white/40 text-xs">
                Filtered total: <span className="text-cyan-400 font-medium">{fmt(filteredTotal)}</span>
                {" "}/ <span className="text-emerald-400 font-medium">{fmt(totalPaid)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Payment list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filteredPayments.length === 0 ? (
            <div className="py-10 text-center text-white/30 text-sm">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-20" />
              {payments.length === 0 ? "No payment transactions recorded yet." : "No transactions match the current filters."}
            </div>
          ) : (
            <div className="space-y-2 pr-1">
              {filteredPayments.map((p, idx) => (
                <div key={p.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white/30 text-xs font-mono shrink-0">#{idx + 1}</span>
                      <div className="min-w-0">
                        <p className="text-white font-semibold text-sm">{fmt(p.amount)}</p>
                        <p className="text-white/50 text-xs mt-0.5">{p.createdAt ? fmtDateTimeIST(p.createdAt) : fmtDate(p.receivedDate)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-cyan-900/40 border border-cyan-700/40 text-cyan-300">
                        {methodLabel[p.paymentMethod] ?? p.paymentMethod}
                      </span>
                      <Button size="icon" variant="ghost"
                        onClick={() => window.open(`/api/admin/fees/payments/${p.id}/receipt`, "_blank")}
                        className="h-6 w-6 text-white/30 hover:text-cyan-400"
                        title="Print receipt">
                        <Printer className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {/* Invoice No. + Receipt No. — always shown, visually separated */}
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white/30 text-[10px] w-14 shrink-0">Invoice</span>
                      <span className="font-mono text-[10px] tracking-wide text-violet-300">
                        {p.invoiceNumber ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white/30 text-[10px] w-14 shrink-0">Receipt</span>
                      <span className="font-mono text-[10px] tracking-wide text-cyan-300">
                        {p.receiptNumber ?? "—"}
                      </span>
                    </div>
                    {p.referenceNumber && (
                      <p className="text-white/40 text-xs">Ref: <span className="text-white/60 font-mono">{p.referenceNumber}</span></p>
                    )}
                    {p.cashierNotes && (
                      <p className="text-white/40 text-xs">Note: <span className="text-white/60">{p.cashierNotes}</span></p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 pt-2 border-t border-white/10 flex justify-between items-center gap-2 flex-wrap">
          {!isFiltered && (
            <span className="text-white/40 text-xs">{payments.length} transaction{payments.length !== 1 ? "s" : ""}</span>
          )}
          {isFiltered && <span />}
          <div className="flex items-center gap-2 ml-auto">
            {filteredPayments.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exportToCSV}
                  className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20 h-8 gap-1.5 text-xs"
                  title="Download filtered payments as CSV"
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exportToPDF}
                  className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/20 h-8 gap-1.5 text-xs"
                  title="Print / save as PDF"
                >
                  <FileText className="w-3.5 h-3.5" /> PDF
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onClose} className="text-white/60 h-8 text-sm">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const NOTIF_CHANNEL_ICONS: Record<string, React.ReactNode> = {
  sms:      <MessageSquare className="w-3.5 h-3.5" />,
  whatsapp: <Phone className="w-3.5 h-3.5" />,
  email:    <Mail className="w-3.5 h-3.5" />,
};
const SUPPORTED_FREQUENCIES = ["monthly", "quarterly", "annual", "one-time"] as const;
type SupportedFrequency = typeof SUPPORTED_FREQUENCIES[number];

const feeFormSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  feeName: z.string().optional(),
  feeType: z.string().min(1, "Fee type is required"),
  amount: z.string().min(1, "Amount is required").refine(v => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number"),
  frequency: z.string().optional(),
  feePeriod: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["Due", "Paid", "Overdue"]),
  paidDate: z.string().optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
  academicYear: z.string().optional(),
}).superRefine((val, ctx) => {
  const noDeadlineNeeded = val.status === "Paid";
  if (!noDeadlineNeeded && !val.dueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Due date is required", path: ["dueDate"] });
  }
});
type FeeFormValues = z.infer<typeof feeFormSchema>;

/** Client-side mirror of server/fee-period.ts feePeriodLabel — used for period preview in the form. */
function clientFeePeriodLabel(start: string, end: string): string {
  if (!start || !end) return "";
  const s = new Date(start + "T00:00:00");
  const e = new Date(end   + "T00:00:00");
  const days = Math.round((e.getTime() - s.getTime()) / 86400000);
  if (days <= 31)
    return s.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  if (days <= 92) {
    const startLabel = s.toLocaleDateString("en-IN", { month: "long" });
    const endLabel   = e.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return `${startLabel}–${endLabel}`;
  }
  return `${s.getFullYear()}–${String(s.getFullYear() + 1).slice(2)}`;
}

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

// ─── Export Ledger Dialog ─────────────────────────────────────────────────────

interface ExportLedgerDialogProps {
  availableFeeNames: string[];
  open: boolean;
  onClose: () => void;
  availableClasses: string[];
  availableFeeTypes: string[];
}

function ExportLedgerDialog({ open, onClose, availableClasses, availableFeeTypes, availableFeeNames }: ExportLedgerDialogProps) {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cls, setCls] = useState("");
  const [feeType, setFeeType] = useState("");
  const [feeName, setFeeName] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!open) {
      setDateFrom(""); setDateTo(""); setCls(""); setFeeType(""); setFeeName(""); setIsDownloading(false);
    }
  }, [open]);

  async function handleExport() {
    setIsDownloading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo)   params.set("dateTo",   dateTo);
      if (cls)      params.set("class",    cls);
      if (feeType)  params.set("feeType",  feeType);
      if (feeName)  params.set("feeName",  feeName);

      const url = `/api/admin/fees/export-ledger${params.size ? "?" + params.toString() : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).message ?? "Export failed");
      }
      const blob = await r.blob();
      const dateTag = new Date().toISOString().split("T")[0];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `payment-ledger-${dateTag}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast({ title: "Ledger exported", description: "CSV downloaded successfully." });
      onClose();
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-400">
            <Download className="w-5 h-5" />
            Export School-wide Ledger
          </DialogTitle>
        </DialogHeader>

        <p className="text-white/50 text-sm">
          Downloads a CSV with every fee record and its aggregated payment totals. Use filters to narrow the slice.
        </p>

        <div className="space-y-4">
          {/* Date range */}
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Due Date Range</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]" />
              </div>
            </div>
          </div>

          {/* Class filter */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">Class</label>
            <select value={cls} onChange={e => setCls(e.target.value)}
              className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">All Classes</option>
              {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Fee Name filter */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">Fee Name</label>
            <select value={feeName} onChange={e => setFeeName(e.target.value)}
              className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">All Fee Names</option>
              {availableFeeNames.map(fn => <option key={fn} value={fn}>{fn}</option>)}
            </select>
          </div>

          {/* Fee Type filter */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">Fee Type</label>
            <select value={feeType} onChange={e => setFeeType(e.target.value)}
              className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">All Fee Types</option>
              {availableFeeTypes.map(ft => <option key={ft} value={ft}>{ft}</option>)}
            </select>
          </div>

          {/* Active filters summary */}
          {(dateFrom || dateTo || cls || feeName || feeType) && (
            <div className="px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/30 text-xs text-emerald-400 space-y-0.5">
              <p className="font-semibold mb-1">Active filters:</p>
              {dateFrom && <p>Due from: {new Date(dateFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>}
              {dateTo   && <p>Due to: {new Date(dateTo).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>}
              {cls      && <p>Class: {cls}</p>}
              {feeName  && <p>Fee Name: {feeName}</p>}
              {feeType  && <p>Fee Type: {feeType}</p>}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" onClick={onClose} className="text-white/60">Cancel</Button>
            <Button onClick={handleExport} disabled={isDownloading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download CSV
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ledger Tab ───────────────────────────────────────────────────────────────

function LedgerTab({ canRecord, isArchiveMode, students, viewSessionId }: {
  canRecord: boolean; isArchiveMode: boolean; students: StudentItem[]; viewSessionId: number | null;
}) {
  const { toast } = useToast();
  const { selectedSession } = useSessionView();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [feeNameFilter, setFeeNameFilter] = useState("all");
  const [feeTypeFilter, setFeeTypeFilter] = useState("all");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [addFeeSuccessId, setAddFeeSuccessId] = useState<number | null>(null);
  const [showExportLedger, setShowExportLedger] = useState(false);
  const [editing, setEditing] = useState<FeeRecordWithStudent | null>(null);
  const [showStandalonePay, setShowStandalonePay] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [viewPaymentsRecord, setViewPaymentsRecord] = useState<FeeRecordWithStudent | null>(null);
  // ── Bulk selection ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifStudentId, setNotifStudentId] = useState<number | null>(null);
  const [notifStudentName, setNotifStudentName] = useState<string | null>(null);
  // ── Expandable accordion state ─────────────────────────────────────────────
  const [expandedLedgerRow, setExpandedLedgerRow] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Map<number, TransactionDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [detailSection, setDetailSection] = useState<Record<number, number>>({});
  const [adminNotes, setAdminNotes] = useState<Record<number, string>>({});
  const [savingNotes, setSavingNotes] = useState<Set<number>>(new Set());
  const [studentSearchQ, setStudentSearchQ] = useState("");
  const [studentResults, setStudentResults] = useState<StudentItem[] | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [studentSearchLoading, setStudentSearchLoading] = useState(false);
  const [invoiceBreakdown, setInvoiceBreakdown] = useState<InvoiceBreakdownRow[]>([]);
  const [invoiceLateFeeEnabled, setInvoiceLateFeeEnabled] = useState(false);
  const [invoiceLateFeeType, setInvoiceLateFeeType] = useState<"NONE" | "FLAT" | "DAILY" | "TIERED">("FLAT");
  const [invoiceLateFeeGraceDays, setInvoiceLateFeeGraceDays] = useState("0");
  const [invoiceLateFeeFlat, setInvoiceLateFeeFlat] = useState("");
  const [invoiceLateFeeDailyRate, setInvoiceLateFeeDailyRate] = useState("");
  const [invoiceLateFeeCap, setInvoiceLateFeeCap] = useState("0");
  const [invoiceLateFeeSlabs, setInvoiceLateFeeSlabs] = useState<Array<{ from_day: string; to_day: string; amount: string }>>([]);

  // The manual invoice endpoint always uses the server's active session. Fetch
  // that same session here rather than deriving periods from the archive view.
  const { data: invoiceSessions = [] } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/fees/sessions"],
    queryFn: async () => {
      const response = await sessionFetch("/api/admin/fees/sessions");
      if (!response.ok) throw new Error("Failed to load academic sessions");
      return response.json();
    },
    staleTime: 60_000,
  });
  const activeInvoiceSession = useMemo(
    () => invoiceSessions.find(session => session.isActive) ?? null,
    [invoiceSessions],
  );
  const {
    data: addFeeSuccessDetail,
    isLoading: isAddFeeSuccessLoading,
    isError: isAddFeeSuccessDetailError,
  } = useQuery<TransactionDetail>({
    queryKey: ["/api/admin/fees", addFeeSuccessId, "transaction-detail"],
    queryFn: async () => {
      const response = await sessionFetch(`/api/admin/fees/${addFeeSuccessId}/transaction-detail`);
      if (!response.ok) throw new Error("Failed to load the created invoice");
      return response.json();
    },
    enabled: addFeeSuccessId !== null,
    retry: false,
  });

  const { data: ledgerData, isLoading, isFetching } = useQuery<LedgerPageResponse>({
    queryKey: ["/api/admin/fees", viewSessionId, ledgerPage, search, statusFilter, classFilter, feeNameFilter, feeTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(ledgerPage),
        pageSize: "20",
      });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (classFilter !== "all") params.set("class", classFilter);
      if (feeNameFilter !== "all") params.set("feeName", feeNameFilter);
      if (feeTypeFilter !== "all") params.set("feeType", feeTypeFilter);
      const r = await sessionFetch(`/api/admin/fees?${params.toString()}`);
      if (!r.ok) throw new Error("Failed to fetch fee records");
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const feeRecords = ledgerData?.records ?? [];
  const ledgerTotal = ledgerData?.total ?? 0;
  const ledgerTotalPages = ledgerData?.totalPages ?? 0;

  useEffect(() => {
    setLedgerPage(1);
    setSelectedIds(new Set());
    setExpandedLedgerRow(null);
  }, [search, statusFilter, classFilter, feeNameFilter, feeTypeFilter, viewSessionId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedLedgerRow(null);
  }, [ledgerPage]);

  // Fee structures remain the source for historical display-name fallbacks.
  const { data: feeStructures = [] } = useQuery<FeeStructure[]>({
    queryKey: ["/api/admin/fees/structures"],
    staleTime: 300_000,
  });
  const activeStructures = useMemo(() => feeStructures, [feeStructures]);
  // Map feeType (normalized: trim+lowercase) → structure name.
  // Used as a client-side fallback when the server-side feeName field is absent
  // (e.g. stale React Query cache from before the field was added).
  const feeTypeToName = useMemo(() => {
    const m = new Map<string, string>();
    activeStructures.forEach(s => {
      const key = s.feeType.trim().toLowerCase();
      if (!m.has(key)) m.set(key, s.name);
    });
    return m;
  }, [activeStructures]);

  // Resolve display name for a fee record: prefer server-supplied feeName,
  // fall back to client-side map, then raw feeType. || catches empty strings too.
  const resolveFeeDisplayName = useCallback(
    (rec: { feeType: string; feeName?: string }) =>
      rec.feeName || feeTypeToName.get(rec.feeType.trim().toLowerCase()) || rec.feeType || "—",
    [feeTypeToName],
  );

  // ── Accordion callbacks ────────────────────────────────────────────────────
  const fetchDetail = useCallback(async (feeRecordId: number, forceRefresh = false): Promise<TransactionDetail | null> => {
    if (!forceRefresh) {
      const cached = detailCache.get(feeRecordId);
      if (cached) return cached;
    }
    setDetailLoading(feeRecordId);
    try {
      const r = await sessionFetch(`/api/admin/fees/${feeRecordId}/transaction-detail`);
      if (!r.ok) return null;
      const data: TransactionDetail = await r.json();
      setDetailCache(prev => new Map(prev).set(feeRecordId, data));
      if (data.payment?.cashierNotes) {
        setAdminNotes(prev => ({ ...prev, [feeRecordId]: data.payment!.cashierNotes! }));
      }
      return data;
    } catch { /* non-critical */ }
    finally { setDetailLoading(null); }
    return null;
  }, [detailCache]);

  const toggleLedgerRow = useCallback((id: number) => {
    if (expandedLedgerRow === id) {
      setExpandedLedgerRow(null);
    } else {
      setExpandedLedgerRow(id);
      fetchDetail(id);
    }
  }, [expandedLedgerRow, fetchDetail]);

  const printInvoiceFromRecord = useCallback((recordId: number) => {
    const printWindow = window.open(`/api/admin/fees/${recordId}/invoice`, "_blank");
    if (!printWindow) {
      toast({ title: "Invoice could not open", description: "Allow pop-ups for this site to print or download invoices.", variant: "destructive" });
    }
  }, [toast]);

  const saveAdminNotes = useCallback(async (feeRecordId: number, paymentId: number | undefined, notes: string) => {
    if (!paymentId) return;
    setSavingNotes(prev => new Set(prev).add(feeRecordId));
    try {
      await sessionFetch(`/api/admin/fees/payments/${paymentId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashierNotes: notes }),
      });
      // Invalidate cache so a re-open shows fresh data
      setDetailCache(prev => { const m = new Map(prev); m.delete(feeRecordId); return m; });
    } catch { /* non-critical */ }
    finally { setSavingNotes(prev => { const s = new Set(prev); s.delete(feeRecordId); return s; }); }
  }, []);

  // Failed payment counts — per-fee-record badge showing how many payment_failed audit entries exist
  const { data: failedCounts = {} } = useQuery<Record<number, { count: number; lastError: string | null }>>({
    queryKey: ["/api/admin/fees/failed-counts", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/failed-counts");
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30_000,
  });

  // Dunning counts — per-student reminder counts for the bell badge
  const { data: dunningCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ["/api/admin/fees/dunning-counts", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/dunning-counts");
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30_000,
  });

  // Payment records — used for transaction history, receipts, and action badges.
  const { data: paymentRecordsList = [] } = useQuery<PaymentRecord[]>({
    queryKey: ["/api/admin/fees/payments"],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/payments");
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 30_000,
  });
  // Map feeRecordId → all payment records (sorted newest-first) for the history modal
  const paymentsByFeeRecordId = useMemo(() => {
    const map = new Map<number, PaymentRecord[]>();
    [...paymentRecordsList]
      .sort((a, b) => b.id - a.id)
      .forEach(p => {
        if (p.feeRecordId == null) return;
        const existing = map.get(p.feeRecordId) ?? [];
        existing.push(p);
        map.set(p.feeRecordId, existing);
      });
    return map;
  }, [paymentRecordsList]);

  const form = useForm<FeeFormValues>({
    resolver: zodResolver(feeFormSchema),
    defaultValues: { studentId: "", feeName: "", feeType: "", amount: "", frequency: "", feePeriod: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: "" },
  });
  const watchStatus = form.watch("status");
  const dueDateNotNeeded = watchStatus === "Paid";
  const watchFeePeriod   = form.watch("feePeriod") ?? "";
  const watchFrequency   = form.watch("frequency") ?? "";
  const invoiceBreakdownTotal = invoiceBreakdown.reduce((sum, row) => sum + (parseInt(row.amount) || 0), 0);
  const invoiceBreakdownMismatch = invoiceBreakdown.length > 0
    && invoiceBreakdownTotal !== (parseInt(form.watch("amount")) || 0);
  const invoicePeriodOptions = useMemo(
    () => addInvoicePeriodOptionsForSession(watchFrequency, activeInvoiceSession),
    [watchFrequency, activeInvoiceSession],
  );
  const selectedInvoicePeriod = invoicePeriodOptions.find(option => option.value === watchFeePeriod);

  // Auto-clear due date when status makes it irrelevant
  useEffect(() => {
    if (dueDateNotNeeded) form.setValue("dueDate", "");
  }, [dueDateNotNeeded]);

  // Frequency drives one logical period selection; raw dates remain server-owned.
  useEffect(() => {
    if (editing || !selectedStudent || !watchFrequency) return;
    if (!SUPPORTED_FREQUENCIES.includes(watchFrequency as SupportedFrequency)) return;
    const period = preferredInvoicePeriod(invoicePeriodOptions);
    if (period) {
      form.setValue("feePeriod", period.value, { shouldValidate: true });
    }
  }, [editing, watchFrequency, selectedStudent, invoicePeriodOptions]);

  // Keep Due Date separate, but reset an empty or now-invalid default to the
  // selected period end so the manual due-date validation remains satisfiable.
  useEffect(() => {
    if (editing || !selectedStudent || !selectedInvoicePeriod) return;
    const dueDate = form.getValues("dueDate");
    if (
      !dueDate
      || dueDate < selectedInvoicePeriod.start
      || dueDate > selectedInvoicePeriod.end
    ) {
      form.setValue("dueDate", selectedInvoicePeriod.end, { shouldValidate: true });
    }
  }, [editing, selectedStudent, selectedInvoicePeriod, form]);

  function resetInvoiceStructureDraft() {
    setInvoiceBreakdown([]);
    setInvoiceLateFeeEnabled(false);
    setInvoiceLateFeeType("FLAT");
    setInvoiceLateFeeGraceDays("0");
    setInvoiceLateFeeFlat("");
    setInvoiceLateFeeDailyRate("");
    setInvoiceLateFeeCap("0");
    setInvoiceLateFeeSlabs([]);
  }

  function addInvoiceBreakdownRow() {
    setInvoiceBreakdown(previous => [...previous, { name: "", purpose: "", amount: "" }]);
  }

  function updateInvoiceBreakdownRow(index: number, field: keyof InvoiceBreakdownRow, value: string) {
    setInvoiceBreakdown(previous => previous.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row,
    ));
  }

  function removeInvoiceBreakdownRow(index: number) {
    setInvoiceBreakdown(previous => previous.filter((_, rowIndex) => rowIndex !== index));
  }

  function addInvoiceLateFeeSlab() {
    setInvoiceLateFeeSlabs(previous => [...previous, { from_day: "", to_day: "", amount: "" }]);
  }

  function updateInvoiceLateFeeSlab(
    index: number,
    field: "from_day" | "to_day" | "amount",
    value: string,
  ) {
    setInvoiceLateFeeSlabs(previous => previous.map((slab, slabIndex) =>
      slabIndex === index ? { ...slab, [field]: value } : slab,
    ));
  }

  function removeInvoiceLateFeeSlab(index: number) {
    setInvoiceLateFeeSlabs(previous => previous.filter((_, slabIndex) => slabIndex !== index));
  }

  const createMut = useMutation({
    mutationFn: async (data: FeeFormValues) => {
      if (!data.feeName?.trim()) throw new Error("Fee name is required");
      if (!data.feeType?.trim()) throw new Error("Fee type is required");
      if (!data.frequency || !SUPPORTED_FREQUENCIES.includes(data.frequency as SupportedFrequency)) throw new Error("Valid frequency is required");
      if (!data.feePeriod) throw new Error("Fee period is required");
      if (!data.dueDate) throw new Error("Due date is required");

      const parsedBreakdown = invoiceBreakdown
        .filter(row => row.name.trim())
        .map(row => ({
          name: row.name.trim(),
          purpose: row.purpose.trim(),
          amount: parseInt(row.amount) || 0,
        }));

      const lateFeeConfig = {
        enabled: invoiceLateFeeEnabled,
        type: invoiceLateFeeEnabled ? invoiceLateFeeType : "NONE",
        grace_period_days: invoiceLateFeeEnabled && invoiceLateFeeType === "DAILY"
          ? (parseInt(invoiceLateFeeGraceDays) || 0) : 0,
        flat_amount: parseInt(invoiceLateFeeFlat) || 0,
        daily_rate: parseFloat(invoiceLateFeeDailyRate) || 0,
        max_cap: invoiceLateFeeEnabled && invoiceLateFeeType === "DAILY"
          ? (parseInt(invoiceLateFeeCap) || 0) : 0,
        tiered_slabs: invoiceLateFeeSlabs
          .filter(slab => slab.from_day && slab.to_day && slab.amount)
          .map(slab => ({
            from_day: parseInt(slab.from_day),
            to_day: parseInt(slab.to_day),
            amount: parseInt(slab.amount),
          })),
      };

      const res = await apiRequest("POST", "/api/admin/fees", {
        studentId: Number(data.studentId),
        feeName: data.feeName.trim(),
        feeType: data.feeType.trim(),
        amount: Number(data.amount),
        frequency: data.frequency,
        feePeriod: data.feePeriod,
        dueDate: data.dueDate,
        lateFeeConfig,
        breakdown: parsedBreakdown,
        notes: data.notes || null,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to create invoice");
      }
      return res.json();
    },
    onSuccess: (rec: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      form.reset();
      setAddFeeSuccessId(rec?.id ?? null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FeeFormValues }) => apiRequest("PATCH", `/api/admin/fees/${id}`, {
      studentId: Number(data.studentId), feeType: data.feeType, amount: Number(data.amount),
      dueDate: data.dueDate, status: data.status, paidDate: data.paidDate || null,
      receiptNumber: data.receiptNumber || null, notes: data.notes || null, academicYear: data.academicYear || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/failed-counts"] });
      toast({ title: "Fee record updated" });
      setEditing(null); setShowForm(false); form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: ledgerSchoolConfig } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      if (!r.ok) return { classes: [] };
      return r.json();
    },
    staleTime: 300_000,
  });
  // Prefer school-setup classes; fall back to distinct classes of enrolled students
  const studentClasses: string[] = (ledgerSchoolConfig?.classes ?? []).length > 0
    ? ledgerSchoolConfig!.classes
    : [...new Set(students.filter(s => s.isActive).map(s => s.class))].sort();
  const classes = studentClasses;

  async function runStudentSearch() {
    const q = studentSearchQ.trim();
    if (q.length < 2) {
      setStudentResults([]);
      return;
    }
    setStudentSearchLoading(true);
    try {
      const response = await sessionFetch(`/api/admin/fees/students/search?q=${encodeURIComponent(q)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Student search failed");
      setStudentResults(body as StudentItem[]);
    } catch (error: any) {
      setStudentResults([]);
      toast({ title: "Student search failed", description: error.message, variant: "destructive" });
    } finally {
      setStudentSearchLoading(false);
    }
  }

  function pickStudent(s: StudentItem) {
    setSelectedStudent(s);
    form.setValue("studentId", String(s.id), { shouldValidate: true });
    setStudentResults(null);
    setStudentSearchQ("");
    setInvoiceBreakdown([]);
    form.setValue("feeName", "");
    form.setValue("feeType", "");
    form.setValue("amount", "");
    form.setValue("frequency", "");
    form.setValue("feePeriod", "");
    form.setValue("dueDate", "");
  }

  function clearStudentPick() {
    setSelectedStudent(null);
    setStudentSearchQ(""); setStudentResults(null);
    setInvoiceBreakdown([]);
    resetInvoiceStructureDraft();
    form.setValue("studentId", "", { shouldValidate: false });
    form.setValue("feeName", "");
    form.setValue("feeType", "");
    form.setValue("amount", "");
    form.setValue("frequency", "");
    form.setValue("feePeriod", "");
    form.setValue("dueDate", "");
  }

  // The server applies all ledger filters; these are only the current page rows.
  const filtered = feeRecords;

  // Distinct fee names/types come from fee structures so pagination does not
  // remove filter options that are not present on the current page.
  const allFeeNames = useMemo(() =>
    [...new Set([...activeStructures.map(s => s.name), ...feeRecords.map(r => resolveFeeDisplayName(r))])].filter(Boolean).sort(),
    [activeStructures, feeRecords, resolveFeeDisplayName]);

  const allFeeTypes = useMemo(() =>
    [...new Set([...activeStructures.map(s => s.feeType), ...feeRecords.map(r => r.feeType)])].sort(),
    [activeStructures, feeRecords]);

  function openCreate() {
    setEditing(null);
    form.reset({ studentId: "", feeName: "", feeType: "", amount: "", frequency: "", feePeriod: "", dueDate: "", status: "Due", paidDate: "", receiptNumber: "", notes: "", academicYear: activeInvoiceSession?.sessionName ?? selectedSession?.sessionName ?? "" });
    setSelectedStudent(null); setStudentSearchQ(""); setStudentResults(null); setInvoiceBreakdown([]);
    resetInvoiceStructureDraft();
    setShowForm(true);
  }

  function openEdit(rec: FeeRecordWithStudent) {
    setEditing(rec);
    form.reset({
      studentId: String(rec.studentId), feeType: rec.feeType, amount: String(rec.amount),
      dueDate: rec.dueDate, status: rec.status as any, paidDate: rec.paidDate ?? "",
      receiptNumber: rec.receiptNumber ?? "", notes: rec.notes ?? "", academicYear: rec.academicYear ?? "",
    });
    setSelectedStudent(students.find(s => s.id === rec.studentId) ?? null);
    setStudentSearchQ(""); setStudentResults(null); setInvoiceBreakdown([]);
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID, fee type or receipt no…"
            className="w-full bg-[#1A2942] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-28">
          <option value="all">All Status</option>
          {["Due","Paid","Overdue"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-28">
          <option value="all">All Classes</option>
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={feeNameFilter} onChange={e => setFeeNameFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-32">
          <option value="all">All Fee Names</option>
          {allFeeNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={feeTypeFilter} onChange={e => setFeeTypeFilter(e.target.value)}
          className="bg-[#1A2942] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 min-w-32">
          <option value="all">All Fee Types</option>
          {allFeeTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-2 ml-auto items-center">
          {canRecord && !isArchiveMode && selectedIds.size === 0 && filtered.length > 0 && (
            <button
              onClick={() => setSelectedIds(new Set(filtered.map(r => r.id)))}
              className="text-xs text-white/40 hover:text-cyan-400 transition-colors underline underline-offset-2">
              Select all
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-white/40 hover:text-white/70 transition-colors underline underline-offset-2">
              Clear
            </button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowExportLedger(true)}
            className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/30 gap-1">
            <Download className="w-4 h-4" /> Export Ledger
          </Button>
          {canRecord && !isArchiveMode && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowStandalonePay(true)}
                className="border-cyan-700 text-cyan-400 hover:bg-cyan-900/30 gap-1">
                <Banknote className="w-4 h-4" /> Record Offline Payment
              </Button>
              <Button size="sm" onClick={openCreate} className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
                <Plus className="w-4 h-4" /> Add Invoice
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading records…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No fee records match your filters.</p>
        </div>
      ) : (
        <div className="relative rounded-xl border border-white/10 overflow-hidden">
          {isFetching && (
            <div className="absolute inset-0 z-10 flex items-start justify-center pt-3 pointer-events-none">
              <span className="rounded-full bg-[#0A1628]/90 border border-cyan-700/40 px-3 py-1 text-[11px] text-cyan-300">
                Loading page…
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {/* Expand chevron */}
                  <th className="px-2 py-3 w-8" />
                  {/* Checkbox column header — only visible when rows are selected */}
                  {selectedIds.size > 0 && canRecord && !isArchiveMode && (
                    <th className="px-3 py-3 w-8" />
                  )}
                  {["Invoice No.","Receipt No.","Student","DSID","Class","Section","Fee Name","Fee Type","Amount","Due Date","Status","Payment Method","Paid On","Acad. Year","Notes","Actions"].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-white/50 font-medium text-xs ${i === 8 || i === 15 ? "text-right" : i >= 9 && i <= 13 ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => {
                  const isExpanded = expandedLedgerRow === rec.id;
                  const detail = detailCache.get(rec.id);
                  const isLoadingDetail = detailLoading === rec.id;
                  const activeSection = detailSection[rec.id] ?? 0;
                  const mainPayment = detail?.payment ?? null;
                  const colSpan = 17 + (selectedIds.size > 0 && canRecord && !isArchiveMode ? 1 : 0);
                  return (
                  <React.Fragment key={rec.id}>
                  <tr className={`border-b border-white/5 transition-colors ${selectedIds.has(rec.id) ? "bg-red-900/10" : isExpanded ? "bg-white/[0.04]" : "hover:bg-white/5"}`}
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (!t.closest("button") && !t.closest("input") && !t.closest("a")) toggleLedgerRow(rec.id);
                    }}
                    style={{ cursor: "pointer" }}>
                    {/* Chevron expand cell */}
                    <td className="px-2 py-3 text-white/30 select-none">
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                        : <ChevronDown className="w-3.5 h-3.5" />}
                    </td>
                    {/* Row checkbox — appears only after "Select All" activates selection mode */}
                    {selectedIds.size > 0 && canRecord && !isArchiveMode && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="accent-cyan-500 w-4 h-4 cursor-pointer"
                          checked={selectedIds.has(rec.id)}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(rec.id); else next.delete(rec.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                    )}
                    {/* Invoice No. — permanent identifier (INV-xxxx), never overwritten by payment */}
                    <td className="px-4 py-3 text-left">
                      {rec.invoiceNumber
                        ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-violet-700/30 text-violet-300">{rec.invoiceNumber}</span>
                        : <span className="text-white/20 text-xs">—</span>}
                    </td>
                    {/* Receipt No. — payment receipt (ON-xxxx / OF-xxxx), set after payment */}
                    <td className="px-4 py-3 text-left">
                      {rec.receiptNumber
                        ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-cyan-700/30 text-cyan-300">{rec.receiptNumber}</span>
                        : <span className="text-white/20 text-xs">—</span>}
                    </td>
                    {/* Student */}
                    <td className="px-4 py-3">
                      <p className="text-white font-medium leading-tight text-sm">{rec.student?.name ?? "—"}</p>
                    </td>
                    {/* DSID */}
                    <td className="px-4 py-3 text-left">
                      <span className="text-xs font-mono text-cyan-400/80">{rec.student?.digitalStudentId ?? "—"}</span>
                    </td>
                    {/* Class */}
                    <td className="px-4 py-3 text-white/70 text-xs text-center">{rec.student?.class ?? "—"}</td>
                    {/* Section */}
                    <td className="px-4 py-3 text-white/70 text-xs text-center">{rec.student?.section ?? "—"}</td>
                    <td className="px-4 py-3 text-white/80 text-sm">{resolveFeeDisplayName(rec)}</td>
                    <td className="px-4 py-3 text-white/70 text-xs">{rec.feeType}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">
                      {(rec as any).lateFeeAmount > 0 ? (
                        <div className="text-right leading-tight space-y-0.5">
                          <p className="text-white/50 text-xs">Base {fmt(rec.amount)}</p>
                          <p className="text-amber-400 text-xs">+{fmt((rec as any).lateFeeAmount)} fine</p>
                          <p className="font-black text-white text-sm">{fmt(rec.amount + (rec as any).lateFeeAmount)}</p>
                        </div>
                      ) : fmt(rec.amount)}
                    </td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.dueDate)}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusChip status={rec.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PaymentMethodBadge method={rec.paymentMethod} />
                    </td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{fmtDate(rec.paidDate)}</td>
                    <td className="px-4 py-3 text-center text-white/50 text-xs">{rec.academicYear ?? "—"}</td>
                    <td className="px-4 py-3 text-left text-white/50 text-xs max-w-[100px] truncate" title={rec.notes ?? ""}>{rec.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {(() => {
                          const count = paymentsByFeeRecordId.get(rec.id)?.length ?? 0;
                          const hasPayments = count > 0;
                          return (
                            <Button size="sm" variant="ghost"
                              onClick={() => { setViewPaymentsRecord(rec); setShowPaymentsModal(true); }}
                              className={`h-7 px-2 text-xs gap-1 ${hasPayments ? "text-purple-400 hover:bg-purple-900/30" : "text-white/20 hover:bg-white/5 hover:text-white/40"}`}
                              title={hasPayments ? "View payment transactions" : "No transactions recorded"}>
                              <History className="w-3 h-3" />
                              <span>{count}</span>
                            </Button>
                          );
                        })()}
                        {(() => {
                          const dCount = dunningCounts[rec.id] ?? 0;
                          const hasDunning = dCount > 0;
                          return (
                            <Button size="sm" variant="ghost"
                              onClick={() => {
                                setNotifStudentId(rec.studentId);
                                setNotifStudentName(rec.student?.name ?? null);
                                setShowNotifModal(true);
                              }}
                              className={`h-7 px-2 text-xs gap-1 ${hasDunning ? "text-violet-400 hover:bg-violet-900/30" : "text-white/20 hover:bg-white/5 hover:text-white/40"}`}
                              title={hasDunning ? `${dCount} reminder${dCount !== 1 ? "s" : ""} sent` : "No reminders sent yet"}>
                              <Bell className="w-3 h-3" />
                              <span>{dCount}</span>
                            </Button>
                          );
                        })()}
                        {(() => {
                          const failedInfo = failedCounts[rec.id];
                          if (!failedInfo || failedInfo.count === 0) return null;
                          return (
                            <span
                              title={failedInfo.lastError ? `Last error: ${failedInfo.lastError}` : `${failedInfo.count} failed payment attempt${failedInfo.count !== 1 ? "s" : ""}`}
                              className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] font-semibold bg-red-900/50 border border-red-700/60 text-red-400 cursor-default select-none"
                            >
                              {failedInfo.count} failed
                            </span>
                          );
                        })()}
                        {rec.status === "Paid" ? (() => {
                          // Prefer the most recent offline (OP) payment receipt;
                          // fall back to the fee-record (AF) receipt for Add Fee entries.
                          const offlinePayment = (paymentsByFeeRecordId.get(rec.id) ?? [])
                            .find(p => p.cashierNotes !== "Auto-recorded from Add Fee Record");
                          return (
                            <Button size="sm" variant="ghost"
                              onClick={() => window.open(
                                offlinePayment
                                  ? `/api/admin/fees/payments/${offlinePayment.id}/receipt`
                                  : `/api/admin/fees/${rec.id}/receipt`,
                                "_blank",
                              )}
                              className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1"
                              title={`Print receipt ${rec.invoiceNumber ?? rec.receiptNumber ?? ""}`}>
                              <Receipt className="w-3 h-3" /> Receipt
                            </Button>
                          );
                        })() : (
                          <Button size="sm" variant="ghost"
                            onClick={() => printInvoiceFromRecord(rec.id)}
                            className="h-7 px-2 text-xs text-blue-300 hover:bg-blue-900/30 gap-1"
                            title={`Print or download invoice ${rec.invoiceNumber ?? ""}`}>
                            <FileText className="w-3 h-3" /> Invoice
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* ── Expandable accordion row ─── */}
                  {isExpanded && (
                    <tr className="border-b border-cyan-900/30 bg-[#08111f]">
                      <td colSpan={colSpan} className="px-0 py-0">
                        {isLoadingDetail ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-white/40">
                            <Loader2 className="w-4 h-4 animate-spin" /> Loading transaction details…
                          </div>
                        ) : detail ? (
                          <div className="px-6 py-5 space-y-4">
                            {/* Section tabs + action toolbar */}
                            <div className="flex flex-wrap items-center gap-1 border-b border-white/10 pb-3">
                              {["Online Payment","Financial","Student Profile","Audit & Notes"].map((label, i) => (
                                <button key={i}
                                  onClick={() => setDetailSection(prev => ({ ...prev, [rec.id]: i }))}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeSection === i ? "bg-cyan-600 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/5"}`}>
                                  {label}
                                </button>
                              ))}
                              <div className="ml-auto flex items-center gap-2">
                                <Button size="sm" variant="ghost"
                                  onClick={() => window.open(`/api/admin/fees/${rec.id}/transaction-pdf`, "_blank")}
                                  className="h-7 px-2 text-xs text-emerald-400 hover:bg-emerald-900/30 gap-1">
                                  <FileText className="w-3 h-3" /> Full Detail PDF
                                </Button>
                                {rec.status !== "Paid" && (
                                  <Button size="sm" variant="ghost"
                                    onClick={() => printInvoiceFromRecord(rec.id)}
                                    className="h-7 px-2 text-xs text-blue-300 hover:bg-blue-900/30 gap-1">
                                    <FileText className="w-3 h-3" /> Invoice
                                  </Button>
                                )}
                                {rec.status === "Paid" && (() => {
                                  const offPay = (paymentsByFeeRecordId.get(rec.id) ?? []).find(p => p.cashierNotes !== "Auto-recorded from Add Fee Record");
                                  if (offPay) return (
                                    <Button size="sm" variant="ghost"
                                      onClick={() => window.open(`/api/admin/fees/payments/${offPay.id}/receipt`, "_blank")}
                                      className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1">
                                      <Receipt className="w-3 h-3" /> Receipt
                                    </Button>
                                  );
                                  if (rec.status === "Paid") return (
                                    <Button size="sm" variant="ghost"
                                      onClick={() => window.open(`/api/admin/fees/${rec.id}/receipt`, "_blank")}
                                      className="h-7 px-2 text-xs text-cyan-400 hover:bg-cyan-900/30 gap-1">
                                      <Receipt className="w-3 h-3" /> Receipt
                                    </Button>
                                  );
                                  return null;
                                })()}
                              </div>
                            </div>

                            {/* Section 0 — Online Payment Details (all payment records) */}
                            {activeSection === 0 && (
                              <div className="space-y-4">
                                {detail.payments.length === 0 ? (
                                  <div className="py-6 text-center text-white/30 text-sm">
                                    <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                    <p>No payment records found for this fee.</p>
                                  </div>
                                ) : detail.payments.map((pay, pi) => (
                                  <div key={pay.id} className="border border-white/10 rounded-xl p-4 space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-white/60 border-b border-white/8 pb-2">
                                      <span className="text-white/40">Payment {detail.payments.length > 1 ? `#${pi + 1} of ${detail.payments.length}` : ""}</span>
                                      <span className="font-mono text-cyan-300">{fmt(pay.amount)}</span>
                                      <span className="ml-auto text-white/30">{pay.createdAt ? fmtDateTimeIST(pay.createdAt) : fmtDate(pay.receivedDate)}</span>
                                    </div>
                                    {pay.paymentMethod === "Online" ? (
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Payment Method" value="Portal Payment" />
                                          <TxnDetailRow label="Gateway" value="Razorpay" />
                                          <TxnDetailRow label="Payment ID" value={
                                            pay.razorpayPaymentId
                                              ? <a href={`https://dashboard.razorpay.com/app/payments/${pay.razorpayPaymentId}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono text-xs flex items-center gap-1">{pay.razorpayPaymentId} <ExternalLink className="w-3 h-3" /></a>
                                              : null
                                          } />
                                          <TxnDetailRow label="Order ID" value={<span className="font-mono text-xs">{pay.razorpayOrderId ?? "—"}</span>} />
                                          <TxnDetailRow label="Gateway Method" value={
                                            pay.paymentMode
                                              ? <span className="capitalize px-2 py-0.5 rounded-full text-xs bg-blue-900/40 text-blue-300 border border-blue-700/40">{pay.paymentMode}</span>
                                              : null
                                          } />
                                          <TxnDetailRow label="Bank" value={pay.bankName} />
                                          <TxnDetailRow label="Card (last 4)" value={pay.cardLast4 ? `●●●● ${pay.cardLast4}` : null} />
                                          <TxnDetailRow label="UPI VPA" value={<span className="font-mono text-xs">{pay.vpa ?? "—"}</span>} />
                                        </div>
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Payer Name" value={pay.payerName} />
                                          <TxnDetailRow label="Payer Email" value={pay.payerEmail} />
                                          <TxnDetailRow label="Payer Contact" value={pay.payerContact} />
                                          <TxnDetailRow label="Gateway Status" value={
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${pay.gatewayStatus === "captured" ? "bg-emerald-900/40 text-emerald-400 border-emerald-700/40" : pay.gatewayStatus === "refunded" ? "bg-red-900/40 text-red-400 border-red-700/40" : "bg-white/10 text-white/50 border-white/10"}`}>
                                              {pay.gatewayStatus ?? "—"}
                                            </span>
                                          } />
                                          <TxnDetailRow label="Receipt No." value={<span className="font-mono text-cyan-300 text-xs">{pay.receiptNumber ?? "—"}</span>} />
                                          <div className="mt-1">
                                            <p className="text-white/30 text-[10px] mb-0.5">HMAC Signature</p>
                                            <p className="text-white/35 font-mono text-[9px] break-all leading-tight">{pay.razorpaySignature ?? "—"}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Method" value={pay.paymentMethod} />
                                          <TxnDetailRow label="Reference" value={<span className="font-mono text-xs">{pay.referenceNumber ?? "—"}</span>} />
                                          <TxnDetailRow label="Receipt No." value={<span className="font-mono text-cyan-300 text-xs">{pay.receiptNumber ?? "—"}</span>} />
                                        </div>
                                        <div className="space-y-1.5">
                                          <TxnDetailRow label="Notes" value={pay.cashierNotes} />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Section 1 — Financial & Fee Breakdown */}
                            {activeSection === 1 && (
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                  <TxnDetailRow label="Fee Name" value={resolveFeeDisplayName(rec)} />
                                  <TxnDetailRow label="Fee Type" value={rec.feeType} />
                                  <TxnDetailRow label="Base Fee" value={fmt(detail.feeRecord.amount)} />
                                  <TxnDetailRow label="Late Fee" value={detail.feeRecord.lateFeeAmount > 0 ? <span className="text-amber-400">{fmt(detail.feeRecord.lateFeeAmount)}</span> : null} />
                                  <TxnDetailRow label="Total Charged" value={<span className="font-black">{fmt(detail.feeRecord.amount + detail.feeRecord.lateFeeAmount)}</span>} />
                                  <TxnDetailRow label="Total Received" value={<span className="font-black text-emerald-400">{fmt(detail.payments.reduce((s, p) => s + p.amount, 0))}</span>} />
                                  <TxnDetailRow label="Invoice No." value={<span className="font-mono text-violet-300 text-xs">{rec.invoiceNumber ?? "—"}</span>} />
                                   <TxnDetailRow label="Invoice Date & Time" value={formatPersistedInvoiceDateTimeIST(detail.feeRecord.createdAt)} />
                                  <TxnDetailRow label="Receipt No." value={<span className="font-mono text-cyan-300 text-xs">{rec.receiptNumber ?? mainPayment?.receiptNumber ?? "—"}</span>} />
                                  {detail.payments.length > 1 && (
                                    <div className="mt-2 pt-2 border-t border-white/10">
                                      <p className="text-white/30 text-[10px] mb-1">Payment history ({detail.payments.length} transactions)</p>
                                      {detail.payments.map((p, i) => (
                                        <div key={p.id} className="flex justify-between text-xs py-0.5 text-white/50">
                                          <span>#{i + 1} {p.paymentMethod} · {p.createdAt ? fmtDateTimeIST(p.createdAt) : fmtDate(p.receivedDate)}</span>
                                          <span className="text-white/70">{fmt(p.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p className="text-white/40 text-xs font-medium mb-2">Fee Breakdown</p>
                                  {detail.feeRecord.breakdown?.length > 0 ? (
                                    <div className="space-y-1">
                                      {detail.feeRecord.breakdown.map((b, bi) => (
                                        <div key={bi} className="flex justify-between text-xs py-1 border-b border-white/5">
                                          <span className="text-white/60">{b.name}</span>
                                          <span className="text-white/80">{fmt(b.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-white/25 text-xs italic">No breakdown items</p>
                                  )}
                                  <div className="mt-3 p-2 rounded bg-white/5 border border-white/10 text-[10px] text-white/30 italic">
                                    Convenience fee / GST / settlement batch — N/A (requires Razorpay Settlements API)
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Section 2 — Student & Academic Profile */}
                            {activeSection === 2 && (
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                  <TxnDetailRow label="Student Name" value={detail.student.name} />
                                  <TxnDetailRow label="DSID" value={<span className="font-mono text-xs text-cyan-400">{detail.student.digitalStudentId}</span>} />
                                  <TxnDetailRow label="Class" value={detail.student.class} />
                                  <TxnDetailRow label="Section" value={detail.student.section} />
                                  {detail.student.rollNumber != null && <TxnDetailRow label="Roll No." value={String(detail.student.rollNumber)} />}
                                </div>
                                <div className="space-y-2">
                                  <TxnDetailRow label="Academic Year" value={detail.feeRecord.academicYear} />
                                  {detail.student.guardianName && <TxnDetailRow label="Guardian" value={detail.student.guardianName} />}
                                  {detail.student.phone && <TxnDetailRow label="Contact" value={detail.student.phone} />}
                                  {detail.student.email && <TxnDetailRow label="Email" value={detail.student.email} />}
                                </div>
                              </div>
                            )}

                            {/* Section 3 — Audit & Notes */}
                            {activeSection === 3 && (
                              <div className="space-y-4">
                                <div>
                                  <p className="text-white/40 text-xs font-medium mb-1.5">Admin Notes</p>
                                  <textarea
                                    value={adminNotes[rec.id] ?? mainPayment?.cashierNotes ?? ""}
                                    onChange={e => setAdminNotes(prev => ({ ...prev, [rec.id]: e.target.value }))}
                                    onBlur={() => mainPayment && saveAdminNotes(rec.id, mainPayment.id, adminNotes[rec.id] ?? "")}
                                    placeholder="Add notes visible only to admins…"
                                    rows={2}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 resize-none"
                                  />
                                  {savingNotes.has(rec.id) && <p className="text-white/30 text-[10px] mt-0.5">Saving…</p>}
                                  {!mainPayment && <p className="text-white/25 text-[10px] mt-0.5 italic">Notes can only be saved once a payment is recorded.</p>}
                                </div>
                                <div>
                                  <p className="text-white/40 text-xs font-medium mb-2">Audit Trail ({detail.auditEntries.length} entries)</p>
                                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                    {detail.auditEntries.length === 0 ? (
                                      <p className="text-white/20 text-xs italic">No audit entries for this fee record.</p>
                                    ) : detail.auditEntries.map(a => (
                                      <div key={a.id} className="flex gap-3 text-xs border-b border-white/5 pb-1.5">
                                        <div className="shrink-0 text-white/30 text-[10px] w-32 leading-tight">
                                          {fmtDateTime(a.createdAt)}<br/>
                                          <span className="font-mono">{a.ipAddress ?? "—"}</span>
                                        </div>
                                        <div className="grow">
                                          <span className="text-white/50 font-medium">{a.actorName ?? "System"}</span>
                                          <span className="text-white/30 mx-1">·</span>
                                          <ActionBadge action={a.action} />
                                          {a.description && <p className="text-white/45 text-[10px] mt-0.5 leading-snug">{a.description}</p>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2 py-6 text-white/30 text-xs">
                            <AlertTriangle className="w-4 h-4" /> Failed to load transaction details.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ledgerTotalPages > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={ledgerPage <= 1 || isFetching}
            onClick={() => setLedgerPage(page => Math.max(1, page - 1))}
            className="min-w-28 min-h-9 border-white/15 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <span className="text-xs text-white/60 min-w-24 text-center">
            Page {ledgerData?.page ?? ledgerPage} of {ledgerTotalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={ledgerPage >= ledgerTotalPages || isFetching}
            onClick={() => setLedgerPage(page => Math.min(ledgerTotalPages, page + 1))}
            className="min-w-28 min-h-9 border-white/15 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40"
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Summary strip — updates live as filters change */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="text-white/30">
          <span className="text-white/50 font-semibold">{students.length}</span> active student{students.length !== 1 ? "s" : ""} in registry
        </span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">
          <span className="text-white/50 font-semibold">{new Set(filtered.map(r => r.studentId)).size}</span> student{new Set(filtered.map(r => r.studentId)).size !== 1 ? "s" : ""} in view
        </span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">
          <span className="text-white/50 font-semibold">{filtered.length}</span> of <span className="text-white/50 font-semibold">{ledgerTotal}</span> records
        </span>
        {selectedIds.size > 0 && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-red-400/80"><span className="font-semibold">{selectedIds.size}</span> selected</span>
          </>
        )}
      </div>

      {/* Payment modals */}
      <StandaloneOfflinePayModal open={showStandalonePay} onClose={() => setShowStandalonePay(false)} />
      <PaymentHistoryModal
        open={showPaymentsModal}
        onClose={() => { setShowPaymentsModal(false); setViewPaymentsRecord(null); }}
        feeRecord={viewPaymentsRecord}
      />
      <ExportLedgerDialog
        open={showExportLedger}
        onClose={() => setShowExportLedger(false)}
        availableClasses={classes}
        availableFeeTypes={allFeeTypes}
        availableFeeNames={allFeeNames}
      />
      <NotificationHistoryModal
        open={showNotifModal}
        onClose={() => { setShowNotifModal(false); setNotifStudentId(null); setNotifStudentName(null); }}
        studentId={notifStudentId}
        studentName={notifStudentName}
      />

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditing(null); setAddFeeSuccessId(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">
              {addFeeSuccessId !== null ? "Invoice Created Successfully" : editing ? "Edit Fee Record" : "Add Invoice"}
            </DialogTitle>
          </DialogHeader>
          {addFeeSuccessId !== null ? (
            <div className="space-y-4 py-2">
              {isAddFeeSuccessLoading ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
                  <p className="text-white/60 text-sm">Loading the created invoice…</p>
                </div>
              ) : addFeeSuccessDetail ? (
                <>
                  <div className="p-5 rounded-xl bg-emerald-900/20 border border-emerald-700/40 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <p className="text-emerald-400 font-bold tracking-wide">INVOICE CREATED SUCCESSFULLY</p>
                    <div className="mt-4 rounded-lg bg-[#081426] border border-cyan-400/30 px-4 py-3">
                      <p className="text-[10px] font-bold tracking-[0.18em] text-cyan-300/70">INVOICE NO.</p>
                      <p className="mt-1 text-2xl font-black tracking-wide text-cyan-300">
                        {addFeeSuccessDetail.feeRecord.invoiceNumber ?? "—"}
                      </p>
                    </div>
                    <span className="inline-flex mt-3 rounded-full border border-amber-500/30 bg-amber-900/20 px-3 py-1 text-xs font-bold text-amber-300">
                      STATUS: {addFeeSuccessDetail.feeRecord.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-4 rounded-xl border border-white/10 bg-[#0A1628]/60 p-4 text-sm">
                    <div>
                      <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase mb-2">Student</p>
                      <p className="font-semibold text-white">{addFeeSuccessDetail.student.name}</p>
                      <p className="text-xs text-white/50 mt-1">
                        {addFeeSuccessDetail.student.digitalStudentId} · Class {addFeeSuccessDetail.student.class ?? "—"}-{addFeeSuccessDetail.student.section ?? "—"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4">
                      {[
                        ["Fee Name", addFeeSuccessDetail.feeRecord.feeName],
                        ["Fee Type", addFeeSuccessDetail.feeRecord.feeType],
                        ["Amount", fmt(addFeeSuccessDetail.feeRecord.amount)],
                        ["Frequency", invoiceFrequencyLabel(addFeeSuccessDetail.feeRecord.frequency)],
                        ["Fee Period", invoiceFeePeriodLabel(addFeeSuccessDetail.feeRecord)],
                        ["Due Date", fmtDate(addFeeSuccessDetail.feeRecord.dueDate)],
                        ["Academic Session", addFeeSuccessDetail.feeRecord.academicYear ?? "—"],
                        ["Invoice Date & Time", formatPersistedInvoiceDateTimeIST(addFeeSuccessDetail.feeRecord.createdAt)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">{label}</p>
                          <p className="mt-0.5 font-medium text-white/85 break-words">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-white/10 pt-4">
                      <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase">Late Fee &amp; Penalty</p>
                      {addFeeSuccessDetail.feeRecord.lateFeeConfig?.enabled ? (
                        <div className="mt-2 text-white/85 space-y-1">
                          <p><span className="text-amber-300 font-semibold">Enabled</span> · {lateFeeRuleLabel(addFeeSuccessDetail.feeRecord.lateFeeConfig.type)}</p>
                          {addFeeSuccessDetail.feeRecord.lateFeeConfig.type === "FLAT" && <p className="text-white/60">Penalty Amount: {fmt(Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.flat_amount ?? 0))}</p>}
                          {addFeeSuccessDetail.feeRecord.lateFeeConfig.type === "DAILY" && (
                            <>
                              <p className="text-white/60">Daily Penalty: {fmt(Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.daily_rate ?? 0))} / day</p>
                              {Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.grace_period_days ?? 0) > 0 && <p className="text-white/60">Grace Period: {addFeeSuccessDetail.feeRecord.lateFeeConfig.grace_period_days} day(s)</p>}
                              {Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.max_cap ?? 0) > 0 && <p className="text-white/60">Maximum Penalty Cap: {fmt(Number(addFeeSuccessDetail.feeRecord.lateFeeConfig.max_cap))}</p>}
                            </>
                          )}
                          {addFeeSuccessDetail.feeRecord.lateFeeConfig.type === "TIERED" && (addFeeSuccessDetail.feeRecord.lateFeeConfig.tiered_slabs?.length ?? 0) > 0 && (
                            <div className="pt-1 space-y-1">
                              {addFeeSuccessDetail.feeRecord.lateFeeConfig.tiered_slabs!.map((slab, index) => (
                                <p key={`${slab.from_day}-${slab.to_day}-${index}`} className="text-white/60">
                                  Days {slab.from_day}–{slab.to_day}: {fmt(Number(slab.amount))}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-white/60">Disabled</p>
                      )}
                    </div>

                    {addFeeSuccessDetail.feeRecord.breakdown.length > 0 && (
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase mb-2">Fee Components</p>
                        <div className="space-y-2">
                          {addFeeSuccessDetail.feeRecord.breakdown.map((component, index) => (
                            <div key={`${component.name}-${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                              <div><p className="font-medium text-white/85">{component.name}</p>{component.purpose && <p className="text-xs text-white/45">{component.purpose}</p>}</div>
                              <p className="font-semibold text-cyan-300">{fmt(Number(component.amount))}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {addFeeSuccessDetail.feeRecord.notes && (
                      <div className="border-t border-white/10 pt-4">
                        <p className="text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase">Notes</p>
                        <p className="mt-2 whitespace-pre-wrap text-white/70">{addFeeSuccessDetail.feeRecord.notes}</p>
                      </div>
                    )}
                  </div>

                  <p className="text-center text-xs text-white/40">
                    This is an invoice only. A payment receipt is available after successful payment.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button className="bg-white/10 hover:bg-white/20 text-white gap-2"
                      onClick={() => printInvoiceFromRecord(addFeeSuccessDetail.feeRecord.id)}>
                      <Printer className="w-4 h-4" /> View / Print Invoice
                    </Button>
                    <Button className="bg-cyan-600 hover:bg-cyan-500 text-white" onClick={() => { setShowForm(false); setAddFeeSuccessId(null); }}>
                      Done
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-4 py-8 text-center">
                  <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                  <p className="text-white/70 text-sm">{isAddFeeSuccessDetailError ? "The invoice was created, but its details could not be loaded." : "The invoice details are unavailable."}</p>
                  <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" onClick={() => { setShowForm(false); setAddFeeSuccessId(null); }}>Done</Button>
                </div>
              )}
            </div>
          ) : (
          <>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => editing ? updateMut.mutate({ id: editing.id, data: d }) : createMut.mutate(d))} className="space-y-4">
              {/* ── Student search & select ── */}
              <FormField control={form.control} name="studentId" render={() => (
                <FormItem>
                  <FormLabel className="text-white/70">Student</FormLabel>
                  {selectedStudent ? (
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-cyan-500/50 bg-cyan-900/20">
                      <div>
                        <p className="text-white text-sm font-medium">{selectedStudent.name}</p>
                        <p className="text-white/40 text-xs">{selectedStudent.digitalStudentId} · Class {selectedStudent.class}-{selectedStudent.section}</p>
                      </div>
                      {!editing && (
                        <button type="button" onClick={clearStudentPick} className="text-white/30 hover:text-white/70 ml-3 text-lg leading-none">✕</button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input value={studentSearchQ} onChange={e => setStudentSearchQ(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void runStudentSearch(); } }}
                          placeholder="Search by student name or DSID…"
                          className="flex-1 bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 min-w-0" />
                        <button type="button" onClick={() => void runStudentSearch()}
                          disabled={studentSearchLoading || studentSearchQ.trim().length < 2}
                          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex-shrink-0">
                          {studentSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
                        </button>
                      </div>
                      {studentResults !== null && (
                        studentResults.length === 0 ? (
                          <p className="text-white/30 text-xs text-center py-3">No students found.</p>
                        ) : (
                          <div className="rounded-lg border border-white/10 overflow-hidden max-h-44 overflow-y-auto">
                            {studentResults.map(s => (
                              <button key={s.id} type="button" onClick={() => pickStudent(s)}
                                className="w-full text-left px-3 py-2.5 hover:bg-cyan-900/30 border-b border-white/5 last:border-0 transition-colors">
                                <p className="text-white text-sm">{s.name}</p>
                                <p className="text-white/40 text-xs">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                              </button>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  <FormMessage className="text-red-400" />
                </FormItem>
              )} />
              {!editing && selectedStudent && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="feeName" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Fee Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Tuition Fee" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="feeType" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Fee Type</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Tuition / Transport…" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Amount (₹)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min={1} placeholder="Enter amount" className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30" />
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="frequency" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-white/60 mb-1 block">Frequency</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                            <option value="">— Select frequency —</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="annual">Annual</option>
                            <option value="one-time">One-Time</option>
                          </select>
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="feePeriod" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-white/60 mb-1 block">Fee Period</FormLabel>
                      {watchFrequency === "monthly" || watchFrequency === "quarterly" ? (
                        <FormControl>
                          <select
                            {...field}
                            disabled={invoicePeriodOptions.length === 0}
                            className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50">
                            <option value="">
                              {invoicePeriodOptions.length === 0
                                ? "No complete periods in the active session"
                                : "— Select fee period —"}
                            </option>
                            {invoicePeriodOptions.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </FormControl>
                      ) : watchFrequency === "annual" || watchFrequency === "one-time" ? (
                        <div className="rounded-lg border border-white/10 bg-[#0A1628] px-3 py-2 text-sm text-white/80">
                          {activeInvoiceSession
                            ? `${activeInvoiceSession.sessionName} (Active academic session)`
                            : "No active academic session found"}
                          <input type="hidden" name={field.name} value={field.value} onChange={field.onChange} />
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-sm text-white/30">
                          Select a frequency to choose a fee period.
                        </div>
                      )}
                      {selectedInvoicePeriod && (
                        <p className="text-xs text-white/40">
                          Resolved period: {selectedInvoicePeriod.start} → {selectedInvoicePeriod.end}
                        </p>
                      )}
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="dueDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-white/60 mb-1 block">Due Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white [color-scheme:dark]" />
                      </FormControl>
                      <FormMessage className="text-red-400" />
                    </FormItem>
                  )} />

                  <div className={`rounded-xl border p-4 space-y-3 transition-all ${invoiceLateFeeEnabled ? "border-amber-600/40 bg-amber-900/10" : "border-white/10 bg-white/5"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Switch checked={invoiceLateFeeEnabled} onCheckedChange={enabled => {
                          setInvoiceLateFeeEnabled(enabled);
                          if (enabled && invoiceLateFeeType === "NONE") setInvoiceLateFeeType("FLAT");
                        }} />
                        <div>
                          <p className="text-sm font-semibold text-white/80">Late Fee &amp; Penalty</p>
                          <p className="text-xs text-white/40 leading-tight">Automatically fine overdue invoices</p>
                        </div>
                      </div>
                      {invoiceLateFeeEnabled && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/40 flex-shrink-0">ACTIVE</span>
                      )}
                    </div>
                    {invoiceLateFeeEnabled && (
                      <div className="pt-2 border-t border-white/10 space-y-3">
                        <div>
                          <label className="text-xs text-white/50 block mb-1">Rule Type</label>
                          <select value={invoiceLateFeeType} onChange={event => setInvoiceLateFeeType(event.target.value as "FLAT" | "DAILY" | "TIERED")} className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
                            <option value="FLAT">Flat One-Time Penalty</option>
                            <option value="DAILY">Daily Accumulating Fine</option>
                            <option value="TIERED">Tiered Schedule</option>
                          </select>
                        </div>
                        {invoiceLateFeeType === "FLAT" && (
                          <div>
                            <label className="text-xs text-white/50 block mb-1">Penalty Amount (₹)</label>
                            <input type="number" min={0} value={invoiceLateFeeFlat} onChange={event => setInvoiceLateFeeFlat(event.target.value)} placeholder="Enter amount" className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
                          </div>
                        )}
                        {invoiceLateFeeType === "DAILY" && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-white/50 block mb-1">Grace Period (Days)</label>
                                <input type="number" min={0} value={invoiceLateFeeGraceDays} onChange={event => setInvoiceLateFeeGraceDays(event.target.value)} className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                              </div>
                              <div>
                                <label className="text-xs text-white/50 block mb-1">Daily Rate (₹/day)</label>
                                <input type="number" min={0} step="0.5" value={invoiceLateFeeDailyRate} onChange={event => setInvoiceLateFeeDailyRate(event.target.value)} placeholder="Enter rate" className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-white/50 block mb-1">Maximum Cap (₹) <span className="text-white/30">— 0 = no cap</span></label>
                              <input type="number" min={0} value={invoiceLateFeeCap} onChange={event => setInvoiceLateFeeCap(event.target.value)} className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                            </div>
                          </>
                        )}
                        {invoiceLateFeeType === "TIERED" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-white/50">Penalty Slabs</label>
                              <button type="button" onClick={addInvoiceLateFeeSlab} className="text-xs px-2.5 py-0.5 rounded border border-amber-700/40 text-amber-400 hover:bg-amber-900/20 transition-all">+ Add Slab</button>
                            </div>
                            {invoiceLateFeeSlabs.length > 0 ? (
                              <div className="rounded-lg border border-white/10 overflow-hidden">
                                <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10">
                                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">From Day</span>
                                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">To Day</span>
                                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Fine (₹)</span>
                                  <span />
                                </div>
                                {invoiceLateFeeSlabs.map((slab, index) => (
                                  <div key={index} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                                    <input type="number" min={1} placeholder="e.g. 1" value={slab.from_day} onChange={event => updateInvoiceLateFeeSlab(index, "from_day", event.target.value)} className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                                    <input type="number" min={1} placeholder="e.g. 7" value={slab.to_day} onChange={event => updateInvoiceLateFeeSlab(index, "to_day", event.target.value)} className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                                    <input type="number" min={0} placeholder="e.g. 100" value={slab.amount} onChange={event => updateInvoiceLateFeeSlab(index, "amount", event.target.value)} className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                                    <button type="button" onClick={() => removeInvoiceLateFeeSlab(index)} className="flex items-center justify-center w-7 h-7 rounded hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-white/25 px-1">No slabs. Add slabs — e.g. Day 1–7: ₹100 fine, Day 8–14: ₹200 fine.</p>
                            )}
                          </div>
                        )}
                        <p className="text-[11px] text-amber-400/60 leading-snug">⏰ The nightly cron recalculates fines for all overdue invoices with a matching late fee config automatically.</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-white/60 flex items-center gap-1.5">
                        <span className="text-cyan-400">⊞</span> Fee Breakdown / Components
                        <span className="text-white/30 font-normal">(optional — shown to students)</span>
                      </label>
                      <button type="button" onClick={addInvoiceBreakdownRow}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:bg-cyan-900/40 border border-cyan-700/40 text-cyan-400">
                        <Plus className="w-3 h-3" /> Add Component
                      </button>
                    </div>
                    {invoiceBreakdown.length > 0 ? (
                      <div className="rounded-xl border border-white/10 overflow-hidden">
                        <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-b border-white/10">
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Component</span>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Purpose / Description</span>
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide text-right">Amount ₹</span>
                          <span />
                        </div>
                        {invoiceBreakdown.map((row, index) => (
                          <div key={index} className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                            <input value={row.name} onChange={event => updateInvoiceBreakdownRow(index, "name", event.target.value)} placeholder="Lab Fee…" className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full" />
                            <input value={row.purpose} onChange={event => updateInvoiceBreakdownRow(index, "purpose", event.target.value)} placeholder="Covers equipment & software…" className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full" />
                            <input type="number" min={0} value={row.amount} onChange={event => updateInvoiceBreakdownRow(index, "amount", event.target.value)} placeholder="0" className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full text-right" />
                            <button type="button" onClick={() => removeInvoiceBreakdownRow(index)} className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-t border-white/10">
                          <span className="text-xs font-bold text-white/60 col-span-2">Components Total</span>
                          <span className={`text-xs font-black text-right ${invoiceBreakdownMismatch ? "text-red-400" : "text-emerald-400"}`}>₹{invoiceBreakdownTotal.toLocaleString("en-IN")}</span>
                          <span />
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/25 px-1">No components added. Click "+ Add Component" to itemise this fee (e.g. Tuition ₹2,500 + Library ₹500).</p>
                    )}
                    {invoiceBreakdownMismatch && (
                      <p className="text-xs text-red-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Components total (₹{invoiceBreakdownTotal.toLocaleString("en-IN")}) doesn't match main amount (₹{(parseInt(form.watch("amount")) || 0).toLocaleString("en-IN")}). Adjust or remove components.
                      </p>
                    )}
                    <p className="text-[11px] text-white/30 px-1">Components are saved as this invoice's breakdown snapshot.</p>
                  </div>
                </>
              )}

              {editing && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="feeType" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Fee Type</FormLabel><FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white" /></FormControl><FormMessage className="text-red-400" /></FormItem>
                    )} />
                    <FormField control={form.control} name="amount" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Amount (₹)</FormLabel><FormControl><Input {...field} type="text" inputMode="numeric" className="bg-[#0A1628] border-white/20 text-white" /></FormControl><FormMessage className="text-red-400" /></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="status" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70">Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger className="bg-[#0A1628] border-white/20 text-white"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent className="bg-[#1A2942] border-white/10">
                            {["Due","Paid","Overdue"].map(status => <SelectItem key={status} value={status} className="text-white focus:bg-white/10">{status}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="dueDate" render={({ field }) => (
                      <FormItem><FormLabel className={dueDateNotNeeded ? "text-white/30" : "text-white/70"}>Due Date</FormLabel><FormControl><Input {...field} type="date" disabled={dueDateNotNeeded} className="bg-[#0A1628] border-white/20 text-white [color-scheme:dark]" /></FormControl></FormItem>
                    )} />
                  </div>
                  {watchStatus === "Paid" && (
                    <FormField control={form.control} name="paidDate" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Paid Date</FormLabel><FormControl><Input {...field} type="date" className="bg-[#0A1628] border-white/20 text-white [color-scheme:dark]" /></FormControl></FormItem>
                    )} />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="academicYear" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Academic Year</FormLabel><FormControl><Input {...field} readOnly className="bg-[#0A1628] border-white/10 text-white/60 cursor-default select-none" /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="notes" render={({ field }) => (
                      <FormItem><FormLabel className="text-white/70">Notes</FormLabel><FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white" /></FormControl></FormItem>
                    )} />
                  </div>
                </>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditing(null); }} className="text-white/60">Cancel</Button>
                <Button type="submit"
                  disabled={
                    createMut.isPending || updateMut.isPending || (
                      !editing && (
                        !selectedStudent ||
                        !form.watch("feeName")?.trim() ||
                        !form.watch("feeType")?.trim() ||
                        !(Number(form.watch("amount")) > 0) ||
                        !SUPPORTED_FREQUENCIES.includes(watchFrequency as SupportedFrequency) ||
                         !selectedInvoicePeriod ||
                        !form.watch("dueDate") ||
                        invoiceBreakdownMismatch
                      )
                    )
                  }
                  className="bg-cyan-600 hover:bg-cyan-500 text-white">
                  {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  {editing ? "Save Changes" : "Create Invoice"}
                </Button>
              </div>
            </form>
          </Form>
          </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Structures Tab ───────────────────────────────────────────────────────────

function StructuresTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FeeStructure | null>(null);
  const [delId, setDelId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [feeType, setFeeType] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("annual");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [dueDay, setDueDay] = useState("");
  const [breakdown, setBreakdown] = useState<Array<{ name: string; purpose: string; amount: string }>>([]);

  // ── Late Fee state ────────────────────────────────────────────────────────
  const [lateFeeEnabled, setLateFeeEnabled] = useState(false);
  const [lateFeeType, setLateFeeType] = useState<"NONE" | "FLAT" | "DAILY" | "TIERED">("NONE");
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState("0");
  const [lateFeeFlat, setLateFeeFlat] = useState("");
  const [lateFeeDailyRate, setLateFeeDailyRate] = useState("");
  const [lateFeeCap, setLateFeeCap] = useState("0");
  const [lateFeeSlabs, setLateFeeSlabs] = useState<Array<{ from_day: string; to_day: string; amount: string }>>([]);

  function addBreakdownRow() {
    setBreakdown(prev => [...prev, { name: "", purpose: "", amount: "" }]);
  }
  function removeBreakdownRow(idx: number) {
    setBreakdown(prev => prev.filter((_, i) => i !== idx));
  }
  function updateBreakdownRow(idx: number, field: "name" | "purpose" | "amount", value: string) {
    setBreakdown(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }
  const breakdownTotal = breakdown.reduce((s, r) => s + (parseInt(r.amount) || 0), 0);
  const amountNum = parseInt(amount) || 0;
  const breakdownMismatch = breakdown.length > 0 && breakdownTotal !== amountNum;

  const { data: structures = [], isLoading } = useQuery<FeeStructure[]>({
    queryKey: ["/api/admin/fees/structures"],
  });

  const { data: schoolConfig } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      if (!r.ok) return { classes: [] };
      return r.json();
    },
    staleTime: 300_000,
  });
  const schoolClasses: string[] = schoolConfig?.classes ?? [];

  function openCreate() {
    setEditing(null);
    setName(""); setFeeType(""); setAmount(""); setFrequency("annual");
    setSelectedClasses([]); setDueDay("");
    setBreakdown([]);
    setLateFeeEnabled(false); setLateFeeType("FLAT"); setLateFeeGraceDays("0");
    setLateFeeFlat(""); setLateFeeDailyRate(""); setLateFeeCap("0"); setLateFeeSlabs([]);
    setShowModal(true);
  }

  function openEdit(s: FeeStructure) {
    setEditing(s);
    setName(s.name); setFeeType(s.feeType); setAmount(String(s.amount));
    setFrequency(s.frequency);
    setSelectedClasses([...s.applicableClasses]);
    if (s.dueDayOfMonth) {
      const now = new Date();
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(Math.min(s.dueDayOfMonth, 28)).padStart(2, "0");
      setDueDay(`${y}-${mo}-${d}`);
    } else { setDueDay(""); }
    setBreakdown(((s as any).breakdown ?? []).map((b: any) => ({
      name: b.name ?? "", purpose: b.purpose ?? "", amount: String(b.amount ?? ""),
    })));
    const lfc = (s as any).lateFeeConfig ?? {};
    setLateFeeEnabled(!!lfc.enabled);
    setLateFeeType(lfc.type && lfc.type !== "NONE" ? lfc.type : "FLAT");
    setLateFeeGraceDays(String(lfc.grace_period_days ?? 0));
    setLateFeeFlat(String(lfc.flat_amount ?? 0));
    setLateFeeDailyRate(String(lfc.daily_rate ?? 0));
    setLateFeeCap(String(lfc.max_cap ?? 0));
    setLateFeeSlabs((lfc.tiered_slabs ?? []).map((sl: any) => ({
      from_day: String(sl.from_day ?? ""), to_day: String(sl.to_day ?? ""), amount: String(sl.amount ?? ""),
    })));
    setShowModal(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const parsedBreakdown = breakdown
        .filter(b => b.name.trim())
        .map(b => ({ name: b.name.trim(), purpose: b.purpose.trim(), amount: parseInt(b.amount) || 0 }));
      const payload = {
        name, feeType, amount: parseInt(amount),
        frequency,
        applicableClasses: selectedClasses,
        dueDayOfMonth: dueDay ? new Date(dueDay + "T00:00:00").getDate() : null,
        breakdown: parsedBreakdown,
        lateFeeConfig: {
          enabled: lateFeeEnabled,
          type: lateFeeEnabled ? lateFeeType : "NONE",
          // Grace period only applies to DAILY (FLAT fires immediately; TIERED uses slab from_day)
          grace_period_days: (lateFeeEnabled && lateFeeType === "DAILY")
            ? (parseInt(lateFeeGraceDays) || 0) : 0,
          flat_amount: parseInt(lateFeeFlat) || 0,
          daily_rate: parseFloat(lateFeeDailyRate) || 0,
          // Max cap only applies to DAILY (0 = no cap)
          max_cap: (lateFeeEnabled && lateFeeType === "DAILY")
            ? (parseInt(lateFeeCap) || 0) : 0,
          tiered_slabs: lateFeeSlabs
            .filter(s => s.from_day && s.to_day && s.amount)
            .map(s => ({ from_day: parseInt(s.from_day), to_day: parseInt(s.to_day), amount: parseInt(s.amount) })),
        },
      };
      return editing
        ? apiRequest("PATCH", `/api/admin/fees/structures/${editing.id}`, payload)
        : apiRequest("POST", "/api/admin/fees/structures", payload);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      const synced = data?.syncedInvoices ?? 0;
      const fields: string[] = data?.syncedFields ?? [];
      toast({
        title: editing ? "Structure updated" : "Structure created",
        description: synced > 0
          ? `✅ ${synced} unpaid invoice${synced !== 1 ? "s" : ""} updated — ${fields.join(", ")}`
          : undefined,
      });
      setShowModal(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/fees/structures/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      toast({ title: "Structure deleted" });
      setDelId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });


  // ── Generate Invoices state ────────────────────────────────────────────────
  const [genTarget, setGenTarget] = useState<FeeStructure | null>(null);
  const [genFeePeriodStart, setGenFeePeriodStart] = useState("");
  const [genFeePeriodEnd, setGenFeePeriodEnd] = useState("");
  const [genClasses, setGenClasses] = useState<string[]>([]);
  const [genResult, setGenResult] = useState<{ created: number; synced: number; skipped: number; voided: number; total: number } | null>(null);

  const { data: sessions = [] } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/fees/sessions"],
    staleTime: 60_000,
  });

  const genMut = useMutation({
    mutationFn: async () => {
      const freq = genTarget!.frequency;
      const body: Record<string, unknown> = {};
      // Attach the admin-selected fee period for monthly/quarterly fees.
      // Annual/one-time and the academic session are both resolved server-side automatically.
      if ((freq === "monthly" || freq === "quarterly") && genFeePeriodStart && genFeePeriodEnd) {
        body.feePeriodStart = genFeePeriodStart;
        body.feePeriodEnd   = genFeePeriodEnd;
      }
      const r = await fetch(`/api/admin/fees/structures/${genTarget!.id}/generate-invoices`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      return r.json() as Promise<{ created: number; synced: number; skipped: number; voided: number; total: number }>;
    },
    onSuccess: (data: { created: number; synced: number; skipped: number; voided: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/structures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      const parts: string[] = [];
      if (data.created > 0) parts.push(`${data.created} created`);
      if ((data.synced ?? 0) > 0) parts.push(`${data.synced} synced`);
      if (data.skipped > 0) parts.push(`${data.skipped} unchanged`);
      if ((data.voided ?? 0) > 0) parts.push(`${data.voided} out-of-scope removed`);
      const totalStr = (data.total ?? 0) > 0 ? ` · ${data.total} eligible students` : "";
      toast({ title: "✅ Invoices generated", description: (parts.join(" · ") || "No changes") + totalStr });
      setGenResult(data);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  /** Compute start/end for a calendar quarter by quarter-index (0=Q1 Jan-Mar) and year */
  function quarterBounds(qi: number, year: number): { start: string; end: string } {
    const sm = qi * 3;
    const em = sm + 2;
    const lastDay = new Date(year, em + 1, 0).getDate();
    return {
      start: `${year}-${String(sm + 1).padStart(2, "0")}-01`,
      end:   `${year}-${String(em + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  type PeriodOption = { label: string; start: string; end: string };

  /**
   * Generate all valid fee periods within a session date range.
   * Monthly → every month from sessionStart to sessionEnd (inclusive).
   * Quarterly → every calendar quarter that overlaps with the session.
   * Annual/one-time → single entry covering the full session.
   * Returns options chronologically oldest-first.
   */
  function periodsForSession(freq: string, sessionStart: string, sessionEnd: string): PeriodOption[] {
    const options: PeriodOption[] = [];
    if (!sessionStart || !sessionEnd) return options;

    const sDate = new Date(sessionStart + "T00:00:00");
    const eDate = new Date(sessionEnd + "T00:00:00");

    if (freq === "monthly") {
      // Walk month by month from sDate to eDate
      let cur = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
      const limit = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
      while (cur <= limit) {
        const py = cur.getFullYear(); const pm = cur.getMonth();
        const last = new Date(py, pm + 1, 0).getDate();
        const start = `${py}-${String(pm + 1).padStart(2, "0")}-01`;
        const end   = `${py}-${String(pm + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
        const label = cur.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
        options.push({ label, start, end });
        cur = new Date(py, pm + 1, 1);
      }
    } else if (freq === "quarterly") {
      // Walk quarter by quarter — each quarter whose START is ≤ session end
      const startQI = Math.floor(sDate.getMonth() / 3);
      let cur = new Date(sDate.getFullYear(), startQI * 3, 1);
      while (cur <= eDate) {
        const qy = cur.getFullYear();
        const qi = Math.floor(cur.getMonth() / 3);
        const b = quarterBounds(qi, qy);
        const sm2 = new Date(qy, qi * 3, 1);
        const em2 = new Date(qy, qi * 3 + 2, 1);
        const label = `${sm2.toLocaleDateString("en-IN", { month: "long" })}–${em2.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`;
        options.push({ label, ...b });
        cur = new Date(qy, (qi + 1) * 3, 1);
      }
    } else {
      // Annual / one-time — single period = full session
      options.push({
        label: `${sDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })} – ${eDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`,
        start: sessionStart.slice(0, 10),
        end:   sessionEnd.slice(0, 10),
      });
    }

    return options;
  }

  /**
   * Given a list of period options, pick the best default:
   *  - the period whose start ≤ today ≤ end (current month is inside the session), OR
   *  - if today is outside the session (before OR after) → first option (first month of session).
   */
  function bestDefaultPeriod(options: PeriodOption[]): PeriodOption | null {
    if (!options.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    // Return the period that contains today (current month is within the active session).
    const current = options.find(o => o.start <= today && o.end >= today);
    if (current) return current;
    // Current month is outside the session (before or after) → always default to first month.
    return options[0];
  }

  /**
   * When a session is chosen in the Generate modal, compute period options
   * for the structure's frequency and pre-select the best default period.
   */
  function applySessionPeriods(sessionIdStr: string, freq: string) {
    const sess = sessions.find((s: any) => String(s.id) === sessionIdStr) as any;
    if (!sess) return;
    const start = String(sess.startDate ?? "").slice(0, 10);
    const end   = String(sess.endDate   ?? "").slice(0, 10);
    if (freq !== "monthly" && freq !== "quarterly") {
      // Annual/one-time: period = session dates directly
      setGenFeePeriodStart(start);
      setGenFeePeriodEnd(end);
    } else {
      const opts = periodsForSession(freq, start, end);
      const best = bestDefaultPeriod(opts);
      if (best) { setGenFeePeriodStart(best.start); setGenFeePeriodEnd(best.end); }
    }
  }

  function openGenInvoices(s: FeeStructure) {
    setGenTarget(s);
    setGenResult(null);
    setGenClasses([...s.applicableClasses]);

    // Auto-apply the active session's periods — the session is always fixed server-side.
    const activeSess = sessions.find((x: any) => x.isActive) as any;
    if (activeSess) {
      applySessionPeriods(String(activeSess.id), s.frequency);
    } else {
      setGenFeePeriodStart("");
      setGenFeePeriodEnd("");
    }
  }

  const FREQ: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", "one-time": "One-Time" };
  const CONC: Record<string, string> = { none: "None", sibling: "Sibling", merit: "Merit", other: "Other" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm">{structures.length} structure{structures.length !== 1 ? "s" : ""} defined</p>
        {!isArchiveMode && (
          <Button size="sm" onClick={openCreate} className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1">
            <Plus className="w-4 h-4" /> Add Structure
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : structures.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No fee structures yet.</p>
          {!isArchiveMode && <Button size="sm" onClick={openCreate} className="mt-3 bg-cyan-600 hover:bg-cyan-500 text-white">Add First Structure</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {structures.map(s => (
            <div key={s.id} className="rounded-xl border p-4 space-y-3 border-cyan-700/40 bg-cyan-900/10">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-white font-semibold leading-tight">{s.name}</h3>
                  <p className="text-white/50 text-xs">{s.feeType}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-900/30 text-emerald-400 border-emerald-700/30 flex-shrink-0">
                  Active
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-white">{fmt(s.amount)}</span>
                <span className="text-white/40 text-xs">/ {FREQ[s.frequency] ?? s.frequency}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {s.applicableClasses.length > 0 && (
                  <div><p className="text-white/40 mb-0.5">Classes</p><p className="text-white/70 truncate">{s.applicableClasses.join(", ")}</p></div>
                )}
                {s.dueDayOfMonth != null && (
                  <div><p className="text-white/40 mb-0.5">Due Day</p><p className="text-white/70">{s.dueDayOfMonth}<sup>th</sup></p></div>
                )}
                {s.lastInvoicesGeneratedAt && (
                  <div className="col-span-2">
                    <p className="text-white/40 mb-0.5">Last Invoices Generated</p>
                    <p className="text-emerald-400/80 text-[11px]">
                      🕐 {new Date(s.lastInvoicesGeneratedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                )}
                {(s.frequency === "monthly" || s.frequency === "quarterly") &&
                  s.latestGeneratedFeePeriodStart &&
                  s.latestGeneratedFeePeriodEnd && (
                    <div className="col-span-2">
                      <p className="text-white/40 mb-0.5">Latest Fee Period</p>
                      <p className="text-emerald-400/80 text-[11px]">
                        {clientFeePeriodLabel(s.latestGeneratedFeePeriodStart, s.latestGeneratedFeePeriodEnd)}
                      </p>
                    </div>
                  )}
              </div>
              {!isArchiveMode && (
                <div className="space-y-1 pt-1 border-t border-white/10">
                  <Button size="sm" variant="ghost" onClick={() => openGenInvoices(s)}
                    className="w-full text-cyan-400 hover:bg-cyan-900/30 text-xs h-7 gap-1 border border-cyan-700/30">
                    <Printer className="w-3 h-3" /> Generate Invoices
                  </Button>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(s)} className="flex-1 text-white/50 hover:text-white text-xs h-7 gap-1">
                      <Pencil className="w-3 h-3" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDelId(s.id)} className="flex-1 text-white/40 hover:text-red-400 text-xs h-7 gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Dialog open={showModal} onOpenChange={v => { if (!v) setShowModal(false); }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400">{editing ? "Edit Fee Structure" : "New Fee Structure"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[["Fee Name", name, setName, "Annual Tuition Fee"], ["Fee Type", feeType, setFeeType, "Tuition / Transport…"]].map(([label, val, set, ph]) => (
                <div key={label as string}>
                  <label className="text-xs text-white/60 mb-1 block">{label as string}</label>
                  <input value={val as string} onChange={e => (set as any)(e.target.value)} placeholder={ph as string}
                    className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Amount (₹)</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min={1} placeholder="Enter amount"
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500" />
              </div>
              <div>
                <label className="text-xs text-white/60 mb-1 block">Frequency</label>
                <select value={frequency} onChange={e => setFrequency(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                  {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-white/60 mb-1.5 block">
                Applicable Classes
                {selectedClasses.length > 0 && (
                  <span className="ml-1.5 text-cyan-400">({selectedClasses.length} selected)</span>
                )}
              </label>
              {schoolClasses.length === 0 ? (
                <p className="text-white/30 text-xs py-2 px-1">No classes configured in School Setup yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {schoolClasses.map(cls => {
                    const checked = selectedClasses.includes(cls);
                    return (
                      <label key={cls} className={`flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg border transition-all ${checked ? "border-cyan-500/50 bg-cyan-900/20" : "border-white/10 bg-[#0A1628] hover:border-white/20"}`}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setSelectedClasses(prev =>
                            e.target.checked ? [...prev, cls] : prev.filter(c => c !== cls)
                          )}
                          className="accent-cyan-500 flex-shrink-0" />
                        <span className="text-xs text-white/80 truncate">{cls}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/60 mb-1 block">Due Date</label>
                <input type="date" value={dueDay} onChange={e => setDueDay(e.target.value)}
                  className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                {dueDay && (
                  <p className="text-white/40 text-xs mt-1">Day {new Date(dueDay + "T00:00:00").getDate()} of each month</p>
                )}
              </div>
            </div>

            {/* ── Late Fee & Penalty Settings ────────────────────────────── */}
            <div className={`rounded-xl border p-4 space-y-3 transition-all ${lateFeeEnabled ? "border-amber-600/40 bg-amber-900/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Switch checked={lateFeeEnabled} onCheckedChange={v => {
        setLateFeeEnabled(v);
        // Ensure a concrete rule type is selected when turning on
        if (v && (lateFeeType === "NONE" || !lateFeeType)) setLateFeeType("FLAT");
      }} />
                  <div>
                    <p className="text-sm font-semibold text-white/80">Late Fee &amp; Penalty</p>
                    <p className="text-xs text-white/40 leading-tight">Automatically fine overdue invoices</p>
                  </div>
                </div>
                {lateFeeEnabled && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/40 flex-shrink-0">
                    ACTIVE
                  </span>
                )}
              </div>

              {lateFeeEnabled && (
                <div className="pt-2 border-t border-white/10 space-y-3">
                  {/* Rule Type */}
                  <div>
                    <label className="text-xs text-white/50 block mb-1">Rule Type</label>
                    <select value={lateFeeType} onChange={e => setLateFeeType(e.target.value as any)}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
                      <option value="FLAT">Flat One-Time Penalty</option>
                      <option value="DAILY">Daily Accumulating Fine</option>
                      <option value="TIERED">Tiered Schedule</option>
                    </select>
                  </div>

                  {/* Flat penalty */}
                  {lateFeeType === "FLAT" && (
                    <div>
                      <label className="text-xs text-white/50 block mb-1">Penalty Amount (₹)</label>
                      <input type="number" min={0} value={lateFeeFlat} placeholder="Enter amount"
                        onChange={e => setLateFeeFlat(e.target.value)}
                        className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
                    </div>
                  )}

                  {/* Daily rate */}
                  {lateFeeType === "DAILY" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-white/50 block mb-1">Grace Period (Days)</label>
                        <input type="number" min={0} value={lateFeeGraceDays}
                          onChange={e => setLateFeeGraceDays(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                      </div>
                      <div>
                        <label className="text-xs text-white/50 block mb-1">Daily Rate (₹/day)</label>
                        <input type="number" min={0} step="0.5" value={lateFeeDailyRate} placeholder="Enter rate"
                          onChange={e => setLateFeeDailyRate(e.target.value)}
                          className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-500" />
                      </div>
                    </div>
                  )}

                  {/* Tiered slabs */}
                  {lateFeeType === "TIERED" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-white/50">Penalty Slabs</label>
                        <button type="button"
                          onClick={() => setLateFeeSlabs(prev => [...prev, { from_day: "", to_day: "", amount: "" }])}
                          className="text-xs px-2.5 py-0.5 rounded border border-amber-700/40 text-amber-400 hover:bg-amber-900/20 transition-all">
                          + Add Slab
                        </button>
                      </div>
                      {lateFeeSlabs.length > 0 && (
                        <div className="rounded-lg border border-white/10 overflow-hidden">
                          <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-1.5 bg-white/5 border-b border-white/10">
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">From Day</span>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">To Day</span>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Fine (₹)</span>
                            <span />
                          </div>
                          {lateFeeSlabs.map((slab, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_28px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                              <input type="number" min={1} placeholder="e.g. 1" value={slab.from_day}
                                onChange={e => setLateFeeSlabs(prev => prev.map((s, i) => i === idx ? { ...s, from_day: e.target.value } : s))}
                                className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                              <input type="number" min={1} placeholder="e.g. 7" value={slab.to_day}
                                onChange={e => setLateFeeSlabs(prev => prev.map((s, i) => i === idx ? { ...s, to_day: e.target.value } : s))}
                                className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                              <input type="number" min={0} placeholder="e.g. 100" value={slab.amount}
                                onChange={e => setLateFeeSlabs(prev => prev.map((s, i) => i === idx ? { ...s, amount: e.target.value } : s))}
                                className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-amber-500 w-full" />
                              <button type="button" onClick={() => setLateFeeSlabs(prev => prev.filter((_, i) => i !== idx))}
                                className="flex items-center justify-center w-7 h-7 rounded hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {lateFeeSlabs.length === 0 && (
                        <p className="text-[11px] text-white/25 px-1">
                          No slabs. Add slabs — e.g. Day 1–7: ₹100 fine, Day 8–14: ₹200 fine.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Max cap — only for Daily Accumulating Fine (spec: FLAT has no cap; TIERED uses slab amounts directly) */}
                  {lateFeeType === "DAILY" && (
                    <div>
                      <label className="text-xs text-white/50 block mb-1">
                        Maximum Cap (₹) <span className="text-white/30">— 0 = no cap</span>
                      </label>
                      <input type="number" min={0} value={lateFeeCap}
                        onChange={e => setLateFeeCap(e.target.value)}
                        className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
                    </div>
                  )}

                  <p className="text-[11px] text-amber-400/60 leading-snug">
                    ⏰ The nightly cron recalculates fines for all overdue invoices under this structure automatically.
                  </p>
                </div>
              )}
            </div>

            {/* ── Fee Breakdown / Components ─────────────────────────────── */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white/60 flex items-center gap-1.5">
                  <span className="text-cyan-400">⊞</span> Fee Breakdown / Components
                  <span className="text-white/30 font-normal">(optional — shown to students)</span>
                </label>
                <button type="button" onClick={addBreakdownRow}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:bg-cyan-900/40 border border-cyan-700/40 text-cyan-400">
                  <Plus className="w-3 h-3" /> Add Component
                </button>
              </div>

              {breakdown.length > 0 && (
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-b border-white/10">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Component</span>
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide">Purpose / Description</span>
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wide text-right">Amount ₹</span>
                    <span />
                  </div>
                  {breakdown.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 border-b border-white/5 last:border-0 bg-[#0A1628]/60">
                      <input
                        value={row.name}
                        onChange={e => updateBreakdownRow(idx, "name", e.target.value)}
                        placeholder="Lab Fee…"
                        className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full"
                      />
                      <input
                        value={row.purpose}
                        onChange={e => updateBreakdownRow(idx, "purpose", e.target.value)}
                        placeholder="Covers equipment & software…"
                        className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full"
                      />
                      <input
                        type="number"
                        value={row.amount}
                        onChange={e => updateBreakdownRow(idx, "amount", e.target.value)}
                        placeholder="0"
                        min={0}
                        className="bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500 w-full text-right"
                      />
                      <button type="button" onClick={() => removeBreakdownRow(idx)}
                        className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-900/30 text-white/30 hover:text-red-400 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {/* Totals row */}
                  <div className="grid grid-cols-[1fr_1.5fr_80px_32px] gap-2 px-3 py-2 bg-white/5 border-t border-white/10">
                    <span className="text-xs font-bold text-white/60 col-span-2">Components Total</span>
                    <span className={`text-xs font-black text-right ${breakdownMismatch ? "text-red-400" : "text-emerald-400"}`}>
                      ₹{breakdownTotal.toLocaleString("en-IN")}
                    </span>
                    <span />
                  </div>
                </div>
              )}

              {breakdownMismatch && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Components total (₹{breakdownTotal.toLocaleString("en-IN")}) doesn't match main amount (₹{amountNum.toLocaleString("en-IN")}). Adjust or remove components.
                </p>
              )}
              {breakdown.length === 0 && (
                <p className="text-[11px] text-white/25 px-1">
                  No components added. Click "+ Add Component" to itemise this fee (e.g. Tuition ₹2,500 + Library ₹500).
                </p>
              )}
            </div>


            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => setShowModal(false)} className="text-white/60">Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name || !feeType || !amount || breakdownMismatch}
                className="bg-cyan-600 hover:bg-cyan-500 text-white">
                {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Save Changes" : "Create Structure"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={delId !== null} onOpenChange={v => { if (!v) setDelId(null); }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Delete Fee Structure</DialogTitle></DialogHeader>
          <p className="text-white/60 text-sm">This structure will be permanently deleted. Existing fee records are not affected.</p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="ghost" onClick={() => setDelId(null)} className="text-white/60">Cancel</Button>
            <Button onClick={() => delId && deleteMut.mutate(delId)} disabled={deleteMut.isPending}
              className="bg-red-600 hover:bg-red-500 text-white gap-1">
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate Invoices Dialog */}
      <Dialog open={genTarget !== null} onOpenChange={v => { if (!v) { setGenTarget(null); setGenResult(null); } }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-cyan-400 flex items-center gap-2">
              <Printer className="w-5 h-5" /> Generate Invoices
            </DialogTitle>
          </DialogHeader>
          {genTarget && !genResult && (() => {
            // Active session is always the source of truth — resolved server-side too.
            const activeSess = sessions.find((x: any) => x.isActive) as any;
            const freq = genTarget.frequency;

            // Build period options from the active session's date range.
            const periodOptions: PeriodOption[] = activeSess
              ? periodsForSession(freq, String(activeSess.startDate ?? "").slice(0, 10), String(activeSess.endDate ?? "").slice(0, 10))
              : [];

            // Generate button is disabled when: no active session found, or (monthly/quarterly with no period picked).
            const needsPeriod = freq === "monthly" || freq === "quarterly";
            const canGenerate = !!activeSess && (!needsPeriod || !!genFeePeriodStart);

            return (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
                <p className="text-white font-semibold">{genTarget.name}</p>
                <p className="text-white/50 text-xs">
                  {genTarget.feeType} · {fmt(genTarget.amount)} / {FREQ[genTarget.frequency] ?? genTarget.frequency}
                </p>
              </div>

              {/* Academic Session — read-only, always the active session */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">Academic Session</label>
                {activeSess ? (
                  <div className="px-3 py-2 rounded-lg bg-[#0A1628] border border-white/10 text-sm text-white/80 flex items-center justify-between">
                    <span>{(activeSess as any).sessionName} (Active)</span>
                    <span className="text-[10px] text-white/30 ml-2">auto-selected</span>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-red-900/20 border border-red-700/30 text-xs text-red-400">
                    No active academic session found. Please activate a session first.
                  </div>
                )}
              </div>

              {/* Fee Period Picker — session-scoped, all months/quarters within the active session */}
              {needsPeriod && (
                <div>
                  <label className="text-xs text-white/60 mb-1 block">
                    Fee Period
                    <span className="ml-1.5 text-white/30">— all {freq === "monthly" ? "months" : "quarters"} in this session</span>
                  </label>
                  {!activeSess ? (
                    <div className="p-2 rounded-lg bg-amber-900/15 border border-amber-700/30 text-xs text-amber-400/80">
                      Activate an academic session to see available fee periods.
                    </div>
                  ) : (
                    <select
                      value={genFeePeriodStart}
                      onChange={e => {
                        const opt = periodOptions.find(o => o.start === e.target.value);
                        if (opt) { setGenFeePeriodStart(opt.start); setGenFeePeriodEnd(opt.end); }
                      }}
                      className="w-full bg-[#0A1628] border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      {periodOptions.length === 0 && <option value="">No periods available</option>}
                      {periodOptions.map(o => {
                        const today = new Date().toISOString().slice(0, 10);
                        const isCurrent = o.start <= today && o.end >= today;
                        const isPast    = o.end < today;
                        return (
                          <option key={o.start} value={o.start}>
                            {o.label}{isCurrent ? " ← current" : isPast ? " (past)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  <p className="text-indigo-400/60 text-[11px] mt-1">
                    This period is stored permanently on each invoice. You can backfill any missed period.
                  </p>
                </div>
              )}

              {genTarget.applicableClasses.length > 0 ? (
                <div className="p-3 rounded-lg bg-cyan-900/15 border border-cyan-700/30 space-y-1.5">
                  <p className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
                    <span>🎯</span> Strictly applies to these classes only
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {genTarget.applicableClasses.map(cls => (
                      <span key={cls} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-900/40 text-cyan-300 border border-cyan-700/40">
                        {cls}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/30 pt-0.5">
                    Invoices will only be generated for students enrolled in the above classes. This is set on the fee structure and cannot be changed here.
                  </p>
                </div>
              ) : (
                <p className="text-white/40 text-xs p-3 rounded-lg bg-white/5 border border-white/10">
                  No class restriction — invoices will be generated for{" "}
                  <span className="text-white/70 font-medium">all enrolled students</span> in the selected session.
                </p>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" onClick={() => setGenTarget(null)} className="text-white/60">Cancel</Button>
                <Button
                  onClick={() => genMut.mutate()}
                  disabled={genMut.isPending || !canGenerate}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white gap-1"
                >
                  {genMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Generate
                </Button>
              </div>
            </div>
          );
          })()}
          {genResult && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-900/20 border border-emerald-700/40 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                  <p className="text-emerald-400 font-semibold text-base leading-snug">
                    {genResult.created > 0
                      ? `${genResult.created} invoice${genResult.created !== 1 ? "s" : ""} created`
                      : genResult.synced > 0 ? "Invoices synced" : "No changes"}
                  </p>
                </div>
                <div className="divide-y divide-white/10 text-sm">
                  <div className="flex justify-between py-2">
                    <span className="text-white/60">New invoices created</span>
                    <span className="text-emerald-400 font-semibold">{genResult.created}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-white/60">Already existed · synced to latest amount</span>
                    <span className="text-cyan-400 font-semibold">{genResult.synced}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-white/60">Already up to date / settled — no change</span>
                    <span className="text-white/50 font-semibold">{genResult.skipped}</span>
                  </div>
                  {(genResult.total ?? 0) > 0 && (
                    <div className="flex justify-between py-2 border-t border-white/20">
                      <span className="text-white/80 font-medium">Eligible students in this run</span>
                      <span className="text-white font-bold">{genResult.total}</span>
                    </div>
                  )}
                  {(genResult.voided ?? 0) > 0 && (
                    <div className="flex justify-between py-2">
                      <span className="text-amber-400/80">Stale invoices cleaned up (no longer in scope)</span>
                      <span className="text-amber-400 font-semibold">{genResult.voided}</span>
                    </div>
                  )}
                </div>
              </div>
              <Button
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white"
                onClick={() => { setGenTarget(null); setGenResult(null); }}
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reminders / Notifications Tab ────────────────────────────────────────────

function KeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20"
      />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function RemindersTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Provider form state ──────────────────────────────────────────────────
  const [smsEnabled,        setSmsEnabled]        = useState(false);
  const [msg91AuthKey,      setMsg91AuthKey]       = useState("");
  const [msg91SenderId,     setMsg91SenderId]      = useState("");
  const [waEnabled,         setWaEnabled]          = useState(false);
  const [msg91WaNumber,     setMsg91WaNumber]      = useState("");
  const [msg91WaTemplate,   setMsg91WaTemplate]    = useState("");
  const [emailEnabled,      setEmailEnabled]       = useState(false);
  const [sgApiKey,          setSgApiKey]           = useState("");
  const [sgFromEmail,       setSgFromEmail]        = useState("");
  const [sgFromName,        setSgFromName]         = useState("");
  const [synced,            setSynced]             = useState(false);

  // Test notification state
  const [testChannel,  setTestChannel]  = useState<"sms" | "email" | "webhook">("webhook");
  const [testRecipient,setTestRecipient]= useState("");
  const [testOpen,     setTestOpen]     = useState(false);

  // Template editor state — keyed "stage|channel"
  const [templateDraft, setTemplateDraft] = useState<Record<string, { bodyText: string; subjectText: string }>>({});
  const [templatesSynced, setTemplatesSynced] = useState(false);
  const [activeTemplateStage, setActiveTemplateStage] = useState<string>("D+0");

  const { data: cfg, isLoading } = useQuery<NotifConfig | null>({
    queryKey: ["/api/admin/fees/notification-config"],
    staleTime: 60_000,
  });

  const { data: logEntries = [] } = useQuery<DunningLogEntry[]>({
    queryKey: ["/api/admin/fees/dunning-log"],
    staleTime: 30_000,
  });

  const { data: savedTemplates, isSuccess: templatesLoaded } = useQuery<DunningTemplateRow[]>({
    queryKey: ["/api/admin/fees/dunning-templates"],
    staleTime: 60_000,
  });

  // Job status — poll every 5s so the UI reflects live running state
  const { data: jobStatus } = useQuery<DunningJobStatusData>({
    queryKey: ["/api/admin/fees/dunning-job-status"],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/dunning-job-status");
      if (!r.ok) return { isRunning: false, startedAt: null, lastCompletedAt: null };
      return r.json();
    },
    staleTime: 0,
    refetchInterval: 5_000,
  });
  const jobRunning = jobStatus?.isRunning ?? false;

  useEffect(() => {
    if (cfg !== undefined && !synced) {
      if (cfg) {
        setSmsEnabled(cfg.smsEnabled);
        setMsg91AuthKey(cfg.msg91AuthKey ?? "");
        setMsg91SenderId(cfg.msg91SenderId ?? "");
        setWaEnabled(cfg.waEnabled);
        setMsg91WaNumber(cfg.msg91WaNumber ?? "");
        setMsg91WaTemplate(cfg.msg91WaTemplate ?? "");
        setEmailEnabled(cfg.emailEnabled);
        setSgApiKey(cfg.sendgridApiKey ?? "");
        setSgFromEmail(cfg.sendgridFromEmail ?? "");
        setSgFromName(cfg.sendgridFromName ?? "");
      }
      setSynced(true);
    }
  }, [cfg, synced]);

  // Default template texts shown before any school-specific override is saved
  const DEFAULT_SMS: Record<string, string> = {
    "D-2":  `Dear {guardian_name}, this is a reminder that {student_name}'s fee "{fee_name}" of Rs.{amount} is due on {due_date}. Please pay before the due date.`,
    "D+0":  `Dear {guardian_name}, {student_name}'s fee "{fee_name}" of Rs.{amount} is due today. Please pay promptly.`,
    "D+3":  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 3 days overdue. Please clear it at the earliest.`,
    "D+7":  `Reminder: {student_name}'s fee "{fee_name}" of Rs.{amount} is 7 days overdue. Please clear it immediately.`,
    "D+14": `FINAL NOTICE: {student_name}'s fee "{fee_name}" of Rs.{amount} is 14 days overdue. Please contact admin immediately.`,
  };
  const DEFAULT_EMAIL_SUBJECT: Record<string, string> = {
    "D-2":  "Upcoming Fee Due in 2 Days",
    "D+0":  "Fee Due Today",
    "D+3":  "Fee Reminder — 3 Days Overdue",
    "D+7":  "Fee Reminder — 7 Days Overdue",
    "D+14": "Final Notice — Fee 14 Days Overdue",
  };
  const DEFAULT_EMAIL_BODY: Record<string, string> = {
    "D-2":  `This is an advance reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due on {due_date}. Please ensure timely payment to avoid late fees.`,
    "D+0":  `This is a reminder that {student_name}'s fee "{fee_name}" of ₹{amount} is due today. Please pay to avoid late penalties.`,
    "D+3":  `{student_name}'s fee "{fee_name}" of ₹{amount} is 3 days overdue. Please clear the dues as soon as possible.`,
    "D+7":  `{student_name}'s fee "{fee_name}" of ₹{amount} is 7 days overdue. Please clear the dues immediately.`,
    "D+14": `FINAL NOTICE: {student_name}'s fee "{fee_name}" of ₹{amount} is 14 days overdue. Please contact the school admin without further delay.`,
  };

  useEffect(() => {
    // Only seed draft once the query has actually resolved (templatesLoaded = true).
    // Using the isSuccess flag prevents premature hydration before API data arrives,
    // which would seed defaults and silently ignore saved school-specific templates.
    if (!templatesSynced && templatesLoaded) {
      const rows = savedTemplates ?? [];
      const draft: Record<string, { bodyText: string; subjectText: string }> = {};
      for (const stage of ["D-2", "D+0", "D+3", "D+7", "D+14"]) {
        for (const channel of ["sms", "email"]) {
          const key = `${stage}|${channel}`;
          const saved = rows.find(t => t.stage === stage && t.channel === channel);
          draft[key] = {
            bodyText: saved?.bodyText ?? (channel === "sms" ? DEFAULT_SMS[stage] : DEFAULT_EMAIL_BODY[stage]),
            subjectText: saved?.subjectText ?? (channel === "email" ? DEFAULT_EMAIL_SUBJECT[stage] : ""),
          };
        }
      }
      setTemplateDraft(draft);
      setTemplatesSynced(true);
    }
  }, [templatesLoaded, templatesSynced, savedTemplates]);

  const saveTemplatesMut = useMutation({
    mutationFn: () => {
      const templates: Array<{ stage: string; channel: string; bodyText: string; subjectText: string | null }> = [];
      for (const [key, val] of Object.entries(templateDraft)) {
        const [stage, channel] = key.split("|");
        templates.push({
          stage,
          channel,
          bodyText: val.bodyText,
          subjectText: channel === "email" ? (val.subjectText || null) : null,
        });
      }
      return apiRequest("PUT", "/api/admin/fees/dunning-templates", { templates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/dunning-templates"] });
      toast({ title: "Message templates saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/notification-config", {
      smsEnabled, msg91AuthKey: msg91AuthKey || null, msg91SenderId: msg91SenderId || null,
      waEnabled, msg91WaNumber: msg91WaNumber || null, msg91WaTemplate: msg91WaTemplate || null,
      emailEnabled,
      sendgridApiKey: sgApiKey || null, sendgridFromEmail: sgFromEmail || null, sendgridFromName: sgFromName || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/notification-config"] });
      toast({ title: "Notification settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/fees/notification-config/test", { channel: testChannel, recipient: testRecipient }),
    onSuccess: () => toast({ title: "Test sent!", description: `Test ${testChannel} sent to ${testRecipient}` }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const DUNNING_ROWS = [
    { day: "D-2",  label: "2 Days Before Due",  note: "Early warning — remind parent before the due date.", icon: "📬" },
    { day: "D+0",  label: "On Due Date",         note: "Notify parent/guardian of the fee amount now due.", icon: "📅" },
    { day: "D+3",  label: "3 Days Overdue",      note: "First overdue nudge — prompt payment reminder.", icon: "📩" },
    { day: "D+7",  label: "7 Days Overdue",      note: "Escalation reminder — polite but firm.", icon: "⚠️" },
    { day: "D+14", label: "14 Days Overdue",     note: "Final notice — account may be flagged.", icon: "🚨" },
  ];

  const CHANNEL_ICONS: Record<string, React.ReactNode> = {
    sms:       <MessageSquare className="w-3.5 h-3.5" />,
    whatsapp:  <Phone className="w-3.5 h-3.5" />,
    email:     <Mail className="w-3.5 h-3.5" />,
  };
  const CHANNEL_COLORS: Record<string, string> = {
    sms:       "bg-blue-900/40 text-blue-300 border-blue-700/40",
    whatsapp:  "bg-green-900/40 text-green-300 border-green-700/40",
    email:     "bg-purple-900/40 text-purple-300 border-purple-700/40",
  };
  const STAGE_COLORS: Record<string, string> = {
    "D-2": "text-violet-400", "D+0": "text-cyan-400", "D+3": "text-green-400", "D+7": "text-amber-400", "D+14": "text-orange-400",
  };

  if (isLoading) return <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;

  const anyEnabled = smsEnabled || waEnabled || emailEnabled;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold">Automatic Reminder System</p>
          <p className="text-white/40 text-xs mt-0.5">Reminders are processed automatically every hour based on the configured schedule. No manual action is required.</p>
        </div>
        {anyEnabled && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 px-2.5 py-1 rounded-full">
            <Zap className="w-3 h-3" /> Active
          </span>
        )}
      </div>

      {/* ── Dunning job status row ── */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs ${
        jobRunning
          ? "bg-amber-900/20 border-amber-700/40 text-amber-300"
          : "bg-white/5 border-white/10 text-white/50"
      }`}>
        <div className="flex items-center gap-2">
          {jobRunning
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            : <Clock className="w-3.5 h-3.5 text-white/30" />
          }
          <span className="font-medium">
            {jobRunning
              ? "Automatic check running…"
              : jobStatus?.lastCompletedAt
                ? `Last automatic check: ${fmtDateTime(jobStatus.lastCompletedAt)} IST`
                : "Automatic check has not run yet"
            }
          </span>
        </div>
        {jobRunning
          ? jobStatus?.startedAt && <span className="text-amber-400/70">Started {fmtDateTime(jobStatus.startedAt)}</span>
          : <span className="text-white/30">Checks run every hour</span>
        }
      </div>

      {/* ── SMS Card ── */}
      <div className={`rounded-xl border p-4 space-y-3 transition-colors ${smsEnabled ? "border-blue-700/40 bg-blue-900/10" : "border-white/10 bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <span className="text-white font-medium text-sm">SMS via MSG91</span>
          </div>
          <Switch checked={smsEnabled} onCheckedChange={setSmsEnabled} disabled={isArchiveMode} />
        </div>
        {smsEnabled && (
          <div className="space-y-2 pt-1">
            <div>
              <p className="text-white/50 text-xs mb-1">MSG91 Auth Key</p>
              <KeyInput value={msg91AuthKey} onChange={setMsg91AuthKey} placeholder="Enter your MSG91 auth key" />
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">Sender ID <span className="text-white/30">(6 chars, e.g. SCHOOL)</span></p>
              <input value={msg91SenderId} onChange={e => setMsg91SenderId(e.target.value)} maxLength={6}
                placeholder="SCHOOL"
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20 uppercase" />
            </div>
          </div>
        )}
      </div>

      {/* ── WhatsApp Card ── */}
      <div className={`rounded-xl border p-4 space-y-3 transition-colors ${waEnabled ? "border-green-700/40 bg-green-900/10" : "border-white/10 bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-green-400" />
            <span className="text-white font-medium text-sm">WhatsApp via MSG91</span>
          </div>
          <Switch checked={waEnabled} onCheckedChange={setWaEnabled} disabled={isArchiveMode} />
        </div>
        {waEnabled && (
          <div className="space-y-2 pt-1">
            <div className="p-2.5 rounded-lg bg-amber-900/20 border border-amber-700/30">
              <p className="text-amber-300 text-xs">WhatsApp requires a <strong>pre-approved message template</strong> in your MSG91 dashboard. Your template must have 5 body parameters: <code>{"{{1}}"}</code> parent name, <code>{"{{2}}"}</code> student name, <code>{"{{3}}"}</code> fee name, <code>{"{{4}}"}</code> amount, <code>{"{{5}}"}</code> overdue status.</p>
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">MSG91 Auth Key <span className="text-white/30">(same as SMS if using same account)</span></p>
              <KeyInput value={msg91AuthKey} onChange={setMsg91AuthKey} placeholder="Enter your MSG91 auth key" />
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">Integrated WhatsApp Number <span className="text-white/30">(91XXXXXXXXXX)</span></p>
              <input value={msg91WaNumber} onChange={e => setMsg91WaNumber(e.target.value)}
                placeholder="91XXXXXXXXXX"
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
            </div>
            <div>
              <p className="text-white/50 text-xs mb-1">Approved Template Name</p>
              <input value={msg91WaTemplate} onChange={e => setMsg91WaTemplate(e.target.value)}
                placeholder="fee_reminder"
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
            </div>
          </div>
        )}
      </div>

      {/* ── Email Card ── */}
      <div className={`rounded-xl border p-4 space-y-3 transition-colors ${emailEnabled ? "border-purple-700/40 bg-purple-900/10" : "border-white/10 bg-white/5"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-purple-400" />
            <span className="text-white font-medium text-sm">Email</span>
          </div>
          <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} disabled={isArchiveMode} />
        </div>
        {emailEnabled && (
          <div className="space-y-2 pt-1">
            <div>
              <p className="text-white/50 text-xs mb-1">SendGrid API Key</p>
              <KeyInput value={sgApiKey} onChange={setSgApiKey} placeholder="SG.xxxxxxxxxxxx" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-white/50 text-xs mb-1">From Email</p>
                <input value={sgFromEmail} onChange={e => setSgFromEmail(e.target.value)}
                  placeholder="fees@school.edu"
                  className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
              </div>
              <div>
                <p className="text-white/50 text-xs mb-1">From Name</p>
                <input value={sgFromName} onChange={e => setSgFromName(e.target.value)}
                  placeholder="School Admin"
                  className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Save + Test ── */}
      {!isArchiveMode && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="bg-cyan-600 hover:bg-cyan-500 text-white">
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
            Save Settings
          </Button>
          {anyEnabled && (
            <Button variant="outline" onClick={() => setTestOpen(true)}
              className="border-white/20 text-white/70 hover:text-white hover:bg-white/5">
              <Send className="w-4 h-4 mr-1" /> Test Send
            </Button>
          )}
        </div>
      )}

      {/* ── Test Dialog ── */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="bg-[#0f1923] border border-white/10 text-white max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="w-4 h-4 text-cyan-400" /> Test Send</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">

            {/* Channel picker */}
            <div>
              <p className="text-white/50 text-xs mb-2">Choose channel</p>
              <div className="grid grid-cols-3 gap-2">
                {(["webhook", "sms", "email"] as const).map(ch => {
                  const labels: Record<string, string> = { webhook: "Webhook", sms: "SMS", email: "Email" };
                  const icons: Record<string, React.ReactNode> = {
                    webhook: <Zap className="w-3.5 h-3.5" />,
                    sms: <MessageSquare className="w-3.5 h-3.5" />,
                    email: <Mail className="w-3.5 h-3.5" />,
                  };
                  return (
                    <button key={ch} onClick={() => setTestChannel(ch)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition-colors ${testChannel === ch ? "bg-cyan-700/40 border-cyan-500/60 text-white" : "border-white/10 text-white/40 hover:text-white/70"}`}>
                      {icons[ch]}{labels[ch]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Webhook instructions */}
            {testChannel === "webhook" && (
              <div className="p-3 rounded-lg bg-cyan-900/20 border border-cyan-700/30 space-y-1.5">
                <p className="text-cyan-300 text-xs font-semibold">No API keys needed!</p>
                <p className="text-white/50 text-xs">
                  1. Open <span className="text-cyan-400 font-medium">webhook.site</span> in a new tab — you get a free unique URL instantly.<br />
                  2. Copy that URL and paste it below.<br />
                  3. Click Send — the server will POST the notification payload to your URL.<br />
                  4. Watch it arrive live at webhook.site.
                </p>
              </div>
            )}

            {/* Recipient input */}
            <div>
              <p className="text-white/50 text-xs mb-1">
                {testChannel === "webhook" ? "Webhook URL (from webhook.site)" :
                 testChannel === "email"   ? "Email address" :
                                             "Phone number (91XXXXXXXXXX)"}
              </p>
              <input value={testRecipient} onChange={e => setTestRecipient(e.target.value)}
                placeholder={
                  testChannel === "webhook" ? "https://webhook.site/your-unique-id" :
                  testChannel === "email"   ? "test@example.com" :
                                              "91XXXXXXXXXX"
                }
                className="w-full bg-[#0f1923] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60 placeholder:text-white/20" />
            </div>

            <Button className="w-full bg-cyan-600 hover:bg-cyan-500" onClick={() => testMut.mutate()} disabled={testMut.isPending || !testRecipient}>
              {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Send Test
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Message Templates ── */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">Message Templates</p>
            <p className="text-white/40 text-xs mt-0.5">Customise the text sent at each overdue stage. Supports variables: <code className="text-cyan-400 text-[10px]">{"{student_name}"}</code> <code className="text-cyan-400 text-[10px]">{"{guardian_name}"}</code> <code className="text-cyan-400 text-[10px]">{"{fee_name}"}</code> <code className="text-cyan-400 text-[10px]">{"{amount}"}</code> <code className="text-cyan-400 text-[10px]">{"{due_date}"}</code></p>
          </div>
          {!isArchiveMode && (
            <Button size="sm" onClick={() => saveTemplatesMut.mutate()} disabled={saveTemplatesMut.isPending}
              className="bg-cyan-700 hover:bg-cyan-600 text-white text-xs h-8 px-3">
              {saveTemplatesMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              Save Templates
            </Button>
          )}
        </div>

        {/* Stage tabs */}
        <div className="flex gap-1 flex-wrap">
          {[
            { key: "D-2",  label: "D−2",  color: "text-violet-400", border: "border-violet-500/60" },
            { key: "D+0",  label: "D+0",  color: "text-cyan-400",   border: "border-cyan-500/60" },
            { key: "D+3",  label: "D+3",  color: "text-green-400",  border: "border-green-500/60" },
            { key: "D+7",  label: "D+7",  color: "text-amber-400",  border: "border-amber-500/60" },
            { key: "D+14", label: "D+14", color: "text-orange-400", border: "border-orange-500/60" },
          ].map(({ key, label, color, border }) => (
            <button key={key} onClick={() => setActiveTemplateStage(key)}
              className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${activeTemplateStage === key ? `${color} ${border} bg-white/5` : "text-white/40 border-white/10 hover:text-white/70"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* SMS template */}
        {templatesSynced && (
          <div className="space-y-3">
            {/* SMS */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-white/70 text-xs font-medium">SMS Body</span>
              </div>
              <textarea
                rows={3}
                value={templateDraft[`${activeTemplateStage}|sms`]?.bodyText ?? ""}
                onChange={e => setTemplateDraft(d => ({
                  ...d,
                  [`${activeTemplateStage}|sms`]: { ...d[`${activeTemplateStage}|sms`], bodyText: e.target.value },
                }))}
                disabled={isArchiveMode}
                className="w-full bg-[#0f1923] border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/50 placeholder:text-white/20 resize-y disabled:opacity-50"
              />
            </div>

            {/* Email */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Mail className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-white/70 text-xs font-medium">Email</span>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-white/40 text-[10px] mb-1">Subject line</p>
                  <input
                    value={templateDraft[`${activeTemplateStage}|email`]?.subjectText ?? ""}
                    onChange={e => setTemplateDraft(d => ({
                      ...d,
                      [`${activeTemplateStage}|email`]: { ...d[`${activeTemplateStage}|email`], subjectText: e.target.value },
                    }))}
                    disabled={isArchiveMode}
                    className="w-full bg-[#0f1923] border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 placeholder:text-white/20 disabled:opacity-50"
                  />
                </div>
                <div>
                  <p className="text-white/40 text-[10px] mb-1">Message body</p>
                  <textarea
                    rows={3}
                    value={templateDraft[`${activeTemplateStage}|email`]?.bodyText ?? ""}
                    onChange={e => setTemplateDraft(d => ({
                      ...d,
                      [`${activeTemplateStage}|email`]: { ...d[`${activeTemplateStage}|email`], bodyText: e.target.value },
                    }))}
                    disabled={isArchiveMode}
                    className="w-full bg-[#0f1923] border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 placeholder:text-white/20 resize-y disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
              <p className="text-white/30 text-[10px]">WhatsApp uses a pre-approved MSG91 template (configured above) — its body text is managed in your MSG91 dashboard and cannot be customised here.</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Dunning schedule ── */}
      <div>
        <p className="text-white font-semibold mb-3">Automated Dunning Schedule</p>
        <div className="space-y-2">
          {DUNNING_ROWS.map(r => {
            const stage = r.day.replace("+", "");
            return (
              <div key={r.day} className="flex items-center gap-4 p-3.5 rounded-xl border border-white/10 bg-white/5">
                <span className="text-xl w-7 text-center flex-shrink-0">{r.icon}</span>
                <div className="w-12 flex-shrink-0 text-center">
                  <p className={`text-xs font-bold ${STAGE_COLORS[stage] ?? "text-cyan-400"}`}>{r.day}</p>
                </div>
                <div className="h-5 w-px bg-white/10 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{r.label}</p>
                  <p className="text-white/40 text-xs mt-0.5">{r.note}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {smsEnabled    && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border bg-blue-900/30 text-blue-300 border-blue-700/30"><MessageSquare className="w-3 h-3" /></span>}
                  {waEnabled     && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border bg-green-900/30 text-green-300 border-green-700/30"><Phone className="w-3 h-3" /></span>}
                  {emailEnabled  && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border bg-purple-900/30 text-purple-300 border-purple-700/30"><Mail className="w-3 h-3" /></span>}
                  {!anyEnabled   && <span className="text-white/20 text-xs">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Delivery log ── */}
      <div>
        <p className="text-white font-semibold mb-3">Recent Deliveries <span className="text-white/30 text-xs font-normal">(last 50)</span></p>
        {logEntries.length === 0 ? (
          <div className="text-center py-10 text-white/30 text-sm border border-white/5 rounded-xl bg-white/5">
            No notifications sent yet. They will appear here once the dunning job fires.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/10 bg-white/5">
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Student</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Channel</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Stage</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Recipient</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Sent</th>
                <th className="px-3 py-2.5 text-left text-white/50 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {logEntries.map((l, i) => (
                  <tr key={l.id} className={`border-b border-white/5 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                    <td className="px-3 py-2 text-white/80">{l.studentName ?? `Fee #${l.feeRecordId}`}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${CHANNEL_COLORS[l.channel] ?? "text-white/50 border-white/10"}`}>
                        {CHANNEL_ICONS[l.channel]} {l.channel}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-bold ${STAGE_COLORS[l.stage] ?? "text-white/60"}`}>{l.stage}</td>
                    <td className="px-3 py-2 text-white/50 truncate max-w-[120px]">{l.recipient ?? "—"}</td>
                    <td className="px-3 py-2 text-white/40">{fmtDateTime(l.sentAt)}</td>
                    <td className="px-3 py-2">
                      {l.status === "sent" ? (
                        <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> sent</span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1" title={l.errorMessage ?? ""}><AlertTriangle className="w-3 h-3" /> failed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── External Portal Tab ──────────────────────────────────────────────────────

function ExternalPortalTab({ isArchiveMode }: { isArchiveMode: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Razorpay state (production / live only — no test mode) ────────────────
  // Draft values survive a mobile page-reload (switching apps to copy a key).
  // They are cleared from localStorage after a successful Save.
  const [rzpEnabled, setRzpEnabled] = useState(false);
  const [rzpKeyId, setRzpKeyId] = useState(() => localStorage.getItem("rzp_draft_key_id") ?? "");
  const [rzpKeySecret, setRzpKeySecret] = useState(() => localStorage.getItem("rzp_draft_key_secret") ?? "");
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState(() => localStorage.getItem("rzp_draft_webhook_secret") ?? "");
  const [showWebhookEvents, setShowWebhookEvents] = useState(false);

  const saveKeyIdDraft     = (v: string) => { setRzpKeyId(v);         v && v !== "••••••••" ? localStorage.setItem("rzp_draft_key_id", v) : localStorage.removeItem("rzp_draft_key_id"); };
  const saveSecretDraft    = (v: string) => { setRzpKeySecret(v);     v && v !== "••••••••" ? localStorage.setItem("rzp_draft_key_secret", v)     : localStorage.removeItem("rzp_draft_key_secret"); };
  const saveWebhookDraft   = (v: string) => { setRzpWebhookSecret(v); v && v !== "••••••••" ? localStorage.setItem("rzp_draft_webhook_secret", v) : localStorage.removeItem("rzp_draft_webhook_secret"); };
  const clearDrafts        = () => { localStorage.removeItem("rzp_draft_key_id"); localStorage.removeItem("rzp_draft_key_secret"); localStorage.removeItem("rzp_draft_webhook_secret"); };

  // ── External portal state ──────────────────────────────────────────────────
  const [isEnabled, setIsEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [banner, setBanner] = useState("");
  const [maxOvercollectionPercent, setMaxOvercollectionPercent] = useState(150);

  const [synced, setSynced] = useState(false);

  // ── Fee receipt signature state ────────────────────────────────────────────
  const [selectedSigFile, setSelectedSigFile]           = useState<File | null>(null);
  const [sigPreviewUrl, setSigPreviewUrl]               = useState<string | null>(null);
  const [sigUploading, setSigUploading]                 = useState(false);
  const [sigRemoving, setSigRemoving]                   = useState(false);
  const [showSigConfirmRemove, setShowSigConfirmRemove] = useState(false);
  const sigFileRef = React.useRef<HTMLInputElement>(null);

  const { data: settings, isLoading } = useQuery<ExternalSettings>({
    queryKey: ["/api/admin/fees/external-settings"],
    staleTime: 60_000,
  });

  useEffect(() => {
    if (settings && !synced) {
      setRzpEnabled(settings.razorpayEnabled ?? false);
      // Only restore from server when there is no in-progress draft (draft wins).
      if (!localStorage.getItem("rzp_draft_key_id"))     setRzpKeyId(settings.razorpayKeyId ?? "");
      if (!localStorage.getItem("rzp_draft_key_secret"))  setRzpKeySecret(settings.razorpayKeySecret ?? "");
      if (!localStorage.getItem("rzp_draft_webhook_secret")) setRzpWebhookSecret(settings.razorpayWebhookSecret ?? "");
      setIsEnabled(settings.isEnabled);
      setUrl(settings.gatewayUrl ?? "");
      setBanner(settings.bannerMessage ?? "");
      setMaxOvercollectionPercent(settings.maxOvercollectionPercent ?? 150);
      setSynced(true);
    }
  }, [settings, synced]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/external-settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
  };

  // ── Fee receipt signature handlers ────────────────────────────────────────
  const handleSigFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported format", description: "Please choose a PNG, JPG, or WebP image.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum allowed size is 2 MB.", variant: "destructive" });
      return;
    }
    if (sigPreviewUrl) URL.revokeObjectURL(sigPreviewUrl);
    setSigPreviewUrl(URL.createObjectURL(file));
    setSelectedSigFile(file);
    setShowSigConfirmRemove(false);
  };

  // Safe JSON parse helper — never throws even if server returns HTML or empty body
  const parseJsonResponse = async (res: Response): Promise<any> => {
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 120) }; }
  };

  const handleSigSave = async () => {
    if (!selectedSigFile) return;
    setSigUploading(true);
    try {
      const form = new FormData();
      form.append("file", selectedSigFile, selectedSigFile.name);
      const res = await fetch("/api/admin/fees/external-portal/signature", {
        method: "POST", body: form, credentials: "include",
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || json.message || `Upload failed (${res.status})`);
      toast({ title: "Signature saved successfully." });
      if (sigPreviewUrl) { URL.revokeObjectURL(sigPreviewUrl); setSigPreviewUrl(null); }
      setSelectedSigFile(null);
      setSynced(false);   // force re-sync from server so preview shows processed version
      invalidate();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setSigUploading(false);
    }
  };

  const handleSigRemove = async () => {
    setSigRemoving(true);
    try {
      const res = await fetch("/api/admin/fees/external-portal/signature", {
        method: "DELETE", credentials: "include",
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || json.message || `Remove failed (${res.status})`);
      toast({ title: "Signature removed." });
      setShowSigConfirmRemove(false);
      if (sigPreviewUrl) { URL.revokeObjectURL(sigPreviewUrl); setSigPreviewUrl(null); }
      setSelectedSigFile(null);
      setSynced(false);
      invalidate();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSigRemoving(false);
    }
  };

  // ── Razorpay save mutation (live mode only) ────────────────────────────────
  const rzpMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings/razorpay", {
      razorpayEnabled: rzpEnabled,
      razorpayKeyId:   rzpKeyId || null,
      razorpayKeySecret:     rzpKeySecret || null,
      razorpayWebhookSecret: rzpWebhookSecret || null,
    }),
    onSuccess: (data: any) => {
      invalidate();
      clearDrafts(); // wipe localStorage drafts — server is now the source of truth
      if (data) {
        setRzpKeySecret(data.razorpayKeySecret ?? "");
        setRzpWebhookSecret(data.razorpayWebhookSecret ?? "");
      }
      toast({ title: "✅ Razorpay settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Portal link save mutation ──────────────────────────────────────────────
  const portalMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/admin/fees/external-settings/portal", {
      isEnabled,
      gatewayUrl:               url || null,
      bannerMessage:            banner || null,
      maxOvercollectionPercent,
    }),
    onSuccess: () => {
      invalidate();
      toast({ title: "✅ External portal settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-white/40">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );

  const rzpConfigured = !!(settings?.razorpayKeyId && settings?.razorpayKeySecret);

  return (
    <div className="space-y-6 max-w-xl">

      {/* ══ SECTION 1 — Razorpay Gateway ══════════════════════════════════════ */}
      <div className="rounded-2xl border border-blue-700/30 bg-blue-900/10 overflow-hidden">
        {/* Section header */}
        <div className="px-5 py-4 border-b border-blue-700/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#528FF0,#2D6EE8)" }}>
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white font-bold flex items-center gap-2">
                Razorpay Gateway
                {rzpConfigured
                  ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ CONFIGURED</span>
                  : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">NOT SET UP</span>
                }
              </p>
              <p className="text-white/40 text-xs mt-0.5">Accept UPI, cards, net banking & wallets in the student portal.</p>
            </div>
          </div>
          <Switch checked={rzpEnabled} onCheckedChange={setRzpEnabled} disabled={isArchiveMode} />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Mode badge — auto-detected from key prefix */}
          {rzpKeyId.startsWith("rzp_test_") ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-600/15 border border-amber-500/30">
              <span className="text-amber-400 text-sm">🧪</span>
              <span className="text-amber-300 text-xs font-bold">Test / Sandbox Mode</span>
              <span className="ml-auto text-amber-500/70 text-[10px]">No real money charged</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/15 border border-emerald-500/30">
              <span className="text-emerald-400 text-sm">🚀</span>
              <span className="text-emerald-300 text-xs font-bold">Production / Live Mode</span>
              <span className="ml-auto text-emerald-500/70 text-[10px]">Real payments accepted</span>
            </div>
          )}

          {/* Wipe credentials button */}
          {(rzpKeyId || rzpKeySecret === "••••••••" || rzpWebhookSecret === "••••••••") && !isArchiveMode && (
            <button
              onClick={() => {
                const ok = window.confirm(
                  "Wipe ALL Razorpay credentials?\n\n" +
                  "Key ID, Key Secret, and Webhook Secret will be permanently removed and Razorpay will be disabled. " +
                  "This cannot be undone."
                );
                if (!ok) return;
                apiRequest("DELETE", "/api/admin/fees/external-settings/razorpay/credentials")
                  .then(() => {
                    setRzpKeyId("");
                    setRzpKeySecret("");
                    setRzpWebhookSecret("");
                    setRzpEnabled(false);
                    clearDrafts(); // also wipe localStorage so drafts don't resurrect on next reload
                    queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/external-settings"] });
                    setSynced(false);
                    toast({ title: "Credentials wiped", description: "All Razorpay keys have been removed." });
                  })
                  .catch(() => toast({ title: "Error wiping credentials", variant: "destructive" }));
              }}
              className="w-full py-2 rounded-xl text-xs font-bold border border-red-700/40 bg-red-900/10 text-red-400 hover:bg-red-900/20 transition-all">
              🗑️ Clear All Credentials
            </button>
          )}

          {/* Key ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Key ID <span className="text-red-400">*</span></label>
            <input value={rzpKeyId} onChange={e => saveKeyIdDraft(e.target.value)}
              placeholder="rzp_live_… or rzp_test_…"
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
          </div>

          {/* Key Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Key Secret <span className="text-red-400">*</span></label>
            <input type="password" value={rzpKeySecret} onChange={e => saveSecretDraft(e.target.value)}
              placeholder={rzpKeySecret === "••••••••" ? "Leave blank to keep existing secret" : "Enter Key Secret…"}
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40" />
            <p className="text-white/25 text-[11px]">Stored server-side only — never exposed to the browser after saving.</p>
          </div>

          {/* Webhook Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60">Webhook Secret <span className="text-red-400">*</span></label>
            <input type="password" value={rzpWebhookSecret} onChange={e => saveWebhookDraft(e.target.value)}
              placeholder={rzpWebhookSecret === "••••••••" ? "Leave blank to keep existing secret" : "Enter Webhook Secret…"}
              disabled={isArchiveMode}
              className={`w-full bg-[#0F1E35] border rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-white/20 disabled:opacity-40 ${!rzpWebhookSecret ? "border-red-500/50" : "border-white/10"}`} />
            <div className="space-y-1">
              <p className="text-white/25 text-[11px]">
                Register this URL in Razorpay Dashboard → Webhooks →{" "}
                <span className="font-mono text-blue-400/70">/api/webhooks/razorpay</span> → enable{" "}
                <button
                  type="button"
                  onClick={() => setShowWebhookEvents(v => !v)}
                  className="inline-flex items-center gap-0.5 font-mono text-blue-400/80 hover:text-blue-300 transition-colors underline underline-offset-2 cursor-pointer"
                >
                  15 events
                  <svg className={`w-2.5 h-2.5 transition-transform ${showWebhookEvents ? "rotate-180" : ""}`} fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 3.5l3 3 3-3" />
                  </svg>
                </button>
              </p>
              {showWebhookEvents && (
                <div className="mt-1.5 rounded-xl border border-blue-500/20 bg-blue-950/30 p-3 space-y-2">
                  {[
                    { label: "Core payments", events: ["payment.captured", "payment.failed", "payment.authorized"] },
                    { label: "Refunds", events: ["refund.created", "refund.processed", "refund.failed"] },
                    { label: "Disputes", events: ["payment.dispute.created", "payment.dispute.action_required", "payment.dispute.won", "payment.dispute.lost", "payment.dispute.closed", "payment.dispute.under_review"] },
                    { label: "Downtime alerts", events: ["payment.downtime.started", "payment.downtime.updated", "payment.downtime.resolved"] },
                  ].map(group => (
                    <div key={group.label}>
                      <p className="text-[11px] font-bold text-white/70 uppercase tracking-wider mb-1.5">{group.label}</p>
                      <div className="flex flex-wrap gap-1">
                        {group.events.map(e => (
                          <span key={e} className="font-mono text-[11px] bg-blue-900/50 text-blue-200 border border-blue-400/30 rounded px-1.5 py-0.5">{e}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-white/50 pt-2 border-t border-white/10">All others (order.paid, invoice.*, settlement.*, account.*, payment_link.*) can be left disabled.</p>
                </div>
              )}
            </div>
          </div>

          {rzpEnabled && !rzpConfigured && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <Shield className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-400/90 text-xs leading-relaxed">
                Enter and save Key ID + Key Secret before enabling. Students cannot pay until both are saved.
              </p>
            </div>
          )}

          {!rzpWebhookSecret && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25">
              <Shield className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400/90 text-xs leading-relaxed">
                Webhook Secret is required. Copy it from Razorpay Dashboard → Webhooks → your webhook → Secret. Without it, payment confirmations cannot be verified.
              </p>
            </div>
          )}

          {!isArchiveMode && (
            <Button onClick={() => rzpMut.mutate()} disabled={rzpMut.isPending || !rzpWebhookSecret}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">
              {rzpMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : "Save Razorpay Settings"}
            </Button>
          )}
        </div>
      </div>

      {/* ══ SECTION 2 — External Portal Link ══════════════════════════════════ */}
      <div className="rounded-2xl border border-white/10 bg-[#1A2942] overflow-hidden">
        {/* Section header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)" }}>
              <ExternalLink className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white font-bold">External Payment Portal</p>
              <p className="text-white/40 text-xs mt-0.5">Show a third-party payment link to students (Instamojo, PayU, etc.).</p>
            </div>
          </div>
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} disabled={isArchiveMode} />
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Gateway / Portal URL
            </label>
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://pay.yourschool.edu/fees"
              disabled={isArchiveMode}
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 disabled:opacity-40" />
          </div>

          {/* Banner message */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-white/60 flex items-center gap-1">
              <Bell className="w-3 h-3" /> Banner Message (shown to students)
            </label>
            <textarea value={banner} onChange={e => setBanner(e.target.value)} rows={3}
              disabled={isArchiveMode}
              placeholder="Pay your fees online at the link below. For queries, contact the accounts office."
              className="w-full bg-[#0F1E35] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 placeholder:text-white/20 resize-none disabled:opacity-40" />
            <p className="text-white/25 text-xs text-right">{banner.length}/500</p>
          </div>

          {/* Over-collection cap */}
          <div className="p-3.5 rounded-xl border border-amber-700/25 bg-amber-900/10 space-y-2.5">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" /> Max Over-collection Cap
            </p>
            <p className="text-white/40 text-xs leading-relaxed">
              Payments that would bring total collected above this % of the invoice are blocked. Default 150%.
            </p>
            <div className="flex items-center gap-3">
              <input type="number" min={100} max={500} step={1}
                value={maxOvercollectionPercent}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setMaxOvercollectionPercent(Math.min(500, Math.max(100, v)));
                }}
                disabled={isArchiveMode}
                className="w-24 bg-[#0F1E35] border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-amber-500 disabled:opacity-40" />
              <span className="text-white/60 text-sm">%</span>
              <span className="text-white/30 text-xs">Range: 100–500%</span>
            </div>
          </div>

          {/* Preview */}
          {(isEnabled || banner) && (
            <div className="space-y-1.5">
              <p className="text-white/40 text-xs uppercase tracking-widest font-semibold">Student Portal Preview</p>
              <div className="p-4 rounded-xl border border-cyan-700/30 bg-cyan-900/10">
                <p className="text-cyan-400 text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> Pay Fees Online
                </p>
                {banner && <p className="text-white/60 text-xs mt-2 leading-relaxed">{banner}</p>}
                {isEnabled && url
                  ? <a href={url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-cyan-400 text-xs underline">
                      <ExternalLink className="w-3 h-3" /> {url}
                    </a>
                  : isEnabled && <p className="text-white/25 text-xs mt-2">No gateway URL configured yet.</p>}
              </div>
            </div>
          )}

          {!isArchiveMode && (
            <Button onClick={() => portalMut.mutate()} disabled={portalMut.isPending}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl py-2.5">
              {portalMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving…</> : "Save Portal Settings"}
            </Button>
          )}
        </div>
      </div>

      {/* ══ SECTION 3 — Fee Receipt Signature ═══════════════════════════════════ */}
      <div className="rounded-2xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)" }}>
            <PenLine className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-bold">Fee Receipt Signature</p>
            <p className="text-white/40 text-xs mt-0.5">Upload the authorized signature that will appear on student fee receipts.</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Hidden file input */}
          <input
            ref={sigFileRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={handleSigFilePick}
          />

          {/* Preview / empty state */}
          {(sigPreviewUrl || settings?.feeReceiptSignatureUrl) ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-[#0F1E35] flex items-center justify-center overflow-hidden p-4" style={{ minHeight: 100 }}>
                <img
                  src={sigPreviewUrl ?? settings?.feeReceiptSignatureUrl ?? ""}
                  alt="Fee receipt signature"
                  className="max-h-20 max-w-full object-contain"
                  style={{ imageRendering: "crisp-edges" }}
                />
              </div>
              {selectedSigFile && (
                <p className="text-xs text-purple-400 font-medium">
                  📎 {selectedSigFile.name} — click &ldquo;Save Signature&rdquo; to apply
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                {!isArchiveMode && (
                  <button type="button" onClick={() => sigFileRef.current?.click()}
                    disabled={sigUploading || sigRemoving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/15 text-white/70 hover:text-white hover:bg-white/5 transition-all disabled:opacity-40">
                    <Upload className="w-3.5 h-3.5" /> Replace Signature
                  </button>
                )}
                {!isArchiveMode && (settings?.feeReceiptSignatureUrl || sigPreviewUrl) && (
                  <button type="button" onClick={() => setShowSigConfirmRemove(true)}
                    disabled={sigRemoving || sigUploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-700/30 text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" /> Remove Signature
                  </button>
                )}
              </div>
            </div>
          ) : (
            !isArchiveMode && (
              <button type="button" onClick={() => sigFileRef.current?.click()}
                disabled={sigUploading}
                className="w-full border-2 border-dashed border-white/15 rounded-xl py-8 flex flex-col items-center gap-3 hover:border-purple-500/40 hover:bg-purple-900/10 transition-all group disabled:opacity-40">
                <div className="w-10 h-10 rounded-xl bg-purple-900/30 border border-purple-500/25 flex items-center justify-center group-hover:bg-purple-900/50 transition-all">
                  <Upload className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-center">
                  <p className="text-white/70 text-sm font-semibold">Upload Authorized Signature</p>
                  <p className="text-white/30 text-xs mt-1">Click to select a file</p>
                </div>
              </button>
            )
          )}

          {/* Confirm removal inline dialog */}
          {showSigConfirmRemove && (
            <div className="p-3.5 rounded-xl border border-red-700/30 bg-red-900/10 space-y-2.5">
              <p className="text-red-400 text-xs font-semibold">Remove the fee receipt signature permanently?</p>
              <div className="flex gap-2">
                <button type="button" onClick={handleSigRemove} disabled={sigRemoving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-700/30 text-red-300 hover:bg-red-700/50 transition-all disabled:opacity-50">
                  {sigRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Yes, Remove
                </button>
                <button type="button" onClick={() => setShowSigConfirmRemove(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/50 hover:text-white/80 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Save staged file */}
          {selectedSigFile && !isArchiveMode && (
            <button type="button" onClick={handleSigSave} disabled={sigUploading}
              className="w-full py-2.5 rounded-xl text-sm font-bold bg-purple-700 hover:bg-purple-600 text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {sigUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Signature
            </button>
          )}

          {/* Requirements block */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 space-y-1.5">
            <p className="text-white/60 text-xs font-semibold tracking-wide uppercase">Signature Image Requirements</p>
            <p className="text-white/50 text-xs leading-relaxed">
              For a clean and professional appearance on student fee receipts, please upload your signature
              with a <span className="text-white/75 font-medium">transparent background</span>. If your signature has a
              white or coloured background, remove the background before uploading.
            </p>
            <p className="text-white/30 text-[11px] pt-0.5">
              Accepted: PNG, JPG, WEBP &bull; Max 2 MB
            </p>
            <p className="text-purple-400/60 text-[11px]">Recommended: PNG with transparent background</p>
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-purple-900/15 border border-purple-700/20">
            <span className="text-purple-400 text-xs leading-none mt-0.5">ℹ️</span>
            <p className="text-purple-300/70 text-xs leading-relaxed">
              This signature will appear on the student fee receipt as the Authorized Accounts Signatory.
            </p>
          </div>
        </div>
      </div>

      {/* ── Data Maintenance ─────────────────────────────────────────────── */}
      <BackfillReceiptsSection />
    </div>
  );
}

// ─── Backfill Receipts Section ────────────────────────────────────────────────
// Assigns AF/OP receipt numbers to any fee/payment records that pre-date the
// receipt system.  Safe to run multiple times — already-numbered rows are skipped.

function BackfillReceiptsSection() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ feeRecordsUpdated: number; paymentRecordsUpdated: number; afRange: string | null; opRange: string | null } | null>(null);
  const [alreadyRunning, setAlreadyRunning] = useState(false);

  const backfillMut = useMutation({
    mutationFn: async () => {
      setAlreadyRunning(false);
      const r = await sessionFetch("/api/admin/fees/backfill-receipts", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (r.status === 409) {
        const err: any = new Error(body.message ?? "Backfill already running");
        err.alreadyRunning = true;
        throw err;
      }
      if (!r.ok) {
        throw new Error(body.message ?? "Backfill failed");
      }
      return body as { feeRecordsUpdated: number; paymentRecordsUpdated: number; afRange: string | null; opRange: string | null; message: string };
    },
    onSuccess: (data) => {
      setResult({ feeRecordsUpdated: data.feeRecordsUpdated, paymentRecordsUpdated: data.paymentRecordsUpdated, afRange: data.afRange ?? null, opRange: data.opRange ?? null });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
      toast({ title: "Receipt backfill complete", description: data.message });
    },
    onError: (e: any) => {
      if (e.alreadyRunning) {
        setAlreadyRunning(true);
      } else {
        toast({ title: "Backfill failed", description: e.message, variant: "destructive" });
      }
    },
  });

  return (
    <div className="p-4 rounded-xl border border-amber-700/30 bg-amber-900/10 space-y-3">
      <div>
        <p className="text-white font-semibold flex items-center gap-2">
          <Receipt className="w-4 h-4 text-amber-400" /> Assign Missing Receipt Numbers
        </p>
        <p className="text-white/40 text-xs mt-0.5 leading-relaxed">
          Fee and payment records created before the receipt system was added show "—" in the Receipt column.
          Run this once to assign sequential AF/OP numbers to all such records. Safe to run multiple times.
        </p>
      </div>

      {result && !alreadyRunning && (
        <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-3 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Done — {result.feeRecordsUpdated} fee record{result.feeRecordsUpdated !== 1 ? "s" : ""} and{" "}
              {result.paymentRecordsUpdated} payment record{result.paymentRecordsUpdated !== 1 ? "s" : ""} updated.
              {result.feeRecordsUpdated === 0 && result.paymentRecordsUpdated === 0 && " All records already have receipt numbers."}
            </span>
          </div>
          {(result.afRange || result.opRange) && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-5 text-emerald-300/80 font-mono">
              {result.afRange && (
                <span>Fee receipts: <span className="font-semibold text-emerald-300">{result.afRange}</span></span>
              )}
              {result.opRange && (
                <span>Payment receipts: <span className="font-semibold text-emerald-300">{result.opRange}</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {alreadyRunning && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
          <span>Another admin is running the backfill. Please wait a moment and try again.</span>
        </div>
      )}

      <Button
        onClick={() => backfillMut.mutate()}
        disabled={backfillMut.isPending}
        variant="outline"
        className="border-amber-600/50 text-amber-300 hover:bg-amber-900/30 hover:text-amber-200 bg-transparent text-xs h-8"
      >
        {backfillMut.isPending
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Running backfill…</>
          : <><Receipt className="w-3.5 h-3.5 mr-1.5" /> Run Receipt Backfill</>}
      </Button>
    </div>
  );
}

const AUDIT_ACTION_OPTIONS = [
  { value: "",               label: "All actions" },
  { value: "create",         label: "create" },
  { value: "update",         label: "update" },
  { value: "delete",         label: "delete" },
  { value: "payment",        label: "payment" },
  { value: "settings_change",label: "settings_change" },
  { value: "waiver",         label: "waiver" },
  { value: "auto_invoice",   label: "auto_invoice" },
  { value: "blocked_payment",label: "blocked_payment" },
  { value: "payment_failed", label: "payment_failed" },
  { value: "status_change",  label: "status_change" },
];
function AuditTab() {
  const PAGE = 20;
  const [page, setPage] = useState(0);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [searchTerm, setSearchTerm]     = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Reset to page 0 when filters change
  const handleFromDate     = (v: string) => { setFromDate(v); setPage(0); };
  const handleToDate       = (v: string) => { setToDate(v);   setPage(0); };
  const handleActionFilter = (v: string) => { setActionFilter(v); setPage(0); };
  const handleSearchTerm   = (v: string) => { setSearchTerm(v);   setPage(0); };
  const clearFilters       = () => { setFromDate(""); setToDate(""); setActionFilter(""); setSearchTerm(""); setPage(0); };

  const hasFilter = fromDate || toDate || actionFilter || searchTerm;

  const { data, isLoading } = useQuery<{ entries: AuditLogEntry[]; total: number }>({
    queryKey: ["/api/admin/fees/audit-log", page, fromDate, toDate, actionFilter, searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
      if (fromDate)     params.set("from",   fromDate);
      if (toDate)       params.set("to",     toDate);
      if (actionFilter) params.set("action", actionFilter);
      if (searchTerm)   params.set("search", searchTerm);
      const r = await fetch(`/api/admin/fees/audit-log?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 15_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE) : 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-white/30 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by student name…"
            value={searchTerm}
            onChange={e => handleSearchTerm(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs placeholder:text-white/25 focus:outline-none focus:border-cyan-500/50 w-52"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-white/40 text-xs whitespace-nowrap">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => handleFromDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500/50 [color-scheme:dark]"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-white/40 text-xs whitespace-nowrap">To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => handleToDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500/50 [color-scheme:dark]"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-white/40 text-xs whitespace-nowrap">Action</label>
          <select
            value={actionFilter}
            onChange={e => handleActionFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500/50 [color-scheme:dark]"
          >
            {AUDIT_ACTION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {hasFilter && (
          <button
            onClick={clearFilters}
            className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2 transition-colors">
            Clear filters
          </button>
        )}
        <p className="text-white/30 text-xs ml-auto">
          {data ? `${data.total} entr${data.total !== 1 ? "ies" : "y"}${hasFilter ? " matching filter" : ""}` : "…"}
        </p>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="h-7 px-2 text-white/50">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-white/40 text-xs">{page + 1} / {totalPages || 1}</span>
        <Button size="sm" variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="h-7 px-2 text-white/50">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : !data?.entries.length ? (
        <div className="text-center py-16 text-white/30">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">{hasFilter ? "No entries match the selected date range." : "No audit entries yet. Actions in this module will appear here."}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {["Timestamp","Actor","Action","Description","IP"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/50 font-medium text-xs">{h}</th>
                  ))}
                  <th className="px-2 py-3 w-6" />
                </tr>
              </thead>
              <tbody>
                {data.entries.map(e => {
                  const isExpanded = expandedRow === e.id;
                  const hasDesc = !!e.description;
                  return (
                    <React.Fragment key={e.id}>
                      <tr
                        onClick={() => hasDesc && setExpandedRow(isExpanded ? null : e.id)}
                        className={`border-b transition-colors ${e.action === "payment_failed" ? "border-red-900/30" : "border-white/5"} ${hasDesc ? "cursor-pointer" : ""} ${isExpanded ? (e.action === "payment_failed" ? "bg-red-950/30" : "bg-white/5") : (e.action === "payment_failed" ? "bg-red-950/20 hover:bg-red-950/30" : "hover:bg-white/5")}`}
                      >
                        <td className="px-4 py-3 text-white/40 text-xs whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
                        <td className="px-4 py-3 text-white/70 text-xs">{e.actorName ?? (e.actorId != null ? `#${e.actorId}` : "System")}</td>
                        <td className="px-4 py-3"><ActionBadge action={e.action} /></td>
                        <td className="px-4 py-3 text-white/60 text-xs max-w-xs truncate">{e.description ?? "—"}</td>
                        <td className="px-4 py-3 text-white/30 text-xs font-mono">{e.ipAddress ?? "—"}</td>
                        <td className="px-2 py-3 text-white/30">
                          {hasDesc && (
                            isExpanded
                              ? <ChevronUp className="w-3.5 h-3.5" />
                              : <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-white/5 bg-white/[0.03]">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="flex flex-col gap-2">
                              <p className="text-white/80 text-xs leading-relaxed whitespace-pre-wrap break-words">{e.description}</p>
                              <div className="flex flex-wrap gap-4 mt-1 text-xs text-white/40">
                                <span><span className="text-white/30">Actor: </span>{e.actorName ?? (e.actorId != null ? `#${e.actorId}` : "System")}</span>
                                <span><span className="text-white/30">IP: </span>{e.ipAddress ?? "—"}</span>
                                <span><span className="text-white/30">Time: </span>{fmtDateTime(e.createdAt)}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Financial Analytics Tab ──────────────────────────────────────────────────

const AGING_BUCKETS = [
  { key: "1-30",  label: "1–30 Days",  color: "#f59e0b", risk: "Low",      dot: "bg-amber-500"  },
  { key: "31-60", label: "31–60 Days", color: "#f97316", risk: "Medium",   dot: "bg-orange-500" },
  { key: "61-90", label: "61–90 Days", color: "#ef4444", risk: "High",     dot: "bg-red-500"    },
  { key: "90+",   label: "90+ Days",   color: "#9b1c1c", risk: "Critical", dot: "bg-red-900"    },
] as const;

const CHANNEL_COLORS = ["#06b6d4", "#10b981", "#8b5cf6", "#f59e0b", "#64748b"];

interface TSRow { period: string; period_date: string; billed: number; collected: number; }

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Parse "YYYY-MM-DD..." safely to a local Date (ignores time/tz suffix). */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Quarterly view — fully multi-tenant aware.
 * Always renders exactly 4 quarters anchored to the session's own start month.
 * Works for any academic calendar:
 *   June start  → Q1=Jun–Aug, Q2=Sep–Nov, Q3=Dec–Feb, Q4=Mar–May
 *   January start → Q1=Jan–Mar, Q2=Apr–Jun, Q3=Jul–Sep, Q4=Oct–Dec
 *   April start → Q1=Apr–Jun, Q2=Jul–Sep, Q3=Oct–Dec, Q4=Jan–Mar
 *
 * Data that falls outside the session's date range (advance payments, backdated
 * entries) is clamped into the nearest boundary quarter so it is always visible
 * rather than silently discarded.
 */
function aggregateToQuarterly(rows: TSRow[], sessionStartDate: string, _sessionEndDate: string): TSRow[] {
  const start     = parseLocalDate(sessionStartDate);
  const startMon  = start.getMonth();
  const startYear = start.getFullYear();

  // Build 4-quarter skeleton aligned to the session's start month
  const skeleton: TSRow[] = [0, 1, 2, 3].map(qi => {
    const absMonth = startMon + qi * 3;
    const calMonth = absMonth % 12;
    const calYear  = startYear + Math.floor(absMonth / 12);
    const m1 = MONTH_ABBR[(startMon + qi * 3    ) % 12];
    const m2 = MONTH_ABBR[(startMon + qi * 3 + 2) % 12];
    return {
      period:      `Q${qi + 1} ${m1}–${m2}`,
      period_date: new Date(calYear, calMonth, 1).toISOString(),
      billed:      0,
      collected:   0,
    };
  });
  const map = new Map<string, TSRow>(skeleton.map(r => [r.period, { ...r }]));

  for (const r of rows) {
    const d = parseLocalDate(r.period_date);
    // Months offset from session start (can be negative for pre-session data)
    const monthsFromStart = (d.getFullYear() - startYear) * 12 + d.getMonth() - startMon;
    // Clamp: pre-session data → Q1, post-session data → Q4
    const clamped = Math.max(0, Math.min(11, monthsFromStart));
    const qi  = Math.floor(clamped / 3);
    const key = skeleton[qi]?.period;
    if (!key) continue;
    const ex = map.get(key)!;
    map.set(key, { ...ex, billed: ex.billed + r.billed, collected: ex.collected + r.collected });
  }
  return skeleton.map(s => map.get(s.period)!);
}

/**
 * YTD — shows every month from the effective start to the effective end as a
 * full skeleton. The effective range is the union of the session date range and
 * the actual data date range, so payments collected before the session's
 * official start (advance fees, backdated entries) are always visible.
 * Months with no data show ₹0 billed / ₹0 collected.
 */
function buildYTD(rows: TSRow[], sessionStartDate: string, sessionEndDate: string): TSRow[] {
  const sessionStart = parseLocalDate(sessionStartDate);
  const sessionEnd   = parseLocalDate(sessionEndDate);

  // Extend to cover actual data dates
  const allDates      = rows.map(r => parseLocalDate(r.period_date));
  const dataMin       = allDates.length > 0 ? allDates.reduce((a, b) => (a < b ? a : b)) : sessionStart;
  const dataMax       = allDates.length > 0 ? allDates.reduce((a, b) => (a > b ? a : b)) : sessionEnd;
  const effectiveStart = dataMin < sessionStart ? dataMin : sessionStart;
  const effectiveEnd   = dataMax > sessionEnd   ? dataMax : sessionEnd;

  const startMon = effectiveStart.getMonth();
  const startY   = effectiveStart.getFullYear();
  const totalMonths =
    (effectiveEnd.getFullYear() - startY) * 12 + effectiveEnd.getMonth() - startMon + 1;

  const skeleton: TSRow[] = Array.from({ length: totalMonths }, (_, i) => {
    const absMonth = startMon + i;
    const calMonth = absMonth % 12;
    const calYear  = startY + Math.floor(absMonth / 12);
    return {
      period:      `${MONTH_ABBR[calMonth]} '${String(calYear).slice(2)}`,
      period_date: new Date(calYear, calMonth, 1).toISOString(),
      billed:      0,
      collected:   0,
    };
  });

  // Index existing rows by YYYY-MM
  const dataMap = new Map<string, { billed: number; collected: number }>();
  for (const r of rows) {
    const key = r.period_date.slice(0, 7);
    const ex  = dataMap.get(key) ?? { billed: 0, collected: 0 };
    dataMap.set(key, { billed: ex.billed + r.billed, collected: ex.collected + r.collected });
  }

  return skeleton.map(s => {
    const data = dataMap.get(s.period_date.slice(0, 7));
    return data ? { ...s, ...data } : s;
  });
}

const CustomTooltipStyle = {
  contentStyle: { background: "#0A1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: "rgba(255,255,255,0.7)" },
};

interface AgingStudent {
  fee_record_id: number;
  student_id: number;
  student_name: string;
  class: string;
  section: string;
  fee_type: string;
  due_date: string;
  amount: number;
  days_overdue: number;
}

function AnalyticsTab({ viewSessionId }: { viewSessionId: number | null }) {
  const { selectedSession } = useSessionView();
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "ytd">("monthly");
  const [selectedBucket, setSelectedBucket] = useState<(typeof AGING_BUCKETS)[number] | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // ── Report Schedule state ───────────────────────────────────────────────
  const { toast } = useToast();
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [sendingNow, setSendingNow] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const { data: scheduleData, refetch: refetchSchedule } = useQuery<{ enabled: boolean; recipients: string[]; lastSentAt: string | null }>({
    queryKey: ["/api/admin/fees/report-schedule"],
    queryFn: async () => {
      const r = await sessionFetch("/api/admin/fees/report-schedule");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  // Sync local state when remote data arrives
  useEffect(() => {
    if (!scheduleData) return;
    setScheduleEnabled(scheduleData.enabled);
    setRecipients(scheduleData.recipients ?? []);
  }, [scheduleData]);

  function addRecipient() {
    const email = recipientInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    if (recipients.includes(email)) {
      toast({ title: "Already added", description: "This email is already in the list.", variant: "destructive" });
      return;
    }
    if (recipients.length >= 20) {
      toast({ title: "Limit reached", description: "Maximum 20 recipients allowed.", variant: "destructive" });
      return;
    }
    setRecipients(prev => [...prev, email]);
    setRecipientInput("");
  }

  async function saveSchedule() {
    setSavingSchedule(true);
    try {
      const r = await sessionFetch("/api/admin/fees/report-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: scheduleEnabled, recipients }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.message ?? "Failed to save");
      }
      await refetchSchedule();
      toast({ title: "Schedule saved", description: "Monthly report schedule updated successfully." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingSchedule(false);
    }
  }

  async function sendNow() {
    if (recipients.length === 0) {
      toast({ title: "No recipients", description: "Add at least one email recipient before sending.", variant: "destructive" });
      return;
    }
    setSendingNow(true);
    try {
      // Persist the current recipient list so the server uses the latest;
      // we intentionally omit `enabled` here so clicking Send Now never
      // accidentally changes the scheduled-run toggle as a side effect.
      const saveR = await sessionFetch("/api/admin/fees/report-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients }),
      });
      if (!saveR.ok) {
        const d = await saveR.json();
        throw new Error(d.message ?? "Failed to save recipients");
      }
      // The send-now endpoint ignores the `enabled` flag (forceEnabled=true server-side)
      const r = await sessionFetch("/api/admin/fees/report-schedule/send-now", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? "Failed to send");
      await refetchSchedule();
      toast({
        title: `Report sent to ${d.sent} recipient${d.sent !== 1 ? "s" : ""}`,
        description: d.errors?.length ? `Errors: ${d.errors.join("; ")}` : "The PDF report has been delivered. Check your inbox.",
      });
    } catch (e: any) {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    } finally {
      setSendingNow(false);
    }
  }

  const { data: raw, isLoading, error } = useQuery<any>({
    queryKey: ["/api/fees/analytics", viewSessionId],
    queryFn: async () => {
      const r = await sessionFetch("/api/fees/analytics");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 0,           // always fetch fresh — analytics must show live data
    refetchOnMount: "always",
  });

  const { data: meData } = useQuery<{ schoolName?: string }>({
    queryKey: ["/api/me"],
    staleTime: 300_000,
  });

  // ── PDF Export ─────────────────────────────────────────────────────────────
  function handleExportPdf() {
    if (!raw) return;
    setExportingPdf(true);
    try {
      // ── HTML escape helper — applied to every non-numeric text value ──────
      const esc = (v: unknown): string =>
        String(v ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const schoolName   = esc(meData?.schoolName ?? "School");
      const sessionLabel = esc(selectedSession?.sessionName ?? "All Sessions");
      const periodLabel  = period === "quarterly" ? "Quarterly" : period === "ytd" ? "Year-to-Date" : "Monthly (Last 12)";
      const exportedAt   = esc(new Date().toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }));

      const s          = raw?.summary ?? {};
      const classWise: any[] = raw?.classWise ?? [];
      const channels:  any[] = raw?.paymentChannels ?? [];
      const categories: any[] = raw?.feeCategories ?? [];
      const aging:     any[] = raw?.aging ?? [];

      // Use the already-computed, period-filtered time series (respects Monthly/Quarterly/YTD mode)
      const tsSeries = timeSeriesData;

      // Channel grouping (mirrors the chart logic)
      const chGroups: Record<string, number> = {};
      for (const ch of channels) {
        const m   = String(ch.payment_method ?? "Other");
        const cat = ["Online","Razorpay","UPI","Card","NetBanking"].includes(m) ? "Online"
                  : m === "Cash" ? "Cash"
                  : ["Cheque","DD","Bank Transfer"].includes(m) ? "Cheque" : m;
        chGroups[cat] = (chGroups[cat] ?? 0) + Number(ch.amount);
      }
      const chTotal = Object.values(chGroups).reduce((a, b) => a + b, 0);

      const fmtINR = (n: number) =>
        new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

      // Aging bucket metadata — keys are fixed constants, safe to use without escaping
      const agingBucketMeta: Record<string, { label: string; risk: string }> = {
        "1-30":  { label: "1\u201330 Days",  risk: "Low Risk"      },
        "31-60": { label: "31\u201360 Days", risk: "Medium Risk"   },
        "61-90": { label: "61\u201390 Days", risk: "High Risk"     },
        "90+":   { label: "90+ Days",        risk: "Critical Risk" },
      };

      const classWiseTotals = classWise.reduce(
        (acc, r) => ({ billed: acc.billed + Number(r.billed), collected: acc.collected + Number(r.collected), outstanding: acc.outstanding + Number(r.outstanding) }),
        { billed: 0, collected: 0, outstanding: 0 },
      );

      // Build the report by constructing safe HTML — all user/DB-sourced text goes through esc()
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Financial Analytics Report &#8212; ${schoolName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; }
  @page { margin: 15mm 12mm; size: A4 portrait; }
  .page-break { page-break-before: always; }

  /* Header */
  .report-header { border-bottom: 3px solid #0e7490; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  .report-title { font-size: 20px; font-weight: 800; color: #0e7490; letter-spacing: -0.5px; }
  .report-subtitle { font-size: 11px; color: #64748b; margin-top: 2px; }
  .report-meta { text-align: right; font-size: 10px; color: #64748b; line-height: 1.6; }
  .session-pill { display: inline-block; background: #e0f2fe; color: #0369a1; border-radius: 12px; padding: 2px 10px; font-weight: 700; font-size: 10px; }

  /* KPI cards */
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi-card { border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .kpi-label { font-size: 9.5px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .kpi-value { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
  .kpi-card.gold   { border-color: #d97706; background: #fffbeb; }
  .kpi-card.gold .kpi-value { color: #b45309; }
  .kpi-card.red    { border-color: #ef4444; background: #fef2f2; }
  .kpi-card.red .kpi-value  { color: #dc2626; }
  .kpi-card.green  { border-color: #10b981; background: #f0fdf4; }
  .kpi-card.green .kpi-value { color: #059669; }
  .kpi-card.purple { border-color: #8b5cf6; background: #f5f3ff; }
  .kpi-card.purple .kpi-value { color: #7c3aed; }
  .kpi-card.amber  { border-color: #f59e0b; background: #fffbeb; }
  .kpi-card.amber .kpi-value  { color: #d97706; }

  /* Section headings */
  .section { margin-bottom: 18px; }
  .section-title { font-size: 12px; font-weight: 700; color: #0e7490; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1.5px solid #e0f2fe; text-transform: uppercase; letter-spacing: 0.5px; }
  .section-sub { font-size: 9px; color: #94a3b8; margin-left: 6px; font-weight: 400; text-transform: none; letter-spacing: 0; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  thead tr { background: #f1f5f9; }
  th { padding: 6px 8px; text-align: left; font-weight: 700; color: #475569; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; }
  th.right, td.right { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
  tr:last-child td { border-bottom: none; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #cbd5e1; padding-top: 7px; }
  .pct { color: #64748b; font-size: 9px; margin-left: 4px; }
  .green-val { color: #059669; font-weight: 700; }
  .red-val   { color: #dc2626; font-weight: 600; }

  /* Two-column layout */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }

  /* Channel list */
  .channel-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
  .channel-bar { height: 6px; background: #0e7490; border-radius: 3px; margin-top: 3px; }

  /* Aging grid */
  .aging-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .aging-card { border-radius: 8px; padding: 12px; border: 1.5px solid; }
  .aging-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .aging-amount { font-size: 16px; font-weight: 800; }
  .aging-meta { font-size: 9px; margin-top: 4px; }
  .bucket-low      { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
  .bucket-medium   { border-color: #f97316; background: #fff7ed; color: #9a3412; }
  .bucket-high     { border-color: #ef4444; background: #fef2f2; color: #991b1b; }
  .bucket-critical { border-color: #9b1c1c; background: #fef2f2; color: #7f1d1d; }

  /* Time-series progress bar */
  .ts-bar-wrap { width: 80px; background: #f1f5f9; border-radius: 3px; overflow: hidden; display: inline-block; height: 7px; vertical-align: middle; margin-left: 4px; }
  .ts-bar-fill { height: 100%; border-radius: 3px; }

  /* Footer */
  .report-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
</style>
</head>
<body>

<!-- ── Header ── -->
<div class="report-header">
  <div>
    <div class="report-title">Financial Analytics Report</div>
    <div class="report-subtitle">${schoolName} &nbsp;&middot;&nbsp; <span class="session-pill">${sessionLabel}</span></div>
    <div style="margin-top:4px;font-size:9.5px;color:#0369a1;font-weight:600;">&#128197; Period View: ${esc(periodLabel)}</div>
  </div>
  <div class="report-meta">
    <div>Exported on ${exportedAt}</div>
    <div>Powered by Benius</div>
  </div>
</div>

<!-- ── KPI Cards ── -->
<div class="section">
  <div class="section-title">Executive Summary</div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Gross Billed Demand</div>
      <div class="kpi-value">${fmtINR(Number(s.grossBilled ?? 0))}</div>
    </div>
    <div class="kpi-card gold">
      <div class="kpi-label">Net Collected Revenue</div>
      <div class="kpi-value">${fmtINR(Number(s.netCollected ?? 0))}</div>
    </div>
    <div class="kpi-card red">
      <div class="kpi-label">Outstanding Deficit</div>
      <div class="kpi-value">${fmtINR(Number(s.outstanding ?? 0))}</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-label">Collection Efficiency</div>
      <div class="kpi-value">${Number(s.collectionRate ?? 0)}%</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-label">Discounts &amp; Concessions</div>
      <div class="kpi-value">${fmtINR(Number(s.totalDiscounts ?? 0))}</div>
    </div>
    <div class="kpi-card amber">
      <div class="kpi-label">Late Penalties Collected</div>
      <div class="kpi-value">${fmtINR(Number(s.totalLatePenalties ?? 0))}</div>
    </div>
  </div>
</div>

<!-- ── Time Series (active period view) ── -->
${tsSeries.length > 0 ? `
<div class="section">
  <div class="section-title">Revenue Collection Trend <span class="section-sub">${esc(periodLabel)}</span></div>
  <table>
    <thead>
      <tr>
        <th>Period</th>
        <th class="right">Billed</th>
        <th class="right">Collected</th>
        <th class="right">Collection %</th>
        <th>Progress</th>
      </tr>
    </thead>
    <tbody>
      ${tsSeries.map(r => {
        const b = Number(r.billed), c = Number(r.collected);
        const pct = b > 0 ? Math.round((c / b) * 100) : 0;
        const barW = Math.min(pct, 100);
        return `<tr>
          <td>${esc(r.period)}</td>
          <td class="right">${fmtINR(b)}</td>
          <td class="right green-val">${fmtINR(c)}</td>
          <td class="right">${pct}%</td>
          <td><div class="ts-bar-wrap"><div class="ts-bar-fill" style="width:${barW}%;background:#0e7490"></div></div></td>
        </tr>`;
      }).join("")}
    </tbody>
    <tfoot>
      <tr>
        <td>Total</td>
        <td class="right">${fmtINR(tsSeries.reduce((a, r) => a + Number(r.billed), 0))}</td>
        <td class="right green-val">${fmtINR(tsSeries.reduce((a, r) => a + Number(r.collected), 0))}</td>
        <td class="right">&#8212;</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>
` : ""}

<!-- ── Class-wise + Channel ── -->
<div class="two-col">

  <!-- Class-Wise -->
  <div class="section" style="margin-bottom:0">
    <div class="section-title">Class-Wise Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>Class</th>
          <th class="right">Billed</th>
          <th class="right">Collected</th>
          <th class="right">Outstanding</th>
        </tr>
      </thead>
      <tbody>
        ${classWise.map(row => {
          const b = Number(row.billed), c = Number(row.collected), o = Number(row.outstanding);
          const pct = b > 0 ? Math.round((c / b) * 100) : 0;
          return `<tr>
            <td>Class ${esc(row.class)}<span class="pct">${pct}%</span></td>
            <td class="right">${fmtINR(b)}</td>
            <td class="right green-val">${fmtINR(c)}</td>
            <td class="right red-val">${fmtINR(o)}</td>
          </tr>`;
        }).join("") || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">No class data</td></tr>'}
      </tbody>
      ${classWise.length > 0 ? `<tfoot>
        <tr>
          <td>Total</td>
          <td class="right">${fmtINR(classWiseTotals.billed)}</td>
          <td class="right green-val">${fmtINR(classWiseTotals.collected)}</td>
          <td class="right red-val">${fmtINR(classWiseTotals.outstanding)}</td>
        </tr>
      </tfoot>` : ""}
    </table>
  </div>

  <!-- Payment Channel -->
  <div class="section" style="margin-bottom:0">
    <div class="section-title">Payment Channel Split</div>
    ${Object.entries(chGroups).length === 0
      ? '<p style="color:#94a3b8;font-size:10px;padding:12px 0">No payment data available</p>'
      : Object.entries(chGroups).map(([name, val]) => {
          const pct = chTotal > 0 ? Math.round((val / chTotal) * 100) : 0;
          return `<div class="channel-row">
            <div>
              <span style="font-weight:600">${esc(name)}</span>
              <span class="pct">${pct}%</span>
            </div>
            <span class="green-val">${fmtINR(val)}</span>
          </div>
          <div class="channel-bar" style="width:${pct}%"></div>`;
        }).join("")
    }
    ${chTotal > 0 ? `<div class="channel-row" style="margin-top:8px;border-top:1.5px solid #cbd5e1;padding-top:6px">
      <span style="font-weight:700">Total</span>
      <span style="font-weight:700">${fmtINR(chTotal)}</span>
    </div>` : ""}
  </div>
</div>

<!-- ── Fee Categories ── -->
${categories.length > 0 ? `
<div class="section">
  <div class="section-title">Fee Category Breakdown</div>
  <table>
    <thead>
      <tr>
        <th>Fee Category</th>
        <th class="right">Billed</th>
        <th class="right">Collected</th>
        <th class="right">Collection %</th>
        <th class="right">Outstanding</th>
      </tr>
    </thead>
    <tbody>
      ${categories.map(r => {
        const b = Number(r.billed), c = Number(r.collected), o = Math.max(b - c, 0);
        const pct = b > 0 ? Math.round((c / b) * 100) : 0;
        return `<tr>
          <td>${esc(r.fee_type)}</td>
          <td class="right">${fmtINR(b)}</td>
          <td class="right green-val">${fmtINR(c)}</td>
          <td class="right">${pct}%</td>
          <td class="right red-val">${fmtINR(o)}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- ── AR Aging ── -->
<div class="section">
  <div class="section-title">Accounts Receivable Aging</div>
  <div class="aging-grid">
    ${(["1-30","31-60","61-90","90+"] as const).map(key => {
      const meta = agingBucketMeta[key];
      const row  = aging.find((a: any) => a.bucket === key);
      const amount = Number(row?.amount ?? 0);
      const count  = Number(row?.count  ?? 0);
      const riskCls = key === "1-30" ? "bucket-low" : key === "31-60" ? "bucket-medium" : key === "61-90" ? "bucket-high" : "bucket-critical";
      // meta.label and meta.risk are hardcoded literals — no escaping needed
      return `<div class="aging-card ${riskCls}">
        <div class="aging-label">${meta.label}</div>
        <div class="aging-amount">${fmtINR(amount)}</div>
        <div class="aging-meta">${count} invoice${count !== 1 ? "s" : ""} &nbsp;&middot;&nbsp; ${meta.risk}</div>
      </div>`;
    }).join("")}
  </div>
</div>

<!-- ── Footer ── -->
<div class="report-footer">
  <span>${schoolName} &nbsp;&middot;&nbsp; ${sessionLabel}</span>
  <span>Generated ${exportedAt} &nbsp;&middot;&nbsp; Benius School Management</span>
</div>

<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;

      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } finally {
      setExportingPdf(false);
    }
  }

  // Time-series aggregation
  const timeSeriesData = useMemo<TSRow[]>(() => {
    if (!raw?.timeSeries) return [];
    const rows: TSRow[] = (raw.timeSeries as any[]).map(r => ({
      period:      r.period,
      period_date: r.period_date,
      billed:      Number(r.billed),
      collected:   Number(r.collected),
    }));

    // Use the session's own start/end dates for period boundaries.
    // Fall back to a rolling 12-month window anchored on today if missing.
    const now = new Date();
    const fallbackStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const sessionStart: string = raw?.sessionInfo?.startDate ?? `${fallbackStartYear}-04-01`;
    const sessionEnd:   string = raw?.sessionInfo?.endDate   ?? `${fallbackStartYear + 1}-03-31`;

    if (period === "quarterly") return aggregateToQuarterly(rows, sessionStart, sessionEnd);
    if (period === "ytd")       return buildYTD(rows, sessionStart, sessionEnd);

    // Monthly: return all rows the backend sent — they are already session-scoped,
    // so no additional date cutoff is needed. Sorted ascending by the backend.
    return rows;
  }, [raw, period]);

  // Payment channel grouping
  const channelData = useMemo(() => {
    if (!raw?.paymentChannels) return [];
    const groups: Record<string, number> = {};
    for (const ch of raw.paymentChannels as any[]) {
      const m   = String(ch.payment_method ?? "Other");
      const cat = ["Online", "Razorpay", "UPI", "Card", "NetBanking"].includes(m) ? "Online"
                : m === "Cash" ? "Cash"
                : ["Cheque", "DD", "Bank Transfer"].includes(m) ? "Cheque"
                : m;
      groups[cat] = (groups[cat] ?? 0) + Number(ch.amount);
    }
    return Object.entries(groups).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [raw]);

  // Aging with guaranteed 4 buckets
  const agingData = useMemo(() => {
    const map = Object.fromEntries(((raw?.aging ?? []) as any[]).map((a: any) => [a.bucket, a]));
    return AGING_BUCKETS.map(b => ({
      ...b,
      count:  Number(map[b.key]?.count  ?? 0),
      amount: Number(map[b.key]?.amount ?? 0),
    }));
  }, [raw]);

  const totalAging = agingData.reduce((s, r) => s + r.amount, 0);
  const feeCategories = ((raw?.feeCategories ?? []) as any[]).map(r => ({
    fee_type: r.fee_type, billed: Number(r.billed), collected: Number(r.collected),
  }));

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
    </div>
  );
  if (error) return (
    <div className="rounded-xl border border-red-700/40 bg-red-900/10 p-6 text-center text-sm text-red-400">
      Failed to load analytics data. Please refresh and try again.
    </div>
  );

  const s = raw?.summary ?? {};

  const execCards = [
    { label: "Gross Billed Demand",      value: fmt(s.grossBilled ?? 0),        Icon: FileText,     ib: "border-white/10 bg-white/5",              ic: "text-white/50"    },
    { label: "Net Collected Revenue",    value: fmt(s.netCollected ?? 0),       Icon: DollarSign,   ib: "border-[#D4AF37]/30 bg-[#D4AF37]/5",      ic: "text-[#D4AF37]"  },
    { label: "Outstanding Deficit",      value: fmt(s.outstanding ?? 0),        Icon: TrendingDown, ib: "border-red-500/30 bg-red-500/5",           ic: "text-red-400"    },
    { label: "Collection Efficiency",    value: `${s.collectionRate ?? 0}%`,    Icon: TrendingUp,   ib: "border-emerald-500/30 bg-emerald-500/5",   ic: "text-emerald-400"},
    { label: "Discounts & Concessions",  value: fmt(s.totalDiscounts ?? 0),     Icon: Banknote,     ib: "border-purple-500/30 bg-purple-500/5",     ic: "text-purple-400" },
    { label: "Late Penalties Collected", value: fmt(s.totalLatePenalties ?? 0), Icon: AlertTriangle,ib: "border-amber-500/30 bg-amber-500/5",       ic: "text-amber-400"  },
  ];

  return (
    <div className="space-y-5">

      {/* Session label + Export PDF */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          {selectedSession && (
            <>
              <span className="text-white/40">Showing data for</span>
              <span className="px-2 py-0.5 rounded-full font-semibold bg-cyan-900/30 text-cyan-400 border border-cyan-700/30">
                {selectedSession.sessionName}
              </span>
            </>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={exportingPdf || isLoading || !!error}
          onClick={handleExportPdf}
          className="h-7 px-3 text-xs border-white/15 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white gap-1.5 flex-shrink-0"
        >
          {exportingPdf
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Download className="w-3.5 h-3.5" />}
          Export PDF
        </Button>
      </div>

      {/* ── Executive Summary Cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {execCards.map(({ label, value, Icon, ib, ic }) => (
          <div key={label} className={`rounded-xl border ${ib} p-4 flex items-center gap-3`}>
            <div className={`p-2 rounded-lg bg-white/5 ${ic} flex-shrink-0`}><Icon className="w-5 h-5" /></div>
            <div className="min-w-0">
              <p className="text-white/50 text-xs mb-0.5 leading-tight">{label}</p>
              <p className="text-white font-bold text-lg leading-none tabular-nums truncate">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Revenue Collection Trend ─────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-white font-semibold text-sm">Revenue Collection Trend</h3>
            <p className="text-white/40 text-xs">Billed demand vs collected revenue by period</p>
          </div>
          <div className="flex gap-0.5 p-0.5 bg-black/20 rounded-lg border border-white/10">
            {(["monthly", "quarterly", "ytd"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${period === p ? "bg-cyan-600 text-white" : "text-white/40 hover:text-white"}`}>
                {p === "monthly" ? "Monthly" : p === "quarterly" ? "Quarterly" : "YTD"}
              </button>
            ))}
          </div>
        </div>

        {timeSeriesData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-white/25 text-sm">
            No collection data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={timeSeriesData} barGap={2} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip {...CustomTooltipStyle}
                formatter={(v: number, name: string) => [fmt(v), name === "billed" ? "Billed" : "Collected"]} />
              <Legend formatter={v => v === "billed" ? "Billed" : "Collected"}
                wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
              <Bar dataKey="billed"    name="billed"    fill="rgba(255,255,255,0.08)" radius={[4,4,0,0]} />
              <Bar dataKey="collected" name="collected" fill="#06b6d4"                radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Class-Wise Table + Payment Channel Pie ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Class-Wise */}
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-3">
          <h3 className="text-white font-semibold text-sm">Class-Wise Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase tracking-widest text-[10px]">
                  <th className="pb-2 text-left font-semibold">Class</th>
                  <th className="pb-2 text-right font-semibold">Billed</th>
                  <th className="pb-2 text-right font-semibold">Collected</th>
                  <th className="pb-2 text-right font-semibold">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {((raw?.classWise ?? []) as any[]).map((row: any) => {
                  const billed = Number(row.billed), collected = Number(row.collected), out = Number(row.outstanding);
                  const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0;
                  return (
                    <tr key={row.class} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-2 text-white font-medium">
                        Class {row.class}
                        <span className="ml-1.5 text-[10px] text-white/30">{pct}%</span>
                      </td>
                      <td className="py-2 text-right text-white/50 tabular-nums">{fmt(billed)}</td>
                      <td className="py-2 text-right text-emerald-400 tabular-nums font-semibold">{fmt(collected)}</td>
                      <td className="py-2 text-right text-red-400 tabular-nums">{fmt(out)}</td>
                    </tr>
                  );
                })}
                {((raw?.classWise ?? []) as any[]).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-white/25">No class data available</td>
                  </tr>
                )}
              </tbody>
              {((raw?.classWise ?? []) as any[]).length > 0 && (
                <tfoot className="border-t border-white/10">
                  <tr className="text-xs font-bold">
                    <td className="pt-2 text-white/60">Total</td>
                    <td className="pt-2 text-right text-white/60 tabular-nums">
                      {fmt((raw?.classWise as any[]).reduce((s: number, r: any) => s + Number(r.billed), 0))}
                    </td>
                    <td className="pt-2 text-right text-emerald-400 tabular-nums">
                      {fmt((raw?.classWise as any[]).reduce((s: number, r: any) => s + Number(r.collected), 0))}
                    </td>
                    <td className="pt-2 text-right text-red-400 tabular-nums">
                      {fmt((raw?.classWise as any[]).reduce((s: number, r: any) => s + Number(r.outstanding), 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Payment Channel Pie */}
        <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-3">
          <h3 className="text-white font-semibold text-sm">Payment Channel Split</h3>
          {channelData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-white/25 text-sm">No payment data yet</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={channelData} cx="50%" cy="50%" innerRadius={54} outerRadius={80}
                    dataKey="value" paddingAngle={3} stroke="none">
                    {channelData.map((_, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...CustomTooltipStyle} formatter={(v: number) => [fmt(v), "Amount"]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center">
                {channelData.map((d, i) => {
                  const total = channelData.reduce((s, c) => s + c.value, 0);
                  const pct   = total > 0 ? Math.round((d.value / total) * 100) : 0;
                  return (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-white/60">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }} />
                      <span>{d.name}</span>
                      <span className="text-white/30">{pct}%</span>
                      <span className="text-white/40 tabular-nums">{fmt(d.value)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Fee Category Breakdown (horizontal bars) ─────────────────── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-4">
        <h3 className="text-white font-semibold text-sm">Fee Category Breakdown</h3>
        {feeCategories.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-white/25 text-sm">No fee category data</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, feeCategories.length * 44)}>
            <BarChart data={feeCategories} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="fee_type" width={110}
                tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...CustomTooltipStyle}
                formatter={(v: number, name: string) => [fmt(v), name === "billed" ? "Billed" : "Collected"]} />
              <Legend formatter={v => v === "billed" ? "Billed" : "Collected"}
                wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }} />
              <Bar dataKey="billed"    name="billed"    fill="rgba(255,255,255,0.08)" radius={[0,4,4,0]} />
              <Bar dataKey="collected" name="collected" fill="#10b981"                radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── AR Aging Analysis ────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5 space-y-4">
        <div>
          <h3 className="text-white font-semibold text-sm">Accounts Receivable Aging</h3>
          <p className="text-white/40 text-xs">Outstanding balance by days overdue — click any bucket to see which students are responsible</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {agingData.map(bucket => (
            <button
              key={bucket.key}
              onClick={() => bucket.count > 0 ? setSelectedBucket(bucket) : undefined}
              disabled={bucket.count === 0}
              className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2.5 text-left transition-all duration-150 disabled:opacity-50 disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-black/40 enabled:hover:scale-[1.02] group"
              style={{ borderColor: `${bucket.color}30` }}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${bucket.dot}`} />
                <span className="text-white/60 text-xs font-semibold leading-none">{bucket.label}</span>
                {bucket.count > 0 && (
                  <Users className="w-3 h-3 ml-auto text-white/20 group-hover:text-white/50 transition-colors" />
                )}
              </div>
              <p className="text-white font-black text-xl tabular-nums leading-none">{fmt(bucket.amount)}</p>
              <div className="flex items-center justify-between">
                <span className="text-white/30 text-xs">{bucket.count} invoice{bucket.count !== 1 ? "s" : ""}</span>
                {totalAging > 0 && (
                  <span className="text-xs font-bold" style={{ color: bucket.color }}>
                    {Math.round((bucket.amount / totalAging) * 100)}%
                  </span>
                )}
              </div>
              {totalAging > 0 && (
                <div className="w-full bg-white/5 rounded-full h-1">
                  <div className="h-1 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((bucket.amount / totalAging) * 100)}%`, background: bucket.color }} />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider"
                  style={{ color: bucket.color, background: `${bucket.color}22` }}>
                  {bucket.risk} Risk
                </span>
                {bucket.count > 0 && (
                  <span className="text-[10px] text-white/30 group-hover:text-white/60 transition-colors font-medium">
                    View →
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
        {totalAging === 0 && (
          <p className="text-center text-white/25 text-sm py-4">No overdue receivables — all current ✓</p>
        )}
      </div>

      {/* ── Aging Defaulters Drawer ───────────────────────────────────── */}
      <AgingDefaultersDrawer
        bucket={selectedBucket}
        onClose={() => setSelectedBucket(null)}
      />

    </div>
  );
}

type Tab = "ledger" | "structures" | "reminders" | "external" | "audit" | "analytics";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "analytics",  label: "Financial Analytics",   Icon: BarChart2     },
  { id: "structures", label: "Fee Structures",        Icon: BookOpen      },
  { id: "ledger",     label: "Ledger & Transactions", Icon: Receipt       },
  { id: "reminders",  label: "Reminders",             Icon: Bell          },
  { id: "external",   label: "External Portal",       Icon: ExternalLink  },
  { id: "audit",      label: "Audit Log",             Icon: Shield        },
];

export default function FeesManager({ schoolId, allowedSubs }: { schoolId: number; allowedSubs?: string[] }) {
  const canRecord = allowedSubs === undefined || allowedSubs.includes("record");
  const canExport  = allowedSubs === undefined || allowedSubs.includes("export");
  const { isArchiveMode, selectedSession } = useSessionView();
  const viewSessionId = selectedSession?.id ?? null;
  const [activeTab, setActiveTab] = useState<Tab>("ledger");
  const queryClient = useQueryClient();

  // ── Real-time sync: listen for Razorpay webhook payment-update events ──────
  // When a student pays via Razorpay the webhook fires on the server, which
  // broadcasts a "payment-update" SSE event.  We intercept it here so the
  // ledger, summary and analytics refresh instantly without a manual reload.
  useEffect(() => {
    const es = new EventSource("/api/events/session-change");
    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "payment-update") {
          // Refresh every data slice that changes when a payment comes in —
          // ledger rows, summary totals, payment count badges, failed-attempt
          // badges, analytics, and the audit log (new payment entry).
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/payments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/failed-counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/admin/fees/audit-log"] });
          queryClient.invalidateQueries({ queryKey: ["/api/fees/analytics"] });
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, [queryClient]);

  const { data: students = [] } = useQuery<StudentItem[]>({
    queryKey: ["/api/schools", schoolId, "students"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students`, { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-900/30 border border-cyan-700/40">
          <CreditCard className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-white text-xl font-bold">Fees & Payments</h2>
          <p className="text-white/40 text-xs">Financial hub — ledger, structures, audit trail</p>
        </div>
        {isArchiveMode ? (
          <span className="ml-auto px-3 py-1 rounded-full text-xs bg-amber-900/30 text-amber-400 border border-amber-700/30 flex-shrink-0">
            Archive — read-only
          </span>
        ) : selectedSession ? (
          <span className="ml-auto px-3 py-1 rounded-full text-xs bg-cyan-900/30 text-cyan-400 border border-cyan-700/30 flex-shrink-0">
            {selectedSession.sessionName}
          </span>
        ) : null}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 p-1 bg-[#1A2942] rounded-xl border border-white/10 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${active ? "bg-cyan-600 text-white shadow-sm" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeTab === "ledger"     && <LedgerTab canRecord={canRecord} isArchiveMode={isArchiveMode} students={students} viewSessionId={viewSessionId} />}
      {activeTab === "structures" && <StructuresTab isArchiveMode={isArchiveMode} />}
      {activeTab === "analytics"  && <AnalyticsTab viewSessionId={viewSessionId} />}
      {activeTab === "reminders"  && <RemindersTab isArchiveMode={isArchiveMode} />}
      {activeTab === "external"   && <ExternalPortalTab isArchiveMode={isArchiveMode} />}
      {activeTab === "audit"      && <AuditTab />}
    </div>
  );
}

const NOTIF_CHANNEL_COLORS: Record<string, string> = {
  sms:      "bg-blue-900/40 text-blue-300 border-blue-700/40",
  whatsapp: "bg-green-900/40 text-green-300 border-green-700/40",
  email:    "bg-purple-900/40 text-purple-300 border-purple-700/40",
};

const NOTIF_STAGE_COLORS: Record<string, string> = {
  "D-2": "text-violet-400", "D+0": "text-cyan-400", "D+3": "text-green-400", "D+7": "text-amber-400", "D+14": "text-orange-400",
};

const NOTIF_STAGE_LABELS: Record<string, string> = {
  "D-2": "2 days before due", "D+0": "Due today", "D+3": "3 days overdue", "D+7": "7 days overdue", "D+14": "14 days overdue",
};

interface NotificationHistoryModalProps {
  open: boolean;
  onClose: () => void;
  studentId: number | null;
  studentName: string | null;
}

function NotificationHistoryModal({ open, onClose, studentId, studentName }: NotificationHistoryModalProps) {
  const { data: entries = [], isLoading } = useQuery<DunningLogEntry[]>({
    queryKey: ["/api/admin/fees/dunning-log", studentId],
    queryFn: async () => {
      if (!studentId) return [];
      const r = await sessionFetch(`/api/admin/fees/dunning-log?studentId=${studentId}`);
      if (!r.ok) return [];
      const rows: any[] = await r.json();
      // Normalise snake_case from raw SQL → camelCase
      return rows.map(row => ({
        id:            row.id,
        feeRecordId:   row.fee_record_id,
        channel:       row.channel,
        stage:         row.stage,
        sentAt:        row.sent_at,
        status:        row.status,
        errorMessage:  row.error_message ?? null,
        recipient:     row.recipient ?? null,
        studentName:   row.student_name ?? null,
      }));
    },
    enabled: open && !!studentId,
    staleTime: 60_000,
  });

  const sentCount  = entries.filter(e => e.status === "sent").length;
  const failCount  = entries.filter(e => e.status !== "sent").length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-400">
            <Bell className="w-5 h-5" />
            Notification History
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400/60 ml-1" />}
          </DialogTitle>
        </DialogHeader>

        {/* Student + summary strip */}
        <div className="shrink-0 p-3 rounded-lg bg-white/5 border border-white/10 text-sm">
          <p className="text-white font-semibold">{studentName ?? "—"}</p>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            <span className="text-white/40 text-xs">
              Total: <span className="text-white font-medium">{entries.length}</span>
            </span>
            {sentCount > 0 && (
              <span className="text-white/40 text-xs">
                Sent: <span className="text-emerald-400 font-medium">{sentCount}</span>
              </span>
            )}
            {failCount > 0 && (
              <span className="text-white/40 text-xs">
                Failed: <span className="text-red-400 font-medium">{failCount}</span>
              </span>
            )}
          </div>
        </div>

        {/* Log table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-white/30">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-white/30">
              <Bell className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">No notifications sent for this student yet.</p>
              <p className="text-xs mt-1">Dunning reminders appear here once the automated job fires.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-hidden mt-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Channel</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Stage</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Sent</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Recipient</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-left text-white/50 font-medium">Fee Record</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={e.id} className={`border-b border-white/5 ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${NOTIF_CHANNEL_COLORS[e.channel] ?? "text-white/50 border-white/10"}`}>
                          {NOTIF_CHANNEL_ICONS[e.channel]} {e.channel}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-bold ${NOTIF_STAGE_COLORS[e.stage] ?? "text-white/60"}`}>{e.stage}</span>
                        <span className="text-white/30 ml-1.5">{NOTIF_STAGE_LABELS[e.stage] ?? ""}</span>
                      </td>
                      <td className="px-3 py-2 text-white/50 whitespace-nowrap">{fmtDateTime(e.sentAt)}</td>
                      <td className="px-3 py-2 text-white/50 max-w-[140px] truncate" title={e.recipient ?? ""}>{e.recipient ?? "—"}</td>
                      <td className="px-3 py-2">
                        {e.status === "sent" ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> sent
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1" title={e.errorMessage ?? ""}>
                            <AlertTriangle className="w-3 h-3" /> failed
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white/30 font-mono">#{e.feeRecordId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="shrink-0 pt-2 border-t border-white/10 flex justify-between items-center">
          <p className="text-white/25 text-xs">Showing up to 200 most recent notifications</p>
          <Button variant="ghost" onClick={onClose} className="text-white/60 h-8 text-sm">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgingDefaultersDrawer({
  bucket,
  onClose,
}: {
  bucket: (typeof AGING_BUCKETS)[number] | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [filterClass, setFilterClass] = useState<string>("__all__");
  const [filterFeeType, setFilterFeeType] = useState<string>("__all__");

  // Reset filters whenever a different bucket is opened
  useEffect(() => {
    setFilterClass("__all__");
    setFilterFeeType("__all__");
  }, [bucket?.key]);

  const { data: students = [], isLoading } = useQuery<AgingStudent[]>({
    queryKey: ["/api/fees/analytics/aging-students", bucket?.key],
    queryFn: async () => {
      if (!bucket) return [];
      const r = await sessionFetch(`/api/fees/analytics/aging-students?bucket=${encodeURIComponent(bucket.key)}`);
      if (!r.ok) throw new Error("Failed to load defaulters");
      return r.json();
    },
    enabled: !!bucket,
    staleTime: 30_000,
  });

  // Derive unique option lists from the full fetched data (not the filtered slice)
  const classOptions = useMemo(() => {
    const seen = new Set<string>();
    students.forEach(s => { if (s.class) seen.add(s.class); });
    return Array.from(seen).sort((a, b) => {
      const na = Number(a), nb = Number(b);
      return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
    });
  }, [students]);

  const feeTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    students.forEach(s => { if (s.fee_type) seen.add(s.fee_type); });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [students]);

  // Apply client-side filters
  const visibleStudents = useMemo(() => {
    return students.filter(s => {
      if (filterClass !== "__all__" && s.class !== filterClass) return false;
      if (filterFeeType !== "__all__" && s.fee_type !== filterFeeType) return false;
      return true;
    });
  }, [students, filterClass, filterFeeType]);

  async function sendReminder(student: AgingStudent) {
    setSendingId(student.fee_record_id);
    try {
      const r = await sessionFetch("/api/admin/fees/dunning-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeRecordId: student.fee_record_id }),
      });
      const body = await r.json();
      if (!r.ok) {
        toast({ title: "Failed", description: body.message ?? "Could not send reminder", variant: "destructive" });
        return;
      }
      const sentCount = (body.sent ?? []).length;
      const skipped   = (body.skipped ?? []).length;
      if (sentCount > 0) {
        toast({ title: "Reminder sent", description: `Notified ${student.student_name} via ${(body.sent as string[]).join(", ")}` });
      } else if (skipped > 0) {
        toast({ title: "Reminder skipped", description: (body.skipped as string[])[0] ?? "No channels available", variant: "destructive" });
      } else {
        toast({ title: "Reminder failed", description: "Could not send on any channel", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  }

  return (
    <Sheet open={!!bucket} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl bg-[#0A1628] border-l border-white/10 text-white overflow-y-auto p-0"
      >
        {bucket && (
          <>
            {/* Header */}
            <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: bucket.color }} />
                <SheetTitle className="text-white font-bold text-base leading-tight">
                  {bucket.label} Defaulters
                </SheetTitle>
                <span
                  className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider"
                  style={{ color: bucket.color, background: `${bucket.color}22` }}
                >
                  {bucket.risk} Risk
                </span>
              </div>
              <p className="text-white/40 text-xs mt-1">
                Overdue invoices sorted by outstanding amount — highest risk first
              </p>
            </SheetHeader>

            {/* Filter bar */}
            {!isLoading && students.length > 0 && (
              <div className="px-5 py-3 border-b border-white/10 flex gap-2 flex-wrap">
                <Select value={filterClass} onValueChange={setFilterClass}>
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 w-36">
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0D1F3C] border-white/10 text-white">
                    <SelectItem value="__all__" className="text-xs text-white/60">All Classes</SelectItem>
                    {classOptions.map(c => (
                      <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterFeeType} onValueChange={setFilterFeeType}>
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 flex-1 min-w-36">
                    <SelectValue placeholder="All Fee Types" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0D1F3C] border-white/10 text-white">
                    <SelectItem value="__all__" className="text-xs text-white/60">All Fee Types</SelectItem>
                    {feeTypeOptions.map(ft => (
                      <SelectItem key={ft} value={ft} className="text-xs">{ft}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(filterClass !== "__all__" || filterFeeType !== "__all__") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setFilterClass("__all__"); setFilterFeeType("__all__"); }}
                    className="h-8 px-2 text-xs text-white/40 hover:text-white/70"
                  >
                    <X className="w-3 h-3 mr-1" />Clear
                  </Button>
                )}
              </div>
            )}

            {/* Body */}
            <div className="px-5 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                </div>
              ) : students.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-white/25">
                  <Users className="w-10 h-10" />
                  <p className="text-sm">No defaulters in this bucket</p>
                </div>
              ) : visibleStudents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-white/25">
                  <Search className="w-10 h-10" />
                  <p className="text-sm">No matches for the selected filters</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/40 text-xs mb-3">
                    {visibleStudents.length}{visibleStudents.length !== students.length ? ` of ${students.length}` : ""} student{visibleStudents.length !== 1 ? "s" : ""} found
                  </p>
                  {visibleStudents.map(s => (
                    <div
                      key={s.fee_record_id}
                      className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2.5"
                      style={{ borderColor: `${bucket.color}20` }}
                    >
                      {/* Student info row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white font-semibold text-sm leading-tight truncate">
                            {s.student_name}
                          </p>
                          <p className="text-white/40 text-xs mt-0.5">
                            Class {s.class}{s.section ? `–${s.section}` : ""}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-white font-black text-base tabular-nums leading-tight">
                            {fmt(s.amount)}
                          </p>
                          <p className="text-[10px] mt-0.5 font-bold" style={{ color: bucket.color }}>
                            {s.days_overdue}d overdue
                          </p>
                        </div>
                      </div>

                      {/* Fee detail row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">
                            {s.fee_type}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/10">
                            Due {fmtDate(s.due_date)}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={sendingId === s.fee_record_id}
                          onClick={() => sendReminder(s)}
                          className="h-7 px-2.5 text-xs font-semibold border-cyan-700/50 text-cyan-400 bg-cyan-900/20 hover:bg-cyan-900/40 hover:text-cyan-300 flex-shrink-0"
                        >
                          {sendingId === s.fee_record_id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Bell className="w-3 h-3 mr-1" />
                          )}
                          {sendingId === s.fee_record_id ? "Sending…" : "Remind"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
