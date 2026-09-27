/**
 * lib/sbtContract.ts
 * Cliente TypeScript para el contrato Soroban de credenciales SBT (RizoDAO).
 * SERVER-SIDE ONLY — no importar desde componentes cliente.
 *
 * Este cliente replica EXACTAMENTE la interfaz pública de
 * `contracts/rizo-sbt/src/lib.rs`:
 *
 *   initialize(admin)                          -> ()
 *   mint_sbt(stylist, credential_type_str)     -> u64   (solo el admin firma)
 *   get_credentials(stylist)                   -> Vec<SbtCredential>
 *   verify_credential(stylist, credential_id)  -> bool
 *
 * Estructura on-chain de `SbtCredential`:
 *   { id: u64, owner: Address, credential_type: CredentialType,
 *     name: String, issued_at: u64, issuer: Address }
 *
 * Notas de compatibilidad con el contrato:
 * - `credential_type_str` es un `soroban_sdk::String`, NO un `Symbol`. Enviarlo
 *   como símbolo hacía que `parse_credential_type` fallara en testnet.
 * - El contrato no expone `request_credential` ni `has_credential`: los SBT se
 *   emiten con `mint_sbt` firmado por el admin y la pertenencia se deriva de
 *   `get_credentials`.
 */

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";

const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const TX_POLL_ATTEMPTS = 15;
const TX_POLL_INTERVAL_MS = 2000;

export const CREDENTIAL_TYPES = [
  "curl_specialist",
  "natural_hair",
  "loc_stylist",
  "color_specialist",
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

/**
 * Credencial tal como la devuelve el contrato (`SbtCredential`).
 * `issuedAt` se expone como ISO-8601 derivado de `issued_at` (segundos Unix).
 */
export type SbtCredential = {
  id: string;
  owner: string;
  credentialType: CredentialType;
  name: string;
  issuedAt: string;
  issuer: string;
};

/** Credencial + bandera de verificación para la API interna. */
export type CredentialRecord = SbtCredential & { verified: boolean };

/**
 * Orden de los variantes en el enum `CredentialType` de Rust. Se usa cuando el
 * SDK decodifica el enum como índice (`ScVal::U32`) en lugar de nombre.
 */
const CREDENTIAL_TYPE_BY_INDEX: readonly CredentialType[] = [
  "curl_specialist",
  "natural_hair",
  "loc_stylist",
  "color_specialist",
];

/** Alias aceptados al normalizar el valor decodificado del enum. */
const CREDENTIAL_TYPE_ALIASES: Record<string, CredentialType> = {
  curlspecialist: "curl_specialist",
  curl: "curl_specialist",
  naturalhair: "natural_hair",
  natural: "natural_hair",
  locstylist: "loc_stylist",
  locs: "loc_stylist",
  colorspecialist: "color_specialist",
  color: "color_specialist",
};

function getContractId(): string {
  const id = process.env.SBT_CONTRACT_ID;
  if (!id) throw new Error("SBT_CONTRACT_ID no esta configurado en .env.local");
  return id;
}

function getRpcServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(SOROBAN_RPC, { allowHttp: false });
}

/**
 * `mint_sbt` / `has_credential` reciben `credential_type_str: String`, por lo
 * que debe serializarse como `ScVal::String` y no como `ScVal::Symbol`.
 */
function credentialTypeToScVal(credentialType: CredentialType): xdr.ScVal {
  return nativeToScVal(credentialType, { type: "string" });
}

export function isCredentialType(value: unknown): value is CredentialType {
  return typeof value === "string" && CREDENTIAL_TYPES.includes(value as CredentialType);
}

/** Normaliza el enum `CredentialType` en cualquiera de sus codificaciones. */
function normalizeCredentialType(raw: unknown): CredentialType | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return CREDENTIAL_TYPE_BY_INDEX[raw] ?? null;
  }

  if (typeof raw === "string") {
    const key = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (isCredentialType(key)) return key;
    return CREDENTIAL_TYPE_ALIASES[key] ?? null;
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const tag = record.tag ?? record.name ?? Object.keys(record)[0];
    return tag === undefined ? null : normalizeCredentialType(tag);
  }

  return null;
}

function asAddressString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (typeof record.accountId === "string") return record.accountId;
    if (typeof record.contractId === "string") return record.contractId;
  }
  return "";
}

/** Convierte `issued_at` (segundos Unix) o un ISO ya formateado a ISO-8601. */
function toIsoDate(raw: unknown): string | null {
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
    const value = Number(raw);
    // Los timestamps on-chain son segundos; toleramos milisegundos si ya vienen así.
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof raw === "string" && raw.length > 0) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toStringValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "bigint") return String(raw);
  return "";
}

/** Interpreta una respuesta nativa de `get_credentials` como `SbtCredential[]`. */
export function parseCredentials(raw: unknown): SbtCredential[] {
  if (!Array.isArray(raw)) return [];

  const parsed: SbtCredential[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const credentialType = normalizeCredentialType(
      record.credential_type ?? record.credentialType ?? record.type
    );
    if (!credentialType) continue;

    const issuedAt = toIsoDate(record.issued_at ?? record.issuedAt ?? record.date_obtained);
    if (!issuedAt) continue;

    parsed.push({
      id: toStringValue(record.id),
      owner: asAddressString(record.owner),
      credentialType,
      name: toStringValue(record.name),
      issuedAt,
      issuer: asAddressString(record.issuer),
    });
  }

  return parsed;
}

async function submitTx(
  methodName: string,
  args: xdr.ScVal[],
  signerSecret: string
): Promise<unknown> {
  const server = getRpcServer();
  const keypair = Keypair.fromSecret(signerSecret);
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(getContractId());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(methodName, ...args))
    .setTimeout(30)
    .build();

  const prepared = (await server.prepareTransaction(tx)) as Transaction;
  prepared.sign(keypair);

  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    throw new Error(`[sbt] submitTx(${methodName}) error: ${JSON.stringify(sendResult)}`);
  }

  for (let i = 0; i < TX_POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, TX_POLL_INTERVAL_MS));
    const response = await server.getTransaction(sendResult.hash);
    if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      const returnValue = (response as { returnValue?: xdr.ScVal }).returnValue;
      return returnValue === undefined ? null : scValToNative(returnValue);
    }
    if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`[sbt] transaccion fallida (${methodName}): ${sendResult.hash}`);
    }
  }

  throw new Error(`[sbt] timeout esperando confirmacion de ${methodName}: ${sendResult.hash}`);
}

async function simulateRead(methodName: string, args: xdr.ScVal[]): Promise<unknown> {
  const server = getRpcServer();
  const issuerPublicKey = process.env.STELLAR_ISSUER_PUBLIC_KEY;
  if (!issuerPublicKey) throw new Error("STELLAR_ISSUER_PUBLIC_KEY no configurado");

  const account = await server.getAccount(issuerPublicKey);
  const contract = new Contract(getContractId());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(methodName, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`[sbt] simulateRead(${methodName}) error: ${result.error}`);
  }

  if (!result.result?.retval) return null;
  return scValToNative(result.result.retval);
}

/**
 * Devuelve las credenciales on-chain de `userPublicKey`.
 * Lanza si la lectura RPC falla para que la API pueda distinguir un fallo de
 * conexión de una lista realmente vacía.
 */
export async function getCredentials(userPublicKey: string): Promise<SbtCredential[]> {
  const value = await simulateRead("get_credentials", [
    new Address(userPublicKey).toScVal(),
  ]);
  return parseCredentials(value);
}

/**
 * `has_credential` no existe en el contrato: la pertenencia se deriva de
 * `get_credentials`, evitando una llamada RPC a un método inexistente.
 */
export async function hasCredential(
  userPublicKey: string,
  credentialType: CredentialType
): Promise<boolean> {
  const credentials = await getCredentials(userPublicKey);
  return credentials.some((credential) => credential.credentialType === credentialType);
}

/**
 * Verifica que `credentialId` exista y pertenezca a `userPublicKey`
 * (`verify_credential`). Devuelve `false` cuando el contrato no la encuentra.
 */
export async function verifyCredential(
  userPublicKey: string,
  credentialId: string | number
): Promise<boolean> {
  try {
    const value = await simulateRead("verify_credential", [
      new Address(userPublicKey).toScVal(),
      nativeToScVal(BigInt(credentialId), { type: "u64" }),
    ]);
    return Boolean(value);
  } catch {
    return false;
  }
}

/**
 * Emite una credencial SBT con `mint_sbt`, firmada por el admin del contrato
 * (`STELLAR_ISSUER_SECRET_KEY`). Devuelve el ID asignado on-chain.
 */
export async function mintCredential(
  stylistPublicKey: string,
  credentialType: CredentialType
): Promise<string> {
  const issuerSecret = process.env.STELLAR_ISSUER_SECRET_KEY;
  if (!issuerSecret) {
    throw new Error("STELLAR_ISSUER_SECRET_KEY no configurado");
  }

  // El contrato sólo acepta `mint_sbt` del admin, por lo que la clave de firma
  // debe ser exactamente la configurada como issuer.
  const configuredIssuer = process.env.STELLAR_ISSUER_PUBLIC_KEY;
  const signerPublicKey = Keypair.fromSecret(issuerSecret).publicKey();
  if (configuredIssuer && configuredIssuer !== signerPublicKey) {
    throw new Error(
      "STELLAR_ISSUER_SECRET_KEY no corresponde a STELLAR_ISSUER_PUBLIC_KEY (admin del contrato)"
    );
  }

  const value = await submitTx(
    "mint_sbt",
    [new Address(stylistPublicKey).toScVal(), credentialTypeToScVal(credentialType)],
    issuerSecret
  );

  return toStringValue(value);
}
