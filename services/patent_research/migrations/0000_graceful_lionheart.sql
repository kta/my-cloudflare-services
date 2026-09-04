CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`primary_ref` text,
	`secondary_refs` text NOT NULL,
	`motivation_type` text,
	`advantageous_effects` text NOT NULL,
	`hindrance` text NOT NULL,
	`negative_type` text,
	`reasoning` text NOT NULL,
	`conclusion` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assessments_matter_idx` ON `assessments` (`organization_id`,`matter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `claim_elements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`claim_no` text NOT NULL,
	`element_key` text NOT NULL,
	`text` text NOT NULL,
	`is_essential` text NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_elements_key_idx` ON `claim_elements` (`organization_id`,`matter_id`,`claim_no`,`element_key`);--> statement-breakpoint
CREATE INDEX `claim_elements_matter_idx` ON `claim_elements` (`organization_id`,`matter_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`claim_no` text NOT NULL,
	`category` text NOT NULL,
	`depends_on` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_key_idx` ON `claims` (`organization_id`,`matter_id`,`claim_no`);--> statement-breakpoint
CREATE TABLE `disclosure_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `disclosure_messages_matter_idx` ON `disclosure_messages` (`organization_id`,`matter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `disclosures` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`revision` text NOT NULL,
	`problem` text NOT NULL,
	`solution` text NOT NULL,
	`effects` text NOT NULL,
	`embodiments` text NOT NULL,
	`keywords` text NOT NULL,
	`external_llm_allowed` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `disclosures_matter_idx` ON `disclosures` (`organization_id`,`matter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `draft_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`check_key` text NOT NULL,
	`result` text NOT NULL,
	`detail` text NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_checks_key_idx` ON `draft_checks` (`organization_id`,`matter_id`,`check_key`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`revision` text NOT NULL,
	`section` text NOT NULL,
	`markdown` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drafts_matter_idx` ON `drafts` (`organization_id`,`matter_id`,`section`,`revision`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`element_id` text NOT NULL,
	`pub_number` text NOT NULL,
	`para_no` text NOT NULL,
	`quoted_text` text NOT NULL,
	`relation` text NOT NULL,
	`note` text NOT NULL,
	`produced_by` text NOT NULL,
	`quote_check` text NOT NULL,
	`quote_check_detail` text,
	`review` text NOT NULL,
	`reviewer_note` text NOT NULL,
	`reviewed_at` text,
	`title` text,
	`applicants` text NOT NULL,
	`pub_date` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_element_idx` ON `evidence` (`organization_id`,`element_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `evidence_matter_idx` ON `evidence` (`organization_id`,`matter_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_key_idx` ON `evidence` (`organization_id`,`element_id`,`pub_number`,`para_no`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`instruction` text NOT NULL,
	`runner` text,
	`error` text,
	`result_ref` text,
	`requested_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`organization_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `jobs_matter_idx` ON `jobs` (`organization_id`,`matter_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `matters` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`tech_field` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `matters_org_updated_idx` ON `matters` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text,
	`is_disabled` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `search_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`search_id` text NOT NULL,
	`pub_number` text NOT NULL,
	`para_no` text NOT NULL,
	`section` text NOT NULL,
	`rank` text NOT NULL,
	`score` text NOT NULL,
	`snippet` text NOT NULL,
	`title` text NOT NULL,
	`applicants` text NOT NULL,
	`pub_date` text
);
--> statement-breakpoint
CREATE INDEX `search_hits_search_idx` ON `search_hits` (`organization_id`,`search_id`,`rank`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`element_id` text,
	`query` text NOT NULL,
	`match_expression` text,
	`compiled_sql` text,
	`mode` text NOT NULL,
	`hit_count` text NOT NULL,
	`undated_count` text NOT NULL,
	`split_terms` text NOT NULL,
	`dropped_terms` text NOT NULL,
	`corpus_batch_count` text NOT NULL,
	`searched_chunks` text,
	`vector_model` text,
	`vector_semantic` text,
	`executed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `searches_matter_idx` ON `searches` (`organization_id`,`matter_id`,`executed_at`);