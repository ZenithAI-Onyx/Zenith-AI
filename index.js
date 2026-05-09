/**
 * index.js — ZenithOmniHub
 * ─────────────────────────────────────────────────────────────────────────────
 * Master Orchestrator for Onyx Corporation Backend
 *
 * Assembles and exposes all nine production ES6 modules as a single,
 * cleanly-namespaced hub. No extra logic, no hidden state, no side effects
 * beyond what each module defines internally.
 *
 * CONSENT POLICY — CognitionEngine:
 *   The engine is instantiated WITHOUT consent by design. Consent represents
 *   an explicit user action and must never be synthesized by the system layer.
 *   Call hub.hydrateUserPreferences(dbRecord) after startup, passing the
 *   consent record recovered from your user database. Until that call is made,
 *   all CognitionEngine analysis methods remain hard-blocked by the module
 *   itself (throws ConsentError), which is the intended behaviour.
 *
 * AI CONNECTOR:
 *   hub.ai exposes a ZenithConnector instance pre-wired to /api/chat.
 *   The connector maintains multi-turn history automatically.
 *   Call hub.ai.resetHistory() when the user starts a new conversation.
 *
 * USAGE:
 *   import { ZenithOmniHub } from './index.js';
 *
 *   const hub = new ZenithOmniHub({
 *     jwt:    { secret: process.env.JWT_SECRET },
 *     iot:    { history_depth: 300 },
 *     spatial: { THREE },              // inject Three.js peer dependency
 *   });
 *
 *   // Once the user record is loaded from DB:
 *   hub.hydrateUserPreferences(user.consentRecord);
 *
 *   // Access any subsystem:
 *   const token  = await hub.auth.sign({ sub: userId });
 *   const report = hub.vehicle.generateReport();
 *   const reply  = await hub.ai.send('¿Cuáles son mis tareas pendientes?');
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Module imports ────────────────────────────────────────────────────────────

import { JWTAuth,            JWTError            } from './jwt_auth.js';
import { IoTOrchestrator,    SENSOR_TYPES,
         ANOMALY_SEVERITY                         } from './iot_orchestrator.js';
import { VehicleDiagnostic                       } from './vehicle_diagnostic.js';
import { TransitOrchestrator                     } from './transit_orchestrator.js';
import { DeepfakeShield                          } from './deepfake_shield.js';
import { ZenithSpatial3D                         } from './zenith_spatial_3d.js';
import { FallDetector                            } from './fall_detector.js';
import { CognitionEngine,   ConsentError         } from './cognition_engine.js';
import { ZenithConnector,   ZenithConnectorError } from './ai_connector.js';

// ── ZenithOmniHub ─────────────────────────────────────────────────────────────

export class ZenithOmniHub {
    /**
     * @param {object} [options]
     *
     * @param {object} options.jwt
     *   Options forwarded to JWTAuth constructor.
     *   @param {string}          options.jwt.secret      — REQUIRED. HMAC secret (≥32 chars).
     *   @param {number}          [options.jwt.expiresIn] — Token TTL in seconds (default 3600).
     *   @param {string}          [options.jwt.issuer]    — Optional 'iss' claim.
     *   @param {string|string[]} [options.jwt.audience]  — Optional 'aud' claim.
     *
     * @param {object} [options.iot]
     *   Options forwarded to IoTOrchestrator constructor.
     *   @param {number} [options.iot.history_depth]     — Max readings kept per sensor (default 200).
     *   @param {number} [options.iot.alert_cooldown_ms] — Min ms between repeated alerts (default 5000).
     *
     * @param {object} [options.vehicle]
     *   Options forwarded to VehicleDiagnostic constructor.
     *
     * @param {object} [options.transit]
     *   Options forwarded to TransitOrchestrator constructor.
     *
     * @param {object} [options.deepfake]
     *   Options forwarded to DeepfakeShield constructor.
     *
     * @param {object} [options.spatial]
     *   Options forwarded to ZenithSpatial3D constructor.
     *   @param {object} [options.spatial.THREE] — Three.js peer dependency injection.
     *
     * @param {object} [options.fall]
     *   Options forwarded to FallDetector constructor.
     *
     * @param {object} [options.cognition]
     *   Options forwarded to CognitionEngine constructor.
     *   Note: consent is NOT applied here. Call hydrateUserPreferences() instead.
     */
    constructor({
        jwt      = {},
        iot      = {},
        vehicle  = {},
        transit  = {},
        deepfake = {},
        spatial  = {},
        fall     = {},
        cognition = {},
    } = {}) {

        /** @type {JWTAuth} */
        this.auth = new JWTAuth(jwt);

        /** @type {IoTOrchestrator} */
        this.iot = new IoTOrchestrator(iot);

        /** @type {VehicleDiagnostic} */
        this.vehicle = new VehicleDiagnostic(vehicle);

        /** @type {TransitOrchestrator} */
        this.transit = new TransitOrchestrator(transit);

        /** @type {DeepfakeShield} */
        this.deepfake = new DeepfakeShield(deepfake);

        /** @type {ZenithSpatial3D} */
        this.spatial = new ZenithSpatial3D(spatial.THREE, spatial);

        /** @type {FallDetector} */
        this.fall = new FallDetector(fall);

        /**
         * @type {CognitionEngine}
         * Instantiated without consent. Consent must be explicitly hydrated
         * via hydrateUserPreferences() before any analysis method is usable.
         */
        this.cognition = new CognitionEngine(cognition);

        /**
         * @type {ZenithConnector}
         * AI chat connector — routes messages through /api/chat serverless
         * function. API key never touches the client.
         */
        this.ai = new ZenithConnector();
    }

    // ── Consent hydration ─────────────────────────────────────────────────────

    /**
     * Hydrate CognitionEngine consent from a persisted user database record.
     *
     * Call this once the authenticated user's preferences are loaded from your
     * data layer. Do NOT call this with fabricated or default values — pass only
     * the record that the user themselves produced during onboarding.
     *
     * @param {{
     *   confirmedAt: number,   — Epoch ms when the user granted consent (from DB).
     *   source:      string,   — UI surface that captured consent (e.g. 'onboarding-modal').
     *   version?:    string,   — Policy version accepted (optional).
     * }} dbRecord
     *
     * @returns {{ success: boolean, consent: object }}
     *
     * @throws {TypeError}     If dbRecord fields are invalid (delegated to CognitionEngine).
     * @throws {ConsentError}  Re-thrown if the engine itself rejects the record.
     *
     * @example
     *   const user = await db.users.findById(userId);
     *   hub.hydrateUserPreferences(user.consentRecord);
     */
    hydrateUserPreferences(dbRecord) {
        return this.cognition.grantConsent(dbRecord);
    }

    // ── Hub introspection ─────────────────────────────────────────────────────

    /**
     * Returns a lightweight status snapshot of every subsystem.
     * Useful for health-check endpoints or startup logging.
     *
     * @returns {object}
     */
    status() {
        return Object.freeze({
            auth:      { ready: true,  module: 'JWTAuth'            },
            iot:       { ready: true,  module: 'IoTOrchestrator'     },
            vehicle:   { ready: true,  module: 'VehicleDiagnostic'   },
            transit:   { ready: true,  module: 'TransitOrchestrator' },
            deepfake:  { ready: true,  module: 'DeepfakeShield'      },
            spatial:   { ready: true,  module: 'ZenithSpatial3D'     },
            fall:      { ready: true,  module: 'FallDetector'        },
            cognition: {
                ready:           true,
                module:          'CognitionEngine',
                consentHydrated: this.cognition.getConsentStatus() !== null,
            },
            ai: {
                ready:        true,
                module:       'ZenithConnector',
                historyTurns: this.ai.history.length / 2,  // user+model pairs
            },
        });
    }
}

// ── Named re-exports ──────────────────────────────────────────────────────────
// Allow consumers to import individual classes directly from this barrel
// without a separate import chain.

export {
    // Auth
    JWTAuth, JWTError,

    // IoT
    IoTOrchestrator, SENSOR_TYPES, ANOMALY_SEVERITY,

    // Vehicle
    VehicleDiagnostic,

    // Transit
    TransitOrchestrator,

    // Deepfake
    DeepfakeShield,

    // Spatial
    ZenithSpatial3D,

    // Fall detection
    FallDetector,

    // Cognition
    CognitionEngine, ConsentError,

    // AI connector
    ZenithConnector, ZenithConnectorError,
};
