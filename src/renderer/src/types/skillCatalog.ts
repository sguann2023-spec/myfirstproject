import * as z from 'zod'

export const SkillCatalogAuthorSchema = z.object({
  id: z.string(),
  name: z.string()
})

export const SkillCatalogMediaSchema = z.object({
  type: z.enum(['image', 'video']),
  url: z.string(),
  poster_url: z.string().optional(),
  sort_order: z.number().optional()
})

export const SkillCatalogPackageSchema = z.object({
  type: z.enum(['zip', 'directory']),
  download_url: z.string().optional(),
  file_name: z.string().optional(),
  size: z.number().optional(),
  sha256: z.string().optional()
})

export const SkillCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  icon_url: z.string().optional().default(''),
  version: z.string().optional(),
  author: SkillCatalogAuthorSchema.optional(),
  tags: z.array(z.string()).default([]),
  featured_rank: z.number().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
})

export const SkillCatalogListResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.array(SkillCatalogItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number()
})

export const SkillCatalogDetailSchema = SkillCatalogItemSchema.extend({
  media: z.array(SkillCatalogMediaSchema).default([]),
  skill_md: z
    .object({
      content: z.string().default(''),
      updated_at: z.string().optional()
    })
    .optional(),
  package: SkillCatalogPackageSchema.optional()
})

export const SkillCatalogDetailResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: SkillCatalogDetailSchema
})

export type SkillCatalogItem = z.infer<typeof SkillCatalogItemSchema>
export type SkillCatalogDetail = z.infer<typeof SkillCatalogDetailSchema>
export type SkillCatalogListResponse = z.infer<typeof SkillCatalogListResponseSchema>
export type SkillCatalogDetailResponse = z.infer<typeof SkillCatalogDetailResponseSchema>
