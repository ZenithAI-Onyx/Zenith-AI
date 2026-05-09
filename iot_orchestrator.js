/**
 * MODULE 02 — IoTOrchestrator
 * Smart-Home IoT Anomaly Detection Engine
 * Detects thermal and motion anomalies across registered sensor nodes.
 *
 * Zero external dependencies. Zero network calls. Pure ES6.
 *
 * MEMORY MODEL:
 *   Each sensor's reading history is backed by a CircularBuffer with a
 *   fixed capacity of `history_depth` slots. Once full, the oldest entry
 *   is overwritten in O(1) — no allocation, no Array.shift() O(n) churn.
 *   Memory usage is strictly bounded from the moment the first reading
 *   arrives, preventing unbounded growth in long-running PWA sessions.
 */

'use strict';

// ─── CircularBuffer ───────────────────────────────────────────────────────────

/**
 * Fixed-capacity circular buffer.
 * Push is always O(1). Iteration order is oldest-to-newest.
 * Memory footprint is allocated once at construction and never grows.
 *
 * @template T
 */
class CircularBuffer {
    /**
     * @param {number} capacity  Maximum number of items to retain.
     *                           Must be a positive integer.
     */
    constructor(capacity) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError('[CircularBuffer] capacity must be a positive integer.');
        }
        this._capacity = capacity;
        this._buf      = new Array(capacity);   // pre-allocated, fixed size
        this._head     = 0;                     // index of the oldest slot
        this._size     = 0;                     // current count of valid items
    }

    /** Current number of items stored (0 … capacity). */
    get length() { return this._size; }

    /** Maximum number of items this buffer will ever hold. */
    get capacity() { return this._capacity; }

    /**
     * Append an item.
     * If the buffer is full, the oldest item is silently overwritten.
     * O(1) — no reallocation, no element shifting.
     *
     * @param {T} item
     */
    push(item) {
        if (this._size < this._capacity) {
            // Buffer not yet full — write at (head + size) and grow size.
            this._buf[(this._head + this._size) % this._capacity] = item;
            this._size++;
        } else {
            // Buffer full — overwrite the oldest slot (head) and advance head.
            this._buf[this._head] = item;
            this._head = (this._head + 1) % this._capacity;
        }
    }

    /**
     * Return a plain array snapshot ordered oldest → newest.
     * Allocates a new array of length `this._size` — use sparingly in hot paths.
     *
     * @returns {T[]}
     */
    toArray() {
        const out = new Array(this._size);
        for (let i = 0; i < this._size; i++) {
            out[i] = this._buf[(this._head + i) % this._capacity];
        }
        return out;
    }

    /**
     * Read item at logical index `i` (0 = oldest, size-1 = newest).
     * O(1). Returns undefined for out-of-bounds indices.
     *
     * @param {number} i
     * @returns {T|undefined}
     */
    at(i) {
        if (i < 0 || i >= this._size) return undefined;
        return this._buf[(this._head + i) % this._capacity];
    }

    /** The newest item, or undefined if the buffer is empty. */
    get last() { return this.at(this._size - 1); }

    /** The oldest item, or undefined if the buffer is empty. */
    get first() { return this.at(0); }

    /** Reset to empty without releasing the backing allocation. */
    clear() {
        this._head = 0;
        this._size = 0;
    }

    /** Make CircularBuffer iterable (oldest → newest). */
    [Symbol.iterator]() {
        let i = 0;
        return {
            next: () => i < this._size
                ? { value: this.at(i++), done: false }
                : { value: undefined,    done: true  },
        };
    }

    /**
     * Return the last `n` items as a plain array (oldest → newest).
     * Equivalent to Array.prototype.slice(-n) on the logical sequence.
     *
     * @param {number} n
     * @returns {T[]}
     */
    sliceLast(n) {
        const start = Math.max(0, this._size - n);
        const out   = new Array(this._size - start);
        for (let i = start; i < this._size; i++) {
            out[i - start] = this.at(i);
        }
        return out;
    }
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const SENSOR_TYPES = Object.freeze({
    THERMAL:  'THERMAL',
    MOTION:   'MOTION',
    COMBINED: 'COMBINED',
});

export const ANOMALY_SEVERITY = Object.freeze({
    NONE:     'NONE',
    LOW:      'LOW',
    MEDIUM:   'MEDIUM',
    HIGH:     'HIGH',
    CRITICAL: 'CRITICAL',
});

/** Default thresholds — caller may override per-sensor via registerSensor(). */
const DEFAULT_THERMAL_THRESHOLDS = Object.freeze({
    min_normal_c:   10,    // °C — below this is anomalous cold
    max_normal_c:   40,    // °C — above this is anomalous heat
    spike_delta_c:  8,     // °C change within one reading window → spike
    critical_c:     60,    // °C — immediate CRITICAL regardless of delta
    freeze_c:       0,     // °C — ice-risk threshold
});

const DEFAULT_MOTION_THRESHOLDS = Object.freeze({
    burst_count:      5,   // consecutive positive readings = burst
    burst_window_ms:  3_000,
    idle_timeout_ms:  30_000,   // no motion for N ms → mark zone idle
});

// ─── IoTOrchestrator ─────────────────────────────────────────────────────────

export class IoTOrchestrator {
    /**
     * @param {object} [options]
     * @param {number} [options.history_depth=200]      Max readings kept per sensor.
     *   Each sensor allocates exactly `history_depth` slots at registration time
     *   and never allocates more. Memory usage is O(sensors × history_depth).
     * @param {number} [options.alert_cooldown_ms=5000]  Min ms between repeated alerts.
     */
    constructor(options = {}) {
        this._sensors      = new Map();   // sensor_id → SensorConfig
        this._readings     = new Map();   // sensor_id → CircularBuffer<ReadingRecord>
        this._anomaly_log  = [];
        this._alert_times  = new Map();   // sensor_id → last alert timestamp

        this._history_depth  = options.history_depth    ?? 200;
        this._alert_cooldown = options.alert_cooldown_ms ?? 5_000;

        console.log('[IoTOrchestrator] Initialized.');
    }

    // ── Sensor Registry ──────────────────────────────────────────────────────

    /**
     * Register a new sensor node.
     * Allocates a fixed CircularBuffer of `history_depth` slots immediately.
     *
     * @param {string} sensor_id
     * @param {string} type  — SENSOR_TYPES value
     * @param {object} [overrides]  — partial threshold overrides
     * @returns {{ success: boolean, sensor_id: string }}
     */
    registerSensor(sensor_id, type, overrides = {}) {
        if (!Object.values(SENSOR_TYPES).includes(type)) {
            return { success: false, error: `Unknown sensor type: ${type}` };
        }
        if (this._sensors.has(sensor_id)) {
            return { success: false, error: `Sensor '${sensor_id}' already registered.` };
        }

        const thermal_thresholds = { ...DEFAULT_THERMAL_THRESHOLDS, ...(overrides.thermal ?? {}) };
        const motion_thresholds  = { ...DEFAULT_MOTION_THRESHOLDS,  ...(overrides.motion  ?? {}) };

        this._sensors.set(sensor_id, {
            sensor_id,
            type,
            thermal_thresholds,
            motion_thresholds,
            registered_at: Date.now(),
            active: true,
        });

        // Pre-allocate the circular buffer at registration time.
        // From this point on, no further heap growth occurs for this sensor's history.
        this._readings.set(sensor_id, new CircularBuffer(this._history_depth));

        console.log(`[IoTOrchestrator] Sensor registered: ${sensor_id} (${type})`);
        return { success: true, sensor_id };
    }

    /** Deactivate a sensor without removing its history. */
    deactivateSensor(sensor_id) {
        const sensor = this._sensors.get(sensor_id);
        if (!sensor) return { success: false, error: 'Sensor not found.' };
        sensor.active = false;
        return { success: true };
    }

    listSensors() {
        return [...this._sensors.values()].map(s => ({
            sensor_id:     s.sensor_id,
            type:          s.type,
            active:        s.active,
            reading_count: this._readings.get(s.sensor_id)?.length ?? 0,
        }));
    }

    // ── Reading Ingestion ─────────────────────────────────────────────────────

    /**
     * Push a new reading into a sensor's circular buffer and run anomaly checks.
     * The push is O(1) — the buffer never reallocates or shifts elements.
     *
     * @param {string} sensor_id
     * @param {object} payload
     *   - For THERMAL  : { temperature_c: number }
     *   - For MOTION   : { motion_detected: boolean, magnitude?: number }
     *   - For COMBINED : { temperature_c: number, motion_detected: boolean, magnitude?: number }
     * @param {number} [timestamp_ms]  — defaults to Date.now()
     * @returns {AnomalyResult}
     */
    ingestReading(sensor_id, payload, timestamp_ms = Date.now()) {
        const sensor = this._sensors.get(sensor_id);
        if (!sensor)        return this._errorResult(sensor_id, 'Sensor not found.');
        if (!sensor.active) return this._errorResult(sensor_id, 'Sensor is inactive.');

        const record  = { timestamp: timestamp_ms, ...payload };
        const buffer  = this._readings.get(sensor_id);

        // O(1) push — oldest entry is silently overwritten when buffer is full.
        buffer.push(record);

        // Pass a plain-array snapshot to the analyzers.
        // toArray() is O(capacity) but keeps all downstream logic array-native.
        const history = buffer.toArray();

        return this._analyzeReading(sensor, record, history);
    }

    // ── Analysis ──────────────────────────────────────────────────────────────

    _analyzeReading(sensor, record, history) {
        const anomalies = [];

        if (sensor.type === SENSOR_TYPES.THERMAL || sensor.type === SENSOR_TYPES.COMBINED) {
            const thermal = this._checkThermal(record, history, sensor.thermal_thresholds);
            if (thermal) anomalies.push(thermal);
        }
        if (sensor.type === SENSOR_TYPES.MOTION || sensor.type === SENSOR_TYPES.COMBINED) {
            const motion = this._checkMotion(record, history, sensor.motion_thresholds);
            if (motion) anomalies.push(motion);
        }

        const severity = this._aggregateSeverity(anomalies);
        const result   = {
            sensor_id:  sensor.sensor_id,
            timestamp:  record.timestamp,
            severity,
            anomalies,
            reading:    record,
        };

        if (severity !== ANOMALY_SEVERITY.NONE) {
            this._recordAnomaly(result);
        }

        return result;
    }

    // ── Thermal Analysis ─────────────────────────────────────────────────────

    _checkThermal(record, history, thresholds) {
        const t = record.temperature_c;
        if (t == null || typeof t !== 'number') return null;

        // CRITICAL: absolute temperature breach
        if (t >= thresholds.critical_c) {
            return {
                type:     'THERMAL_CRITICAL',
                severity: ANOMALY_SEVERITY.CRITICAL,
                detail:   `Temperature ${t}°C exceeds critical limit ${thresholds.critical_c}°C`,
                value:    t,
            };
        }

        // FREEZE risk
        if (t <= thresholds.freeze_c) {
            return {
                type:     'THERMAL_FREEZE',
                severity: ANOMALY_SEVERITY.HIGH,
                detail:   `Temperature ${t}°C at or below freeze threshold ${thresholds.freeze_c}°C`,
                value:    t,
            };
        }

        // Out-of-normal-range
        if (t < thresholds.min_normal_c || t > thresholds.max_normal_c) {
            const severity = t > thresholds.max_normal_c
                ? ANOMALY_SEVERITY.MEDIUM
                : ANOMALY_SEVERITY.LOW;
            return {
                type:     'THERMAL_OUT_OF_RANGE',
                severity,
                detail:   `Temperature ${t}°C outside normal range [${thresholds.min_normal_c}–${thresholds.max_normal_c}]°C`,
                value:    t,
            };
        }

        // SPIKE: large delta from previous reading
        if (history.length >= 2) {
            const prev = history[history.length - 2]?.temperature_c;
            if (prev != null) {
                const delta = Math.abs(t - prev);
                if (delta >= thresholds.spike_delta_c) {
                    return {
                        type:     'THERMAL_SPIKE',
                        severity: ANOMALY_SEVERITY.HIGH,
                        detail:   `Rapid temperature change of ${delta.toFixed(2)}°C (threshold: ${thresholds.spike_delta_c}°C)`,
                        value:    t,
                        delta,
                    };
                }
            }
        }

        return null;
    }

    // ── Motion Analysis ───────────────────────────────────────────────────────

    _checkMotion(record, history, thresholds) {
        const detected = record.motion_detected;
        if (typeof detected !== 'boolean') return null;

        // Motion burst: N consecutive positive detections within a time window
        if (detected) {
            const windowStart    = record.timestamp - thresholds.burst_window_ms;
            const recentPositive = history
                .slice(-thresholds.burst_count)
                .filter(r => r.motion_detected === true && r.timestamp >= windowStart);

            if (recentPositive.length >= thresholds.burst_count) {
                const magnitude = record.magnitude ?? null;
                return {
                    type:      'MOTION_BURST',
                    severity:  ANOMALY_SEVERITY.MEDIUM,
                    detail:    `${recentPositive.length} motion events in ${thresholds.burst_window_ms}ms window`,
                    burst_len: recentPositive.length,
                    magnitude,
                };
            }
        }

        // Sudden motion after long idle period
        if (detected && history.length >= 2) {
            const prev = history[history.length - 2];
            if (!prev.motion_detected) {
                const idleSince = this._lastMotionTimestamp(history.slice(0, -1));
                if (idleSince !== null) {
                    const idleMs = record.timestamp - idleSince;
                    if (idleMs >= thresholds.idle_timeout_ms) {
                        return {
                            type:     'MOTION_AFTER_IDLE',
                            severity: ANOMALY_SEVERITY.LOW,
                            detail:   `Motion detected after ${Math.round(idleMs / 1000)}s of inactivity`,
                            idle_ms:  idleMs,
                        };
                    }
                }
            }
        }

        return null;
    }

    _lastMotionTimestamp(history) {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].motion_detected === true) return history[i].timestamp;
        }
        return null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _aggregateSeverity(anomalies) {
        const order = [
            ANOMALY_SEVERITY.NONE,
            ANOMALY_SEVERITY.LOW,
            ANOMALY_SEVERITY.MEDIUM,
            ANOMALY_SEVERITY.HIGH,
            ANOMALY_SEVERITY.CRITICAL,
        ];
        let max = ANOMALY_SEVERITY.NONE;
        for (const a of anomalies) {
            if (order.indexOf(a.severity) > order.indexOf(max)) max = a.severity;
        }
        return max;
    }

    _recordAnomaly(result) {
        const now  = result.timestamp;
        const last = this._alert_times.get(result.sensor_id) ?? 0;

        if (now - last >= this._alert_cooldown) {
            this._alert_times.set(result.sensor_id, now);
            this._anomaly_log.push({ ...result });
            console.warn(`[IoTOrchestrator] ANOMALY [${result.severity}] on ${result.sensor_id}:`,
                result.anomalies.map(a => a.type).join(', '));
        }
    }

    _errorResult(sensor_id, error) {
        return { sensor_id, timestamp: Date.now(), severity: ANOMALY_SEVERITY.NONE, anomalies: [], error };
    }

    // ── Reporting ─────────────────────────────────────────────────────────────

    /** Returns a copy of the anomaly log, optionally filtered. */
    getAnomalyLog({ sensor_id, min_severity, since_ms } = {}) {
        const order = Object.values(ANOMALY_SEVERITY);
        return this._anomaly_log.filter(entry => {
            if (sensor_id    && entry.sensor_id !== sensor_id) return false;
            if (since_ms     && entry.timestamp < since_ms)    return false;
            if (min_severity && order.indexOf(entry.severity) < order.indexOf(min_severity)) return false;
            return true;
        });
    }

    /** Last N readings for a sensor. */
    getHistory(sensor_id, limit = 50) {
        const buffer = this._readings.get(sensor_id);
        if (!buffer) return { error: 'Sensor not found.' };
        return buffer.sliceLast(limit);
    }

    /** Aggregated stats for a thermal sensor. */
    getThermalStats(sensor_id) {
        const buffer = this._readings.get(sensor_id);
        if (!buffer || buffer.length === 0) return null;

        const temps = [...buffer].map(r => r.temperature_c).filter(v => v != null);
        if (temps.length === 0) return null;

        const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
        return {
            sensor_id,
            count:  temps.length,
            min_c:  Math.min(...temps),
            max_c:  Math.max(...temps),
            avg_c:  parseFloat(avg.toFixed(2)),
            latest: temps[temps.length - 1],
        };
    }
}
