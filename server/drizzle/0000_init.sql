CREATE TABLE `ai_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`triggered_by_id` integer,
	`model` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`triggered_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_attempts_ticket_idx` ON `ai_attempts` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`sent_by_id` integer NOT NULL,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`mail_mode` text NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`delivery_error` text,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replies_ticket_idx` ON `replies` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text,
	`source` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`category` text,
	`urgency` integer,
	`draft` text,
	`ai_error` text,
	`ai_skip_reason` text,
	`ai_retries` integer DEFAULT 0 NOT NULL,
	`assignee_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_message_id_unique` ON `tickets` (`message_id`);--> statement-breakpoint
CREATE INDEX `tickets_status_created_idx` ON `tickets` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tickets_assignee_idx` ON `tickets` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `tickets_from_email_idx` ON `tickets` (`from_email`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_assigned_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);