CREATE TABLE `pin_reset_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`verification_method` text NOT NULL,
	`verification_note` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pin_reset_tickets_org_user_idx` ON `pin_reset_tickets` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `user_admin_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_admin_audits_org_target_idx` ON `user_admin_audits` (`organization_id`,`target_user_id`);--> statement-breakpoint
CREATE TABLE `user_store_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`store_id` text NOT NULL,
	`permissions` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_store_assignments_org_user_store_unique_idx` ON `user_store_assignments` (`organization_id`,`user_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `user_store_assignments_org_store_idx` ON `user_store_assignments` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `user_store_assignments_org_user_idx` ON `user_store_assignments` (`organization_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `standard_role` text;