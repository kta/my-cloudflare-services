CREATE TABLE `customer_attention_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`body` text NOT NULL,
	`basis` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_on` text NOT NULL,
	`published_at` text,
	`hidden_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_attention_notes_org_customer_idx` ON `customer_attention_notes` (`organization_id`,`customer_id`,`recorded_on`);--> statement-breakpoint
CREATE INDEX `customer_attention_notes_org_store_customer_idx` ON `customer_attention_notes` (`organization_id`,`store_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`recorded_on` text NOT NULL,
	`recorded_by` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_notes_org_customer_idx` ON `customer_notes` (`organization_id`,`customer_id`,`recorded_on`);--> statement-breakpoint
CREATE INDEX `customer_notes_org_store_customer_idx` ON `customer_notes` (`organization_id`,`store_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_owned_glasses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`label` text NOT NULL,
	`purchased_on` text NOT NULL,
	`lens_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_owned_glasses_org_customer_idx` ON `customer_owned_glasses` (`organization_id`,`customer_id`,`purchased_on`);--> statement-breakpoint
CREATE INDEX `customer_owned_glasses_org_store_customer_idx` ON `customer_owned_glasses` (`organization_id`,`store_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_prescriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`measured_on` text NOT NULL,
	`recorded_by` text NOT NULL,
	`right_sphere` real NOT NULL,
	`left_sphere` real NOT NULL,
	`pupillary_distance` real NOT NULL,
	`add_power` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_prescriptions_org_customer_idx` ON `customer_prescriptions` (`organization_id`,`customer_id`,`measured_on`);--> statement-breakpoint
CREATE INDEX `customer_prescriptions_org_store_customer_idx` ON `customer_prescriptions` (`organization_id`,`store_id`,`customer_id`);