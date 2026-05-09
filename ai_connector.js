/**
 * ai_connector.js — Zenith AI · Frontend Connector
 * ─────────────────────────────────────────────────────────────
 * Thin client that talks exclusively to the /api/chat serverless
 * route. No API keys, no direct calls to Google — the server
 * handles all of that.
 *
 * USAGE:
 *   import { ZenithConnector } from './ai_connector.js';
 *
 *   const ai = new ZenithConnector();
 *
 *   // Simple one-shot
 *   const reply = await ai.send('¿Cuál es la capital de Francia?');
 *
 *   // With conversation history (multi-turn)
 *   const reply = await ai.send('Explícalo con más detalle');
 *   // History is managed automatically — no extra work needed.
 *
 *   // Reset conversation
 *   ai.resetHistory();
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/** Relative path to the Vercel serverless function. */
const API_ROUTE = '/api/chat';

/** Max history turns kept client-side before pruning. */
const MAX_CLIENT_HISTORY = 40;

export class ZenithConnector {
    constructor() {
        /** @type {Array<{role: string, parts: Array<{text: string}>}>} */
        this._history = [];
    }

    /**
     * Send a user message to Zenith AI and return the reply text.
     * Conversation history is maintained automatically across calls.
     *
     * @param {string} userMessage
     * @returns {Promise<string>}  The assistant's reply text.
     * @throws {ZenithConnectorError}  On network failure or API error.
     */
    async send(userMessage) {
        if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
            throw new ZenithConnectorError('Message must be a non-empty string.');
        }

        const trimmed = userMessage.trim();

        let response;
        try {
            response = await fetch(API_ROUTE, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    message: trimmed,
                    history: this._history,
                }),
            });
        } catch (networkErr) {
            throw new ZenithConnectorError(
                'No se pudo conectar con Zenith AI. Verifica tu conexión.',
                { cause: networkErr }
            );
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new ZenithConnectorError(
                data.error ?? `Error del servidor (${response.status}).`
            );
        }

        const reply = data.reply;
        if (typeof reply !== 'string' || reply.length === 0) {
            throw new ZenithConnectorError('Respuesta vacía recibida de Zenith AI.');
        }

        // Append this turn to local history for multi-turn context.
        this._history.push({ role: 'user',  parts: [{ text: trimmed }] });
        this._history.push({ role: 'model', parts: [{ text: reply   }] });

        // Prune history to stay within limits.
        if (this._history.length > MAX_CLIENT_HISTORY) {
            this._history = this._history.slice(-MAX_CLIENT_HISTORY);
        }

        return reply;
    }

    /**
     * Clear the conversation history.
     * Call this when the user starts a "Nuevo Chat".
     */
    resetHistory() {
        this._history = [];
    }

    /** Read-only snapshot of the current conversation history. */
    get history() {
        return [...this._history];
    }
}

// ─────────────────────────────────────────────────────────────
// ZenithConnectorError — typed error for caller discrimination
// ─────────────────────────────────────────────────────────────
export class ZenithConnectorError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'ZenithConnectorError';
    }
}
