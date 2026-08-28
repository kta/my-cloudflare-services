CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`role_label` text,
	`capacity` integer NOT NULL,
	`is_active` text NOT NULL,
	`inactive_reason` text,
	`ledger_display` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `equipment_org_store_sort_idx` ON `equipment` (`organization_id`,`store_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `equipment_org_store_kind_idx` ON `equipment` (`organization_id`,`store_id`,`kind`);--> statement-breakpoint
CREATE TABLE `equipment_maintenance` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `equipment_maintenance_org_store_start_idx` ON `equipment_maintenance` (`organization_id`,`store_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `equipment_maintenance_org_equipment_start_idx` ON `equipment_maintenance` (`organization_id`,`equipment_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `purpose_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purpose_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purpose_requirements_org_purpose_idx` ON `purpose_requirements` (`organization_id`,`purpose_id`,`kind`,`value`);--> statement-breakpoint
CREATE TABLE `reservation_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_assignments_org_target_start_idx` ON `reservation_assignments` (`organization_id`,`kind`,`target_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `reservation_assignments_org_reservation_idx` ON `reservation_assignments` (`organization_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `reservation_purposes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`purpose_id` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_purposes_org_reservation_idx` ON `reservation_purposes` (`organization_id`,`reservation_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `reservation_purposes_org_purpose_idx` ON `reservation_purposes` (`organization_id`,`purpose_id`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`code` text NOT NULL,
	`customer_id` text,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`note_customer` text,
	`note_internal` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	`cancelled_at` text,
	`cancel_reason` text
);
--> statement-breakpoint
CREATE INDEX `reservations_org_store_start_idx` ON `reservations` (`organization_id`,`store_id`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_org_code_idx` ON `reservations` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `reservations_org_store_status_start_idx` ON `reservations` (`organization_id`,`store_id`,`status`,`starts_at`);--> statement-breakpoint
CREATE INDEX `reservations_org_customer_start_idx` ON `reservations` (`organization_id`,`customer_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`admin_user_id` text,
	`display_name` text NOT NULL,
	`kana` text,
	`job_label` text,
	`role` text NOT NULL,
	`max_parallel_reservations` integer NOT NULL,
	`pin_hash` text,
	`pin_updated_at` text,
	`is_active` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_org_store_sort_idx` ON `staff` (`organization_id`,`store_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `staff_org_admin_user_idx` ON `staff` (`organization_id`,`admin_user_id`);--> statement-breakpoint
CREATE TABLE `staff_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`date` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_shifts_org_store_date_idx` ON `staff_shifts` (`organization_id`,`store_id`,`date`);--> statement-breakpoint
CREATE INDEX `staff_shifts_org_staff_date_idx` ON `staff_shifts` (`organization_id`,`staff_id`,`date`);--> statement-breakpoint
CREATE TABLE `staff_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`skill_code` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_skills_org_staff_skill_idx` ON `staff_skills` (`organization_id`,`staff_id`,`skill_code`);--> statement-breakpoint
CREATE INDEX `staff_skills_org_store_skill_idx` ON `staff_skills` (`organization_id`,`store_id`,`skill_code`);--> statement-breakpoint
CREATE TABLE `staff_weekly_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`is_off` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`break_start` text,
	`break_end` text,
	`effective_from` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_weekly_shifts_org_staff_weekday_idx` ON `staff_weekly_shifts` (`organization_id`,`staff_id`,`effective_from`,`weekday`);--> statement-breakpoint
CREATE TABLE `store_blackout_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `store_blackout_windows_org_store_weekday_idx` ON `store_blackout_windows` (`organization_id`,`store_id`,`weekday`,`starts_at`);--> statement-breakpoint
CREATE TABLE `store_business_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`is_closed` text NOT NULL,
	`opens_at` text,
	`closes_at` text,
	`break_start` text,
	`break_end` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_business_hours_org_store_weekday_idx` ON `store_business_hours` (`organization_id`,`store_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `store_calendar_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`opens_at` text,
	`closes_at` text,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_calendar_exceptions_org_store_date_idx` ON `store_calendar_exceptions` (`organization_id`,`store_id`,`date`);--> statement-breakpoint
CREATE TABLE `store_settings_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_settings_revision_org_store_idx` ON `store_settings_revision` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `store_slot_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`slot_minutes` integer NOT NULL,
	`cleanup_minutes` integer NOT NULL,
	`max_parallel` integer NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_slot_rules_org_store_idx` ON `store_slot_rules` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `visit_purposes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text,
	`name_internal` text NOT NULL,
	`name_public` text NOT NULL,
	`name_short` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`is_web_published` text NOT NULL,
	`is_active` text NOT NULL,
	`sort_order` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visit_purposes_org_store_sort_idx` ON `visit_purposes` (`organization_id`,`store_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `visit_purposes_org_web_idx` ON `visit_purposes` (`organization_id`,`store_id`,`is_web_published`);--> statement-breakpoint
DROP INDEX `stores_org_slug_unique_idx`;--> statement-breakpoint
ALTER TABLE `stores` ADD `name_public` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `nearest_station` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `parking_note` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `intro_text` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `sort_order` integer;--> statement-breakpoint
ALTER TABLE `stores` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `updated_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `stores_slug_idx` ON `stores` (`slug`);