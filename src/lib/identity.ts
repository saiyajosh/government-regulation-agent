import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';

const COOKIE_NAME = 'gra_uid';

// Only the binding this module reads. Hono's Context is invariant in its Env,
// so the functions are generic over any Env that carries the secret.
type CookieEnv = { Bindings: { COOKIE_SECRET?: string } };

const ONE_YEAR = 60 * 60 * 24 * 365;

// Anonymous identity: a random id in a signed, HttpOnly cookie. This is a demo
// substitute for real auth — it isolates users from each other and lets a
// browser find its conversations again, but it is not "who" in any real
// sense. Swap the source of `userId` (e.g. a verified Cloudflare Access JWT)
// and everything downstream — ownership checks, the KV index — stays the same.
export async function requireUser<E extends CookieEnv>(c: Context<E>) {
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

function cookieSecret<E extends CookieEnv>(c: Context<E>) {
	// COOKIE_SECRET is a secret set with `wrangler secret put COOKIE_SECRET`
	// (or `.env` locally); the guard handles it being unset.
	const secret = c.env.COOKIE_SECRET;

	if (!secret) throw new Error('COOKIE_SECRET is not set');

	return secret;
}
