

CREATE DATABASE IF NOT EXISTS `IPT_System_DB`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `IPT_System_DB`;


CREATE TABLE IF NOT EXISTS `users` (
  `id`         INT          UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`   VARCHAR(100) NOT NULL,
  `password`   VARCHAR(255) NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `projects` (
  `id`          INT          UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(150) NOT NULL,
  `description` TEXT,
  `created_by`  VARCHAR(100) NOT NULL,
  `visibility`  ENUM('public','private') NOT NULL DEFAULT 'public',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projects_name` (`name`),
  KEY `idx_projects_created_by` (`created_by`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `project_members` (
  `id`         INT          UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT          UNSIGNED NOT NULL,
  `username`   VARCHAR(100) NOT NULL,
  `status`     ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_project_member` (`project_id`, `username`),
  KEY `idx_pm_username` (`username`),
  CONSTRAINT `fk_pm_project`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `categories` (
  `id`         INT          UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(100) NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_name` (`name`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `tasks` (
  `id`                INT          UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id`        INT          UNSIGNED          DEFAULT NULL,
  `category_id`       INT          UNSIGNED          DEFAULT NULL,
  `title`             VARCHAR(150) NOT NULL,
  `description`       TEXT,
  `status`            ENUM('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
  `priority`          ENUM('low','medium','high')               NOT NULL DEFAULT 'medium',
  `due_date`          DATE                           DEFAULT NULL,
  `posted_by`         VARCHAR(100) NOT NULL,
  `assigned_to`       VARCHAR(500) NOT NULL DEFAULT 'Everyone',
  `status_changed_by` TEXT                           DEFAULT NULL,
  `status_changed_at` DATETIME                       DEFAULT NULL,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_project`  (`project_id`),
  KEY `idx_tasks_status`   (`status`),
  KEY `idx_tasks_priority` (`priority`),
  KEY `idx_tasks_posted_by`(`posted_by`),
  CONSTRAINT `fk_tasks_project`
    FOREIGN KEY (`project_id`)  REFERENCES `projects`   (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tasks_category`
    FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;