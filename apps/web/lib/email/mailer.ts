import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let initialized = false;

function init(): Transporter | null {
  if (initialized) return transporter;
  initialized = true;
  const url = process.env.SMTP_URL?.trim();
  if (url) {
    transporter = nodemailer.createTransport(url);
    return transporter;
  }
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return transporter;
  }
  return null;
}

export function isMailerConfigured(): boolean {
  return init() !== null;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: SendMailInput): Promise<{ delivered: boolean; preview?: string }> {
  const t = init();
  const from = process.env.SMTP_FROM ?? "RW Screen <noreply@example.com>";
  if (!t) {
    // Dev fallback: print to console so flows can be tested without an SMTP server.
    // eslint-disable-next-line no-console
    console.log(`[mailer:console] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}\n`);
    return { delivered: false, preview: input.text };
  }
  const info = await t.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return { delivered: true, preview: info.messageId };
}

export function appBaseUrl(req?: Request): string {
  const env = process.env.RW_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  if (req) {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  }
  return "http://localhost:3210";
}
