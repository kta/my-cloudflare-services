CREATE TABLE `shared_terminal_reauth_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `store_id` text NOT NULL,
  `terminal_id` text NOT NULL,
  `user_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `action_class` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_terminal_reauth_token_hash_unique_idx` ON `shared_terminal_reauth_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `shared_terminal_reauth_terminal_expiry_idx` ON `shared_terminal_reauth_sessions` (`terminal_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `shared_terminal_reauth_org_store_user_idx` ON `shared_terminal_reauth_sessions` (`organization_id`,`store_id`,`user_id`);
