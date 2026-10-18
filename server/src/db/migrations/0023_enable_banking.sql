-- Enable Banking (European bank sync over PSD2): the user's own application, one row per bank
-- login (session), and which local account each of the bank's accounts goes into.
CREATE TABLE `enable_banking_config` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`private_key` text NOT NULL,
	`application_name` text,
	`environment` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enable_banking_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`aspsp_name` text NOT NULL,
	`aspsp_country` text NOT NULL,
	`psu_type` text DEFAULT 'personal' NOT NULL,
	`valid_until` text,
	`sync_status` text DEFAULT 'good' NOT NULL,
	`sync_error` text,
	`last_synced_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enable_banking_account_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`account_uid` text NOT NULL,
	`identification_hash` text,
	`iban` text,
	`name` text NOT NULL,
	`currency` text,
	`cash_account_type` text,
	`account_id` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`last_booked_date` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `enable_banking_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `enable_banking_account_mappings_connection_idx` ON `enable_banking_account_mappings` (`connection_id`);
