/**
 * lib/walletAuth.ts
 *
 * Signature-challenge flow for wallet-only (Accesly / Freighter) users.
 *
 * Wallet users have no password, so account mutations must be tied to a
 * cryptographic proof that the caller controls the Stellar private key of the
 * wallet it claims. The flow is:
 *
 *   1. POST /api/auth/wallet/challenge -> issue a one-time nonce + message.
 *   2. The client signs `message` with its Stellar key.
 *   3. POST /api/auth/wallet/verify    -> verify the signature and mint a
 *                                        short-lived bearer token bound to the
 *                                        wallet address and account.
 *
 * Mutating routes then receive that token as `Authorization: Bearer <token>`
 * and resolve the caller through `getAuthUser(req)`.
 *
 * Server-side only — nunca importar desde componentes cliente.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db";

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos
export const WALLET_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutos

/** SEP-53 prefix that Stellar wallets prepend when signing arbitrary messages. */
const SIGNED_MESSAGE_PREFIX = "Stellar Signed Message:\n";

export type WalletChallenge = {
  nonce: string;
  message: string;
  expiresAt: string;
};

export type ValidatedWalletIdentity = {
  address: string;
  userId: string;
};

export type WalletAuthFailure = {
  status: 400 | 401 | 404;
  error: string;
};

function buildChallengeMessage(params: {
  address: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    "RIZO wants you to sign in with your Stellar account:",
    params.address,
    "",
    "Signing this message proves you control this wallet. It costs no fees.",
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt.toISOString()}`,
    `Expires At: ${params.expiresAt.toISOString()}`,
  ].join("\n");
}

/** Issues and persists a one-time challenge for a Stellar address. */
export async function createWalletChallenge(params: {
  address: string;
  email?: string;
}): Promise<WalletChallenge> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + WALLET_CHALLENGE_TTL_MS);
  const nonce = randomBytes(24).toString("hex");
  const message = buildChallengeMessage({
    address: params.address,
    nonce,
    issuedAt: now,
    expiresAt,
  });

  // Best-effort cleanup so unused challenges do not accumulate per address.
  await prisma.walletChallenge.deleteMany({
    where: { address: params.address, expiresAt: { lt: now } },
  });

  await prisma.walletChallenge.create({
    data: {
      address: params.address,
      nonce,
      message,
      email: params.email ?? null,
      expiresAt,
    },
  });

  return { nonce, message, expiresAt: expiresAt.toISOString() };
}

/**
 * Verifies a signature over the stored challenge message against the Stellar
 * public key. Accepts both SEP-53 signed messages (what Freighter produces)
 * and a raw-bytes signature, so any Stellar wallet works.
 */
function verifyStellarSignature(params: {
  address: string;
  message: string;
  signature: string;
}): boolean {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(params.address);
  } catch {
    return false;
  }

  const signature = Buffer.from(params.signature, "base64");
  if (signature.length === 0) return false;

  const raw = Buffer.from(params.message, "utf8");
  const sep53 = createHash("sha256")
    .update(SIGNED_MESSAGE_PREFIX, "utf8")
    .update(raw)
    .digest();

  try {
    return keypair.verify(sep53, signature) || keypair.verify(raw, signature);
  } catch {
    return false;
  }
}

/**
 * Resolves the account a freshly proven wallet belongs to.
 *
 * A wallet is bound to at most one account. When no account owns the address
 * yet, it is linked to a wallet-only (passwordless) account created during the
 * Accesly onboarding flow — that is the only link path, so it can never take
 * over a password-protected account.
 */
async function resolveWalletAccount(params: {
  address: string;
  email?: string | null;
}) {
  const byWallet = await prisma.user.findFirst({
    where: { stellarPublicKey: params.address },
  });
  if (byWallet) return byWallet;

  if (!params.email) return null;

  const byEmail = await prisma.user.findUnique({
    where: { email: params.email },
  });
  if (!byEmail || byEmail.password || byEmail.stellarPublicKey) return null;

  const linked = await prisma.user.updateMany({
    where: { id: byEmail.id, password: null, stellarPublicKey: null },
    data: { stellarPublicKey: params.address },
  });
  if (linked.count !== 1) return null;

  return prisma.user.findUnique({ where: { id: byEmail.id } });
}

/** Consumes a challenge and verifies the wallet signature over its message. */
export async function verifyWalletChallenge(params: {
  address: string;
  nonce: string;
  signature: string;
}): Promise<
  | { ok: true; identity: ValidatedWalletIdentity }
  | { ok: false; failure: WalletAuthFailure }
> {
  const challenge = await prisma.walletChallenge.findUnique({
    where: { nonce: params.nonce },
  });

  if (!challenge || challenge.address !== params.address) {
    return { ok: false, failure: { status: 400, error: "Reto inválido" } };
  }
  if (challenge.usedAt) {
    return { ok: false, failure: { status: 400, error: "Reto ya utilizado" } };
  }
  if (challenge.expiresAt < new Date()) {
    return { ok: false, failure: { status: 400, error: "Reto expirado" } };
  }

  const signatureOk = verifyStellarSignature({
    address: params.address,
    message: challenge.message,
    signature: params.signature,
  });
  if (!signatureOk) {
    return { ok: false, failure: { status: 401, error: "Firma inválida" } };
  }

  const user = await resolveWalletAccount({
    address: params.address,
    email: challenge.email,
  });
  if (!user) {
    return {
      ok: false,
      failure: {
        status: 404,
        error:
          "No hay una cuenta vinculada a esta wallet. Regístrate primero.",
      },
    };
  }

  // Single-use: burn the challenge before handing out a token.
  const consumed = await prisma.walletChallenge.updateMany({
    where: { id: challenge.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    return { ok: false, failure: { status: 400, error: "Reto ya utilizado" } };
  }

  return { ok: true, identity: { address: params.address, userId: user.id } };
}

function getSecret(): string | null {
  return process.env.NEXTAUTH_SECRET ?? null;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Mints a short-lived bearer token for a verified wallet identity.
 * Format: `base64url(payload).base64url(hmacSha256(payload))`, signed with
 * NEXTAUTH_SECRET. Deliberately not a NextAuth session cookie: wallet users
 * have no password account, and the token is scoped to wallet mutations.
 */
export function issueWalletToken(identity: ValidatedWalletIdentity): string {
  const secret = getSecret();
  if (!secret) throw new Error("NEXTAUTH_SECRET no está configurado");

  const payload = Buffer.from(
    JSON.stringify({
      sub: identity.userId,
      wallet: identity.address,
      typ: "wallet",
      exp: Math.floor(Date.now() / 1000) + WALLET_TOKEN_TTL_SECONDS,
    })
  ).toString("base64url");

  return `${payload}.${signPayload(payload, secret)}`;
}

/** Verifies a bearer token and returns the wallet identity it carries. */
export function verifyWalletToken(
  token: string
): ValidatedWalletIdentity | null {
  const secret = getSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = signPayload(payload, secret);
  const provided = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (
    provided.length !== expectedBuf.length ||
    !timingSafeEqual(provided, expectedBuf)
  ) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    parsed.typ !== "wallet" ||
    typeof parsed.sub !== "string" ||
    typeof parsed.wallet !== "string" ||
    typeof parsed.exp !== "number" ||
    parsed.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return { userId: parsed.sub, address: parsed.wallet };
}
