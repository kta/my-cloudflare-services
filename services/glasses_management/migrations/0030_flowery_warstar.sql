CREATE TABLE `attention_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`review_mode` text NOT NULL,
	`sharing_scope` text NOT NULL,
	`store_override_allowed` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attention_settings_org_store_idx` ON `attention_settings` (`organization_id`,`store_id`);--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `note_id` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `occurred_at` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `recommended_action` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `sharing_scope` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `customer_attention_notes` ADD `previous_version_id` text;--> statement-breakpoint
CREATE INDEX `customer_attention_notes_org_note_idx` ON `customer_attention_notes` (`organization_id`,`note_id`,`version`);--> statement-breakpoint
ALTER TABLE `customers` ADD `merged_into_customer_id` text;