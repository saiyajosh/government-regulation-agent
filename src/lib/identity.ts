import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE_NAME = 'gra_uid';

const ONE_YEAR = 60 * 60 * 24 * 365;

// Anonymous identity: a random id in a signed, HttpOnly cookie. This is a demo
// substitute for real auth — it isolates users from each other and lets a
// browser find its conversations again, but it is not "who" in any real
// sense. Swap the source of `userId` (e.g. a verified Cloudflare Access JWT)
// and everything downstream — ownership checks, the KV index — stays the same.
export async function requireUser(c: Context) {
	const secret = cookieSecret(c);
	const existing = await getSignedCookie(c, secret, COOKIE_NAME);

	if (existing) return existing;
	const userId = crypto.randomUUID().replaceAll('-', '');
	await setSignedCookie(c, COOKIE_NAME, userId, secret, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: new URL(c.req.url).protocol === 'https:',
		path: '/',
		maxAge: ONE_YEAR,
	});

	return userId;
}

// Conversation ids are server-issued as `<userId>.<random>`, so ownership is a
// prefix check — no lookup needed to reject a guessed id.
export function mintConversationId(userId: string) {
	return `${userId}.${crypto.randomUUID().replaceAll('-', '')}`;
}

export function ownsConversation(userId: string, conversationId: string) {
	return conversationId.startsWith(`${userId}.`);
}

function cookieSecret(c: Context) {
	// SAFETY: c.env is the Worker's Env; COOKIE_SECRET is a secret set with
	// `wrangler secret put COOKIE_SECRET` (or `.env` locally), so it is absent
	// from the generated Env type. The assertion only adds it as optional and
	// the guard below handles it being unset.
	const secret = (c.env as Env & { COOKIE_SECRET?: string }).COOKIE_SECRET;

	if (!secret) throw new Error('COOKIE_SECRET is not set');

	return secret;
}
