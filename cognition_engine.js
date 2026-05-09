/**
 * cognition_engine.js
 * ─────────────────────────────────────────────────────────────
 * CognitionEngine — Communication Style Analyzer
 * with Integrated Consent Gate
 *
 * CONSENT MODEL:
 *   Consent is explicit, granular, and persistent per-instance.
 *   Every analysis method HARD-BLOCKS if consent has not been
 *   recorded. Consent can be revoked at any time; revocation
 *   immediately purges all derived data.
 *
 *   The consent flag is intentionally NOT a simple boolean
 *   parameter — it is a formal act registered via grantConsent(),
 *   ensuring it cannot be accidentally passed as a truthy value
 *   or forged by a wrapper without the user's knowledge.
 *
 * WHAT IS ANALYZED:
 *   - Average message length
 *   - Formality markers
 *   - Punctuation style
 *   - Sentence complexity
 *   - Top vocabulary topics (bilingual stopwords removed: ES + EN)
 *
 * USAGE:
 *   import { CognitionEngine } from './cognition_engine.js';
 *
 *   const engine = new CognitionEngine();
 *
 *   // Step 1: user must explicitly grant consent
 *   engine.grantConsent({ confirmedAt: Date.now(), source: 'settings-page' });
 *
 *   // Step 2: provide text history
 *   const result = engine.ingestHistory([
 *       { text: 'Hey, can you help me draft this report?', timestamp_ms: ... },
 *       ...
 *   ]);
 *
 *   // Step 3: generate personalization prompt fragment
 *   const prompt = engine.generatePersonalizationPrompt({ task_context: 'email drafting' });
 *
 *   // Revoke at any time — purges all data immediately
 *   engine.revokeConsent();
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// ConsentError — dedicated error type so callers can distinguish
// consent failures from logic errors.
// ─────────────────────────────────────────────────────────────
export class ConsentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConsentError';
        this.code = 'CONSENT_REQUIRED';
    }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

const INFORMAL_MARKERS = Object.freeze([
    "don't", "won't", "can't", "gonna", "wanna",
    "lol", "tbh", "ngl", "btw", "idk", "omg", "imo",
    "yeah", "yep", "nope", "kinda", "sorta", "lemme", "gotta",
]);

// Bilingual stopword set — English + Spanish.
// Covers function words, pronouns, prepositions, conjunctions,
// determiners, and high-frequency auxiliaries in both languages.
// Extend freely; the Set lookup is O(1).
const STOPWORDS = new Set([
    // ── English ───────────────────────────────────────────────
    'the','a','an','and','or','but','in','on','at','to','for',
    'of','is','it','i','my','me','you','we','he','she','they',
    'this','that','with','are','was','be','have','has','had',
    'do','not','so','if','as','by','from','up','about','into',
    'then','than','just','like','will','would','could','should',
    'its','our','your','their','what','which','who','when','where',
    'been','being','were','did','does','any','all','more','also',
    'no','yes','very','here','there','how','out','can','get','got',
    'him','her','them','us','am','own','too','only','also','such',
    'each','even','both','few','more','most','other','same','over',
    'these','those','again','further','once','nor','while','since',
    'after','before','off','between','through','during','until',
    'against','among','along','below','above','without','within',

    // ── Spanish ───────────────────────────────────────────────
    // Articles
    'el','la','los','las','un','una','unos','unas',
    // Prepositions & contractions
    'de','del','al','a','en','con','por','para','sin','sobre',
    'entre','hacia','desde','hasta','ante','bajo','tras','según',
    'durante','mediante',
    // Conjunctions
    'y','e','o','u','pero','sino','que','aunque','porque','como',
    'cuando','donde','si','ni','pues','ya','mientras','además',
    'también','tampoco','tanto','así','entonces','luego','pues',
    // Pronouns
    'yo','tú','él','ella','nosotros','nosotras','vosotros','vosotras',
    'ellos','ellas','usted','ustedes','me','te','se','nos','os',
    'le','les','lo','mi','tu','su','mis','tus','sus',
    'mío','mía','tuyo','tuya','suyo','suya','nuestro','nuestra',
    'este','esta','estos','estas','ese','esa','esos','esas',
    'aquel','aquella','aquellos','aquellas','esto','eso','aquello',
    'quien','quienes','cual','cuales','cuyo','cuya',
    'qué','quién','cómo','cuándo','dónde','cuánto','cuál',
    // Auxiliaries & high-frequency verbs
    'es','son','era','eran','fue','fueron','ser','estar','estoy',
    'está','están','estaba','estaban','estuvo','estuvieron',
    'he','ha','han','había','habían','haber','hay','hubo',
    'sido','estado','tiene','tienen','tengo','tenía','tener',
    'hace','hacen','hago','hacía','hacer','hecho',
    'puede','pueden','puedo','podía','poder',
    'va','van','voy','iba','ir',
    'soy','eres','somos','sois',
    // Common adverbs & fillers
    'no','sí','muy','más','menos','bien','mal','aquí','ahí','allí',
    'antes','después','ahora','siempre','nunca','jamás','todavía',
    'aún','ya','solo','sólo','todo','toda','todos','todas',
    'cada','otro','otra','otros','otras','mismo','misma',
    'tan','tanto','tanta','tantos','tantas','algo','alguien',
    'nada','nadie','algún','alguna','ningún','ninguna',
    'poco','poca','mucho','mucha','varios','varias',
]);

function magnitude_words(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

function extract_top_topics(texts, top_n = 5) {
    const freq = {};
    for (const text of texts) {
        for (const raw of text.toLowerCase().split(/\W+/)) {
            const word = raw.trim();
            if (word.length > 2 && !STOPWORDS.has(word)) {
                freq[word] = (freq[word] ?? 0) + 1;
            }
        }
    }
    return Object.entries(freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, top_n)
        .map(([w]) => w);
}

function build_style_profile(entries) {
    const texts       = entries.map(e => e.text);
    const wordCounts  = texts.map(magnitude_words);
    const avgWords    = Math.round(
        wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length
    );

    const informalHits = texts.filter(t =>
        INFORMAL_MARKERS.some(m => t.toLowerCase().includes(m))
    ).length;

    const formality = (informalHits / texts.length) > 0.3 ? 'informal' : 'formal';

    const usesPunctuation =
        texts.filter(t => /[.!?]$/.test(t.trim())).length / texts.length > 0.5;

    const avgLengthCategory =
        avgWords < 10  ? 'very short' :
        avgWords < 30  ? 'short'      :
        avgWords < 80  ? 'medium'     : 'long';

    const avgSentences =
        texts.reduce((s, t) => s + (t.match(/[.!?]+/g) ?? []).length, 0) / texts.length;

    const sentenceComplexity =
        avgSentences < 1.5 ? 'single-sentence, direct'  :
        avgSentences < 3   ? 'multi-sentence, moderate'  :
                             'complex, multi-clause';

    const topTopics = extract_top_topics(texts, 5);

    return Object.freeze({
        avg_word_count:       avgWords,
        avg_length_category:  avgLengthCategory,
        formality,
        uses_punctuation:     usesPunctuation,
        sentence_complexity:  sentenceComplexity,
        top_topics:           topTopics,
        entries_analysed:     entries.length,
    });
}

// ─────────────────────────────────────────────────────────────
// CognitionEngine
// ─────────────────────────────────────────────────────────────
export class CognitionEngine {
    static MIN_HISTORY = 5;

    constructor() {
        this._consent         = null;   // null = not granted
        this._style_profile   = null;
        this._history_snapshot = [];
    }

    // ── Consent management ─────────────────────────────────────

    /**
     * Record explicit user consent.
     * Must be called before any analysis method.
     *
     * @param {{
     *   confirmedAt: number,   // epoch ms of user action
     *   source:      string,   // UI surface that captured consent (e.g. 'onboarding-modal')
     *   version?:    string,   // policy version accepted
     * }} consentRecord
     */
    grantConsent({ confirmedAt, source, version = '1.0' } = {}) {
        if (typeof confirmedAt !== 'number' || !isFinite(confirmedAt)) {
            throw new TypeError(
                '[CognitionEngine] grantConsent: confirmedAt must be a finite epoch timestamp.'
            );
        }
        if (typeof source !== 'string' || source.trim().length === 0) {
            throw new TypeError(
                '[CognitionEngine] grantConsent: source must be a non-empty string.'
            );
        }

        this._consent = Object.freeze({
            granted_at: confirmedAt,
            source:     source.trim(),
            version,
            revoked:    false,
        });

        return { success: true, consent: this._consent };
    }

    /**
     * Revoke consent.
     * Immediately purges all derived data. Idempotent.
     */
    revokeConsent() {
        this._style_profile    = null;
        this._history_snapshot = [];
        this._consent          = null;
        return { success: true, purged: true };
    }

    /**
     * Returns a read-only snapshot of the current consent record,
     * or null if not granted.
     */
    getConsentStatus() {
        return this._consent ? { ...this._consent } : null;
    }

    // ── Analysis methods ───────────────────────────────────────

    /**
     * Ingest a user's message history and build a style profile.
     * Requires consent to have been granted first.
     *
     * @param {Array<{ text: string, timestamp_ms?: number }>} history_array
     * @returns {{
     *   success:        boolean,
     *   profile_summary: object|null,
     *   message:        string
     * }}
     */
    ingestHistory(history_array) {
        this._assertConsent('ingestHistory');

        if (!Array.isArray(history_array)) {
            return {
                success: false,
                profile_summary: null,
                message: 'history_array must be an array.',
            };
        }

        if (history_array.length < CognitionEngine.MIN_HISTORY) {
            return {
                success: false,
                profile_summary: null,
                message: `At least ${CognitionEngine.MIN_HISTORY} entries required. Received ${history_array.length}.`,
            };
        }

        const valid = history_array
            .filter(e => e && typeof e.text === 'string' && e.text.trim().length > 0)
            .map(e => ({
                text:         e.text.trim().slice(0, 1_000),
                timestamp_ms: e.timestamp_ms ?? 0,
            }));

        if (valid.length < CognitionEngine.MIN_HISTORY) {
            return {
                success: false,
                profile_summary: null,
                message: 'Insufficient valid entries after filtering (empty or non-string texts removed).',
            };
        }

        this._history_snapshot = valid;
        this._style_profile    = build_style_profile(valid);

        return {
            success:         true,
            profile_summary: { ...this._style_profile },
            message:         `Style profile built from ${valid.length} entries.`,
        };
    }

    /**
     * Generate a system-prompt fragment for an LLM, adapted to the
     * user's detected communication style.
     * Requires consent AND a built profile (call ingestHistory first).
     *
     * @param {{ task_context?: string }} [options]
     * @returns {{ system_prompt_fragment: string, style_profile: object }}
     */
    generatePersonalizationPrompt({ task_context = 'general assistant' } = {}) {
        this._assertConsent('generatePersonalizationPrompt');

        if (!this._style_profile) {
            throw new Error(
                '[CognitionEngine] No style profile available. Call ingestHistory() first.'
            );
        }

        const p = this._style_profile;

        const fragment = [
            `You are a personal AI assistant helping with: ${task_context}.`,
            `Adapt your responses to match the user's preferred communication style:`,
            `- Formality: ${p.formality} (${p.formality === 'informal' ? 'casual and direct' : 'professional and structured'})`,
            `- Response length: ${p.avg_length_category} (~${p.avg_word_count} words on average)`,
            `- Punctuation: ${p.uses_punctuation ? 'standard — mirror this' : 'minimal — mirror this'}`,
            `- Common topics: ${p.top_topics.join(', ')}`,
            `- Sentence structure: ${p.sentence_complexity}`,
            `Always respond TO the user. Never generate outbound messages on the user's behalf without explicit per-message approval.`,
        ].join('\n');

        return {
            system_prompt_fragment: fragment,
            style_profile:         { ...this._style_profile },
        };
    }

    /**
     * Returns a read-only copy of the current style profile,
     * or null if not yet built.
     * Requires consent.
     *
     * @returns {object|null}
     */
    getStyleProfile() {
        this._assertConsent('getStyleProfile');
        return this._style_profile ? { ...this._style_profile } : null;
    }

    /**
     * Purge all stored history and derived profile data,
     * while keeping consent record intact.
     * Use when the user wants to reset without revoking consent.
     */
    purgeData() {
        this._assertConsent('purgeData');
        this._history_snapshot = [];
        this._style_profile    = null;
        return { success: true, purged: true };
    }

    // ── Private ────────────────────────────────────────────────

    /**
     * Hard gate: throws ConsentError if consent is not active.
     * Called at the entry point of every analysis method.
     *
     * @param {string} method_name  - For clear error messaging.
     */
    _assertConsent(method_name) {
        if (!this._consent) {
            throw new ConsentError(
                `[CognitionEngine] ${method_name}() requires explicit user consent. ` +
                `Call grantConsent({ confirmedAt, source }) first.`
            );
        }
    }
}
