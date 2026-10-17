-- Pairs of transactions the user said aren't a transfer, so the register stops suggesting them
CREATE TABLE `transfer_match_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`other_transaction_id` text NOT NULL,
	`dismissed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`other_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
