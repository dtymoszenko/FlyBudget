-- Signed-in devices (server mode): which browser each session belongs to and when it
-- was last used, so Settings → Server can list them
ALTER TABLE `sessions` ADD `user_agent` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_used_at` text;
