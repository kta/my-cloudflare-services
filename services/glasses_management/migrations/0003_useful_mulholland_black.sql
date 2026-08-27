CREATE TABLE `availability_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`purpose_ids_json` text NOT NULL,
	`staff_id` text,
	`equipment_ids_json` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `availability_bookings_org_store_time_idx` ON `availability_bookings` (`organization_id`,`store_id`,`start_at`,`end_at`);--> statement-breakpoint
CREATE TABLE `availability_business_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`periods_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `availability_business_hours_org_store_day_idx` ON `availability_business_hours` (`organization_id`,`store_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `availability_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`is_active` text NOT NULL,
	`available_periods_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `availability_equipment_org_store_name_idx` ON `availability_equipment` (`organization_id`,`store_id`,`name`);--> statement-breakpoint
CREATE TABLE `availability_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`date` text NOT NULL,
	`mode` text NOT NULL,
	`periods_json` text NOT NULL,
	`reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `availability_exceptions_org_store_date_idx` ON `availability_exceptions` (`organization_id`,`store_id`,`date`);--> statement-breakpoint
CREATE TABLE `availability_maintenances` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `availability_maintenances_org_store_date_idx` ON `availability_maintenances` (`organization_id`,`store_id`,`date`);--> statement-breakpoint
CREATE INDEX `availability_maintenances_equipment_date_idx` ON `availability_maintenances` (`equipment_id`,`date`);--> statement-breakpoint
CREATE TABLE `availability_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`version` integer NOT NULL,
	`reception_status` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `availability_settings_org_store_idx` ON `availability_settings` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `availability_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`skills_json` text NOT NULL,
	`can_book` text NOT NULL,
	`is_active` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `availability_staff_org_store_idx` ON `availability_staff` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `availability_staff_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`breaks_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `availability_staff_shifts_org_store_date_idx` ON `availability_staff_shifts` (`organization_id`,`store_id`,`date`);--> statement-breakpoint
CREATE INDEX `availability_staff_shifts_staff_date_idx` ON `availability_staff_shifts` (`staff_id`,`date`);--> statement-breakpoint
CREATE TABLE `visit_purposes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`staff_name` text NOT NULL,
	`customer_label` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`slot_interval_minutes` integer NOT NULL,
	`is_public` text NOT NULL,
	`required_skills_json` text NOT NULL,
	`required_equipment_json` text NOT NULL,
	`max_concurrent` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visit_purposes_org_store_idx` ON `visit_purposes` (`organization_id`,`store_id`);