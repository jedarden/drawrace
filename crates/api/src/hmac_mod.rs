use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct HmacConfig {
    pub current_key: Vec<u8>,
    pub previous_key: Option<Vec<u8>>,
    pub rotated_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl HmacConfig {
    pub fn verify(&self, body: &[u8], claimed_hex: &str) -> bool {
        let claimed = match hex::decode(claimed_hex) {
            Ok(b) => b,
            Err(_) => return false,
        };

        if verify_with_key(&self.current_key, body, &claimed) {
            return true;
        }

        if let Some(ref prev) = self.previous_key {
            if prev.is_empty() {
                return false;
            }
            if let Some(rotated) = self.rotated_at {
                let age = chrono::Utc::now() - rotated;
                if age.num_hours() < 24 {
                    return verify_with_key(prev, body, &claimed);
                }
            }
        }

        false
    }
}

fn verify_with_key(key: &[u8], body: &[u8], claimed: &[u8]) -> bool {
    let mut mac = match HmacSha256::new_from_slice(key) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body);
    mac.verify_slice(claimed).is_ok()
}

pub fn compute_hmac(key: &[u8], body: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key length valid");
    mac.update(body);
    mac.finalize().into_bytes().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> Vec<u8> {
        vec![0x42u8; 32]
    }

    #[test]
    fn verify_valid_hmac() {
        let key = test_key();
        let body = b"test ghost blob data";
        let sig = compute_hmac(&key, body);

        let cfg = HmacConfig {
            current_key: key,
            previous_key: None,
            rotated_at: None,
        };

        assert!(cfg.verify(body, &hex::encode(sig)));
    }

    #[test]
    fn reject_wrong_hmac() {
        let key = test_key();
        let body = b"test ghost blob data";

        let cfg = HmacConfig {
            current_key: key,
            previous_key: None,
            rotated_at: None,
        };

        assert!(!cfg.verify(body, "deadbeef00"));
    }

    #[test]
    fn reject_invalid_hex() {
        let key = test_key();
        let cfg = HmacConfig {
            current_key: key,
            previous_key: None,
            rotated_at: None,
        };

        assert!(!cfg.verify(b"data", "not-valid-hex!"));
    }

    #[test]
    fn verify_with_previous_key_within_grace() {
        let current = vec![0x01u8; 32];
        let previous = vec![0x02u8; 32];
        let body = b"test data";
        let sig = compute_hmac(&previous, body);

        let cfg = HmacConfig {
            current_key: current,
            previous_key: Some(previous),
            rotated_at: Some(chrono::Utc::now() - chrono::Duration::hours(1)),
        };

        assert!(cfg.verify(body, &hex::encode(sig)));
    }

    #[test]
    fn reject_previous_key_after_grace() {
        let current = vec![0x01u8; 32];
        let previous = vec![0x02u8; 32];
        let body = b"test data";
        let sig = compute_hmac(&previous, body);

        let cfg = HmacConfig {
            current_key: current,
            previous_key: Some(previous),
            rotated_at: Some(chrono::Utc::now() - chrono::Duration::hours(25)),
        };

        assert!(!cfg.verify(body, &hex::encode(sig)));
    }

    #[test]
    fn reject_empty_previous_key() {
        let current = vec![0x01u8; 32];
        let empty_prev = vec![];
        let body = b"test data";

        let cfg = HmacConfig {
            current_key: current,
            previous_key: Some(empty_prev),
            rotated_at: Some(chrono::Utc::now()),
        };

        // HMAC of empty key is valid SHA-256, but we explicitly reject empty previous
        assert!(!cfg.verify(body, "anyhex"));
    }
}
