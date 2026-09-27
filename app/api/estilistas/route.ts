import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const stylists = await prisma.user.findMany({
      where: {
        role: "ESTILISTA",
      },
      select: {
        id: true,
        name: true,
        email: true,
        bio: true,
        hairType: true,
        verified: true,
        latitude: true,
        longitude: true,
        createdAt: true,
      },
    });

    // Real rating aggregates from stylist reviews
    const ratings = stylists.length
      ? await prisma.review.groupBy({
          by: ["stylistId"],
          where: { stylistId: { in: stylists.map((s) => s.id) } },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : [];
    const ratingByStylist = new Map(ratings.map((r) => [r.stylistId, r]));

    return NextResponse.json(
      stylists.map((stylist) => {
        const aggregate = ratingByStylist.get(stylist.id);
        return {
          ...stylist,
          rating: aggregate?._avg.rating ?? null,
          reviewCount: aggregate?._count._all ?? 0,
        };
      })
    );
  } catch (error) {
    console.error("Error fetching stylists:", error);
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    );
  }
}
