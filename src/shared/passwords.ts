import { z } from 'zod';

/** Password manager entry as sent by the Passwords view (validated again in main). */
export const PasswordEntryInput = z.object({
  id: z
    .string()
    .regex(/^pw_[\w-]{4,40}$/)
    .optional(),
  title: z.string().trim().min(1).max(120),
  username: z.string().max(200).default(''),
  password: z.string().max(500).default(''),
  url: z.string().max(500).default(''),
  notes: z.string().max(5000).default(''),
  category: z.string().trim().max(40).default('Login'),
  /** Base32 secret for two-factor codes (RFC 6238), optional. */
  totpSecret: z
    .string()
    .max(200)
    .transform((s) => s.replace(/\s+/g, '').toUpperCase())
    .refine((s) => s === '' || /^[A-Z2-7]+=*$/.test(s), 'Not a valid two-factor secret (base32).')
    .default(''),
  favorite: z.boolean().default(false),
});
export type PasswordEntryInput = z.input<typeof PasswordEntryInput>;
