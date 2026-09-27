import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getAuthUser } from "@/lib/getAuthUser";

const prisma = new PrismaClient();

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id: userId } = await params;

    // Counts stay public; the viewer's follow state is derived from the
    // server session (or a verified wallet token) instead of caller headers.
    const [user, currentUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      getAuthUser(req),
    ]);

    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const [followers, following, relationship] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      currentUser
        ? prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: currentUser.id, followingId: userId } },
            select: { followerId: true },
          })
        : null,
    ]);

    return NextResponse.json({
      followers,
      following,
      isFollowing: Boolean(relationship),
    });
  } catch (error) {
    console.error("Error obteniendo seguidores:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
