CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_number` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`purpose_ids_json` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_kana` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text,
	`recital` text NOT NULL,
	`reservation_memo` text,
	`handoff_note` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_org_number_unique_idx` ON `reservations` (`organization_id`,`reservation_number`);--> statement-breakpoint
CREATE INDEX `reservations_org_store_start_idx` ON `reservations` (`organization_id`,`store_id`,`start_at`);