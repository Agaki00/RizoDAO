"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CalendarCheck2, CheckCircle2, LockKeyhole } from "lucide-react";
import AppointmentCard, { AgendaAppointment, AppointmentStatus } from "@/components/agenda/AppointmentCard";

type ApiCita = {
  id: string;
  userId: string;
  stylistId: string | null;
  stylistName: string;
  date: string;
  notes: string | null;
  status: string;
  user: { id: string; name: string | null; email: string };
};

type AgendaItem = AgendaAppointment & { incoming: boolean };

function isProfessional(role: string | null) {
  return role === "ESTILISTA" || role === "PROFESIONAL";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function toStatus(status: string): AppointmentStatus {
  return status === "confirmed" || status === "cancelled" ? status : "pending";
}

function toAgendaItem(cita: ApiCita, userId: string): AgendaItem {
  const incoming = cita.stylistId === userId;
  const date = new Date(cita.date);
  const name = incoming ? cita.user.name || cita.user.email.split("@")[0] : cita.stylistName;

  return {
    id: cita.id,
    incoming,
    clientName: name,
    clientInitials: initials(name),
    service: incoming ? "Solicitud de cita" : "Tu reserva",
    date: date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" }),
    time: `${date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} h`,
    notes: cita.notes ?? undefined,
    status: toStatus(cita.status),
  };
}

export default function AgendaPage() {
  const { data: session, status } = useSession();
  const [appointments, setAppointments] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const userId = session?.user?.id;
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;
  const professional = isProfessional(role);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    fetch("/api/citas")
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<ApiCita[]>;
      })
      .then((data) => {
        if (!active) return;
        setAppointments(data.map((cita) => toAgendaItem(cita, userId)));
        setError("");
      })
      .catch(() => { if (active) setError("No pudimos cargar tus citas. Intenta de nuevo más tarde."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const updateStatus = async (id: string, next: "confirmed" | "cancelled") => {
    const appointment = appointments.find((item) => item.id === id);
    setBusyId(id);
    try {
      const response = await fetch(`/api/citas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "No pudimos actualizar la cita.");
        return;
      }
      setError("");
      setAppointments((items) => items.map((item) => item.id === id ? { ...item, status: next } : item));
      if (appointment) {
        setConfirmation(next === "confirmed"
          ? `La cita de ${appointment.clientName} fue confirmada.`
          : `La cita con ${appointment.clientName} fue cancelada.`);
      }
    } catch {
      setError("No pudimos conectar con el servidor.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmAppointment = (id: string) => updateStatus(id, "confirmed");
  const cancelAppointment = (id: string) => updateStatus(id, "cancelled");

  if (status === "loading" || (status === "authenticated" && loading && !appointments.length && !error)) {
    return <div className="max-w-6xl mx-auto px-6 py-20"><div className="w-8 h-8 border-2 border-[#8D6E63] border-t-transparent rounded-full animate-spin mx-auto" /></div>;
  }

  if (status !== "authenticated") {
    return (
      <div className="max-w-lg mx-auto px-6 py-20 text-center">
        <div className="w-12 h-12 rounded-2xl bg-[#EFEBE9] text-[#8D6E63] flex items-center justify-center mx-auto mb-4"><LockKeyhole className="w-6 h-6" /></div>
        <h1 className="text-2xl font-bold text-[#3E2723]" style={{ fontFamily: "var(--font-playfair)" }}>Tu agenda</h1>
        <p className="text-sm text-[#6D4C41] mt-3">Inicia sesión para ver tus citas y las solicitudes de tus clientes.</p>
        <Link href="/login" className="inline-flex mt-6 bg-[#8D6E63] text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-[#6D4C41] transition-colors">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  // Stylists manage incoming requests, clients see the bookings they made
  const primary = appointments.filter((appointment) => appointment.incoming === professional);
  const ownBookings = professional ? appointments.filter((appointment) => !appointment.incoming) : [];

  const pending = primary.filter((appointment) => appointment.status === "pending");
  const confirmed = primary.filter((appointment) => appointment.status === "confirmed");
  const cancelled = primary.filter((appointment) => appointment.status === "cancelled");

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[#8D6E63] text-white flex items-center justify-center"><CalendarCheck2 className="w-5 h-5" /></div>
            <h1 className="text-2xl md:text-3xl font-bold text-[#3E2723]" style={{ fontFamily: "var(--font-playfair)" }}>Mi agenda</h1>
          </div>
          <p className="text-sm text-[#6D4C41]">
            {professional ? "Gestiona las solicitudes y citas confirmadas de tus clientes." : "Consulta el estado de las citas que agendaste con estilistas."}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-[#FFF3CD] text-[#8A5A00] px-3 py-1.5 font-medium">{pending.length} pendientes</span>
          <span className="rounded-full bg-[#E1F5EE] text-[#0F6E56] px-3 py-1.5 font-medium">{confirmed.length} confirmadas</span>
        </div>
      </div>

      {confirmation && <div role="status" className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-[#B7E4C7] bg-[#E1F5EE] px-4 py-3 text-sm text-[#0F6E56]"><span className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5" />{confirmation}</span><button onClick={() => setConfirmation("")} aria-label="Cerrar confirmación" className="font-bold">×</button></div>}
      {error && <div role="alert" className="mb-6 rounded-2xl bg-[#FEE4E2] px-4 py-3 text-sm text-[#B42318]">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <section className="bg-[#FFFDF8] rounded-3xl border border-[#E6D6B2] p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4"><h2 className="font-semibold text-[#3E2723]">Por confirmar</h2><span className="text-xs font-medium text-[#8A5A00] bg-[#FFF3CD] rounded-full px-2.5 py-1">{pending.length}</span></div>
          <div className="space-y-3">
            {pending.length ? pending.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onConfirm={professional ? confirmAppointment : undefined}
                onCancel={cancelAppointment}
                busy={busyId === appointment.id}
              />
            )) : <EmptyAgenda text={professional ? "No tienes solicitudes pendientes." : "No tienes reservas pendientes."} />}
          </div>
        </section>
        <section className="bg-[#FBFFFC] rounded-3xl border border-[#B7E4C7] p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4"><h2 className="font-semibold text-[#3E2723]">Próximas citas</h2><span className="text-xs font-medium text-[#0F6E56] bg-[#E1F5EE] rounded-full px-2.5 py-1">{confirmed.length}</span></div>
          <div className="space-y-3">
            {confirmed.length ? confirmed.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} onCancel={cancelAppointment} busy={busyId === appointment.id} />
            )) : <EmptyAgenda text="Tus citas confirmadas aparecerán aquí." />}
          </div>
        </section>
      </div>

      {!professional && primary.length === 0 && (
        <p className="mt-6 text-sm text-center text-[#6D4C41]">
          ¿Aún no tienes citas? <Link href="/estilistas" className="font-medium text-[#8D6E63] underline">Encuentra una estilista</Link>
        </p>
      )}

      {ownBookings.length > 0 && <section className="mt-6"><h2 className="text-sm font-semibold text-[#6D4C41] mb-3">Mis reservas con otras estilistas</h2><div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{ownBookings.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onCancel={appointment.status === "cancelled" ? undefined : cancelAppointment} busy={busyId === appointment.id} />)}</div></section>}

      {cancelled.length > 0 && <section className="mt-6"><h2 className="text-sm font-semibold text-[#6D4C41] mb-3">Canceladas</h2><div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{cancelled.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} />)}</div></section>}
    </div>
  );
}

function EmptyAgenda({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-[#D7CCC8] bg-white/70 py-10 px-4 text-center text-sm text-[#A1887F]">{text}</div>;
}
