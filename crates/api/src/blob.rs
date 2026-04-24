use thiserror::Error;
use uuid::Uuid;

pub const MAGIC: &[u8; 4] = b"DRGH";
pub const HEADER_SIZE: usize = 36;

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
    pub vertex_count: u8,
    pub polygon_vertices: Vec<(i16, i16)>,
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

        let vertex_count = buf[offset];
        offset += 1;

        if !(8..=32).contains(&vertex_count) {
            return Err(BlobError::BadVertexCount(vertex_count));
        }

        let poly_bytes = vertex_count as usize * 4;
        if offset + poly_bytes > buf.len() {
            return Err(BlobError::TruncatedPolygon);
        }

        let mut polygon_vertices = Vec::with_capacity(vertex_count as usize);
        for i in 0..vertex_count as usize {
            let base = offset + i * 4;
            let x = i16::from_le_bytes([buf[base], buf[base + 1]]);
            let y = i16::from_le_bytes([buf[base + 2], buf[base + 3]]);
            polygon_vertices.push((x, y));
        }
        offset += poly_bytes;

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
            vertex_count,
            polygon_vertices,
            point_count,
            stroke_points,
            checkpoint_count,
            checkpoint_splits,
        })
    }

    /// Minimum blob size for a given vertex count, point count, and checkpoint count.
    pub fn min_size(verts: u8, points: u8, checkpoints: u8) -> usize {
        HEADER_SIZE
            + 1
            + (verts as usize * 4)
            + 1
            + (points as usize * 6)
            + 1
            + (checkpoints as usize * 4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_blob() -> Vec<u8> {
        let mut buf = Vec::new();
        // magic
        buf.extend_from_slice(b"DRGH");
        // version
        buf.push(1);
        // track_id
        buf.extend_from_slice(&1u16.to_le_bytes());
        // flags
        buf.push(0);
        // finish_time_ms
        buf.extend_from_slice(&28441u32.to_le_bytes());
        // submitted_at
        buf.extend_from_slice(&1745299200000i64.to_le_bytes());
        // player_uuid (16 bytes)
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        buf.extend_from_slice(uuid.as_bytes());

        // vertex_count = 3 for testing (min is 8 but parser enforces that)
        buf.push(12u8);
        // 12 polygon vertices (12 * 4 = 48 bytes)
        for i in 0..12u8 {
            let x = (i as i16) * 10;
            let y = (i as i16) * 20;
            buf.extend_from_slice(&x.to_le_bytes());
            buf.extend_from_slice(&y.to_le_bytes());
        }

        // point_count = 5
        buf.push(5u8);
        // 5 stroke points (5 * 6 = 30 bytes)
        for i in 0..5u8 {
            let dx = i as i16;
            let dy = (i as i16) * 2;
            let dt = 16u16;
            buf.extend_from_slice(&dx.to_le_bytes());
            buf.extend_from_slice(&dy.to_le_bytes());
            buf.extend_from_slice(&dt.to_le_bytes());
        }

        // checkpoint_count = 3
        buf.push(3u8);
        // 3 checkpoints (3 * 4 = 12 bytes)
        for i in 0..3u32 {
            buf.extend_from_slice(&(i * 10000).to_le_bytes());
        }

        buf
    }

    #[test]
    fn parse_valid_header() {
        let buf = make_valid_blob();
        let header = BlobHeader::parse(&buf).unwrap();
        assert_eq!(header.version, 1);
        assert_eq!(header.track_id, 1);
        assert_eq!(header.flags, 0);
        assert_eq!(header.finish_time_ms, 28441);
        assert_eq!(
            header.player_uuid,
            Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
        );
    }

    #[test]
    fn parse_valid_blob() {
        let buf = make_valid_blob();
        let blob = GhostBlob::parse(&buf).unwrap();
        assert_eq!(blob.vertex_count, 12);
        assert_eq!(blob.polygon_vertices.len(), 12);
        assert_eq!(blob.point_count, 5);
        assert_eq!(blob.stroke_points.len(), 5);
        assert_eq!(blob.checkpoint_count, 3);
        assert_eq!(blob.checkpoint_splits.len(), 3);
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
        buf[HEADER_SIZE] = 3; // below minimum of 8
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::BadVertexCount(3))
        ));
    }

    #[test]
    fn reject_truncated_polygon() {
        let mut buf = make_valid_blob();
        buf.truncate(HEADER_SIZE + 1 + 10); // not enough polygon data
        assert!(matches!(
            GhostBlob::parse(&buf),
            Err(BlobError::TruncatedPolygon)
        ));
    }

    #[test]
    fn min_size_calc() {
        assert_eq!(GhostBlob::min_size(12, 5, 3), 36 + 1 + 48 + 1 + 30 + 1 + 12);
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
