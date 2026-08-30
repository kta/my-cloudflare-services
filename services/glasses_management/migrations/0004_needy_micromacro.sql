CREATE TABLE `customer_glasses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`store_id` text NOT NULL,
	`purchased_at` text NOT NULL,
	`frame_name` text,
	`lens_name` text,
	`usage_label` text,
	`note` text,
	`is_current` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_glasses_org_customer_purchased_idx` ON `customer_glasses` (`organization_id`,`customer_id`,`purchased_at`);--> statement-breakpoint
CREATE TABLE `customer_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`store_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`handwriting_key` text,
	`author_id` text,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_notes_org_customer_created_idx` ON `customer_notes` (`organization_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_notes_org_customer_kind_idx` ON `customer_notes` (`organization_id`,`customer_id`,`kind`,`status`);--> statement-breakpoint
CREATE TABLE `customer_prescriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`store_id` text NOT NULL,
	`measured_at` text NOT NULL,
	`r_sph` real,
	`r_cyl` real,
	`r_axis` integer,
	`r_add` real,
	`l_sph` real,
	`l_cyl` real,
	`l_axis` integer,
	`l_add` real,
	`pd` real,
	`note` text,
	`is_current` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_prescriptions_org_customer_measured_idx` ON `customer_prescriptions` (`organization_id`,`customer_id`,`measured_at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_number` text NOT NULL,
	`name` text NOT NULL,
	`kana` text,
	`phone` text,
	`phone_normalized` text,
	`phone_last4` text,
	`email` text,
	`birth_date` text,
	`address` text,
	`memo` text,
	`first_visit_at` text,
	`last_visit_at` text,
	`visit_count` integer NOT NULL,
	`merged_into_id` text,
	`version` integer NOT NULL,
	`created_store_id` text,
	`created_terminal_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_org_phone_idx` ON `customers` (`organization_id`,`phone_normalized`);--> statement-breakpoint
CREATE INDEX `customers_org_phone_last4_idx` ON `customers` (`organization_id`,`phone_last4`);--> statement-breakpoint
CREATE INDEX `customers_org_kana_idx` ON `customers` (`organization_id`,`kana`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_customer_number_idx` ON `customers` (`organization_id`,`customer_number`);--> statement-breakpoint
CREATE INDEX `customers_org_last_visit_idx` ON `customers` (`organization_id`,`last_visit_at`);