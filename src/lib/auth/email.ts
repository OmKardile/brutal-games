// Transactional email. Supports Resend or Brevo HTTP APIs (set one API key).
// With neither key configured (local dev) the email is printed to the server
// console instead — flows stay testable without an email provider.

import { env } from '@/lib/env'

export interface MailInput {
  to: string
  subject: string
  html: string
}

async function sendViaResend(m: MailInput): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mail.resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.mail.from,
      to: [m.to],
      subject: m.subject,
      html: m.html,
    }),
  })
  return res.ok
}

async function sendViaBrevo(m: MailInput): Promise<boolean> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.mail.brevoKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.mail.from },
      to: [{ email: m.to }],
      subject: m.subject,
      htmlContent: m.html,
    }),
  })
  return res.ok
}

/** Returns true if actually delivered. False in dev (logged to console). */
export async function sendMail(m: MailInput): Promise<boolean> {
  try {
    if (env.mail.resendKey) return await sendViaResend(m)
    if (env.mail.brevoKey) return await sendViaBrevo(m)
  } catch (err) {
    console.error('sendMail failed', err)
    return false
  }
  console.log(
    `\n[DEV EMAIL — not sent] to=${m.to} subject="${m.subject}"\n${m.html}\n`,
  )
  return false
}

const shell = (title: string, body: string) => `
<div style="font-family:ui-monospace,monospace;background:#070709;color:#d6d3d1;
padding:24px;border:1px solid #44403c;max-width:520px">
  <div style="color:#ef4444;font-weight:800;letter-spacing:.2em;font-size:18px">BRUTAL//ARENA</div>
  <div style="margin:4px 0 18px;color:#78716c;font-size:11px;letter-spacing:.25em">${title}</div>
  ${body}
  <div style="margin-top:24px;color:#57534e;font-size:10px">
    Didn't request this? Ignore this email — the link expires on its own.
  </div>
</div>`

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<boolean> {
  const url = `${env.APP_URL}/verify-email?token=${token}`
  return sendMail({
    to,
    subject: 'Verify your email — BRUTAL//ARENA',
    html: shell(
      'EMAIL VERIFICATION',
      `<p style="font-size:13px">Confirm your email to unlock reward payouts.</p>
       <p><a href="${url}" style="display:inline-block;background:#dc2626;color:#fff;
       padding:10px 18px;text-decoration:none;font-weight:700">VERIFY EMAIL</a></p>
       <p style="font-size:11px;color:#a8a29e">Link expires in 72 hours.<br>${url}</p>`,
    ),
  })
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
  const url = `${env.APP_URL}/reset-password?token=${token}`
  return sendMail({
    to,
    subject: 'Reset your password — BRUTAL//ARENA',
    html: shell(
      'PASSWORD RESET',
      `<p style="font-size:13px">A password reset was requested for your account.</p>
       <p><a href="${url}" style="display:inline-block;background:#dc2626;color:#fff;
       padding:10px 18px;text-decoration:none;font-weight:700">RESET PASSWORD</a></p>
       <p style="font-size:11px;color:#a8a29e">Link expires in 1 hour and works once.<br>${url}</p>`,
    ),
  })
}
