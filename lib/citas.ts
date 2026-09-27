import { z } from "zod";

// Every appointment blocks a fixed slot on the stylist's calendar
export const SLOT_MINUTES = 60;
const SLOT_MS = SLOT_MINUTES * 60_000;

// Statuses that keep a slot occupied
export const ACTIVE_STATUSES = ["pending", "confirmed"];

export const createCitaSchema = z.object({
  stylistId: z.string().min(1, "stylistId es requerido"),
  // ISO datetime (preferred, carries the client timezone) or YYYY-MM-DD combined with time
  date: z.string().min(1, "date es requerido"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time debe tener formato HH:mm").optional(),
  notes: z.string().trim().max(500, "Las notas no pueden superar 500 caracteres").optional(),
  tokensUsed: z.number().int().min(0).optional(),
  usdcAmount: z.number().min(0).optional(),
});

export function parseAppointmentDate(date: string, time?: string): Date | null {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(date) && time ? `${date}T${time}:00` : date;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Any existing appointment starting less than one slot before or after `start` overlaps it
export function overlapWindow(start: Date) {
  return {
    gt: new Date(start.getTime() - SLOT_MS),
    lt: new Date(start.getTime() + SLOT_MS),
  };
}
