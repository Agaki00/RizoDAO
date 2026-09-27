import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getAuthUser } from "@/lib/getAuthUser";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  validateBody,
  validateSearchParams,
  createPostSchema,
  paginationSchema,
} from "@/lib/validations";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Validate pagination params
  const { data: params, error: valError } = validateSearchParams(
    req,
    paginationSchema
  );
  if (valError) return valError;

  const { cursor, limit } = params!;

  try {
    const query: Parameters<typeof prisma.post.findMany>[0] = {
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
    };

    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1; // skip the cursor item itself
    }

    const posts = await prisma.post.findMany(query);

    const hasMore = posts.length > limit;
    const result = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore ? result[result.length - 1].id : null;

    return NextResponse.json({
      posts: result,
      nextCursor,
      hasMore,
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
