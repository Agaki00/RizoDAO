import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getAuthUser } from "@/lib/getAuthUser";
import { productReviewFormSchema } from "@/lib/validations";

const prisma = new PrismaClient();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const reviews = await prisma.review.findMany({
      where: { productId: id },
      include: {
        user: { select: { name: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(reviews);
  } catch (error) {
    console.error("[/api/products/[id]/reviews GET]", error);
    return NextResponse.json({ error: "Error al obtener resenas" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Identity must come from a verified session/token, never from form data.
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const formData = await req.formData();

    const parsed = productReviewFormSchema.safeParse({
      rating: formData.get("rating"),
      content: (formData.get("content") as string) || undefined,
      curlType: formData.get("curlType"),
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json({ error: firstIssue.message }, { status: 400 });
    }

    const { rating, content, curlType } = parsed.data;
    const imageFile = formData.get("image") as File | null;

    let imageUrl: string | null = null;
    if (imageFile && imageFile.size > 0) {
      if (imageFile.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "La imagen no debe superar los 5MB" }, { status: 400 });
      }
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const base64 = `data:${imageFile.type};base64,${buffer.toString("base64")}`;
      imageUrl = base64;
    }

    const review = await prisma.review.create({
      data: {
        userId: user.id,
        productId: id,
        rating,
        content: content ?? null,
        curlType,
        imageUrl,
      },
      include: {
        user: { select: { name: true, avatar: true } },
      },
    });

    const allReviews = await prisma.review.findMany({
      where: { productId: id },
      select: { rating: true },
    });

    const avgRating = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
    const tokensEarned = 10;

    await prisma.product.update({
      where: { id },
      data: {
        rating: Math.round(avgRating * 10) / 10,
        votes: allReviews.length,
      },
    });

    await prisma.tokenTransaction.create({
      data: {
        userId: user.id,
        amount: tokensEarned,
        type: "RESENA",
        reason: "Resena de producto",
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { tokens: { increment: tokensEarned } },
    });

    return NextResponse.json({ review, tokensEarned }, { status: 201 });
  } catch (error) {
    console.error("[/api/products/[id]/reviews POST]", error);
    return NextResponse.json({ error: "Error al crear resena" }, { status: 500 });
  }
}
