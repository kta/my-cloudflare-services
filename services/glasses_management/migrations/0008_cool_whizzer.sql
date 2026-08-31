CREATE TABLE `analytics_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`dimension` text NOT NULL,
	`dimension_key` text NOT NULL,
	`dimension_label` text NOT NULL,
	`value` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "analytics_daily_value_nonnegative_check" CHECK("analytics_daily"."value" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_daily_org_store_date_metric_dim_idx` ON `analytics_daily` (`organization_id`,`store_id`,`date`,`metric`,`dimension`,`dimension_key`);--> statement-breakpoint
CREATE INDEX `analytics_daily_org_store_metric_date_idx` ON `analytics_daily` (`organization_id`,`store_id`,`metric`,`date`);--> statement-breakpoint
CREATE INDEX `reservations_org_store_created_idx` ON `reservations` (`organization_id`,`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `web_bookings_status_created_idx` ON `web_bookings` (`status`,`created_at`);