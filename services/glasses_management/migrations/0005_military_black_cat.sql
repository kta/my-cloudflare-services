CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`primary_store_id` text NOT NULL,
	`name` text NOT NULL,
	`kana` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`email` text,
	`visit_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_org_phone_idx` ON `customers` (`organization_id`,`phone_normalized`);--> statement-breakpoint
CREATE INDEX `customers_org_primary_store_idx` ON `customers` (`organization_id`,`primary_store_id`);--> statement-breakpoint
ALTER TABLE `reservations` ADD `customer_id` text;