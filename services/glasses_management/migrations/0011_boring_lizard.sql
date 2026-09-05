CREATE TABLE `terminal_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`credential_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminal_devices_hash_idx` ON `terminal_devices` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `terminal_devices_org_terminal_idx` ON `terminal_devices` (`organization_id`,`terminal_id`);--> statement-breakpoint
ALTER TABLE `terminals` ADD `staff_id` text;