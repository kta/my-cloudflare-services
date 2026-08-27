CREATE TABLE `walkins` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`service_date` text NOT NULL,
	`sequence` integer NOT NULL,
	`customer_id` text,
	`status` text NOT NULL,
	`progress` text NOT NULL,
	`arrived_at` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `walkins_org_store_date_sequence_idx` ON `walkins` (`organization_id`,`store_id`,`service_date`,`sequence`);--> statement-breakpoint
CREATE INDEX `walkins_org_store_arrived_idx` ON `walkins` (`organization_id`,`store_id`,`arrived_at`);