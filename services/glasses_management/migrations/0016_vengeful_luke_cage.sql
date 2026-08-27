CREATE TABLE `shared_terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_terminals_token_hash_unique_idx` ON `shared_terminals` (`token_hash`);--> statement-breakpoint
CREATE INDEX `shared_terminals_org_store_idx` ON `shared_terminals` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE INDEX `shared_terminals_expiry_idx` ON `shared_terminals` (`expires_at`);