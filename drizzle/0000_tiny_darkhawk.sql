CREATE TABLE `candle_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candle_cache_uq` ON `candle_cache` (`symbol`,`timeframe`,`from_date`,`to_date`);--> statement-breakpoint
CREATE TABLE `runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`strategy_id` text,
	`strategy_name` text NOT NULL,
	`spec` text NOT NULL,
	`result` text NOT NULL,
	`total_return` real DEFAULT 0 NOT NULL,
	`sharpe` real DEFAULT 0 NOT NULL,
	`max_drawdown` real DEFAULT 0 NOT NULL,
	`total_trades` integer DEFAULT 0 NOT NULL,
	`computed_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_strategy_idx` ON `runs` (`strategy_id`);--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`spec` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strategy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`spec` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_version_uq` ON `strategy_versions` (`strategy_id`,`version`);