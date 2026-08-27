CREATE TABLE `settings_chain_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_chain_defaults_org_idx` ON `settings_chain_defaults` (`organization_id`);--> statement-breakpoint
CREATE TABLE `settings_draft_conflict_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`resolution` text NOT NULL,
	`note` text NOT NULL,
	`resolved_by` text NOT NULL,
	`resolved_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_conflict_resolution_draft_reservation_idx` ON `settings_draft_conflict_resolutions` (`draft_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `settings_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`draft_version` integer NOT NULL,
	`base_version` integer NOT NULL,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`restored_from_version_id` text,
	`payload_json` text NOT NULL,
	`saved_by` text NOT NULL,
	`saved_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_drafts_org_store_idx` ON `settings_drafts` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `settings_publication_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`store_id` text NOT NULL,
	`status` text NOT NULL,
	`applied_version` integer,
	`failure_reason` text,
	`applied_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_publication_targets_publication_store_idx` ON `settings_publication_targets` (`publication_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `settings_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`version_id` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_at` text,
	`executed_at` text,
	`applied_count` integer NOT NULL,
	`failed_count` integer NOT NULL,
	`ledger_entries_affected` integer NOT NULL,
	`slot_date` text NOT NULL,
	`previous_slot_count` integer NOT NULL,
	`published_slot_count` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `settings_publications_org_scheduled_idx` ON `settings_publications` (`organization_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `settings_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`version` integer NOT NULL,
	`origin` text NOT NULL,
	`payload_json` text NOT NULL,
	`changed_fields_json` text NOT NULL,
	`source_draft_id` text,
	`publication_id` text,
	`published_by` text NOT NULL,
	`published_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_versions_org_store_version_idx` ON `settings_versions` (`organization_id`,`store_id`,`version`);--> statement-breakpoint
ALTER TABLE `availability_settings` ADD `origin` text;