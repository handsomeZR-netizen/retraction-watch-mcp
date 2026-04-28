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

const SEND_BACKOFF_MS = [1_000, 4_000, 16_000];

export async function sendMail(input: SendMailInput): Promise<{ delivered: boolean; preview?: string }> {
  const t = init();
  const from = process.env.SMTP_FROM ?? "RW Screen <noreply@example.com>";
  if (!t) {
    // Dev fallback: print to console so flows can be tested without an SMTP server.
    console.log(`[mailer:console] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}\n`);
    return { delivered: false, preview: input.text };
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= SEND_BACKOFF_MS.length; attempt += 1) {
    try {
      const info = await t.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return { delivered: true, preview: info.messageId };
    } catch (err) {
      lastErr = err;
      if (attempt < SEND_BACKOFF_MS.length) {
        const wait = SEND_BACKOFF_MS[attempt];
        console.warn(
          `[mailer] sendMail attempt ${attempt + 1} failed: ${describe(err)}; retry in ${wait}ms`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  // All retries failed: do not throw — auth flows that wrote a token to the DB
  // remain valid (admin can resend). Caller gets `delivered: false` and can log.
  console.error(`[mailer] sendMail giving up after retries: ${describe(lastErr)}`);
  return { delivered: false };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
