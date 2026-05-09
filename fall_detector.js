/**
 * fall_detector.js
 * ─────────────────────────────────────────────────────────────
 * Personal Health — Fall & Impact Detection
 * Pure signal-processing module. No I/O, no network, no side effects.
 *
 * DESIGN PHILOSOPHY:
 *   The device owner is ALWAYS the subject and the sole recipient of
 *   any alert. This module only returns structured results; it never
 *   pushes, transmits, or stores anything on its own.
 *
 * USAGE:
 *   import { FallDetector } from './fall_detector.js';
 *   const detector = new FallDetector();
 *
 *   // Pass timestamp_ms with each sample for time-accurate windows.
 *   // If omitted, Date.now() is used automatically.
 *   const result = detector.analyze({ x: 0.1, y: 9.5, z: 0.3, timestamp_ms: Date.now() });
 *   if (result.event !== 'NONE') showAlertToUser(result);
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

// ── Physical constants ────────────────────────────────────────
/** Standard gravity (m/s²) — reference for 1 G */
const G = 9.80665;

// ── Configurable thresholds (tune per device / use-case) ─────
const DEFAULT_CONFIG = Object.freeze({
    // Free-fall: resultant acceleration well below 1 G
    freeFallThreshold_g:    0.4,    // resultant < 0.4 G  → free-fall candidate
    freeFallMinDuration_ms: 300,    // must persist for at least N ms (≈3 samples @ 10 Hz)

    // Impact: sudden spike well above 1 G
    impactThreshold_g:      2.5,    // resultant > 2.5 G  → impact candidate

    // Sudden-snatch (wrist / pocket tear): rapid Δ magnitude in one step
    snatchDeltaThreshold_g: 1.8,   // |Δmagnitude| > 1.8 G in one sample

    // Inactivity after impact: device goes still → likely on floor
    postImpactRestThreshold_g:  0.15,   // deviation from 1 G < 0.15 G
    postImpactRestDuration_ms:  500,    // must remain still for at least N ms (≈5 samples @ 10 Hz)

    // How long after an impact we watch for POST_IMPACT_REST
    impactWindowDuration_ms: 3000,  // 3 s — device-rate-independent
});

// ── Event types returned to the caller ───────────────────────
export const DetectionEvent = Object.freeze({
    NONE:             'NONE',             // normal motion
    FREE_FALL:        'FREE_FALL',        // device in free fall
    IMPACT:           'IMPACT',           // sudden hard impact
    FALL_SEQUENCE:    'FALL_SEQUENCE',    // free-fall THEN impact → likely fall
    SNATCH:           'SNATCH',           // sudden violent grab / tear
    POST_IMPACT_REST: 'POST_IMPACT_REST', // motionless after impact
});

// ─────────────────────────────────────────────────────────────
// Helper: compute resultant (magnitude) of 3-axis vector
// ─────────────────────────────────────────────────────────────
function magnitude({ x, y, z }) {
    return Math.sqrt(x * x + y * y + z * z);
}

// ─────────────────────────────────────────────────────────────
// Helper: validate a raw accelerometer sample
// ─────────────────────────────────────────────────────────────
function assertValidSample(sample) {
    if (
        sample == null ||
        typeof sample.x !== 'number' ||
        typeof sample.y !== 'number' ||
        typeof sample.z !== 'number' ||
        !isFinite(sample.x) ||
        !isFinite(sample.y) ||
        !isFinite(sample.z)
    ) {
        throw new TypeError(
            '[FallDetector] Invalid sample. Expected { x, y, z } with finite numbers.'
        );
    }
    if (
        sample.timestamp_ms !== undefined &&
        (typeof sample.timestamp_ms !== 'number' || !isFinite(sample.timestamp_ms))
    ) {
        throw new TypeError(
            '[FallDetector] Invalid sample.timestamp_ms. Must be a finite number (epoch ms).'
        );
    }
}

// ─────────────────────────────────────────────────────────────
// FallDetector — stateful stream processor
// ─────────────────────────────────────────────────────────────
export class FallDetector {
    /**
     * @param {object} [config] - Optional overrides for detection thresholds.
     */
    constructor(config = {}) {
        this._cfg = Object.freeze({ ...DEFAULT_CONFIG, ...config });

        // Sliding-window state — all durations tracked in real ms, not frame counts
        this._freeFallStartTs       = null;  // timestamp_ms when free-fall phase began
        this._postImpactRestStartTs = null;  // timestamp_ms when post-impact stillness began
        this._lastMagnitude_g       = null;  // magnitude of previous sample in G
        this._recentImpact          = false; // did we see an impact in recent window?
        this._impactTs              = null;  // timestamp_ms of the last impact event

        // Immutable event log (read-only reference returned to callers)
        this._eventLog = [];
    }

    // ── Public API ─────────────────────────────────────────────

    /**
     * Analyze one accelerometer sample.
     *
     * @param {{
     *   x:            number,
     *   y:            number,
     *   z:            number,
     *   timestamp_ms?: number  // epoch ms; falls back to Date.now() if omitted
     * }} sample
     *   Raw accelerometer reading in m/s² (device frame, any orientation).
     *
     * @returns {{
     *   event:        string,      // DetectionEvent constant
     *   magnitude_g:  number,      // resultant in G units
     *   delta_g:      number|null,
     *   confidence:   number,      // 0–1 heuristic
     *   timestamp_ms: number
     * }}
     */
    analyze(sample) {
        assertValidSample(sample);

        // Resolve timestamp — prefer the sample's own clock, fall back to wall clock.
        const now = typeof sample.timestamp_ms === 'number'
            ? sample.timestamp_ms
            : Date.now();

        const mag_ms2 = magnitude(sample);
        const mag_g   = mag_ms2 / G;
        const delta_g = this._lastMagnitude_g !== null
            ? mag_g - this._lastMagnitude_g
            : null;

        const result = this._classify(mag_g, delta_g, now);

        this._lastMagnitude_g = mag_g;

        // Update impact-window state using real elapsed time, not frame counts
        if (result.event === DetectionEvent.IMPACT ||
            result.event === DetectionEvent.FALL_SEQUENCE) {
            this._recentImpact          = true;
            this._impactTs              = now;
            this._postImpactRestStartTs = null;
        } else if (this._recentImpact) {
            const elapsedSinceImpact = now - this._impactTs;
            if (elapsedSinceImpact > this._cfg.impactWindowDuration_ms) {
                this._recentImpact          = false;
                this._impactTs              = null;
                this._postImpactRestStartTs = null;
            }
        }

        const record = {
            ...result,
            magnitude_g:  Math.round(mag_g  * 1000) / 1000,
            delta_g:      delta_g !== null ? Math.round(delta_g * 1000) / 1000 : null,
            timestamp_ms: now,
        };

        if (record.event !== DetectionEvent.NONE) {
            this._eventLog.push(Object.freeze(record));
        }

        return record;
    }

    /**
     * Process a batch of samples in order.
     * Returns an array of results, one per sample.
     *
     * @param {Array<{ x: number, y: number, z: number, timestamp_ms?: number }>} samples
     * @returns {Array<object>}
     */
    analyzeBatch(samples) {
        if (!Array.isArray(samples)) {
            throw new TypeError('[FallDetector] analyzeBatch expects an array.');
        }
        return samples.map(s => this.analyze(s));
    }

    /**
     * Returns a frozen snapshot of all non-NONE events detected so far.
     * @returns {ReadonlyArray<object>}
     */
    getEventLog() {
        return Object.freeze([...this._eventLog]);
    }

    /** Reset internal state (e.g., when starting a new monitoring session). */
    reset() {
        this._freeFallStartTs       = null;
        this._postImpactRestStartTs = null;
        this._lastMagnitude_g       = null;
        this._recentImpact          = false;
        this._impactTs              = null;
        this._eventLog              = [];
    }

    // ── Private classification logic ───────────────────────────

    /**
     * @param {number}      mag_g    — current resultant in G
     * @param {number|null} delta_g  — change since last sample in G
     * @param {number}      now      — resolved timestamp_ms for this sample
     */
    _classify(mag_g, delta_g, now) {
        const cfg = this._cfg;

        // 1. Snatch detection — highest priority, checked first
        //    A violent tear produces a huge positive Δ in a single sample.
        if (delta_g !== null && delta_g > cfg.snatchDeltaThreshold_g) {
            this._freeFallStartTs = null;
            return {
                event:      DetectionEvent.SNATCH,
                confidence: Math.min(1, (delta_g - cfg.snatchDeltaThreshold_g) / 2 + 0.6),
            };
        }

        // 2. Free-fall detection — duration-based, not frame-count-based
        if (mag_g < cfg.freeFallThreshold_g) {
            if (this._freeFallStartTs === null) {
                this._freeFallStartTs = now;  // mark start of free-fall phase
            }
        } else {
            // 3. Impact detection — check if this terminates a free-fall sequence
            if (mag_g > cfg.impactThreshold_g) {
                const freeFallDuration = this._freeFallStartTs !== null
                    ? now - this._freeFallStartTs
                    : 0;
                const wasFreeFall = freeFallDuration >= cfg.freeFallMinDuration_ms;
                this._freeFallStartTs = null;

                const event = wasFreeFall
                    ? DetectionEvent.FALL_SEQUENCE
                    : DetectionEvent.IMPACT;

                const confidence = Math.min(
                    1,
                    (mag_g - cfg.impactThreshold_g) / 3 + (wasFreeFall ? 0.3 : 0) + 0.5
                );

                return { event, confidence };
            }

            // 4. Post-impact rest detection — duration-based
            if (this._recentImpact) {
                const deviation = Math.abs(mag_g - 1.0);   // deviation from 1 G (at rest)
                if (deviation < cfg.postImpactRestThreshold_g) {
                    if (this._postImpactRestStartTs === null) {
                        this._postImpactRestStartTs = now;  // mark start of stillness
                    }
                    const stillDuration = now - this._postImpactRestStartTs;
                    if (stillDuration >= cfg.postImpactRestDuration_ms) {
                        return {
                            event:      DetectionEvent.POST_IMPACT_REST,
                            confidence: 0.75,
                        };
                    }
                } else {
                    this._postImpactRestStartTs = null;  // stillness broken, reset
                }
            }

            this._freeFallStartTs = null;
        }

        // 5. Free-fall ongoing — emit event once minimum duration is reached
        if (
            this._freeFallStartTs !== null &&
            (now - this._freeFallStartTs) >= cfg.freeFallMinDuration_ms
        ) {
            const confidence = Math.min(1, (cfg.freeFallThreshold_g - mag_g) / 0.3 + 0.5);
            return { event: DetectionEvent.FREE_FALL, confidence };
        }

        return { event: DetectionEvent.NONE, confidence: 1.0 };
    }
}


// ─────────────────────────────────────────────────────────────
// Convenience: static one-shot classifier (no state needed)
// ─────────────────────────────────────────────────────────────

/**
 * Classify a single sample without instantiating a detector.
 * Useful for one-off checks; no sequence-aware logic is applied.
 *
 * @param {{ x: number, y: number, z: number, timestamp_ms?: number }} sample
 * @param {object} [config]
 * @returns {{ magnitude_g: number, event: string }}
 */
export function classifySample(sample, config = {}) {
    const detector = new FallDetector(config);
    return detector.analyze(sample);
}
