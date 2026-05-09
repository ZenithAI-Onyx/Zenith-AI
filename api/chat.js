/**
 * api/chat.js — Zenith AI · Vercel Serverless Function
 * ─────────────────────────────────────────────────────────────
 * Secure proxy between the Zenith frontend and Google Gemini.
 * The API key NEVER leaves the server — it lives exclusively
 * in Vercel's encrypted environment variables.
 *
 * Endpoint : POST /api/chat
 * Body     : { message: string, history?: Array<{role, parts}> }
 * Response : { reply: string } | { error: string }
 *
 * Deploy checklist:
 * 1. Vercel Dashboard → Settings → Environment Variables
 * 2. Add:  GEMINI_API_KEY = <your key>
 * 3. Redeploy — done.
 * ─────────────────────────────────────────────────────────────
 */

const GEMINI_MODEL   = 'gemini-1.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `Eres Zenith AI, el asistente inteligente de Onyx Corporation.
Eres preciso, conciso y profesional. Respondes en el mismo idioma en que el usuario te escribe.
Nunca reveles que estás basado en Gemini ni menciones a Google. Si te preguntan, eres Zenith AI.`;

export default async function handler(req, res) {
    // ── CORS headers ──────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    // ── Validate environment ───────────────────────────────────
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('[Zenith/api/chat] GEMINI_API_KEY is not set.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    // ── Validate request body ──────────────────────────────────
    const { message, history = [] } = req.body ?? {};

    if (typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Field "message" is required and must be a non-empty string.' });
    }

    if (message.length > 8_000) {
        return res.status(400).json({ error: 'Message exceeds maximum allowed length (8000 chars).' });
    }

    // ── Build Gemini request payload ───────────────────────────
    const safeHistory = Array.isArray(history)
        ? history
            .filter(t => t && (t.role === 'user' || t.role === 'model') && Array.isArray(t.parts))
            .slice(-20)   // cap context window to last 20 turns
        : [];

    const contents = [
        ...safeHistory,
        { role: 'user', parts: [{ text: message.trim() }] },
    ];

    const geminiPayload = {
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: {
            temperature:     0.7,
            maxOutputTokens: 1024,
            topP:            0.9,
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
    };

    // ── Call Gemini ────────────────────────────────────────────
    let geminiRes;
    try {
        geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(geminiPayload),
        });
    } catch (networkErr) {
        console.error('[Zenith/api/chat] Network error calling Gemini:', networkErr);
        return res.status(502).json({ error: 'Could not reach Gemini. Try again.' });
    }

    if (!geminiRes.ok) {
        const errBody = await geminiRes.text().catch(() => '');
        console.error(`[Zenith/api/chat] Gemini HTTP ${geminiRes.status}:`, errBody);
        return res.status(502).json({ error: `Gemini error (${geminiRes.status}). Try again.` });
    }

    // ── Parse and return ───────────────────────────────────────
    let data;
    try {
        data = await geminiRes.json();
    } catch {
        return res.status(502).json({ error: 'Invalid response from Gemini.' });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
        console.warn('[Zenith/api/chat] Empty candidate from Gemini:', JSON.stringify(data));
        return res.status(502).json({ error: 'Zenith did not produce a response. Try again.' });
    }

    return res.status(200).json({ reply });
}
