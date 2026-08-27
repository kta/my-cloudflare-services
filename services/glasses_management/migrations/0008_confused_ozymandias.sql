ALTER TABLE `reservations` ADD `progress` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `wait_started_at` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `assigned_staff_id` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `assigned_equipment_ids_json` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `next_guidance` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `updated_at` text;--> statement-breakpoint
UPDATE `reservations` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
