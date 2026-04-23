use aws_sdk_s3::presigning::PresigningConfig;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

pub async fn get_ghost(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(ghost_id): axum::extract::Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    // Look up the ghost to get its S3 key
    let row: Option<(String,)> = sqlx::query_as("SELECT s3_key FROM ghosts WHERE ghost_id = $1")
        .bind(ghost_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    let s3_key = match row {
        Some((key,)) => key,
        None => {
            return Err(ApiError {
                status: StatusCode::NOT_FOUND,
                message: "ghost not found".into(),
            });
        }
    };

    let presigned = state
        .s3
        .get_object()
        .bucket(&state.s3_bucket)
        .key(&s3_key)
        .presigned(
            PresigningConfig::expires_in(Duration::from_secs(300))
                .expect("valid presigning duration"),
        )
        .await
        .map_err(|e| {
            tracing::error!(ghost_id = %ghost_id, error = %e, "S3 presign failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "storage error".into(),
            }
        })?;

    Ok(Redirect::temporary(presigned.uri()))
}
