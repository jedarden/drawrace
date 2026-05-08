/**
 * Recovery phrase system for DrawRace identity persistence.
 *
 * A 4-word BIP39 recovery phrase is generated and stored alongside the UUID.
 * Users can view this phrase in Settings and use it to restore their UUID on a new device.
 *
 * The phrase is randomly generated (not derived from UUID) and stored in localStorage.
 * Restoration will require server-side validation (POST /v1/names with recovery phrase).
 */

const RECOVERY_PHRASE_KEY = "drawrace.recovery_phrase";
const RECOVERY_PHRASE_SHOWN_KEY = "drawrace.recovery_phrase_shown";

// BIP39 English wordlist (first 256 words for 4-word phrase = 8 bits per word)
// This gives us 32 bits of entropy, sufficient for a recovery token
const BIP39_WORDLIST = [
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
] as const;

// Word count is 256 = 8 bits per word, 4 words = 32 bits total
const WORD_BITS = 8;
const WORD_COUNT = 4;

/**
 * Generate a random 4-word recovery phrase using BIP39 words.
 * The phrase is stored in localStorage for later retrieval.
 */
export function generateRecoveryPhrase(): string[] {
  const words: string[] = [];
  const array = new Uint8Array(WORD_COUNT);
  crypto.getRandomValues(array);

  for (let i = 0; i < WORD_COUNT; i++) {
    const index = array[i] % BIP39_WORDLIST.length;
    words.push(BIP39_WORDLIST[index]);
  }

  return words;
}

/**
 * Get or generate the recovery phrase for the current player.
 */
export function getRecoveryPhrase(): string[] | null {
  const stored = localStorage.getItem(RECOVERY_PHRASE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Save a recovery phrase to localStorage.
 */
export function saveRecoveryPhrase(words: string[]): void {
  localStorage.setItem(RECOVERY_PHRASE_KEY, JSON.stringify(words));
}

/**
 * Generate and save a recovery phrase if one doesn't exist.
 */
export function ensureRecoveryPhrase(): string[] {
  let phrase = getRecoveryPhrase();
  if (!phrase) {
    phrase = generateRecoveryPhrase();
    saveRecoveryPhrase(phrase);
  }
  return phrase;
}

/**
 * Check if the recovery phrase has been shown to the user.
 */
export function wasRecoveryPhraseShown(): boolean {
  return localStorage.getItem(RECOVERY_PHRASE_SHOWN_KEY) === "true";
}

/**
 * Mark that the recovery phrase has been shown to the user.
 */
export function markRecoveryPhraseShown(): void {
  localStorage.setItem(RECOVERY_PHRASE_SHOWN_KEY, "true");
}

/**
 * Validate that a string array is a valid recovery phrase.
 */
export function isValidRecoveryPhrase(words: string[]): boolean {
  if (words.length !== WORD_COUNT) return false;
  return words.every(word => BIP39_WORDLIST.includes(word as any));
}

/**
 * Format recovery phrase for display.
 */
export function formatRecoveryPhrase(words: string[]): string {
  return words.join(" ");
}

/**
 * @internal Reset module state for tests
 */
export function _resetForTesting(): void {
  localStorage.removeItem(RECOVERY_PHRASE_KEY);
  localStorage.removeItem(RECOVERY_PHRASE_SHOWN_KEY);
}
