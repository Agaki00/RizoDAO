import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as StellarSdk from "@stellar/stellar-sdk";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/encryption";
import { sendPurchaseConfirmationEmail } from "@/lib/email";
import { checkDiscount, registerPurchase } from "@/lib/loyaltyContract";
import { checkRateLimit } from "@/lib/rateLimit";
import { validateBody, pagoSchema } from "@/lib/validations";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const server = new StellarSdk.Horizon.Server(HORIZON_URL);
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new StellarSdk.Asset("USDC", USDC_ISSUER);

async function submitStellarPayment(
  secretKey: string,
  destination: string,
  amountUSDC: number
): Promise<string> {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const account = await server.loadAccount(keypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset: USDC,
        amount: amountUSDC.toFixed(7),
      })
    )
    .addMemo(StellarSdk.Memo.text("RIZO Tienda"))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

async function recordCompletedPurchase(params: {
  userId: string;
  walletAddress: string;
  productName: string;
  precioUSDC: number;
  tokensGanados: number;
  txHash: string;
  discountCode?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const compra = await tx.purchase.create({
      data: {
        userId: params.userId,
        walletAddress: params.walletAddress,
        productName: params.productName,
        precioUSDC: params.precioUSDC,
        tokensGanados: params.tokensGanados,
        stellarTxHash: params.txHash,
        status: "completed",
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: params.userId },
      data: { tokens: { increment: params.tokensGanados } },
    });

    await tx.tokenTransaction.create({
      data: {
        userId: params.userId,
        amount: params.tokensGanados,
        type: "COMPRA",
        reason: `Compra: ${params.productName}`,
        stellarTxHash: params.txHash,
      },
    });

    if (params.discountCode) {
      const updatedDiscount = await tx.discountCode.updateMany({
        where: {
          code: params.discountCode,
          userId: params.userId,
          used: false,
          expiresAt: { gt: new Date() },
        },
        data: { used: true, usedAt: new Date() },
      });
      if (updatedDiscount.count !== 1) {
        throw new Error("El código de descuento ya fue utilizado");
      }
    }

    return { compra, updatedUser };
  });
}

export async function POST(req: NextRequest) {
  const rlError = checkRateLimit(req);
  if (rlError) return rlError;

  const { data, error: valError } = await validateBody(req, pagoSchema);
  if (valError) return valError;

  const {
    userEmail,
    productName,
    paymentAsset,
    discountCode,
  } = data!;

  try {
    const session = await getServerSession(authOptions);
    const authenticatedEmail = session?.user?.email;

    if (!authenticatedEmail) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (authenticatedEmail.toLowerCase() !== userEmail.toLowerCase()) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { email: authenticatedEmail },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    const product = await prisma.product.findFirst({
      where: { name: productName },
    });
    if (!product) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }

    let discount = null;
    if (discountCode) {
      discount = await prisma.discountCode.findFirst({
        where: {
          code: discountCode,
          userId: user.id,
          used: false,
          expiresAt: { gt: new Date() },
        },
      });
      if (!discount) {
        return NextResponse.json(
          { error: "Código de descuento inválido o expirado" },
          { status: 400 }
        );
      }
    }

    if (paymentAsset !== "USDC") {
      return NextResponse.json(
        { error: "El pago con XLM no está disponible" },
        { status: 400 }
      );
    }

    const loyaltyDiscount = user.stellarPublicKey
      ? await checkDiscount(user.stellarPublicKey)
      : 0;
    const discountPercent = Math.max(
      loyaltyDiscount,
      discount?.discount ?? 0
    );
    const precioUSDC = product.price * (1 - discountPercent / 100);
    const tokensGanados = product.tokenPrice;

    const rizoWallet =
      process.env.NEXT_PUBLIC_RIZO_WALLET_ADDRESS ||
      process.env.STELLAR_ISSUER_PUBLIC_KEY;
    if (!rizoWallet) {
      console.error("[/api/pago] No hay wallet receptora configurada");
      return NextResponse.json(
        { error: "Pago no disponible temporalmente" },
        { status: 503 }
      );
    }

    if (!user.stellarSecretKey || !user.stellarPublicKey) {
      return NextResponse.json(
        { error: "La cuenta no tiene una wallet Stellar configurada" },
        { status: 409 }
      );
    }

    let txHash: string;
    try {
      txHash = await submitStellarPayment(
        decryptSecret(user.stellarSecretKey),
        rizoWallet,
        precioUSDC
      );
    } catch (stellarErr) {
      console.error("[/api/pago] No se pudo confirmar el pago en Stellar:", stellarErr);
      return NextResponse.json(
        { error: "No se pudo confirmar el pago. Intenta de nuevo." },
        { status: 502 }
      );
    }

    const { compra, updatedUser } = await recordCompletedPurchase({
      userId: user.id,
      walletAddress: user.stellarPublicKey,
      productName: product.name,
      precioUSDC,
      tokensGanados,
      txHash,
      discountCode,
    });

    if (
      user.stellarSecretKey &&
      user.stellarPublicKey &&
      process.env.LOYALTY_CONTRACT_ID
    ) {
      void Promise.resolve()
        .then(() =>
          registerPurchase(
            decryptSecret(user.stellarSecretKey!),
            tokensGanados * 10
          )
        )
        .catch((err) =>
        console.error("[loyalty] register_purchase falló:", err)
      );
    }

    void sendPurchaseConfirmationEmail({
      to: user.email,
      name: user.name ?? "",
      productName,
      precioUSDC,
      tokensGanados,
      stellarTxHash: txHash,
      purchaseId: compra.id,
    }).catch((error: unknown) => {
      console.error(
        "[/api/pago] Error al enviar correo de confirmación:",
        error
      );
    });

    return NextResponse.json({
      success: true,
      txHash,
      txOnChain: true,
      tokensGanados,
      totalTokens: updatedUser.tokens,
      purchaseId: compra.id,
    });
  } catch (error) {
    console.error("[/api/pago]", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
