import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateBody, walletVerifySchema } from "@/lib/validations";
import {
  WALLET_TOKEN_TTL_SECONDS,
  issueWalletToken,
  verifyWalletChallenge,
} from "@/lib/walletAuth";

/**
 * POST /api/auth/wallet/verify
 *
 * Verifies the wallet signature over a previously issued challenge and returns
 * a short-lived bearer token. Mutating routes accept that token through the
 * `Authorization: Bearer <token>` header.
 */
export async function POST(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Validate body
  const { data, error: valError } = await validateBody(
    req,
    walletVerifySchema
  );
  if (valError) return valError;

  try {
    const result = await verifyWalletChallenge({
      address: data!.stellarAddress,
      nonce: data!.nonce,
      signature: data!.signature,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.failure.error },
        { status: result.failure.status }
      );
    }

    const token = issueWalletToken(result.identity);

    return NextResponse.json({
      token,
      tokenType: "Bearer",
      expiresIn: WALLET_TOKEN_TTL_SECONDS,
      address: result.identity.address,
    });
  } catch (error) {
    console.error("[/api/auth/wallet/verify]", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
