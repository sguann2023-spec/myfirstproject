ALTER TABLE `skills` ADD COLUMN `remote_id` text;
--> statement-breakpoint
CREATE INDEX `idx_skills_remote_id` ON `skills` (`remote_id`);
