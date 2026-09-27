import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthUser } from "@/lib/getAuthUser";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  validateBody,
  validateSearchParams,
  createPostSchema,
  paginationSchema,
} from "@/lib/validations";

/**
 * Feed query. `feed=siguiendo` returns only posts authored by users the viewer
 * follows, resolved from the persisted Follow table (lib/mockFollow.ts is gone).
 */
const postsQuerySchema = paginationSchema.extend({
  feed: z.enum(["todos", "siguiendo"]).default("todos"),
});

export async function GET(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Validate pagination + feed params
  const { data: params, error: valError } = validateSearchParams(
    req,
    postsQuerySchema
  );
  if (valError) return valError;

  const { cursor, limit, feed } = params!;

  try {
    let where: Prisma.PostWhereInput | undefined;
    let followingCount: number | null = null;

    if (feed === "siguiendo") {
      const viewer = await getAuthUser(req);

      if (!viewer) {
        // Not signed in (or unknown viewer): the "Siguiendo" feed is empty.
        return NextResponse.json({
          posts: [],
          nextCursor: null,
          hasMore: false,
          feed,
          followingCount: 0,
        });
      }

      // Posts whose author is followed by the viewer — one SQL join, no
      // client-side filtering and no localStorage.
      where = { user: { followers: { some: { followerId: viewer.id } } } };
      followingCount = await prisma.follow.count({
        where: { followerId: viewer.id },
      });
    }

    const query: Prisma.PostFindManyArgs = {
      orderBy: { createdAt: "desc" },
      take: limit + 1, // fetch one extra to detect next page
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            verified: true,
            hairType: true,
          },
        },
      },
      ...(where ? { where } : {}),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    };

    const posts = await prisma.post.findMany(query);

    const hasMore = posts.length > limit;
    const result = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? result[result.length - 1].id : null;

    return NextResponse.json({
      posts: result,
      nextCursor,
      hasMore,
      feed,
      followingCount,
    });
  } catch (error) {
    console.error("Error obteniendo posts:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Identity is resolved from the server session (or a verified wallet token).
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Validate body
  const { data, error: valError } = await validateBody(req, createPostSchema);
  if (valError) return valError;

  const { contenido } = data!;

  try {
    // Crear post
    const post = await prisma.post.create({
      data: {
        content: contenido,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            verified: true,
          },
        },
      },
    });

    // Otorgar tokens por publicar
    await prisma.user.update({
      where: { id: user.id },
      data: { tokens: { increment: 5 } },
    });
    await prisma.tokenTransaction.create({
      data: {
        userId: user.id,
        amount: 5,
        type: "GANADO",
        reason: "PUBLICAR en la plataforma",
      },
    });

    return NextResponse.json({ success: true, post });
  } catch (error) {
    console.error("Error creando post:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
