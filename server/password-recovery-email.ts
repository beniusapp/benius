import type { NotificationConfig } from "@shared/schema";

const FETCH_TIMEOUT_MS = 10_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

export async function sendPasswordRecoveryEmail(
  config: NotificationConfig,
  recipient: string,
  otp: string,
): Promise<void> {
  if (!config.emailEnabled) throw new Error("Password recovery email is disabled");
  const provider = config.emailProvider || "sendgrid";
  if (provider !== "sendgrid" && provider !== "mailtrap") {
    throw new Error("Unsupported password recovery email provider");
  }
  const apiKey = provider === "mailtrap" ? config.mailtrapApiKey : config.sendgridApiKey;
  const fromEmail = config.sendgridFromEmail;
  if (!apiKey || !fromEmail || !fromEmail.includes("@")) {
    throw new Error("Password recovery email is not configured");
  }
  if (!recipient || !recipient.includes("@")) throw new Error("Invalid recovery recipient");
  if (!/^\d{6}$/.test(otp)) throw new Error("Invalid password recovery OTP");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const subject = "Password recovery OTP";
    const html = `<p>Your password recovery OTP is <strong>${escapeHtml(otp)}</strong>.</p><p>This OTP expires in 10 minutes and can be used once.</p><p>If you did not request this, you can safely ignore this email.</p>`;
    const response = provider === "mailtrap"
      ? await fetch(`https://sandbox.api.mailtrap.io/api/send/${config.mailtrapInboxId || "default"}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: { email: fromEmail, name: config.sendgridFromName || "School Admin" },
            to: [{ email: recipient }],
            subject,
            html,
          }),
          signal: controller.signal,
        })
      : await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: recipient }] }],
            from: { email: fromEmail, name: config.sendgridFromName || "School Admin" },
            subject,
            content: [{ type: "text/html", value: html }],
          }),
          signal: controller.signal,
        });
    if (!response.ok) throw new Error(`Password recovery email failed: ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}