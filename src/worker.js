/**
 * The Geek Gene — Cloudflare Worker
 *
 * Static files in /public are served directly by Workers Static Assets.
 * This script only runs for /api/* (see "run_worker_first" in wrangler.jsonc).
 *
 * POST /api/contact
 *   1. Validates the form fields (+ honeypot)
 *   2. Verifies the Cloudflare Turnstile token
 *   3. Emails the message to CONTACT_TO via Mailgun
 *      (or via Cloudflare's send_email binding if MAILGUN_API_KEY is not set)
 *
 * Nothing is stored.
 */

import { EmailMessage } from "cloudflare:email";

const MAX = { name: 120, email: 200, message: 5000 };
const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
      }
      return handleContact(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found." }, 404);
    }

    // Anything else falls through to the static assets.
    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request, env) {
  // Only accept submissions from our own pages.
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ ok: false, error: "Invalid origin." }, 403);
  }

  let data;
  try {
    const type = request.headers.get("Content-Type") || "";
    data = type.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  // Honeypot filled in → almost certainly a bot. Pretend success.
  if (data.website) return json({ ok: true });

  const name = clean(data.name, MAX.name);
  const email = clean(data.email, MAX.email);
  const message = String(data.message ?? "").trim().slice(0, MAX.message);

  if (!name || !message || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Please provide your name, a valid email and a message." }, 400);
  }

  // Verify Turnstile
  const token = data["cf-turnstile-response"];
  if (!token) {
    return json({ ok: false, error: "Verification missing." }, 400);
  }
  const verified = await verifyTurnstile(token, request.headers.get("CF-Connecting-IP"), env);
  if (!verified) {
    return json({ ok: false, error: "Verification failed." }, 403);
  }

  const subject = `Website inquiry from ${name}`;
  const text = [
    `Name:    ${name}`,
    `Email:   ${email}`,
    `Sent:    ${new Date().toISOString()}`,
    "",
    message,
    "",
    "—",
    "Sent from the contact form at geekgene.com",
  ].join("\n");

  try {
    if (env.MAILGUN_API_KEY) {
      await sendViaMailgun(env, { subject, text, replyTo: `${name} <${email}>` });
    } else if (env.SEND_EMAIL) {
      await sendViaCloudflare(env, { subject, text, replyTo: email, replyName: name });
    } else {
      throw new Error("No email transport configured (set MAILGUN_API_KEY or a SEND_EMAIL binding).");
    }
  } catch (err) {
    console.error("Email send failed:", err);
    return json({ ok: false, error: "Sorry — we couldn't send your message right now." }, 502);
  }

  return json({ ok: true });
}

async function verifyTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SECRET_KEY is not set");
    return false;
  }
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const outcome = await res.json();
  return outcome.success === true;
}

async function sendViaMailgun(env, { subject, text, replyTo }) {
  const base = env.MAILGUN_API_BASE || "https://api.mailgun.net";
  const form = new FormData();
  form.append("from", env.CONTACT_FROM);
  form.append("to", env.CONTACT_TO);
  form.append("subject", subject);
  form.append("text", text);
  form.append("h:Reply-To", replyTo);

  const res = await fetch(`${base}/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`api:${env.MAILGUN_API_KEY}`) },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
  }
}

/**
 * Cloudflare Email Routing "send_email" binding.
 * The recipient (CONTACT_TO) must be a verified destination address in
 * Email Routing, and CONTACT_FROM must be an address on your Cloudflare zone.
 */
async function sendViaCloudflare(env, { subject, text, replyTo, replyName }) {
  const fromAddr = bareAddress(env.CONTACT_FROM);
  const toAddr = bareAddress(env.CONTACT_TO);
  const domain = fromAddr.split("@")[1];

  const raw = [
    `From: ${env.CONTACT_FROM}`,
    `To: ${toAddr}`,
    `Reply-To: ${encodeHeader(replyName)} <${replyTo}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(text).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");

  await env.SEND_EMAIL.send(new EmailMessage(fromAddr, toAddr, raw));
}

/* ---------- helpers ---------- */

// Single-line, trimmed, length-limited. Strips CR/LF to prevent header injection.
function clean(value, max) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function bareAddress(addr) {
  const m = /<([^>]+)>/.exec(addr || "");
  return (m ? m[1] : addr || "").trim();
}

function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// RFC 2047 encoded-word so non-ASCII names/subjects survive.
function encodeHeader(str) {
  return /^[\x20-\x7e]*$/.test(str) ? str : `=?UTF-8?B?${base64Utf8(str)}?=`;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
