/**
 * Installed skill registry.
 *
 * Skill files remain filesystem-first under GlobalSkills. This table keeps the
 * stable local identity and the optional marketplace identity that points to
 * the same skill.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const skillsTable = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    remote_id: text('remote_id'),
    name: text('name').notNull(),
    description: text('description'),
    icon_url: text('icon_url'),
    preview_video_url: text('preview_video_url'),
    folder_name: text('folder_name').notNull(),
    source: text('source').notNull(),
    source_url: text('source_url'),
    namespace: text('namespace'),
    author: text('author'),
    tags: text('tags'),
    content_hash: text('content_hash').notNull(),
    is_enabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull()
  },
  (table) => ({
    skillsFolderNameUnique: uniqueIndex('skills_folder_name_unique').on(table.folder_name),
    skillsRemoteIdIdx: index('idx_skills_remote_id').on(table.remote_id),
    skillsSourceIdx: index('idx_skills_source').on(table.source),
    skillsEnabledIdx: index('idx_skills_is_enabled').on(table.is_enabled)
  })
)

export type SkillRow = typeof skillsTable.$inferSelect
export type InsertSkillRow = typeof skillsTable.$inferInsert
