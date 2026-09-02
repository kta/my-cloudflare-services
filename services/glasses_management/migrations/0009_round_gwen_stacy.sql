CREATE TABLE `terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`staff_id` text,
	`mode` text NOT NULL,
	`started_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `terminal_sessions_org_terminal_started_idx` ON `terminal_sessions` (`organization_id`,`terminal_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_org_expires_idx` ON `terminal_sessions` (`organization_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`place_note` text,
	`device_label` text,
	`pin_hash` text,
	`auto_lock_seconds` integer NOT NULL,
	`last_seen_at` text,
	`is_active` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `terminals_org_store_created_idx` ON `terminals` (`organization_id`,`store_id`,`created_at`);
--> statement-breakpoint
UPDATE `audit_events`
SET `target_type` = CASE `target_type`
	WHEN 'reservation' THEN 'reservations'
	WHEN 'recording' THEN 'recordings'
	WHEN 'customer' THEN 'customers'
	WHEN 'store' THEN 'stores'
	ELSE `target_type`
END
WHERE `target_type` IN ('reservation', 'recording', 'customer', 'store');
