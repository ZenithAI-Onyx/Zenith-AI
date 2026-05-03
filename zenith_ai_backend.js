// ============================================================
// ZENITH_AI BACKEND LOGIC ENGINE  v2.0
// Author:        Jacob Fontech Gamboa
// Corporation:   ONYX_ENTERPRISES
// Architecture:  Universal Omni-Hub AI Backend
// Mode:          Pure Logic & Data Structures (ES6 Modules)
// ============================================================

'use strict';

// ============================================================
// CORE CONSTANTS & ENUMS
// ============================================================

export const SYSTEM_STATES = Object.freeze({
    NOMINAL:           'NOMINAL',
    ALERT:             'ALERT',
    LOCKDOWN:          'LOCKDOWN',
    GHOST_MODE_ACTIVE: 'GHOST_MODE_ACTIVE',
    DEAD_WEIGHT:       'DEAD_WEIGHT',
    TAMPER_HALT:       'TAMPER_HALT',
});

export const ALERT_LEVELS = Object.freeze({
    LOW:      1,
    MEDIUM:   2,
    HIGH:     3,
    CRITICAL: 4,
});

export const TRANSIT_STATES = Object.freeze({
    IDLE:        'IDLE',
    SEARCHING:   'SEARCHING',
    ACCEPTED:    'ACCEPTED',
    APPROACHING: 'APPROACHING',
    ARRIVED:     'ARRIVED',
    IN_TRIP:     'IN_TRIP',
    COMPLETED:   'COMPLETED',
    CANCELLED:   'CANCELLED',
});

// Global System State Singleton
// PRODUCTION: All secrets → argon2id hashes in hardware-backed secure enclave
export const ZenithCoreState = {
    systemState:      SYSTEM_STATES.NOMINAL,
    panic_code:       '4721',
    recovery_code:    'ONYX-9-ECHO',
    valid_pins:       ['1984', '2001', 'admin'],
    real_location:    { lat: 37.7749, lon: -122.4194 },
    authorized_hosts: [
        'app.onyx-enterprises.com',
        'zenith.onyx-enterprises.com',
        'localhost',
    ],
};

const ILLUSION_STATE_TEMPLATE = Object.freeze({
    contacts:      [],
    messages:      [],
    notifications: [],
    apps: [
        { id: 'calculator', label: 'Calculator' },
        { id: 'clock',      label: 'Clock'      },
        { id: 'settings',   label: 'Settings'   },
        { id: 'camera',     label: 'Camera'     },
    ],
    logs:         [],
    user_profile: { name: 'User', avatar: null },
    last_sync:    null,
});


// ============================================================
// MODULE 00: Environment Integrity (Anti-Tampering)
// ============================================================

export function verifyHostEnvironment(state_ref, origin) {
    const host = origin
        ?? (typeof window !== 'undefined' ? window.location.hostname : 'unknown');

    const authorized = state_ref.authorized_hosts.includes(host);

    if (!authorized) {
        state_ref.valid_pins    = [];
        state_ref.real_location = { lat: 0, lon: 0 };
        state_ref.systemState   = SYSTEM_STATES.TAMPER_HALT;

        const tamper_event = {
            event:     'HOST_INTEGRITY_FAILURE',
            host,
            timestamp: Date.now(),
        };

        console.warn('[ZenithIntegrity] Unauthorized host. Self-preservation executed.');
        return { authorized: false, host, action: 'HALT_AND_WIPE', tamper_event };
    }

    console.log(`[ZenithIntegrity] Host verified: ${host}`);
    return { authorized: true, host, action: 'NONE' };
}


// ============================================================
// MODULE 01: GhostVault — Security Core + IllusionOS
// ============================================================

export class GhostVault {
    constructor(state_ref) {
        this.state                    = state_ref;
        this.audit_log                = [];
        this._ghost_location_interval = null;
        this._ghost_mode_timestamp    = null;
        this._real_state_snapshot     = null;
        this._illusion_active         = false;

        this.threat_database = [
            { type: 'phishing', signature: 'login-confirm.php'      },
            { type: 'adware',   signature: 'doubleclick_tracker_v3' },
            { type: 'phishing', signature: 'verify-account.now'     },
        ];

        console.log('[GhostVault] Initialized. State monitor active.');
    }

    authenticate(pin) {
        if (!pin || typeof pin !== 'string') {
            this._appendLog('AUTH_ERROR', 'Null or invalid PIN type');
            return SYSTEM_STATES.ALERT;
        }

        if (pin === this.state.panic_code) {
            this._activateGhostMode();
            return this.state.systemState;
        }

        if (this.state.valid_pins.includes(pin)) {
            this.state.systemState = SYSTEM_STATES.NOMINAL;
            this._appendLog('AUTH', 'Successful authentication');
            return SYSTEM_STATES.NOMINAL;
        }

        this.state.systemState = SYSTEM_STATES.ALERT;
        this._appendLog('AUTH_FAIL', 'Failed authentication attempt');
        return SYSTEM_STATES.ALERT;
    }

    _activateGhostMode() {
        this._ghost_mode_timestamp = Date.now();

        // 1. Memory-lock the real state before wiping
        this._real_state_snapshot = JSON.parse(JSON.stringify({
            valid_pins:      this.state.valid_pins,
            real_location:   this.state.real_location,
            threat_database: this.threat_database,
            audit_log:       this.audit_log,
        }));
        this._illusion_active = true;

        // 2. Inject IllusionOS decoy scaffold
        this.state.illusion_payload = JSON.parse(JSON.stringify(ILLUSION_STATE_TEMPLATE));

        // 3. Wipe live sensitive data from inspectable memory
        this.state.valid_pins = [];
        this.threat_database  = [];
        this.audit_log        = [];

        // 4. Set state flag
        this.state.systemState = SYSTEM_STATES.GHOST_MODE_ACTIVE;

        this._appendLog('GHOST_ACTIVATED', {
            timestamp: this._ghost_mode_timestamp,
            note:      'IllusionOS active. Real state memory-locked.',
        });

        // 5. Silent GPS loop — real coordinates, no spoofing
        this._ghost_location_interval = setInterval(
            () => this._transmitRealLocation(),
            10_000
        );
        this._transmitRealLocation();

        console.log('[GhostVault] System nominal.');
    }

    _transmitRealLocation() {
        const safe_location = this._real_state_snapshot?.real_location
            ?? this.state.real_location;

        const payload = {
            event:     'GHOST_MODE_LOCATION_PING',
            location:  safe_location,
            timestamp: Date.now(),
        };
        // PRODUCTION: await fetch('/api/onyx-safety/location', { method: 'POST', body: JSON.stringify(payload) })
        this._appendLog('GHOST_LOCATION_PING', payload);
        console.log('[ZenithSync] Sync pulse dispatched.');
    }

    deactivateGhostMode(secret_recovery_code) {
        if (this.state.systemState !== SYSTEM_STATES.GHOST_MODE_ACTIVE) {
            return { success: false, state: this.state.systemState, message: 'Ghost Mode not active.' };
        }

        if (secret_recovery_code !== this.state.recovery_code) {
            this._appendLog('GHOST_RECOVERY_FAIL', 'Incorrect recovery code');
            return { success: false, state: SYSTEM_STATES.GHOST_MODE_ACTIVE, message: 'Mismatch.' };
        }

        if (this._ghost_location_interval) {
            clearInterval(this._ghost_location_interval);
            this._ghost_location_interval = null;
        }

        if (this._real_state_snapshot) {
            this.state.valid_pins    = this._real_state_snapshot.valid_pins;
            this.state.real_location = this._real_state_snapshot.real_location;
            this.threat_database     = this._real_state_snapshot.threat_database;
            this.audit_log           = this._real_state_snapshot.audit_log;
            this._real_state_snapshot = null;
        }

        delete this.state.illusion_payload;
        this._illusion_active      = false;
        this._ghost_mode_timestamp = null;
        this.state.systemState     = SYSTEM_STATES.NOMINAL;

        this._appendLog('GHOST_DEACTIVATED', { timestamp: Date.now() });
        console.log('[GhostVault] Full system restored.');
        return { success: true, state: SYSTEM_STATES.NOMINAL, message: 'Ghost Mode deactivated.' };
    }

    threatAnalysis(data_stream) {
        if (typeof data_stream !== 'string') return [];

        const lower    = data_stream.toLowerCase();
        const detected = [];

        for (const threat of this.threat_database) {
            if (lower.includes(threat.signature)) {
                const alert = {
                    type:             threat.type,
                    signature:        threat.signature,
                    severity:         threat.type === 'phishing' ? ALERT_LEVELS.HIGH : ALERT_LEVELS.MEDIUM,
                    suggested_action: threat.type === 'phishing' ? 'BLOCK_URL' : 'SCAN_ENDPOINT',
                };
                detected.push(alert);
                this._appendLog('THREAT_DETECTED', alert);
            }
        }

        if (detected.length === 0) console.log('[GhostVault] Stream clean.');
        return detected;
    }

    _appendLog(type, data) {
        this.audit_log.push({ timestamp: Date.now(), type, data });
    }
}


// ============================================================
// MODULE 02: ZenithHome (IoT & Matter Protocol)
// ============================================================

export class IoTOrchestrator {
    constructor() {
        this.anomaly_rules = {
            motion:      { silent_hours_start: 22, silent_hours_end: 6 },
            temperature: { max_delta_per_min: 5 },
        };
        console.log('[IoTOrchestrator] Home mesh initialized.');
    }

    processSensorData(sensor_payload) {
        if (!sensor_payload || typeof sensor_payload !== 'object') {
            return { anomaly: false, command: 'IGNORE', reason: 'Invalid payload' };
        }

        const { type, value, timestamp } = sensor_payload;

        if (type === 'motion' && value === 1) {
            const hour = parseInt(String(timestamp).split(':')[0], 10);
            if (isNaN(hour)) return { anomaly: false, command: 'IGNORE', reason: 'Unparseable timestamp' };

            const silent = hour >= this.anomaly_rules.motion.silent_hours_start
                        || hour  < this.anomaly_rules.motion.silent_hours_end;

            if (silent) {
                console.warn(`[IoTOrchestrator] ANOMALY: Motion at ${timestamp}`);
                return { anomaly: true, command: 'TRIGGER_ALARM', reason: `Motion at ${timestamp}` };
            }
        }

        return { anomaly: false, command: 'IGNORE', reason: 'Within normal parameters' };
    }
}


// ============================================================
// MODULE 03: ZenithDrive (Vehicle Telemetry)
// ============================================================

export class VehicleDiagnostic {
    constructor() {
        this.thresholds = {
            mileage_km:       100_000,
            tire_wear_mm:     1.6,
            oil_life_percent: 15,
        };
        console.log('[VehicleDiagnostic] OBD-II analyzer ready.');
    }

    analyzeTelemetry(json_data) {
        if (!json_data || typeof json_data !== 'object') return [];

        const alerts = [];
        const { mileage, tire_wear, oil_life } = json_data;

        if (typeof oil_life  === 'number' && oil_life  <= this.thresholds.oil_life_percent)
            alerts.push({ component: 'ENGINE_OIL',       criticality: ALERT_LEVELS.HIGH,     message: `Oil life critical at ${oil_life}%. Immediate change required.`,         current_value: oil_life,  threshold: this.thresholds.oil_life_percent });
        if (typeof tire_wear === 'number' && tire_wear <= this.thresholds.tire_wear_mm)
            alerts.push({ component: 'TIRES',            criticality: ALERT_LEVELS.CRITICAL,  message: `Tread ${tire_wear}mm — legal limit breached. Replace immediately.`,     current_value: tire_wear, threshold: this.thresholds.tire_wear_mm });
        if (typeof mileage   === 'number' && mileage   >= this.thresholds.mileage_km)
            alerts.push({ component: 'SCHEDULED_SERVICE',criticality: ALERT_LEVELS.MEDIUM,    message: `Vehicle at ${mileage}km. Major service due.`,                          current_value: mileage,   threshold: this.thresholds.mileage_km });

        alerts.length === 0
            ? console.log('[VehicleDiagnostic] Systems nominal.')
            : console.warn(`[VehicleDiagnostic] ${alerts.length} issue(s).`);

        return alerts;
    }
}


// ============================================================
// MODULE 04: ZenithVital — Health Monitor + Safety Telemetry
// ============================================================

export class HealthProcessor {
    constructor() {
        this.vital_bounds = {
            bpm:  { min: 40, max: 180 },
            fall: { g_force_threshold: 2.5, recovery_time_ms: 5_000, flatline_time_ms: 10_000 },
        };
        this._fall_state = { potential_fall_time: null, post_fall_movement: false };

        // Rolling 60-second ephemeral audio safety buffer
        // CONSENT: Must only activate after explicit user opt-in via ONYX consent flow.
        // Frames are never written to disk — only compiled into a DeadWeight payload on flush.
        this._AUDIO_BUFFER_WINDOW_MS = 60_000;
        this._audio_buffer           = [];
        this._audio_buffer_active    = false;

        // DeadWeight anti-snatch state
        this._dead_weight_active = false;
        this._snatch_g_threshold = 4.5;
        this._snatch_duration_ms = 300;

        console.log('[HealthProcessor] Biometric monitor initialized.');
    }

    // ---- Acoustic Buffer ----

    activateAcousticBuffer() {
        this._audio_buffer_active = true;
        this._audio_buffer        = [];
        console.log('[HealthProcessor] Acoustic safety buffer active.');
    }

    deactivateAcousticBuffer() {
        this._audio_buffer_active = false;
        this._audio_buffer        = [];
        console.log('[HealthProcessor] Acoustic buffer cleared.');
    }

    ingestAudioFrame(audio_frame) {
        if (!this._audio_buffer_active) return;
        if (!audio_frame || typeof audio_frame.timestamp_ms !== 'number') return;

        const cutoff = Date.now() - this._AUDIO_BUFFER_WINDOW_MS;
        this._audio_buffer = this._audio_buffer.filter(f => f.timestamp_ms >= cutoff);
        this._audio_buffer.push({ timestamp_ms: audio_frame.timestamp_ms, frame_data: audio_frame.frame_data });
    }

    getAcousticBufferStatus() {
        if (this._audio_buffer.length === 0) return { frame_count: 0, span_ms: 0 };
        const oldest = this._audio_buffer[0].timestamp_ms;
        const newest = this._audio_buffer[this._audio_buffer.length - 1].timestamp_ms;
        return { frame_count: this._audio_buffer.length, span_ms: newest - oldest };
    }

    // ---- DeadWeight Protocol ----

    processDeadWeightProtocol(accel_magnitude, state_ref, spike_duration = 0) {
        if (this._dead_weight_active) {
            return { triggered: false, state: SYSTEM_STATES.DEAD_WEIGHT, message: 'Protocol already active.' };
        }

        const is_snatch = accel_magnitude >= this._snatch_g_threshold
                       && spike_duration  <= this._snatch_duration_ms;

        if (!is_snatch) {
            return { triggered: false, state: state_ref.systemState, message: 'No snatch signature.' };
        }

        console.warn('[HealthProcessor] Snatch signature detected. DeadWeight engaging.');

        this._dead_weight_active = true;
        state_ref.systemState    = SYSTEM_STATES.DEAD_WEIGHT;

        const evidence_payload = {
            event:         'DEAD_WEIGHT_TRIGGERED',
            timestamp:     Date.now(),
            real_location: state_ref.real_location,
            accel_reading: accel_magnitude,
            audio_frames:  [...this._audio_buffer],
        };

        this.deactivateAcousticBuffer();
        this._dispatchSafetyPayload(evidence_payload);
        console.log('[ZenithSync] Background sync complete.');

        return {
            triggered: true,
            state:     SYSTEM_STATES.DEAD_WEIGHT,
            message:   'DeadWeight active. Evidence dispatched. Device appears off.',
        };
    }

    releaseDeadWeight(recovery_token, state_ref) {
        if (!recovery_token || typeof recovery_token !== 'string') return { success: false };
        // PRODUCTION: verify recovery_token cryptographically (JWT / HMAC)
        this._dead_weight_active = false;
        state_ref.systemState    = SYSTEM_STATES.NOMINAL;
        console.log('[HealthProcessor] DeadWeight released.');
        return { success: true };
    }

    _dispatchSafetyPayload(payload) {
        // PRODUCTION: POST to /api/onyx-safety/evidence with AES-256 envelope
        console.log('[SAFETY_TELEMETRY] Payload dispatched:', JSON.stringify(payload).length, 'bytes');
    }

    // ---- Heart Rate ----

    analyzeOpticalPulse(bpm_data) {
        if (!Array.isArray(bpm_data) || bpm_data.length === 0) return { emergency: false, message: 'No data' };

        const bpm = bpm_data[bpm_data.length - 1];
        if (typeof bpm !== 'number' || bpm <= 0 || bpm > 300) {
            return { emergency: false, message: 'Sensor value out of plausible range — ignored' };
        }

        let emergency = false;
        let message   = 'Heart rate normal';

        if (bpm > this.vital_bounds.bpm.max)      { emergency = true; message = `CRITICAL: Tachycardia detected (${bpm} BPM).`; }
        else if (bpm < this.vital_bounds.bpm.min) { emergency = true; message = `CRITICAL: Bradycardia detected (${bpm} BPM).`; }

        if (emergency) this.triggerSOS('CARDIO_VASCULAR', message);
        return { emergency, message };
    }

    // ---- Fall Detection ----

    detectFall(accel_magnitude) {
        if (typeof accel_magnitude !== 'number') return { emergency: false, message: 'Invalid data' };

        const now     = Date.now();
        let emergency = false;
        let message   = 'Stable';

        if (accel_magnitude > this.vital_bounds.fall.g_force_threshold) {
            console.warn('[HealthProcessor] High G-force. Potential fall.');
            this._fall_state.potential_fall_time = now;
            this._fall_state.post_fall_movement  = false;
            message = 'Impact detected. Monitoring recovery...';
        }

        if (this._fall_state.potential_fall_time) {
            const elapsed = now - this._fall_state.potential_fall_time;
            if (accel_magnitude > 1.2 && elapsed > 1_000) this._fall_state.post_fall_movement = true;

            if      (!this._fall_state.post_fall_movement && elapsed > this.vital_bounds.fall.flatline_time_ms) { emergency = true; message = `CRITICAL: No movement for ${(elapsed/1000).toFixed(1)}s.`; }
            else if (this._fall_state.post_fall_movement  && elapsed < this.vital_bounds.fall.recovery_time_ms) { message = 'Fall — user recovered.'; this._resetFallState(); }
            else if (this._fall_state.post_fall_movement  && elapsed > this.vital_bounds.fall.recovery_time_ms) { emergency = true; message = `MEDICAL ALERT: Slow recovery (${(elapsed/1000).toFixed(1)}s).`; }
        }

        if (emergency) { this.triggerSOS('FALL_DETECTED', message); this._resetFallState(); }
        return { emergency, message };
    }

    triggerSOS(type, details) {
        console.log(`[HEALTH_SOS] DISPATCHING EMERGENCY. Type: ${type} | ${details}`);
    }

    _resetFallState() {
        this._fall_state = { potential_fall_time: null, post_fall_movement: false };
    }
}


// ============================================================
// MODULE 05: ZenithSync — WhatsApp Bridge & NLP
// ============================================================

export class RemoteCommandParser {
    constructor() {
        this.intent_map = {
            inventory: ['check inventory', 'stock levels', 'warehouse status'],
            lighting:  ['turn on light', 'lights on', 'illuminate'],
            garage:    ['open garage', 'garage door'],
            climate:   ['temperature', 'thermostat', 'ac', 'heater'],
            security:  ['lock door', 'arm system', 'panic'],
        };
        this.api_functions = {
            INVENTORY_CHECK:  ()     => console.log('[API] Querying ERP...'),
            LIGHTING_CONTROL: (zone) => console.log(`[API] Lighting toggle: ${zone}`),
            GARAGE_CONTROL:   (act)  => console.log(`[API] Garage motor: ${act}`),
            SECURITY_TRIGGER: ()     => console.log('[API] Arming perimeter.'),
            UNKNOWN:          ()     => console.log('[API] LLM fallback engaged...'),
        };
        console.log('[RemoteCommandParser] NLP engine ready.');
    }

    parseAudioTranscript(text_command) {
        if (typeof text_command !== 'string') {
            return { intent: 'UNKNOWN', function_key: 'UNKNOWN', arguments: null, original_command: '' };
        }

        const sanitised     = text_command.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 512);
        const command_lower = sanitised.toLowerCase().trim();

        let detected_intent = null;
        let function_key    = 'UNKNOWN';
        let func_args       = null;

        if      (this._match(command_lower, this.intent_map.inventory)) { detected_intent = 'INVENTORY'; function_key = 'INVENTORY_CHECK'; }
        else if (this._match(command_lower, this.intent_map.lighting))  { detected_intent = 'LIGHTING';  function_key = 'LIGHTING_CONTROL'; func_args = 'main_area'; }
        else if (this._match(command_lower, this.intent_map.garage))    { detected_intent = 'GARAGE';    function_key = 'GARAGE_CONTROL';   func_args = 'toggle'; }
        else if (this._match(command_lower, this.intent_map.security))  { detected_intent = 'SECURITY';  function_key = 'SECURITY_TRIGGER'; }

        (this.api_functions[function_key] ?? this.api_functions['UNKNOWN'])(func_args);
        return { intent: detected_intent || 'UNKNOWN', function_key, arguments: func_args, original_command: sanitised };
    }

    _match(command, phrases) { return phrases.some(p => command.includes(p)); }
}


// ============================================================
// MODULE 06: Transit_Orchestrator (RPA Ride-Share State Machine)
// ============================================================

export class TransitOrchestrator {
    constructor() {
        this._state          = TRANSIT_STATES.IDLE;
        this._trip_id        = null;
        this._driver_profile = null;
        this._eta_seconds    = null;
        this._history        = [];
        this._transition_map = {
            [TRANSIT_STATES.IDLE]:        [TRANSIT_STATES.SEARCHING],
            [TRANSIT_STATES.SEARCHING]:   [TRANSIT_STATES.ACCEPTED,    TRANSIT_STATES.CANCELLED],
            [TRANSIT_STATES.ACCEPTED]:    [TRANSIT_STATES.APPROACHING, TRANSIT_STATES.CANCELLED],
            [TRANSIT_STATES.APPROACHING]: [TRANSIT_STATES.ARRIVED,     TRANSIT_STATES.CANCELLED],
            [TRANSIT_STATES.ARRIVED]:     [TRANSIT_STATES.IN_TRIP,     TRANSIT_STATES.CANCELLED],
            [TRANSIT_STATES.IN_TRIP]:     [TRANSIT_STATES.COMPLETED,   TRANSIT_STATES.CANCELLED],
            [TRANSIT_STATES.COMPLETED]:   [TRANSIT_STATES.IDLE],
            [TRANSIT_STATES.CANCELLED]:   [TRANSIT_STATES.IDLE],
        };
        console.log('[TransitOrchestrator] RPA state machine ready.');
    }

    getState()       { return this._state; }
    getTripContext()  { return Object.freeze({ state: this._state, trip_id: this._trip_id, driver_profile: this._driver_profile, eta_seconds: this._eta_seconds }); }
    getHistory()     { return Object.freeze([...this._history]); }

    processEvent(event) {
        if (!event || typeof event.type !== 'string') {
            return { success: false, new_state: this._state, message: 'Invalid event.' };
        }

        const { type, payload = {} } = event;
        let target_state = null;

        switch (type) {
            case 'REQUEST_RIDE':     target_state = TRANSIT_STATES.SEARCHING;   break;
            case 'DRIVER_ASSIGNED':  target_state = TRANSIT_STATES.ACCEPTED;    this._trip_id = payload.trip_id ?? null; this._driver_profile = payload.driver ?? null; this._eta_seconds = payload.eta_seconds ?? null; break;
            case 'DRIVER_APPROACHING': target_state = TRANSIT_STATES.APPROACHING; this._eta_seconds = payload.eta_seconds ?? this._eta_seconds; break;
            case 'DRIVER_ARRIVED':   target_state = TRANSIT_STATES.ARRIVED;     this._eta_seconds = 0; break;
            case 'TRIP_STARTED':     target_state = TRANSIT_STATES.IN_TRIP;     break;
            case 'TRIP_ENDED':       target_state = TRANSIT_STATES.COMPLETED;   this._eta_seconds = null; break;
            case 'CANCEL':           target_state = TRANSIT_STATES.CANCELLED;   break;
            default:
                return { success: false, new_state: this._state, message: `Unknown event type: ${type}` };
        }

        const valid_targets = this._transition_map[this._state] ?? [];
        if (!valid_targets.includes(target_state)) {
            return { success: false, new_state: this._state, message: `Invalid transition: ${this._state} -> ${target_state}` };
        }

        const prev = this._state;
        this._state = target_state;

        this._history.push({ timestamp: Date.now(), from: prev, to: target_state, event_type: type });

        if ([TRANSIT_STATES.IDLE, TRANSIT_STATES.COMPLETED, TRANSIT_STATES.CANCELLED].includes(target_state)) {
            this._trip_id = null; this._driver_profile = null; this._eta_seconds = null;
        }

        console.log(`[TransitOrchestrator] ${prev} -> ${target_state} via ${type}`);
        return { success: true, new_state: this._state, message: `Transitioned to ${target_state}` };
    }
}


// ============================================================
// MODULE 07: Deepfake_Shield (Synthetic Audio Detection)
// ============================================================

export class DeepfakeShield {
    constructor() {
        this._thresholds = {
            spectral_flatness_max:  0.85,
            silence_regularity_max: 0.90,
            formant_smoothness_max: 0.88,
            phase_noise_min:        0.05,
        };
        this._ANALYSIS_WINDOW_MS = 1_000;
        console.log('[DeepfakeShield] Synthetic audio detector initialized.');
    }

    analyzeStream(audio_payload) {
        if (!audio_payload || !Array.isArray(audio_payload.frames) || audio_payload.frames.length === 0) {
            return { is_synthetic: false, confidence: 0, triggered_flags: [], analysis_window_ms: 0, message: 'No data' };
        }

        const { frames, timestamps_ms = [], sample_rate_hz = 16_000 } = audio_payload;

        const cutoff_ms     = (timestamps_ms[0] ?? 0) + this._ANALYSIS_WINDOW_MS;
        const window_frames = frames.filter((_, i) => (timestamps_ms[i] ?? 0) <= cutoff_ms);
        const actual_window = window_frames.length > 0
            ? (timestamps_ms[window_frames.length - 1] ?? 0) - (timestamps_ms[0] ?? 0)
            : 0;

        if (window_frames.length === 0) {
            return { is_synthetic: false, confidence: 0, triggered_flags: [], analysis_window_ms: 0, message: 'Window empty' };
        }

        const triggered_flags = [];
        const scores          = [];

        const flatness = this._computeSpectralFlatness(window_frames);
        if (flatness > this._thresholds.spectral_flatness_max) { triggered_flags.push('HIGH_SPECTRAL_FLATNESS'); scores.push(flatness); }

        const silence_reg = this._computeSilenceRegularity(window_frames);
        if (silence_reg > this._thresholds.silence_regularity_max) { triggered_flags.push('REGULAR_MICRO_SILENCES'); scores.push(silence_reg); }

        const formant = this._computeFormantSmoothness(window_frames);
        if (formant > this._thresholds.formant_smoothness_max) { triggered_flags.push('UNNATURAL_FORMANT_SMOOTHNESS'); scores.push(formant); }

        const phase = this._computePhaseNoise(window_frames, sample_rate_hz);
        if (phase < this._thresholds.phase_noise_min) { triggered_flags.push('LOW_PHASE_NOISE'); scores.push(1 - phase); }

        const confidence   = scores.length > 0
            ? Math.min(scores.reduce((a, b) => a + b, 0) / scores.length, 1.0) : 0.0;
        const is_synthetic = triggered_flags.length >= 2;

        const message = is_synthetic
            ? `Synthetic voice signature detected (confidence: ${(confidence * 100).toFixed(1)}%).`
            : `Audio appears authentic (${triggered_flags.length} flag(s), below threshold).`;

        console.log(`[DeepfakeShield] ${message}`);
        return { is_synthetic, confidence: parseFloat(confidence.toFixed(4)), triggered_flags, analysis_window_ms: actual_window, message };
    }

    _computeSpectralFlatness(frames) {
        const flatness_per_frame = frames.map(frame => {
            if (!Array.isArray(frame) || frame.length === 0) return 0;
            const vals      = frame.map(v => Math.max(v, 1e-10));
            const geo_mean  = Math.exp(vals.reduce((s, v) => s + Math.log(v), 0) / vals.length);
            const arith_mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            return arith_mean > 0 ? geo_mean / arith_mean : 0;
        });
        return flatness_per_frame.reduce((a, b) => a + b, 0) / flatness_per_frame.length;
    }

    _computeSilenceRegularity(frames) {
        const flags = frames.map(f => (Array.isArray(f) && f.reduce((a, b) => a + b, 0) / f.length < 0.01) ? 1 : 0);
        return flags.filter(Boolean).length / (flags.length || 1);
    }

    _computeFormantSmoothness(frames) {
        if (frames.length < 2) return 0;
        const dom = frames.map(f => Array.isArray(f) ? f.indexOf(Math.max(...f)) : 0);
        const deltas = [];
        for (let i = 1; i < dom.length; i++) deltas.push(Math.abs(dom[i] - dom[i - 1]));
        const mean_delta = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
        return Math.max(0, 1 - (mean_delta / (frames[0]?.length ?? 1)));
    }

    _computePhaseNoise(frames, sample_rate_hz) {
        const hf_energies = frames.map(frame => {
            if (!Array.isArray(frame) || frame.length === 0) return 0;
            const hf = frame.slice(Math.floor(frame.length * 0.75));
            return hf.reduce((a, b) => a + Math.abs(b), 0) / (hf.length || 1);
        });
        const mean_hf = hf_energies.reduce((a, b) => a + b, 0) / (hf_energies.length || 1);
        return Math.min(mean_hf / (sample_rate_hz > 32_000 ? 0.08 : 0.05), 1.0);
    }
}


// ============================================================
// MODULE 08: Cognition_Engine (AI Assistant Personalization)
// ============================================================
//
// SCOPE: This module analyses the authenticated user's own communication
// history to tune their personal ZENITH AI assistant's response style —
// so the assistant feels natural to that user. It produces a system_prompt
// fragment consumed by an LLM responding TO the user, not impersonating
// them in outbound communications. Any outbound message drafted with
// this engine MUST be reviewed and sent by the authenticated user; it
// is never dispatched autonomously on the user's behalf.

export class CognitionEngine {
    constructor() {
        this._style_profile    = null;
        this._history_snapshot = [];
        this._MIN_HISTORY      = 5;
        console.log('[CognitionEngine] Personalization engine initialized.');
    }

    ingestHistory(history_array) {
        if (!Array.isArray(history_array) || history_array.length < this._MIN_HISTORY) {
            return { success: false, profile_summary: null, message: `Minimum ${this._MIN_HISTORY} entries required.` };
        }

        const valid = history_array
            .filter(e => e && typeof e.text === 'string' && e.text.trim().length > 0)
            .map(e => ({ text: e.text.trim().slice(0, 1_000), timestamp_ms: e.timestamp_ms ?? 0 }));

        if (valid.length < this._MIN_HISTORY) {
            return { success: false, profile_summary: null, message: 'Insufficient valid entries after filtering.' };
        }

        this._history_snapshot = valid;
        this._style_profile    = this._buildStyleProfile(valid);

        console.log(`[CognitionEngine] Style profile built from ${valid.length} entries.`);
        return { success: true, profile_summary: this._summarizeProfile() };
    }

    generatePersonalizationPrompt(options = {}) {
        if (!this._style_profile) {
            console.warn('[CognitionEngine] No style profile — call ingestHistory() first.');
            return null;
        }

        const { task_context = 'general assistant' } = options;
        const p = this._style_profile;

        const fragment = [
            `You are the user's personal ZENITH AI assistant, helping with: ${task_context}.`,
            `Adapt your responses to match the user's preferred communication style:`,
            `- Formality: ${p.formality} (${p.formality === 'informal' ? 'casual and direct' : 'professional and structured'})`,
            `- Response length: ${p.avg_length_category} (~${p.avg_word_count} words avg)`,
            `- Punctuation: ${p.uses_punctuation ? 'standard' : 'minimal — mirror this'}`,
            `- Common topics: ${p.top_topics.join(', ')}`,
            `- Sentence structure: ${p.sentence_complexity}`,
            `Always respond TO the user. Never generate outbound messages as the user without explicit per-message approval.`,
        ].join('\n');

        return {
            system_prompt_fragment: fragment,
            style_profile:          Object.freeze({ ...this._style_profile }),
        };
    }

    _buildStyleProfile(entries) {
        const texts          = entries.map(e => e.text);
        const word_counts    = texts.map(t => t.split(/\s+/).filter(Boolean).length);
        const avg_word_count = Math.round(word_counts.reduce((a, b) => a + b, 0) / word_counts.length);

        const informal_markers = ["don't","won't","can't","gonna","wanna","lol","tbh","ngl","btw","idk"];
        const informal_hits    = texts.filter(t => informal_markers.some(m => t.toLowerCase().includes(m))).length;
        const formality        = (informal_hits / texts.length) > 0.3 ? 'informal' : 'formal';

        const uses_punctuation   = texts.filter(t => /[.!?]$/.test(t.trim())).length / texts.length > 0.5;
        const avg_length_category = avg_word_count < 10 ? 'very short' : avg_word_count < 30 ? 'short' : avg_word_count < 80 ? 'medium' : 'long';
        const avg_sentences      = texts.reduce((s, t) => s + (t.match(/[.!?]+/g) ?? []).length, 0) / texts.length;
        const sentence_complexity = avg_sentences < 1.5 ? 'single-sentence, direct' : avg_sentences < 3 ? 'multi-sentence, moderate' : 'complex, multi-clause';
        const top_topics          = this._extractTopTopics(texts, 5);

        return { avg_word_count, avg_length_category, formality, uses_punctuation, sentence_complexity, top_topics };
    }

    _extractTopTopics(texts, top_n) {
        const stopwords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','is','it','i','my','me','you','we','he','she','they','this','that','with','are','was','be','have','has','had','do','not','so','if','as','by']);
        const freq = {};
        for (const text of texts)
            for (const w of text.toLowerCase().split(/\W+/)) {
                const word = w.trim();
                if (word.length > 2 && !stopwords.has(word)) freq[word] = (freq[word] ?? 0) + 1;
            }
        return Object.entries(freq).sort(([,a],[,b]) => b - a).slice(0, top_n).map(([w]) => w);
    }

    _summarizeProfile() {
        return !this._style_profile ? null
            : Object.freeze({ ...this._style_profile, entries_analysed: this._history_snapshot.length });
    }
}


// ============================================================
// BOOTSTRAP — dev/test only. Strip from production bundle.
// ============================================================

console.log('================================================');
console.log('ZENITH_AI v2.0 BOOTING');
console.log('Lead Architect:  Jacob Fontech Gamboa');
console.log('Parent System:   ONYX_ENTERPRISES');
console.log('================================================');

const integrity = verifyHostEnvironment(ZenithCoreState);

if (integrity.authorized) {
    const Guardian    = new GhostVault(ZenithCoreState);
    const HomeHub     = new IoTOrchestrator();
    const DriveAnalyzer = new VehicleDiagnostic();
    const VitalMonitor  = new HealthProcessor();
    const Commander   = new RemoteCommandParser();
    const RideManager = new TransitOrchestrator();
    const AudioGuard  = new DeepfakeShield();
    const PersonalAI  = new CognitionEngine();

    console.log('All ZENITH_AI v2.0 modules initialized and awaiting signature...');
} else {
    console.warn('[ZENITH_AI] Unauthorized environment. Boot halted.');
}

// ============================================================
// DEPLOYMENT SIGNATURE
// ARCHITECT:     J.F. GAMBOA
// VERSION:       2.0.0
// MODULE STATUS: LOGICALLY VERIFIED — AWAITING HARDWARE ALLOCATION
// ============================================================
