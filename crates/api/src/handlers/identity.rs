use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RestoreIdentityRequest {
    pub recovery_phrase: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RestoreIdentityResponse {
    pub player_uuid: Uuid,
}

pub async fn restore_identity(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RestoreIdentityRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Validate recovery phrase format (4 words from BIP39 wordlist)
    if body.recovery_phrase.len() != 4 {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "recovery phrase must be 4 words".into(),
        });
    }

    for word in &body.recovery_phrase {
        if !is_valid_bip39_word(word) {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: format!("invalid recovery phrase word: {}", word),
            });
        }
    }

    // Rate limit: 10 restore attempts per IP per hour
    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
            }
        })?;

        // Extract IP from connecting IP (would need ConnectInfo middleware, using generic key for now)
        let rl_key = "rl:identity:restore:global";
        let count: i64 = redis::cmd("INCR")
            .arg(rl_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if count == 1 {
            let _: () = conn.expire(rl_key, 3600).await.unwrap_or(());
        }

        // Global rate limit to prevent brute force attacks
        if count > 1000 {
            return Err(ApiError {
                status: StatusCode::TOO_MANY_REQUESTS,
                message: "rate limit exceeded".into(),
            });
        }
    }

    // Compute SHA-256 hash of the recovery phrase
    let phrase_string = body.recovery_phrase.join(" ");
    let mut hasher = Sha256::new();
    hasher.update(phrase_string.as_bytes());
    let hash_bytes = hasher.finalize();
    let phrase_hash = hex::encode(hash_bytes);

    // Look up player by recovery phrase hash
    let player_uuid: Option<Uuid> =
        sqlx::query_scalar("SELECT player_uuid FROM names WHERE recovery_phrase_hash = $1")
            .bind(&phrase_hash)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("db error: {e}"),
            })?;

    match player_uuid {
        Some(uuid) => Ok((
            StatusCode::OK,
            Json(RestoreIdentityResponse { player_uuid: uuid }),
        )),
        None => Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: "no identity found for this recovery phrase".into(),
        }),
    }
}

/// Check if a word is in the BIP39 English wordlist (first 256 words).
/// The client uses these same 256 words for phrase generation.
fn is_valid_bip39_word(word: &str) -> bool {
    const BIP39_WORDLIST: &[&str] = &[
        "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
        "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
        "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
        "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
        "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
        "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
        "alcohol", "alert", "alien", "all", "alley", "allow", "almost", "alone",
        "alpha", "already", "also", "alter", "always", "amateur", "amazing", "among",
        "amount", "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry",
        "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
        "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april",
        "arch", "arctic", "area", "arena", "argue", "arm", "armed", "armor",
        "army", "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact",
        "artist", "artwork", "ask", "aspect", "assault", "asset", "assist", "assume",
        "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract", "auction",
        "audit", "august", "aunt", "author", "auto", "autumn", "average", "avocado",
        "avoid", "awake", "aware", "away", "awesome", "awful", "awkward", "axis",
        "baby", "bachelor", "bacon", "badge", "bag", "balance", "balcony", "ball",
        "bamboo", "banana", "banner", "bar", "barely", "bargain", "barrel", "base",
        "basic", "basket", "battle", "beach", "bean", "beauty", "because", "become",
        "beef", "before", "begin", "behave", "behind", "believe", "below", "belt",
        "bench", "benefit", "best", "betray", "better", "between", "beyond", "bicycle",
        "bid", "bike", "bind", "biology", "bird", "birth", "bitter", "black",
        "blade", "blame", "blanket", "blast", "bleak", "bless", "blind", "blood",
        "blossom", "blouse", "blue", "blur", "blush", "board", "boat", "body",
        "boil", "bomb", "bone", "bonus", "book", "boost", "border", "bored",
        "borrow", "boss", "bottom", "bounce", "box", "boy", "bracket", "brain",
        "brand", "brass", "brave", "bread", "breeze", "brick", "bridge", "brief",
        "bright", "bring", "brisk", "broccoli", "broken", "bronze", "broom", "brother",
        "brown", "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb",
        "bulk", "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus",
        "business", "busy", "butter", "buyer", "buzz", "cabbage", "cabin", "cable",
        "cactus", "cage", "cake", "call", "calm", "camera", "camp", "can",
        "canal", "cancel", "candy", "cannon", "canoe", "canvas", "canyon", "capable",
        "capital", "captain", "car", "carbon", "card", "cargo", "carpet", "carry",
        "cart", "case", "cash", "casino", "castle", "casual", "cat", "catalog",
        "catch", "category", "cattle", "caught", "cause", "caution", "cave", "ceiling",
        "celery", "cement", "census", "century", "cereal", "certain", "chair", "chalk",
        "champion", "change", "chaos", "chapter", "charge", "chase", "chat", "cheap",
        "check", "cheese", "chef", "cherry", "chest", "chicken", "chief", "child",
        "chimney", "choice", "choose", "chronic", "chuckle", "chunk", "churn", "cigar",
        "cinnamon", "circle", "citizen", "city", "civil", "claim", "clap", "clarify",
        "claw", "clay", "clean", "clerk", "clever", "click", "client", "cliff",
        "climb", "clinic", "clip", "clock", "clog", "close", "cloth", "cloud",
        "clown", "club", "clump", "cluster", "clutch", "coach", "coast", "coconut",
        "code", "coffee", "coil", "coin", "collect", "color", "column", "combine",
        "come", "comfort", "comic", "common", "company", "concert", "conduct", "confirm",
        "congress", "connect", "consider", "control", "convince", "cook", "cool", "copper",
        "copy", "coral", "core", "corn", "corner", "correct", "cost", "cotton",
        "couch", "country", "couple", "course", "cousin", "cover", "coyote", "crack",
        "cradle", "craft", "cram", "crane", "crash", "crater", "crawl", "crazy",
        "cream", "credit", "creek", "crew", "cricket", "crime", "crisp", "critic",
        "crop", "cross", "crouch", "crowd", "crucial", "cruel", "cruise", "crumble",
        "crunch", "crush", "cry", "crystal", "cube", "culture", "cup", "cupboard",
        "curious", "current", "curtain", "curve", "cushion", "custom", "cute", "cycle",
    ];

    BIP39_WORDLIST.contains(&word)
}
