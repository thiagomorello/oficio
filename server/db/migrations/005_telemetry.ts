// Telemetria de cliente e servidor (diagnóstico de movimento, latência, quedas, A/V e erros). Retenção de 14 dias.
export const sql = `
CREATE TABLE telemetry_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  session_id VARCHAR(40) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  at DATETIME(3) NOT NULL,
  data JSON NULL,
  PRIMARY KEY (id),
  KEY ix_tel_user_at (user_id, at),
  KEY ix_tel_kind_at (kind, at),
  KEY ix_tel_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
