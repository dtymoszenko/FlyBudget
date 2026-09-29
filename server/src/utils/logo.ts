import { z } from 'zod';

// Logos (accounts, payees) are resized client-side to a small square; cap size defensively
export const logoSchema = z
  .string()
  .max(200_000)
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,
    'Logo must be a PNG, JPEG, or WebP data URL',
  )
  .nullable();
