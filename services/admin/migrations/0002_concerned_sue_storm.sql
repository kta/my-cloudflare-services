-- Existing admin databases may already contain seeded or live organizations.
-- Rebuild the table so the new non-null revision has a deterministic baseline
-- without relying on a DDL DEFAULT (the application owns all defaults).
CREATE TABLE `organizations__sync_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text NOT NULL,
	`is_disabled` text NOT NULL,
	`is_operator` text NOT NULL,
	`sync_revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `organizations__sync_revision`
	(`id`, `name`, `plan`, `is_disabled`, `is_operator`, `sync_revision`, `created_at`)
SELECT `id`, `name`, `plan`, `is_disabled`, `is_operator`, 0, `created_at`
FROM `organizations`;
--> statement-breakpoint
DROP TABLE `organizations`;
--> statement-breakpoint
ALTER TABLE `organizations__sync_revision` RENAME TO `organizations`;
