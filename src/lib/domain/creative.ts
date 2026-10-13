import { z } from "zod"

export const creativeIntakeSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  channel: z.string().trim().max(100).optional().or(z.literal("")),
  format: z.string().trim().max(100).optional().or(z.literal("")),
  plannedDate: z.string().trim().optional().or(z.literal("")),
})

export const creativeEditSchema = z.object({
  copy: z.string().trim().max(10000).optional().or(z.literal("")),
  assetUrl: z.url().optional().or(z.literal("")),
})
