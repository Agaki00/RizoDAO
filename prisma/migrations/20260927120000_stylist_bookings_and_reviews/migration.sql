-- Stylist reviews: a review targets either a product or a stylist
ALTER TABLE "Review" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "Review" ADD COLUMN "stylistId" TEXT;
CREATE INDEX "Review_stylistId_idx" ON "Review"("stylistId");
ALTER TABLE "Review" ADD CONSTRAINT "Review_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Appointments: client notes and stylist relation for agenda lookups
ALTER TABLE "Appointment" ADD COLUMN "notes" TEXT;
UPDATE "Appointment" SET "stylistId" = NULL WHERE "stylistId" IS NOT NULL AND "stylistId" NOT IN (SELECT "id" FROM "User");
CREATE INDEX "Appointment_stylistId_date_idx" ON "Appointment"("stylistId", "date");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
