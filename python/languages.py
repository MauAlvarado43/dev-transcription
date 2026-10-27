"""Bilingual recognition policy. Automatic means Spanish/English only."""
import unicodedata

SUPPORTED_LANGUAGES = ("es", "en")


def choose_language(model, audio, previous="es"):
    # Very short responses do not contain enough evidence for a new language.
    if len(audio) < 16000:
        return previous if previous in SUPPORTED_LANGUAGES else "es"
    detected, probability, candidates = model.detect_language(audio=audio)
    scores = {code: score for code, score in candidates or [] if code in SUPPORTED_LANGUAGES}
    if scores:
        return max(scores, key=scores.get)
    return detected if detected in SUPPORTED_LANGUAGES else previous if previous in SUPPORTED_LANGUAGES else "es"


def supported_script(text):
    # Permit Latin letters (including accents), punctuation, digits and common
    # mathematical symbols. Never present an unrelated script as recognized speech.
    return all(not char.isalpha() or "LATIN" in unicodedata.name(char, "") or char in "ªºµΩπΔ" for char in text)
