import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateBody, walletSchema } from "@/lib/validations";

const prisma = new PrismaClient();

/** Public user fields — never return password hashes or Stellar secret keys. */
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  tokens: true,
  stellarPublicKey: true,
  onboardingCompleted: true,
} as const;

export async function POST(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Validate body
  const { data, error: valError } = await validateBody(req, walletSchema);
  if (valError) return valError;

  const { stellarAddress, email } = data!;

  try {
    const user = await prisma.user.findFirst({
      where: { email: email ?? "" },
      select: PUBLIC_USER_SELECT,
    });

    if (user) {
      const perfilCompleto = !!user.name && user.name !== email?.split("@")[0];
      // Existing accounts are not re-bound here: linking a wallet happens only
      // in /api/auth/wallet/verify after a signature challenge.
      return NextResponse.json({ isNew: !perfilCompleto, user });
    }

    // Crear usuario nuevo, vinculado a la wallet que acaba de conectar.
    const created = await prisma.user.create({
      data: {
        email: email ?? `${stellarAddress}@stellar.rizo`,
        name: email?.split("@")[0] ?? "Rizado/a",
        tokens: 0,
        stellarPublicKey: stellarAddress,
      },
      select: PUBLIC_USER_SELECT,
    });

    return NextResponse.json({ isNew: true, user: created });
  } catch (error) {
    console.error("[/api/auth/wallet]", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
