-- Keep existing domain copies safe when this foundation migration is applied
-- after an organization sync. A zero baseline lets any admin snapshot (whose
-- first revision is one) converge on the next delivery.
CREATE TABLE `organizations__sync_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text NOT NULL,
	`is_disabled` text NOT NULL,
	`created_at` text NOT NULL,
	`sync_revision` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `organizations__sync_revision`
	(`id`, `name`, `plan`, `is_disabled`, `created_at`, `sync_revision`)
SELECT `id`, `name`, `plan`, `is_disabled`, `created_at`, 0
FROM `organizations`;
--> statement-breakpoint
DROP TABLE `organizations`;
--> statement-breakpoint
ALTER TABLE `organizations__sync_revision` RENAME TO `organizations`;
