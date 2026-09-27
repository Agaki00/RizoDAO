import { NextRequest, NextResponse } from "next/server";
import {
  type CredentialRecord,
  getCredentials,
  mintCredential,
} from "@/lib/sbtContract";
import { getAuthUser } from "@/lib/getAuthUser";
import { credentialRequestSchema, validateBody } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "Wallet requerida" }, { status: 400 });
  }

  try {
    const credentials = await getCredentials(wallet);
    const issuer = process.env.STELLAR_ISSUER_PUBLIC_KEY;
    // Cada credencial on-chain está firmada por el admin del contrato; marcamos
    // explícitamente las que provienen del issuer configurado.
    const records: CredentialRecord[] = credentials.map((credential) => ({
      ...credential,
      verified: issuer ? credential.issuer === issuer : true,
    }));

    return NextResponse.json({ credentials: records });
  } catch (error) {
    // Un fallo de RPC no es una lista vacía: lo exponemos para que la UI pueda
    // mostrar "RPC Connection Error" en lugar de "No credentials found".
    console.error("[/api/credentials][GET]", error);
    return NextResponse.json(
      { credentials: [], error: "No se pudo consultar el contrato SBT" },
      { status: 502 }
    );
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

  // An authenticated user may only issue to their own linked wallet.
  if (!user.stellarPublicKey || wallet !== user.stellarPublicKey) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const credentialId = await mintCredential(wallet, credentialType);
    return NextResponse.json({ ok: true, credentialId });
  } catch (error) {
    console.error("[/api/credentials][POST]", error);
    return NextResponse.json(
      { error: "No se pudo emitir la credencial SBT" },
      { status: 502 }
    );
  }
}
