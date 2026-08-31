CREATE TABLE `analytics_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`dimension` text NOT NULL,
	`dimension_key` text NOT NULL,
	`value` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_daily_org_store_date_metric_dim_idx` ON `analytics_daily` (`organization_id`,`store_id`,`date`,`metric`,`dimension`,`dimension_key`);--> statement-breakpoint
CREATE INDEX `analytics_daily_org_store_metric_date_idx` ON `analytics_daily` (`organization_id`,`store_id`,`metric`,`date`);