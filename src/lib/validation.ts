import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "Brug 3-24 små bogstaver, tal eller underscore.");

export const passwordSchema = z
  .string()
  .min(1, "Skriv en adgangskode.")
  .max(64, "Adgangskoden må højst være 64 tegn.");

export const clanNameSchema = z
  .string()
  .trim()
  .min(2, "Navnet skal være mindst 2 tegn.")
  .max(64, "Navnet må højst være 64 tegn.");

export const uuidSchema = z.string().uuid("Ugyldigt id.");

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Koden skal være seks cifre.");

export function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
