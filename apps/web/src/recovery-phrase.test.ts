import { describe, it, expect, beforeEach } from "vitest";
import {
  generateRecoveryPhrase,
  getRecoveryPhrase,
  saveRecoveryPhrase,
  ensureRecoveryPhrase,
  wasRecoveryPhraseShown,
  markRecoveryPhraseShown,
  isValidRecoveryPhrase,
  formatRecoveryPhrase,
  _resetForTesting,
} from "./recovery-phrase.js";

describe("recovery-phrase", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe("generateRecoveryPhrase", () => {
    it("generates 4 words", () => {
      const phrase = generateRecoveryPhrase();
      expect(phrase).toHaveLength(4);
    });

    it("generates unique phrases", () => {
      const phrase1 = generateRecoveryPhrase();
      const phrase2 = generateRecoveryPhrase();
      expect(phrase1).not.toEqual(phrase2);
    });

    it("all words are valid BIP39 words", () => {
      const phrase = generateRecoveryPhrase();
      expect(isValidRecoveryPhrase(phrase)).toBe(true);
    });
  });

  describe("saveRecoveryPhrase / getRecoveryPhrase", () => {
    it("saves and retrieves recovery phrase", () => {
      const phrase = ["ability", "absorb", "abstract", "accident"];
      saveRecoveryPhrase(phrase);
      expect(getRecoveryPhrase()).toEqual(phrase);
    });

    it("returns null when no phrase saved", () => {
      expect(getRecoveryPhrase()).toBeNull();
    });
  });

  describe("ensureRecoveryPhrase", () => {
    it("generates new phrase when none exists", () => {
      const phrase = ensureRecoveryPhrase();
      expect(phrase).toHaveLength(4);
      expect(getRecoveryPhrase()).toEqual(phrase);
    });

    it("returns existing phrase when already saved", () => {
      const original = ["ability", "absorb", "abstract", "accident"];
      saveRecoveryPhrase(original);
      const phrase = ensureRecoveryPhrase();
      expect(phrase).toEqual(original);
    });
  });

  describe("wasRecoveryPhraseShown / markRecoveryPhraseShown", () => {
    it("initially returns false", () => {
      expect(wasRecoveryPhraseShown()).toBe(false);
    });

    it("returns true after marking shown", () => {
      markRecoveryPhraseShown();
      expect(wasRecoveryPhraseShown()).toBe(true);
    });
  });

  describe("isValidRecoveryPhrase", () => {
    it("accepts valid 4-word phrase", () => {
      expect(isValidRecoveryPhrase(["ability", "absorb", "abstract", "accident"])).toBe(true);
    });

    it("rejects wrong length", () => {
      expect(isValidRecoveryPhrase(["ability", "absorb", "abstract"])).toBe(false);
      expect(isValidRecoveryPhrase(["ability", "absorb", "abstract", "accident", "acid"])).toBe(false);
    });

    it("rejects invalid words", () => {
      expect(isValidRecoveryPhrase(["invalid", "absorb", "abstract", "accident"])).toBe(false);
    });

    it("rejects empty array", () => {
      expect(isValidRecoveryPhrase([])).toBe(false);
    });
  });

  describe("formatRecoveryPhrase", () => {
    it("joins words with spaces", () => {
      const phrase = ["ability", "absorb", "abstract", "accident"];
      expect(formatRecoveryPhrase(phrase)).toBe("ability absorb abstract accident");
    });
  });
});
