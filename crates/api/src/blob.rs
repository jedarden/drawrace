use thiserror::Error;
use uuid::Uuid;

pub const MAGIC: &[u8; 4] = b"DRGH";
pub const HEADER_SIZE: usize = 36;
pub const MIN_WHEEL_COUNT: u8 = 1;
pub const MAX_WHEEL_COUNT: u8 = 21;
pub const MIN_VERTEX_COUNT: u8 = 8;
pub const MAX_VERTEX_COUNT: u8 = 32;
pub const MIN_SWAP_TICK_GAP: u32 = 30;

#[derive(Debug, Error)]
pub enum BlobError {
    #[error("invalid magic: expected DRGH")]
    BadMagic,
    #[error("blob too short: {0} bytes, need at least {HEADER_SIZE}")]
    TooShort(usize),
    #[error("invalid track_id: {0}")]
    BadTrackId(u16),
    #[error("invalid vertex_count: {0}")]
    BadVertexCount(u8),
    #[error("blob truncated at polygon vertices")]
    TruncatedPolygon,
    #[error("blob truncated at stroke data")]
    TruncatedStroke,
    #[error("blob truncated at checkpoints")]
    TruncatedCheckpoints,
    #[error("invalid wheel_count: {0} (must be 1..=21)")]
    BadWheelCount(u8),
    #[error("first wheel swap_tick must be 0, got {0}")]
    NonZeroInitialSwapTick(u32),
    #[error("swap_tick not strictly increasing")]
    NonIncreasingSwapTick,
}

/// A single wheel entry in the wheels[] array.
#[derive(Debug, Clone)]
pub struct WheelEntry {
    pub swap_tick: u32,
    pub vertex_count: u8,
    pub polygon_vertices: Vec<(i16, i16)>,
}

/// Parsed header fields from a ghost blob (first 36 bytes).
#[derive(Debug, Clone)]
pub struct BlobHeader {
    pub version: u8,
    pub track_id: u16,
    pub flags: u8,
    pub finish_time_ms: u32,
    pub submitted_at: i64,
    pub player_uuid: Uuid,
}

/// Full parsed ghost blob.
#[derive(Debug, Clone)]
pub struct GhostBlob {
    pub header: BlobHeader,
    pub wheel_count: u8,
    pub wheels: Vec<WheelEntry>,
    pub point_count: u8,
    pub stroke_points: Vec<(i16, i16, u16)>,
    pub checkpoint_count: u8,
    pub checkpoint_splits: Vec<u32>,
}

impl BlobHeader {
    pub fn parse(buf: &[u8]) -> Result<Self, BlobError> {
        if buf.len() < HEADER_SIZE {
            return Err(BlobError::TooShort(buf.len()));
        }
        if &buf[0..4] != MAGIC {
            return Err(BlobError::BadMagic);
        }

        let version = buf[4];
        let track_id = u16::from_le_bytes([buf[5], buf[6]]);
        let flags = buf[7];
        let finish_time_ms = u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]);
        let submitted_at = i64::from_le_bytes([
            buf[12], buf[13], buf[14], buf[15], buf[16], buf[17], buf[18], buf[19],
        ]);
        let player_uuid =
            Uuid::from_bytes(buf[20..36].try_into().expect("36-20=16 bytes for UUID"));

        Ok(Self {
            version,
            track_id,
            flags,
            finish_time_ms,
            submitted_at,
            player_uuid,
        })
    }
}

impl GhostBlob {
    pub fn parse(buf: &[u8]) -> Result<Self, BlobError> {
        let header = BlobHeader::parse(buf)?;
        let mut offset = HEADER_SIZE;

        if offset >= buf.len() {
            return Err(BlobError::TooShort(buf.len()));
        }

        let wheel_count = buf[offset];
        offset += 1;

        if !(MIN_WHEEL_COUNT..=MAX_WHEEL_COUNT).contains(&wheel_count) {
            return Err(BlobError::BadWheelCount(wheel_count));
        }

        let mut wheels = Vec::with_capacity(wheel_count as usize);
        let mut prev_swap_tick: Option<u32> = None;

        for i in 0..wheel_count as usize {
            if offset + 5 > buf.len() {
                return Err(BlobError::TruncatedPolygon);
            }

            let swap_tick = u32::from_le_bytes([
                buf[offset],
                buf[offset + 1],
                buf[offset + 2],
                buf[offset + 3],
            ]);
            offset += 4;

            let vertex_count = buf[offset];
            offset += 1;

            if !(MIN_VERTEX_COUNT..=MAX_VERTEX_COUNT).contains(&vertex_count) {
                return Err(BlobError::BadVertexCount(vertex_count));
            }

            let poly_bytes = vertex_count as usize * 4;
            if offset + poly_bytes > buf.len() {
                return Err(BlobError::TruncatedPolygon);
            }

            let mut polygon_vertices = Vec::with_capacity(vertex_count as usize);
            for j in 0..vertex_count as usize {
                let base = offset + j * 4;
                let x = i16::from_le_bytes([buf[base], buf[base + 1]]);
                let y = i16::from_le_bytes([buf[base + 2], buf[base + 3]]);
                polygon_vertices.push((x, y));
            }
            offset += poly_bytes;

            // Validate swap_tick ordering
            if i == 0 {
                if swap_tick != 0 {
                    return Err(BlobError::NonZeroInitialSwapTick(swap_tick));
                }
            } else {
                if swap_tick <= prev_swap_tick.unwrap() {
                    return Err(BlobError::NonIncreasingSwapTick);
                }
            }
            prev_swap_tick = Some(swap_tick);

            wheels.push(WheelEntry {
                swap_tick,
                vertex_count,
                polygon_vertices,
            });
        }

        if offset >= buf.len() {
            return Err(BlobError::TruncatedStroke);
        }

        let point_count = buf[offset];
        offset += 1;

        let stroke_bytes = point_count as usize * 6;
        if offset + stroke_bytes > buf.len() {
            return Err(BlobError::TruncatedStroke);
        }

        let mut stroke_points = Vec::with_capacity(point_count as usize);
        for i in 0..point_count as usize {
            let base = offset + i * 6;
            let dx = i16::from_le_bytes([buf[base], buf[base + 1]]);
            let dy = i16::from_le_bytes([buf[base + 2], buf[base + 3]]);
            let dt = u16::from_le_bytes([buf[base + 4], buf[base + 5]]);
            stroke_points.push((dx, dy, dt));
        }
        offset += stroke_bytes;

        if offset >= buf.len() {
            return Err(BlobError::TruncatedCheckpoints);
        }

        let checkpoint_count = buf[offset];
        offset += 1;

        let cp_bytes = checkpoint_count as usize * 4;
        if offset + cp_bytes > buf.len() {
            return Err(BlobError::TruncatedCheckpoints);
        }

        let mut checkpoint_splits = Vec::with_capacity(checkpoint_count as usize);
        for i in 0..checkpoint_count as usize {
            let base = offset + i * 4;
            let ms = u32::from_le_bytes([buf[base], buf[base + 1], buf[base + 2], buf[base + 3]]);
            checkpoint_splits.push(ms);
        }

        Ok(Self {
            header,
            wheel_count,
            wheels,
            point_count,
            stroke_points,
            checkpoint_count,
            checkpoint_splits,
        })
    }

    /// Minimum blob size for a given configuration.
    pub fn min_size(wheels: &[(u8, u8)], points: u8, checkpoints: u8) -> usize {
        let wheels_size: usize = wheels.iter().map(|&(vc, _)| 4 + 1 + vc as usize * 4).sum();
        HEADER_SIZE
            + 1 // wheel_count
            + wheels_size
            + 1 // point_count
            + (points as usize * 6)
            + 1 // checkpoint_count
            + (checkpoints as usize * 4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_blob() -> Vec<u8> {
        make_blob_with_wheels(1, 28441, &[12], &[5000, 15000, 25000])
    }

    /// Build a v2 blob with one or more wheels.
    /// `vertex_counts` defines each wheel's vertex count; swap_ticks are auto-generated (0, 60, 120, ...).
    fn make_blob_with_wheels(
        track_id: u16,
        finish_time_ms: u32,
        vertex_counts: &[u8],
        checkpoints: &[u32],
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        // magic
        buf.extend_from_slice(b"DRGH");
        // version
        buf.push(2);
        // track_id
        buf.extend_from_slice(&track_id.to_le_bytes());
        // flags
        buf.push(0);
        // finish_time_ms
        buf.extend_from_slice(&finish_time_ms.to_le_bytes());
        // submitted_at
        buf.extend_from_slice(&1745299200000i64.to_le_bytes());
        // player_uuid (16 bytes)
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        buf.extend_from_slice(uuid.as_bytes());

        // wheel_count
        buf.push(vertex_counts.len() as u8);

        // wheels[]
        for (i, &vc) in vertex_counts.iter().enumerate() {
            let swap_tick = (i as u32) * 60;
            buf.extend_from_slice(&swap_tick.to_le_bytes());
            buf.push(vc);
            for j in 0..vc {
                let x = (j as i16) * 10;
                let y = (j as i16) * 20;
                buf.extend_from_slice(&x.to_le_bytes());
                buf.extend_from_slice(&y.to_le_bytes());
            }
        }

        // point_count = 5
        buf.push(5u8);
        for i in 0..5u8 {
            buf.extend_from_slice(&(i as i16).to_le_bytes());
            buf.extend_from_slice(&((i as i16) * 2).to_le_bytes());
            buf.extend_from_slice(&16u16.to_le_bytes());
        }

        // checkpoint_count
        buf.push(checkpoints.len() as u8);
        for &cp in checkpoints {
            buf.extend_from_slice(&cp.to_le_bytes());
        }

        buf
    }

    #[test]
    fn parse_valid_header() {
        let buf = make_valid_blob();
        let header = BlobHeader::parse(&buf).unwrap();
        assert_eq!(header.version, 2);
        assert_eq!(header.track_id, 1);
        assert_eq!(header.flags, 0);
        assert_eq!(header.finish_time_ms, 28441);
        assert_eq!(
            header.player_uuid,
            Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
        );
    }

    #[test]
    fn parse_valid_single_wheel_blob() {
        let buf = make_valid_blob();
        let blob = GhostBlob::parse(&buf).unwrap();
        assert_eq!(blob.wheel_count, 1);
        assert_eq!(blob.wheels.len(), 1);
        assert_eq!(blob.wheels[0].swap_tick, 0);
        assert_eq!(blob.wheels[0].vertex_count, 12);
        assert_eq!(blob.wheels[0].polygon_vertices.len(), 12);
        assert_eq!(blob.point_count, 5);
        assert_eq!(blob.stroke_points.len(), 5);
        assert_eq!(blob.checkpoint_count, 3);
        assert_eq!(blob.checkpoint_splits.len(), 3);
    }

    #[test]
    fn parse_5_swap_blob() {
        let vertex_counts: &[u8] = &[12, 10, 14, 8, 16, 12];
        let buf = make_blob_with_wheels(1, 28441, vertex_counts, &[5000, 15000, 25000]);
        let blob = GhostBlob::parse(&buf).unwrap();
        assert_eq!(blob.wheel_count, 6);
        assert_eq!(blob.wheels.len(), 6);
        assert_eq!(blob.wheels[0].swap_tick, 0);
        assert_eq!(blob.wheels[1].swap_tick, 60);
        assert_eq!(blob.wheels[5].swap_tick, 300);
    }

    #[test]
    fn parse_20_swap_blob() {
        let vertex_counts: Vec<u8> = (0..21).map(|_| 12u8).collect();
        let buf = make_blob_with_wheels(1, 28441, &vertex_counts, &[5000]);
        let blob = GhostBlob::parse(&buf).unwrap();
        assert_eq!(blob.wheel_count, 21);
        assert_eq!(blob.wheels.len(), 21);
    }

    #[test]
    fn reject_bad_magic() {
        let mut buf = make_valid_blob();
        buf[0] = b'X';
        assert!(matches!(BlobHeader::parse(&buf), Err(BlobError::BadMagic)));
    }

    #[test]
    fn reject_too_short() {
        let buf = vec![0u8; 20];
        assert!(matches!(
            BlobHeader::parse(&buf),
            Err(BlobError::TooShort(20))
        ));
    }

    #[test]
    fn reject_bad_vertex_count() {
        let mut buf = make_valid_blob();
        // swap_tick (4 bytes) starts at offset 37, vertex_count at offset 41
        buf[HEADER_SIZE + 1 + 4] = 3; // below minimum of 8
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::BadVertexCount(3))
        ));
    }

    #[test]
    fn reject_truncated_polygon() {
        let mut buf = make_valid_blob();
        buf.truncate(HEADER_SIZE + 1 + 10); // not enough wheel data
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::TruncatedPolygon)
        ));
    }

    #[test]
    fn reject_wheel_count_zero() {
        let mut buf = make_valid_blob();
        buf[HEADER_SIZE] = 0; // wheel_count = 0
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::BadWheelCount(0))
        ));
    }

    #[test]
    fn reject_wheel_count_22() {
        // Build a blob claiming 22 wheels but with only enough data for 1
        let mut buf = make_valid_blob();
        buf[HEADER_SIZE] = 22; // wheel_count = 22 (> 21)
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::BadWheelCount(22))
        ));
    }

    #[test]
    fn reject_non_zero_initial_swap_tick() {
        let mut buf = make_valid_blob();
        // swap_tick starts at HEADER_SIZE + 1
        let off = HEADER_SIZE + 1;
        buf[off..off + 4].copy_from_slice(&42u32.to_le_bytes());
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::NonZeroInitialSwapTick(42))
        ));
    }

    #[test]
    fn reject_non_increasing_swap_tick() {
        // Build a 2-wheel blob with non-increasing swap_ticks
        let mut buf = Vec::new();
        buf.extend_from_slice(b"DRGH");
        buf.push(2); // version
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.push(0); // flags
        buf.extend_from_slice(&28441u32.to_le_bytes());
        buf.extend_from_slice(&1745299200000i64.to_le_bytes());
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        buf.extend_from_slice(uuid.as_bytes());

        buf.push(2); // wheel_count = 2

        // Wheel 0: swap_tick = 0, 8 vertices
        buf.extend_from_slice(&0u32.to_le_bytes());
        buf.push(8);
        for j in 0..8u8 {
            buf.extend_from_slice(&((j as i16) * 10).to_le_bytes());
            buf.extend_from_slice(&((j as i16) * 20).to_le_bytes());
        }

        // Wheel 1: swap_tick = 10 (less than wheel 0's 0 + min gap, but also < previous)
        // Actually, just make it not strictly increasing: swap_tick = 0 again
        buf.extend_from_slice(&0u32.to_le_bytes());
        buf.push(8);
        for j in 0..8u8 {
            buf.extend_from_slice(&((j as i16) * 10).to_le_bytes());
            buf.extend_from_slice(&((j as i16) * 20).to_le_bytes());
        }

        buf.push(0u8); // point_count
        buf.push(0u8); // checkpoint_count

        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::NonIncreasingSwapTick)
        ));
    }

    #[test]
    fn min_size_calc() {
        let wheels: [(u8, u8); 1] = [(12, 0)];
        assert_eq!(
            GhostBlob::min_size(&wheels, 5, 3),
            36 + 1 + (4 + 1 + 48) + 1 + 30 + 1 + 12
        );
    }

    #[test]
    fn parse_header_with_ephemeral_flag() {
        let mut buf = make_valid_blob();
        buf[7] = 0x02; // ephemeral bit
        let header = BlobHeader::parse(&buf).unwrap();
        assert_eq!(header.flags, 0x02);
        assert_eq!(header.flags & 0x02, 0x02); // bit test
    }

    #[test]
    fn ephemeral_flag_isolated() {
        let mut buf = make_valid_blob();
        buf[7] = 0x03; // both zstd and ephemeral bits
        let header = BlobHeader::parse(&buf).unwrap();
        assert_eq!(header.flags & 0x02, 0x02);
    }
}
