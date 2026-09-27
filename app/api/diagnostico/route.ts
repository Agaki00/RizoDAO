import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/diagnostico?hairType=3A&porosity=media&thickness=media&length=largo
// Retorna productos filtrados por perfil capilar
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const hairType = searchParams.get("hairType") ?? "";
    const porosity = searchParams.get("porosity") ?? "";
    const thickness = searchParams.get("thickness") ?? "";

    const products = await prisma.product.findMany({
      orderBy: { rating: "desc" },
      take: 12,
    });

    const filtered = products.filter((p: any) => {
      if (!p.hairTypes) return true;
      const types = p.hairTypes.split(",").map((t: string) => t.trim().toUpperCase());
      return types.includes(hairType.toUpperCase());
    });

    const result = filtered.length >= 3 ? filtered : products;

    return NextResponse.json({
      products: result.slice(0, 6),
      profile: { hairType, porosity, thickness },
    });
  } catch (error) {
    console.error("[/api/diagnostico GET]", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST /api/diagnostico
// Guarda el perfil de rizo validado
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, hairType, porosity, thickness, length, curlPattern } = body;

    const userEmail = email;
    const finalPattern = curlPattern || hairType;

    if (!userEmail) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }

    const profileString = [finalPattern, porosity, thickness, length]
      .filter(Boolean)
      .join("|");

    await prisma.user.update({
      where: { email: userEmail },
      data: { hairType: profileString },
    });

    return NextResponse.json({ success: true, profile: profileString });
  } catch (error) {
    console.error("[/api/diagnostico POST]", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}