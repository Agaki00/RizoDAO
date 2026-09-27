import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ACTIVE_STATUSES, createCitaSchema, overlapWindow, parseAppointmentDate } from "@/lib/citas";

function getUserId(session: Awaited<ReturnType<typeof getServerSession<typeof authOptions>>>): string {
  return String(session?.user?.id ?? "");
}

class SlotTakenError extends Error {}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const userId = getUserId(session);

    // Appointments booked by the user plus appointments booked with the user as stylist
    const citas = await prisma.appointment.findMany({
      where: { OR: [{ userId }, { stylistId: userId }] },
      orderBy: { date: "asc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json(citas);
  } catch (error) {
    console.error("[/api/citas GET]", error);
    return NextResponse.json(
      { error: "Error al obtener citas" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const userId = getUserId(session);
    const parsed = createCitaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      );
    }

    const { stylistId, date, time, notes, tokensUsed, usdcAmount } = parsed.data;

    const appointmentDate = parseAppointmentDate(date, time);
    if (!appointmentDate) {
      return NextResponse.json(
        { error: "Formato de fecha inválido" },
        { status: 400 }
      );
    }

    if (appointmentDate <= new Date()) {
      return NextResponse.json(
        { error: "La fecha debe ser en el futuro" },
        { status: 400 }
      );
    }

    if (stylistId === userId) {
      return NextResponse.json(
        { error: "No puedes agendar una cita contigo misma" },
        { status: 400 }
      );
    }

    const stylist = await prisma.user.findFirst({
      where: { id: stylistId, role: "ESTILISTA" },
      select: { id: true, name: true, email: true },
    });
    if (!stylist) {
      return NextResponse.json({ error: "Estilista no encontrada" }, { status: 404 });
    }

    // Serializable transaction so two concurrent requests cannot both grab the same slot
    const cita = await prisma.$transaction(
      async (tx) => {
        const overlapping = await tx.appointment.findFirst({
          where: {
            stylistId: stylist.id,
            status: { in: ACTIVE_STATUSES },
            date: overlapWindow(appointmentDate),
          },
          select: { id: true },
        });
        if (overlapping) throw new SlotTakenError();

        return tx.appointment.create({
          data: {
            userId,
            stylistId: stylist.id,
            stylistName: stylist.name || stylist.email.split("@")[0],
            date: appointmentDate,
            notes: notes || null,
            tokensUsed: tokensUsed || 0,
            usdcAmount: usdcAmount || 0,
            status: "pending",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json(cita, { status: 201 });
  } catch (error) {
    const serializationConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    if (error instanceof SlotTakenError || serializationConflict) {
      return NextResponse.json(
        { error: "Ese horario ya está ocupado. Elige otro." },
        { status: 409 }
      );
    }
    console.error("[/api/citas POST]", error);
    return NextResponse.json(
      { error: "Error al crear cita" },
      { status: 500 }
    );
  }
}
