import { NextRequest, NextResponse } from "next/server";
import {
  CREDENTIAL_TYPES,
  type CredentialRecord,
  type CredentialType,
  getCredentials,
  mintCredential,
} from "@/lib/sbtContract";

function isCredentialType(value: unknown): value is CredentialType {
  return typeof value === "string" && CREDENTIAL_TYPES.includes(value as CredentialType);
}

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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const payload = (body ?? {}) as { wallet?: unknown; credentialType?: unknown };
  const wallet = payload.wallet;
  const credentialType = payload.credentialType;

  if (typeof wallet !== "string" || !wallet || !isCredentialType(credentialType)) {
    return NextResponse.json(
      { error: "wallet y credentialType son requeridos" },
      { status: 400 }
    );
  }

  try {
    // `request_credential` no existe en el contrato: la emisión es un
    // `mint_sbt` firmado por el admin/issuer.
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
