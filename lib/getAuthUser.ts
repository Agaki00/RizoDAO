import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyWalletToken } from "@/lib/walletAuth";

/**
 * Returns the user behind the current request, or null if the request is not
 * authenticated. Identity always comes from a server-verifiable source:
 *
 *   1. The NextAuth session (email/password accounts).
 *   2. A short-lived bearer token minted by /api/auth/wallet/verify after a
 *      Stellar signature challenge (wallet-only / Accesly accounts).
 *
 * Always use this instead of trusting an email or id sent by the client.
 */
export async function getAuthUser(req?: NextRequest) {
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id;
  if (sessionUserId) {
    return prisma.user.findUnique({ where: { id: sessionUserId } });
  }

  if (req) {
    const header = req.headers.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (token) {
      const identity = verifyWalletToken(token);
      if (identity) {
        const byId = await prisma.user.findUnique({
          where: { id: identity.userId },
        });
        if (byId) return byId;
        return prisma.user.findFirst({
          where: { stellarPublicKey: identity.address },
        });
      }
    }
  }

  return null;
}
