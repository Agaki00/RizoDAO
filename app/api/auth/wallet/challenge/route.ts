import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateBody, walletChallengeSchema } from "@/lib/validations";
import { createWalletChallenge } from "@/lib/walletAuth";

/**
 * POST /api/auth/wallet/challenge
 *
 * Issues a one-time nonce + message for a Stellar address. The client signs
 * the message with its wallet and submits it to /api/auth/wallet/verify.
 */
export async function POST(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Validate body
  const { data, error: valError } = await validateBody(
    req,
    walletChallengeSchema
  );
  if (valError) return valError;

  try {
    const challenge = await createWalletChallenge({
      address: data!.stellarAddress,
      email: data!.email,
    });

    return NextResponse.json(challenge, { status: 201 });
  } catch (error) {
    console.error("[/api/auth/wallet/challenge]", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
