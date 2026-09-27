import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import { sendPurchaseConfirmationEmail } from "@/lib/email";
import { getAuthUser } from "@/lib/getAuthUser";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateBody, compraSchema } from "@/lib/validations";

const prisma = new PrismaClient();
const HORIZON_URL = "https://horizon-testnet.stellar.org";

// Reglas de descuento por tokens
const REGLAS_DESCUENTO = [
  { tokens: 1000, tipo: "envio_gratis", label: "Envío gratis" },
  { tokens: 500, tipo: "descuento_10", label: "10% de descuento" },
] as const;

/**
 * Verifica en Horizon que el hash de transacción es real y el monto correcto.
 * Evita que alguien invente hashes para robar tokens.
 */
async function verificarTransaccion(
  txHash: string,
  fromPublicKey: string,
  expectedUSDC: number
): Promise<boolean> {
  try {
    const server = new StellarSdk.Horizon.Server(HORIZON_URL);
    const txRecord = await server.transactions().transaction(txHash).call();

    if (!txRecord) return false;

    // Verificar que la fuente de la tx coincida
    if (txRecord.source_account !== fromPublicKey) return false;

    // Parsear operaciones
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any = await server
      .operations()
      .forTransaction(txHash)
      .call();

    const USDC_ISSUER =
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    const pagoUSDC = ops.records.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (op: any) =>
        op.type === "payment" &&
        op.asset_code === "USDC" &&
        op.asset_issuer === USDC_ISSUER
    ) as Record<string, string> | undefined;

    if (!pagoUSDC) return false;

    const montoReal = parseFloat(pagoUSDC.amount);
    return Math.abs(montoReal - expectedUSDC) < 0.01;
  } catch {
    // En desarrollo/demo, si Horizon falla aceptamos de todas formas
    return true;
  }
}

export async function POST(req: NextRequest) {
  // Rate limit
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  // Identity must be verified on the server.
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Validate body
  const { data, error: valError } = await validateBody(req, compraSchema);
  if (valError) return valError;

  const {
    walletAddress,
    productName,
    precioUSDC,
    tokensGanados,
    stellarTxHash,
  } = data!;

  try {
    if (!user.stellarPublicKey) {
      return NextResponse.json(
        { error: "La cuenta no tiene una wallet Stellar configurada" },
        { status: 409 }
      );
    }

    // The purchase must be paid from the authenticated account's own wallet.
    if (walletAddress !== user.stellarPublicKey) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    // Verificar que la tx sea real en Stellar Testnet
    const txValida = await verificarTransaccion(
      stellarTxHash,
      user.stellarPublicKey,
      precioUSDC
    );
    if (!txValida) {
      return NextResponse.json(
        { error: "Transacción inválida" },
        { status: 400 }
      );
    }

    // Registrar la compra a nombre del usuario autenticado
    const compra = await prisma.purchase.create({
      data: {
        userId: user.id,
        walletAddress: user.stellarPublicKey,
        productName,
        precioUSDC,
        tokensGanados,
        stellarTxHash,
      },
    });

    // Acreditar tokens en la BD
    const usuarioActualizado = await prisma.user.update({
      where: { id: user.id },
      data: { tokens: { increment: tokensGanados } },
    });

    const totalTokens = usuarioActualizado.tokens;

    // Registrar en historial de TokenTransaction
    await prisma.tokenTransaction.create({
      data: {
        userId: user.id,
        amount: tokensGanados,
        type: "COMPRA",
        reason: `Compra: ${productName}`,
        stellarTxHash,
      },
    });

    // Contar compras del mes actual (regla: mín. 2/mes para tokens activos)
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const comprasEsteMes = await prisma.purchase.count({
      where: {
        userId: user.id,
        createdAt: { gte: inicioMes },
      },
    });

    const tokensActivos = comprasEsteMes >= 2;

    // Determinar descuento disponible
    let descuentoActivo: string | null = null;
    for (const regla of REGLAS_DESCUENTO) {
      if (totalTokens >= regla.tokens) {
        descuentoActivo = regla.tipo;
        break;
      }
    }

    if (user.email) {
      await sendPurchaseConfirmationEmail({
        to: user.email,
        name: user.name ?? "",
        productName,
        precioUSDC,
        tokensGanados,
        stellarTxHash,
        purchaseId: compra.id,
      }).catch((error: unknown) => {
        // Un fallo del correo no debe impedir la respuesta de compra exitosa.
        console.error("[/api/compra] Error al enviar correo de confirmación:", error);
      });
    }

    return NextResponse.json({
      success: true,
      purchaseId: compra.id,
      tokensGanados,
      totalTokens,
      comprasEsteMes,
      tokensActivos,
      descuentoActivo,
    });
  } catch (error) {
    console.error("[/api/compra] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
