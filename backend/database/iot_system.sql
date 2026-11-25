-- =====================================================================
-- CSDL he thong IoT giam sat & dieu khien thiet bi (ESP8266)
-- Theo muc 4.2.2 bao cao: 5 bang users, devices, sensors, data_sensor, device_actions
-- He quan tri: MySQL / MariaDB (XAMPP). Chay: mysql -u root < iot_system.sql
-- Quy uoc: moi cot thoi gian luu theo gio UTC (Backend ket noi voi timezone '+00:00').
-- =====================================================================

CREATE DATABASE IF NOT EXISTS iot_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE iot_system;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS device_actions;
DROP TABLE IF EXISTS data_sensor;
DROP TABLE IF EXISTS sensors;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- users: tai khoan nguoi dung
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  username    VARCHAR(64)  NOT NULL,
  email       VARCHAR(64)  NULL,
  password    VARCHAR(255) NOT NULL COMMENT 'Mat khau da bam bcrypt, khong luu mat khau goc',
  full_name   VARCHAR(128) NULL,
  role        VARCHAR(16)  NOT NULL DEFAULT 'user' COMMENT 'admin / user',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- devices: thiet bi (ESP8266/node) duoc quan ly
-- device_key: ma thiet bi ma ESP8266 gui qua MQTT (vd "esp8266-01"),
--             dung de anh xa sang khoa chinh so (id). Cot bo sung ngoai ERD.
-- ---------------------------------------------------------------------
CREATE TABLE devices (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  user_id      BIGINT       NULL COMMENT 'Nguoi so huu/quan ly',
  device_key   VARCHAR(64)  NOT NULL COMMENT 'Ma thiet bi trong firmware (DEVICE_ID)',
  device_name  VARCHAR(64)  NOT NULL,
  device_type  VARCHAR(32)  NOT NULL DEFAULT 'ESP8266',
  status       VARCHAR(16)  NOT NULL DEFAULT 'offline' COMMENT 'online / offline',
  description  VARCHAR(255) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_key (device_key),
  KEY idx_devices_user (user_id),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- sensors: cam bien gan voi thiet bi. devices (1) - (N) sensors
-- ---------------------------------------------------------------------
CREATE TABLE sensors (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  device_id    BIGINT       NOT NULL,
  sensor_name  VARCHAR(64)  NOT NULL,
  sensor_type  VARCHAR(16)  NOT NULL COMMENT 'temperature / humidity / light / random_10 / random_100 / random_1000',
  unit         VARCHAR(8)   NULL COMMENT '°C, %, ...',
  description  VARCHAR(255) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sensors_device_type (device_id, sensor_type),
  CONSTRAINT fk_sensors_device FOREIGN KEY (device_id) REFERENCES devices (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- data_sensor: tung gia tri do cua mot sensor cu the. sensors (1) - (N) data_sensor
-- id tu sinh, khong nhan tu ESP8266/Frontend
-- ---------------------------------------------------------------------
CREATE TABLE data_sensor (
  id          BIGINT    NOT NULL AUTO_INCREMENT,
  sensor_id   BIGINT    NOT NULL,
  value       DOUBLE    NOT NULL,
  `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_data_sensor_sensor_time (sensor_id, `timestamp`),
  KEY idx_data_sensor_time (`timestamp`),
  CONSTRAINT fk_data_sensor_sensor FOREIGN KEY (sensor_id) REFERENCES sensors (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- device_actions: lich su lenh dieu khien va ket qua xu ly
-- result: pending -> ok / fail / timeout
-- ---------------------------------------------------------------------
CREATE TABLE device_actions (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  device_id   BIGINT       NOT NULL,
  target      VARCHAR(16)  NOT NULL COMMENT 'led1 / led2 / led3 / all',
  action      VARCHAR(8)   NOT NULL COMMENT 'ON / OFF',
  issued_by   BIGINT       NULL COMMENT 'users.id nguoi thuc hien',
  result      VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending / ok / fail / timeout',
  note        VARCHAR(255) NULL COMMENT 'Ghi chu loi neu co',
  `timestamp` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thoi diem phat lenh',
  PRIMARY KEY (id),
  KEY idx_actions_device_time (device_id, `timestamp`),
  KEY idx_actions_result_time (result, `timestamp`),
  KEY idx_actions_time (`timestamp`),
  KEY idx_actions_user (issued_by),
  CONSTRAINT fk_actions_device FOREIGN KEY (device_id) REFERENCES devices (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_actions_user FOREIGN KEY (issued_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_actions_action CHECK (action IN ('ON', 'OFF')),
  CONSTRAINT chk_actions_result CHECK (result IN ('pending', 'ok', 'fail', 'timeout'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- DU LIEU MAU
-- Tai khoan: admin / admin123 (mat khau da bam bcrypt)
-- =====================================================================
INSERT INTO users (id, username, email, password, full_name, role) VALUES
  (1, 'admin', 'admin@iot.local',
   '$2a$10$RAyRppwyMfs.5w110ELXCuNlbvCdOE1uV/7yZ0D9rL4FTtlUW9gIW',
   'Đỗ Hà Quân', 'admin');

INSERT INTO devices (id, user_id, device_key, device_name, device_type, status, description) VALUES
  (1, 1, 'esp8266-01', 'ESP8266', 'ESP8266', 'offline',
   'NodeMCU ESP8266: DHT11 (D4), LDR (A0), Đèn 1-3 (D5, D6, D7), LED cảnh báo 1-3 (D1, D2, D0)');

INSERT INTO sensors (id, device_id, sensor_name, sensor_type, unit, description) VALUES
  (1, 1, 'Nhiệt độ', 'temperature', '°C', 'DHT11 - chân D4'),
  (2, 1, 'Độ ẩm',    'humidity',    '%',  'DHT11 - chân D4'),
  (3, 1, 'Ánh sáng', 'light',       '','Quang trở LDR - chân A0 (ADC 0-1023)'),
  (4, 1, 'Cảm biến 1', 'random_10',   '', 'Ngẫu nhiên 0-10, LED cảnh báo D1'),
  (5, 1, 'Cảm biến 2', 'random_100',  '', 'Ngẫu nhiên 0-100, LED cảnh báo D2'),
  (6, 1, 'Cảm biến 3', 'random_1000', '', 'Ngẫu nhiên 0-1000, LED cảnh báo D0');
