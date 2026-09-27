import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateSearchParams, userMeSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  const { data: params, error: valError } = validateSearchParams(
    req,
    userMeSchema
  );
  if (valError) return valError;

  try {
    const user = await prisma.user.findUnique({
  where: params!.id ? { id: params!.id } : { email: params!.email! },
      select: {
        id: true,
        email: true,
        name: true,
        bio: true,
        hairType: true,
        role: true,
        tokens: true,
        avatar: true,
        stellarPublicKey: true,
        onboardingCompleted: true,
        createdAt: true,
        _count: {
          select: {
            posts: true,
            reviews: true,
            following: true,
            followers: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("[/api/user/me]", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
