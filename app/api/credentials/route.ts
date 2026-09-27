import { NextRequest, NextResponse } from "next/server";
import { getCredentials, requestCredential } from "@/lib/sbtContract";
import { getAuthUser } from "@/lib/getAuthUser";
import { credentialRequestSchema, validateBody } from "@/lib/validations";

export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet");
    if (!wallet) {
      return NextResponse.json({ error: "Wallet requerida" }, { status: 400 });
    }

    const credentials = await getCredentials(wallet);
    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("[/api/credentials][GET]", error);
    return NextResponse.json({ credentials: [] }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  // Identity must come from a verified session/token, not from the body.
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Validate body
  const { data, error: valError } = await validateBody(
    req,
    credentialRequestSchema
  );
  if (valError) return valError;

  const { wallet, credentialType } = data!;

  try {
    // A user may only request credentials for their own wallet.
    if (!user.stellarPublicKey || wallet !== user.stellarPublicKey) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    await requestCredential(wallet, credentialType);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[/api/credentials][POST]", error);
    return NextResponse.json(
      { error: "No se pudo iniciar la solicitud de credencial" },
      { status: 500 }
    );
  }
}
