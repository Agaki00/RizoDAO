"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Leaf,
  Palette,
  Sparkles,
  Wind,
  BadgeCheck,
  Send,
  Wallet,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import CredentialCard from "@/components/profesionales/CredentialCard";
import {
  CREDENTIAL_TYPES,
  type CredentialRecord,
  type CredentialType,
} from "@/lib/sbtContract";

const CREDENTIAL_METADATA: Record<
  CredentialType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  curl_specialist: { label: "Especialista en Rizos", icon: Sparkles },
  natural_hair: { label: "Cabello Natural", icon: Leaf },
  loc_stylist: { label: "Estilista de Locs", icon: Wind },
  color_specialist: { label: "Especialista en Color", icon: Palette },
};

type CredentialsTabProps = {
  walletAddress?: string | null;
};

export default function CredentialsTab({ walletAddress }: CredentialsTabProps) {
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [selectedType, setSelectedType] = useState<CredentialType>("curl_specialist");
  const [showRequestPanel, setShowRequestPanel] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Distinguible de "sin credenciales": un fallo de conexión con Soroban RPC.
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchCredentials = async () => {
      if (!walletAddress) {
        setCredentials([]);
        setRpcError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setRpcError(null);
      try {
        const res = await fetch(
          `/api/credentials?wallet=${encodeURIComponent(walletAddress)}`
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (!cancelled) {
            setCredentials([]);
            setRpcError(
              (data as { error?: string }).error ??
                "No pudimos conectar con la red Soroban."
            );
          }
          return;
        }

        if (!cancelled) {
          setCredentials(Array.isArray(data.credentials) ? data.credentials : []);
        }
      } catch {
        if (!cancelled) {
          setCredentials([]);
          setRpcError("No pudimos conectar con la red Soroban.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchCredentials();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  const requestedTypes = useMemo(
    () => new Set(credentials.map((credential) => credential.credentialType)),
    [credentials]
  );

  const canRequest = Boolean(walletAddress);

  const requestCredential = async () => {
    if (!walletAddress || requesting) return;

    setRequesting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          credentialType: selectedType,
        }),
      });

      if (!res.ok) {
        throw new Error("Solicitud no iniciada");
      }

      setFeedback("Credencial emitida on-chain. Recargando tus credenciales...");
      setShowRequestPanel(false);
      retry();
    } catch {
      setFeedback("No pudimos emitir la credencial. Intenta de nuevo.");
    } finally {
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-8 h-8 border-2 border-[#8D6E63] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-[#A1887F]">Consultando credenciales on-chain...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E1F5EE] px-2.5 py-1 text-xs font-medium text-[#0F6E56] mb-2">
            <Wallet className="w-3.5 h-3.5" />
            SBT / Web3
          </span>
          <h2
            className="text-lg font-bold text-[#3E2723]"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Credenciales verificadas
          </h2>
        </div>
        <button
          onClick={() => setShowRequestPanel((prev) => !prev)}
          disabled={!canRequest}
          className="inline-flex items-center gap-2 bg-[#8D6E63] text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-[#6D4C41] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          Solicitar credencial
        </button>
      </div>

      {showRequestPanel && (
        <div className="bg-white rounded-2xl border border-[#D7CCC8] p-4 mb-6">
          <label className="block text-xs text-[#A1887F] mb-2">Tipo de credencial</label>
          <div className="flex gap-3 flex-wrap">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as CredentialType)}
              className="min-w-56 rounded-xl border border-[#D7CCC8] bg-[#FAF8F5] px-3 py-2 text-sm text-[#3E2723] focus:outline-none focus:ring-2 focus:ring-[#8D6E63]/20"
            >
              {CREDENTIAL_TYPES.map((type) => (
                <option key={type} value={type} disabled={requestedTypes.has(type)}>
                  {CREDENTIAL_METADATA[type].label}
                  {requestedTypes.has(type) ? " (ya obtenida)" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={requestCredential}
              disabled={requesting}
              className="bg-[#8D6E63] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#6D4C41] transition-colors disabled:opacity-60"
            >
              {requesting ? "Emitiendo..." : "Emitir credencial"}
            </button>
          </div>
        </div>
      )}

      {feedback && <p className="text-sm text-[#6D4C41] mb-4">{feedback}</p>}

      {/* Estado 1: error de conexión con Soroban RPC */}
      {rpcError ? (
        <div
          role="alert"
          className="bg-white rounded-2xl border border-[#E9B4AC] py-12 px-6 text-center"
        >
          <div className="w-12 h-12 mx-auto rounded-xl bg-[#FBEAF2] border border-[#E9B4AC] flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-[#B3261E]" />
          </div>
          <p
            className="text-base font-semibold text-[#3E2723]"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            RPC Connection Error
          </p>
          <p className="text-sm text-[#A1887F] mt-1">{rpcError}</p>
          <button
            onClick={retry}
            className="mt-5 inline-flex items-center gap-2 bg-[#8D6E63] text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-[#6D4C41] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
        </div>
      ) : credentials.length === 0 ? (
        /* Estado 2: sin credenciales emitidas */
        <div className="bg-white rounded-2xl border border-[#D7CCC8] py-16 px-6 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-[#EFEBE9] border border-[#D7CCC8] flex items-center justify-center mb-4">
            <BadgeCheck className="w-6 h-6 text-[#8D6E63]" />
          </div>
          <p
            className="text-base font-semibold text-[#3E2723]"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Aun no tienes credenciales verificadas
          </p>
          <p className="text-sm text-[#A1887F] mt-1">
            {walletAddress
              ? "Solicita tu primera certificacion y destaca tu especializacion para toda la comunidad."
              : "Conecta una wallet Stellar para consultar y solicitar credenciales SBT."}
          </p>
        </div>
      ) : (
        /* Estado 3: badges SBT verificados on-chain */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {credentials.map((credential) => {
            const meta = CREDENTIAL_METADATA[credential.credentialType];
            const Icon = meta.icon;
            return (
              <CredentialCard
                key={credential.id || `${credential.credentialType}-${credential.issuedAt}`}
                specialization={meta.label}
                dateObtained={credential.issuedAt}
                icon={<Icon className="w-5 h-5" />}
                verified={credential.verified}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
