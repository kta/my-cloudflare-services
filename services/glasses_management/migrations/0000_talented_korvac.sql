CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text,
	`is_disabled` text,
	`created_at` text NOT NULL,
	`revision` text
);
--> statement-breakpoint
CREATE TABLE `store_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permissions` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_memberships_org_user_store_unique_idx` ON `store_memberships` (`organization_id`,`user_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `store_memberships_org_store_idx` ON `store_memberships` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`access_note` text DEFAULT '' NOT NULL,
	`is_active` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stores_org_created_idx` ON `stores` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_org_slug_unique_idx` ON `stores` (`organization_id`,`slug`);