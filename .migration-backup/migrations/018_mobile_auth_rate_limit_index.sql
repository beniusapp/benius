-- Support the multi-instance-safe per-IP mobile-auth attempt window.
CREATE INDEX security_audit_mobile_auth_throttle_idx
  ON security_audit (ip_address, created_at)
  WHERE action = 'mobile_auth_attempt';