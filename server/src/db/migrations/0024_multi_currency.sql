-- Multiple currencies. The budget has one currency (its envelopes and reports), each account
-- may have its own, and a transaction in an account with another currency keeps what it's
-- worth in the budget's currency next to its own amount. All additive: a budget with one
-- currency has no new data (null means "the budget's currency" and "the same amount").
CREATE TABLE `budget_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text,
	`rates_enabled` integer DEFAULT 0 NOT NULL,
	`rates_url` text,
	`rates_last_fetched_at` text,
	`rates_last_error` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `currency` text;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `main_amount` integer;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `main_amount_source` text;
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exchange_rates_pair_date_idx` ON `exchange_rates` (`base`,`quote`,`date`);
--> statement-breakpoint
ALTER TABLE `plaid_account_mappings` ADD `currency` text;
--> statement-breakpoint
ALTER TABLE `simplefin_account_mappings` ADD `currency` text;
