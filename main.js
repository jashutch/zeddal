// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

'use strict';

var obsidian = require('obsidian');
var require$$0$2 = require('child_process');
var require$$0$1 = require('path');
var require$$0 = require('fs');
var process$1 = require('node:process');
var node_stream = require('node:stream');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

/**
 * Config: Settings management for Zeddal
 * Architecture: Type-safe configuration with defaults
 */
const DEFAULT_SETTINGS = {
    openaiApiKey: '',
    openaiModel: 'gpt-4-turbo',
    gptModel: 'gpt-4-turbo', // Alias for clarity
    whisperModel: 'whisper-1',
    embeddingModel: 'text-embedding-3-small',
    llmProvider: 'openai',
    customApiBase: '',
    customTranscriptionUrl: '',
    customEmbeddingUrl: '',
    autoMergeThreshold: 0.85,
    silenceThreshold: 0.01, // RMS threshold for silence detection
    silenceDuration: 1500, // ms of silence before auto-pause
    // Note insertion settings
    defaultSaveLocation: 'ask', // Ask user where to save
    voiceNotesFolder: 'Voice Notes',
    autoRefine: true, // Auto-refine with GPT-4
    autoSaveRaw: true,
    autoContextLinks: true,
    // Audio recording settings
    recordingsPath: 'Voice Notes/Recordings', // Default path for audio files
    // RAG settings
    enableRAG: true, // Enable vector-based context retrieval
    ragTopK: 3, // Retrieve top 3 similar chunks
    ragChunkSize: 500, // Tokens per chunk
    ragChunkOverlap: 50, // Token overlap between chunks
    // MCP settings
    enableMCP: false, // Disabled by default - user must explicitly enable
    mcpServers: [], // No servers configured by default
};
class Config {
    constructor(settings) {
        this.settings = Object.assign(Object.assign({}, DEFAULT_SETTINGS), settings);
    }
    get(key) {
        return this.settings[key];
    }
    set(key, value) {
        this.settings[key] = value;
    }
    getAll() {
        return Object.assign({}, this.settings);
    }
    update(partial) {
        this.settings = Object.assign(Object.assign({}, this.settings), partial);
    }
    reset() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
    isValid() {
        return this.settings.openaiApiKey.length > 0;
    }
}

/**
 * EventBus: Lightweight pub/sub system for Zeddal
 * Architecture: Central event coordination for recording → transcription → refinement → merge flow
 */
class EventBus {
    constructor() {
        this.listeners = new Map();
    }
    /**
     * Subscribe to an event type
     */
    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);
        // Return unsubscribe function
        return () => this.off(eventType, callback);
    }
    /**
     * Unsubscribe from an event type
     */
    off(eventType, callback) {
        const callbacks = this.listeners.get(eventType);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(eventType);
            }
        }
    }
    /**
     * Emit an event to all subscribers
     */
    emit(eventType, data) {
        const event = {
            type: eventType,
            data,
            timestamp: Date.now(),
        };
        const callbacks = this.listeners.get(eventType);
        if (callbacks) {
            callbacks.forEach((callback) => {
                try {
                    callback(event);
                }
                catch (error) {
                    console.error(`Error in event listener for ${eventType}:`, error);
                }
            });
        }
    }
    /**
     * Subscribe to an event once, then auto-unsubscribe
     */
    once(eventType, callback) {
        const wrappedCallback = (event) => {
            callback(event);
            this.off(eventType, wrappedCallback);
        };
        this.on(eventType, wrappedCallback);
    }
    /**
     * Clear all listeners for a specific event type or all events
     */
    clear(eventType) {
        if (eventType) {
            this.listeners.delete(eventType);
        }
        else {
            this.listeners.clear();
        }
    }
}
// Global singleton instance
const eventBus = new EventBus();

const defaultNow = typeof performance !== 'undefined' && performance.now
    ? () => performance.now()
    : () => Date.now();
class RecordingTelemetry {
    constructor(now = defaultNow) {
        this.now = now;
        this.speakingTimeMs = 0;
        this.totalRecordingTimeMs = 0;
        this.startTimestamp = 0;
        this.pausedAt = null;
    }
    start() {
        this.speakingTimeMs = 0;
        this.totalRecordingTimeMs = 0;
        this.startTimestamp = this.now();
        this.pausedAt = null;
    }
    pause() {
        if (this.pausedAt !== null)
            return;
        this.flushTotals();
        this.pausedAt = this.now();
    }
    resume() {
        if (this.pausedAt === null)
            return;
        const pauseDuration = this.now() - this.pausedAt;
        this.startTimestamp += pauseDuration;
        this.pausedAt = null;
    }
    stop() {
        this.flushTotals();
    }
    ingestFrame(frame) {
        if (frame.isSpeech) {
            this.speakingTimeMs += frame.durationMs;
        }
        this.flushTotals();
    }
    snapshot() {
        this.flushTotals();
        return {
            speakingTimeMs: this.speakingTimeMs,
            totalRecordingTimeMs: this.totalRecordingTimeMs,
        };
    }
    flushTotals() {
        var _a;
        if (!this.startTimestamp)
            return;
        const reference = (_a = this.pausedAt) !== null && _a !== void 0 ? _a : this.now();
        this.totalRecordingTimeMs = Math.max(0, reference - this.startTimestamp);
    }
}

/**
 * RecorderService: Audio recording with RMS-based silence detection
 * Architecture: Manages MediaRecorder, AudioContext analysis, and auto-pause on silence
 */
class RecorderService {
    constructor(config) {
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.chunks = [];
        this.silenceTimer = null;
        this.animationFrameId = null;
        this.stream = null;
        this.telemetry = new RecordingTelemetry();
        this.config = config;
        this.state = {
            isRecording: false,
            isPaused: false,
            duration: 0,
            confidence: 1.0,
        };
    }
    /**
     * Start recording from microphone
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Request microphone access
                console.log('Requesting microphone access...');
                this.stream = yield navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                });
                // Verify audio tracks are active
                const audioTracks = this.stream.getAudioTracks();
                console.log('Audio tracks found:', audioTracks.length);
                audioTracks.forEach((track, i) => {
                    console.log(`Track ${i}:`, {
                        label: track.label,
                        enabled: track.enabled,
                        muted: track.muted,
                        readyState: track.readyState,
                    });
                });
                // Setup AudioContext for RMS analysis
                this.audioContext = new AudioContext();
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.8;
                this.microphone = this.audioContext.createMediaStreamSource(this.stream);
                this.microphone.connect(this.analyser);
                // Setup MediaRecorder
                const mimeType = this.getSupportedMimeType();
                console.log('Using MediaRecorder MIME type:', mimeType);
                this.mediaRecorder = new MediaRecorder(this.stream, {
                    mimeType: mimeType,
                });
                this.chunks = [];
                this.mediaRecorder.ondataavailable = (event) => {
                    console.log('Data available:', event.data.size, 'bytes');
                    if (event.data.size > 0) {
                        this.chunks.push(event.data);
                    }
                };
                this.mediaRecorder.onstop = () => {
                    this.handleRecordingStop();
                };
                this.mediaRecorder.start(800); // Frequent chunks for streaming
                this.state.isRecording = true;
                this.state.isPaused = false;
                this.state.duration = 0;
                this.telemetry.start();
                eventBus.emit('recording-started', { state: this.state });
                // Start RMS monitoring
                this.monitorRMS();
            }
            catch (error) {
                eventBus.emit('error', { message: 'Failed to start recording', error });
                throw error;
            }
        });
    }
    /**
     * Stop recording and return audio blob
     */
    stop() {
        if (!this.mediaRecorder || !this.state.isRecording) {
            return;
        }
        this.state.isRecording = false;
        this.state.isPaused = false;
        if (this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.telemetry.stop();
        this.stopMonitoring();
        // Note: cleanup() is called in handleRecordingStop() after blob is created
    }
    /**
     * Pause recording
     */
    pause() {
        if (!this.mediaRecorder || !this.state.isRecording || this.state.isPaused) {
            return;
        }
        if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this.state.isPaused = true;
            eventBus.emit('recording-paused', { state: this.state });
            this.telemetry.pause();
        }
    }
    /**
     * Resume recording
     */
    resume() {
        if (!this.mediaRecorder || !this.state.isRecording || !this.state.isPaused) {
            return;
        }
        if (this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            this.state.isPaused = false;
            eventBus.emit('recording-resumed', { state: this.state });
            // Clear silence timer on manual resume
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
            this.telemetry.resume();
        }
    }
    /**
     * Get current recording state
     */
    getState() {
        return Object.assign({}, this.state);
    }
    getTelemetrySnapshot() {
        return this.telemetry.snapshot();
    }
    /**
     * Monitor RMS levels for silence detection and auto-pause
     */
    monitorRMS() {
        if (!this.analyser)
            return;
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);
        this.config.get('silenceThreshold');
        this.config.get('silenceDuration');
        const frameDurationMs = 50;
        const checkRMS = () => {
            if (!this.analyser || !this.state.isRecording)
                return;
            this.analyser.getFloatTimeDomainData(dataArray);
            // Calculate RMS (Root Mean Square)
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / bufferLength);
            // Log RMS every second for debugging
            if (Date.now() % 1000 < 50) {
                console.log('RMS level:', rms.toFixed(4), 'Confidence:', (rms * 10).toFixed(2));
            }
            // Update confidence based on RMS (normalize to 0-1 range)
            this.state.confidence = Math.min(1.0, rms * 10);
            const vadThreshold = this.config.get('silenceThreshold');
            const isSpeech = rms >= vadThreshold;
            this.telemetry.ingestFrame({ isSpeech, durationMs: frameDurationMs });
            // Silence detection - DISABLED FOR NOW (causes recording issues)
            // TODO: Phase 2 - Fix pause/resume to not break MediaRecorder
            /*
            if (rms < silenceThreshold && !this.state.isPaused) {
              if (!this.silenceTimer) {
                this.silenceTimer = window.setTimeout(() => {
                  if (this.state.isRecording && !this.state.isPaused) {
                    console.log('Auto-pausing due to silence');
                    this.pause();
                  }
                }, silenceDuration);
              }
            } else if (this.silenceTimer) {
              clearTimeout(this.silenceTimer);
              this.silenceTimer = null;
            }
            */
            // Update duration
            if (!this.state.isPaused) {
                this.state.duration += 50; // Update every 50ms
            }
            this.animationFrameId = requestAnimationFrame(checkRMS);
        };
        checkRMS();
    }
    /**
     * Stop RMS monitoring
     */
    stopMonitoring() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }
    /**
     * Handle recording stop and emit audio chunk
     */
    handleRecordingStop() {
        console.log('Creating blob from', this.chunks.length, 'chunks');
        const totalSize = this.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log('Total audio data:', totalSize, 'bytes');
        const blob = new Blob(this.chunks, {
            type: this.getSupportedMimeType(),
        });
        console.log('Final blob size:', blob.size, 'bytes');
        const audioChunk = {
            blob,
            timestamp: Date.now(),
            duration: this.state.duration,
        };
        eventBus.emit('recording-stopped', { audioChunk, state: this.state });
        // Cleanup resources after blob is created and event is emitted
        this.cleanup();
    }
    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.analyser = null;
        this.mediaRecorder = null;
        this.chunks = [];
    }
    /**
     * Get supported MIME type for recording
     */
    getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return '';
    }
}

const default_format = 'RFC3986';
const formatters = {
    RFC1738: (v) => String(v).replace(/%20/g, '+'),
    RFC3986: (v) => String(v),
};
const RFC1738 = 'RFC1738';

const is_array$1 = Array.isArray;
const hex_table = (() => {
    const array = [];
    for (let i = 0; i < 256; ++i) {
        array.push('%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase());
    }
    return array;
})();
const limit$1 = 1024;
const encode = (str, _defaultEncoder, charset, _kind, format) => {
    // This code was originally written by Brian White for the io.js core querystring library.
    // It has been adapted here for stricter adherence to RFC 3986
    if (str.length === 0) {
        return str;
    }
    let string = str;
    if (typeof str === 'symbol') {
        string = Symbol.prototype.toString.call(str);
    }
    else if (typeof str !== 'string') {
        string = String(str);
    }
    if (charset === 'iso-8859-1') {
        return escape(string).replace(/%u[0-9a-f]{4}/gi, function ($0) {
            return '%26%23' + parseInt($0.slice(2), 16) + '%3B';
        });
    }
    let out = '';
    for (let j = 0; j < string.length; j += limit$1) {
        const segment = string.length >= limit$1 ? string.slice(j, j + limit$1) : string;
        const arr = [];
        for (let i = 0; i < segment.length; ++i) {
            let c = segment.charCodeAt(i);
            if (c === 0x2d || // -
                c === 0x2e || // .
                c === 0x5f || // _
                c === 0x7e || // ~
                (c >= 0x30 && c <= 0x39) || // 0-9
                (c >= 0x41 && c <= 0x5a) || // a-z
                (c >= 0x61 && c <= 0x7a) || // A-Z
                (format === RFC1738 && (c === 0x28 || c === 0x29)) // ( )
            ) {
                arr[arr.length] = segment.charAt(i);
                continue;
            }
            if (c < 0x80) {
                arr[arr.length] = hex_table[c];
                continue;
            }
            if (c < 0x800) {
                arr[arr.length] = hex_table[0xc0 | (c >> 6)] + hex_table[0x80 | (c & 0x3f)];
                continue;
            }
            if (c < 0xd800 || c >= 0xe000) {
                arr[arr.length] =
                    hex_table[0xe0 | (c >> 12)] + hex_table[0x80 | ((c >> 6) & 0x3f)] + hex_table[0x80 | (c & 0x3f)];
                continue;
            }
            i += 1;
            c = 0x10000 + (((c & 0x3ff) << 10) | (segment.charCodeAt(i) & 0x3ff));
            arr[arr.length] =
                hex_table[0xf0 | (c >> 18)] +
                    hex_table[0x80 | ((c >> 12) & 0x3f)] +
                    hex_table[0x80 | ((c >> 6) & 0x3f)] +
                    hex_table[0x80 | (c & 0x3f)];
        }
        out += arr.join('');
    }
    return out;
};
function is_buffer(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }
    return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
}
function maybe_map(val, fn) {
    if (is_array$1(val)) {
        const mapped = [];
        for (let i = 0; i < val.length; i += 1) {
            mapped.push(fn(val[i]));
        }
        return mapped;
    }
    return fn(val);
}

const has = Object.prototype.hasOwnProperty;
const array_prefix_generators = {
    brackets(prefix) {
        return String(prefix) + '[]';
    },
    comma: 'comma',
    indices(prefix, key) {
        return String(prefix) + '[' + key + ']';
    },
    repeat(prefix) {
        return String(prefix);
    },
};
const is_array = Array.isArray;
const push = Array.prototype.push;
const push_to_array = function (arr, value_or_array) {
    push.apply(arr, is_array(value_or_array) ? value_or_array : [value_or_array]);
};
const to_ISO = Date.prototype.toISOString;
const defaults$1 = {
    addQueryPrefix: false,
    allowDots: false,
    allowEmptyArrays: false,
    arrayFormat: 'indices',
    charset: 'utf-8',
    charsetSentinel: false,
    delimiter: '&',
    encode: true,
    encodeDotInKeys: false,
    encoder: encode,
    encodeValuesOnly: false,
    format: default_format,
    formatter: formatters[default_format],
    /** @deprecated */
    indices: false,
    serializeDate(date) {
        return to_ISO.call(date);
    },
    skipNulls: false,
    strictNullHandling: false,
};
function is_non_nullish_primitive(v) {
    return (typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'symbol' ||
        typeof v === 'bigint');
}
const sentinel = {};
function inner_stringify(object, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
    let obj = object;
    let tmp_sc = sideChannel;
    let step = 0;
    let find_flag = false;
    while ((tmp_sc = tmp_sc.get(sentinel)) !== void undefined && !find_flag) {
        // Where object last appeared in the ref tree
        const pos = tmp_sc.get(object);
        step += 1;
        if (typeof pos !== 'undefined') {
            if (pos === step) {
                throw new RangeError('Cyclic object value');
            }
            else {
                find_flag = true; // Break while
            }
        }
        if (typeof tmp_sc.get(sentinel) === 'undefined') {
            step = 0;
        }
    }
    if (typeof filter === 'function') {
        obj = filter(prefix, obj);
    }
    else if (obj instanceof Date) {
        obj = serializeDate?.(obj);
    }
    else if (generateArrayPrefix === 'comma' && is_array(obj)) {
        obj = maybe_map(obj, function (value) {
            if (value instanceof Date) {
                return serializeDate?.(value);
            }
            return value;
        });
    }
    if (obj === null) {
        if (strictNullHandling) {
            return encoder && !encodeValuesOnly ?
                // @ts-expect-error
                encoder(prefix, defaults$1.encoder, charset, 'key', format)
                : prefix;
        }
        obj = '';
    }
    if (is_non_nullish_primitive(obj) || is_buffer(obj)) {
        if (encoder) {
            const key_value = encodeValuesOnly ? prefix
                // @ts-expect-error
                : encoder(prefix, defaults$1.encoder, charset, 'key', format);
            return [
                formatter?.(key_value) +
                    '=' +
                    // @ts-expect-error
                    formatter?.(encoder(obj, defaults$1.encoder, charset, 'value', format)),
            ];
        }
        return [formatter?.(prefix) + '=' + formatter?.(String(obj))];
    }
    const values = [];
    if (typeof obj === 'undefined') {
        return values;
    }
    let obj_keys;
    if (generateArrayPrefix === 'comma' && is_array(obj)) {
        // we need to join elements in
        if (encodeValuesOnly && encoder) {
            // @ts-expect-error values only
            obj = maybe_map(obj, encoder);
        }
        obj_keys = [{ value: obj.length > 0 ? obj.join(',') || null : void undefined }];
    }
    else if (is_array(filter)) {
        obj_keys = filter;
    }
    else {
        const keys = Object.keys(obj);
        obj_keys = sort ? keys.sort(sort) : keys;
    }
    const encoded_prefix = encodeDotInKeys ? String(prefix).replace(/\./g, '%2E') : String(prefix);
    const adjusted_prefix = commaRoundTrip && is_array(obj) && obj.length === 1 ? encoded_prefix + '[]' : encoded_prefix;
    if (allowEmptyArrays && is_array(obj) && obj.length === 0) {
        return adjusted_prefix + '[]';
    }
    for (let j = 0; j < obj_keys.length; ++j) {
        const key = obj_keys[j];
        const value = 
        // @ts-ignore
        typeof key === 'object' && typeof key.value !== 'undefined' ? key.value : obj[key];
        if (skipNulls && value === null) {
            continue;
        }
        // @ts-ignore
        const encoded_key = allowDots && encodeDotInKeys ? key.replace(/\./g, '%2E') : key;
        const key_prefix = is_array(obj) ?
            typeof generateArrayPrefix === 'function' ?
                generateArrayPrefix(adjusted_prefix, encoded_key)
                : adjusted_prefix
            : adjusted_prefix + (allowDots ? '.' + encoded_key : '[' + encoded_key + ']');
        sideChannel.set(object, step);
        const valueSideChannel = new WeakMap();
        valueSideChannel.set(sentinel, sideChannel);
        push_to_array(values, inner_stringify(value, key_prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, 
        // @ts-ignore
        generateArrayPrefix === 'comma' && encodeValuesOnly && is_array(obj) ? null : encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, valueSideChannel));
    }
    return values;
}
function normalize_stringify_options(opts = defaults$1) {
    if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
        throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
    }
    if (typeof opts.encodeDotInKeys !== 'undefined' && typeof opts.encodeDotInKeys !== 'boolean') {
        throw new TypeError('`encodeDotInKeys` option can only be `true` or `false`, when provided');
    }
    if (opts.encoder !== null && typeof opts.encoder !== 'undefined' && typeof opts.encoder !== 'function') {
        throw new TypeError('Encoder has to be a function.');
    }
    const charset = opts.charset || defaults$1.charset;
    if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
        throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
    }
    let format = default_format;
    if (typeof opts.format !== 'undefined') {
        if (!has.call(formatters, opts.format)) {
            throw new TypeError('Unknown format option provided.');
        }
        format = opts.format;
    }
    const formatter = formatters[format];
    let filter = defaults$1.filter;
    if (typeof opts.filter === 'function' || is_array(opts.filter)) {
        filter = opts.filter;
    }
    let arrayFormat;
    if (opts.arrayFormat && opts.arrayFormat in array_prefix_generators) {
        arrayFormat = opts.arrayFormat;
    }
    else if ('indices' in opts) {
        arrayFormat = opts.indices ? 'indices' : 'repeat';
    }
    else {
        arrayFormat = defaults$1.arrayFormat;
    }
    if ('commaRoundTrip' in opts && typeof opts.commaRoundTrip !== 'boolean') {
        throw new TypeError('`commaRoundTrip` must be a boolean, or absent');
    }
    const allowDots = typeof opts.allowDots === 'undefined' ?
        !!opts.encodeDotInKeys === true ?
            true
            : defaults$1.allowDots
        : !!opts.allowDots;
    return {
        addQueryPrefix: typeof opts.addQueryPrefix === 'boolean' ? opts.addQueryPrefix : defaults$1.addQueryPrefix,
        // @ts-ignore
        allowDots: allowDots,
        allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults$1.allowEmptyArrays,
        arrayFormat: arrayFormat,
        charset: charset,
        charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults$1.charsetSentinel,
        commaRoundTrip: !!opts.commaRoundTrip,
        delimiter: typeof opts.delimiter === 'undefined' ? defaults$1.delimiter : opts.delimiter,
        encode: typeof opts.encode === 'boolean' ? opts.encode : defaults$1.encode,
        encodeDotInKeys: typeof opts.encodeDotInKeys === 'boolean' ? opts.encodeDotInKeys : defaults$1.encodeDotInKeys,
        encoder: typeof opts.encoder === 'function' ? opts.encoder : defaults$1.encoder,
        encodeValuesOnly: typeof opts.encodeValuesOnly === 'boolean' ? opts.encodeValuesOnly : defaults$1.encodeValuesOnly,
        filter: filter,
        format: format,
        formatter: formatter,
        serializeDate: typeof opts.serializeDate === 'function' ? opts.serializeDate : defaults$1.serializeDate,
        skipNulls: typeof opts.skipNulls === 'boolean' ? opts.skipNulls : defaults$1.skipNulls,
        // @ts-ignore
        sort: typeof opts.sort === 'function' ? opts.sort : null,
        strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults$1.strictNullHandling,
    };
}
function stringify(object, opts = {}) {
    let obj = object;
    const options = normalize_stringify_options(opts);
    let obj_keys;
    let filter;
    if (typeof options.filter === 'function') {
        filter = options.filter;
        obj = filter('', obj);
    }
    else if (is_array(options.filter)) {
        filter = options.filter;
        obj_keys = filter;
    }
    const keys = [];
    if (typeof obj !== 'object' || obj === null) {
        return '';
    }
    const generateArrayPrefix = array_prefix_generators[options.arrayFormat];
    const commaRoundTrip = generateArrayPrefix === 'comma' && options.commaRoundTrip;
    if (!obj_keys) {
        obj_keys = Object.keys(obj);
    }
    if (options.sort) {
        obj_keys.sort(options.sort);
    }
    const sideChannel = new WeakMap();
    for (let i = 0; i < obj_keys.length; ++i) {
        const key = obj_keys[i];
        if (options.skipNulls && obj[key] === null) {
            continue;
        }
        push_to_array(keys, inner_stringify(obj[key], key, 
        // @ts-expect-error
        generateArrayPrefix, commaRoundTrip, options.allowEmptyArrays, options.strictNullHandling, options.skipNulls, options.encodeDotInKeys, options.encode ? options.encoder : null, options.filter, options.sort, options.allowDots, options.serializeDate, options.format, options.formatter, options.encodeValuesOnly, options.charset, sideChannel));
    }
    const joined = keys.join(options.delimiter);
    let prefix = options.addQueryPrefix === true ? '?' : '';
    if (options.charsetSentinel) {
        if (options.charset === 'iso-8859-1') {
            // encodeURIComponent('&#10003;'), the "numeric entity" representation of a checkmark
            prefix += 'utf8=%26%2310003%3B&';
        }
        else {
            // encodeURIComponent('✓')
            prefix += 'utf8=%E2%9C%93&';
        }
    }
    return joined.length > 0 ? prefix + joined : '';
}

const VERSION = '4.104.0'; // x-release-please-version

let auto = false;
let kind = undefined;
let fetch$1 = undefined;
let FormData$1 = undefined;
let File$1 = undefined;
let ReadableStream$1 = undefined;
let getMultipartRequestOptions = undefined;
let getDefaultAgent = undefined;
let fileFromPath = undefined;
let isFsReadStream = undefined;
function setShims(shims, options = { auto: false }) {
    if (auto) {
        throw new Error(`you must \`import 'openai/shims/${shims.kind}'\` before importing anything else from openai`);
    }
    if (kind) {
        throw new Error(`can't \`import 'openai/shims/${shims.kind}'\` after \`import 'openai/shims/${kind}'\``);
    }
    auto = options.auto;
    kind = shims.kind;
    fetch$1 = shims.fetch;
    FormData$1 = shims.FormData;
    File$1 = shims.File;
    ReadableStream$1 = shims.ReadableStream;
    getMultipartRequestOptions = shims.getMultipartRequestOptions;
    getDefaultAgent = shims.getDefaultAgent;
    fileFromPath = shims.fileFromPath;
    isFsReadStream = shims.isFsReadStream;
}

/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
class MultipartBody {
    constructor(body) {
        this.body = body;
    }
    get [Symbol.toStringTag]() {
        return 'MultipartBody';
    }
}

function getRuntime({ manuallyImported } = {}) {
    const recommendation = manuallyImported ?
        `You may need to use polyfills`
        : `Add one of these imports before your first \`import … from 'openai'\`:
- \`import 'openai/shims/node'\` (if you're running on Node)
- \`import 'openai/shims/web'\` (otherwise)
`;
    let _fetch, _Request, _Response, _Headers;
    try {
        // @ts-ignore
        _fetch = fetch;
        // @ts-ignore
        _Request = Request;
        // @ts-ignore
        _Response = Response;
        // @ts-ignore
        _Headers = Headers;
    }
    catch (error) {
        throw new Error(`this environment is missing the following Web Fetch API type: ${error.message}. ${recommendation}`);
    }
    return {
        kind: 'web',
        fetch: _fetch,
        Request: _Request,
        Response: _Response,
        Headers: _Headers,
        FormData: 
        // @ts-ignore
        typeof FormData !== 'undefined' ? FormData : (class FormData {
            // @ts-ignore
            constructor() {
                throw new Error(`file uploads aren't supported in this environment yet as 'FormData' is undefined. ${recommendation}`);
            }
        }),
        Blob: typeof Blob !== 'undefined' ? Blob : (class Blob {
            constructor() {
                throw new Error(`file uploads aren't supported in this environment yet as 'Blob' is undefined. ${recommendation}`);
            }
        }),
        File: 
        // @ts-ignore
        typeof File !== 'undefined' ? File : (class File {
            // @ts-ignore
            constructor() {
                throw new Error(`file uploads aren't supported in this environment yet as 'File' is undefined. ${recommendation}`);
            }
        }),
        ReadableStream: 
        // @ts-ignore
        typeof ReadableStream !== 'undefined' ? ReadableStream : (class ReadableStream {
            // @ts-ignore
            constructor() {
                throw new Error(`streaming isn't supported in this environment yet as 'ReadableStream' is undefined. ${recommendation}`);
            }
        }),
        getMultipartRequestOptions: async (
        // @ts-ignore
        form, opts) => ({
            ...opts,
            body: new MultipartBody(form),
        }),
        getDefaultAgent: (url) => undefined,
        fileFromPath: () => {
            throw new Error('The `fileFromPath` function is only supported in Node. See the README for more details: https://www.github.com/openai/openai-node#file-uploads');
        },
        isFsReadStream: (value) => false,
    };
}

/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
const init = () => {
  if (!kind) setShims(getRuntime(), { auto: true });
};

init();

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class OpenAIError extends Error {
}
class APIError extends OpenAIError {
    constructor(status, error, message, headers) {
        super(`${APIError.makeMessage(status, error, message)}`);
        this.status = status;
        this.headers = headers;
        this.request_id = headers?.['x-request-id'];
        this.error = error;
        const data = error;
        this.code = data?.['code'];
        this.param = data?.['param'];
        this.type = data?.['type'];
    }
    static makeMessage(status, error, message) {
        const msg = error?.message ?
            typeof error.message === 'string' ?
                error.message
                : JSON.stringify(error.message)
            : error ? JSON.stringify(error)
                : message;
        if (status && msg) {
            return `${status} ${msg}`;
        }
        if (status) {
            return `${status} status code (no body)`;
        }
        if (msg) {
            return msg;
        }
        return '(no status code or body)';
    }
    static generate(status, errorResponse, message, headers) {
        if (!status || !headers) {
            return new APIConnectionError({ message, cause: castToError(errorResponse) });
        }
        const error = errorResponse?.['error'];
        if (status === 400) {
            return new BadRequestError(status, error, message, headers);
        }
        if (status === 401) {
            return new AuthenticationError(status, error, message, headers);
        }
        if (status === 403) {
            return new PermissionDeniedError(status, error, message, headers);
        }
        if (status === 404) {
            return new NotFoundError(status, error, message, headers);
        }
        if (status === 409) {
            return new ConflictError(status, error, message, headers);
        }
        if (status === 422) {
            return new UnprocessableEntityError(status, error, message, headers);
        }
        if (status === 429) {
            return new RateLimitError(status, error, message, headers);
        }
        if (status >= 500) {
            return new InternalServerError(status, error, message, headers);
        }
        return new APIError(status, error, message, headers);
    }
}
class APIUserAbortError extends APIError {
    constructor({ message } = {}) {
        super(undefined, undefined, message || 'Request was aborted.', undefined);
    }
}
class APIConnectionError extends APIError {
    constructor({ message, cause }) {
        super(undefined, undefined, message || 'Connection error.', undefined);
        // in some environments the 'cause' property is already declared
        // @ts-ignore
        if (cause)
            this.cause = cause;
    }
}
class APIConnectionTimeoutError extends APIConnectionError {
    constructor({ message } = {}) {
        super({ message: message ?? 'Request timed out.' });
    }
}
class BadRequestError extends APIError {
}
class AuthenticationError extends APIError {
}
class PermissionDeniedError extends APIError {
}
class NotFoundError extends APIError {
}
class ConflictError extends APIError {
}
class UnprocessableEntityError extends APIError {
}
class RateLimitError extends APIError {
}
class InternalServerError extends APIError {
}
class LengthFinishReasonError extends OpenAIError {
    constructor() {
        super(`Could not parse response content as the length limit was reached`);
    }
}
class ContentFilterFinishReasonError extends OpenAIError {
    constructor() {
        super(`Could not parse response content as the request was rejected by the content filter`);
    }
}

var __classPrivateFieldSet$5 = (undefined && undefined.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet$6 = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _LineDecoder_carriageReturnIndex;
/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
class LineDecoder {
    constructor() {
        _LineDecoder_carriageReturnIndex.set(this, void 0);
        this.buffer = new Uint8Array();
        __classPrivateFieldSet$5(this, _LineDecoder_carriageReturnIndex, null, "f");
    }
    decode(chunk) {
        if (chunk == null) {
            return [];
        }
        const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : typeof chunk === 'string' ? new TextEncoder().encode(chunk)
                : chunk;
        let newData = new Uint8Array(this.buffer.length + binaryChunk.length);
        newData.set(this.buffer);
        newData.set(binaryChunk, this.buffer.length);
        this.buffer = newData;
        const lines = [];
        let patternIndex;
        while ((patternIndex = findNewlineIndex(this.buffer, __classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
            if (patternIndex.carriage && __classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f") == null) {
                // skip until we either get a corresponding `\n`, a new `\r` or nothing
                __classPrivateFieldSet$5(this, _LineDecoder_carriageReturnIndex, patternIndex.index, "f");
                continue;
            }
            // we got double \r or \rtext\n
            if (__classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f") != null &&
                (patternIndex.index !== __classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
                lines.push(this.decodeText(this.buffer.slice(0, __classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
                this.buffer = this.buffer.slice(__classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f"));
                __classPrivateFieldSet$5(this, _LineDecoder_carriageReturnIndex, null, "f");
                continue;
            }
            const endIndex = __classPrivateFieldGet$6(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
            const line = this.decodeText(this.buffer.slice(0, endIndex));
            lines.push(line);
            this.buffer = this.buffer.slice(patternIndex.index);
            __classPrivateFieldSet$5(this, _LineDecoder_carriageReturnIndex, null, "f");
        }
        return lines;
    }
    decodeText(bytes) {
        if (bytes == null)
            return '';
        if (typeof bytes === 'string')
            return bytes;
        // Node:
        if (typeof Buffer !== 'undefined') {
            if (bytes instanceof Buffer) {
                return bytes.toString();
            }
            if (bytes instanceof Uint8Array) {
                return Buffer.from(bytes).toString();
            }
            throw new OpenAIError(`Unexpected: received non-Uint8Array (${bytes.constructor.name}) stream chunk in an environment with a global "Buffer" defined, which this library assumes to be Node. Please report this error.`);
        }
        // Browser
        if (typeof TextDecoder !== 'undefined') {
            if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
                this.textDecoder ?? (this.textDecoder = new TextDecoder('utf8'));
                return this.textDecoder.decode(bytes);
            }
            throw new OpenAIError(`Unexpected: received non-Uint8Array/ArrayBuffer (${bytes.constructor.name}) in a web platform. Please report this error.`);
        }
        throw new OpenAIError(`Unexpected: neither Buffer nor TextDecoder are available as globals. Please report this error.`);
    }
    flush() {
        if (!this.buffer.length) {
            return [];
        }
        return this.decode('\n');
    }
}
_LineDecoder_carriageReturnIndex = new WeakMap();
// prettier-ignore
LineDecoder.NEWLINE_CHARS = new Set(['\n', '\r']);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
/**
 * This function searches the buffer for the end patterns, (\r or \n)
 * and returns an object with the index preceding the matched newline and the
 * index after the newline char. `null` is returned if no new line is found.
 *
 * ```ts
 * findNewLineIndex('abc\ndef') -> { preceding: 2, index: 3 }
 * ```
 */
function findNewlineIndex(buffer, startIndex) {
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = startIndex ?? 0; i < buffer.length; i++) {
        if (buffer[i] === newline) {
            return { preceding: i, index: i + 1, carriage: false };
        }
        if (buffer[i] === carriage) {
            return { preceding: i, index: i + 1, carriage: true };
        }
    }
    return null;
}
function findDoubleNewlineIndex(buffer) {
    // This function searches the buffer for the end patterns (\r\r, \n\n, \r\n\r\n)
    // and returns the index right after the first occurrence of any pattern,
    // or -1 if none of the patterns are found.
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === newline && buffer[i + 1] === newline) {
            // \n\n
            return i + 2;
        }
        if (buffer[i] === carriage && buffer[i + 1] === carriage) {
            // \r\r
            return i + 2;
        }
        if (buffer[i] === carriage &&
            buffer[i + 1] === newline &&
            i + 3 < buffer.length &&
            buffer[i + 2] === carriage &&
            buffer[i + 3] === newline) {
            // \r\n\r\n
            return i + 4;
        }
    }
    return -1;
}

/**
 * Most browsers don't yet have async iterable support for ReadableStream,
 * and Node has a very different way of reading bytes from its "ReadableStream".
 *
 * This polyfill was pulled from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490
 */
function ReadableStreamToAsyncIterable(stream) {
    if (stream[Symbol.asyncIterator])
        return stream;
    const reader = stream.getReader();
    return {
        async next() {
            try {
                const result = await reader.read();
                if (result?.done)
                    reader.releaseLock(); // release lock when stream becomes closed
                return result;
            }
            catch (e) {
                reader.releaseLock(); // release lock when stream becomes errored
                throw e;
            }
        },
        async return() {
            const cancelPromise = reader.cancel();
            reader.releaseLock();
            await cancelPromise;
            return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
            return this;
        },
    };
}

class Stream {
    constructor(iterator, controller) {
        this.iterator = iterator;
        this.controller = controller;
    }
    static fromSSEResponse(response, controller) {
        let consumed = false;
        async function* iterator() {
            if (consumed) {
                throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
            }
            consumed = true;
            let done = false;
            try {
                for await (const sse of _iterSSEMessages(response, controller)) {
                    if (done)
                        continue;
                    if (sse.data.startsWith('[DONE]')) {
                        done = true;
                        continue;
                    }
                    if (sse.event === null ||
                        sse.event.startsWith('response.') ||
                        sse.event.startsWith('transcript.')) {
                        let data;
                        try {
                            data = JSON.parse(sse.data);
                        }
                        catch (e) {
                            console.error(`Could not parse message into JSON:`, sse.data);
                            console.error(`From chunk:`, sse.raw);
                            throw e;
                        }
                        if (data && data.error) {
                            throw new APIError(undefined, data.error, undefined, createResponseHeaders(response.headers));
                        }
                        yield data;
                    }
                    else {
                        let data;
                        try {
                            data = JSON.parse(sse.data);
                        }
                        catch (e) {
                            console.error(`Could not parse message into JSON:`, sse.data);
                            console.error(`From chunk:`, sse.raw);
                            throw e;
                        }
                        // TODO: Is this where the error should be thrown?
                        if (sse.event == 'error') {
                            throw new APIError(undefined, data.error, data.message, undefined);
                        }
                        yield { event: sse.event, data: data };
                    }
                }
                done = true;
            }
            catch (e) {
                // If the user calls `stream.controller.abort()`, we should exit without throwing.
                if (e instanceof Error && e.name === 'AbortError')
                    return;
                throw e;
            }
            finally {
                // If the user `break`s, abort the ongoing request.
                if (!done)
                    controller.abort();
            }
        }
        return new Stream(iterator, controller);
    }
    /**
     * Generates a Stream from a newline-separated ReadableStream
     * where each item is a JSON value.
     */
    static fromReadableStream(readableStream, controller) {
        let consumed = false;
        async function* iterLines() {
            const lineDecoder = new LineDecoder();
            const iter = ReadableStreamToAsyncIterable(readableStream);
            for await (const chunk of iter) {
                for (const line of lineDecoder.decode(chunk)) {
                    yield line;
                }
            }
            for (const line of lineDecoder.flush()) {
                yield line;
            }
        }
        async function* iterator() {
            if (consumed) {
                throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
            }
            consumed = true;
            let done = false;
            try {
                for await (const line of iterLines()) {
                    if (done)
                        continue;
                    if (line)
                        yield JSON.parse(line);
                }
                done = true;
            }
            catch (e) {
                // If the user calls `stream.controller.abort()`, we should exit without throwing.
                if (e instanceof Error && e.name === 'AbortError')
                    return;
                throw e;
            }
            finally {
                // If the user `break`s, abort the ongoing request.
                if (!done)
                    controller.abort();
            }
        }
        return new Stream(iterator, controller);
    }
    [Symbol.asyncIterator]() {
        return this.iterator();
    }
    /**
     * Splits the stream into two streams which can be
     * independently read from at different speeds.
     */
    tee() {
        const left = [];
        const right = [];
        const iterator = this.iterator();
        const teeIterator = (queue) => {
            return {
                next: () => {
                    if (queue.length === 0) {
                        const result = iterator.next();
                        left.push(result);
                        right.push(result);
                    }
                    return queue.shift();
                },
            };
        };
        return [
            new Stream(() => teeIterator(left), this.controller),
            new Stream(() => teeIterator(right), this.controller),
        ];
    }
    /**
     * Converts this stream to a newline-separated ReadableStream of
     * JSON stringified values in the stream
     * which can be turned back into a Stream with `Stream.fromReadableStream()`.
     */
    toReadableStream() {
        const self = this;
        let iter;
        const encoder = new TextEncoder();
        return new ReadableStream$1({
            async start() {
                iter = self[Symbol.asyncIterator]();
            },
            async pull(ctrl) {
                try {
                    const { value, done } = await iter.next();
                    if (done)
                        return ctrl.close();
                    const bytes = encoder.encode(JSON.stringify(value) + '\n');
                    ctrl.enqueue(bytes);
                }
                catch (err) {
                    ctrl.error(err);
                }
            },
            async cancel() {
                await iter.return?.();
            },
        });
    }
}
async function* _iterSSEMessages(response, controller) {
    if (!response.body) {
        controller.abort();
        throw new OpenAIError(`Attempted to iterate over a response with no body`);
    }
    const sseDecoder = new SSEDecoder();
    const lineDecoder = new LineDecoder();
    const iter = ReadableStreamToAsyncIterable(response.body);
    for await (const sseChunk of iterSSEChunks(iter)) {
        for (const line of lineDecoder.decode(sseChunk)) {
            const sse = sseDecoder.decode(line);
            if (sse)
                yield sse;
        }
    }
    for (const line of lineDecoder.flush()) {
        const sse = sseDecoder.decode(line);
        if (sse)
            yield sse;
    }
}
/**
 * Given an async iterable iterator, iterates over it and yields full
 * SSE chunks, i.e. yields when a double new-line is encountered.
 */
async function* iterSSEChunks(iterator) {
    let data = new Uint8Array();
    for await (const chunk of iterator) {
        if (chunk == null) {
            continue;
        }
        const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : typeof chunk === 'string' ? new TextEncoder().encode(chunk)
                : chunk;
        let newData = new Uint8Array(data.length + binaryChunk.length);
        newData.set(data);
        newData.set(binaryChunk, data.length);
        data = newData;
        let patternIndex;
        while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
            yield data.slice(0, patternIndex);
            data = data.slice(patternIndex);
        }
    }
    if (data.length > 0) {
        yield data;
    }
}
class SSEDecoder {
    constructor() {
        this.event = null;
        this.data = [];
        this.chunks = [];
    }
    decode(line) {
        if (line.endsWith('\r')) {
            line = line.substring(0, line.length - 1);
        }
        if (!line) {
            // empty line and we didn't previously encounter any messages
            if (!this.event && !this.data.length)
                return null;
            const sse = {
                event: this.event,
                data: this.data.join('\n'),
                raw: this.chunks,
            };
            this.event = null;
            this.data = [];
            this.chunks = [];
            return sse;
        }
        this.chunks.push(line);
        if (line.startsWith(':')) {
            return null;
        }
        let [fieldname, _, value] = partition(line, ':');
        if (value.startsWith(' ')) {
            value = value.substring(1);
        }
        if (fieldname === 'event') {
            this.event = value;
        }
        else if (fieldname === 'data') {
            this.data.push(value);
        }
        return null;
    }
}
function partition(str, delimiter) {
    const index = str.indexOf(delimiter);
    if (index !== -1) {
        return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
    }
    return [str, '', ''];
}

const isResponseLike = (value) => value != null &&
    typeof value === 'object' &&
    typeof value.url === 'string' &&
    typeof value.blob === 'function';
const isFileLike = (value) => value != null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.lastModified === 'number' &&
    isBlobLike(value);
/**
 * The BlobLike type omits arrayBuffer() because @types/node-fetch@^2.6.4 lacks it; but this check
 * adds the arrayBuffer() method type because it is available and used at runtime
 */
const isBlobLike = (value) => value != null &&
    typeof value === 'object' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string' &&
    typeof value.text === 'function' &&
    typeof value.slice === 'function' &&
    typeof value.arrayBuffer === 'function';
const isUploadable = (value) => {
    return isFileLike(value) || isResponseLike(value) || isFsReadStream(value);
};
/**
 * Helper for creating a {@link File} to pass to an SDK upload method from a variety of different data formats
 * @param value the raw content of the file.  Can be an {@link Uploadable}, {@link BlobLikePart}, or {@link AsyncIterable} of {@link BlobLikePart}s
 * @param {string=} name the name of the file. If omitted, toFile will try to determine a file name from bits if possible
 * @param {Object=} options additional properties
 * @param {string=} options.type the MIME type of the content
 * @param {number=} options.lastModified the last modified timestamp
 * @returns a {@link File} with the given properties
 */
async function toFile(value, name, options) {
    // If it's a promise, resolve it.
    value = await value;
    // If we've been given a `File` we don't need to do anything
    if (isFileLike(value)) {
        return value;
    }
    if (isResponseLike(value)) {
        const blob = await value.blob();
        name || (name = new URL(value.url).pathname.split(/[\\/]/).pop() ?? 'unknown_file');
        // we need to convert the `Blob` into an array buffer because the `Blob` class
        // that `node-fetch` defines is incompatible with the web standard which results
        // in `new File` interpreting it as a string instead of binary data.
        const data = isBlobLike(blob) ? [(await blob.arrayBuffer())] : [blob];
        return new File$1(data, name, options);
    }
    const bits = await getBytes(value);
    name || (name = getName(value) ?? 'unknown_file');
    if (!options?.type) {
        const type = bits[0]?.type;
        if (typeof type === 'string') {
            options = { ...options, type };
        }
    }
    return new File$1(bits, name, options);
}
async function getBytes(value) {
    let parts = [];
    if (typeof value === 'string' ||
        ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
        value instanceof ArrayBuffer) {
        parts.push(value);
    }
    else if (isBlobLike(value)) {
        parts.push(await value.arrayBuffer());
    }
    else if (isAsyncIterableIterator(value) // includes Readable, ReadableStream, etc.
    ) {
        for await (const chunk of value) {
            parts.push(chunk); // TODO, consider validating?
        }
    }
    else {
        throw new Error(`Unexpected data type: ${typeof value}; constructor: ${value?.constructor
            ?.name}; props: ${propsForError(value)}`);
    }
    return parts;
}
function propsForError(value) {
    const props = Object.getOwnPropertyNames(value);
    return `[${props.map((p) => `"${p}"`).join(', ')}]`;
}
function getName(value) {
    return (getStringFromMaybeBuffer(value.name) ||
        getStringFromMaybeBuffer(value.filename) ||
        // For fs.ReadStream
        getStringFromMaybeBuffer(value.path)?.split(/[\\/]/).pop());
}
const getStringFromMaybeBuffer = (x) => {
    if (typeof x === 'string')
        return x;
    if (typeof Buffer !== 'undefined' && x instanceof Buffer)
        return String(x);
    return undefined;
};
const isAsyncIterableIterator = (value) => value != null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';
const isMultipartBody = (body) => body && typeof body === 'object' && body.body && body[Symbol.toStringTag] === 'MultipartBody';
const multipartFormRequestOptions = async (opts) => {
    const form = await createForm(opts.body);
    return getMultipartRequestOptions(form, opts);
};
const createForm = async (body) => {
    const form = new FormData$1();
    await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
    return form;
};
const addFormValue = async (form, key, value) => {
    if (value === undefined)
        return;
    if (value == null) {
        throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
    }
    // TODO: make nested formats configurable
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        form.append(key, String(value));
    }
    else if (isUploadable(value)) {
        const file = await toFile(value);
        form.append(key, file);
    }
    else if (Array.isArray(value)) {
        await Promise.all(value.map((entry) => addFormValue(form, key + '[]', entry)));
    }
    else if (typeof value === 'object') {
        await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)));
    }
    else {
        throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
    }
};

var __classPrivateFieldSet$4 = (undefined && undefined.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet$5 = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _AbstractPage_client;
// try running side effects outside of _shims/index to workaround https://github.com/vercel/next.js/issues/76881
init();
async function defaultParseResponse(props) {
    const { response } = props;
    if (props.options.stream) {
        debug('response', response.status, response.url, response.headers, response.body);
        // Note: there is an invariant here that isn't represented in the type system
        // that if you set `stream: true` the response type must also be `Stream<T>`
        if (props.options.__streamClass) {
            return props.options.__streamClass.fromSSEResponse(response, props.controller);
        }
        return Stream.fromSSEResponse(response, props.controller);
    }
    // fetch refuses to read the body when the status code is 204.
    if (response.status === 204) {
        return null;
    }
    if (props.options.__binaryResponse) {
        return response;
    }
    const contentType = response.headers.get('content-type');
    const mediaType = contentType?.split(';')[0]?.trim();
    const isJSON = mediaType?.includes('application/json') || mediaType?.endsWith('+json');
    if (isJSON) {
        const json = await response.json();
        debug('response', response.status, response.url, response.headers, json);
        return _addRequestID(json, response);
    }
    const text = await response.text();
    debug('response', response.status, response.url, response.headers, text);
    // TODO handle blob, arraybuffer, other content types, etc.
    return text;
}
function _addRequestID(value, response) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    return Object.defineProperty(value, '_request_id', {
        value: response.headers.get('x-request-id'),
        enumerable: false,
    });
}
/**
 * A subclass of `Promise` providing additional helper methods
 * for interacting with the SDK.
 */
class APIPromise extends Promise {
    constructor(responsePromise, parseResponse = defaultParseResponse) {
        super((resolve) => {
            // this is maybe a bit weird but this has to be a no-op to not implicitly
            // parse the response body; instead .then, .catch, .finally are overridden
            // to parse the response
            resolve(null);
        });
        this.responsePromise = responsePromise;
        this.parseResponse = parseResponse;
    }
    _thenUnwrap(transform) {
        return new APIPromise(this.responsePromise, async (props) => _addRequestID(transform(await this.parseResponse(props), props), props.response));
    }
    /**
     * Gets the raw `Response` instance instead of parsing the response
     * data.
     *
     * If you want to parse the response body but still get the `Response`
     * instance, you can use {@link withResponse()}.
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` if you can,
     * or add one of these imports before your first `import … from 'openai'`:
     * - `import 'openai/shims/node'` (if you're running on Node)
     * - `import 'openai/shims/web'` (otherwise)
     */
    asResponse() {
        return this.responsePromise.then((p) => p.response);
    }
    /**
     * Gets the parsed response data, the raw `Response` instance and the ID of the request,
     * returned via the X-Request-ID header which is useful for debugging requests and reporting
     * issues to OpenAI.
     *
     * If you just want to get the raw `Response` instance without parsing it,
     * you can use {@link asResponse()}.
     *
     *
     * 👋 Getting the wrong TypeScript type for `Response`?
     * Try setting `"moduleResolution": "NodeNext"` if you can,
     * or add one of these imports before your first `import … from 'openai'`:
     * - `import 'openai/shims/node'` (if you're running on Node)
     * - `import 'openai/shims/web'` (otherwise)
     */
    async withResponse() {
        const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
        return { data, response, request_id: response.headers.get('x-request-id') };
    }
    parse() {
        if (!this.parsedPromise) {
            this.parsedPromise = this.responsePromise.then(this.parseResponse);
        }
        return this.parsedPromise;
    }
    then(onfulfilled, onrejected) {
        return this.parse().then(onfulfilled, onrejected);
    }
    catch(onrejected) {
        return this.parse().catch(onrejected);
    }
    finally(onfinally) {
        return this.parse().finally(onfinally);
    }
}
class APIClient {
    constructor({ baseURL, maxRetries = 2, timeout = 600000, // 10 minutes
    httpAgent, fetch: overriddenFetch, }) {
        this.baseURL = baseURL;
        this.maxRetries = validatePositiveInteger('maxRetries', maxRetries);
        this.timeout = validatePositiveInteger('timeout', timeout);
        this.httpAgent = httpAgent;
        this.fetch = overriddenFetch ?? fetch$1;
    }
    authHeaders(opts) {
        return {};
    }
    /**
     * Override this to add your own default headers, for example:
     *
     *  {
     *    ...super.defaultHeaders(),
     *    Authorization: 'Bearer 123',
     *  }
     */
    defaultHeaders(opts) {
        return {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': this.getUserAgent(),
            ...getPlatformHeaders(),
            ...this.authHeaders(opts),
        };
    }
    /**
     * Override this to add your own headers validation:
     */
    validateHeaders(headers, customHeaders) { }
    defaultIdempotencyKey() {
        return `stainless-node-retry-${uuid4()}`;
    }
    get(path, opts) {
        return this.methodRequest('get', path, opts);
    }
    post(path, opts) {
        return this.methodRequest('post', path, opts);
    }
    patch(path, opts) {
        return this.methodRequest('patch', path, opts);
    }
    put(path, opts) {
        return this.methodRequest('put', path, opts);
    }
    delete(path, opts) {
        return this.methodRequest('delete', path, opts);
    }
    methodRequest(method, path, opts) {
        return this.request(Promise.resolve(opts).then(async (opts) => {
            const body = opts && isBlobLike(opts?.body) ? new DataView(await opts.body.arrayBuffer())
                : opts?.body instanceof DataView ? opts.body
                    : opts?.body instanceof ArrayBuffer ? new DataView(opts.body)
                        : opts && ArrayBuffer.isView(opts?.body) ? new DataView(opts.body.buffer)
                            : opts?.body;
            return { method, path, ...opts, body };
        }));
    }
    getAPIList(path, Page, opts) {
        return this.requestAPIList(Page, { method: 'get', path, ...opts });
    }
    calculateContentLength(body) {
        if (typeof body === 'string') {
            if (typeof Buffer !== 'undefined') {
                return Buffer.byteLength(body, 'utf8').toString();
            }
            if (typeof TextEncoder !== 'undefined') {
                const encoder = new TextEncoder();
                const encoded = encoder.encode(body);
                return encoded.length.toString();
            }
        }
        else if (ArrayBuffer.isView(body)) {
            return body.byteLength.toString();
        }
        return null;
    }
    buildRequest(inputOptions, { retryCount = 0 } = {}) {
        const options = { ...inputOptions };
        const { method, path, query, headers: headers = {} } = options;
        const body = ArrayBuffer.isView(options.body) || (options.__binaryRequest && typeof options.body === 'string') ?
            options.body
            : isMultipartBody(options.body) ? options.body.body
                : options.body ? JSON.stringify(options.body, null, 2)
                    : null;
        const contentLength = this.calculateContentLength(body);
        const url = this.buildURL(path, query);
        if ('timeout' in options)
            validatePositiveInteger('timeout', options.timeout);
        options.timeout = options.timeout ?? this.timeout;
        const httpAgent = options.httpAgent ?? this.httpAgent ?? getDefaultAgent(url);
        const minAgentTimeout = options.timeout + 1000;
        if (typeof httpAgent?.options?.timeout === 'number' &&
            minAgentTimeout > (httpAgent.options.timeout ?? 0)) {
            // Allow any given request to bump our agent active socket timeout.
            // This may seem strange, but leaking active sockets should be rare and not particularly problematic,
            // and without mutating agent we would need to create more of them.
            // This tradeoff optimizes for performance.
            httpAgent.options.timeout = minAgentTimeout;
        }
        if (this.idempotencyHeader && method !== 'get') {
            if (!inputOptions.idempotencyKey)
                inputOptions.idempotencyKey = this.defaultIdempotencyKey();
            headers[this.idempotencyHeader] = inputOptions.idempotencyKey;
        }
        const reqHeaders = this.buildHeaders({ options, headers, contentLength, retryCount });
        const req = {
            method,
            ...(body && { body: body }),
            headers: reqHeaders,
            ...(httpAgent && { agent: httpAgent }),
            // @ts-ignore node-fetch uses a custom AbortSignal type that is
            // not compatible with standard web types
            signal: options.signal ?? null,
        };
        return { req, url, timeout: options.timeout };
    }
    buildHeaders({ options, headers, contentLength, retryCount, }) {
        const reqHeaders = {};
        if (contentLength) {
            reqHeaders['content-length'] = contentLength;
        }
        const defaultHeaders = this.defaultHeaders(options);
        applyHeadersMut(reqHeaders, defaultHeaders);
        applyHeadersMut(reqHeaders, headers);
        // let builtin fetch set the Content-Type for multipart bodies
        if (isMultipartBody(options.body) && kind !== 'node') {
            delete reqHeaders['content-type'];
        }
        // Don't set theses headers if they were already set or removed through default headers or by the caller.
        // We check `defaultHeaders` and `headers`, which can contain nulls, instead of `reqHeaders` to account
        // for the removal case.
        if (getHeader(defaultHeaders, 'x-stainless-retry-count') === undefined &&
            getHeader(headers, 'x-stainless-retry-count') === undefined) {
            reqHeaders['x-stainless-retry-count'] = String(retryCount);
        }
        if (getHeader(defaultHeaders, 'x-stainless-timeout') === undefined &&
            getHeader(headers, 'x-stainless-timeout') === undefined &&
            options.timeout) {
            reqHeaders['x-stainless-timeout'] = String(Math.trunc(options.timeout / 1000));
        }
        this.validateHeaders(reqHeaders, headers);
        return reqHeaders;
    }
    /**
     * Used as a callback for mutating the given `FinalRequestOptions` object.
     */
    async prepareOptions(options) { }
    /**
     * Used as a callback for mutating the given `RequestInit` object.
     *
     * This is useful for cases where you want to add certain headers based off of
     * the request properties, e.g. `method` or `url`.
     */
    async prepareRequest(request, { url, options }) { }
    parseHeaders(headers) {
        return (!headers ? {}
            : Symbol.iterator in headers ?
                Object.fromEntries(Array.from(headers).map((header) => [...header]))
                : { ...headers });
    }
    makeStatusError(status, error, message, headers) {
        return APIError.generate(status, error, message, headers);
    }
    request(options, remainingRetries = null) {
        return new APIPromise(this.makeRequest(options, remainingRetries));
    }
    async makeRequest(optionsInput, retriesRemaining) {
        const options = await optionsInput;
        const maxRetries = options.maxRetries ?? this.maxRetries;
        if (retriesRemaining == null) {
            retriesRemaining = maxRetries;
        }
        await this.prepareOptions(options);
        const { req, url, timeout } = this.buildRequest(options, { retryCount: maxRetries - retriesRemaining });
        await this.prepareRequest(req, { url, options });
        debug('request', url, options, req.headers);
        if (options.signal?.aborted) {
            throw new APIUserAbortError();
        }
        const controller = new AbortController();
        const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
        if (response instanceof Error) {
            if (options.signal?.aborted) {
                throw new APIUserAbortError();
            }
            if (retriesRemaining) {
                return this.retryRequest(options, retriesRemaining);
            }
            if (response.name === 'AbortError') {
                throw new APIConnectionTimeoutError();
            }
            throw new APIConnectionError({ cause: response });
        }
        const responseHeaders = createResponseHeaders(response.headers);
        if (!response.ok) {
            if (retriesRemaining && this.shouldRetry(response)) {
                const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
                debug(`response (error; ${retryMessage})`, response.status, url, responseHeaders);
                return this.retryRequest(options, retriesRemaining, responseHeaders);
            }
            const errText = await response.text().catch((e) => castToError(e).message);
            const errJSON = safeJSON(errText);
            const errMessage = errJSON ? undefined : errText;
            const retryMessage = retriesRemaining ? `(error; no more retries left)` : `(error; not retryable)`;
            debug(`response (error; ${retryMessage})`, response.status, url, responseHeaders, errMessage);
            const err = this.makeStatusError(response.status, errJSON, errMessage, responseHeaders);
            throw err;
        }
        return { response, options, controller };
    }
    requestAPIList(Page, options) {
        const request = this.makeRequest(options, null);
        return new PagePromise(this, request, Page);
    }
    buildURL(path, query) {
        const url = isAbsoluteURL(path) ?
            new URL(path)
            : new URL(this.baseURL + (this.baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path));
        const defaultQuery = this.defaultQuery();
        if (!isEmptyObj(defaultQuery)) {
            query = { ...defaultQuery, ...query };
        }
        if (typeof query === 'object' && query && !Array.isArray(query)) {
            url.search = this.stringifyQuery(query);
        }
        return url.toString();
    }
    stringifyQuery(query) {
        return Object.entries(query)
            .filter(([_, value]) => typeof value !== 'undefined')
            .map(([key, value]) => {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }
            if (value === null) {
                return `${encodeURIComponent(key)}=`;
            }
            throw new OpenAIError(`Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
        })
            .join('&');
    }
    async fetchWithTimeout(url, init, ms, controller) {
        const { signal, ...options } = init || {};
        if (signal)
            signal.addEventListener('abort', () => controller.abort());
        const timeout = setTimeout(() => controller.abort(), ms);
        const fetchOptions = {
            signal: controller.signal,
            ...options,
        };
        if (fetchOptions.method) {
            // Custom methods like 'patch' need to be uppercased
            // See https://github.com/nodejs/undici/issues/2294
            fetchOptions.method = fetchOptions.method.toUpperCase();
        }
        return (
        // use undefined this binding; fetch errors if bound to something else in browser/cloudflare
        this.fetch.call(undefined, url, fetchOptions).finally(() => {
            clearTimeout(timeout);
        }));
    }
    shouldRetry(response) {
        // Note this is not a standard header.
        const shouldRetryHeader = response.headers.get('x-should-retry');
        // If the server explicitly says whether or not to retry, obey.
        if (shouldRetryHeader === 'true')
            return true;
        if (shouldRetryHeader === 'false')
            return false;
        // Retry on request timeouts.
        if (response.status === 408)
            return true;
        // Retry on lock timeouts.
        if (response.status === 409)
            return true;
        // Retry on rate limits.
        if (response.status === 429)
            return true;
        // Retry internal errors.
        if (response.status >= 500)
            return true;
        return false;
    }
    async retryRequest(options, retriesRemaining, responseHeaders) {
        let timeoutMillis;
        // Note the `retry-after-ms` header may not be standard, but is a good idea and we'd like proactive support for it.
        const retryAfterMillisHeader = responseHeaders?.['retry-after-ms'];
        if (retryAfterMillisHeader) {
            const timeoutMs = parseFloat(retryAfterMillisHeader);
            if (!Number.isNaN(timeoutMs)) {
                timeoutMillis = timeoutMs;
            }
        }
        // About the Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
        const retryAfterHeader = responseHeaders?.['retry-after'];
        if (retryAfterHeader && !timeoutMillis) {
            const timeoutSeconds = parseFloat(retryAfterHeader);
            if (!Number.isNaN(timeoutSeconds)) {
                timeoutMillis = timeoutSeconds * 1000;
            }
            else {
                timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
            }
        }
        // If the API asks us to wait a certain amount of time (and it's a reasonable amount),
        // just do what it says, but otherwise calculate a default
        if (!(timeoutMillis && 0 <= timeoutMillis && timeoutMillis < 60 * 1000)) {
            const maxRetries = options.maxRetries ?? this.maxRetries;
            timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
        }
        await sleep(timeoutMillis);
        return this.makeRequest(options, retriesRemaining - 1);
    }
    calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
        const initialRetryDelay = 0.5;
        const maxRetryDelay = 8.0;
        const numRetries = maxRetries - retriesRemaining;
        // Apply exponential backoff, but not more than the max.
        const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
        // Apply some jitter, take up to at most 25 percent of the retry time.
        const jitter = 1 - Math.random() * 0.25;
        return sleepSeconds * jitter * 1000;
    }
    getUserAgent() {
        return `${this.constructor.name}/JS ${VERSION}`;
    }
}
class AbstractPage {
    constructor(client, response, body, options) {
        _AbstractPage_client.set(this, void 0);
        __classPrivateFieldSet$4(this, _AbstractPage_client, client, "f");
        this.options = options;
        this.response = response;
        this.body = body;
    }
    hasNextPage() {
        const items = this.getPaginatedItems();
        if (!items.length)
            return false;
        return this.nextPageInfo() != null;
    }
    async getNextPage() {
        const nextInfo = this.nextPageInfo();
        if (!nextInfo) {
            throw new OpenAIError('No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.');
        }
        const nextOptions = { ...this.options };
        if ('params' in nextInfo && typeof nextOptions.query === 'object') {
            nextOptions.query = { ...nextOptions.query, ...nextInfo.params };
        }
        else if ('url' in nextInfo) {
            const params = [...Object.entries(nextOptions.query || {}), ...nextInfo.url.searchParams.entries()];
            for (const [key, value] of params) {
                nextInfo.url.searchParams.set(key, value);
            }
            nextOptions.query = undefined;
            nextOptions.path = nextInfo.url.toString();
        }
        return await __classPrivateFieldGet$5(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
    }
    async *iterPages() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let page = this;
        yield page;
        while (page.hasNextPage()) {
            page = await page.getNextPage();
            yield page;
        }
    }
    async *[(_AbstractPage_client = new WeakMap(), Symbol.asyncIterator)]() {
        for await (const page of this.iterPages()) {
            for (const item of page.getPaginatedItems()) {
                yield item;
            }
        }
    }
}
/**
 * This subclass of Promise will resolve to an instantiated Page once the request completes.
 *
 * It also implements AsyncIterable to allow auto-paginating iteration on an unawaited list call, eg:
 *
 *    for await (const item of client.items.list()) {
 *      console.log(item)
 *    }
 */
class PagePromise extends APIPromise {
    constructor(client, request, Page) {
        super(request, async (props) => new Page(client, props.response, await defaultParseResponse(props), props.options));
    }
    /**
     * Allow auto-paginating iteration on an unawaited list call, eg:
     *
     *    for await (const item of client.items.list()) {
     *      console.log(item)
     *    }
     */
    async *[Symbol.asyncIterator]() {
        const page = await this;
        for await (const item of page) {
            yield item;
        }
    }
}
const createResponseHeaders = (headers) => {
    return new Proxy(Object.fromEntries(
    // @ts-ignore
    headers.entries()), {
        get(target, name) {
            const key = name.toString();
            return target[key.toLowerCase()] || target[key];
        },
    });
};
// This is required so that we can determine if a given object matches the RequestOptions
// type at runtime. While this requires duplication, it is enforced by the TypeScript
// compiler such that any missing / extraneous keys will cause an error.
const requestOptionsKeys = {
    method: true,
    path: true,
    query: true,
    body: true,
    headers: true,
    maxRetries: true,
    stream: true,
    timeout: true,
    httpAgent: true,
    signal: true,
    idempotencyKey: true,
    __metadata: true,
    __binaryRequest: true,
    __binaryResponse: true,
    __streamClass: true,
};
const isRequestOptions = (obj) => {
    return (typeof obj === 'object' &&
        obj !== null &&
        !isEmptyObj(obj) &&
        Object.keys(obj).every((k) => hasOwn(requestOptionsKeys, k)));
};
const getPlatformProperties = () => {
    if (typeof Deno !== 'undefined' && Deno.build != null) {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': VERSION,
            'X-Stainless-OS': normalizePlatform(Deno.build.os),
            'X-Stainless-Arch': normalizeArch(Deno.build.arch),
            'X-Stainless-Runtime': 'deno',
            'X-Stainless-Runtime-Version': typeof Deno.version === 'string' ? Deno.version : Deno.version?.deno ?? 'unknown',
        };
    }
    if (typeof EdgeRuntime !== 'undefined') {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': VERSION,
            'X-Stainless-OS': 'Unknown',
            'X-Stainless-Arch': `other:${EdgeRuntime}`,
            'X-Stainless-Runtime': 'edge',
            'X-Stainless-Runtime-Version': process.version,
        };
    }
    // Check if Node.js
    if (Object.prototype.toString.call(typeof process !== 'undefined' ? process : 0) === '[object process]') {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': VERSION,
            'X-Stainless-OS': normalizePlatform(process.platform),
            'X-Stainless-Arch': normalizeArch(process.arch),
            'X-Stainless-Runtime': 'node',
            'X-Stainless-Runtime-Version': process.version,
        };
    }
    const browserInfo = getBrowserInfo();
    if (browserInfo) {
        return {
            'X-Stainless-Lang': 'js',
            'X-Stainless-Package-Version': VERSION,
            'X-Stainless-OS': 'Unknown',
            'X-Stainless-Arch': 'unknown',
            'X-Stainless-Runtime': `browser:${browserInfo.browser}`,
            'X-Stainless-Runtime-Version': browserInfo.version,
        };
    }
    // TODO add support for Cloudflare workers, etc.
    return {
        'X-Stainless-Lang': 'js',
        'X-Stainless-Package-Version': VERSION,
        'X-Stainless-OS': 'Unknown',
        'X-Stainless-Arch': 'unknown',
        'X-Stainless-Runtime': 'unknown',
        'X-Stainless-Runtime-Version': 'unknown',
    };
};
// Note: modified from https://github.com/JS-DevTools/host-environment/blob/b1ab79ecde37db5d6e163c050e54fe7d287d7c92/src/isomorphic.browser.ts
function getBrowserInfo() {
    if (typeof navigator === 'undefined' || !navigator) {
        return null;
    }
    // NOTE: The order matters here!
    const browserPatterns = [
        { key: 'edge', pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'ie', pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'ie', pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'chrome', pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'firefox', pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
        { key: 'safari', pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ },
    ];
    // Find the FIRST matching browser
    for (const { key, pattern } of browserPatterns) {
        const match = pattern.exec(navigator.userAgent);
        if (match) {
            const major = match[1] || 0;
            const minor = match[2] || 0;
            const patch = match[3] || 0;
            return { browser: key, version: `${major}.${minor}.${patch}` };
        }
    }
    return null;
}
const normalizeArch = (arch) => {
    // Node docs:
    // - https://nodejs.org/api/process.html#processarch
    // Deno docs:
    // - https://doc.deno.land/deno/stable/~/Deno.build
    if (arch === 'x32')
        return 'x32';
    if (arch === 'x86_64' || arch === 'x64')
        return 'x64';
    if (arch === 'arm')
        return 'arm';
    if (arch === 'aarch64' || arch === 'arm64')
        return 'arm64';
    if (arch)
        return `other:${arch}`;
    return 'unknown';
};
const normalizePlatform = (platform) => {
    // Node platforms:
    // - https://nodejs.org/api/process.html#processplatform
    // Deno platforms:
    // - https://doc.deno.land/deno/stable/~/Deno.build
    // - https://github.com/denoland/deno/issues/14799
    platform = platform.toLowerCase();
    // NOTE: this iOS check is untested and may not work
    // Node does not work natively on IOS, there is a fork at
    // https://github.com/nodejs-mobile/nodejs-mobile
    // however it is unknown at the time of writing how to detect if it is running
    if (platform.includes('ios'))
        return 'iOS';
    if (platform === 'android')
        return 'Android';
    if (platform === 'darwin')
        return 'MacOS';
    if (platform === 'win32')
        return 'Windows';
    if (platform === 'freebsd')
        return 'FreeBSD';
    if (platform === 'openbsd')
        return 'OpenBSD';
    if (platform === 'linux')
        return 'Linux';
    if (platform)
        return `Other:${platform}`;
    return 'Unknown';
};
let _platformHeaders;
const getPlatformHeaders = () => {
    return (_platformHeaders ?? (_platformHeaders = getPlatformProperties()));
};
const safeJSON = (text) => {
    try {
        return JSON.parse(text);
    }
    catch (err) {
        return undefined;
    }
};
// https://url.spec.whatwg.org/#url-scheme-string
const startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
const isAbsoluteURL = (url) => {
    return startsWithSchemeRegexp.test(url);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const validatePositiveInteger = (name, n) => {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
        throw new OpenAIError(`${name} must be an integer`);
    }
    if (n < 0) {
        throw new OpenAIError(`${name} must be a positive integer`);
    }
    return n;
};
const castToError = (err) => {
    if (err instanceof Error)
        return err;
    if (typeof err === 'object' && err !== null) {
        try {
            return new Error(JSON.stringify(err));
        }
        catch { }
    }
    return new Error(err);
};
/**
 * Read an environment variable.
 *
 * Trims beginning and trailing whitespace.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
const readEnv = (env) => {
    if (typeof process !== 'undefined') {
        return process.env?.[env]?.trim() ?? undefined;
    }
    if (typeof Deno !== 'undefined') {
        return Deno.env?.get?.(env)?.trim();
    }
    return undefined;
};
// https://stackoverflow.com/a/34491287
function isEmptyObj(obj) {
    if (!obj)
        return true;
    for (const _k in obj)
        return false;
    return true;
}
// https://eslint.org/docs/latest/rules/no-prototype-builtins
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
/**
 * Copies headers from "newHeaders" onto "targetHeaders",
 * using lower-case for all properties,
 * ignoring any keys with undefined values,
 * and deleting any keys with null values.
 */
function applyHeadersMut(targetHeaders, newHeaders) {
    for (const k in newHeaders) {
        if (!hasOwn(newHeaders, k))
            continue;
        const lowerKey = k.toLowerCase();
        if (!lowerKey)
            continue;
        const val = newHeaders[k];
        if (val === null) {
            delete targetHeaders[lowerKey];
        }
        else if (val !== undefined) {
            targetHeaders[lowerKey] = val;
        }
    }
}
const SENSITIVE_HEADERS = new Set(['authorization', 'api-key']);
function debug(action, ...args) {
    if (typeof process !== 'undefined' && process?.env?.['DEBUG'] === 'true') {
        const modifiedArgs = args.map((arg) => {
            if (!arg) {
                return arg;
            }
            // Check for sensitive headers in request body 'headers' object
            if (arg['headers']) {
                // clone so we don't mutate
                const modifiedArg = { ...arg, headers: { ...arg['headers'] } };
                for (const header in arg['headers']) {
                    if (SENSITIVE_HEADERS.has(header.toLowerCase())) {
                        modifiedArg['headers'][header] = 'REDACTED';
                    }
                }
                return modifiedArg;
            }
            let modifiedArg = null;
            // Check for sensitive headers in headers object
            for (const header in arg) {
                if (SENSITIVE_HEADERS.has(header.toLowerCase())) {
                    // avoid making a copy until we need to
                    modifiedArg ?? (modifiedArg = { ...arg });
                    modifiedArg[header] = 'REDACTED';
                }
            }
            return modifiedArg ?? arg;
        });
        console.log(`OpenAI:DEBUG:${action}`, ...modifiedArgs);
    }
}
/**
 * https://stackoverflow.com/a/2117523
 */
const uuid4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};
const isRunningInBrowser = () => {
    return (
    // @ts-ignore
    typeof window !== 'undefined' &&
        // @ts-ignore
        typeof window.document !== 'undefined' &&
        // @ts-ignore
        typeof navigator !== 'undefined');
};
const isHeadersProtocol = (headers) => {
    return typeof headers?.get === 'function';
};
const getHeader = (headers, header) => {
    const lowerCasedHeader = header.toLowerCase();
    if (isHeadersProtocol(headers)) {
        // to deal with the case where the header looks like Stainless-Event-Id
        const intercapsHeader = header[0]?.toUpperCase() +
            header.substring(1).replace(/([^\w])(\w)/g, (_m, g1, g2) => g1 + g2.toUpperCase());
        for (const key of [header, lowerCasedHeader, header.toUpperCase(), intercapsHeader]) {
            const value = headers.get(key);
            if (value) {
                return value;
            }
        }
    }
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerCasedHeader) {
            if (Array.isArray(value)) {
                if (value.length <= 1)
                    return value[0];
                console.warn(`Received ${value.length} entries for the ${header} header, using the first entry.`);
                return value[0];
            }
            return value;
        }
    }
    return undefined;
};
/**
 * Converts a Base64 encoded string to a Float32Array.
 * @param base64Str - The Base64 encoded string.
 * @returns An Array of numbers interpreted as Float32 values.
 */
const toFloat32Array = (base64Str) => {
    if (typeof Buffer !== 'undefined') {
        // for Node.js environment
        const buf = Buffer.from(base64Str, 'base64');
        return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / Float32Array.BYTES_PER_ELEMENT));
    }
    else {
        // for legacy web platform APIs
        const binaryStr = atob(base64Str);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return Array.from(new Float32Array(bytes.buffer));
    }
};
function isObj(obj) {
    return obj != null && typeof obj === 'object' && !Array.isArray(obj);
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
class Page extends AbstractPage {
    constructor(client, response, body, options) {
        super(client, response, body, options);
        this.data = body.data || [];
        this.object = body.object;
    }
    getPaginatedItems() {
        return this.data ?? [];
    }
    // @deprecated Please use `nextPageInfo()` instead
    /**
     * This page represents a response that isn't actually paginated at the API level
     * so there will never be any next page params.
     */
    nextPageParams() {
        return null;
    }
    nextPageInfo() {
        return null;
    }
}
class CursorPage extends AbstractPage {
    constructor(client, response, body, options) {
        super(client, response, body, options);
        this.data = body.data || [];
        this.has_more = body.has_more || false;
    }
    getPaginatedItems() {
        return this.data ?? [];
    }
    hasNextPage() {
        if (this.has_more === false) {
            return false;
        }
        return super.hasNextPage();
    }
    // @deprecated Please use `nextPageInfo()` instead
    nextPageParams() {
        const info = this.nextPageInfo();
        if (!info)
            return null;
        if ('params' in info)
            return info.params;
        const params = Object.fromEntries(info.url.searchParams);
        if (!Object.keys(params).length)
            return null;
        return params;
    }
    nextPageInfo() {
        const data = this.getPaginatedItems();
        if (!data.length) {
            return null;
        }
        const id = data[data.length - 1]?.id;
        if (!id) {
            return null;
        }
        return { params: { after: id } };
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class APIResource {
    constructor(client) {
        this._client = client;
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Messages$1 = class Messages extends APIResource {
    list(completionId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(completionId, {}, query);
        }
        return this._client.getAPIList(`/chat/completions/${completionId}/messages`, ChatCompletionStoreMessagesPage, { query, ...options });
    }
};

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Completions$2 = class Completions extends APIResource {
    constructor() {
        super(...arguments);
        this.messages = new Messages$1(this._client);
    }
    create(body, options) {
        return this._client.post('/chat/completions', { body, ...options, stream: body.stream ?? false });
    }
    /**
     * Get a stored chat completion. Only Chat Completions that have been created with
     * the `store` parameter set to `true` will be returned.
     *
     * @example
     * ```ts
     * const chatCompletion =
     *   await client.chat.completions.retrieve('completion_id');
     * ```
     */
    retrieve(completionId, options) {
        return this._client.get(`/chat/completions/${completionId}`, options);
    }
    /**
     * Modify a stored chat completion. Only Chat Completions that have been created
     * with the `store` parameter set to `true` can be modified. Currently, the only
     * supported modification is to update the `metadata` field.
     *
     * @example
     * ```ts
     * const chatCompletion = await client.chat.completions.update(
     *   'completion_id',
     *   { metadata: { foo: 'string' } },
     * );
     * ```
     */
    update(completionId, body, options) {
        return this._client.post(`/chat/completions/${completionId}`, { body, ...options });
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/chat/completions', ChatCompletionsPage, { query, ...options });
    }
    /**
     * Delete a stored chat completion. Only Chat Completions that have been created
     * with the `store` parameter set to `true` can be deleted.
     *
     * @example
     * ```ts
     * const chatCompletionDeleted =
     *   await client.chat.completions.del('completion_id');
     * ```
     */
    del(completionId, options) {
        return this._client.delete(`/chat/completions/${completionId}`, options);
    }
};
class ChatCompletionsPage extends CursorPage {
}
class ChatCompletionStoreMessagesPage extends CursorPage {
}
Completions$2.ChatCompletionsPage = ChatCompletionsPage;
Completions$2.Messages = Messages$1;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Chat$1 = class Chat extends APIResource {
    constructor() {
        super(...arguments);
        this.completions = new Completions$2(this._client);
    }
};
Chat$1.Completions = Completions$2;
Chat$1.ChatCompletionsPage = ChatCompletionsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Speech extends APIResource {
    /**
     * Generates audio from the input text.
     *
     * @example
     * ```ts
     * const speech = await client.audio.speech.create({
     *   input: 'input',
     *   model: 'string',
     *   voice: 'ash',
     * });
     *
     * const content = await speech.blob();
     * console.log(content);
     * ```
     */
    create(body, options) {
        return this._client.post('/audio/speech', {
            body,
            ...options,
            headers: { Accept: 'application/octet-stream', ...options?.headers },
            __binaryResponse: true,
        });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Transcriptions extends APIResource {
    create(body, options) {
        return this._client.post('/audio/transcriptions', multipartFormRequestOptions({
            body,
            ...options,
            stream: body.stream ?? false,
            __metadata: { model: body.model },
        }));
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Translations extends APIResource {
    create(body, options) {
        return this._client.post('/audio/translations', multipartFormRequestOptions({ body, ...options, __metadata: { model: body.model } }));
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Audio$1 = class Audio extends APIResource {
    constructor() {
        super(...arguments);
        this.transcriptions = new Transcriptions(this._client);
        this.translations = new Translations(this._client);
        this.speech = new Speech(this._client);
    }
};
Audio$1.Transcriptions = Transcriptions;
Audio$1.Translations = Translations;
Audio$1.Speech = Speech;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Batches extends APIResource {
    /**
     * Creates and executes a batch from an uploaded file of requests
     */
    create(body, options) {
        return this._client.post('/batches', { body, ...options });
    }
    /**
     * Retrieves a batch.
     */
    retrieve(batchId, options) {
        return this._client.get(`/batches/${batchId}`, options);
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/batches', BatchesPage, { query, ...options });
    }
    /**
     * Cancels an in-progress batch. The batch will be in status `cancelling` for up to
     * 10 minutes, before changing to `cancelled`, where it will have partial results
     * (if any) available in the output file.
     */
    cancel(batchId, options) {
        return this._client.post(`/batches/${batchId}/cancel`, options);
    }
}
class BatchesPage extends CursorPage {
}
Batches.BatchesPage = BatchesPage;

var __classPrivateFieldSet$3 = (undefined && undefined.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet$4 = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _EventStream_instances, _EventStream_connectedPromise, _EventStream_resolveConnectedPromise, _EventStream_rejectConnectedPromise, _EventStream_endPromise, _EventStream_resolveEndPromise, _EventStream_rejectEndPromise, _EventStream_listeners, _EventStream_ended, _EventStream_errored, _EventStream_aborted, _EventStream_catchingPromiseCreated, _EventStream_handleError;
class EventStream {
    constructor() {
        _EventStream_instances.add(this);
        this.controller = new AbortController();
        _EventStream_connectedPromise.set(this, void 0);
        _EventStream_resolveConnectedPromise.set(this, () => { });
        _EventStream_rejectConnectedPromise.set(this, () => { });
        _EventStream_endPromise.set(this, void 0);
        _EventStream_resolveEndPromise.set(this, () => { });
        _EventStream_rejectEndPromise.set(this, () => { });
        _EventStream_listeners.set(this, {});
        _EventStream_ended.set(this, false);
        _EventStream_errored.set(this, false);
        _EventStream_aborted.set(this, false);
        _EventStream_catchingPromiseCreated.set(this, false);
        __classPrivateFieldSet$3(this, _EventStream_connectedPromise, new Promise((resolve, reject) => {
            __classPrivateFieldSet$3(this, _EventStream_resolveConnectedPromise, resolve, "f");
            __classPrivateFieldSet$3(this, _EventStream_rejectConnectedPromise, reject, "f");
        }), "f");
        __classPrivateFieldSet$3(this, _EventStream_endPromise, new Promise((resolve, reject) => {
            __classPrivateFieldSet$3(this, _EventStream_resolveEndPromise, resolve, "f");
            __classPrivateFieldSet$3(this, _EventStream_rejectEndPromise, reject, "f");
        }), "f");
        // Don't let these promises cause unhandled rejection errors.
        // we will manually cause an unhandled rejection error later
        // if the user hasn't registered any error listener or called
        // any promise-returning method.
        __classPrivateFieldGet$4(this, _EventStream_connectedPromise, "f").catch(() => { });
        __classPrivateFieldGet$4(this, _EventStream_endPromise, "f").catch(() => { });
    }
    _run(executor) {
        // Unfortunately if we call `executor()` immediately we get runtime errors about
        // references to `this` before the `super()` constructor call returns.
        setTimeout(() => {
            executor().then(() => {
                this._emitFinal();
                this._emit('end');
            }, __classPrivateFieldGet$4(this, _EventStream_instances, "m", _EventStream_handleError).bind(this));
        }, 0);
    }
    _connected() {
        if (this.ended)
            return;
        __classPrivateFieldGet$4(this, _EventStream_resolveConnectedPromise, "f").call(this);
        this._emit('connect');
    }
    get ended() {
        return __classPrivateFieldGet$4(this, _EventStream_ended, "f");
    }
    get errored() {
        return __classPrivateFieldGet$4(this, _EventStream_errored, "f");
    }
    get aborted() {
        return __classPrivateFieldGet$4(this, _EventStream_aborted, "f");
    }
    abort() {
        this.controller.abort();
    }
    /**
     * Adds the listener function to the end of the listeners array for the event.
     * No checks are made to see if the listener has already been added. Multiple calls passing
     * the same combination of event and listener will result in the listener being added, and
     * called, multiple times.
     * @returns this ChatCompletionStream, so that calls can be chained
     */
    on(event, listener) {
        const listeners = __classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event] || (__classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event] = []);
        listeners.push({ listener });
        return this;
    }
    /**
     * Removes the specified listener from the listener array for the event.
     * off() will remove, at most, one instance of a listener from the listener array. If any single
     * listener has been added multiple times to the listener array for the specified event, then
     * off() must be called multiple times to remove each instance.
     * @returns this ChatCompletionStream, so that calls can be chained
     */
    off(event, listener) {
        const listeners = __classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event];
        if (!listeners)
            return this;
        const index = listeners.findIndex((l) => l.listener === listener);
        if (index >= 0)
            listeners.splice(index, 1);
        return this;
    }
    /**
     * Adds a one-time listener function for the event. The next time the event is triggered,
     * this listener is removed and then invoked.
     * @returns this ChatCompletionStream, so that calls can be chained
     */
    once(event, listener) {
        const listeners = __classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event] || (__classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event] = []);
        listeners.push({ listener, once: true });
        return this;
    }
    /**
     * This is similar to `.once()`, but returns a Promise that resolves the next time
     * the event is triggered, instead of calling a listener callback.
     * @returns a Promise that resolves the next time given event is triggered,
     * or rejects if an error is emitted.  (If you request the 'error' event,
     * returns a promise that resolves with the error).
     *
     * Example:
     *
     *   const message = await stream.emitted('message') // rejects if the stream errors
     */
    emitted(event) {
        return new Promise((resolve, reject) => {
            __classPrivateFieldSet$3(this, _EventStream_catchingPromiseCreated, true, "f");
            if (event !== 'error')
                this.once('error', reject);
            this.once(event, resolve);
        });
    }
    async done() {
        __classPrivateFieldSet$3(this, _EventStream_catchingPromiseCreated, true, "f");
        await __classPrivateFieldGet$4(this, _EventStream_endPromise, "f");
    }
    _emit(event, ...args) {
        // make sure we don't emit any events after end
        if (__classPrivateFieldGet$4(this, _EventStream_ended, "f")) {
            return;
        }
        if (event === 'end') {
            __classPrivateFieldSet$3(this, _EventStream_ended, true, "f");
            __classPrivateFieldGet$4(this, _EventStream_resolveEndPromise, "f").call(this);
        }
        const listeners = __classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event];
        if (listeners) {
            __classPrivateFieldGet$4(this, _EventStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
            listeners.forEach(({ listener }) => listener(...args));
        }
        if (event === 'abort') {
            const error = args[0];
            if (!__classPrivateFieldGet$4(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
                Promise.reject(error);
            }
            __classPrivateFieldGet$4(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
            __classPrivateFieldGet$4(this, _EventStream_rejectEndPromise, "f").call(this, error);
            this._emit('end');
            return;
        }
        if (event === 'error') {
            // NOTE: _emit('error', error) should only be called from #handleError().
            const error = args[0];
            if (!__classPrivateFieldGet$4(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
                // Trigger an unhandled rejection if the user hasn't registered any error handlers.
                // If you are seeing stack traces here, make sure to handle errors via either:
                // - runner.on('error', () => ...)
                // - await runner.done()
                // - await runner.finalChatCompletion()
                // - etc.
                Promise.reject(error);
            }
            __classPrivateFieldGet$4(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
            __classPrivateFieldGet$4(this, _EventStream_rejectEndPromise, "f").call(this, error);
            this._emit('end');
        }
    }
    _emitFinal() { }
}
_EventStream_connectedPromise = new WeakMap(), _EventStream_resolveConnectedPromise = new WeakMap(), _EventStream_rejectConnectedPromise = new WeakMap(), _EventStream_endPromise = new WeakMap(), _EventStream_resolveEndPromise = new WeakMap(), _EventStream_rejectEndPromise = new WeakMap(), _EventStream_listeners = new WeakMap(), _EventStream_ended = new WeakMap(), _EventStream_errored = new WeakMap(), _EventStream_aborted = new WeakMap(), _EventStream_catchingPromiseCreated = new WeakMap(), _EventStream_instances = new WeakSet(), _EventStream_handleError = function _EventStream_handleError(error) {
    __classPrivateFieldSet$3(this, _EventStream_errored, true, "f");
    if (error instanceof Error && error.name === 'AbortError') {
        error = new APIUserAbortError();
    }
    if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet$3(this, _EventStream_aborted, true, "f");
        return this._emit('abort', error);
    }
    if (error instanceof OpenAIError) {
        return this._emit('error', error);
    }
    if (error instanceof Error) {
        const openAIError = new OpenAIError(error.message);
        // @ts-ignore
        openAIError.cause = error;
        return this._emit('error', openAIError);
    }
    return this._emit('error', new OpenAIError(String(error)));
};

var __classPrivateFieldGet$3 = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet$2 = (undefined && undefined.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var _AssistantStream_instances, _AssistantStream_events, _AssistantStream_runStepSnapshots, _AssistantStream_messageSnapshots, _AssistantStream_messageSnapshot, _AssistantStream_finalRun, _AssistantStream_currentContentIndex, _AssistantStream_currentContent, _AssistantStream_currentToolCallIndex, _AssistantStream_currentToolCall, _AssistantStream_currentEvent, _AssistantStream_currentRunSnapshot, _AssistantStream_currentRunStepSnapshot, _AssistantStream_addEvent, _AssistantStream_endRequest, _AssistantStream_handleMessage, _AssistantStream_handleRunStep, _AssistantStream_handleEvent, _AssistantStream_accumulateRunStep, _AssistantStream_accumulateMessage, _AssistantStream_accumulateContent, _AssistantStream_handleRun;
class AssistantStream extends EventStream {
    constructor() {
        super(...arguments);
        _AssistantStream_instances.add(this);
        //Track all events in a single list for reference
        _AssistantStream_events.set(this, []);
        //Used to accumulate deltas
        //We are accumulating many types so the value here is not strict
        _AssistantStream_runStepSnapshots.set(this, {});
        _AssistantStream_messageSnapshots.set(this, {});
        _AssistantStream_messageSnapshot.set(this, void 0);
        _AssistantStream_finalRun.set(this, void 0);
        _AssistantStream_currentContentIndex.set(this, void 0);
        _AssistantStream_currentContent.set(this, void 0);
        _AssistantStream_currentToolCallIndex.set(this, void 0);
        _AssistantStream_currentToolCall.set(this, void 0);
        //For current snapshot methods
        _AssistantStream_currentEvent.set(this, void 0);
        _AssistantStream_currentRunSnapshot.set(this, void 0);
        _AssistantStream_currentRunStepSnapshot.set(this, void 0);
    }
    [(_AssistantStream_events = new WeakMap(), _AssistantStream_runStepSnapshots = new WeakMap(), _AssistantStream_messageSnapshots = new WeakMap(), _AssistantStream_messageSnapshot = new WeakMap(), _AssistantStream_finalRun = new WeakMap(), _AssistantStream_currentContentIndex = new WeakMap(), _AssistantStream_currentContent = new WeakMap(), _AssistantStream_currentToolCallIndex = new WeakMap(), _AssistantStream_currentToolCall = new WeakMap(), _AssistantStream_currentEvent = new WeakMap(), _AssistantStream_currentRunSnapshot = new WeakMap(), _AssistantStream_currentRunStepSnapshot = new WeakMap(), _AssistantStream_instances = new WeakSet(), Symbol.asyncIterator)]() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        //Catch all for passing along all events
        this.on('event', (event) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(event);
            }
            else {
                pushQueue.push(event);
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        return {
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk) => (chunk ? { value: chunk, done: false } : { value: undefined, done: true }));
                }
                const chunk = pushQueue.shift();
                return { value: chunk, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        };
    }
    static fromReadableStream(stream) {
        const runner = new AssistantStream();
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    async _fromReadableStream(readableStream, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        this._connected();
        const stream = Stream.fromReadableStream(readableStream, this.controller);
        for await (const event of stream) {
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return this._addRun(__classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    toReadableStream() {
        const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
        return stream.toReadableStream();
    }
    static createToolAssistantStream(threadId, runId, runs, params, options) {
        const runner = new AssistantStream();
        runner._run(() => runner._runToolAssistantStream(threadId, runId, runs, params, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    async _createToolAssistantStream(run, threadId, runId, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        const body = { ...params, stream: true };
        const stream = await run.submitToolOutputs(threadId, runId, body, {
            ...options,
            signal: this.controller.signal,
        });
        this._connected();
        for await (const event of stream) {
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return this._addRun(__classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    static createThreadAssistantStream(params, thread, options) {
        const runner = new AssistantStream();
        runner._run(() => runner._threadAssistantStream(params, thread, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    static createAssistantStream(threadId, runs, params, options) {
        const runner = new AssistantStream();
        runner._run(() => runner._runAssistantStream(threadId, runs, params, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    currentEvent() {
        return __classPrivateFieldGet$3(this, _AssistantStream_currentEvent, "f");
    }
    currentRun() {
        return __classPrivateFieldGet$3(this, _AssistantStream_currentRunSnapshot, "f");
    }
    currentMessageSnapshot() {
        return __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f");
    }
    currentRunStepSnapshot() {
        return __classPrivateFieldGet$3(this, _AssistantStream_currentRunStepSnapshot, "f");
    }
    async finalRunSteps() {
        await this.done();
        return Object.values(__classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f"));
    }
    async finalMessages() {
        await this.done();
        return Object.values(__classPrivateFieldGet$3(this, _AssistantStream_messageSnapshots, "f"));
    }
    async finalRun() {
        await this.done();
        if (!__classPrivateFieldGet$3(this, _AssistantStream_finalRun, "f"))
            throw Error('Final run was not received.');
        return __classPrivateFieldGet$3(this, _AssistantStream_finalRun, "f");
    }
    async _createThreadAssistantStream(thread, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        const body = { ...params, stream: true };
        const stream = await thread.createAndRun(body, { ...options, signal: this.controller.signal });
        this._connected();
        for await (const event of stream) {
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return this._addRun(__classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    async _createAssistantStream(run, threadId, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        const body = { ...params, stream: true };
        const stream = await run.create(threadId, body, { ...options, signal: this.controller.signal });
        this._connected();
        for await (const event of stream) {
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return this._addRun(__classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
    }
    static accumulateDelta(acc, delta) {
        for (const [key, deltaValue] of Object.entries(delta)) {
            if (!acc.hasOwnProperty(key)) {
                acc[key] = deltaValue;
                continue;
            }
            let accValue = acc[key];
            if (accValue === null || accValue === undefined) {
                acc[key] = deltaValue;
                continue;
            }
            // We don't accumulate these special properties
            if (key === 'index' || key === 'type') {
                acc[key] = deltaValue;
                continue;
            }
            // Type-specific accumulation logic
            if (typeof accValue === 'string' && typeof deltaValue === 'string') {
                accValue += deltaValue;
            }
            else if (typeof accValue === 'number' && typeof deltaValue === 'number') {
                accValue += deltaValue;
            }
            else if (isObj(accValue) && isObj(deltaValue)) {
                accValue = this.accumulateDelta(accValue, deltaValue);
            }
            else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
                if (accValue.every((x) => typeof x === 'string' || typeof x === 'number')) {
                    accValue.push(...deltaValue); // Use spread syntax for efficient addition
                    continue;
                }
                for (const deltaEntry of deltaValue) {
                    if (!isObj(deltaEntry)) {
                        throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
                    }
                    const index = deltaEntry['index'];
                    if (index == null) {
                        console.error(deltaEntry);
                        throw new Error('Expected array delta entry to have an `index` property');
                    }
                    if (typeof index !== 'number') {
                        throw new Error(`Expected array delta entry \`index\` property to be a number but got ${index}`);
                    }
                    const accEntry = accValue[index];
                    if (accEntry == null) {
                        accValue.push(deltaEntry);
                    }
                    else {
                        accValue[index] = this.accumulateDelta(accEntry, deltaEntry);
                    }
                }
                continue;
            }
            else {
                throw Error(`Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`);
            }
            acc[key] = accValue;
        }
        return acc;
    }
    _addRun(run) {
        return run;
    }
    async _threadAssistantStream(params, thread, options) {
        return await this._createThreadAssistantStream(thread, params, options);
    }
    async _runAssistantStream(threadId, runs, params, options) {
        return await this._createAssistantStream(runs, threadId, params, options);
    }
    async _runToolAssistantStream(threadId, runId, runs, params, options) {
        return await this._createToolAssistantStream(runs, threadId, runId, params, options);
    }
}
_AssistantStream_addEvent = function _AssistantStream_addEvent(event) {
    if (this.ended)
        return;
    __classPrivateFieldSet$2(this, _AssistantStream_currentEvent, event, "f");
    __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_handleEvent).call(this, event);
    switch (event.event) {
        case 'thread.created':
            //No action on this event.
            break;
        case 'thread.run.created':
        case 'thread.run.queued':
        case 'thread.run.in_progress':
        case 'thread.run.requires_action':
        case 'thread.run.completed':
        case 'thread.run.incomplete':
        case 'thread.run.failed':
        case 'thread.run.cancelling':
        case 'thread.run.cancelled':
        case 'thread.run.expired':
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_handleRun).call(this, event);
            break;
        case 'thread.run.step.created':
        case 'thread.run.step.in_progress':
        case 'thread.run.step.delta':
        case 'thread.run.step.completed':
        case 'thread.run.step.failed':
        case 'thread.run.step.cancelled':
        case 'thread.run.step.expired':
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_handleRunStep).call(this, event);
            break;
        case 'thread.message.created':
        case 'thread.message.in_progress':
        case 'thread.message.delta':
        case 'thread.message.completed':
        case 'thread.message.incomplete':
            __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_handleMessage).call(this, event);
            break;
        case 'error':
            //This is included for completeness, but errors are processed in the SSE event processing so this should not occur
            throw new Error('Encountered an error event in event processing - errors should be processed earlier');
    }
}, _AssistantStream_endRequest = function _AssistantStream_endRequest() {
    if (this.ended) {
        throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    if (!__classPrivateFieldGet$3(this, _AssistantStream_finalRun, "f"))
        throw Error('Final run has not been received');
    return __classPrivateFieldGet$3(this, _AssistantStream_finalRun, "f");
}, _AssistantStream_handleMessage = function _AssistantStream_handleMessage(event) {
    const [accumulatedMessage, newContent] = __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_accumulateMessage).call(this, event, __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f"));
    __classPrivateFieldSet$2(this, _AssistantStream_messageSnapshot, accumulatedMessage, "f");
    __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshots, "f")[accumulatedMessage.id] = accumulatedMessage;
    for (const content of newContent) {
        const snapshotContent = accumulatedMessage.content[content.index];
        if (snapshotContent?.type == 'text') {
            this._emit('textCreated', snapshotContent.text);
        }
    }
    switch (event.event) {
        case 'thread.message.created':
            this._emit('messageCreated', event.data);
            break;
        case 'thread.message.in_progress':
            break;
        case 'thread.message.delta':
            this._emit('messageDelta', event.data.delta, accumulatedMessage);
            if (event.data.delta.content) {
                for (const content of event.data.delta.content) {
                    //If it is text delta, emit a text delta event
                    if (content.type == 'text' && content.text) {
                        let textDelta = content.text;
                        let snapshot = accumulatedMessage.content[content.index];
                        if (snapshot && snapshot.type == 'text') {
                            this._emit('textDelta', textDelta, snapshot.text);
                        }
                        else {
                            throw Error('The snapshot associated with this text delta is not text or missing');
                        }
                    }
                    if (content.index != __classPrivateFieldGet$3(this, _AssistantStream_currentContentIndex, "f")) {
                        //See if we have in progress content
                        if (__classPrivateFieldGet$3(this, _AssistantStream_currentContent, "f")) {
                            switch (__classPrivateFieldGet$3(this, _AssistantStream_currentContent, "f").type) {
                                case 'text':
                                    this._emit('textDone', __classPrivateFieldGet$3(this, _AssistantStream_currentContent, "f").text, __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f"));
                                    break;
                                case 'image_file':
                                    this._emit('imageFileDone', __classPrivateFieldGet$3(this, _AssistantStream_currentContent, "f").image_file, __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f"));
                                    break;
                            }
                        }
                        __classPrivateFieldSet$2(this, _AssistantStream_currentContentIndex, content.index, "f");
                    }
                    __classPrivateFieldSet$2(this, _AssistantStream_currentContent, accumulatedMessage.content[content.index], "f");
                }
            }
            break;
        case 'thread.message.completed':
        case 'thread.message.incomplete':
            //We emit the latest content we were working on on completion (including incomplete)
            if (__classPrivateFieldGet$3(this, _AssistantStream_currentContentIndex, "f") !== undefined) {
                const currentContent = event.data.content[__classPrivateFieldGet$3(this, _AssistantStream_currentContentIndex, "f")];
                if (currentContent) {
                    switch (currentContent.type) {
                        case 'image_file':
                            this._emit('imageFileDone', currentContent.image_file, __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f"));
                            break;
                        case 'text':
                            this._emit('textDone', currentContent.text, __classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f"));
                            break;
                    }
                }
            }
            if (__classPrivateFieldGet$3(this, _AssistantStream_messageSnapshot, "f")) {
                this._emit('messageDone', event.data);
            }
            __classPrivateFieldSet$2(this, _AssistantStream_messageSnapshot, undefined, "f");
    }
}, _AssistantStream_handleRunStep = function _AssistantStream_handleRunStep(event) {
    const accumulatedRunStep = __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_accumulateRunStep).call(this, event);
    __classPrivateFieldSet$2(this, _AssistantStream_currentRunStepSnapshot, accumulatedRunStep, "f");
    switch (event.event) {
        case 'thread.run.step.created':
            this._emit('runStepCreated', event.data);
            break;
        case 'thread.run.step.delta':
            const delta = event.data.delta;
            if (delta.step_details &&
                delta.step_details.type == 'tool_calls' &&
                delta.step_details.tool_calls &&
                accumulatedRunStep.step_details.type == 'tool_calls') {
                for (const toolCall of delta.step_details.tool_calls) {
                    if (toolCall.index == __classPrivateFieldGet$3(this, _AssistantStream_currentToolCallIndex, "f")) {
                        this._emit('toolCallDelta', toolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index]);
                    }
                    else {
                        if (__classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f")) {
                            this._emit('toolCallDone', __classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f"));
                        }
                        __classPrivateFieldSet$2(this, _AssistantStream_currentToolCallIndex, toolCall.index, "f");
                        __classPrivateFieldSet$2(this, _AssistantStream_currentToolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index], "f");
                        if (__classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f"))
                            this._emit('toolCallCreated', __classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f"));
                    }
                }
            }
            this._emit('runStepDelta', event.data.delta, accumulatedRunStep);
            break;
        case 'thread.run.step.completed':
        case 'thread.run.step.failed':
        case 'thread.run.step.cancelled':
        case 'thread.run.step.expired':
            __classPrivateFieldSet$2(this, _AssistantStream_currentRunStepSnapshot, undefined, "f");
            const details = event.data.step_details;
            if (details.type == 'tool_calls') {
                if (__classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f")) {
                    this._emit('toolCallDone', __classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f"));
                    __classPrivateFieldSet$2(this, _AssistantStream_currentToolCall, undefined, "f");
                }
            }
            this._emit('runStepDone', event.data, accumulatedRunStep);
            break;
    }
}, _AssistantStream_handleEvent = function _AssistantStream_handleEvent(event) {
    __classPrivateFieldGet$3(this, _AssistantStream_events, "f").push(event);
    this._emit('event', event);
}, _AssistantStream_accumulateRunStep = function _AssistantStream_accumulateRunStep(event) {
    switch (event.event) {
        case 'thread.run.step.created':
            __classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
            return event.data;
        case 'thread.run.step.delta':
            let snapshot = __classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
            if (!snapshot) {
                throw Error('Received a RunStepDelta before creation of a snapshot');
            }
            let data = event.data;
            if (data.delta) {
                const accumulated = AssistantStream.accumulateDelta(snapshot, data.delta);
                __classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = accumulated;
            }
            return __classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
        case 'thread.run.step.completed':
        case 'thread.run.step.failed':
        case 'thread.run.step.cancelled':
        case 'thread.run.step.expired':
        case 'thread.run.step.in_progress':
            __classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
            break;
    }
    if (__classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id])
        return __classPrivateFieldGet$3(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
    throw new Error('No snapshot available');
}, _AssistantStream_accumulateMessage = function _AssistantStream_accumulateMessage(event, snapshot) {
    let newContent = [];
    switch (event.event) {
        case 'thread.message.created':
            //On creation the snapshot is just the initial message
            return [event.data, newContent];
        case 'thread.message.delta':
            if (!snapshot) {
                throw Error('Received a delta with no existing snapshot (there should be one from message creation)');
            }
            let data = event.data;
            //If this delta does not have content, nothing to process
            if (data.delta.content) {
                for (const contentElement of data.delta.content) {
                    if (contentElement.index in snapshot.content) {
                        let currentContent = snapshot.content[contentElement.index];
                        snapshot.content[contentElement.index] = __classPrivateFieldGet$3(this, _AssistantStream_instances, "m", _AssistantStream_accumulateContent).call(this, contentElement, currentContent);
                    }
                    else {
                        snapshot.content[contentElement.index] = contentElement;
                        // This is a new element
                        newContent.push(contentElement);
                    }
                }
            }
            return [snapshot, newContent];
        case 'thread.message.in_progress':
        case 'thread.message.completed':
        case 'thread.message.incomplete':
            //No changes on other thread events
            if (snapshot) {
                return [snapshot, newContent];
            }
            else {
                throw Error('Received thread message event with no existing snapshot');
            }
    }
    throw Error('Tried to accumulate a non-message event');
}, _AssistantStream_accumulateContent = function _AssistantStream_accumulateContent(contentElement, currentContent) {
    return AssistantStream.accumulateDelta(currentContent, contentElement);
}, _AssistantStream_handleRun = function _AssistantStream_handleRun(event) {
    __classPrivateFieldSet$2(this, _AssistantStream_currentRunSnapshot, event.data, "f");
    switch (event.event) {
        case 'thread.run.created':
            break;
        case 'thread.run.queued':
            break;
        case 'thread.run.in_progress':
            break;
        case 'thread.run.requires_action':
        case 'thread.run.cancelled':
        case 'thread.run.failed':
        case 'thread.run.completed':
        case 'thread.run.expired':
            __classPrivateFieldSet$2(this, _AssistantStream_finalRun, event.data, "f");
            if (__classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f")) {
                this._emit('toolCallDone', __classPrivateFieldGet$3(this, _AssistantStream_currentToolCall, "f"));
                __classPrivateFieldSet$2(this, _AssistantStream_currentToolCall, undefined, "f");
            }
            break;
    }
};

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Assistants extends APIResource {
    /**
     * Create an assistant with a model and instructions.
     *
     * @example
     * ```ts
     * const assistant = await client.beta.assistants.create({
     *   model: 'gpt-4o',
     * });
     * ```
     */
    create(body, options) {
        return this._client.post('/assistants', {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Retrieves an assistant.
     *
     * @example
     * ```ts
     * const assistant = await client.beta.assistants.retrieve(
     *   'assistant_id',
     * );
     * ```
     */
    retrieve(assistantId, options) {
        return this._client.get(`/assistants/${assistantId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Modifies an assistant.
     *
     * @example
     * ```ts
     * const assistant = await client.beta.assistants.update(
     *   'assistant_id',
     * );
     * ```
     */
    update(assistantId, body, options) {
        return this._client.post(`/assistants/${assistantId}`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/assistants', AssistantsPage, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Delete an assistant.
     *
     * @example
     * ```ts
     * const assistantDeleted = await client.beta.assistants.del(
     *   'assistant_id',
     * );
     * ```
     */
    del(assistantId, options) {
        return this._client.delete(`/assistants/${assistantId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
}
class AssistantsPage extends CursorPage {
}
Assistants.AssistantsPage = AssistantsPage;

function isRunnableFunctionWithParse(fn) {
    return typeof fn.parse === 'function';
}

const isAssistantMessage = (message) => {
    return message?.role === 'assistant';
};
const isFunctionMessage = (message) => {
    return message?.role === 'function';
};
const isToolMessage = (message) => {
    return message?.role === 'tool';
};

function isAutoParsableResponseFormat(response_format) {
    return response_format?.['$brand'] === 'auto-parseable-response-format';
}
function isAutoParsableTool$1(tool) {
    return tool?.['$brand'] === 'auto-parseable-tool';
}
function maybeParseChatCompletion(completion, params) {
    if (!params || !hasAutoParseableInput$1(params)) {
        return {
            ...completion,
            choices: completion.choices.map((choice) => ({
                ...choice,
                message: {
                    ...choice.message,
                    parsed: null,
                    ...(choice.message.tool_calls ?
                        {
                            tool_calls: choice.message.tool_calls,
                        }
                        : undefined),
                },
            })),
        };
    }
    return parseChatCompletion(completion, params);
}
function parseChatCompletion(completion, params) {
    const choices = completion.choices.map((choice) => {
        if (choice.finish_reason === 'length') {
            throw new LengthFinishReasonError();
        }
        if (choice.finish_reason === 'content_filter') {
            throw new ContentFilterFinishReasonError();
        }
        return {
            ...choice,
            message: {
                ...choice.message,
                ...(choice.message.tool_calls ?
                    {
                        tool_calls: choice.message.tool_calls?.map((toolCall) => parseToolCall$1(params, toolCall)) ?? undefined,
                    }
                    : undefined),
                parsed: choice.message.content && !choice.message.refusal ?
                    parseResponseFormat(params, choice.message.content)
                    : null,
            },
        };
    });
    return { ...completion, choices };
}
function parseResponseFormat(params, content) {
    if (params.response_format?.type !== 'json_schema') {
        return null;
    }
    if (params.response_format?.type === 'json_schema') {
        if ('$parseRaw' in params.response_format) {
            const response_format = params.response_format;
            return response_format.$parseRaw(content);
        }
        return JSON.parse(content);
    }
    return null;
}
function parseToolCall$1(params, toolCall) {
    const inputTool = params.tools?.find((inputTool) => inputTool.function?.name === toolCall.function.name);
    return {
        ...toolCall,
        function: {
            ...toolCall.function,
            parsed_arguments: isAutoParsableTool$1(inputTool) ? inputTool.$parseRaw(toolCall.function.arguments)
                : inputTool?.function.strict ? JSON.parse(toolCall.function.arguments)
                    : null,
        },
    };
}
function shouldParseToolCall(params, toolCall) {
    if (!params) {
        return false;
    }
    const inputTool = params.tools?.find((inputTool) => inputTool.function?.name === toolCall.function.name);
    return isAutoParsableTool$1(inputTool) || inputTool?.function.strict || false;
}
function hasAutoParseableInput$1(params) {
    if (isAutoParsableResponseFormat(params.response_format)) {
        return true;
    }
    return (params.tools?.some((t) => isAutoParsableTool$1(t) || (t.type === 'function' && t.function.strict === true)) ?? false);
}
function validateInputTools(tools) {
    for (const tool of tools ?? []) {
        if (tool.type !== 'function') {
            throw new OpenAIError(`Currently only \`function\` tool types support auto-parsing; Received \`${tool.type}\``);
        }
        if (tool.function.strict !== true) {
            throw new OpenAIError(`The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
        }
    }
}

var __classPrivateFieldGet$2 = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _AbstractChatCompletionRunner_instances, _AbstractChatCompletionRunner_getFinalContent, _AbstractChatCompletionRunner_getFinalMessage, _AbstractChatCompletionRunner_getFinalFunctionCall, _AbstractChatCompletionRunner_getFinalFunctionCallResult, _AbstractChatCompletionRunner_calculateTotalUsage, _AbstractChatCompletionRunner_validateParams, _AbstractChatCompletionRunner_stringifyFunctionCallResult;
const DEFAULT_MAX_CHAT_COMPLETIONS = 10;
class AbstractChatCompletionRunner extends EventStream {
    constructor() {
        super(...arguments);
        _AbstractChatCompletionRunner_instances.add(this);
        this._chatCompletions = [];
        this.messages = [];
    }
    _addChatCompletion(chatCompletion) {
        this._chatCompletions.push(chatCompletion);
        this._emit('chatCompletion', chatCompletion);
        const message = chatCompletion.choices[0]?.message;
        if (message)
            this._addMessage(message);
        return chatCompletion;
    }
    _addMessage(message, emit = true) {
        if (!('content' in message))
            message.content = null;
        this.messages.push(message);
        if (emit) {
            this._emit('message', message);
            if ((isFunctionMessage(message) || isToolMessage(message)) && message.content) {
                // Note, this assumes that {role: 'tool', content: …} is always the result of a call of tool of type=function.
                this._emit('functionCallResult', message.content);
            }
            else if (isAssistantMessage(message) && message.function_call) {
                this._emit('functionCall', message.function_call);
            }
            else if (isAssistantMessage(message) && message.tool_calls) {
                for (const tool_call of message.tool_calls) {
                    if (tool_call.type === 'function') {
                        this._emit('functionCall', tool_call.function);
                    }
                }
            }
        }
    }
    /**
     * @returns a promise that resolves with the final ChatCompletion, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
     */
    async finalChatCompletion() {
        await this.done();
        const completion = this._chatCompletions[this._chatCompletions.length - 1];
        if (!completion)
            throw new OpenAIError('stream ended without producing a ChatCompletion');
        return completion;
    }
    /**
     * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalContent() {
        await this.done();
        return __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
    }
    /**
     * @returns a promise that resolves with the the final assistant ChatCompletionMessage response,
     * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalMessage() {
        await this.done();
        return __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
    }
    /**
     * @returns a promise that resolves with the content of the final FunctionCall, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalFunctionCall() {
        await this.done();
        return __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionCall).call(this);
    }
    async finalFunctionCallResult() {
        await this.done();
        return __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionCallResult).call(this);
    }
    async totalUsage() {
        await this.done();
        return __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this);
    }
    allChatCompletions() {
        return [...this._chatCompletions];
    }
    _emitFinal() {
        const completion = this._chatCompletions[this._chatCompletions.length - 1];
        if (completion)
            this._emit('finalChatCompletion', completion);
        const finalMessage = __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
        if (finalMessage)
            this._emit('finalMessage', finalMessage);
        const finalContent = __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
        if (finalContent)
            this._emit('finalContent', finalContent);
        const finalFunctionCall = __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionCall).call(this);
        if (finalFunctionCall)
            this._emit('finalFunctionCall', finalFunctionCall);
        const finalFunctionCallResult = __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionCallResult).call(this);
        if (finalFunctionCallResult != null)
            this._emit('finalFunctionCallResult', finalFunctionCallResult);
        if (this._chatCompletions.some((c) => c.usage)) {
            this._emit('totalUsage', __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this));
        }
    }
    async _createChatCompletion(client, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_validateParams).call(this, params);
        const chatCompletion = await client.chat.completions.create({ ...params, stream: false }, { ...options, signal: this.controller.signal });
        this._connected();
        return this._addChatCompletion(parseChatCompletion(chatCompletion, params));
    }
    async _runChatCompletion(client, params, options) {
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        return await this._createChatCompletion(client, params, options);
    }
    async _runFunctions(client, params, options) {
        const role = 'function';
        const { function_call = 'auto', stream, ...restParams } = params;
        const singleFunctionToCall = typeof function_call !== 'string' && function_call?.name;
        const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS } = options || {};
        const functionsByName = {};
        for (const f of params.functions) {
            functionsByName[f.name || f.function.name] = f;
        }
        const functions = params.functions.map((f) => ({
            name: f.name || f.function.name,
            parameters: f.parameters,
            description: f.description,
        }));
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        for (let i = 0; i < maxChatCompletions; ++i) {
            const chatCompletion = await this._createChatCompletion(client, {
                ...restParams,
                function_call,
                functions,
                messages: [...this.messages],
            }, options);
            const message = chatCompletion.choices[0]?.message;
            if (!message) {
                throw new OpenAIError(`missing message in ChatCompletion response`);
            }
            if (!message.function_call)
                return;
            const { name, arguments: args } = message.function_call;
            const fn = functionsByName[name];
            if (!fn) {
                const content = `Invalid function_call: ${JSON.stringify(name)}. Available options are: ${functions
                    .map((f) => JSON.stringify(f.name))
                    .join(', ')}. Please try again`;
                this._addMessage({ role, name, content });
                continue;
            }
            else if (singleFunctionToCall && singleFunctionToCall !== name) {
                const content = `Invalid function_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
                this._addMessage({ role, name, content });
                continue;
            }
            let parsed;
            try {
                parsed = isRunnableFunctionWithParse(fn) ? await fn.parse(args) : args;
            }
            catch (error) {
                this._addMessage({
                    role,
                    name,
                    content: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            // @ts-expect-error it can't rule out `never` type.
            const rawContent = await fn.function(parsed, this);
            const content = __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(this, rawContent);
            this._addMessage({ role, name, content });
            if (singleFunctionToCall)
                return;
        }
    }
    async _runTools(client, params, options) {
        const role = 'tool';
        const { tool_choice = 'auto', stream, ...restParams } = params;
        const singleFunctionToCall = typeof tool_choice !== 'string' && tool_choice?.function?.name;
        const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS } = options || {};
        // TODO(someday): clean this logic up
        const inputTools = params.tools.map((tool) => {
            if (isAutoParsableTool$1(tool)) {
                if (!tool.$callback) {
                    throw new OpenAIError('Tool given to `.runTools()` that does not have an associated function');
                }
                return {
                    type: 'function',
                    function: {
                        function: tool.$callback,
                        name: tool.function.name,
                        description: tool.function.description || '',
                        parameters: tool.function.parameters,
                        parse: tool.$parseRaw,
                        strict: true,
                    },
                };
            }
            return tool;
        });
        const functionsByName = {};
        for (const f of inputTools) {
            if (f.type === 'function') {
                functionsByName[f.function.name || f.function.function.name] = f.function;
            }
        }
        const tools = 'tools' in params ?
            inputTools.map((t) => t.type === 'function' ?
                {
                    type: 'function',
                    function: {
                        name: t.function.name || t.function.function.name,
                        parameters: t.function.parameters,
                        description: t.function.description,
                        strict: t.function.strict,
                    },
                }
                : t)
            : undefined;
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        for (let i = 0; i < maxChatCompletions; ++i) {
            const chatCompletion = await this._createChatCompletion(client, {
                ...restParams,
                tool_choice,
                tools,
                messages: [...this.messages],
            }, options);
            const message = chatCompletion.choices[0]?.message;
            if (!message) {
                throw new OpenAIError(`missing message in ChatCompletion response`);
            }
            if (!message.tool_calls?.length) {
                return;
            }
            for (const tool_call of message.tool_calls) {
                if (tool_call.type !== 'function')
                    continue;
                const tool_call_id = tool_call.id;
                const { name, arguments: args } = tool_call.function;
                const fn = functionsByName[name];
                if (!fn) {
                    const content = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(functionsByName)
                        .map((name) => JSON.stringify(name))
                        .join(', ')}. Please try again`;
                    this._addMessage({ role, tool_call_id, content });
                    continue;
                }
                else if (singleFunctionToCall && singleFunctionToCall !== name) {
                    const content = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
                    this._addMessage({ role, tool_call_id, content });
                    continue;
                }
                let parsed;
                try {
                    parsed = isRunnableFunctionWithParse(fn) ? await fn.parse(args) : args;
                }
                catch (error) {
                    const content = error instanceof Error ? error.message : String(error);
                    this._addMessage({ role, tool_call_id, content });
                    continue;
                }
                // @ts-expect-error it can't rule out `never` type.
                const rawContent = await fn.function(parsed, this);
                const content = __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(this, rawContent);
                this._addMessage({ role, tool_call_id, content });
                if (singleFunctionToCall) {
                    return;
                }
            }
        }
        return;
    }
}
_AbstractChatCompletionRunner_instances = new WeakSet(), _AbstractChatCompletionRunner_getFinalContent = function _AbstractChatCompletionRunner_getFinalContent() {
    return __classPrivateFieldGet$2(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this).content ?? null;
}, _AbstractChatCompletionRunner_getFinalMessage = function _AbstractChatCompletionRunner_getFinalMessage() {
    let i = this.messages.length;
    while (i-- > 0) {
        const message = this.messages[i];
        if (isAssistantMessage(message)) {
            const { function_call, ...rest } = message;
            // TODO: support audio here
            const ret = {
                ...rest,
                content: message.content ?? null,
                refusal: message.refusal ?? null,
            };
            if (function_call) {
                ret.function_call = function_call;
            }
            return ret;
        }
    }
    throw new OpenAIError('stream ended without producing a ChatCompletionMessage with role=assistant');
}, _AbstractChatCompletionRunner_getFinalFunctionCall = function _AbstractChatCompletionRunner_getFinalFunctionCall() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if (isAssistantMessage(message) && message?.function_call) {
            return message.function_call;
        }
        if (isAssistantMessage(message) && message?.tool_calls?.length) {
            return message.tool_calls.at(-1)?.function;
        }
    }
    return;
}, _AbstractChatCompletionRunner_getFinalFunctionCallResult = function _AbstractChatCompletionRunner_getFinalFunctionCallResult() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if (isFunctionMessage(message) && message.content != null) {
            return message.content;
        }
        if (isToolMessage(message) &&
            message.content != null &&
            typeof message.content === 'string' &&
            this.messages.some((x) => x.role === 'assistant' &&
                x.tool_calls?.some((y) => y.type === 'function' && y.id === message.tool_call_id))) {
            return message.content;
        }
    }
    return;
}, _AbstractChatCompletionRunner_calculateTotalUsage = function _AbstractChatCompletionRunner_calculateTotalUsage() {
    const total = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };
    for (const { usage } of this._chatCompletions) {
        if (usage) {
            total.completion_tokens += usage.completion_tokens;
            total.prompt_tokens += usage.prompt_tokens;
            total.total_tokens += usage.total_tokens;
        }
    }
    return total;
}, _AbstractChatCompletionRunner_validateParams = function _AbstractChatCompletionRunner_validateParams(params) {
    if (params.n != null && params.n > 1) {
        throw new OpenAIError('ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.');
    }
}, _AbstractChatCompletionRunner_stringifyFunctionCallResult = function _AbstractChatCompletionRunner_stringifyFunctionCallResult(rawContent) {
    return (typeof rawContent === 'string' ? rawContent
        : rawContent === undefined ? 'undefined'
            : JSON.stringify(rawContent));
};

class ChatCompletionRunner extends AbstractChatCompletionRunner {
    /** @deprecated - please use `runTools` instead. */
    static runFunctions(client, params, options) {
        const runner = new ChatCompletionRunner();
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runFunctions' },
        };
        runner._run(() => runner._runFunctions(client, params, opts));
        return runner;
    }
    static runTools(client, params, options) {
        const runner = new ChatCompletionRunner();
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runTools' },
        };
        runner._run(() => runner._runTools(client, params, opts));
        return runner;
    }
    _addMessage(message, emit = true) {
        super._addMessage(message, emit);
        if (isAssistantMessage(message) && message.content) {
            this._emit('content', message.content);
        }
    }
}

const STR = 0b000000001;
const NUM = 0b000000010;
const ARR = 0b000000100;
const OBJ = 0b000001000;
const NULL = 0b000010000;
const BOOL = 0b000100000;
const NAN = 0b001000000;
const INFINITY = 0b010000000;
const MINUS_INFINITY = 0b100000000;
const INF = INFINITY | MINUS_INFINITY;
const SPECIAL = NULL | BOOL | INF | NAN;
const ATOM = STR | NUM | SPECIAL;
const COLLECTION = ARR | OBJ;
const ALL = ATOM | COLLECTION;
const Allow = {
    STR,
    NUM,
    ARR,
    OBJ,
    NULL,
    BOOL,
    NAN,
    INFINITY,
    MINUS_INFINITY,
    INF,
    SPECIAL,
    ATOM,
    COLLECTION,
    ALL,
};
// The JSON string segment was unable to be parsed completely
class PartialJSON extends Error {
}
class MalformedJSON extends Error {
}
/**
 * Parse incomplete JSON
 * @param {string} jsonString Partial JSON to be parsed
 * @param {number} allowPartial Specify what types are allowed to be partial, see {@link Allow} for details
 * @returns The parsed JSON
 * @throws {PartialJSON} If the JSON is incomplete (related to the `allow` parameter)
 * @throws {MalformedJSON} If the JSON is malformed
 */
function parseJSON(jsonString, allowPartial = Allow.ALL) {
    if (typeof jsonString !== 'string') {
        throw new TypeError(`expecting str, got ${typeof jsonString}`);
    }
    if (!jsonString.trim()) {
        throw new Error(`${jsonString} is empty`);
    }
    return _parseJSON(jsonString.trim(), allowPartial);
}
const _parseJSON = (jsonString, allow) => {
    const length = jsonString.length;
    let index = 0;
    const markPartialJSON = (msg) => {
        throw new PartialJSON(`${msg} at position ${index}`);
    };
    const throwMalformedError = (msg) => {
        throw new MalformedJSON(`${msg} at position ${index}`);
    };
    const parseAny = () => {
        skipBlank();
        if (index >= length)
            markPartialJSON('Unexpected end of input');
        if (jsonString[index] === '"')
            return parseStr();
        if (jsonString[index] === '{')
            return parseObj();
        if (jsonString[index] === '[')
            return parseArr();
        if (jsonString.substring(index, index + 4) === 'null' ||
            (Allow.NULL & allow && length - index < 4 && 'null'.startsWith(jsonString.substring(index)))) {
            index += 4;
            return null;
        }
        if (jsonString.substring(index, index + 4) === 'true' ||
            (Allow.BOOL & allow && length - index < 4 && 'true'.startsWith(jsonString.substring(index)))) {
            index += 4;
            return true;
        }
        if (jsonString.substring(index, index + 5) === 'false' ||
            (Allow.BOOL & allow && length - index < 5 && 'false'.startsWith(jsonString.substring(index)))) {
            index += 5;
            return false;
        }
        if (jsonString.substring(index, index + 8) === 'Infinity' ||
            (Allow.INFINITY & allow && length - index < 8 && 'Infinity'.startsWith(jsonString.substring(index)))) {
            index += 8;
            return Infinity;
        }
        if (jsonString.substring(index, index + 9) === '-Infinity' ||
            (Allow.MINUS_INFINITY & allow &&
                1 < length - index &&
                length - index < 9 &&
                '-Infinity'.startsWith(jsonString.substring(index)))) {
            index += 9;
            return -Infinity;
        }
        if (jsonString.substring(index, index + 3) === 'NaN' ||
            (Allow.NAN & allow && length - index < 3 && 'NaN'.startsWith(jsonString.substring(index)))) {
            index += 3;
            return NaN;
        }
        return parseNum();
    };
    const parseStr = () => {
        const start = index;
        let escape = false;
        index++; // skip initial quote
        while (index < length && (jsonString[index] !== '"' || (escape && jsonString[index - 1] === '\\'))) {
            escape = jsonString[index] === '\\' ? !escape : false;
            index++;
        }
        if (jsonString.charAt(index) == '"') {
            try {
                return JSON.parse(jsonString.substring(start, ++index - Number(escape)));
            }
            catch (e) {
                throwMalformedError(String(e));
            }
        }
        else if (Allow.STR & allow) {
            try {
                return JSON.parse(jsonString.substring(start, index - Number(escape)) + '"');
            }
            catch (e) {
                // SyntaxError: Invalid escape sequence
                return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf('\\')) + '"');
            }
        }
        markPartialJSON('Unterminated string literal');
    };
    const parseObj = () => {
        index++; // skip initial brace
        skipBlank();
        const obj = {};
        try {
            while (jsonString[index] !== '}') {
                skipBlank();
                if (index >= length && Allow.OBJ & allow)
                    return obj;
                const key = parseStr();
                skipBlank();
                index++; // skip colon
                try {
                    const value = parseAny();
                    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
                }
                catch (e) {
                    if (Allow.OBJ & allow)
                        return obj;
                    else
                        throw e;
                }
                skipBlank();
                if (jsonString[index] === ',')
                    index++; // skip comma
            }
        }
        catch (e) {
            if (Allow.OBJ & allow)
                return obj;
            else
                markPartialJSON("Expected '}' at end of object");
        }
        index++; // skip final brace
        return obj;
    };
    const parseArr = () => {
        index++; // skip initial bracket
        const arr = [];
        try {
            while (jsonString[index] !== ']') {
                arr.push(parseAny());
                skipBlank();
                if (jsonString[index] === ',') {
                    index++; // skip comma
                }
            }
        }
        catch (e) {
            if (Allow.ARR & allow) {
                return arr;
            }
            markPartialJSON("Expected ']' at end of array");
        }
        index++; // skip final bracket
        return arr;
    };
    const parseNum = () => {
        if (index === 0) {
            if (jsonString === '-' && Allow.NUM & allow)
                markPartialJSON("Not sure what '-' is");
            try {
                return JSON.parse(jsonString);
            }
            catch (e) {
                if (Allow.NUM & allow) {
                    try {
                        if ('.' === jsonString[jsonString.length - 1])
                            return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf('.')));
                        return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf('e')));
                    }
                    catch (e) { }
                }
                throwMalformedError(String(e));
            }
        }
        const start = index;
        if (jsonString[index] === '-')
            index++;
        while (jsonString[index] && !',]}'.includes(jsonString[index]))
            index++;
        if (index == length && !(Allow.NUM & allow))
            markPartialJSON('Unterminated number literal');
        try {
            return JSON.parse(jsonString.substring(start, index));
        }
        catch (e) {
            if (jsonString.substring(start, index) === '-' && Allow.NUM & allow)
                markPartialJSON("Not sure what '-' is");
            try {
                return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf('e')));
            }
            catch (e) {
                throwMalformedError(String(e));
            }
        }
    };
    const skipBlank = () => {
        while (index < length && ' \n\r\t'.includes(jsonString[index])) {
            index++;
        }
    };
    return parseAny();
};
// using this function with malformed JSON is undefined behavior
const partialParse = (input) => parseJSON(input, Allow.ALL ^ Allow.NUM);

var __classPrivateFieldSet$1 = (undefined && undefined.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet$1 = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _ChatCompletionStream_instances, _ChatCompletionStream_params, _ChatCompletionStream_choiceEventStates, _ChatCompletionStream_currentChatCompletionSnapshot, _ChatCompletionStream_beginRequest, _ChatCompletionStream_getChoiceEventState, _ChatCompletionStream_addChunk, _ChatCompletionStream_emitToolCallDoneEvent, _ChatCompletionStream_emitContentDoneEvents, _ChatCompletionStream_endRequest, _ChatCompletionStream_getAutoParseableResponseFormat, _ChatCompletionStream_accumulateChatCompletion;
class ChatCompletionStream extends AbstractChatCompletionRunner {
    constructor(params) {
        super();
        _ChatCompletionStream_instances.add(this);
        _ChatCompletionStream_params.set(this, void 0);
        _ChatCompletionStream_choiceEventStates.set(this, void 0);
        _ChatCompletionStream_currentChatCompletionSnapshot.set(this, void 0);
        __classPrivateFieldSet$1(this, _ChatCompletionStream_params, params, "f");
        __classPrivateFieldSet$1(this, _ChatCompletionStream_choiceEventStates, [], "f");
    }
    get currentChatCompletionSnapshot() {
        return __classPrivateFieldGet$1(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    }
    /**
     * Intended for use on the frontend, consuming a stream produced with
     * `.toReadableStream()` on the backend.
     *
     * Note that messages sent to the model do not appear in `.on('message')`
     * in this context.
     */
    static fromReadableStream(stream) {
        const runner = new ChatCompletionStream(null);
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    static createChatCompletion(client, params, options) {
        const runner = new ChatCompletionStream(params);
        runner._run(() => runner._runChatCompletion(client, { ...params, stream: true }, { ...options, headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' } }));
        return runner;
    }
    async _createChatCompletion(client, params, options) {
        super._createChatCompletion;
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
        const stream = await client.chat.completions.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
        this._connected();
        for await (const chunk of stream) {
            __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return this._addChatCompletion(__classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
    }
    async _fromReadableStream(readableStream, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
        this._connected();
        const stream = Stream.fromReadableStream(readableStream, this.controller);
        let chatId;
        for await (const chunk of stream) {
            if (chatId && chatId !== chunk.id) {
                // A new request has been made.
                this._addChatCompletion(__classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
            }
            __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
            chatId = chunk.id;
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return this._addChatCompletion(__classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
    }
    [(_ChatCompletionStream_params = new WeakMap(), _ChatCompletionStream_choiceEventStates = new WeakMap(), _ChatCompletionStream_currentChatCompletionSnapshot = new WeakMap(), _ChatCompletionStream_instances = new WeakSet(), _ChatCompletionStream_beginRequest = function _ChatCompletionStream_beginRequest() {
        if (this.ended)
            return;
        __classPrivateFieldSet$1(this, _ChatCompletionStream_currentChatCompletionSnapshot, undefined, "f");
    }, _ChatCompletionStream_getChoiceEventState = function _ChatCompletionStream_getChoiceEventState(choice) {
        let state = __classPrivateFieldGet$1(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index];
        if (state) {
            return state;
        }
        state = {
            content_done: false,
            refusal_done: false,
            logprobs_content_done: false,
            logprobs_refusal_done: false,
            done_tool_calls: new Set(),
            current_tool_call_index: null,
        };
        __classPrivateFieldGet$1(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index] = state;
        return state;
    }, _ChatCompletionStream_addChunk = function _ChatCompletionStream_addChunk(chunk) {
        if (this.ended)
            return;
        const completion = __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_accumulateChatCompletion).call(this, chunk);
        this._emit('chunk', chunk, completion);
        for (const choice of chunk.choices) {
            const choiceSnapshot = completion.choices[choice.index];
            if (choice.delta.content != null &&
                choiceSnapshot.message?.role === 'assistant' &&
                choiceSnapshot.message?.content) {
                this._emit('content', choice.delta.content, choiceSnapshot.message.content);
                this._emit('content.delta', {
                    delta: choice.delta.content,
                    snapshot: choiceSnapshot.message.content,
                    parsed: choiceSnapshot.message.parsed,
                });
            }
            if (choice.delta.refusal != null &&
                choiceSnapshot.message?.role === 'assistant' &&
                choiceSnapshot.message?.refusal) {
                this._emit('refusal.delta', {
                    delta: choice.delta.refusal,
                    snapshot: choiceSnapshot.message.refusal,
                });
            }
            if (choice.logprobs?.content != null && choiceSnapshot.message?.role === 'assistant') {
                this._emit('logprobs.content.delta', {
                    content: choice.logprobs?.content,
                    snapshot: choiceSnapshot.logprobs?.content ?? [],
                });
            }
            if (choice.logprobs?.refusal != null && choiceSnapshot.message?.role === 'assistant') {
                this._emit('logprobs.refusal.delta', {
                    refusal: choice.logprobs?.refusal,
                    snapshot: choiceSnapshot.logprobs?.refusal ?? [],
                });
            }
            const state = __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
            if (choiceSnapshot.finish_reason) {
                __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
                if (state.current_tool_call_index != null) {
                    __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
                }
            }
            for (const toolCall of choice.delta.tool_calls ?? []) {
                if (state.current_tool_call_index !== toolCall.index) {
                    __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
                    // new tool call started, the previous one is done
                    if (state.current_tool_call_index != null) {
                        __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
                    }
                }
                state.current_tool_call_index = toolCall.index;
            }
            for (const toolCallDelta of choice.delta.tool_calls ?? []) {
                const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallDelta.index];
                if (!toolCallSnapshot?.type) {
                    continue;
                }
                if (toolCallSnapshot?.type === 'function') {
                    this._emit('tool_calls.function.arguments.delta', {
                        name: toolCallSnapshot.function?.name,
                        index: toolCallDelta.index,
                        arguments: toolCallSnapshot.function.arguments,
                        parsed_arguments: toolCallSnapshot.function.parsed_arguments,
                        arguments_delta: toolCallDelta.function?.arguments ?? '',
                    });
                }
                else {
                    assertNever(toolCallSnapshot?.type);
                }
            }
        }
    }, _ChatCompletionStream_emitToolCallDoneEvent = function _ChatCompletionStream_emitToolCallDoneEvent(choiceSnapshot, toolCallIndex) {
        const state = __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
        if (state.done_tool_calls.has(toolCallIndex)) {
            // we've already fired the done event
            return;
        }
        const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallIndex];
        if (!toolCallSnapshot) {
            throw new Error('no tool call snapshot');
        }
        if (!toolCallSnapshot.type) {
            throw new Error('tool call snapshot missing `type`');
        }
        if (toolCallSnapshot.type === 'function') {
            const inputTool = __classPrivateFieldGet$1(this, _ChatCompletionStream_params, "f")?.tools?.find((tool) => tool.type === 'function' && tool.function.name === toolCallSnapshot.function.name);
            this._emit('tool_calls.function.arguments.done', {
                name: toolCallSnapshot.function.name,
                index: toolCallIndex,
                arguments: toolCallSnapshot.function.arguments,
                parsed_arguments: isAutoParsableTool$1(inputTool) ? inputTool.$parseRaw(toolCallSnapshot.function.arguments)
                    : inputTool?.function.strict ? JSON.parse(toolCallSnapshot.function.arguments)
                        : null,
            });
        }
        else {
            assertNever(toolCallSnapshot.type);
        }
    }, _ChatCompletionStream_emitContentDoneEvents = function _ChatCompletionStream_emitContentDoneEvents(choiceSnapshot) {
        const state = __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
        if (choiceSnapshot.message.content && !state.content_done) {
            state.content_done = true;
            const responseFormat = __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this);
            this._emit('content.done', {
                content: choiceSnapshot.message.content,
                parsed: responseFormat ? responseFormat.$parseRaw(choiceSnapshot.message.content) : null,
            });
        }
        if (choiceSnapshot.message.refusal && !state.refusal_done) {
            state.refusal_done = true;
            this._emit('refusal.done', { refusal: choiceSnapshot.message.refusal });
        }
        if (choiceSnapshot.logprobs?.content && !state.logprobs_content_done) {
            state.logprobs_content_done = true;
            this._emit('logprobs.content.done', { content: choiceSnapshot.logprobs.content });
        }
        if (choiceSnapshot.logprobs?.refusal && !state.logprobs_refusal_done) {
            state.logprobs_refusal_done = true;
            this._emit('logprobs.refusal.done', { refusal: choiceSnapshot.logprobs.refusal });
        }
    }, _ChatCompletionStream_endRequest = function _ChatCompletionStream_endRequest() {
        if (this.ended) {
            throw new OpenAIError(`stream has ended, this shouldn't happen`);
        }
        const snapshot = __classPrivateFieldGet$1(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
        if (!snapshot) {
            throw new OpenAIError(`request ended without sending any chunks`);
        }
        __classPrivateFieldSet$1(this, _ChatCompletionStream_currentChatCompletionSnapshot, undefined, "f");
        __classPrivateFieldSet$1(this, _ChatCompletionStream_choiceEventStates, [], "f");
        return finalizeChatCompletion(snapshot, __classPrivateFieldGet$1(this, _ChatCompletionStream_params, "f"));
    }, _ChatCompletionStream_getAutoParseableResponseFormat = function _ChatCompletionStream_getAutoParseableResponseFormat() {
        const responseFormat = __classPrivateFieldGet$1(this, _ChatCompletionStream_params, "f")?.response_format;
        if (isAutoParsableResponseFormat(responseFormat)) {
            return responseFormat;
        }
        return null;
    }, _ChatCompletionStream_accumulateChatCompletion = function _ChatCompletionStream_accumulateChatCompletion(chunk) {
        var _a, _b, _c, _d;
        let snapshot = __classPrivateFieldGet$1(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
        const { choices, ...rest } = chunk;
        if (!snapshot) {
            snapshot = __classPrivateFieldSet$1(this, _ChatCompletionStream_currentChatCompletionSnapshot, {
                ...rest,
                choices: [],
            }, "f");
        }
        else {
            Object.assign(snapshot, rest);
        }
        for (const { delta, finish_reason, index, logprobs = null, ...other } of chunk.choices) {
            let choice = snapshot.choices[index];
            if (!choice) {
                choice = snapshot.choices[index] = { finish_reason, index, message: {}, logprobs, ...other };
            }
            if (logprobs) {
                if (!choice.logprobs) {
                    choice.logprobs = Object.assign({}, logprobs);
                }
                else {
                    const { content, refusal, ...rest } = logprobs;
                    Object.assign(choice.logprobs, rest);
                    if (content) {
                        (_a = choice.logprobs).content ?? (_a.content = []);
                        choice.logprobs.content.push(...content);
                    }
                    if (refusal) {
                        (_b = choice.logprobs).refusal ?? (_b.refusal = []);
                        choice.logprobs.refusal.push(...refusal);
                    }
                }
            }
            if (finish_reason) {
                choice.finish_reason = finish_reason;
                if (__classPrivateFieldGet$1(this, _ChatCompletionStream_params, "f") && hasAutoParseableInput$1(__classPrivateFieldGet$1(this, _ChatCompletionStream_params, "f"))) {
                    if (finish_reason === 'length') {
                        throw new LengthFinishReasonError();
                    }
                    if (finish_reason === 'content_filter') {
                        throw new ContentFilterFinishReasonError();
                    }
                }
            }
            Object.assign(choice, other);
            if (!delta)
                continue; // Shouldn't happen; just in case.
            const { content, refusal, function_call, role, tool_calls, ...rest } = delta;
            Object.assign(choice.message, rest);
            if (refusal) {
                choice.message.refusal = (choice.message.refusal || '') + refusal;
            }
            if (role)
                choice.message.role = role;
            if (function_call) {
                if (!choice.message.function_call) {
                    choice.message.function_call = function_call;
                }
                else {
                    if (function_call.name)
                        choice.message.function_call.name = function_call.name;
                    if (function_call.arguments) {
                        (_c = choice.message.function_call).arguments ?? (_c.arguments = '');
                        choice.message.function_call.arguments += function_call.arguments;
                    }
                }
            }
            if (content) {
                choice.message.content = (choice.message.content || '') + content;
                if (!choice.message.refusal && __classPrivateFieldGet$1(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this)) {
                    choice.message.parsed = partialParse(choice.message.content);
                }
            }
            if (tool_calls) {
                if (!choice.message.tool_calls)
                    choice.message.tool_calls = [];
                for (const { index, id, type, function: fn, ...rest } of tool_calls) {
                    const tool_call = ((_d = choice.message.tool_calls)[index] ?? (_d[index] = {}));
                    Object.assign(tool_call, rest);
                    if (id)
                        tool_call.id = id;
                    if (type)
                        tool_call.type = type;
                    if (fn)
                        tool_call.function ?? (tool_call.function = { name: fn.name ?? '', arguments: '' });
                    if (fn?.name)
                        tool_call.function.name = fn.name;
                    if (fn?.arguments) {
                        tool_call.function.arguments += fn.arguments;
                        if (shouldParseToolCall(__classPrivateFieldGet$1(this, _ChatCompletionStream_params, "f"), tool_call)) {
                            tool_call.function.parsed_arguments = partialParse(tool_call.function.arguments);
                        }
                    }
                }
            }
        }
        return snapshot;
    }, Symbol.asyncIterator)]() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        this.on('chunk', (chunk) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(chunk);
            }
            else {
                pushQueue.push(chunk);
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        return {
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk) => (chunk ? { value: chunk, done: false } : { value: undefined, done: true }));
                }
                const chunk = pushQueue.shift();
                return { value: chunk, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        };
    }
    toReadableStream() {
        const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
        return stream.toReadableStream();
    }
}
function finalizeChatCompletion(snapshot, params) {
    const { id, choices, created, model, system_fingerprint, ...rest } = snapshot;
    const completion = {
        ...rest,
        id,
        choices: choices.map(({ message, finish_reason, index, logprobs, ...choiceRest }) => {
            if (!finish_reason) {
                throw new OpenAIError(`missing finish_reason for choice ${index}`);
            }
            const { content = null, function_call, tool_calls, ...messageRest } = message;
            const role = message.role; // this is what we expect; in theory it could be different which would make our types a slight lie but would be fine.
            if (!role) {
                throw new OpenAIError(`missing role for choice ${index}`);
            }
            if (function_call) {
                const { arguments: args, name } = function_call;
                if (args == null) {
                    throw new OpenAIError(`missing function_call.arguments for choice ${index}`);
                }
                if (!name) {
                    throw new OpenAIError(`missing function_call.name for choice ${index}`);
                }
                return {
                    ...choiceRest,
                    message: {
                        content,
                        function_call: { arguments: args, name },
                        role,
                        refusal: message.refusal ?? null,
                    },
                    finish_reason,
                    index,
                    logprobs,
                };
            }
            if (tool_calls) {
                return {
                    ...choiceRest,
                    index,
                    finish_reason,
                    logprobs,
                    message: {
                        ...messageRest,
                        role,
                        content,
                        refusal: message.refusal ?? null,
                        tool_calls: tool_calls.map((tool_call, i) => {
                            const { function: fn, type, id, ...toolRest } = tool_call;
                            const { arguments: args, name, ...fnRest } = fn || {};
                            if (id == null) {
                                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].id\n${str(snapshot)}`);
                            }
                            if (type == null) {
                                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].type\n${str(snapshot)}`);
                            }
                            if (name == null) {
                                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.name\n${str(snapshot)}`);
                            }
                            if (args == null) {
                                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.arguments\n${str(snapshot)}`);
                            }
                            return { ...toolRest, id, type, function: { ...fnRest, name, arguments: args } };
                        }),
                    },
                };
            }
            return {
                ...choiceRest,
                message: { ...messageRest, content, role, refusal: message.refusal ?? null },
                finish_reason,
                index,
                logprobs,
            };
        }),
        created,
        model,
        object: 'chat.completion',
        ...(system_fingerprint ? { system_fingerprint } : {}),
    };
    return maybeParseChatCompletion(completion, params);
}
function str(x) {
    return JSON.stringify(x);
}
function assertNever(_x) { }

class ChatCompletionStreamingRunner extends ChatCompletionStream {
    static fromReadableStream(stream) {
        const runner = new ChatCompletionStreamingRunner(null);
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    /** @deprecated - please use `runTools` instead. */
    static runFunctions(client, params, options) {
        const runner = new ChatCompletionStreamingRunner(null);
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runFunctions' },
        };
        runner._run(() => runner._runFunctions(client, params, opts));
        return runner;
    }
    static runTools(client, params, options) {
        const runner = new ChatCompletionStreamingRunner(
        // @ts-expect-error TODO these types are incompatible
        params);
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runTools' },
        };
        runner._run(() => runner._runTools(client, params, opts));
        return runner;
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Completions$1 = class Completions extends APIResource {
    parse(body, options) {
        validateInputTools(body.tools);
        return this._client.chat.completions
            .create(body, {
            ...options,
            headers: {
                ...options?.headers,
                'X-Stainless-Helper-Method': 'beta.chat.completions.parse',
            },
        })
            ._thenUnwrap((completion) => parseChatCompletion(completion, body));
    }
    runFunctions(body, options) {
        if (body.stream) {
            return ChatCompletionStreamingRunner.runFunctions(this._client, body, options);
        }
        return ChatCompletionRunner.runFunctions(this._client, body, options);
    }
    runTools(body, options) {
        if (body.stream) {
            return ChatCompletionStreamingRunner.runTools(this._client, body, options);
        }
        return ChatCompletionRunner.runTools(this._client, body, options);
    }
    /**
     * Creates a chat completion stream
     */
    stream(body, options) {
        return ChatCompletionStream.createChatCompletion(this._client, body, options);
    }
};

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Chat extends APIResource {
    constructor() {
        super(...arguments);
        this.completions = new Completions$1(this._client);
    }
}
(function (Chat) {
    Chat.Completions = Completions$1;
})(Chat || (Chat = {}));

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Sessions extends APIResource {
    /**
     * Create an ephemeral API token for use in client-side applications with the
     * Realtime API. Can be configured with the same session parameters as the
     * `session.update` client event.
     *
     * It responds with a session object, plus a `client_secret` key which contains a
     * usable ephemeral API token that can be used to authenticate browser clients for
     * the Realtime API.
     *
     * @example
     * ```ts
     * const session =
     *   await client.beta.realtime.sessions.create();
     * ```
     */
    create(body, options) {
        return this._client.post('/realtime/sessions', {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class TranscriptionSessions extends APIResource {
    /**
     * Create an ephemeral API token for use in client-side applications with the
     * Realtime API specifically for realtime transcriptions. Can be configured with
     * the same session parameters as the `transcription_session.update` client event.
     *
     * It responds with a session object, plus a `client_secret` key which contains a
     * usable ephemeral API token that can be used to authenticate browser clients for
     * the Realtime API.
     *
     * @example
     * ```ts
     * const transcriptionSession =
     *   await client.beta.realtime.transcriptionSessions.create();
     * ```
     */
    create(body, options) {
        return this._client.post('/realtime/transcription_sessions', {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Realtime extends APIResource {
    constructor() {
        super(...arguments);
        this.sessions = new Sessions(this._client);
        this.transcriptionSessions = new TranscriptionSessions(this._client);
    }
}
Realtime.Sessions = Sessions;
Realtime.TranscriptionSessions = TranscriptionSessions;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Messages extends APIResource {
    /**
     * Create a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    create(threadId, body, options) {
        return this._client.post(`/threads/${threadId}/messages`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Retrieve a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(threadId, messageId, options) {
        return this._client.get(`/threads/${threadId}/messages/${messageId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Modifies a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    update(threadId, messageId, body, options) {
        return this._client.post(`/threads/${threadId}/messages/${messageId}`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    list(threadId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(threadId, {}, query);
        }
        return this._client.getAPIList(`/threads/${threadId}/messages`, MessagesPage, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Deletes a message.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    del(threadId, messageId, options) {
        return this._client.delete(`/threads/${threadId}/messages/${messageId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
}
class MessagesPage extends CursorPage {
}
Messages.MessagesPage = MessagesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Steps extends APIResource {
    retrieve(threadId, runId, stepId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.retrieve(threadId, runId, stepId, {}, query);
        }
        return this._client.get(`/threads/${threadId}/runs/${runId}/steps/${stepId}`, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    list(threadId, runId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(threadId, runId, {}, query);
        }
        return this._client.getAPIList(`/threads/${threadId}/runs/${runId}/steps`, RunStepsPage, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
}
class RunStepsPage extends CursorPage {
}
Steps.RunStepsPage = RunStepsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
let Runs$1 = class Runs extends APIResource {
    constructor() {
        super(...arguments);
        this.steps = new Steps(this._client);
    }
    create(threadId, params, options) {
        const { include, ...body } = params;
        return this._client.post(`/threads/${threadId}/runs`, {
            query: { include },
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
            stream: params.stream ?? false,
        });
    }
    /**
     * Retrieves a run.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(threadId, runId, options) {
        return this._client.get(`/threads/${threadId}/runs/${runId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Modifies a run.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    update(threadId, runId, body, options) {
        return this._client.post(`/threads/${threadId}/runs/${runId}`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    list(threadId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(threadId, {}, query);
        }
        return this._client.getAPIList(`/threads/${threadId}/runs`, RunsPage, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Cancels a run that is `in_progress`.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    cancel(threadId, runId, options) {
        return this._client.post(`/threads/${threadId}/runs/${runId}/cancel`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * A helper to create a run an poll for a terminal state. More information on Run
     * lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async createAndPoll(threadId, body, options) {
        const run = await this.create(threadId, body, options);
        return await this.poll(threadId, run.id, options);
    }
    /**
     * Create a Run stream
     *
     * @deprecated use `stream` instead
     */
    createAndStream(threadId, body, options) {
        return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
    }
    /**
     * A helper to poll a run status until it reaches a terminal state. More
     * information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async poll(threadId, runId, options) {
        const headers = { ...options?.headers, 'X-Stainless-Poll-Helper': 'true' };
        if (options?.pollIntervalMs) {
            headers['X-Stainless-Custom-Poll-Interval'] = options.pollIntervalMs.toString();
        }
        while (true) {
            const { data: run, response } = await this.retrieve(threadId, runId, {
                ...options,
                headers: { ...options?.headers, ...headers },
            }).withResponse();
            switch (run.status) {
                //If we are in any sort of intermediate state we poll
                case 'queued':
                case 'in_progress':
                case 'cancelling':
                    let sleepInterval = 5000;
                    if (options?.pollIntervalMs) {
                        sleepInterval = options.pollIntervalMs;
                    }
                    else {
                        const headerInterval = response.headers.get('openai-poll-after-ms');
                        if (headerInterval) {
                            const headerIntervalMs = parseInt(headerInterval);
                            if (!isNaN(headerIntervalMs)) {
                                sleepInterval = headerIntervalMs;
                            }
                        }
                    }
                    await sleep(sleepInterval);
                    break;
                //We return the run in any terminal state.
                case 'requires_action':
                case 'incomplete':
                case 'cancelled':
                case 'completed':
                case 'failed':
                case 'expired':
                    return run;
            }
        }
    }
    /**
     * Create a Run stream
     */
    stream(threadId, body, options) {
        return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
    }
    submitToolOutputs(threadId, runId, body, options) {
        return this._client.post(`/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
            stream: body.stream ?? false,
        });
    }
    /**
     * A helper to submit a tool output to a run and poll for a terminal run state.
     * More information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async submitToolOutputsAndPoll(threadId, runId, body, options) {
        const run = await this.submitToolOutputs(threadId, runId, body, options);
        return await this.poll(threadId, run.id, options);
    }
    /**
     * Submit the tool outputs from a previous run and stream the run to a terminal
     * state. More information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    submitToolOutputsStream(threadId, runId, body, options) {
        return AssistantStream.createToolAssistantStream(threadId, runId, this._client.beta.threads.runs, body, options);
    }
};
class RunsPage extends CursorPage {
}
Runs$1.RunsPage = RunsPage;
Runs$1.Steps = Steps;
Runs$1.RunStepsPage = RunStepsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
/**
 * @deprecated The Assistants API is deprecated in favor of the Responses API
 */
class Threads extends APIResource {
    constructor() {
        super(...arguments);
        this.runs = new Runs$1(this._client);
        this.messages = new Messages(this._client);
    }
    create(body = {}, options) {
        if (isRequestOptions(body)) {
            return this.create({}, body);
        }
        return this._client.post('/threads', {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Retrieves a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    retrieve(threadId, options) {
        return this._client.get(`/threads/${threadId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Modifies a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    update(threadId, body, options) {
        return this._client.post(`/threads/${threadId}`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Delete a thread.
     *
     * @deprecated The Assistants API is deprecated in favor of the Responses API
     */
    del(threadId, options) {
        return this._client.delete(`/threads/${threadId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    createAndRun(body, options) {
        return this._client.post('/threads/runs', {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
            stream: body.stream ?? false,
        });
    }
    /**
     * A helper to create a thread, start a run and then poll for a terminal state.
     * More information on Run lifecycles can be found here:
     * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
     */
    async createAndRunPoll(body, options) {
        const run = await this.createAndRun(body, options);
        return await this.runs.poll(run.thread_id, run.id, options);
    }
    /**
     * Create a thread and stream the run back
     */
    createAndRunStream(body, options) {
        return AssistantStream.createThreadAssistantStream(body, this._client.beta.threads, options);
    }
}
Threads.Runs = Runs$1;
Threads.RunsPage = RunsPage;
Threads.Messages = Messages;
Threads.MessagesPage = MessagesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Beta extends APIResource {
    constructor() {
        super(...arguments);
        this.realtime = new Realtime(this._client);
        this.chat = new Chat(this._client);
        this.assistants = new Assistants(this._client);
        this.threads = new Threads(this._client);
    }
}
Beta.Realtime = Realtime;
Beta.Assistants = Assistants;
Beta.AssistantsPage = AssistantsPage;
Beta.Threads = Threads;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Completions extends APIResource {
    create(body, options) {
        return this._client.post('/completions', { body, ...options, stream: body.stream ?? false });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Content extends APIResource {
    /**
     * Retrieve Container File Content
     */
    retrieve(containerId, fileId, options) {
        return this._client.get(`/containers/${containerId}/files/${fileId}/content`, {
            ...options,
            headers: { Accept: 'application/binary', ...options?.headers },
            __binaryResponse: true,
        });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Files$2 = class Files extends APIResource {
    constructor() {
        super(...arguments);
        this.content = new Content(this._client);
    }
    /**
     * Create a Container File
     *
     * You can send either a multipart/form-data request with the raw file content, or
     * a JSON request with a file ID.
     */
    create(containerId, body, options) {
        return this._client.post(`/containers/${containerId}/files`, multipartFormRequestOptions({ body, ...options }));
    }
    /**
     * Retrieve Container File
     */
    retrieve(containerId, fileId, options) {
        return this._client.get(`/containers/${containerId}/files/${fileId}`, options);
    }
    list(containerId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(containerId, {}, query);
        }
        return this._client.getAPIList(`/containers/${containerId}/files`, FileListResponsesPage, {
            query,
            ...options,
        });
    }
    /**
     * Delete Container File
     */
    del(containerId, fileId, options) {
        return this._client.delete(`/containers/${containerId}/files/${fileId}`, {
            ...options,
            headers: { Accept: '*/*', ...options?.headers },
        });
    }
};
class FileListResponsesPage extends CursorPage {
}
Files$2.FileListResponsesPage = FileListResponsesPage;
Files$2.Content = Content;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Containers extends APIResource {
    constructor() {
        super(...arguments);
        this.files = new Files$2(this._client);
    }
    /**
     * Create Container
     */
    create(body, options) {
        return this._client.post('/containers', { body, ...options });
    }
    /**
     * Retrieve Container
     */
    retrieve(containerId, options) {
        return this._client.get(`/containers/${containerId}`, options);
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/containers', ContainerListResponsesPage, { query, ...options });
    }
    /**
     * Delete Container
     */
    del(containerId, options) {
        return this._client.delete(`/containers/${containerId}`, {
            ...options,
            headers: { Accept: '*/*', ...options?.headers },
        });
    }
}
class ContainerListResponsesPage extends CursorPage {
}
Containers.ContainerListResponsesPage = ContainerListResponsesPage;
Containers.Files = Files$2;
Containers.FileListResponsesPage = FileListResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Embeddings extends APIResource {
    /**
     * Creates an embedding vector representing the input text.
     *
     * @example
     * ```ts
     * const createEmbeddingResponse =
     *   await client.embeddings.create({
     *     input: 'The quick brown fox jumped over the lazy dog',
     *     model: 'text-embedding-3-small',
     *   });
     * ```
     */
    create(body, options) {
        const hasUserProvidedEncodingFormat = !!body.encoding_format;
        // No encoding_format specified, defaulting to base64 for performance reasons
        // See https://github.com/openai/openai-node/pull/1312
        let encoding_format = hasUserProvidedEncodingFormat ? body.encoding_format : 'base64';
        if (hasUserProvidedEncodingFormat) {
            debug('Request', 'User defined encoding_format:', body.encoding_format);
        }
        const response = this._client.post('/embeddings', {
            body: {
                ...body,
                encoding_format: encoding_format,
            },
            ...options,
        });
        // if the user specified an encoding_format, return the response as-is
        if (hasUserProvidedEncodingFormat) {
            return response;
        }
        // in this stage, we are sure the user did not specify an encoding_format
        // and we defaulted to base64 for performance reasons
        // we are sure then that the response is base64 encoded, let's decode it
        // the returned result will be a float32 array since this is OpenAI API's default encoding
        debug('response', 'Decoding base64 embeddings to float32 array');
        return response._thenUnwrap((response) => {
            if (response && response.data) {
                response.data.forEach((embeddingBase64Obj) => {
                    const embeddingBase64Str = embeddingBase64Obj.embedding;
                    embeddingBase64Obj.embedding = toFloat32Array(embeddingBase64Str);
                });
            }
            return response;
        });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class OutputItems extends APIResource {
    /**
     * Get an evaluation run output item by ID.
     */
    retrieve(evalId, runId, outputItemId, options) {
        return this._client.get(`/evals/${evalId}/runs/${runId}/output_items/${outputItemId}`, options);
    }
    list(evalId, runId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(evalId, runId, {}, query);
        }
        return this._client.getAPIList(`/evals/${evalId}/runs/${runId}/output_items`, OutputItemListResponsesPage, { query, ...options });
    }
}
class OutputItemListResponsesPage extends CursorPage {
}
OutputItems.OutputItemListResponsesPage = OutputItemListResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Runs extends APIResource {
    constructor() {
        super(...arguments);
        this.outputItems = new OutputItems(this._client);
    }
    /**
     * Kicks off a new run for a given evaluation, specifying the data source, and what
     * model configuration to use to test. The datasource will be validated against the
     * schema specified in the config of the evaluation.
     */
    create(evalId, body, options) {
        return this._client.post(`/evals/${evalId}/runs`, { body, ...options });
    }
    /**
     * Get an evaluation run by ID.
     */
    retrieve(evalId, runId, options) {
        return this._client.get(`/evals/${evalId}/runs/${runId}`, options);
    }
    list(evalId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(evalId, {}, query);
        }
        return this._client.getAPIList(`/evals/${evalId}/runs`, RunListResponsesPage, { query, ...options });
    }
    /**
     * Delete an eval run.
     */
    del(evalId, runId, options) {
        return this._client.delete(`/evals/${evalId}/runs/${runId}`, options);
    }
    /**
     * Cancel an ongoing evaluation run.
     */
    cancel(evalId, runId, options) {
        return this._client.post(`/evals/${evalId}/runs/${runId}`, options);
    }
}
class RunListResponsesPage extends CursorPage {
}
Runs.RunListResponsesPage = RunListResponsesPage;
Runs.OutputItems = OutputItems;
Runs.OutputItemListResponsesPage = OutputItemListResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Evals extends APIResource {
    constructor() {
        super(...arguments);
        this.runs = new Runs(this._client);
    }
    /**
     * Create the structure of an evaluation that can be used to test a model's
     * performance. An evaluation is a set of testing criteria and the config for a
     * data source, which dictates the schema of the data used in the evaluation. After
     * creating an evaluation, you can run it on different models and model parameters.
     * We support several types of graders and datasources. For more information, see
     * the [Evals guide](https://platform.openai.com/docs/guides/evals).
     */
    create(body, options) {
        return this._client.post('/evals', { body, ...options });
    }
    /**
     * Get an evaluation by ID.
     */
    retrieve(evalId, options) {
        return this._client.get(`/evals/${evalId}`, options);
    }
    /**
     * Update certain properties of an evaluation.
     */
    update(evalId, body, options) {
        return this._client.post(`/evals/${evalId}`, { body, ...options });
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/evals', EvalListResponsesPage, { query, ...options });
    }
    /**
     * Delete an evaluation.
     */
    del(evalId, options) {
        return this._client.delete(`/evals/${evalId}`, options);
    }
}
class EvalListResponsesPage extends CursorPage {
}
Evals.EvalListResponsesPage = EvalListResponsesPage;
Evals.Runs = Runs;
Evals.RunListResponsesPage = RunListResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Files$1 = class Files extends APIResource {
    /**
     * Upload a file that can be used across various endpoints. Individual files can be
     * up to 512 MB, and the size of all files uploaded by one organization can be up
     * to 100 GB.
     *
     * The Assistants API supports files up to 2 million tokens and of specific file
     * types. See the
     * [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools) for
     * details.
     *
     * The Fine-tuning API only supports `.jsonl` files. The input also has certain
     * required formats for fine-tuning
     * [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input) or
     * [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
     * models.
     *
     * The Batch API only supports `.jsonl` files up to 200 MB in size. The input also
     * has a specific required
     * [format](https://platform.openai.com/docs/api-reference/batch/request-input).
     *
     * Please [contact us](https://help.openai.com/) if you need to increase these
     * storage limits.
     */
    create(body, options) {
        return this._client.post('/files', multipartFormRequestOptions({ body, ...options }));
    }
    /**
     * Returns information about a specific file.
     */
    retrieve(fileId, options) {
        return this._client.get(`/files/${fileId}`, options);
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/files', FileObjectsPage, { query, ...options });
    }
    /**
     * Delete a file.
     */
    del(fileId, options) {
        return this._client.delete(`/files/${fileId}`, options);
    }
    /**
     * Returns the contents of the specified file.
     */
    content(fileId, options) {
        return this._client.get(`/files/${fileId}/content`, {
            ...options,
            headers: { Accept: 'application/binary', ...options?.headers },
            __binaryResponse: true,
        });
    }
    /**
     * Returns the contents of the specified file.
     *
     * @deprecated The `.content()` method should be used instead
     */
    retrieveContent(fileId, options) {
        return this._client.get(`/files/${fileId}/content`, options);
    }
    /**
     * Waits for the given file to be processed, default timeout is 30 mins.
     */
    async waitForProcessing(id, { pollInterval = 5000, maxWait = 30 * 60 * 1000 } = {}) {
        const TERMINAL_STATES = new Set(['processed', 'error', 'deleted']);
        const start = Date.now();
        let file = await this.retrieve(id);
        while (!file.status || !TERMINAL_STATES.has(file.status)) {
            await sleep(pollInterval);
            file = await this.retrieve(id);
            if (Date.now() - start > maxWait) {
                throw new APIConnectionTimeoutError({
                    message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`,
                });
            }
        }
        return file;
    }
};
class FileObjectsPage extends CursorPage {
}
Files$1.FileObjectsPage = FileObjectsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Methods extends APIResource {
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Graders$1 = class Graders extends APIResource {
    /**
     * Run a grader.
     *
     * @example
     * ```ts
     * const response = await client.fineTuning.alpha.graders.run({
     *   grader: {
     *     input: 'input',
     *     name: 'name',
     *     operation: 'eq',
     *     reference: 'reference',
     *     type: 'string_check',
     *   },
     *   model_sample: 'model_sample',
     *   reference_answer: 'string',
     * });
     * ```
     */
    run(body, options) {
        return this._client.post('/fine_tuning/alpha/graders/run', { body, ...options });
    }
    /**
     * Validate a grader.
     *
     * @example
     * ```ts
     * const response =
     *   await client.fineTuning.alpha.graders.validate({
     *     grader: {
     *       input: 'input',
     *       name: 'name',
     *       operation: 'eq',
     *       reference: 'reference',
     *       type: 'string_check',
     *     },
     *   });
     * ```
     */
    validate(body, options) {
        return this._client.post('/fine_tuning/alpha/graders/validate', { body, ...options });
    }
};

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Alpha extends APIResource {
    constructor() {
        super(...arguments);
        this.graders = new Graders$1(this._client);
    }
}
Alpha.Graders = Graders$1;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Permissions extends APIResource {
    /**
     * **NOTE:** Calling this endpoint requires an [admin API key](../admin-api-keys).
     *
     * This enables organization owners to share fine-tuned models with other projects
     * in their organization.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const permissionCreateResponse of client.fineTuning.checkpoints.permissions.create(
     *   'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
     *   { project_ids: ['string'] },
     * )) {
     *   // ...
     * }
     * ```
     */
    create(fineTunedModelCheckpoint, body, options) {
        return this._client.getAPIList(`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, PermissionCreateResponsesPage, { body, method: 'post', ...options });
    }
    retrieve(fineTunedModelCheckpoint, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.retrieve(fineTunedModelCheckpoint, {}, query);
        }
        return this._client.get(`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, {
            query,
            ...options,
        });
    }
    /**
     * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
     *
     * Organization owners can use this endpoint to delete a permission for a
     * fine-tuned model checkpoint.
     *
     * @example
     * ```ts
     * const permission =
     *   await client.fineTuning.checkpoints.permissions.del(
     *     'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
     *     'cp_zc4Q7MP6XxulcVzj4MZdwsAB',
     *   );
     * ```
     */
    del(fineTunedModelCheckpoint, permissionId, options) {
        return this._client.delete(`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions/${permissionId}`, options);
    }
}
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
class PermissionCreateResponsesPage extends Page {
}
Permissions.PermissionCreateResponsesPage = PermissionCreateResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
let Checkpoints$1 = class Checkpoints extends APIResource {
    constructor() {
        super(...arguments);
        this.permissions = new Permissions(this._client);
    }
};
Checkpoints$1.Permissions = Permissions;
Checkpoints$1.PermissionCreateResponsesPage = PermissionCreateResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Checkpoints extends APIResource {
    list(fineTuningJobId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(fineTuningJobId, {}, query);
        }
        return this._client.getAPIList(`/fine_tuning/jobs/${fineTuningJobId}/checkpoints`, FineTuningJobCheckpointsPage, { query, ...options });
    }
}
class FineTuningJobCheckpointsPage extends CursorPage {
}
Checkpoints.FineTuningJobCheckpointsPage = FineTuningJobCheckpointsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Jobs extends APIResource {
    constructor() {
        super(...arguments);
        this.checkpoints = new Checkpoints(this._client);
    }
    /**
     * Creates a fine-tuning job which begins the process of creating a new model from
     * a given dataset.
     *
     * Response includes details of the enqueued job including job status and the name
     * of the fine-tuned models once complete.
     *
     * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/fine-tuning)
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.create({
     *   model: 'gpt-4o-mini',
     *   training_file: 'file-abc123',
     * });
     * ```
     */
    create(body, options) {
        return this._client.post('/fine_tuning/jobs', { body, ...options });
    }
    /**
     * Get info about a fine-tuning job.
     *
     * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/fine-tuning)
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.retrieve(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    retrieve(fineTuningJobId, options) {
        return this._client.get(`/fine_tuning/jobs/${fineTuningJobId}`, options);
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/fine_tuning/jobs', FineTuningJobsPage, { query, ...options });
    }
    /**
     * Immediately cancel a fine-tune job.
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.cancel(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    cancel(fineTuningJobId, options) {
        return this._client.post(`/fine_tuning/jobs/${fineTuningJobId}/cancel`, options);
    }
    listEvents(fineTuningJobId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.listEvents(fineTuningJobId, {}, query);
        }
        return this._client.getAPIList(`/fine_tuning/jobs/${fineTuningJobId}/events`, FineTuningJobEventsPage, {
            query,
            ...options,
        });
    }
    /**
     * Pause a fine-tune job.
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.pause(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    pause(fineTuningJobId, options) {
        return this._client.post(`/fine_tuning/jobs/${fineTuningJobId}/pause`, options);
    }
    /**
     * Resume a fine-tune job.
     *
     * @example
     * ```ts
     * const fineTuningJob = await client.fineTuning.jobs.resume(
     *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
     * );
     * ```
     */
    resume(fineTuningJobId, options) {
        return this._client.post(`/fine_tuning/jobs/${fineTuningJobId}/resume`, options);
    }
}
class FineTuningJobsPage extends CursorPage {
}
class FineTuningJobEventsPage extends CursorPage {
}
Jobs.FineTuningJobsPage = FineTuningJobsPage;
Jobs.FineTuningJobEventsPage = FineTuningJobEventsPage;
Jobs.Checkpoints = Checkpoints;
Jobs.FineTuningJobCheckpointsPage = FineTuningJobCheckpointsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class FineTuning extends APIResource {
    constructor() {
        super(...arguments);
        this.methods = new Methods(this._client);
        this.jobs = new Jobs(this._client);
        this.checkpoints = new Checkpoints$1(this._client);
        this.alpha = new Alpha(this._client);
    }
}
FineTuning.Methods = Methods;
FineTuning.Jobs = Jobs;
FineTuning.FineTuningJobsPage = FineTuningJobsPage;
FineTuning.FineTuningJobEventsPage = FineTuningJobEventsPage;
FineTuning.Checkpoints = Checkpoints$1;
FineTuning.Alpha = Alpha;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class GraderModels extends APIResource {
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Graders extends APIResource {
    constructor() {
        super(...arguments);
        this.graderModels = new GraderModels(this._client);
    }
}
Graders.GraderModels = GraderModels;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Images extends APIResource {
    /**
     * Creates a variation of a given image. This endpoint only supports `dall-e-2`.
     *
     * @example
     * ```ts
     * const imagesResponse = await client.images.createVariation({
     *   image: fs.createReadStream('otter.png'),
     * });
     * ```
     */
    createVariation(body, options) {
        return this._client.post('/images/variations', multipartFormRequestOptions({ body, ...options }));
    }
    /**
     * Creates an edited or extended image given one or more source images and a
     * prompt. This endpoint only supports `gpt-image-1` and `dall-e-2`.
     *
     * @example
     * ```ts
     * const imagesResponse = await client.images.edit({
     *   image: fs.createReadStream('path/to/file'),
     *   prompt: 'A cute baby sea otter wearing a beret',
     * });
     * ```
     */
    edit(body, options) {
        return this._client.post('/images/edits', multipartFormRequestOptions({ body, ...options }));
    }
    /**
     * Creates an image given a prompt.
     * [Learn more](https://platform.openai.com/docs/guides/images).
     *
     * @example
     * ```ts
     * const imagesResponse = await client.images.generate({
     *   prompt: 'A cute baby sea otter',
     * });
     * ```
     */
    generate(body, options) {
        return this._client.post('/images/generations', { body, ...options });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Models extends APIResource {
    /**
     * Retrieves a model instance, providing basic information about the model such as
     * the owner and permissioning.
     */
    retrieve(model, options) {
        return this._client.get(`/models/${model}`, options);
    }
    /**
     * Lists the currently available models, and provides basic information about each
     * one such as the owner and availability.
     */
    list(options) {
        return this._client.getAPIList('/models', ModelsPage, options);
    }
    /**
     * Delete a fine-tuned model. You must have the Owner role in your organization to
     * delete a model.
     */
    del(model, options) {
        return this._client.delete(`/models/${model}`, options);
    }
}
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
class ModelsPage extends Page {
}
Models.ModelsPage = ModelsPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Moderations extends APIResource {
    /**
     * Classifies if text and/or image inputs are potentially harmful. Learn more in
     * the [moderation guide](https://platform.openai.com/docs/guides/moderation).
     */
    create(body, options) {
        return this._client.post('/moderations', { body, ...options });
    }
}

function maybeParseResponse(response, params) {
    if (!params || !hasAutoParseableInput(params)) {
        return {
            ...response,
            output_parsed: null,
            output: response.output.map((item) => {
                if (item.type === 'function_call') {
                    return {
                        ...item,
                        parsed_arguments: null,
                    };
                }
                if (item.type === 'message') {
                    return {
                        ...item,
                        content: item.content.map((content) => ({
                            ...content,
                            parsed: null,
                        })),
                    };
                }
                else {
                    return item;
                }
            }),
        };
    }
    return parseResponse(response, params);
}
function parseResponse(response, params) {
    const output = response.output.map((item) => {
        if (item.type === 'function_call') {
            return {
                ...item,
                parsed_arguments: parseToolCall(params, item),
            };
        }
        if (item.type === 'message') {
            const content = item.content.map((content) => {
                if (content.type === 'output_text') {
                    return {
                        ...content,
                        parsed: parseTextFormat(params, content.text),
                    };
                }
                return content;
            });
            return {
                ...item,
                content,
            };
        }
        return item;
    });
    const parsed = Object.assign({}, response, { output });
    if (!Object.getOwnPropertyDescriptor(response, 'output_text')) {
        addOutputText(parsed);
    }
    Object.defineProperty(parsed, 'output_parsed', {
        enumerable: true,
        get() {
            for (const output of parsed.output) {
                if (output.type !== 'message') {
                    continue;
                }
                for (const content of output.content) {
                    if (content.type === 'output_text' && content.parsed !== null) {
                        return content.parsed;
                    }
                }
            }
            return null;
        },
    });
    return parsed;
}
function parseTextFormat(params, content) {
    if (params.text?.format?.type !== 'json_schema') {
        return null;
    }
    if ('$parseRaw' in params.text?.format) {
        const text_format = params.text?.format;
        return text_format.$parseRaw(content);
    }
    return JSON.parse(content);
}
function hasAutoParseableInput(params) {
    if (isAutoParsableResponseFormat(params.text?.format)) {
        return true;
    }
    return false;
}
function isAutoParsableTool(tool) {
    return tool?.['$brand'] === 'auto-parseable-tool';
}
function getInputToolByName(input_tools, name) {
    return input_tools.find((tool) => tool.type === 'function' && tool.name === name);
}
function parseToolCall(params, toolCall) {
    const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
    return {
        ...toolCall,
        ...toolCall,
        parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCall.arguments)
            : inputTool?.strict ? JSON.parse(toolCall.arguments)
                : null,
    };
}
function addOutputText(rsp) {
    const texts = [];
    for (const output of rsp.output) {
        if (output.type !== 'message') {
            continue;
        }
        for (const content of output.content) {
            if (content.type === 'output_text') {
                texts.push(content.text);
            }
        }
    }
    rsp.output_text = texts.join('');
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class InputItems extends APIResource {
    list(responseId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(responseId, {}, query);
        }
        return this._client.getAPIList(`/responses/${responseId}/input_items`, ResponseItemsPage, {
            query,
            ...options,
        });
    }
}

var __classPrivateFieldSet = (undefined && undefined.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (undefined && undefined.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _ResponseStream_instances, _ResponseStream_params, _ResponseStream_currentResponseSnapshot, _ResponseStream_finalResponse, _ResponseStream_beginRequest, _ResponseStream_addEvent, _ResponseStream_endRequest, _ResponseStream_accumulateResponse;
class ResponseStream extends EventStream {
    constructor(params) {
        super();
        _ResponseStream_instances.add(this);
        _ResponseStream_params.set(this, void 0);
        _ResponseStream_currentResponseSnapshot.set(this, void 0);
        _ResponseStream_finalResponse.set(this, void 0);
        __classPrivateFieldSet(this, _ResponseStream_params, params, "f");
    }
    static createResponse(client, params, options) {
        const runner = new ResponseStream(params);
        runner._run(() => runner._createOrRetrieveResponse(client, params, {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'stream' },
        }));
        return runner;
    }
    async _createOrRetrieveResponse(client, params, options) {
        const signal = options?.signal;
        if (signal) {
            if (signal.aborted)
                this.controller.abort();
            signal.addEventListener('abort', () => this.controller.abort());
        }
        __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_beginRequest).call(this);
        let stream;
        let starting_after = null;
        if ('response_id' in params) {
            stream = await client.responses.retrieve(params.response_id, { stream: true }, { ...options, signal: this.controller.signal, stream: true });
            starting_after = params.starting_after ?? null;
        }
        else {
            stream = await client.responses.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
        }
        this._connected();
        for await (const event of stream) {
            __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_addEvent).call(this, event, starting_after);
        }
        if (stream.controller.signal?.aborted) {
            throw new APIUserAbortError();
        }
        return __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_endRequest).call(this);
    }
    [(_ResponseStream_params = new WeakMap(), _ResponseStream_currentResponseSnapshot = new WeakMap(), _ResponseStream_finalResponse = new WeakMap(), _ResponseStream_instances = new WeakSet(), _ResponseStream_beginRequest = function _ResponseStream_beginRequest() {
        if (this.ended)
            return;
        __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, undefined, "f");
    }, _ResponseStream_addEvent = function _ResponseStream_addEvent(event, starting_after) {
        if (this.ended)
            return;
        const maybeEmit = (name, event) => {
            if (starting_after == null || event.sequence_number > starting_after) {
                this._emit(name, event);
            }
        };
        const response = __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_accumulateResponse).call(this, event);
        maybeEmit('event', event);
        switch (event.type) {
            case 'response.output_text.delta': {
                const output = response.output[event.output_index];
                if (!output) {
                    throw new OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'message') {
                    const content = output.content[event.content_index];
                    if (!content) {
                        throw new OpenAIError(`missing content at index ${event.content_index}`);
                    }
                    if (content.type !== 'output_text') {
                        throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
                    }
                    maybeEmit('response.output_text.delta', {
                        ...event,
                        snapshot: content.text,
                    });
                }
                break;
            }
            case 'response.function_call_arguments.delta': {
                const output = response.output[event.output_index];
                if (!output) {
                    throw new OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'function_call') {
                    maybeEmit('response.function_call_arguments.delta', {
                        ...event,
                        snapshot: output.arguments,
                    });
                }
                break;
            }
            default:
                maybeEmit(event.type, event);
                break;
        }
    }, _ResponseStream_endRequest = function _ResponseStream_endRequest() {
        if (this.ended) {
            throw new OpenAIError(`stream has ended, this shouldn't happen`);
        }
        const snapshot = __classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
        if (!snapshot) {
            throw new OpenAIError(`request ended without sending any events`);
        }
        __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, undefined, "f");
        const parsedResponse = finalizeResponse(snapshot, __classPrivateFieldGet(this, _ResponseStream_params, "f"));
        __classPrivateFieldSet(this, _ResponseStream_finalResponse, parsedResponse, "f");
        return parsedResponse;
    }, _ResponseStream_accumulateResponse = function _ResponseStream_accumulateResponse(event) {
        let snapshot = __classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
        if (!snapshot) {
            if (event.type !== 'response.created') {
                throw new OpenAIError(`When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`);
            }
            snapshot = __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
            return snapshot;
        }
        switch (event.type) {
            case 'response.output_item.added': {
                snapshot.output.push(event.item);
                break;
            }
            case 'response.content_part.added': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'message') {
                    output.content.push(event.part);
                }
                break;
            }
            case 'response.output_text.delta': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'message') {
                    const content = output.content[event.content_index];
                    if (!content) {
                        throw new OpenAIError(`missing content at index ${event.content_index}`);
                    }
                    if (content.type !== 'output_text') {
                        throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
                    }
                    content.text += event.delta;
                }
                break;
            }
            case 'response.function_call_arguments.delta': {
                const output = snapshot.output[event.output_index];
                if (!output) {
                    throw new OpenAIError(`missing output at index ${event.output_index}`);
                }
                if (output.type === 'function_call') {
                    output.arguments += event.delta;
                }
                break;
            }
            case 'response.completed': {
                __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
                break;
            }
        }
        return snapshot;
    }, Symbol.asyncIterator)]() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        this.on('event', (event) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(event);
            }
            else {
                pushQueue.push(event);
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        return {
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((event) => (event ? { value: event, done: false } : { value: undefined, done: true }));
                }
                const event = pushQueue.shift();
                return { value: event, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        };
    }
    /**
     * @returns a promise that resolves with the final Response, or rejects
     * if an error occurred or the stream ended prematurely without producing a REsponse.
     */
    async finalResponse() {
        await this.done();
        const response = __classPrivateFieldGet(this, _ResponseStream_finalResponse, "f");
        if (!response)
            throw new OpenAIError('stream ended without producing a ChatCompletion');
        return response;
    }
}
function finalizeResponse(snapshot, params) {
    return maybeParseResponse(snapshot, params);
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Responses extends APIResource {
    constructor() {
        super(...arguments);
        this.inputItems = new InputItems(this._client);
    }
    create(body, options) {
        return this._client.post('/responses', { body, ...options, stream: body.stream ?? false })._thenUnwrap((rsp) => {
            if ('object' in rsp && rsp.object === 'response') {
                addOutputText(rsp);
            }
            return rsp;
        });
    }
    retrieve(responseId, query = {}, options) {
        return this._client.get(`/responses/${responseId}`, {
            query,
            ...options,
            stream: query?.stream ?? false,
        });
    }
    /**
     * Deletes a model response with the given ID.
     *
     * @example
     * ```ts
     * await client.responses.del(
     *   'resp_677efb5139a88190b512bc3fef8e535d',
     * );
     * ```
     */
    del(responseId, options) {
        return this._client.delete(`/responses/${responseId}`, {
            ...options,
            headers: { Accept: '*/*', ...options?.headers },
        });
    }
    parse(body, options) {
        return this._client.responses
            .create(body, options)
            ._thenUnwrap((response) => parseResponse(response, body));
    }
    /**
     * Creates a model response stream
     */
    stream(body, options) {
        return ResponseStream.createResponse(this._client, body, options);
    }
    /**
     * Cancels a model response with the given ID. Only responses created with the
     * `background` parameter set to `true` can be cancelled.
     * [Learn more](https://platform.openai.com/docs/guides/background).
     *
     * @example
     * ```ts
     * await client.responses.cancel(
     *   'resp_677efb5139a88190b512bc3fef8e535d',
     * );
     * ```
     */
    cancel(responseId, options) {
        return this._client.post(`/responses/${responseId}/cancel`, {
            ...options,
            headers: { Accept: '*/*', ...options?.headers },
        });
    }
}
class ResponseItemsPage extends CursorPage {
}
Responses.InputItems = InputItems;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Parts extends APIResource {
    /**
     * Adds a
     * [Part](https://platform.openai.com/docs/api-reference/uploads/part-object) to an
     * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object.
     * A Part represents a chunk of bytes from the file you are trying to upload.
     *
     * Each Part can be at most 64 MB, and you can add Parts until you hit the Upload
     * maximum of 8 GB.
     *
     * It is possible to add multiple Parts in parallel. You can decide the intended
     * order of the Parts when you
     * [complete the Upload](https://platform.openai.com/docs/api-reference/uploads/complete).
     */
    create(uploadId, body, options) {
        return this._client.post(`/uploads/${uploadId}/parts`, multipartFormRequestOptions({ body, ...options }));
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Uploads extends APIResource {
    constructor() {
        super(...arguments);
        this.parts = new Parts(this._client);
    }
    /**
     * Creates an intermediate
     * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object
     * that you can add
     * [Parts](https://platform.openai.com/docs/api-reference/uploads/part-object) to.
     * Currently, an Upload can accept at most 8 GB in total and expires after an hour
     * after you create it.
     *
     * Once you complete the Upload, we will create a
     * [File](https://platform.openai.com/docs/api-reference/files/object) object that
     * contains all the parts you uploaded. This File is usable in the rest of our
     * platform as a regular File object.
     *
     * For certain `purpose` values, the correct `mime_type` must be specified. Please
     * refer to documentation for the
     * [supported MIME types for your use case](https://platform.openai.com/docs/assistants/tools/file-search#supported-files).
     *
     * For guidance on the proper filename extensions for each purpose, please follow
     * the documentation on
     * [creating a File](https://platform.openai.com/docs/api-reference/files/create).
     */
    create(body, options) {
        return this._client.post('/uploads', { body, ...options });
    }
    /**
     * Cancels the Upload. No Parts may be added after an Upload is cancelled.
     */
    cancel(uploadId, options) {
        return this._client.post(`/uploads/${uploadId}/cancel`, options);
    }
    /**
     * Completes the
     * [Upload](https://platform.openai.com/docs/api-reference/uploads/object).
     *
     * Within the returned Upload object, there is a nested
     * [File](https://platform.openai.com/docs/api-reference/files/object) object that
     * is ready to use in the rest of the platform.
     *
     * You can specify the order of the Parts by passing in an ordered list of the Part
     * IDs.
     *
     * The number of bytes uploaded upon completion must match the number of bytes
     * initially specified when creating the Upload object. No Parts may be added after
     * an Upload is completed.
     */
    complete(uploadId, body, options) {
        return this._client.post(`/uploads/${uploadId}/complete`, { body, ...options });
    }
}
Uploads.Parts = Parts;

/**
 * Like `Promise.allSettled()` but throws an error if any promises are rejected.
 */
const allSettledWithThrow = async (promises) => {
    const results = await Promise.allSettled(promises);
    const rejected = results.filter((result) => result.status === 'rejected');
    if (rejected.length) {
        for (const result of rejected) {
            console.error(result.reason);
        }
        throw new Error(`${rejected.length} promise(s) failed - see the above errors`);
    }
    // Note: TS was complaining about using `.filter().map()` here for some reason
    const values = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            values.push(result.value);
        }
    }
    return values;
};

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class Files extends APIResource {
    /**
     * Create a vector store file by attaching a
     * [File](https://platform.openai.com/docs/api-reference/files) to a
     * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object).
     */
    create(vectorStoreId, body, options) {
        return this._client.post(`/vector_stores/${vectorStoreId}/files`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Retrieves a vector store file.
     */
    retrieve(vectorStoreId, fileId, options) {
        return this._client.get(`/vector_stores/${vectorStoreId}/files/${fileId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Update attributes on a vector store file.
     */
    update(vectorStoreId, fileId, body, options) {
        return this._client.post(`/vector_stores/${vectorStoreId}/files/${fileId}`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    list(vectorStoreId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list(vectorStoreId, {}, query);
        }
        return this._client.getAPIList(`/vector_stores/${vectorStoreId}/files`, VectorStoreFilesPage, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Delete a vector store file. This will remove the file from the vector store but
     * the file itself will not be deleted. To delete the file, use the
     * [delete file](https://platform.openai.com/docs/api-reference/files/delete)
     * endpoint.
     */
    del(vectorStoreId, fileId, options) {
        return this._client.delete(`/vector_stores/${vectorStoreId}/files/${fileId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Attach a file to the given vector store and wait for it to be processed.
     */
    async createAndPoll(vectorStoreId, body, options) {
        const file = await this.create(vectorStoreId, body, options);
        return await this.poll(vectorStoreId, file.id, options);
    }
    /**
     * Wait for the vector store file to finish processing.
     *
     * Note: this will return even if the file failed to process, you need to check
     * file.last_error and file.status to handle these cases
     */
    async poll(vectorStoreId, fileId, options) {
        const headers = { ...options?.headers, 'X-Stainless-Poll-Helper': 'true' };
        if (options?.pollIntervalMs) {
            headers['X-Stainless-Custom-Poll-Interval'] = options.pollIntervalMs.toString();
        }
        while (true) {
            const fileResponse = await this.retrieve(vectorStoreId, fileId, {
                ...options,
                headers,
            }).withResponse();
            const file = fileResponse.data;
            switch (file.status) {
                case 'in_progress':
                    let sleepInterval = 5000;
                    if (options?.pollIntervalMs) {
                        sleepInterval = options.pollIntervalMs;
                    }
                    else {
                        const headerInterval = fileResponse.response.headers.get('openai-poll-after-ms');
                        if (headerInterval) {
                            const headerIntervalMs = parseInt(headerInterval);
                            if (!isNaN(headerIntervalMs)) {
                                sleepInterval = headerIntervalMs;
                            }
                        }
                    }
                    await sleep(sleepInterval);
                    break;
                case 'failed':
                case 'completed':
                    return file;
            }
        }
    }
    /**
     * Upload a file to the `files` API and then attach it to the given vector store.
     *
     * Note the file will be asynchronously processed (you can use the alternative
     * polling helper method to wait for processing to complete).
     */
    async upload(vectorStoreId, file, options) {
        const fileInfo = await this._client.files.create({ file: file, purpose: 'assistants' }, options);
        return this.create(vectorStoreId, { file_id: fileInfo.id }, options);
    }
    /**
     * Add a file to a vector store and poll until processing is complete.
     */
    async uploadAndPoll(vectorStoreId, file, options) {
        const fileInfo = await this.upload(vectorStoreId, file, options);
        return await this.poll(vectorStoreId, fileInfo.id, options);
    }
    /**
     * Retrieve the parsed contents of a vector store file.
     */
    content(vectorStoreId, fileId, options) {
        return this._client.getAPIList(`/vector_stores/${vectorStoreId}/files/${fileId}/content`, FileContentResponsesPage, { ...options, headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers } });
    }
}
class VectorStoreFilesPage extends CursorPage {
}
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
class FileContentResponsesPage extends Page {
}
Files.VectorStoreFilesPage = VectorStoreFilesPage;
Files.FileContentResponsesPage = FileContentResponsesPage;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class FileBatches extends APIResource {
    /**
     * Create a vector store file batch.
     */
    create(vectorStoreId, body, options) {
        return this._client.post(`/vector_stores/${vectorStoreId}/file_batches`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Retrieves a vector store file batch.
     */
    retrieve(vectorStoreId, batchId, options) {
        return this._client.get(`/vector_stores/${vectorStoreId}/file_batches/${batchId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Cancel a vector store file batch. This attempts to cancel the processing of
     * files in this batch as soon as possible.
     */
    cancel(vectorStoreId, batchId, options) {
        return this._client.post(`/vector_stores/${vectorStoreId}/file_batches/${batchId}/cancel`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Create a vector store batch and poll until all files have been processed.
     */
    async createAndPoll(vectorStoreId, body, options) {
        const batch = await this.create(vectorStoreId, body);
        return await this.poll(vectorStoreId, batch.id, options);
    }
    listFiles(vectorStoreId, batchId, query = {}, options) {
        if (isRequestOptions(query)) {
            return this.listFiles(vectorStoreId, batchId, {}, query);
        }
        return this._client.getAPIList(`/vector_stores/${vectorStoreId}/file_batches/${batchId}/files`, VectorStoreFilesPage, { query, ...options, headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers } });
    }
    /**
     * Wait for the given file batch to be processed.
     *
     * Note: this will return even if one of the files failed to process, you need to
     * check batch.file_counts.failed_count to handle this case.
     */
    async poll(vectorStoreId, batchId, options) {
        const headers = { ...options?.headers, 'X-Stainless-Poll-Helper': 'true' };
        if (options?.pollIntervalMs) {
            headers['X-Stainless-Custom-Poll-Interval'] = options.pollIntervalMs.toString();
        }
        while (true) {
            const { data: batch, response } = await this.retrieve(vectorStoreId, batchId, {
                ...options,
                headers,
            }).withResponse();
            switch (batch.status) {
                case 'in_progress':
                    let sleepInterval = 5000;
                    if (options?.pollIntervalMs) {
                        sleepInterval = options.pollIntervalMs;
                    }
                    else {
                        const headerInterval = response.headers.get('openai-poll-after-ms');
                        if (headerInterval) {
                            const headerIntervalMs = parseInt(headerInterval);
                            if (!isNaN(headerIntervalMs)) {
                                sleepInterval = headerIntervalMs;
                            }
                        }
                    }
                    await sleep(sleepInterval);
                    break;
                case 'failed':
                case 'cancelled':
                case 'completed':
                    return batch;
            }
        }
    }
    /**
     * Uploads the given files concurrently and then creates a vector store file batch.
     *
     * The concurrency limit is configurable using the `maxConcurrency` parameter.
     */
    async uploadAndPoll(vectorStoreId, { files, fileIds = [] }, options) {
        if (files == null || files.length == 0) {
            throw new Error(`No \`files\` provided to process. If you've already uploaded files you should use \`.createAndPoll()\` instead`);
        }
        const configuredConcurrency = options?.maxConcurrency ?? 5;
        // We cap the number of workers at the number of files (so we don't start any unnecessary workers)
        const concurrencyLimit = Math.min(configuredConcurrency, files.length);
        const client = this._client;
        const fileIterator = files.values();
        const allFileIds = [...fileIds];
        // This code is based on this design. The libraries don't accommodate our environment limits.
        // https://stackoverflow.com/questions/40639432/what-is-the-best-way-to-limit-concurrency-when-using-es6s-promise-all
        async function processFiles(iterator) {
            for (let item of iterator) {
                const fileObj = await client.files.create({ file: item, purpose: 'assistants' }, options);
                allFileIds.push(fileObj.id);
            }
        }
        // Start workers to process results
        const workers = Array(concurrencyLimit).fill(fileIterator).map(processFiles);
        // Wait for all processing to complete.
        await allSettledWithThrow(workers);
        return await this.createAndPoll(vectorStoreId, {
            file_ids: allFileIds,
        });
    }
}

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
class VectorStores extends APIResource {
    constructor() {
        super(...arguments);
        this.files = new Files(this._client);
        this.fileBatches = new FileBatches(this._client);
    }
    /**
     * Create a vector store.
     */
    create(body, options) {
        return this._client.post('/vector_stores', {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Retrieves a vector store.
     */
    retrieve(vectorStoreId, options) {
        return this._client.get(`/vector_stores/${vectorStoreId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Modifies a vector store.
     */
    update(vectorStoreId, body, options) {
        return this._client.post(`/vector_stores/${vectorStoreId}`, {
            body,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    list(query = {}, options) {
        if (isRequestOptions(query)) {
            return this.list({}, query);
        }
        return this._client.getAPIList('/vector_stores', VectorStoresPage, {
            query,
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Delete a vector store.
     */
    del(vectorStoreId, options) {
        return this._client.delete(`/vector_stores/${vectorStoreId}`, {
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
    /**
     * Search a vector store for relevant chunks based on a query and file attributes
     * filter.
     */
    search(vectorStoreId, body, options) {
        return this._client.getAPIList(`/vector_stores/${vectorStoreId}/search`, VectorStoreSearchResponsesPage, {
            body,
            method: 'post',
            ...options,
            headers: { 'OpenAI-Beta': 'assistants=v2', ...options?.headers },
        });
    }
}
class VectorStoresPage extends CursorPage {
}
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
class VectorStoreSearchResponsesPage extends Page {
}
VectorStores.VectorStoresPage = VectorStoresPage;
VectorStores.VectorStoreSearchResponsesPage = VectorStoreSearchResponsesPage;
VectorStores.Files = Files;
VectorStores.VectorStoreFilesPage = VectorStoreFilesPage;
VectorStores.FileContentResponsesPage = FileContentResponsesPage;
VectorStores.FileBatches = FileBatches;

// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
var _a;
/**
 * API Client for interfacing with the OpenAI API.
 */
class OpenAI extends APIClient {
    /**
     * API Client for interfacing with the OpenAI API.
     *
     * @param {string | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? undefined]
     * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
     * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
     * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
     * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
     * @param {number} [opts.httpAgent] - An HTTP agent used to manage HTTP(s) connections.
     * @param {Core.Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
     * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
     * @param {Core.Headers} opts.defaultHeaders - Default headers to include with every request to the API.
     * @param {Core.DefaultQuery} opts.defaultQuery - Default query parameters to include with every request to the API.
     * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
     */
    constructor({ baseURL = readEnv('OPENAI_BASE_URL'), apiKey = readEnv('OPENAI_API_KEY'), organization = readEnv('OPENAI_ORG_ID') ?? null, project = readEnv('OPENAI_PROJECT_ID') ?? null, ...opts } = {}) {
        if (apiKey === undefined) {
            throw new OpenAIError("The OPENAI_API_KEY environment variable is missing or empty; either provide it, or instantiate the OpenAI client with an apiKey option, like new OpenAI({ apiKey: 'My API Key' }).");
        }
        const options = {
            apiKey,
            organization,
            project,
            ...opts,
            baseURL: baseURL || `https://api.openai.com/v1`,
        };
        if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
            throw new OpenAIError("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n");
        }
        super({
            baseURL: options.baseURL,
            timeout: options.timeout ?? 600000 /* 10 minutes */,
            httpAgent: options.httpAgent,
            maxRetries: options.maxRetries,
            fetch: options.fetch,
        });
        this.completions = new Completions(this);
        this.chat = new Chat$1(this);
        this.embeddings = new Embeddings(this);
        this.files = new Files$1(this);
        this.images = new Images(this);
        this.audio = new Audio$1(this);
        this.moderations = new Moderations(this);
        this.models = new Models(this);
        this.fineTuning = new FineTuning(this);
        this.graders = new Graders(this);
        this.vectorStores = new VectorStores(this);
        this.beta = new Beta(this);
        this.batches = new Batches(this);
        this.uploads = new Uploads(this);
        this.responses = new Responses(this);
        this.evals = new Evals(this);
        this.containers = new Containers(this);
        this._options = options;
        this.apiKey = apiKey;
        this.organization = organization;
        this.project = project;
    }
    defaultQuery() {
        return this._options.defaultQuery;
    }
    defaultHeaders(opts) {
        return {
            ...super.defaultHeaders(opts),
            'OpenAI-Organization': this.organization,
            'OpenAI-Project': this.project,
            ...this._options.defaultHeaders,
        };
    }
    authHeaders(opts) {
        return { Authorization: `Bearer ${this.apiKey}` };
    }
    stringifyQuery(query) {
        return stringify(query, { arrayFormat: 'brackets' });
    }
}
_a = OpenAI;
OpenAI.OpenAI = _a;
OpenAI.DEFAULT_TIMEOUT = 600000; // 10 minutes
OpenAI.OpenAIError = OpenAIError;
OpenAI.APIError = APIError;
OpenAI.APIConnectionError = APIConnectionError;
OpenAI.APIConnectionTimeoutError = APIConnectionTimeoutError;
OpenAI.APIUserAbortError = APIUserAbortError;
OpenAI.NotFoundError = NotFoundError;
OpenAI.ConflictError = ConflictError;
OpenAI.RateLimitError = RateLimitError;
OpenAI.BadRequestError = BadRequestError;
OpenAI.AuthenticationError = AuthenticationError;
OpenAI.InternalServerError = InternalServerError;
OpenAI.PermissionDeniedError = PermissionDeniedError;
OpenAI.UnprocessableEntityError = UnprocessableEntityError;
OpenAI.toFile = toFile;
OpenAI.fileFromPath = fileFromPath;
OpenAI.Completions = Completions;
OpenAI.Chat = Chat$1;
OpenAI.ChatCompletionsPage = ChatCompletionsPage;
OpenAI.Embeddings = Embeddings;
OpenAI.Files = Files$1;
OpenAI.FileObjectsPage = FileObjectsPage;
OpenAI.Images = Images;
OpenAI.Audio = Audio$1;
OpenAI.Moderations = Moderations;
OpenAI.Models = Models;
OpenAI.ModelsPage = ModelsPage;
OpenAI.FineTuning = FineTuning;
OpenAI.Graders = Graders;
OpenAI.VectorStores = VectorStores;
OpenAI.VectorStoresPage = VectorStoresPage;
OpenAI.VectorStoreSearchResponsesPage = VectorStoreSearchResponsesPage;
OpenAI.Beta = Beta;
OpenAI.Batches = Batches;
OpenAI.BatchesPage = BatchesPage;
OpenAI.Uploads = Uploads;
OpenAI.Responses = Responses;
OpenAI.Evals = Evals;
OpenAI.EvalListResponsesPage = EvalListResponsesPage;
OpenAI.Containers = Containers;
OpenAI.ContainerListResponsesPage = ContainerListResponsesPage;

/**
 * WhisperService: OpenAI Whisper transcription with confidence tracking
 * Architecture: Converts audio chunks to text using OpenAI whisper-1 model
 */
class WhisperService {
    constructor(config) {
        this.openai = null;
        this.config = config;
        this.initializeClient();
    }
    /**
     * Initialize OpenAI client
     */
    initializeClient() {
        const apiKey = this.config.get('openaiApiKey');
        if (!apiKey) {
            console.warn('OpenAI API key not configured');
            return;
        }
        this.openai = new OpenAI({
            apiKey,
            dangerouslyAllowBrowser: true, // Note: In production, proxy through backend
        });
    }
    /**
     * Update API key and reinitialize client
     */
    updateApiKey(apiKey) {
        this.config.set('openaiApiKey', apiKey);
        this.initializeClient();
    }
    /**
     * Transcribe audio chunk using OpenAI Whisper
     */
    transcribe(audioChunk) {
        return __awaiter(this, void 0, void 0, function* () {
            const apiKey = this.config.get('openaiApiKey');
            if (!apiKey) {
                throw new Error('OpenAI API key not configured. Please set API key.');
            }
            try {
                // Create FormData for multipart upload
                const formData = new FormData();
                // Convert Blob to File with proper extension
                // Use the actual MIME type from the blob, or default to audio/webm
                const mimeType = audioChunk.blob.type || 'audio/webm';
                // Determine file extension based on MIME type
                let extension = 'webm';
                if (mimeType.includes('mp4'))
                    extension = 'mp4';
                else if (mimeType.includes('mpeg'))
                    extension = 'mpeg';
                else if (mimeType.includes('ogg'))
                    extension = 'ogg';
                else if (mimeType.includes('wav'))
                    extension = 'wav';
                const file = new File([audioChunk.blob], `audio-${audioChunk.timestamp}.${extension}`, { type: mimeType });
                console.log('Audio file details:', {
                    size: file.size,
                    type: file.type,
                    name: file.name,
                });
                // Check minimum file size (empty recordings are ~125 bytes)
                if (file.size < 1000) {
                    throw new Error('Recording too short or empty. Please record for at least 1-2 seconds.');
                }
                formData.append('file', file);
                formData.append('model', this.config.get('whisperModel'));
                formData.append('response_format', 'json'); // Use simple json instead of verbose_json
                // Direct fetch to OpenAI API (bypasses SDK CORS issues)
                const response = yield fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: formData,
                });
                if (!response.ok) {
                    const errorData = yield response.json().catch(() => ({}));
                    throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
                }
                const data = yield response.json();
                // For simple json format, we don't get confidence scores
                // Default to 1.0 for now (Phase 2 can use verbose_json if needed)
                const confidence = 1.0;
                const chunk = {
                    text: data.text ? data.text.trim() : '',
                    confidence,
                    timestamp: audioChunk.timestamp,
                };
                eventBus.emit('transcribed', chunk);
                return chunk;
            }
            catch (error) {
                console.error('Whisper transcription error:', error);
                eventBus.emit('error', {
                    message: 'Transcription failed',
                    error,
                });
                throw error;
            }
        });
    }
    transcribeBlobPartial(blob) {
        return __awaiter(this, void 0, void 0, function* () {
            const chunk = {
                blob,
                timestamp: Date.now(),
                duration: 0,
            };
            const result = yield this.transcribe(chunk);
            return result.text || '';
        });
    }
    /**
     * Transcribe multiple audio chunks in sequence
     */
    transcribeMultiple(audioChunks) {
        return __awaiter(this, void 0, void 0, function* () {
            const results = [];
            for (const chunk of audioChunks) {
                try {
                    const result = yield this.transcribe(chunk);
                    results.push(result);
                }
                catch (error) {
                    console.error('Failed to transcribe chunk:', error);
                    // Continue with next chunk even if one fails
                }
            }
            return results;
        });
    }
    /**
     * Stream transcription (for future real-time implementation)
     * Currently processes chunks sequentially
     */
    stream(audioChunks, onChunk) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const audioChunk of audioChunks) {
                try {
                    const result = yield this.transcribe(audioChunk);
                    onChunk(result);
                }
                catch (error) {
                    console.error('Stream transcription error:', error);
                    eventBus.emit('error', {
                        message: 'Stream transcription failed',
                        error,
                    });
                }
            }
        });
    }
    /**
     * Combine multiple transcription chunks into single text
     */
    combineChunks(chunks) {
        const text = chunks.map((chunk) => chunk.text).join(' ');
        const averageConfidence = chunks.length > 0
            ? chunks.reduce((sum, chunk) => sum + chunk.confidence, 0) /
                chunks.length
            : 0;
        return {
            text,
            averageConfidence,
        };
    }
    /**
     * Check if service is ready
     */
    isReady() {
        const apiKey = this.config.get('openaiApiKey');
        return apiKey !== null && apiKey !== undefined && apiKey.length > 0;
    }
}

/**
 * CitationHelper: Extract inline citations already provided by GPT output.
 * We no longer fabricate hyperlinks—citations must exist in the refined text.
 */
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:[^)]+)\)/g;
class CitationHelper {
    static extract(text) {
        if (!text) {
            return [];
        }
        const citations = [];
        let match;
        while ((match = MARKDOWN_LINK_REGEX.exec(text)) !== null) {
            citations.push({
                keyword: match[1],
                label: match[1],
                url: match[2],
                insertedAt: match.index,
            });
        }
        return citations;
    }
}

/**
 * LLMRefineService: GPT-4 refinement with RAG context
 * Architecture: Refine transcription using vault context and user style
 * Status: Phase 2 - Implemented
 */
class LLMRefineService {
    constructor(config) {
        this.config = config;
    }
    /**
     * Refine transcription with GPT-4 and optional context
     */
    refine(text_1) {
        return __awaiter(this, arguments, void 0, function* (text, context = [], userPrompt) {
            var _a, _b, _c, _d;
            const apiKey = this.config.get('openaiApiKey');
            if (!apiKey) {
                throw new Error('OpenAI API key not configured');
            }
            try {
                // Build system prompt
                const systemPrompt = this.buildSystemPrompt(context);
                // Build user message
                const userMessage = userPrompt
                    ? `${userPrompt}\n\nTranscription to refine:\n${text}`
                    : `Please refine the following voice transcription into a well-structured note:\n\n${text}`;
                // Call GPT-4 API directly (fetch instead of SDK for consistency)
                const response = yield fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: this.config.get('gptModel'),
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userMessage },
                        ],
                        temperature: 0.7,
                        max_tokens: 2000,
                    }),
                });
                if (!response.ok) {
                    const errorData = yield response.json().catch(() => ({}));
                    throw new Error(`GPT-4 API error: ${response.status} - ${JSON.stringify(errorData)}`);
                }
                const data = yield response.json();
                const refinedText = ((_d = (_c = (_b = (_a = data.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim()) || text;
                // Generate title
                const title = yield this.generateTitle(refinedText);
                // Extract potential wikilinks
                const links = this.extractWikilinks(refinedText);
                const refinedNote = {
                    title,
                    body: refinedText,
                    links,
                    timestamp: Date.now(),
                    originalTranscription: text,
                    citations: CitationHelper.extract(refinedText),
                };
                eventBus.emit('refined', refinedNote);
                return refinedNote;
            }
            catch (error) {
                console.error('Refinement error:', error);
                eventBus.emit('error', {
                    message: 'Refinement failed',
                    error,
                });
                throw error;
            }
        });
    }
    /**
     * Generate note title from content using GPT-4
     */
    generateTitle(text) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const apiKey = this.config.get('openaiApiKey');
            if (!apiKey) {
                throw new Error('OpenAI API key not configured');
            }
            try {
                const response = yield fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: this.config.get('gptModel'),
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a title generator. Create concise, descriptive titles (max 8 words) for notes. Respond with ONLY the title, no quotes or formatting.',
                            },
                            {
                                role: 'user',
                                content: `Generate a title for this note:\n\n${text.substring(0, 500)}`,
                            },
                        ],
                        temperature: 0.5,
                        max_tokens: 50,
                    }),
                });
                if (!response.ok) {
                    console.warn('Title generation failed, using fallback');
                    return this.generateFallbackTitle(text);
                }
                const data = yield response.json();
                const title = (_d = (_c = (_b = (_a = data.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
                return title || this.generateFallbackTitle(text);
            }
            catch (error) {
                console.error('Title generation error:', error);
                return this.generateFallbackTitle(text);
            }
        });
    }
    /**
     * Simple refinement without GPT-4 (for quick saves)
     */
    simpleRefine(text) {
        return __awaiter(this, void 0, void 0, function* () {
            const title = this.generateFallbackTitle(text);
            const links = this.extractWikilinks(text);
            const refinedNote = {
                title,
                body: text,
                links,
                timestamp: Date.now(),
                originalTranscription: text,
                citations: CitationHelper.extract(text),
            };
            return refinedNote;
        });
    }
    /**
     * Build system prompt with optional context
     */
    buildSystemPrompt(context) {
        let prompt = `You are an expert note-taking assistant for Obsidian. Your role is to:

1. Transform voice transcriptions into well-structured, readable notes
2. Fix grammar, punctuation, and sentence structure
3. Organize thoughts into clear sections with markdown headings
4. Preserve the speaker's original meaning and intent
5. Use markdown formatting (bold, italics, lists, etc.)
6. Identify key concepts and highlight them appropriately
7. If you introduce facts or data not explicitly present in the raw transcript, cite the exact external source that informed that statement using inline Markdown link syntax: [Source Name](https://example.com). These citations must reference actual sources you used while generating the response; do not invent URLs.
8. When citing broad background knowledge rather than a specific primary source, wrap the hyperlink in italics, e.g., _[Background Source](https://example.com)_, so readers know it is a general reference.`;
        if (context.length > 0) {
            prompt += `\n\n**Context from vault:**\n${context.slice(0, 3).join('\n\n')}`;
            prompt += '\n\nUse this context to inform your refinement and suggest relevant connections.';
        }
        return prompt;
    }
    /**
     * Extract wikilinks from text
     */
    extractWikilinks(text) {
        const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
        const matches = Array.from(text.matchAll(wikilinkRegex));
        return matches.map((match) => match[1]);
    }
    /**
     * Generate fallback title from first sentence
     */
    generateFallbackTitle(text) {
        // Get first sentence or first 50 chars
        const firstSentence = text.split(/[.!?]\s/)[0];
        const title = firstSentence.substring(0, 60).trim();
        // If too short, use timestamp
        if (title.length < 3) {
            const date = new Date();
            return `Voice Note ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        }
        return title + (firstSentence.length > 60 ? '...' : '');
    }
    /**
     * Check if service is ready
     */
    isReady() {
        const apiKey = this.config.get('openaiApiKey');
        return apiKey !== null && apiKey !== undefined && apiKey.length > 0;
    }
}

/**
 * TextChunker: Split text into overlapping chunks for embedding
 * Architecture: Token-aware chunking with configurable overlap
 */
class TextChunker {
    /**
     * Split text into overlapping chunks
     * Uses approximate token counting (1 token ≈ 4 characters)
     */
    static chunk(text, options) {
        const { chunkSize, overlap } = options;
        if (!text || text.trim().length === 0) {
            return [];
        }
        const chunks = [];
        const approxCharsPerChunk = chunkSize * 4; // 1 token ≈ 4 chars
        const approxOverlapChars = overlap * 4;
        // Split text into sentences to avoid breaking mid-sentence
        const sentences = this.splitIntoSentences(text);
        let currentChunk = '';
        let currentChunkStartChar = 0;
        let chunkIndex = 0;
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
            // If adding this sentence exceeds chunk size, save current chunk
            if (potentialChunk.length > approxCharsPerChunk && currentChunk.length > 0) {
                const tokens = this.estimateTokens(currentChunk);
                chunks.push({
                    text: currentChunk,
                    chunkIndex,
                    tokens,
                    startChar: currentChunkStartChar,
                    endChar: currentChunkStartChar + currentChunk.length,
                });
                chunkIndex++;
                // Start new chunk with overlap
                const overlapText = this.getOverlapText(currentChunk, approxOverlapChars);
                currentChunk = overlapText + (overlapText ? ' ' : '') + sentence;
                currentChunkStartChar += currentChunk.length - overlapText.length;
            }
            else {
                currentChunk = potentialChunk;
            }
        }
        // Add final chunk if it has content
        if (currentChunk.trim()) {
            const tokens = this.estimateTokens(currentChunk);
            chunks.push({
                text: currentChunk,
                chunkIndex,
                tokens,
                startChar: currentChunkStartChar,
                endChar: currentChunkStartChar + currentChunk.length,
            });
        }
        return chunks;
    }
    /**
     * Split text into sentences (basic sentence boundary detection)
     */
    static splitIntoSentences(text) {
        // Match sentence boundaries: . ! ? followed by space or end
        const sentenceRegex = /[^.!?]+[.!?]+/g;
        const sentences = text.match(sentenceRegex) || [];
        // If no sentences matched, return the whole text as one sentence
        if (sentences.length === 0) {
            return [text.trim()];
        }
        return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    /**
     * Get overlap text from end of chunk
     */
    static getOverlapText(chunk, overlapChars) {
        if (chunk.length <= overlapChars) {
            return chunk;
        }
        // Try to break at sentence boundary within overlap window
        const overlapCandidate = chunk.slice(-overlapChars);
        const lastSentenceBoundary = Math.max(overlapCandidate.lastIndexOf('.'), overlapCandidate.lastIndexOf('!'), overlapCandidate.lastIndexOf('?'));
        if (lastSentenceBoundary > 0) {
            return overlapCandidate.slice(lastSentenceBoundary + 1).trim();
        }
        return overlapCandidate.trim();
    }
    /**
     * Estimate token count
     * Rough heuristic: 1 token ≈ 4 characters
     * This is approximate but sufficient for chunking
     */
    static estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    /**
     * Validate chunk options
     */
    static validateOptions(options) {
        if (options.chunkSize <= 0) {
            throw new Error('Chunk size must be positive');
        }
        if (options.overlap < 0) {
            throw new Error('Overlap cannot be negative');
        }
        if (options.overlap >= options.chunkSize) {
            throw new Error('Overlap must be less than chunk size');
        }
    }
}

/**
 * VectorMath: Vector operations for embedding similarity
 * Architecture: Pure functions for cosine similarity and vector operations
 */
class VectorMath {
    /**
     * Compute cosine similarity between two embedding vectors
     * Returns a value between -1 (opposite) and 1 (identical)
     * Typically RAG results range from 0.3 to 0.95
     */
    static cosineSimilarity(a, b) {
        if (a.dimensions !== b.dimensions) {
            throw new Error(`Vector dimension mismatch: ${a.dimensions} vs ${b.dimensions}`);
        }
        const dotProduct = this.dotProduct(a.values, b.values);
        const magnitudeA = this.magnitude(a.values);
        const magnitudeB = this.magnitude(b.values);
        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }
        return dotProduct / (magnitudeA * magnitudeB);
    }
    /**
     * Compute dot product of two vectors
     */
    static dotProduct(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += a[i] * b[i];
        }
        return sum;
    }
    /**
     * Compute magnitude (L2 norm) of a vector
     */
    static magnitude(v) {
        let sum = 0;
        for (let i = 0; i < v.length; i++) {
            sum += v[i] * v[i];
        }
        return Math.sqrt(sum);
    }
    /**
     * Normalize a vector to unit length
     */
    static normalize(v) {
        const mag = this.magnitude(v.values);
        if (mag === 0) {
            return v;
        }
        return {
            values: v.values.map((val) => val / mag),
            dimensions: v.dimensions,
        };
    }
    /**
     * Find top-K most similar vectors from a list
     */
    static topKSimilar(query, candidates, k) {
        const similarities = candidates.map((candidate) => ({
            similarity: this.cosineSimilarity(query, candidate.embedding),
            metadata: candidate.metadata,
        }));
        // Sort by similarity (descending) and take top K
        similarities.sort((a, b) => b.similarity - a.similarity);
        return similarities.slice(0, k);
    }
}

/**
 * OpenAIEmbeddingProvider: OpenAI text-embedding-3-small integration
 * Architecture: BYOK (Bring Your Own Key) model using official OpenAI SDK
 */
class OpenAIEmbeddingProvider {
    constructor(config) {
        this.config = config;
        this.model = config.get('embeddingModel');
        const apiKey = config.get('openaiApiKey');
        if (!apiKey) {
            throw new Error('OpenAI API key not configured');
        }
        this.client = new OpenAI({
            apiKey,
            dangerouslyAllowBrowser: true, // Required for Obsidian plugin context
        });
    }
    embed(text) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield this.client.embeddings.create({
                    model: this.model,
                    input: text,
                    encoding_format: 'float',
                });
                const embedding = response.data[0].embedding;
                return {
                    values: embedding,
                    dimensions: embedding.length,
                };
            }
            catch (error) {
                console.error('OpenAI embedding error:', error);
                throw new Error(`Failed to generate embedding: ${error.message}`);
            }
        });
    }
    embedBatch(texts) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // OpenAI supports batch embedding (up to 2048 texts per request)
                const response = yield this.client.embeddings.create({
                    model: this.model,
                    input: texts,
                    encoding_format: 'float',
                });
                return response.data.map((item) => ({
                    values: item.embedding,
                    dimensions: item.embedding.length,
                }));
            }
            catch (error) {
                console.error('OpenAI batch embedding error:', error);
                throw new Error(`Failed to generate batch embeddings: ${error.message}`);
            }
        });
    }
    getModelName() {
        return this.model;
    }
    getDimensions() {
        // text-embedding-3-small produces 1536-dimensional vectors
        return 1536;
    }
    /**
     * Update API key when settings change
     */
    updateApiKey(apiKey) {
        this.client = new OpenAI({
            apiKey,
            dangerouslyAllowBrowser: true,
        });
    }
}

/**
 * CustomEmbeddingProvider: Local/self-hosted embedding service
 * Architecture: OpenAI-compatible API for walled infrastructure (DOD/DOJ)
 *
 * Supports:
 * - Local RAG servers (e.g., text-embeddings-inference, sentence-transformers)
 * - Air-gapped deployments
 * - Custom embedding models
 */
class CustomEmbeddingProvider {
    constructor(config) {
        this.config = config;
        this.baseUrl = config.get('customEmbeddingUrl') || config.get('customApiBase') || '';
        this.apiKey = config.get('openaiApiKey') || ''; // May not be needed for local servers
        this.model = config.get('embeddingModel');
        this.dimensions = 1536; // Default, will update from first response
        if (!this.baseUrl) {
            throw new Error('Custom embedding URL not configured');
        }
    }
    embed(text) {
        return __awaiter(this, void 0, void 0, function* () {
            const vectors = yield this.embedBatch([text]);
            return vectors[0];
        });
    }
    embedBatch(texts) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const requestBody = {
                    input: texts,
                    model: this.model,
                };
                const headers = {
                    'Content-Type': 'application/json',
                };
                // Only add Authorization if API key is provided
                if (this.apiKey) {
                    headers['Authorization'] = `Bearer ${this.apiKey}`;
                }
                const response = yield fetch(this.baseUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                });
                if (!response.ok) {
                    const errorText = yield response.text();
                    throw new Error(`Custom embedding server returned ${response.status}: ${errorText}`);
                }
                const data = yield response.json();
                // Update dimensions from first response
                if (data.data.length > 0) {
                    this.dimensions = data.data[0].embedding.length;
                }
                return data.data.map((item) => ({
                    values: item.embedding,
                    dimensions: item.embedding.length,
                }));
            }
            catch (error) {
                console.error('Custom embedding error:', error);
                throw new Error(`Failed to generate embedding from custom server: ${error.message}`);
            }
        });
    }
    getModelName() {
        return this.model;
    }
    getDimensions() {
        return this.dimensions;
    }
    /**
     * Update base URL when settings change
     */
    updateBaseUrl(url) {
        this.baseUrl = url;
    }
    /**
     * Update API key when settings change (optional for local servers)
     */
    updateApiKey(apiKey) {
        this.apiKey = apiKey;
    }
}

/**
 * EmbeddingProviderFactory: Factory for creating embedding providers
 * Architecture: Strategy pattern for swappable embedding backends
 */
class EmbeddingProviderFactory {
    /**
     * Create an embedding provider based on config settings
     */
    static create(config) {
        const llmProvider = config.get('llmProvider');
        const customEmbeddingUrl = config.get('customEmbeddingUrl');
        // If custom embedding URL is explicitly provided, use custom provider
        if (customEmbeddingUrl && customEmbeddingUrl.trim()) {
            return new CustomEmbeddingProvider(config);
        }
        // If llmProvider is custom and customApiBase exists, use custom provider
        if (llmProvider === 'custom' && config.get('customApiBase')) {
            return new CustomEmbeddingProvider(config);
        }
        // Default to OpenAI
        return new OpenAIEmbeddingProvider(config);
    }
}

/**
 * VaultRAGService: Retrieval-Augmented Generation for vault context
 * Architecture: Vector-based semantic search with persistent caching
 *
 * Features:
 * - OpenAI or custom/local embedding providers
 * - In-memory vector index with disk persistence
 * - Incremental updates on file changes
 * - Cosine similarity search
 * - Writing style analysis
 */
class VaultRAGService {
    constructor(app, config) {
        this.index = [];
        this.isIndexBuilt = false;
        this.pendingCacheSave = null;
        this.isInitializing = false;
        this.app = app;
        this.config = config;
        this.embeddingProvider = EmbeddingProviderFactory.create(config);
        // Cache file stored in plugin data directory
        const pluginDir = this.app.vault.configDir + '/plugins/zeddal';
        this.cacheFilePath = `${pluginDir}/embeddings-cache.json`;
    }
    /**
     * Build vector index from vault files
     * Loads from cache if available, otherwise indexes from scratch
     */
    buildIndex() {
        return __awaiter(this, arguments, void 0, function* (forceRebuild = false) {
            if (!this.config.get('enableRAG')) {
                console.log('RAG disabled in settings');
                return;
            }
            this.isInitializing = true;
            // Try to load from cache first
            if (!forceRebuild) {
                const loaded = yield this.loadIndexFromCache();
                if (loaded) {
                    console.log(`Loaded ${this.index.length} chunks from cache`);
                    this.isIndexBuilt = true;
                    this.isInitializing = false;
                    return;
                }
            }
            console.log('Building RAG index from scratch...');
            const startTime = Date.now();
            const markdownFiles = this.app.vault.getMarkdownFiles();
            // Reset index
            this.index = [];
            // Process files in batches to avoid overwhelming the API
            const batchSize = 10;
            for (let i = 0; i < markdownFiles.length; i += batchSize) {
                const batch = markdownFiles.slice(i, i + batchSize);
                yield this.indexFileBatch(batch);
                // Progress logging
                const progress = Math.min(i + batchSize, markdownFiles.length);
                console.log(`Indexed ${progress}/${markdownFiles.length} files`);
            }
            this.isIndexBuilt = true;
            this.isInitializing = false;
            const duration = Date.now() - startTime;
            console.log(`RAG index built: ${this.index.length} chunks from ${markdownFiles.length} files in ${duration}ms`);
            // Persist to cache (immediate write for full rebuild)
            yield this.saveIndexToCache();
        });
    }
    /**
     * Index a batch of files
     */
    indexFileBatch(files) {
        return __awaiter(this, void 0, void 0, function* () {
            const chunks = [];
            // Read all files and chunk them
            for (const file of files) {
                try {
                    const content = yield this.app.vault.read(file);
                    const fileChunks = yield this.chunkFile(file, content);
                    chunks.push(...fileChunks);
                }
                catch (error) {
                    console.error(`Failed to index file ${file.path}:`, error);
                }
            }
            if (chunks.length === 0) {
                return;
            }
            // Generate embeddings in batch (more efficient)
            try {
                const texts = chunks.map((c) => c.text);
                const embeddings = yield this.embeddingProvider.embedBatch(texts);
                // Attach embeddings to chunks
                for (let i = 0; i < chunks.length; i++) {
                    chunks[i].embedding = embeddings[i];
                }
                // Add to index
                this.index.push(...chunks);
            }
            catch (error) {
                console.error('Failed to generate embeddings for batch:', error);
                throw error;
            }
        });
    }
    /**
     * Chunk a single file into semantic segments
     */
    chunkFile(file, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const chunkSize = this.config.get('ragChunkSize');
            const overlap = this.config.get('ragChunkOverlap');
            const textChunks = TextChunker.chunk(content, { chunkSize, overlap });
            return textChunks.map((chunk) => ({
                path: file.path,
                chunkIndex: chunk.chunkIndex,
                text: chunk.text,
                embedding: { values: [], dimensions: 0 }, // Will be filled by batch embedding
                lastModified: file.stat.mtime,
                tokens: chunk.tokens,
            }));
        });
    }
    /**
     * Retrieve relevant context for a transcription
     */
    retrieveContext(text) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.get('enableRAG')) {
                return [];
            }
            if (!this.isIndexBuilt) {
                console.warn('RAG index not built yet, building now...');
                yield this.buildIndex();
            }
            if (this.index.length === 0) {
                return [];
            }
            const startTime = Date.now();
            try {
                // Embed the query text
                const queryEmbedding = yield this.embeddingProvider.embed(text);
                // Find top-K similar chunks
                const topK = this.config.get('ragTopK');
                const candidates = this.index.map((chunk) => ({
                    embedding: chunk.embedding,
                    metadata: chunk,
                }));
                const results = VectorMath.topKSimilar(queryEmbedding, candidates, topK);
                // Extract unique files (avoid duplicates from same file)
                const seenPaths = new Set();
                const contextChunks = [];
                for (const result of results) {
                    const chunk = result.metadata;
                    if (!seenPaths.has(chunk.path)) {
                        seenPaths.add(chunk.path);
                        contextChunks.push(`From "${chunk.path}":\n${chunk.text}`);
                    }
                }
                const queryTime = Date.now() - startTime;
                console.log(`RAG retrieved ${contextChunks.length} contexts in ${queryTime}ms`);
                return contextChunks;
            }
            catch (error) {
                console.error('RAG context retrieval failed:', error);
                return []; // Gracefully degrade to no context
            }
        });
    }
    /**
     * Analyze user's writing style from vault
     * Returns a style description for GPT-4 system prompt
     */
    analyzeStyle() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isIndexBuilt || this.index.length === 0) {
                return '';
            }
            // Sample chunks from across the vault
            const sampleSize = Math.min(10, this.index.length);
            const step = Math.floor(this.index.length / sampleSize);
            const samples = [];
            for (let i = 0; i < this.index.length; i += step) {
                if (samples.length >= sampleSize)
                    break;
                samples.push(this.index[i].text);
            }
            // Analyze common patterns
            const avgLength = samples.reduce((sum, s) => sum + s.length, 0) / samples.length;
            const hasLists = samples.some((s) => /^[-*]\s/m.test(s));
            const hasHeadings = samples.some((s) => /^#{1,6}\s/m.test(s));
            const styleNotes = [];
            if (avgLength < 300) {
                styleNotes.push('concise, brief notes');
            }
            else if (avgLength > 800) {
                styleNotes.push('detailed, comprehensive notes');
            }
            if (hasLists) {
                styleNotes.push('uses bullet lists');
            }
            if (hasHeadings) {
                styleNotes.push('uses headings for structure');
            }
            if (styleNotes.length === 0) {
                return '';
            }
            return `The user's typical note style: ${styleNotes.join(', ')}.`;
        });
    }
    /**
     * Update index for a single file (called on file modification)
     */
    updateFile(file) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.get('enableRAG') || !this.isIndexBuilt) {
                return;
            }
            // Skip updates during initialization to avoid re-indexing cached files
            if (this.isInitializing) {
                return;
            }
            try {
                // Check if file has actually been modified since last index
                const existingChunks = this.index.filter((chunk) => chunk.path === file.path);
                if (existingChunks.length > 0) {
                    const lastIndexed = existingChunks[0].lastModified;
                    if (file.stat.mtime <= lastIndexed) {
                        // File hasn't changed since last index, skip
                        return;
                    }
                }
                // Remove old chunks for this file
                this.index = this.index.filter((chunk) => chunk.path !== file.path);
                // Re-index the file
                const content = yield this.app.vault.read(file);
                yield this.indexFileBatch([file]);
                // Schedule debounced cache save
                this.scheduleCacheSave();
                console.log(`Updated RAG index for ${file.path}`);
            }
            catch (error) {
                console.error(`Failed to update RAG index for ${file.path}:`, error);
            }
        });
    }
    /**
     * Remove file from index (called on file deletion)
     */
    removeFile(path) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.get('enableRAG') || !this.isIndexBuilt) {
                return;
            }
            const beforeCount = this.index.length;
            this.index = this.index.filter((chunk) => chunk.path !== path);
            const afterCount = this.index.length;
            if (beforeCount !== afterCount) {
                this.scheduleCacheSave();
                console.log(`Removed ${beforeCount - afterCount} chunks for ${path}`);
            }
        });
    }
    /**
     * Load index from cache file
     */
    loadIndexFromCache() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const cacheExists = yield this.app.vault.adapter.exists(this.cacheFilePath);
                if (!cacheExists) {
                    return false;
                }
                const cacheData = yield this.app.vault.adapter.read(this.cacheFilePath);
                const cache = JSON.parse(cacheData);
                // Validate cache version
                if (cache.version !== 1) {
                    console.log('Cache version mismatch, rebuilding index');
                    return false;
                }
                // Check if cache is stale (older than 7 days)
                const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
                if (Date.now() - cache.lastBuilt > maxAge) {
                    console.log('Cache is stale, rebuilding index');
                    return false;
                }
                this.index = cache.chunks;
                return true;
            }
            catch (error) {
                console.error('Failed to load RAG cache:', error);
                return false;
            }
        });
    }
    /**
     * Save index to cache file
     */
    saveIndexToCache() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const cache = {
                    version: 1,
                    chunks: this.index,
                    lastBuilt: Date.now(),
                };
                const cacheData = JSON.stringify(cache);
                yield this.app.vault.adapter.write(this.cacheFilePath, cacheData);
                console.log('RAG index cached to disk');
            }
            catch (error) {
                console.error('Failed to save RAG cache:', error);
            }
        });
    }
    /**
     * Schedule a debounced cache save (batches multiple updates)
     * Waits 2 seconds after last change before writing to disk
     */
    scheduleCacheSave() {
        // Cancel any pending save
        if (this.pendingCacheSave !== null) {
            clearTimeout(this.pendingCacheSave);
        }
        // Schedule new save after 2 seconds of inactivity
        this.pendingCacheSave = window.setTimeout(() => {
            this.pendingCacheSave = null;
            this.saveIndexToCache();
        }, 2000);
    }
    /**
     * Clear the entire index and cache
     */
    clearIndex() {
        return __awaiter(this, void 0, void 0, function* () {
            // Cancel any pending cache save
            if (this.pendingCacheSave !== null) {
                clearTimeout(this.pendingCacheSave);
                this.pendingCacheSave = null;
            }
            this.index = [];
            this.isIndexBuilt = false;
            try {
                const exists = yield this.app.vault.adapter.exists(this.cacheFilePath);
                if (exists) {
                    yield this.app.vault.adapter.remove(this.cacheFilePath);
                }
                console.log('RAG index cleared');
            }
            catch (error) {
                console.error('Failed to clear RAG cache:', error);
            }
        });
    }
    /**
     * Get index statistics
     */
    getStats() {
        const uniqueFiles = new Set(this.index.map((c) => c.path));
        return {
            totalChunks: this.index.length,
            totalFiles: uniqueFiles.size,
            isBuilt: this.isIndexBuilt,
            provider: this.embeddingProvider.getModelName(),
        };
    }
}

var util$1;
(function (util) {
    util.assertEqual = (_) => { };
    function assertIs(_arg) { }
    util.assertIs = assertIs;
    function assertNever(_x) {
        throw new Error();
    }
    util.assertNever = assertNever;
    util.arrayToEnum = (items) => {
        const obj = {};
        for (const item of items) {
            obj[item] = item;
        }
        return obj;
    };
    util.getValidEnumValues = (obj) => {
        const validKeys = util.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
        const filtered = {};
        for (const k of validKeys) {
            filtered[k] = obj[k];
        }
        return util.objectValues(filtered);
    };
    util.objectValues = (obj) => {
        return util.objectKeys(obj).map(function (e) {
            return obj[e];
        });
    };
    util.objectKeys = typeof Object.keys === "function" // eslint-disable-line ban/ban
        ? (obj) => Object.keys(obj) // eslint-disable-line ban/ban
        : (object) => {
            const keys = [];
            for (const key in object) {
                if (Object.prototype.hasOwnProperty.call(object, key)) {
                    keys.push(key);
                }
            }
            return keys;
        };
    util.find = (arr, checker) => {
        for (const item of arr) {
            if (checker(item))
                return item;
        }
        return undefined;
    };
    util.isInteger = typeof Number.isInteger === "function"
        ? (val) => Number.isInteger(val) // eslint-disable-line ban/ban
        : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
    function joinValues(array, separator = " | ") {
        return array.map((val) => (typeof val === "string" ? `'${val}'` : val)).join(separator);
    }
    util.joinValues = joinValues;
    util.jsonStringifyReplacer = (_, value) => {
        if (typeof value === "bigint") {
            return value.toString();
        }
        return value;
    };
})(util$1 || (util$1 = {}));
var objectUtil;
(function (objectUtil) {
    objectUtil.mergeShapes = (first, second) => {
        return {
            ...first,
            ...second, // second overwrites first
        };
    };
})(objectUtil || (objectUtil = {}));
const ZodParsedType = util$1.arrayToEnum([
    "string",
    "nan",
    "number",
    "integer",
    "float",
    "boolean",
    "date",
    "bigint",
    "symbol",
    "function",
    "undefined",
    "null",
    "array",
    "object",
    "unknown",
    "promise",
    "void",
    "never",
    "map",
    "set",
]);
const getParsedType = (data) => {
    const t = typeof data;
    switch (t) {
        case "undefined":
            return ZodParsedType.undefined;
        case "string":
            return ZodParsedType.string;
        case "number":
            return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
        case "boolean":
            return ZodParsedType.boolean;
        case "function":
            return ZodParsedType.function;
        case "bigint":
            return ZodParsedType.bigint;
        case "symbol":
            return ZodParsedType.symbol;
        case "object":
            if (Array.isArray(data)) {
                return ZodParsedType.array;
            }
            if (data === null) {
                return ZodParsedType.null;
            }
            if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
                return ZodParsedType.promise;
            }
            if (typeof Map !== "undefined" && data instanceof Map) {
                return ZodParsedType.map;
            }
            if (typeof Set !== "undefined" && data instanceof Set) {
                return ZodParsedType.set;
            }
            if (typeof Date !== "undefined" && data instanceof Date) {
                return ZodParsedType.date;
            }
            return ZodParsedType.object;
        default:
            return ZodParsedType.unknown;
    }
};

const ZodIssueCode = util$1.arrayToEnum([
    "invalid_type",
    "invalid_literal",
    "custom",
    "invalid_union",
    "invalid_union_discriminator",
    "invalid_enum_value",
    "unrecognized_keys",
    "invalid_arguments",
    "invalid_return_type",
    "invalid_date",
    "invalid_string",
    "too_small",
    "too_big",
    "invalid_intersection_types",
    "not_multiple_of",
    "not_finite",
]);
class ZodError extends Error {
    get errors() {
        return this.issues;
    }
    constructor(issues) {
        super();
        this.issues = [];
        this.addIssue = (sub) => {
            this.issues = [...this.issues, sub];
        };
        this.addIssues = (subs = []) => {
            this.issues = [...this.issues, ...subs];
        };
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
            // eslint-disable-next-line ban/ban
            Object.setPrototypeOf(this, actualProto);
        }
        else {
            this.__proto__ = actualProto;
        }
        this.name = "ZodError";
        this.issues = issues;
    }
    format(_mapper) {
        const mapper = _mapper ||
            function (issue) {
                return issue.message;
            };
        const fieldErrors = { _errors: [] };
        const processError = (error) => {
            for (const issue of error.issues) {
                if (issue.code === "invalid_union") {
                    issue.unionErrors.map(processError);
                }
                else if (issue.code === "invalid_return_type") {
                    processError(issue.returnTypeError);
                }
                else if (issue.code === "invalid_arguments") {
                    processError(issue.argumentsError);
                }
                else if (issue.path.length === 0) {
                    fieldErrors._errors.push(mapper(issue));
                }
                else {
                    let curr = fieldErrors;
                    let i = 0;
                    while (i < issue.path.length) {
                        const el = issue.path[i];
                        const terminal = i === issue.path.length - 1;
                        if (!terminal) {
                            curr[el] = curr[el] || { _errors: [] };
                            // if (typeof el === "string") {
                            //   curr[el] = curr[el] || { _errors: [] };
                            // } else if (typeof el === "number") {
                            //   const errorArray: any = [];
                            //   errorArray._errors = [];
                            //   curr[el] = curr[el] || errorArray;
                            // }
                        }
                        else {
                            curr[el] = curr[el] || { _errors: [] };
                            curr[el]._errors.push(mapper(issue));
                        }
                        curr = curr[el];
                        i++;
                    }
                }
            }
        };
        processError(this);
        return fieldErrors;
    }
    static assert(value) {
        if (!(value instanceof ZodError)) {
            throw new Error(`Not a ZodError: ${value}`);
        }
    }
    toString() {
        return this.message;
    }
    get message() {
        return JSON.stringify(this.issues, util$1.jsonStringifyReplacer, 2);
    }
    get isEmpty() {
        return this.issues.length === 0;
    }
    flatten(mapper = (issue) => issue.message) {
        const fieldErrors = {};
        const formErrors = [];
        for (const sub of this.issues) {
            if (sub.path.length > 0) {
                const firstEl = sub.path[0];
                fieldErrors[firstEl] = fieldErrors[firstEl] || [];
                fieldErrors[firstEl].push(mapper(sub));
            }
            else {
                formErrors.push(mapper(sub));
            }
        }
        return { formErrors, fieldErrors };
    }
    get formErrors() {
        return this.flatten();
    }
}
ZodError.create = (issues) => {
    const error = new ZodError(issues);
    return error;
};

const errorMap = (issue, _ctx) => {
    let message;
    switch (issue.code) {
        case ZodIssueCode.invalid_type:
            if (issue.received === ZodParsedType.undefined) {
                message = "Required";
            }
            else {
                message = `Expected ${issue.expected}, received ${issue.received}`;
            }
            break;
        case ZodIssueCode.invalid_literal:
            message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util$1.jsonStringifyReplacer)}`;
            break;
        case ZodIssueCode.unrecognized_keys:
            message = `Unrecognized key(s) in object: ${util$1.joinValues(issue.keys, ", ")}`;
            break;
        case ZodIssueCode.invalid_union:
            message = `Invalid input`;
            break;
        case ZodIssueCode.invalid_union_discriminator:
            message = `Invalid discriminator value. Expected ${util$1.joinValues(issue.options)}`;
            break;
        case ZodIssueCode.invalid_enum_value:
            message = `Invalid enum value. Expected ${util$1.joinValues(issue.options)}, received '${issue.received}'`;
            break;
        case ZodIssueCode.invalid_arguments:
            message = `Invalid function arguments`;
            break;
        case ZodIssueCode.invalid_return_type:
            message = `Invalid function return type`;
            break;
        case ZodIssueCode.invalid_date:
            message = `Invalid date`;
            break;
        case ZodIssueCode.invalid_string:
            if (typeof issue.validation === "object") {
                if ("includes" in issue.validation) {
                    message = `Invalid input: must include "${issue.validation.includes}"`;
                    if (typeof issue.validation.position === "number") {
                        message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
                    }
                }
                else if ("startsWith" in issue.validation) {
                    message = `Invalid input: must start with "${issue.validation.startsWith}"`;
                }
                else if ("endsWith" in issue.validation) {
                    message = `Invalid input: must end with "${issue.validation.endsWith}"`;
                }
                else {
                    util$1.assertNever(issue.validation);
                }
            }
            else if (issue.validation !== "regex") {
                message = `Invalid ${issue.validation}`;
            }
            else {
                message = "Invalid";
            }
            break;
        case ZodIssueCode.too_small:
            if (issue.type === "array")
                message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
            else if (issue.type === "string")
                message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
            else if (issue.type === "number")
                message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
            else if (issue.type === "bigint")
                message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
            else if (issue.type === "date")
                message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
            else
                message = "Invalid input";
            break;
        case ZodIssueCode.too_big:
            if (issue.type === "array")
                message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
            else if (issue.type === "string")
                message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
            else if (issue.type === "number")
                message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
            else if (issue.type === "bigint")
                message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
            else if (issue.type === "date")
                message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
            else
                message = "Invalid input";
            break;
        case ZodIssueCode.custom:
            message = `Invalid input`;
            break;
        case ZodIssueCode.invalid_intersection_types:
            message = `Intersection results could not be merged`;
            break;
        case ZodIssueCode.not_multiple_of:
            message = `Number must be a multiple of ${issue.multipleOf}`;
            break;
        case ZodIssueCode.not_finite:
            message = "Number must be finite";
            break;
        default:
            message = _ctx.defaultError;
            util$1.assertNever(issue);
    }
    return { message };
};

let overrideErrorMap = errorMap;
function getErrorMap() {
    return overrideErrorMap;
}

const makeIssue = (params) => {
    const { data, path, errorMaps, issueData } = params;
    const fullPath = [...path, ...(issueData.path || [])];
    const fullIssue = {
        ...issueData,
        path: fullPath,
    };
    if (issueData.message !== undefined) {
        return {
            ...issueData,
            path: fullPath,
            message: issueData.message,
        };
    }
    let errorMessage = "";
    const maps = errorMaps
        .filter((m) => !!m)
        .slice()
        .reverse();
    for (const map of maps) {
        errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
    }
    return {
        ...issueData,
        path: fullPath,
        message: errorMessage,
    };
};
function addIssueToContext(ctx, issueData) {
    const overrideMap = getErrorMap();
    const issue = makeIssue({
        issueData: issueData,
        data: ctx.data,
        path: ctx.path,
        errorMaps: [
            ctx.common.contextualErrorMap, // contextual error map is first priority
            ctx.schemaErrorMap, // then schema-bound map if available
            overrideMap, // then global override map
            overrideMap === errorMap ? undefined : errorMap, // then global default map
        ].filter((x) => !!x),
    });
    ctx.common.issues.push(issue);
}
class ParseStatus {
    constructor() {
        this.value = "valid";
    }
    dirty() {
        if (this.value === "valid")
            this.value = "dirty";
    }
    abort() {
        if (this.value !== "aborted")
            this.value = "aborted";
    }
    static mergeArray(status, results) {
        const arrayValue = [];
        for (const s of results) {
            if (s.status === "aborted")
                return INVALID;
            if (s.status === "dirty")
                status.dirty();
            arrayValue.push(s.value);
        }
        return { status: status.value, value: arrayValue };
    }
    static async mergeObjectAsync(status, pairs) {
        const syncPairs = [];
        for (const pair of pairs) {
            const key = await pair.key;
            const value = await pair.value;
            syncPairs.push({
                key,
                value,
            });
        }
        return ParseStatus.mergeObjectSync(status, syncPairs);
    }
    static mergeObjectSync(status, pairs) {
        const finalObject = {};
        for (const pair of pairs) {
            const { key, value } = pair;
            if (key.status === "aborted")
                return INVALID;
            if (value.status === "aborted")
                return INVALID;
            if (key.status === "dirty")
                status.dirty();
            if (value.status === "dirty")
                status.dirty();
            if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
                finalObject[key.value] = value.value;
            }
        }
        return { status: status.value, value: finalObject };
    }
}
const INVALID = Object.freeze({
    status: "aborted",
});
const DIRTY = (value) => ({ status: "dirty", value });
const OK = (value) => ({ status: "valid", value });
const isAborted = (x) => x.status === "aborted";
const isDirty = (x) => x.status === "dirty";
const isValid = (x) => x.status === "valid";
const isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

var errorUtil;
(function (errorUtil) {
    errorUtil.errToObj = (message) => typeof message === "string" ? { message } : message || {};
    // biome-ignore lint:
    errorUtil.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

class ParseInputLazyPath {
    constructor(parent, value, path, key) {
        this._cachedPath = [];
        this.parent = parent;
        this.data = value;
        this._path = path;
        this._key = key;
    }
    get path() {
        if (!this._cachedPath.length) {
            if (Array.isArray(this._key)) {
                this._cachedPath.push(...this._path, ...this._key);
            }
            else {
                this._cachedPath.push(...this._path, this._key);
            }
        }
        return this._cachedPath;
    }
}
const handleResult = (ctx, result) => {
    if (isValid(result)) {
        return { success: true, data: result.value };
    }
    else {
        if (!ctx.common.issues.length) {
            throw new Error("Validation failed but no issues detected.");
        }
        return {
            success: false,
            get error() {
                if (this._error)
                    return this._error;
                const error = new ZodError(ctx.common.issues);
                this._error = error;
                return this._error;
            },
        };
    }
};
function processCreateParams(params) {
    if (!params)
        return {};
    const { errorMap, invalid_type_error, required_error, description } = params;
    if (errorMap && (invalid_type_error || required_error)) {
        throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
    }
    if (errorMap)
        return { errorMap: errorMap, description };
    const customMap = (iss, ctx) => {
        const { message } = params;
        if (iss.code === "invalid_enum_value") {
            return { message: message ?? ctx.defaultError };
        }
        if (typeof ctx.data === "undefined") {
            return { message: message ?? required_error ?? ctx.defaultError };
        }
        if (iss.code !== "invalid_type")
            return { message: ctx.defaultError };
        return { message: message ?? invalid_type_error ?? ctx.defaultError };
    };
    return { errorMap: customMap, description };
}
class ZodType {
    get description() {
        return this._def.description;
    }
    _getType(input) {
        return getParsedType(input.data);
    }
    _getOrReturnCtx(input, ctx) {
        return (ctx || {
            common: input.parent.common,
            data: input.data,
            parsedType: getParsedType(input.data),
            schemaErrorMap: this._def.errorMap,
            path: input.path,
            parent: input.parent,
        });
    }
    _processInputParams(input) {
        return {
            status: new ParseStatus(),
            ctx: {
                common: input.parent.common,
                data: input.data,
                parsedType: getParsedType(input.data),
                schemaErrorMap: this._def.errorMap,
                path: input.path,
                parent: input.parent,
            },
        };
    }
    _parseSync(input) {
        const result = this._parse(input);
        if (isAsync(result)) {
            throw new Error("Synchronous parse encountered promise.");
        }
        return result;
    }
    _parseAsync(input) {
        const result = this._parse(input);
        return Promise.resolve(result);
    }
    parse(data, params) {
        const result = this.safeParse(data, params);
        if (result.success)
            return result.data;
        throw result.error;
    }
    safeParse(data, params) {
        const ctx = {
            common: {
                issues: [],
                async: params?.async ?? false,
                contextualErrorMap: params?.errorMap,
            },
            path: params?.path || [],
            schemaErrorMap: this._def.errorMap,
            parent: null,
            data,
            parsedType: getParsedType(data),
        };
        const result = this._parseSync({ data, path: ctx.path, parent: ctx });
        return handleResult(ctx, result);
    }
    "~validate"(data) {
        const ctx = {
            common: {
                issues: [],
                async: !!this["~standard"].async,
            },
            path: [],
            schemaErrorMap: this._def.errorMap,
            parent: null,
            data,
            parsedType: getParsedType(data),
        };
        if (!this["~standard"].async) {
            try {
                const result = this._parseSync({ data, path: [], parent: ctx });
                return isValid(result)
                    ? {
                        value: result.value,
                    }
                    : {
                        issues: ctx.common.issues,
                    };
            }
            catch (err) {
                if (err?.message?.toLowerCase()?.includes("encountered")) {
                    this["~standard"].async = true;
                }
                ctx.common = {
                    issues: [],
                    async: true,
                };
            }
        }
        return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result)
            ? {
                value: result.value,
            }
            : {
                issues: ctx.common.issues,
            });
    }
    async parseAsync(data, params) {
        const result = await this.safeParseAsync(data, params);
        if (result.success)
            return result.data;
        throw result.error;
    }
    async safeParseAsync(data, params) {
        const ctx = {
            common: {
                issues: [],
                contextualErrorMap: params?.errorMap,
                async: true,
            },
            path: params?.path || [],
            schemaErrorMap: this._def.errorMap,
            parent: null,
            data,
            parsedType: getParsedType(data),
        };
        const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
        const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
        return handleResult(ctx, result);
    }
    refine(check, message) {
        const getIssueProperties = (val) => {
            if (typeof message === "string" || typeof message === "undefined") {
                return { message };
            }
            else if (typeof message === "function") {
                return message(val);
            }
            else {
                return message;
            }
        };
        return this._refinement((val, ctx) => {
            const result = check(val);
            const setError = () => ctx.addIssue({
                code: ZodIssueCode.custom,
                ...getIssueProperties(val),
            });
            if (typeof Promise !== "undefined" && result instanceof Promise) {
                return result.then((data) => {
                    if (!data) {
                        setError();
                        return false;
                    }
                    else {
                        return true;
                    }
                });
            }
            if (!result) {
                setError();
                return false;
            }
            else {
                return true;
            }
        });
    }
    refinement(check, refinementData) {
        return this._refinement((val, ctx) => {
            if (!check(val)) {
                ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
                return false;
            }
            else {
                return true;
            }
        });
    }
    _refinement(refinement) {
        return new ZodEffects({
            schema: this,
            typeName: ZodFirstPartyTypeKind.ZodEffects,
            effect: { type: "refinement", refinement },
        });
    }
    superRefine(refinement) {
        return this._refinement(refinement);
    }
    constructor(def) {
        /** Alias of safeParseAsync */
        this.spa = this.safeParseAsync;
        this._def = def;
        this.parse = this.parse.bind(this);
        this.safeParse = this.safeParse.bind(this);
        this.parseAsync = this.parseAsync.bind(this);
        this.safeParseAsync = this.safeParseAsync.bind(this);
        this.spa = this.spa.bind(this);
        this.refine = this.refine.bind(this);
        this.refinement = this.refinement.bind(this);
        this.superRefine = this.superRefine.bind(this);
        this.optional = this.optional.bind(this);
        this.nullable = this.nullable.bind(this);
        this.nullish = this.nullish.bind(this);
        this.array = this.array.bind(this);
        this.promise = this.promise.bind(this);
        this.or = this.or.bind(this);
        this.and = this.and.bind(this);
        this.transform = this.transform.bind(this);
        this.brand = this.brand.bind(this);
        this.default = this.default.bind(this);
        this.catch = this.catch.bind(this);
        this.describe = this.describe.bind(this);
        this.pipe = this.pipe.bind(this);
        this.readonly = this.readonly.bind(this);
        this.isNullable = this.isNullable.bind(this);
        this.isOptional = this.isOptional.bind(this);
        this["~standard"] = {
            version: 1,
            vendor: "zod",
            validate: (data) => this["~validate"](data),
        };
    }
    optional() {
        return ZodOptional.create(this, this._def);
    }
    nullable() {
        return ZodNullable.create(this, this._def);
    }
    nullish() {
        return this.nullable().optional();
    }
    array() {
        return ZodArray.create(this);
    }
    promise() {
        return ZodPromise.create(this, this._def);
    }
    or(option) {
        return ZodUnion.create([this, option], this._def);
    }
    and(incoming) {
        return ZodIntersection.create(this, incoming, this._def);
    }
    transform(transform) {
        return new ZodEffects({
            ...processCreateParams(this._def),
            schema: this,
            typeName: ZodFirstPartyTypeKind.ZodEffects,
            effect: { type: "transform", transform },
        });
    }
    default(def) {
        const defaultValueFunc = typeof def === "function" ? def : () => def;
        return new ZodDefault({
            ...processCreateParams(this._def),
            innerType: this,
            defaultValue: defaultValueFunc,
            typeName: ZodFirstPartyTypeKind.ZodDefault,
        });
    }
    brand() {
        return new ZodBranded({
            typeName: ZodFirstPartyTypeKind.ZodBranded,
            type: this,
            ...processCreateParams(this._def),
        });
    }
    catch(def) {
        const catchValueFunc = typeof def === "function" ? def : () => def;
        return new ZodCatch({
            ...processCreateParams(this._def),
            innerType: this,
            catchValue: catchValueFunc,
            typeName: ZodFirstPartyTypeKind.ZodCatch,
        });
    }
    describe(description) {
        const This = this.constructor;
        return new This({
            ...this._def,
            description,
        });
    }
    pipe(target) {
        return ZodPipeline.create(this, target);
    }
    readonly() {
        return ZodReadonly.create(this);
    }
    isOptional() {
        return this.safeParse(undefined).success;
    }
    isNullable() {
        return this.safeParse(null).success;
    }
}
const cuidRegex = /^c[^\s-]{8,}$/i;
const cuid2Regex = /^[0-9a-z]+$/;
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
// const uuidRegex =
//   /^([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}|00000000-0000-0000-0000-000000000000)$/i;
const uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
const nanoidRegex = /^[a-z0-9_-]{21}$/i;
const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
const durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
// from https://stackoverflow.com/a/46181/1550155
// old version: too slow, didn't support unicode
// const emailRegex = /^((([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+(\.([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))$/i;
//old email regex
// const emailRegex = /^(([^<>()[\].,;:\s@"]+(\.[^<>()[\].,;:\s@"]+)*)|(".+"))@((?!-)([^<>()[\].,;:\s@"]+\.)+[^<>()[\].,;:\s@"]{1,})[^-<>()[\].,;:\s@"]$/i;
// eslint-disable-next-line
// const emailRegex =
//   /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\])|(\[IPv6:(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))\])|([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])*(\.[A-Za-z]{2,})+))$/;
// const emailRegex =
//   /^[a-zA-Z0-9\.\!\#\$\%\&\'\*\+\/\=\?\^\_\`\{\|\}\~\-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
// const emailRegex =
//   /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
const emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
// const emailRegex =
//   /^[a-z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9\-]+)*$/i;
// from https://thekevinscott.com/emojis-in-javascript/#writing-a-regular-expression
const _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
let emojiRegex;
// faster, simpler, safer
const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
// const ipv6Regex =
// /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/;
const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
const ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
// https://stackoverflow.com/questions/7860392/determine-if-string-is-in-base64-using-javascript
const base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
// https://base64.guru/standards/base64url
const base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
// simple
// const dateRegexSource = `\\d{4}-\\d{2}-\\d{2}`;
// no leap year validation
// const dateRegexSource = `\\d{4}-((0[13578]|10|12)-31|(0[13-9]|1[0-2])-30|(0[1-9]|1[0-2])-(0[1-9]|1\\d|2\\d))`;
// with leap year validation
const dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
const dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
    let secondsRegexSource = `[0-5]\\d`;
    if (args.precision) {
        secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
    }
    else if (args.precision == null) {
        secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
    }
    const secondsQuantifier = args.precision ? "+" : "?"; // require seconds if precision is nonzero
    return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
    return new RegExp(`^${timeRegexSource(args)}$`);
}
// Adapted from https://stackoverflow.com/a/3143231
function datetimeRegex(args) {
    let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
    const opts = [];
    opts.push(args.local ? `Z?` : `Z`);
    if (args.offset)
        opts.push(`([+-]\\d{2}:?\\d{2})`);
    regex = `${regex}(${opts.join("|")})`;
    return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
    if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
        return true;
    }
    if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
        return true;
    }
    return false;
}
function isValidJWT(jwt, alg) {
    if (!jwtRegex.test(jwt))
        return false;
    try {
        const [header] = jwt.split(".");
        if (!header)
            return false;
        // Convert base64url to base64
        const base64 = header
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(header.length + ((4 - (header.length % 4)) % 4), "=");
        const decoded = JSON.parse(atob(base64));
        if (typeof decoded !== "object" || decoded === null)
            return false;
        if ("typ" in decoded && decoded?.typ !== "JWT")
            return false;
        if (!decoded.alg)
            return false;
        if (alg && decoded.alg !== alg)
            return false;
        return true;
    }
    catch {
        return false;
    }
}
function isValidCidr(ip, version) {
    if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
        return true;
    }
    if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
        return true;
    }
    return false;
}
class ZodString extends ZodType {
    _parse(input) {
        if (this._def.coerce) {
            input.data = String(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.string) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.string,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const status = new ParseStatus();
        let ctx = undefined;
        for (const check of this._def.checks) {
            if (check.kind === "min") {
                if (input.data.length < check.value) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_small,
                        minimum: check.value,
                        type: "string",
                        inclusive: true,
                        exact: false,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "max") {
                if (input.data.length > check.value) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_big,
                        maximum: check.value,
                        type: "string",
                        inclusive: true,
                        exact: false,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "length") {
                const tooBig = input.data.length > check.value;
                const tooSmall = input.data.length < check.value;
                if (tooBig || tooSmall) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    if (tooBig) {
                        addIssueToContext(ctx, {
                            code: ZodIssueCode.too_big,
                            maximum: check.value,
                            type: "string",
                            inclusive: true,
                            exact: true,
                            message: check.message,
                        });
                    }
                    else if (tooSmall) {
                        addIssueToContext(ctx, {
                            code: ZodIssueCode.too_small,
                            minimum: check.value,
                            type: "string",
                            inclusive: true,
                            exact: true,
                            message: check.message,
                        });
                    }
                    status.dirty();
                }
            }
            else if (check.kind === "email") {
                if (!emailRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "email",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "emoji") {
                if (!emojiRegex) {
                    emojiRegex = new RegExp(_emojiRegex, "u");
                }
                if (!emojiRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "emoji",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "uuid") {
                if (!uuidRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "uuid",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "nanoid") {
                if (!nanoidRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "nanoid",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "cuid") {
                if (!cuidRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "cuid",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "cuid2") {
                if (!cuid2Regex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "cuid2",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "ulid") {
                if (!ulidRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "ulid",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "url") {
                try {
                    new URL(input.data);
                }
                catch {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "url",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "regex") {
                check.regex.lastIndex = 0;
                const testResult = check.regex.test(input.data);
                if (!testResult) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "regex",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "trim") {
                input.data = input.data.trim();
            }
            else if (check.kind === "includes") {
                if (!input.data.includes(check.value, check.position)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_string,
                        validation: { includes: check.value, position: check.position },
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "toLowerCase") {
                input.data = input.data.toLowerCase();
            }
            else if (check.kind === "toUpperCase") {
                input.data = input.data.toUpperCase();
            }
            else if (check.kind === "startsWith") {
                if (!input.data.startsWith(check.value)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_string,
                        validation: { startsWith: check.value },
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "endsWith") {
                if (!input.data.endsWith(check.value)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_string,
                        validation: { endsWith: check.value },
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "datetime") {
                const regex = datetimeRegex(check);
                if (!regex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_string,
                        validation: "datetime",
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "date") {
                const regex = dateRegex;
                if (!regex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_string,
                        validation: "date",
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "time") {
                const regex = timeRegex(check);
                if (!regex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_string,
                        validation: "time",
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "duration") {
                if (!durationRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "duration",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "ip") {
                if (!isValidIP(input.data, check.version)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "ip",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "jwt") {
                if (!isValidJWT(input.data, check.alg)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "jwt",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "cidr") {
                if (!isValidCidr(input.data, check.version)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "cidr",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "base64") {
                if (!base64Regex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "base64",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "base64url") {
                if (!base64urlRegex.test(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        validation: "base64url",
                        code: ZodIssueCode.invalid_string,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else {
                util$1.assertNever(check);
            }
        }
        return { status: status.value, value: input.data };
    }
    _regex(regex, validation, message) {
        return this.refinement((data) => regex.test(data), {
            validation,
            code: ZodIssueCode.invalid_string,
            ...errorUtil.errToObj(message),
        });
    }
    _addCheck(check) {
        return new ZodString({
            ...this._def,
            checks: [...this._def.checks, check],
        });
    }
    email(message) {
        return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
    }
    url(message) {
        return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
    }
    emoji(message) {
        return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
    }
    uuid(message) {
        return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
    }
    nanoid(message) {
        return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
    }
    cuid(message) {
        return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
    }
    cuid2(message) {
        return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
    }
    ulid(message) {
        return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
    }
    base64(message) {
        return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
    }
    base64url(message) {
        // base64url encoding is a modification of base64 that can safely be used in URLs and filenames
        return this._addCheck({
            kind: "base64url",
            ...errorUtil.errToObj(message),
        });
    }
    jwt(options) {
        return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
    }
    ip(options) {
        return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
    }
    cidr(options) {
        return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
    }
    datetime(options) {
        if (typeof options === "string") {
            return this._addCheck({
                kind: "datetime",
                precision: null,
                offset: false,
                local: false,
                message: options,
            });
        }
        return this._addCheck({
            kind: "datetime",
            precision: typeof options?.precision === "undefined" ? null : options?.precision,
            offset: options?.offset ?? false,
            local: options?.local ?? false,
            ...errorUtil.errToObj(options?.message),
        });
    }
    date(message) {
        return this._addCheck({ kind: "date", message });
    }
    time(options) {
        if (typeof options === "string") {
            return this._addCheck({
                kind: "time",
                precision: null,
                message: options,
            });
        }
        return this._addCheck({
            kind: "time",
            precision: typeof options?.precision === "undefined" ? null : options?.precision,
            ...errorUtil.errToObj(options?.message),
        });
    }
    duration(message) {
        return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
    }
    regex(regex, message) {
        return this._addCheck({
            kind: "regex",
            regex: regex,
            ...errorUtil.errToObj(message),
        });
    }
    includes(value, options) {
        return this._addCheck({
            kind: "includes",
            value: value,
            position: options?.position,
            ...errorUtil.errToObj(options?.message),
        });
    }
    startsWith(value, message) {
        return this._addCheck({
            kind: "startsWith",
            value: value,
            ...errorUtil.errToObj(message),
        });
    }
    endsWith(value, message) {
        return this._addCheck({
            kind: "endsWith",
            value: value,
            ...errorUtil.errToObj(message),
        });
    }
    min(minLength, message) {
        return this._addCheck({
            kind: "min",
            value: minLength,
            ...errorUtil.errToObj(message),
        });
    }
    max(maxLength, message) {
        return this._addCheck({
            kind: "max",
            value: maxLength,
            ...errorUtil.errToObj(message),
        });
    }
    length(len, message) {
        return this._addCheck({
            kind: "length",
            value: len,
            ...errorUtil.errToObj(message),
        });
    }
    /**
     * Equivalent to `.min(1)`
     */
    nonempty(message) {
        return this.min(1, errorUtil.errToObj(message));
    }
    trim() {
        return new ZodString({
            ...this._def,
            checks: [...this._def.checks, { kind: "trim" }],
        });
    }
    toLowerCase() {
        return new ZodString({
            ...this._def,
            checks: [...this._def.checks, { kind: "toLowerCase" }],
        });
    }
    toUpperCase() {
        return new ZodString({
            ...this._def,
            checks: [...this._def.checks, { kind: "toUpperCase" }],
        });
    }
    get isDatetime() {
        return !!this._def.checks.find((ch) => ch.kind === "datetime");
    }
    get isDate() {
        return !!this._def.checks.find((ch) => ch.kind === "date");
    }
    get isTime() {
        return !!this._def.checks.find((ch) => ch.kind === "time");
    }
    get isDuration() {
        return !!this._def.checks.find((ch) => ch.kind === "duration");
    }
    get isEmail() {
        return !!this._def.checks.find((ch) => ch.kind === "email");
    }
    get isURL() {
        return !!this._def.checks.find((ch) => ch.kind === "url");
    }
    get isEmoji() {
        return !!this._def.checks.find((ch) => ch.kind === "emoji");
    }
    get isUUID() {
        return !!this._def.checks.find((ch) => ch.kind === "uuid");
    }
    get isNANOID() {
        return !!this._def.checks.find((ch) => ch.kind === "nanoid");
    }
    get isCUID() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid");
    }
    get isCUID2() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid2");
    }
    get isULID() {
        return !!this._def.checks.find((ch) => ch.kind === "ulid");
    }
    get isIP() {
        return !!this._def.checks.find((ch) => ch.kind === "ip");
    }
    get isCIDR() {
        return !!this._def.checks.find((ch) => ch.kind === "cidr");
    }
    get isBase64() {
        return !!this._def.checks.find((ch) => ch.kind === "base64");
    }
    get isBase64url() {
        // base64url encoding is a modification of base64 that can safely be used in URLs and filenames
        return !!this._def.checks.find((ch) => ch.kind === "base64url");
    }
    get minLength() {
        let min = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "min") {
                if (min === null || ch.value > min)
                    min = ch.value;
            }
        }
        return min;
    }
    get maxLength() {
        let max = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "max") {
                if (max === null || ch.value < max)
                    max = ch.value;
            }
        }
        return max;
    }
}
ZodString.create = (params) => {
    return new ZodString({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodString,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params),
    });
};
// https://stackoverflow.com/questions/3966484/why-does-modulus-operator-return-fractional-number-in-javascript/31711034#31711034
function floatSafeRemainder(val, step) {
    const valDecCount = (val.toString().split(".")[1] || "").length;
    const stepDecCount = (step.toString().split(".")[1] || "").length;
    const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
    const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
    const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
    return (valInt % stepInt) / 10 ** decCount;
}
class ZodNumber extends ZodType {
    constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
        this.step = this.multipleOf;
    }
    _parse(input) {
        if (this._def.coerce) {
            input.data = Number(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.number) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.number,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        let ctx = undefined;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
            if (check.kind === "int") {
                if (!util$1.isInteger(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.invalid_type,
                        expected: "integer",
                        received: "float",
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "min") {
                const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
                if (tooSmall) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_small,
                        minimum: check.value,
                        type: "number",
                        inclusive: check.inclusive,
                        exact: false,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "max") {
                const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
                if (tooBig) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_big,
                        maximum: check.value,
                        type: "number",
                        inclusive: check.inclusive,
                        exact: false,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "multipleOf") {
                if (floatSafeRemainder(input.data, check.value) !== 0) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.not_multiple_of,
                        multipleOf: check.value,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "finite") {
                if (!Number.isFinite(input.data)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.not_finite,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else {
                util$1.assertNever(check);
            }
        }
        return { status: status.value, value: input.data };
    }
    gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
    }
    gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
    }
    lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
    }
    lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
    }
    setLimit(kind, value, inclusive, message) {
        return new ZodNumber({
            ...this._def,
            checks: [
                ...this._def.checks,
                {
                    kind,
                    value,
                    inclusive,
                    message: errorUtil.toString(message),
                },
            ],
        });
    }
    _addCheck(check) {
        return new ZodNumber({
            ...this._def,
            checks: [...this._def.checks, check],
        });
    }
    int(message) {
        return this._addCheck({
            kind: "int",
            message: errorUtil.toString(message),
        });
    }
    positive(message) {
        return this._addCheck({
            kind: "min",
            value: 0,
            inclusive: false,
            message: errorUtil.toString(message),
        });
    }
    negative(message) {
        return this._addCheck({
            kind: "max",
            value: 0,
            inclusive: false,
            message: errorUtil.toString(message),
        });
    }
    nonpositive(message) {
        return this._addCheck({
            kind: "max",
            value: 0,
            inclusive: true,
            message: errorUtil.toString(message),
        });
    }
    nonnegative(message) {
        return this._addCheck({
            kind: "min",
            value: 0,
            inclusive: true,
            message: errorUtil.toString(message),
        });
    }
    multipleOf(value, message) {
        return this._addCheck({
            kind: "multipleOf",
            value: value,
            message: errorUtil.toString(message),
        });
    }
    finite(message) {
        return this._addCheck({
            kind: "finite",
            message: errorUtil.toString(message),
        });
    }
    safe(message) {
        return this._addCheck({
            kind: "min",
            inclusive: true,
            value: Number.MIN_SAFE_INTEGER,
            message: errorUtil.toString(message),
        })._addCheck({
            kind: "max",
            inclusive: true,
            value: Number.MAX_SAFE_INTEGER,
            message: errorUtil.toString(message),
        });
    }
    get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "min") {
                if (min === null || ch.value > min)
                    min = ch.value;
            }
        }
        return min;
    }
    get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "max") {
                if (max === null || ch.value < max)
                    max = ch.value;
            }
        }
        return max;
    }
    get isInt() {
        return !!this._def.checks.find((ch) => ch.kind === "int" || (ch.kind === "multipleOf" && util$1.isInteger(ch.value)));
    }
    get isFinite() {
        let max = null;
        let min = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
                return true;
            }
            else if (ch.kind === "min") {
                if (min === null || ch.value > min)
                    min = ch.value;
            }
            else if (ch.kind === "max") {
                if (max === null || ch.value < max)
                    max = ch.value;
            }
        }
        return Number.isFinite(min) && Number.isFinite(max);
    }
}
ZodNumber.create = (params) => {
    return new ZodNumber({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodNumber,
        coerce: params?.coerce || false,
        ...processCreateParams(params),
    });
};
class ZodBigInt extends ZodType {
    constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
    }
    _parse(input) {
        if (this._def.coerce) {
            try {
                input.data = BigInt(input.data);
            }
            catch {
                return this._getInvalidInput(input);
            }
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.bigint) {
            return this._getInvalidInput(input);
        }
        let ctx = undefined;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
            if (check.kind === "min") {
                const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
                if (tooSmall) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_small,
                        type: "bigint",
                        minimum: check.value,
                        inclusive: check.inclusive,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "max") {
                const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
                if (tooBig) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_big,
                        type: "bigint",
                        maximum: check.value,
                        inclusive: check.inclusive,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "multipleOf") {
                if (input.data % check.value !== BigInt(0)) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.not_multiple_of,
                        multipleOf: check.value,
                        message: check.message,
                    });
                    status.dirty();
                }
            }
            else {
                util$1.assertNever(check);
            }
        }
        return { status: status.value, value: input.data };
    }
    _getInvalidInput(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.bigint,
            received: ctx.parsedType,
        });
        return INVALID;
    }
    gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
    }
    gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
    }
    lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
    }
    lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
    }
    setLimit(kind, value, inclusive, message) {
        return new ZodBigInt({
            ...this._def,
            checks: [
                ...this._def.checks,
                {
                    kind,
                    value,
                    inclusive,
                    message: errorUtil.toString(message),
                },
            ],
        });
    }
    _addCheck(check) {
        return new ZodBigInt({
            ...this._def,
            checks: [...this._def.checks, check],
        });
    }
    positive(message) {
        return this._addCheck({
            kind: "min",
            value: BigInt(0),
            inclusive: false,
            message: errorUtil.toString(message),
        });
    }
    negative(message) {
        return this._addCheck({
            kind: "max",
            value: BigInt(0),
            inclusive: false,
            message: errorUtil.toString(message),
        });
    }
    nonpositive(message) {
        return this._addCheck({
            kind: "max",
            value: BigInt(0),
            inclusive: true,
            message: errorUtil.toString(message),
        });
    }
    nonnegative(message) {
        return this._addCheck({
            kind: "min",
            value: BigInt(0),
            inclusive: true,
            message: errorUtil.toString(message),
        });
    }
    multipleOf(value, message) {
        return this._addCheck({
            kind: "multipleOf",
            value,
            message: errorUtil.toString(message),
        });
    }
    get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "min") {
                if (min === null || ch.value > min)
                    min = ch.value;
            }
        }
        return min;
    }
    get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "max") {
                if (max === null || ch.value < max)
                    max = ch.value;
            }
        }
        return max;
    }
}
ZodBigInt.create = (params) => {
    return new ZodBigInt({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodBigInt,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params),
    });
};
class ZodBoolean extends ZodType {
    _parse(input) {
        if (this._def.coerce) {
            input.data = Boolean(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.boolean) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.boolean,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        return OK(input.data);
    }
}
ZodBoolean.create = (params) => {
    return new ZodBoolean({
        typeName: ZodFirstPartyTypeKind.ZodBoolean,
        coerce: params?.coerce || false,
        ...processCreateParams(params),
    });
};
class ZodDate extends ZodType {
    _parse(input) {
        if (this._def.coerce) {
            input.data = new Date(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.date) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.date,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        if (Number.isNaN(input.data.getTime())) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_date,
            });
            return INVALID;
        }
        const status = new ParseStatus();
        let ctx = undefined;
        for (const check of this._def.checks) {
            if (check.kind === "min") {
                if (input.data.getTime() < check.value) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_small,
                        message: check.message,
                        inclusive: true,
                        exact: false,
                        minimum: check.value,
                        type: "date",
                    });
                    status.dirty();
                }
            }
            else if (check.kind === "max") {
                if (input.data.getTime() > check.value) {
                    ctx = this._getOrReturnCtx(input, ctx);
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.too_big,
                        message: check.message,
                        inclusive: true,
                        exact: false,
                        maximum: check.value,
                        type: "date",
                    });
                    status.dirty();
                }
            }
            else {
                util$1.assertNever(check);
            }
        }
        return {
            status: status.value,
            value: new Date(input.data.getTime()),
        };
    }
    _addCheck(check) {
        return new ZodDate({
            ...this._def,
            checks: [...this._def.checks, check],
        });
    }
    min(minDate, message) {
        return this._addCheck({
            kind: "min",
            value: minDate.getTime(),
            message: errorUtil.toString(message),
        });
    }
    max(maxDate, message) {
        return this._addCheck({
            kind: "max",
            value: maxDate.getTime(),
            message: errorUtil.toString(message),
        });
    }
    get minDate() {
        let min = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "min") {
                if (min === null || ch.value > min)
                    min = ch.value;
            }
        }
        return min != null ? new Date(min) : null;
    }
    get maxDate() {
        let max = null;
        for (const ch of this._def.checks) {
            if (ch.kind === "max") {
                if (max === null || ch.value < max)
                    max = ch.value;
            }
        }
        return max != null ? new Date(max) : null;
    }
}
ZodDate.create = (params) => {
    return new ZodDate({
        checks: [],
        coerce: params?.coerce || false,
        typeName: ZodFirstPartyTypeKind.ZodDate,
        ...processCreateParams(params),
    });
};
class ZodSymbol extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.symbol) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.symbol,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        return OK(input.data);
    }
}
ZodSymbol.create = (params) => {
    return new ZodSymbol({
        typeName: ZodFirstPartyTypeKind.ZodSymbol,
        ...processCreateParams(params),
    });
};
class ZodUndefined extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.undefined,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        return OK(input.data);
    }
}
ZodUndefined.create = (params) => {
    return new ZodUndefined({
        typeName: ZodFirstPartyTypeKind.ZodUndefined,
        ...processCreateParams(params),
    });
};
class ZodNull extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.null) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.null,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        return OK(input.data);
    }
}
ZodNull.create = (params) => {
    return new ZodNull({
        typeName: ZodFirstPartyTypeKind.ZodNull,
        ...processCreateParams(params),
    });
};
class ZodAny extends ZodType {
    constructor() {
        super(...arguments);
        // to prevent instances of other classes from extending ZodAny. this causes issues with catchall in ZodObject.
        this._any = true;
    }
    _parse(input) {
        return OK(input.data);
    }
}
ZodAny.create = (params) => {
    return new ZodAny({
        typeName: ZodFirstPartyTypeKind.ZodAny,
        ...processCreateParams(params),
    });
};
class ZodUnknown extends ZodType {
    constructor() {
        super(...arguments);
        // required
        this._unknown = true;
    }
    _parse(input) {
        return OK(input.data);
    }
}
ZodUnknown.create = (params) => {
    return new ZodUnknown({
        typeName: ZodFirstPartyTypeKind.ZodUnknown,
        ...processCreateParams(params),
    });
};
class ZodNever extends ZodType {
    _parse(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.never,
            received: ctx.parsedType,
        });
        return INVALID;
    }
}
ZodNever.create = (params) => {
    return new ZodNever({
        typeName: ZodFirstPartyTypeKind.ZodNever,
        ...processCreateParams(params),
    });
};
class ZodVoid extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.void,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        return OK(input.data);
    }
}
ZodVoid.create = (params) => {
    return new ZodVoid({
        typeName: ZodFirstPartyTypeKind.ZodVoid,
        ...processCreateParams(params),
    });
};
class ZodArray extends ZodType {
    _parse(input) {
        const { ctx, status } = this._processInputParams(input);
        const def = this._def;
        if (ctx.parsedType !== ZodParsedType.array) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.array,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        if (def.exactLength !== null) {
            const tooBig = ctx.data.length > def.exactLength.value;
            const tooSmall = ctx.data.length < def.exactLength.value;
            if (tooBig || tooSmall) {
                addIssueToContext(ctx, {
                    code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
                    minimum: (tooSmall ? def.exactLength.value : undefined),
                    maximum: (tooBig ? def.exactLength.value : undefined),
                    type: "array",
                    inclusive: true,
                    exact: true,
                    message: def.exactLength.message,
                });
                status.dirty();
            }
        }
        if (def.minLength !== null) {
            if (ctx.data.length < def.minLength.value) {
                addIssueToContext(ctx, {
                    code: ZodIssueCode.too_small,
                    minimum: def.minLength.value,
                    type: "array",
                    inclusive: true,
                    exact: false,
                    message: def.minLength.message,
                });
                status.dirty();
            }
        }
        if (def.maxLength !== null) {
            if (ctx.data.length > def.maxLength.value) {
                addIssueToContext(ctx, {
                    code: ZodIssueCode.too_big,
                    maximum: def.maxLength.value,
                    type: "array",
                    inclusive: true,
                    exact: false,
                    message: def.maxLength.message,
                });
                status.dirty();
            }
        }
        if (ctx.common.async) {
            return Promise.all([...ctx.data].map((item, i) => {
                return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
            })).then((result) => {
                return ParseStatus.mergeArray(status, result);
            });
        }
        const result = [...ctx.data].map((item, i) => {
            return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        });
        return ParseStatus.mergeArray(status, result);
    }
    get element() {
        return this._def.type;
    }
    min(minLength, message) {
        return new ZodArray({
            ...this._def,
            minLength: { value: minLength, message: errorUtil.toString(message) },
        });
    }
    max(maxLength, message) {
        return new ZodArray({
            ...this._def,
            maxLength: { value: maxLength, message: errorUtil.toString(message) },
        });
    }
    length(len, message) {
        return new ZodArray({
            ...this._def,
            exactLength: { value: len, message: errorUtil.toString(message) },
        });
    }
    nonempty(message) {
        return this.min(1, message);
    }
}
ZodArray.create = (schema, params) => {
    return new ZodArray({
        type: schema,
        minLength: null,
        maxLength: null,
        exactLength: null,
        typeName: ZodFirstPartyTypeKind.ZodArray,
        ...processCreateParams(params),
    });
};
function deepPartialify(schema) {
    if (schema instanceof ZodObject) {
        const newShape = {};
        for (const key in schema.shape) {
            const fieldSchema = schema.shape[key];
            newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
        }
        return new ZodObject({
            ...schema._def,
            shape: () => newShape,
        });
    }
    else if (schema instanceof ZodArray) {
        return new ZodArray({
            ...schema._def,
            type: deepPartialify(schema.element),
        });
    }
    else if (schema instanceof ZodOptional) {
        return ZodOptional.create(deepPartialify(schema.unwrap()));
    }
    else if (schema instanceof ZodNullable) {
        return ZodNullable.create(deepPartialify(schema.unwrap()));
    }
    else if (schema instanceof ZodTuple) {
        return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
    }
    else {
        return schema;
    }
}
class ZodObject extends ZodType {
    constructor() {
        super(...arguments);
        this._cached = null;
        /**
         * @deprecated In most cases, this is no longer needed - unknown properties are now silently stripped.
         * If you want to pass through unknown properties, use `.passthrough()` instead.
         */
        this.nonstrict = this.passthrough;
        // extend<
        //   Augmentation extends ZodRawShape,
        //   NewOutput extends util.flatten<{
        //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
        //       ? Augmentation[k]["_output"]
        //       : k extends keyof Output
        //       ? Output[k]
        //       : never;
        //   }>,
        //   NewInput extends util.flatten<{
        //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
        //       ? Augmentation[k]["_input"]
        //       : k extends keyof Input
        //       ? Input[k]
        //       : never;
        //   }>
        // >(
        //   augmentation: Augmentation
        // ): ZodObject<
        //   extendShape<T, Augmentation>,
        //   UnknownKeys,
        //   Catchall,
        //   NewOutput,
        //   NewInput
        // > {
        //   return new ZodObject({
        //     ...this._def,
        //     shape: () => ({
        //       ...this._def.shape(),
        //       ...augmentation,
        //     }),
        //   }) as any;
        // }
        /**
         * @deprecated Use `.extend` instead
         *  */
        this.augment = this.extend;
    }
    _getCached() {
        if (this._cached !== null)
            return this._cached;
        const shape = this._def.shape();
        const keys = util$1.objectKeys(shape);
        this._cached = { shape, keys };
        return this._cached;
    }
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.object) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.object,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const { status, ctx } = this._processInputParams(input);
        const { shape, keys: shapeKeys } = this._getCached();
        const extraKeys = [];
        if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
            for (const key in ctx.data) {
                if (!shapeKeys.includes(key)) {
                    extraKeys.push(key);
                }
            }
        }
        const pairs = [];
        for (const key of shapeKeys) {
            const keyValidator = shape[key];
            const value = ctx.data[key];
            pairs.push({
                key: { status: "valid", value: key },
                value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
                alwaysSet: key in ctx.data,
            });
        }
        if (this._def.catchall instanceof ZodNever) {
            const unknownKeys = this._def.unknownKeys;
            if (unknownKeys === "passthrough") {
                for (const key of extraKeys) {
                    pairs.push({
                        key: { status: "valid", value: key },
                        value: { status: "valid", value: ctx.data[key] },
                    });
                }
            }
            else if (unknownKeys === "strict") {
                if (extraKeys.length > 0) {
                    addIssueToContext(ctx, {
                        code: ZodIssueCode.unrecognized_keys,
                        keys: extraKeys,
                    });
                    status.dirty();
                }
            }
            else if (unknownKeys === "strip") ;
            else {
                throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
            }
        }
        else {
            // run catchall validation
            const catchall = this._def.catchall;
            for (const key of extraKeys) {
                const value = ctx.data[key];
                pairs.push({
                    key: { status: "valid", value: key },
                    value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key) //, ctx.child(key), value, getParsedType(value)
                    ),
                    alwaysSet: key in ctx.data,
                });
            }
        }
        if (ctx.common.async) {
            return Promise.resolve()
                .then(async () => {
                const syncPairs = [];
                for (const pair of pairs) {
                    const key = await pair.key;
                    const value = await pair.value;
                    syncPairs.push({
                        key,
                        value,
                        alwaysSet: pair.alwaysSet,
                    });
                }
                return syncPairs;
            })
                .then((syncPairs) => {
                return ParseStatus.mergeObjectSync(status, syncPairs);
            });
        }
        else {
            return ParseStatus.mergeObjectSync(status, pairs);
        }
    }
    get shape() {
        return this._def.shape();
    }
    strict(message) {
        errorUtil.errToObj;
        return new ZodObject({
            ...this._def,
            unknownKeys: "strict",
            ...(message !== undefined
                ? {
                    errorMap: (issue, ctx) => {
                        const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
                        if (issue.code === "unrecognized_keys")
                            return {
                                message: errorUtil.errToObj(message).message ?? defaultError,
                            };
                        return {
                            message: defaultError,
                        };
                    },
                }
                : {}),
        });
    }
    strip() {
        return new ZodObject({
            ...this._def,
            unknownKeys: "strip",
        });
    }
    passthrough() {
        return new ZodObject({
            ...this._def,
            unknownKeys: "passthrough",
        });
    }
    // const AugmentFactory =
    //   <Def extends ZodObjectDef>(def: Def) =>
    //   <Augmentation extends ZodRawShape>(
    //     augmentation: Augmentation
    //   ): ZodObject<
    //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
    //     Def["unknownKeys"],
    //     Def["catchall"]
    //   > => {
    //     return new ZodObject({
    //       ...def,
    //       shape: () => ({
    //         ...def.shape(),
    //         ...augmentation,
    //       }),
    //     }) as any;
    //   };
    extend(augmentation) {
        return new ZodObject({
            ...this._def,
            shape: () => ({
                ...this._def.shape(),
                ...augmentation,
            }),
        });
    }
    /**
     * Prior to zod@1.0.12 there was a bug in the
     * inferred type of merged objects. Please
     * upgrade if you are experiencing issues.
     */
    merge(merging) {
        const merged = new ZodObject({
            unknownKeys: merging._def.unknownKeys,
            catchall: merging._def.catchall,
            shape: () => ({
                ...this._def.shape(),
                ...merging._def.shape(),
            }),
            typeName: ZodFirstPartyTypeKind.ZodObject,
        });
        return merged;
    }
    // merge<
    //   Incoming extends AnyZodObject,
    //   Augmentation extends Incoming["shape"],
    //   NewOutput extends {
    //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
    //       ? Augmentation[k]["_output"]
    //       : k extends keyof Output
    //       ? Output[k]
    //       : never;
    //   },
    //   NewInput extends {
    //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
    //       ? Augmentation[k]["_input"]
    //       : k extends keyof Input
    //       ? Input[k]
    //       : never;
    //   }
    // >(
    //   merging: Incoming
    // ): ZodObject<
    //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
    //   Incoming["_def"]["unknownKeys"],
    //   Incoming["_def"]["catchall"],
    //   NewOutput,
    //   NewInput
    // > {
    //   const merged: any = new ZodObject({
    //     unknownKeys: merging._def.unknownKeys,
    //     catchall: merging._def.catchall,
    //     shape: () =>
    //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
    //     typeName: ZodFirstPartyTypeKind.ZodObject,
    //   }) as any;
    //   return merged;
    // }
    setKey(key, schema) {
        return this.augment({ [key]: schema });
    }
    // merge<Incoming extends AnyZodObject>(
    //   merging: Incoming
    // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
    // ZodObject<
    //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
    //   Incoming["_def"]["unknownKeys"],
    //   Incoming["_def"]["catchall"]
    // > {
    //   // const mergedShape = objectUtil.mergeShapes(
    //   //   this._def.shape(),
    //   //   merging._def.shape()
    //   // );
    //   const merged: any = new ZodObject({
    //     unknownKeys: merging._def.unknownKeys,
    //     catchall: merging._def.catchall,
    //     shape: () =>
    //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
    //     typeName: ZodFirstPartyTypeKind.ZodObject,
    //   }) as any;
    //   return merged;
    // }
    catchall(index) {
        return new ZodObject({
            ...this._def,
            catchall: index,
        });
    }
    pick(mask) {
        const shape = {};
        for (const key of util$1.objectKeys(mask)) {
            if (mask[key] && this.shape[key]) {
                shape[key] = this.shape[key];
            }
        }
        return new ZodObject({
            ...this._def,
            shape: () => shape,
        });
    }
    omit(mask) {
        const shape = {};
        for (const key of util$1.objectKeys(this.shape)) {
            if (!mask[key]) {
                shape[key] = this.shape[key];
            }
        }
        return new ZodObject({
            ...this._def,
            shape: () => shape,
        });
    }
    /**
     * @deprecated
     */
    deepPartial() {
        return deepPartialify(this);
    }
    partial(mask) {
        const newShape = {};
        for (const key of util$1.objectKeys(this.shape)) {
            const fieldSchema = this.shape[key];
            if (mask && !mask[key]) {
                newShape[key] = fieldSchema;
            }
            else {
                newShape[key] = fieldSchema.optional();
            }
        }
        return new ZodObject({
            ...this._def,
            shape: () => newShape,
        });
    }
    required(mask) {
        const newShape = {};
        for (const key of util$1.objectKeys(this.shape)) {
            if (mask && !mask[key]) {
                newShape[key] = this.shape[key];
            }
            else {
                const fieldSchema = this.shape[key];
                let newField = fieldSchema;
                while (newField instanceof ZodOptional) {
                    newField = newField._def.innerType;
                }
                newShape[key] = newField;
            }
        }
        return new ZodObject({
            ...this._def,
            shape: () => newShape,
        });
    }
    keyof() {
        return createZodEnum(util$1.objectKeys(this.shape));
    }
}
ZodObject.create = (shape, params) => {
    return new ZodObject({
        shape: () => shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params),
    });
};
ZodObject.strictCreate = (shape, params) => {
    return new ZodObject({
        shape: () => shape,
        unknownKeys: "strict",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params),
    });
};
ZodObject.lazycreate = (shape, params) => {
    return new ZodObject({
        shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params),
    });
};
class ZodUnion extends ZodType {
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        const options = this._def.options;
        function handleResults(results) {
            // return first issue-free validation if it exists
            for (const result of results) {
                if (result.result.status === "valid") {
                    return result.result;
                }
            }
            for (const result of results) {
                if (result.result.status === "dirty") {
                    // add issues from dirty option
                    ctx.common.issues.push(...result.ctx.common.issues);
                    return result.result;
                }
            }
            // return invalid
            const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_union,
                unionErrors,
            });
            return INVALID;
        }
        if (ctx.common.async) {
            return Promise.all(options.map(async (option) => {
                const childCtx = {
                    ...ctx,
                    common: {
                        ...ctx.common,
                        issues: [],
                    },
                    parent: null,
                };
                return {
                    result: await option._parseAsync({
                        data: ctx.data,
                        path: ctx.path,
                        parent: childCtx,
                    }),
                    ctx: childCtx,
                };
            })).then(handleResults);
        }
        else {
            let dirty = undefined;
            const issues = [];
            for (const option of options) {
                const childCtx = {
                    ...ctx,
                    common: {
                        ...ctx.common,
                        issues: [],
                    },
                    parent: null,
                };
                const result = option._parseSync({
                    data: ctx.data,
                    path: ctx.path,
                    parent: childCtx,
                });
                if (result.status === "valid") {
                    return result;
                }
                else if (result.status === "dirty" && !dirty) {
                    dirty = { result, ctx: childCtx };
                }
                if (childCtx.common.issues.length) {
                    issues.push(childCtx.common.issues);
                }
            }
            if (dirty) {
                ctx.common.issues.push(...dirty.ctx.common.issues);
                return dirty.result;
            }
            const unionErrors = issues.map((issues) => new ZodError(issues));
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_union,
                unionErrors,
            });
            return INVALID;
        }
    }
    get options() {
        return this._def.options;
    }
}
ZodUnion.create = (types, params) => {
    return new ZodUnion({
        options: types,
        typeName: ZodFirstPartyTypeKind.ZodUnion,
        ...processCreateParams(params),
    });
};
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
//////////                                 //////////
//////////      ZodDiscriminatedUnion      //////////
//////////                                 //////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
const getDiscriminator = (type) => {
    if (type instanceof ZodLazy) {
        return getDiscriminator(type.schema);
    }
    else if (type instanceof ZodEffects) {
        return getDiscriminator(type.innerType());
    }
    else if (type instanceof ZodLiteral) {
        return [type.value];
    }
    else if (type instanceof ZodEnum) {
        return type.options;
    }
    else if (type instanceof ZodNativeEnum) {
        // eslint-disable-next-line ban/ban
        return util$1.objectValues(type.enum);
    }
    else if (type instanceof ZodDefault) {
        return getDiscriminator(type._def.innerType);
    }
    else if (type instanceof ZodUndefined) {
        return [undefined];
    }
    else if (type instanceof ZodNull) {
        return [null];
    }
    else if (type instanceof ZodOptional) {
        return [undefined, ...getDiscriminator(type.unwrap())];
    }
    else if (type instanceof ZodNullable) {
        return [null, ...getDiscriminator(type.unwrap())];
    }
    else if (type instanceof ZodBranded) {
        return getDiscriminator(type.unwrap());
    }
    else if (type instanceof ZodReadonly) {
        return getDiscriminator(type.unwrap());
    }
    else if (type instanceof ZodCatch) {
        return getDiscriminator(type._def.innerType);
    }
    else {
        return [];
    }
};
class ZodDiscriminatedUnion extends ZodType {
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.object,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const discriminator = this.discriminator;
        const discriminatorValue = ctx.data[discriminator];
        const option = this.optionsMap.get(discriminatorValue);
        if (!option) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_union_discriminator,
                options: Array.from(this.optionsMap.keys()),
                path: [discriminator],
            });
            return INVALID;
        }
        if (ctx.common.async) {
            return option._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx,
            });
        }
        else {
            return option._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx,
            });
        }
    }
    get discriminator() {
        return this._def.discriminator;
    }
    get options() {
        return this._def.options;
    }
    get optionsMap() {
        return this._def.optionsMap;
    }
    /**
     * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
     * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
     * have a different value for each object in the union.
     * @param discriminator the name of the discriminator property
     * @param types an array of object schemas
     * @param params
     */
    static create(discriminator, options, params) {
        // Get all the valid discriminator values
        const optionsMap = new Map();
        // try {
        for (const type of options) {
            const discriminatorValues = getDiscriminator(type.shape[discriminator]);
            if (!discriminatorValues.length) {
                throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
            }
            for (const value of discriminatorValues) {
                if (optionsMap.has(value)) {
                    throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
                }
                optionsMap.set(value, type);
            }
        }
        return new ZodDiscriminatedUnion({
            typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
            discriminator,
            options,
            optionsMap,
            ...processCreateParams(params),
        });
    }
}
function mergeValues(a, b) {
    const aType = getParsedType(a);
    const bType = getParsedType(b);
    if (a === b) {
        return { valid: true, data: a };
    }
    else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
        const bKeys = util$1.objectKeys(b);
        const sharedKeys = util$1.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
        const newObj = { ...a, ...b };
        for (const key of sharedKeys) {
            const sharedValue = mergeValues(a[key], b[key]);
            if (!sharedValue.valid) {
                return { valid: false };
            }
            newObj[key] = sharedValue.data;
        }
        return { valid: true, data: newObj };
    }
    else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
        if (a.length !== b.length) {
            return { valid: false };
        }
        const newArray = [];
        for (let index = 0; index < a.length; index++) {
            const itemA = a[index];
            const itemB = b[index];
            const sharedValue = mergeValues(itemA, itemB);
            if (!sharedValue.valid) {
                return { valid: false };
            }
            newArray.push(sharedValue.data);
        }
        return { valid: true, data: newArray };
    }
    else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
        return { valid: true, data: a };
    }
    else {
        return { valid: false };
    }
}
class ZodIntersection extends ZodType {
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const handleParsed = (parsedLeft, parsedRight) => {
            if (isAborted(parsedLeft) || isAborted(parsedRight)) {
                return INVALID;
            }
            const merged = mergeValues(parsedLeft.value, parsedRight.value);
            if (!merged.valid) {
                addIssueToContext(ctx, {
                    code: ZodIssueCode.invalid_intersection_types,
                });
                return INVALID;
            }
            if (isDirty(parsedLeft) || isDirty(parsedRight)) {
                status.dirty();
            }
            return { status: status.value, value: merged.data };
        };
        if (ctx.common.async) {
            return Promise.all([
                this._def.left._parseAsync({
                    data: ctx.data,
                    path: ctx.path,
                    parent: ctx,
                }),
                this._def.right._parseAsync({
                    data: ctx.data,
                    path: ctx.path,
                    parent: ctx,
                }),
            ]).then(([left, right]) => handleParsed(left, right));
        }
        else {
            return handleParsed(this._def.left._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx,
            }), this._def.right._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx,
            }));
        }
    }
}
ZodIntersection.create = (left, right, params) => {
    return new ZodIntersection({
        left: left,
        right: right,
        typeName: ZodFirstPartyTypeKind.ZodIntersection,
        ...processCreateParams(params),
    });
};
// type ZodTupleItems = [ZodTypeAny, ...ZodTypeAny[]];
class ZodTuple extends ZodType {
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.array) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.array,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        if (ctx.data.length < this._def.items.length) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: this._def.items.length,
                inclusive: true,
                exact: false,
                type: "array",
            });
            return INVALID;
        }
        const rest = this._def.rest;
        if (!rest && ctx.data.length > this._def.items.length) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: this._def.items.length,
                inclusive: true,
                exact: false,
                type: "array",
            });
            status.dirty();
        }
        const items = [...ctx.data]
            .map((item, itemIndex) => {
            const schema = this._def.items[itemIndex] || this._def.rest;
            if (!schema)
                return null;
            return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
        })
            .filter((x) => !!x); // filter nulls
        if (ctx.common.async) {
            return Promise.all(items).then((results) => {
                return ParseStatus.mergeArray(status, results);
            });
        }
        else {
            return ParseStatus.mergeArray(status, items);
        }
    }
    get items() {
        return this._def.items;
    }
    rest(rest) {
        return new ZodTuple({
            ...this._def,
            rest,
        });
    }
}
ZodTuple.create = (schemas, params) => {
    if (!Array.isArray(schemas)) {
        throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
    }
    return new ZodTuple({
        items: schemas,
        typeName: ZodFirstPartyTypeKind.ZodTuple,
        rest: null,
        ...processCreateParams(params),
    });
};
class ZodRecord extends ZodType {
    get keySchema() {
        return this._def.keyType;
    }
    get valueSchema() {
        return this._def.valueType;
    }
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.object,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const pairs = [];
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        for (const key in ctx.data) {
            pairs.push({
                key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
                value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
                alwaysSet: key in ctx.data,
            });
        }
        if (ctx.common.async) {
            return ParseStatus.mergeObjectAsync(status, pairs);
        }
        else {
            return ParseStatus.mergeObjectSync(status, pairs);
        }
    }
    get element() {
        return this._def.valueType;
    }
    static create(first, second, third) {
        if (second instanceof ZodType) {
            return new ZodRecord({
                keyType: first,
                valueType: second,
                typeName: ZodFirstPartyTypeKind.ZodRecord,
                ...processCreateParams(third),
            });
        }
        return new ZodRecord({
            keyType: ZodString.create(),
            valueType: first,
            typeName: ZodFirstPartyTypeKind.ZodRecord,
            ...processCreateParams(second),
        });
    }
}
class ZodMap extends ZodType {
    get keySchema() {
        return this._def.keyType;
    }
    get valueSchema() {
        return this._def.valueType;
    }
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.map) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.map,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        const pairs = [...ctx.data.entries()].map(([key, value], index) => {
            return {
                key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
                value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"])),
            };
        });
        if (ctx.common.async) {
            const finalMap = new Map();
            return Promise.resolve().then(async () => {
                for (const pair of pairs) {
                    const key = await pair.key;
                    const value = await pair.value;
                    if (key.status === "aborted" || value.status === "aborted") {
                        return INVALID;
                    }
                    if (key.status === "dirty" || value.status === "dirty") {
                        status.dirty();
                    }
                    finalMap.set(key.value, value.value);
                }
                return { status: status.value, value: finalMap };
            });
        }
        else {
            const finalMap = new Map();
            for (const pair of pairs) {
                const key = pair.key;
                const value = pair.value;
                if (key.status === "aborted" || value.status === "aborted") {
                    return INVALID;
                }
                if (key.status === "dirty" || value.status === "dirty") {
                    status.dirty();
                }
                finalMap.set(key.value, value.value);
            }
            return { status: status.value, value: finalMap };
        }
    }
}
ZodMap.create = (keyType, valueType, params) => {
    return new ZodMap({
        valueType,
        keyType,
        typeName: ZodFirstPartyTypeKind.ZodMap,
        ...processCreateParams(params),
    });
};
class ZodSet extends ZodType {
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.set) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.set,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const def = this._def;
        if (def.minSize !== null) {
            if (ctx.data.size < def.minSize.value) {
                addIssueToContext(ctx, {
                    code: ZodIssueCode.too_small,
                    minimum: def.minSize.value,
                    type: "set",
                    inclusive: true,
                    exact: false,
                    message: def.minSize.message,
                });
                status.dirty();
            }
        }
        if (def.maxSize !== null) {
            if (ctx.data.size > def.maxSize.value) {
                addIssueToContext(ctx, {
                    code: ZodIssueCode.too_big,
                    maximum: def.maxSize.value,
                    type: "set",
                    inclusive: true,
                    exact: false,
                    message: def.maxSize.message,
                });
                status.dirty();
            }
        }
        const valueType = this._def.valueType;
        function finalizeSet(elements) {
            const parsedSet = new Set();
            for (const element of elements) {
                if (element.status === "aborted")
                    return INVALID;
                if (element.status === "dirty")
                    status.dirty();
                parsedSet.add(element.value);
            }
            return { status: status.value, value: parsedSet };
        }
        const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
        if (ctx.common.async) {
            return Promise.all(elements).then((elements) => finalizeSet(elements));
        }
        else {
            return finalizeSet(elements);
        }
    }
    min(minSize, message) {
        return new ZodSet({
            ...this._def,
            minSize: { value: minSize, message: errorUtil.toString(message) },
        });
    }
    max(maxSize, message) {
        return new ZodSet({
            ...this._def,
            maxSize: { value: maxSize, message: errorUtil.toString(message) },
        });
    }
    size(size, message) {
        return this.min(size, message).max(size, message);
    }
    nonempty(message) {
        return this.min(1, message);
    }
}
ZodSet.create = (valueType, params) => {
    return new ZodSet({
        valueType,
        minSize: null,
        maxSize: null,
        typeName: ZodFirstPartyTypeKind.ZodSet,
        ...processCreateParams(params),
    });
};
class ZodLazy extends ZodType {
    get schema() {
        return this._def.getter();
    }
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        const lazySchema = this._def.getter();
        return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
    }
}
ZodLazy.create = (getter, params) => {
    return new ZodLazy({
        getter: getter,
        typeName: ZodFirstPartyTypeKind.ZodLazy,
        ...processCreateParams(params),
    });
};
class ZodLiteral extends ZodType {
    _parse(input) {
        if (input.data !== this._def.value) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                received: ctx.data,
                code: ZodIssueCode.invalid_literal,
                expected: this._def.value,
            });
            return INVALID;
        }
        return { status: "valid", value: input.data };
    }
    get value() {
        return this._def.value;
    }
}
ZodLiteral.create = (value, params) => {
    return new ZodLiteral({
        value: value,
        typeName: ZodFirstPartyTypeKind.ZodLiteral,
        ...processCreateParams(params),
    });
};
function createZodEnum(values, params) {
    return new ZodEnum({
        values,
        typeName: ZodFirstPartyTypeKind.ZodEnum,
        ...processCreateParams(params),
    });
}
class ZodEnum extends ZodType {
    _parse(input) {
        if (typeof input.data !== "string") {
            const ctx = this._getOrReturnCtx(input);
            const expectedValues = this._def.values;
            addIssueToContext(ctx, {
                expected: util$1.joinValues(expectedValues),
                received: ctx.parsedType,
                code: ZodIssueCode.invalid_type,
            });
            return INVALID;
        }
        if (!this._cache) {
            this._cache = new Set(this._def.values);
        }
        if (!this._cache.has(input.data)) {
            const ctx = this._getOrReturnCtx(input);
            const expectedValues = this._def.values;
            addIssueToContext(ctx, {
                received: ctx.data,
                code: ZodIssueCode.invalid_enum_value,
                options: expectedValues,
            });
            return INVALID;
        }
        return OK(input.data);
    }
    get options() {
        return this._def.values;
    }
    get enum() {
        const enumValues = {};
        for (const val of this._def.values) {
            enumValues[val] = val;
        }
        return enumValues;
    }
    get Values() {
        const enumValues = {};
        for (const val of this._def.values) {
            enumValues[val] = val;
        }
        return enumValues;
    }
    get Enum() {
        const enumValues = {};
        for (const val of this._def.values) {
            enumValues[val] = val;
        }
        return enumValues;
    }
    extract(values, newDef = this._def) {
        return ZodEnum.create(values, {
            ...this._def,
            ...newDef,
        });
    }
    exclude(values, newDef = this._def) {
        return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
            ...this._def,
            ...newDef,
        });
    }
}
ZodEnum.create = createZodEnum;
class ZodNativeEnum extends ZodType {
    _parse(input) {
        const nativeEnumValues = util$1.getValidEnumValues(this._def.values);
        const ctx = this._getOrReturnCtx(input);
        if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
            const expectedValues = util$1.objectValues(nativeEnumValues);
            addIssueToContext(ctx, {
                expected: util$1.joinValues(expectedValues),
                received: ctx.parsedType,
                code: ZodIssueCode.invalid_type,
            });
            return INVALID;
        }
        if (!this._cache) {
            this._cache = new Set(util$1.getValidEnumValues(this._def.values));
        }
        if (!this._cache.has(input.data)) {
            const expectedValues = util$1.objectValues(nativeEnumValues);
            addIssueToContext(ctx, {
                received: ctx.data,
                code: ZodIssueCode.invalid_enum_value,
                options: expectedValues,
            });
            return INVALID;
        }
        return OK(input.data);
    }
    get enum() {
        return this._def.values;
    }
}
ZodNativeEnum.create = (values, params) => {
    return new ZodNativeEnum({
        values: values,
        typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
        ...processCreateParams(params),
    });
};
class ZodPromise extends ZodType {
    unwrap() {
        return this._def.type;
    }
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.promise,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
        return OK(promisified.then((data) => {
            return this._def.type.parseAsync(data, {
                path: ctx.path,
                errorMap: ctx.common.contextualErrorMap,
            });
        }));
    }
}
ZodPromise.create = (schema, params) => {
    return new ZodPromise({
        type: schema,
        typeName: ZodFirstPartyTypeKind.ZodPromise,
        ...processCreateParams(params),
    });
};
class ZodEffects extends ZodType {
    innerType() {
        return this._def.schema;
    }
    sourceType() {
        return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects
            ? this._def.schema.sourceType()
            : this._def.schema;
    }
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const effect = this._def.effect || null;
        const checkCtx = {
            addIssue: (arg) => {
                addIssueToContext(ctx, arg);
                if (arg.fatal) {
                    status.abort();
                }
                else {
                    status.dirty();
                }
            },
            get path() {
                return ctx.path;
            },
        };
        checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
        if (effect.type === "preprocess") {
            const processed = effect.transform(ctx.data, checkCtx);
            if (ctx.common.async) {
                return Promise.resolve(processed).then(async (processed) => {
                    if (status.value === "aborted")
                        return INVALID;
                    const result = await this._def.schema._parseAsync({
                        data: processed,
                        path: ctx.path,
                        parent: ctx,
                    });
                    if (result.status === "aborted")
                        return INVALID;
                    if (result.status === "dirty")
                        return DIRTY(result.value);
                    if (status.value === "dirty")
                        return DIRTY(result.value);
                    return result;
                });
            }
            else {
                if (status.value === "aborted")
                    return INVALID;
                const result = this._def.schema._parseSync({
                    data: processed,
                    path: ctx.path,
                    parent: ctx,
                });
                if (result.status === "aborted")
                    return INVALID;
                if (result.status === "dirty")
                    return DIRTY(result.value);
                if (status.value === "dirty")
                    return DIRTY(result.value);
                return result;
            }
        }
        if (effect.type === "refinement") {
            const executeRefinement = (acc) => {
                const result = effect.refinement(acc, checkCtx);
                if (ctx.common.async) {
                    return Promise.resolve(result);
                }
                if (result instanceof Promise) {
                    throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
                }
                return acc;
            };
            if (ctx.common.async === false) {
                const inner = this._def.schema._parseSync({
                    data: ctx.data,
                    path: ctx.path,
                    parent: ctx,
                });
                if (inner.status === "aborted")
                    return INVALID;
                if (inner.status === "dirty")
                    status.dirty();
                // return value is ignored
                executeRefinement(inner.value);
                return { status: status.value, value: inner.value };
            }
            else {
                return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
                    if (inner.status === "aborted")
                        return INVALID;
                    if (inner.status === "dirty")
                        status.dirty();
                    return executeRefinement(inner.value).then(() => {
                        return { status: status.value, value: inner.value };
                    });
                });
            }
        }
        if (effect.type === "transform") {
            if (ctx.common.async === false) {
                const base = this._def.schema._parseSync({
                    data: ctx.data,
                    path: ctx.path,
                    parent: ctx,
                });
                if (!isValid(base))
                    return INVALID;
                const result = effect.transform(base.value, checkCtx);
                if (result instanceof Promise) {
                    throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
                }
                return { status: status.value, value: result };
            }
            else {
                return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
                    if (!isValid(base))
                        return INVALID;
                    return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
                        status: status.value,
                        value: result,
                    }));
                });
            }
        }
        util$1.assertNever(effect);
    }
}
ZodEffects.create = (schema, effect, params) => {
    return new ZodEffects({
        schema,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect,
        ...processCreateParams(params),
    });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
    return new ZodEffects({
        schema,
        effect: { type: "preprocess", transform: preprocess },
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        ...processCreateParams(params),
    });
};
class ZodOptional extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.undefined) {
            return OK(undefined);
        }
        return this._def.innerType._parse(input);
    }
    unwrap() {
        return this._def.innerType;
    }
}
ZodOptional.create = (type, params) => {
    return new ZodOptional({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodOptional,
        ...processCreateParams(params),
    });
};
class ZodNullable extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.null) {
            return OK(null);
        }
        return this._def.innerType._parse(input);
    }
    unwrap() {
        return this._def.innerType;
    }
}
ZodNullable.create = (type, params) => {
    return new ZodNullable({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodNullable,
        ...processCreateParams(params),
    });
};
class ZodDefault extends ZodType {
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        let data = ctx.data;
        if (ctx.parsedType === ZodParsedType.undefined) {
            data = this._def.defaultValue();
        }
        return this._def.innerType._parse({
            data,
            path: ctx.path,
            parent: ctx,
        });
    }
    removeDefault() {
        return this._def.innerType;
    }
}
ZodDefault.create = (type, params) => {
    return new ZodDefault({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodDefault,
        defaultValue: typeof params.default === "function" ? params.default : () => params.default,
        ...processCreateParams(params),
    });
};
class ZodCatch extends ZodType {
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        // newCtx is used to not collect issues from inner types in ctx
        const newCtx = {
            ...ctx,
            common: {
                ...ctx.common,
                issues: [],
            },
        };
        const result = this._def.innerType._parse({
            data: newCtx.data,
            path: newCtx.path,
            parent: {
                ...newCtx,
            },
        });
        if (isAsync(result)) {
            return result.then((result) => {
                return {
                    status: "valid",
                    value: result.status === "valid"
                        ? result.value
                        : this._def.catchValue({
                            get error() {
                                return new ZodError(newCtx.common.issues);
                            },
                            input: newCtx.data,
                        }),
                };
            });
        }
        else {
            return {
                status: "valid",
                value: result.status === "valid"
                    ? result.value
                    : this._def.catchValue({
                        get error() {
                            return new ZodError(newCtx.common.issues);
                        },
                        input: newCtx.data,
                    }),
            };
        }
    }
    removeCatch() {
        return this._def.innerType;
    }
}
ZodCatch.create = (type, params) => {
    return new ZodCatch({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodCatch,
        catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
        ...processCreateParams(params),
    });
};
class ZodNaN extends ZodType {
    _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.nan) {
            const ctx = this._getOrReturnCtx(input);
            addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: ZodParsedType.nan,
                received: ctx.parsedType,
            });
            return INVALID;
        }
        return { status: "valid", value: input.data };
    }
}
ZodNaN.create = (params) => {
    return new ZodNaN({
        typeName: ZodFirstPartyTypeKind.ZodNaN,
        ...processCreateParams(params),
    });
};
class ZodBranded extends ZodType {
    _parse(input) {
        const { ctx } = this._processInputParams(input);
        const data = ctx.data;
        return this._def.type._parse({
            data,
            path: ctx.path,
            parent: ctx,
        });
    }
    unwrap() {
        return this._def.type;
    }
}
class ZodPipeline extends ZodType {
    _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.common.async) {
            const handleAsync = async () => {
                const inResult = await this._def.in._parseAsync({
                    data: ctx.data,
                    path: ctx.path,
                    parent: ctx,
                });
                if (inResult.status === "aborted")
                    return INVALID;
                if (inResult.status === "dirty") {
                    status.dirty();
                    return DIRTY(inResult.value);
                }
                else {
                    return this._def.out._parseAsync({
                        data: inResult.value,
                        path: ctx.path,
                        parent: ctx,
                    });
                }
            };
            return handleAsync();
        }
        else {
            const inResult = this._def.in._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx,
            });
            if (inResult.status === "aborted")
                return INVALID;
            if (inResult.status === "dirty") {
                status.dirty();
                return {
                    status: "dirty",
                    value: inResult.value,
                };
            }
            else {
                return this._def.out._parseSync({
                    data: inResult.value,
                    path: ctx.path,
                    parent: ctx,
                });
            }
        }
    }
    static create(a, b) {
        return new ZodPipeline({
            in: a,
            out: b,
            typeName: ZodFirstPartyTypeKind.ZodPipeline,
        });
    }
}
class ZodReadonly extends ZodType {
    _parse(input) {
        const result = this._def.innerType._parse(input);
        const freeze = (data) => {
            if (isValid(data)) {
                data.value = Object.freeze(data.value);
            }
            return data;
        };
        return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
    }
    unwrap() {
        return this._def.innerType;
    }
}
ZodReadonly.create = (type, params) => {
    return new ZodReadonly({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodReadonly,
        ...processCreateParams(params),
    });
};
var ZodFirstPartyTypeKind;
(function (ZodFirstPartyTypeKind) {
    ZodFirstPartyTypeKind["ZodString"] = "ZodString";
    ZodFirstPartyTypeKind["ZodNumber"] = "ZodNumber";
    ZodFirstPartyTypeKind["ZodNaN"] = "ZodNaN";
    ZodFirstPartyTypeKind["ZodBigInt"] = "ZodBigInt";
    ZodFirstPartyTypeKind["ZodBoolean"] = "ZodBoolean";
    ZodFirstPartyTypeKind["ZodDate"] = "ZodDate";
    ZodFirstPartyTypeKind["ZodSymbol"] = "ZodSymbol";
    ZodFirstPartyTypeKind["ZodUndefined"] = "ZodUndefined";
    ZodFirstPartyTypeKind["ZodNull"] = "ZodNull";
    ZodFirstPartyTypeKind["ZodAny"] = "ZodAny";
    ZodFirstPartyTypeKind["ZodUnknown"] = "ZodUnknown";
    ZodFirstPartyTypeKind["ZodNever"] = "ZodNever";
    ZodFirstPartyTypeKind["ZodVoid"] = "ZodVoid";
    ZodFirstPartyTypeKind["ZodArray"] = "ZodArray";
    ZodFirstPartyTypeKind["ZodObject"] = "ZodObject";
    ZodFirstPartyTypeKind["ZodUnion"] = "ZodUnion";
    ZodFirstPartyTypeKind["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
    ZodFirstPartyTypeKind["ZodIntersection"] = "ZodIntersection";
    ZodFirstPartyTypeKind["ZodTuple"] = "ZodTuple";
    ZodFirstPartyTypeKind["ZodRecord"] = "ZodRecord";
    ZodFirstPartyTypeKind["ZodMap"] = "ZodMap";
    ZodFirstPartyTypeKind["ZodSet"] = "ZodSet";
    ZodFirstPartyTypeKind["ZodFunction"] = "ZodFunction";
    ZodFirstPartyTypeKind["ZodLazy"] = "ZodLazy";
    ZodFirstPartyTypeKind["ZodLiteral"] = "ZodLiteral";
    ZodFirstPartyTypeKind["ZodEnum"] = "ZodEnum";
    ZodFirstPartyTypeKind["ZodEffects"] = "ZodEffects";
    ZodFirstPartyTypeKind["ZodNativeEnum"] = "ZodNativeEnum";
    ZodFirstPartyTypeKind["ZodOptional"] = "ZodOptional";
    ZodFirstPartyTypeKind["ZodNullable"] = "ZodNullable";
    ZodFirstPartyTypeKind["ZodDefault"] = "ZodDefault";
    ZodFirstPartyTypeKind["ZodCatch"] = "ZodCatch";
    ZodFirstPartyTypeKind["ZodPromise"] = "ZodPromise";
    ZodFirstPartyTypeKind["ZodBranded"] = "ZodBranded";
    ZodFirstPartyTypeKind["ZodPipeline"] = "ZodPipeline";
    ZodFirstPartyTypeKind["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
const stringType = ZodString.create;
const numberType = ZodNumber.create;
const booleanType = ZodBoolean.create;
const unknownType = ZodUnknown.create;
ZodNever.create;
const arrayType = ZodArray.create;
const objectType = ZodObject.create;
const unionType = ZodUnion.create;
const discriminatedUnionType = ZodDiscriminatedUnion.create;
ZodIntersection.create;
ZodTuple.create;
const recordType = ZodRecord.create;
const literalType = ZodLiteral.create;
const enumType = ZodEnum.create;
ZodPromise.create;
const optionalType = ZodOptional.create;
ZodNullable.create;

const LATEST_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, '2025-03-26', '2024-11-05', '2024-10-07'];
/* JSON-RPC types */
const JSONRPC_VERSION = '2.0';
/**
 * A progress token, used to associate progress notifications with the original request.
 */
const ProgressTokenSchema = unionType([stringType(), numberType().int()]);
/**
 * An opaque token used to represent a cursor for pagination.
 */
const CursorSchema = stringType();
const RequestMetaSchema = objectType({
    /**
     * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
     */
    progressToken: optionalType(ProgressTokenSchema)
})
    .passthrough();
const BaseRequestParamsSchema = objectType({
    _meta: optionalType(RequestMetaSchema)
})
    .passthrough();
const RequestSchema = objectType({
    method: stringType(),
    params: optionalType(BaseRequestParamsSchema)
});
const BaseNotificationParamsSchema = objectType({
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
const NotificationSchema = objectType({
    method: stringType(),
    params: optionalType(BaseNotificationParamsSchema)
});
const ResultSchema = objectType({
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
/**
 * A uniquely identifying ID for a request in JSON-RPC.
 */
const RequestIdSchema = unionType([stringType(), numberType().int()]);
/**
 * A request that expects a response.
 */
const JSONRPCRequestSchema = objectType({
    jsonrpc: literalType(JSONRPC_VERSION),
    id: RequestIdSchema
})
    .merge(RequestSchema)
    .strict();
const isJSONRPCRequest = (value) => JSONRPCRequestSchema.safeParse(value).success;
/**
 * A notification which does not expect a response.
 */
const JSONRPCNotificationSchema = objectType({
    jsonrpc: literalType(JSONRPC_VERSION)
})
    .merge(NotificationSchema)
    .strict();
const isJSONRPCNotification = (value) => JSONRPCNotificationSchema.safeParse(value).success;
/**
 * A successful (non-error) response to a request.
 */
const JSONRPCResponseSchema = objectType({
    jsonrpc: literalType(JSONRPC_VERSION),
    id: RequestIdSchema,
    result: ResultSchema
})
    .strict();
const isJSONRPCResponse = (value) => JSONRPCResponseSchema.safeParse(value).success;
/**
 * Error codes defined by the JSON-RPC specification.
 */
var ErrorCode;
(function (ErrorCode) {
    // SDK error codes
    ErrorCode[ErrorCode["ConnectionClosed"] = -32e3] = "ConnectionClosed";
    ErrorCode[ErrorCode["RequestTimeout"] = -32001] = "RequestTimeout";
    // Standard JSON-RPC error codes
    ErrorCode[ErrorCode["ParseError"] = -32700] = "ParseError";
    ErrorCode[ErrorCode["InvalidRequest"] = -32600] = "InvalidRequest";
    ErrorCode[ErrorCode["MethodNotFound"] = -32601] = "MethodNotFound";
    ErrorCode[ErrorCode["InvalidParams"] = -32602] = "InvalidParams";
    ErrorCode[ErrorCode["InternalError"] = -32603] = "InternalError";
})(ErrorCode || (ErrorCode = {}));
/**
 * A response to a request that indicates an error occurred.
 */
const JSONRPCErrorSchema = objectType({
    jsonrpc: literalType(JSONRPC_VERSION),
    id: RequestIdSchema,
    error: objectType({
        /**
         * The error type that occurred.
         */
        code: numberType().int(),
        /**
         * A short description of the error. The message SHOULD be limited to a concise single sentence.
         */
        message: stringType(),
        /**
         * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
         */
        data: optionalType(unknownType())
    })
})
    .strict();
const isJSONRPCError = (value) => JSONRPCErrorSchema.safeParse(value).success;
const JSONRPCMessageSchema = unionType([JSONRPCRequestSchema, JSONRPCNotificationSchema, JSONRPCResponseSchema, JSONRPCErrorSchema]);
/* Empty result */
/**
 * A response that indicates success but carries no data.
 */
const EmptyResultSchema = ResultSchema.strict();
/* Cancellation */
/**
 * This notification can be sent by either side to indicate that it is cancelling a previously-issued request.
 *
 * The request SHOULD still be in-flight, but due to communication latency, it is always possible that this notification MAY arrive after the request has already finished.
 *
 * This notification indicates that the result will be unused, so any associated processing SHOULD cease.
 *
 * A client MUST NOT attempt to cancel its `initialize` request.
 */
const CancelledNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/cancelled'),
    params: BaseNotificationParamsSchema.extend({
        /**
         * The ID of the request to cancel.
         *
         * This MUST correspond to the ID of a request previously issued in the same direction.
         */
        requestId: RequestIdSchema,
        /**
         * An optional string describing the reason for the cancellation. This MAY be logged or presented to the user.
         */
        reason: stringType().optional()
    })
});
/* Base Metadata */
/**
 * Icon schema for use in tools, prompts, resources, and implementations.
 */
const IconSchema = objectType({
    /**
     * URL or data URI for the icon.
     */
    src: stringType(),
    /**
     * Optional MIME type for the icon.
     */
    mimeType: optionalType(stringType()),
    /**
     * Optional array of strings that specify sizes at which the icon can be used.
     * Each string should be in WxH format (e.g., `"48x48"`, `"96x96"`) or `"any"` for scalable formats like SVG.
     *
     * If not provided, the client should assume that the icon can be used at any size.
     */
    sizes: optionalType(arrayType(stringType()))
})
    .passthrough();
/**
 * Base schema to add `icons` property.
 *
 */
const IconsSchema = objectType({
    /**
     * Optional set of sized icons that the client can display in a user interface.
     *
     * Clients that support rendering icons MUST support at least the following MIME types:
     * - `image/png` - PNG images (safe, universal compatibility)
     * - `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)
     *
     * Clients that support rendering icons SHOULD also support:
     * - `image/svg+xml` - SVG images (scalable but requires security precautions)
     * - `image/webp` - WebP images (modern, efficient format)
     */
    icons: arrayType(IconSchema).optional()
})
    .passthrough();
/**
 * Base metadata interface for common properties across resources, tools, prompts, and implementations.
 */
const BaseMetadataSchema = objectType({
    /** Intended for programmatic or logical use, but used as a display name in past specs or fallback */
    name: stringType(),
    /**
     * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
     * even by those unfamiliar with domain-specific terminology.
     *
     * If not provided, the name should be used for display (except for Tool,
     * where `annotations.title` should be given precedence over using `name`,
     * if present).
     */
    title: optionalType(stringType())
})
    .passthrough();
/* Initialization */
/**
 * Describes the name and version of an MCP implementation.
 */
const ImplementationSchema = BaseMetadataSchema.extend({
    version: stringType(),
    /**
     * An optional URL of the website for this implementation.
     */
    websiteUrl: optionalType(stringType())
}).merge(IconsSchema);
/**
 * Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
 */
const ClientCapabilitiesSchema = objectType({
    /**
     * Experimental, non-standard capabilities that the client supports.
     */
    experimental: optionalType(objectType({}).passthrough()),
    /**
     * Present if the client supports sampling from an LLM.
     */
    sampling: optionalType(objectType({}).passthrough()),
    /**
     * Present if the client supports eliciting user input.
     */
    elicitation: optionalType(objectType({}).passthrough()),
    /**
     * Present if the client supports listing roots.
     */
    roots: optionalType(objectType({
        /**
         * Whether the client supports issuing notifications for changes to the roots list.
         */
        listChanged: optionalType(booleanType())
    })
        .passthrough())
})
    .passthrough();
/**
 * This request is sent from the client to the server when it first connects, asking it to begin initialization.
 */
const InitializeRequestSchema = RequestSchema.extend({
    method: literalType('initialize'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: stringType(),
        capabilities: ClientCapabilitiesSchema,
        clientInfo: ImplementationSchema
    })
});
/**
 * Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
 */
const ServerCapabilitiesSchema = objectType({
    /**
     * Experimental, non-standard capabilities that the server supports.
     */
    experimental: optionalType(objectType({}).passthrough()),
    /**
     * Present if the server supports sending log messages to the client.
     */
    logging: optionalType(objectType({}).passthrough()),
    /**
     * Present if the server supports sending completions to the client.
     */
    completions: optionalType(objectType({}).passthrough()),
    /**
     * Present if the server offers any prompt templates.
     */
    prompts: optionalType(objectType({
        /**
         * Whether this server supports issuing notifications for changes to the prompt list.
         */
        listChanged: optionalType(booleanType())
    })
        .passthrough()),
    /**
     * Present if the server offers any resources to read.
     */
    resources: optionalType(objectType({
        /**
         * Whether this server supports clients subscribing to resource updates.
         */
        subscribe: optionalType(booleanType()),
        /**
         * Whether this server supports issuing notifications for changes to the resource list.
         */
        listChanged: optionalType(booleanType())
    })
        .passthrough()),
    /**
     * Present if the server offers any tools to call.
     */
    tools: optionalType(objectType({
        /**
         * Whether this server supports issuing notifications for changes to the tool list.
         */
        listChanged: optionalType(booleanType())
    })
        .passthrough())
})
    .passthrough();
/**
 * After receiving an initialize request from the client, the server sends this response.
 */
const InitializeResultSchema = ResultSchema.extend({
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: stringType(),
    capabilities: ServerCapabilitiesSchema,
    serverInfo: ImplementationSchema,
    /**
     * Instructions describing how to use the server and its features.
     *
     * This can be used by clients to improve the LLM's understanding of available tools, resources, etc. It can be thought of like a "hint" to the model. For example, this information MAY be added to the system prompt.
     */
    instructions: optionalType(stringType())
});
/**
 * This notification is sent from the client to the server after initialization has finished.
 */
const InitializedNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/initialized')
});
/* Ping */
/**
 * A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.
 */
const PingRequestSchema = RequestSchema.extend({
    method: literalType('ping')
});
/* Progress notifications */
const ProgressSchema = objectType({
    /**
     * The progress thus far. This should increase every time progress is made, even if the total is unknown.
     */
    progress: numberType(),
    /**
     * Total number of items to process (or total progress required), if known.
     */
    total: optionalType(numberType()),
    /**
     * An optional message describing the current progress.
     */
    message: optionalType(stringType())
})
    .passthrough();
/**
 * An out-of-band notification used to inform the receiver of a progress update for a long-running request.
 */
const ProgressNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/progress'),
    params: BaseNotificationParamsSchema.merge(ProgressSchema).extend({
        /**
         * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
         */
        progressToken: ProgressTokenSchema
    })
});
/* Pagination */
const PaginatedRequestSchema = RequestSchema.extend({
    params: BaseRequestParamsSchema.extend({
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: optionalType(CursorSchema)
    }).optional()
});
const PaginatedResultSchema = ResultSchema.extend({
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: optionalType(CursorSchema)
});
/* Resources */
/**
 * The contents of a specific resource or sub-resource.
 */
const ResourceContentsSchema = objectType({
    /**
     * The URI of this resource.
     */
    uri: stringType(),
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: optionalType(stringType()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
const TextResourceContentsSchema = ResourceContentsSchema.extend({
    /**
     * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
     */
    text: stringType()
});
/**
 * A Zod schema for validating Base64 strings that is more performant and
 * robust for very large inputs than the default regex-based check. It avoids
 * stack overflows by using the native `atob` function for validation.
 */
const Base64Schema = stringType().refine(val => {
    try {
        // atob throws a DOMException if the string contains characters
        // that are not part of the Base64 character set.
        atob(val);
        return true;
    }
    catch (_a) {
        return false;
    }
}, { message: 'Invalid Base64 string' });
const BlobResourceContentsSchema = ResourceContentsSchema.extend({
    /**
     * A base64-encoded string representing the binary data of the item.
     */
    blob: Base64Schema
});
/**
 * A known resource that the server is capable of reading.
 */
const ResourceSchema = BaseMetadataSchema.extend({
    /**
     * The URI of this resource.
     */
    uri: stringType(),
    /**
     * A description of what this resource represents.
     *
     * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
     */
    description: optionalType(stringType()),
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: optionalType(stringType()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
}).merge(IconsSchema);
/**
 * A template description for resources available on the server.
 */
const ResourceTemplateSchema = BaseMetadataSchema.extend({
    /**
     * A URI template (according to RFC 6570) that can be used to construct resource URIs.
     */
    uriTemplate: stringType(),
    /**
     * A description of what this template is for.
     *
     * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
     */
    description: optionalType(stringType()),
    /**
     * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
     */
    mimeType: optionalType(stringType()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
}).merge(IconsSchema);
/**
 * Sent from the client to request a list of resources the server has.
 */
const ListResourcesRequestSchema = PaginatedRequestSchema.extend({
    method: literalType('resources/list')
});
/**
 * The server's response to a resources/list request from the client.
 */
const ListResourcesResultSchema = PaginatedResultSchema.extend({
    resources: arrayType(ResourceSchema)
});
/**
 * Sent from the client to request a list of resource templates the server has.
 */
const ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
    method: literalType('resources/templates/list')
});
/**
 * The server's response to a resources/templates/list request from the client.
 */
const ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
    resourceTemplates: arrayType(ResourceTemplateSchema)
});
/**
 * Sent from the client to the server, to read a specific resource URI.
 */
const ReadResourceRequestSchema = RequestSchema.extend({
    method: literalType('resources/read'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: stringType()
    })
});
/**
 * The server's response to a resources/read request from the client.
 */
const ReadResourceResultSchema = ResultSchema.extend({
    contents: arrayType(unionType([TextResourceContentsSchema, BlobResourceContentsSchema]))
});
/**
 * An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.
 */
const ResourceListChangedNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/resources/list_changed')
});
/**
 * Sent from the client to request resources/updated notifications from the server whenever a particular resource changes.
 */
const SubscribeRequestSchema = RequestSchema.extend({
    method: literalType('resources/subscribe'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: stringType()
    })
});
/**
 * Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request.
 */
const UnsubscribeRequestSchema = RequestSchema.extend({
    method: literalType('resources/unsubscribe'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: stringType()
    })
});
/**
 * A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request.
 */
const ResourceUpdatedNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/resources/updated'),
    params: BaseNotificationParamsSchema.extend({
        /**
         * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
         */
        uri: stringType()
    })
});
/* Prompts */
/**
 * Describes an argument that a prompt can accept.
 */
const PromptArgumentSchema = objectType({
    /**
     * The name of the argument.
     */
    name: stringType(),
    /**
     * A human-readable description of the argument.
     */
    description: optionalType(stringType()),
    /**
     * Whether this argument must be provided.
     */
    required: optionalType(booleanType())
})
    .passthrough();
/**
 * A prompt or prompt template that the server offers.
 */
const PromptSchema = BaseMetadataSchema.extend({
    /**
     * An optional description of what this prompt provides
     */
    description: optionalType(stringType()),
    /**
     * A list of arguments to use for templating the prompt.
     */
    arguments: optionalType(arrayType(PromptArgumentSchema)),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
}).merge(IconsSchema);
/**
 * Sent from the client to request a list of prompts and prompt templates the server has.
 */
const ListPromptsRequestSchema = PaginatedRequestSchema.extend({
    method: literalType('prompts/list')
});
/**
 * The server's response to a prompts/list request from the client.
 */
const ListPromptsResultSchema = PaginatedResultSchema.extend({
    prompts: arrayType(PromptSchema)
});
/**
 * Used by the client to get a prompt provided by the server.
 */
const GetPromptRequestSchema = RequestSchema.extend({
    method: literalType('prompts/get'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The name of the prompt or prompt template.
         */
        name: stringType(),
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: optionalType(recordType(stringType()))
    })
});
/**
 * Text provided to or from an LLM.
 */
const TextContentSchema = objectType({
    type: literalType('text'),
    /**
     * The text content of the message.
     */
    text: stringType(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
/**
 * An image provided to or from an LLM.
 */
const ImageContentSchema = objectType({
    type: literalType('image'),
    /**
     * The base64-encoded image data.
     */
    data: Base64Schema,
    /**
     * The MIME type of the image. Different providers may support different image types.
     */
    mimeType: stringType(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
/**
 * An Audio provided to or from an LLM.
 */
const AudioContentSchema = objectType({
    type: literalType('audio'),
    /**
     * The base64-encoded audio data.
     */
    data: Base64Schema,
    /**
     * The MIME type of the audio. Different providers may support different audio types.
     */
    mimeType: stringType(),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
/**
 * The contents of a resource, embedded into a prompt or tool call result.
 */
const EmbeddedResourceSchema = objectType({
    type: literalType('resource'),
    resource: unionType([TextResourceContentsSchema, BlobResourceContentsSchema]),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 *
 * Note: resource links returned by tools are not guaranteed to appear in the results of `resources/list` requests.
 */
const ResourceLinkSchema = ResourceSchema.extend({
    type: literalType('resource_link')
});
/**
 * A content block that can be used in prompts and tool results.
 */
const ContentBlockSchema = unionType([
    TextContentSchema,
    ImageContentSchema,
    AudioContentSchema,
    ResourceLinkSchema,
    EmbeddedResourceSchema
]);
/**
 * Describes a message returned as part of a prompt.
 */
const PromptMessageSchema = objectType({
    role: enumType(['user', 'assistant']),
    content: ContentBlockSchema
})
    .passthrough();
/**
 * The server's response to a prompts/get request from the client.
 */
const GetPromptResultSchema = ResultSchema.extend({
    /**
     * An optional description for the prompt.
     */
    description: optionalType(stringType()),
    messages: arrayType(PromptMessageSchema)
});
/**
 * An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.
 */
const PromptListChangedNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/prompts/list_changed')
});
/* Tools */
/**
 * Additional properties describing a Tool to clients.
 *
 * NOTE: all properties in ToolAnnotations are **hints**.
 * They are not guaranteed to provide a faithful description of
 * tool behavior (including descriptive properties like `title`).
 *
 * Clients should never make tool use decisions based on ToolAnnotations
 * received from untrusted servers.
 */
const ToolAnnotationsSchema = objectType({
    /**
     * A human-readable title for the tool.
     */
    title: optionalType(stringType()),
    /**
     * If true, the tool does not modify its environment.
     *
     * Default: false
     */
    readOnlyHint: optionalType(booleanType()),
    /**
     * If true, the tool may perform destructive updates to its environment.
     * If false, the tool performs only additive updates.
     *
     * (This property is meaningful only when `readOnlyHint == false`)
     *
     * Default: true
     */
    destructiveHint: optionalType(booleanType()),
    /**
     * If true, calling the tool repeatedly with the same arguments
     * will have no additional effect on the its environment.
     *
     * (This property is meaningful only when `readOnlyHint == false`)
     *
     * Default: false
     */
    idempotentHint: optionalType(booleanType()),
    /**
     * If true, this tool may interact with an "open world" of external
     * entities. If false, the tool's domain of interaction is closed.
     * For example, the world of a web search tool is open, whereas that
     * of a memory tool is not.
     *
     * Default: true
     */
    openWorldHint: optionalType(booleanType())
})
    .passthrough();
/**
 * Definition for a tool the client can call.
 */
const ToolSchema = BaseMetadataSchema.extend({
    /**
     * A human-readable description of the tool.
     */
    description: optionalType(stringType()),
    /**
     * A JSON Schema object defining the expected parameters for the tool.
     */
    inputSchema: objectType({
        type: literalType('object'),
        properties: optionalType(objectType({}).passthrough()),
        required: optionalType(arrayType(stringType()))
    })
        .passthrough(),
    /**
     * An optional JSON Schema object defining the structure of the tool's output returned in
     * the structuredContent field of a CallToolResult.
     */
    outputSchema: optionalType(objectType({
        type: literalType('object'),
        properties: optionalType(objectType({}).passthrough()),
        required: optionalType(arrayType(stringType()))
    })
        .passthrough()),
    /**
     * Optional additional tool information.
     */
    annotations: optionalType(ToolAnnotationsSchema),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
}).merge(IconsSchema);
/**
 * Sent from the client to request a list of tools the server has.
 */
const ListToolsRequestSchema = PaginatedRequestSchema.extend({
    method: literalType('tools/list')
});
/**
 * The server's response to a tools/list request from the client.
 */
const ListToolsResultSchema = PaginatedResultSchema.extend({
    tools: arrayType(ToolSchema)
});
/**
 * The server's response to a tool call.
 */
const CallToolResultSchema = ResultSchema.extend({
    /**
     * A list of content objects that represent the result of the tool call.
     *
     * If the Tool does not define an outputSchema, this field MUST be present in the result.
     * For backwards compatibility, this field is always present, but it may be empty.
     */
    content: arrayType(ContentBlockSchema).default([]),
    /**
     * An object containing structured tool output.
     *
     * If the Tool defines an outputSchema, this field MUST be present in the result, and contain a JSON object that matches the schema.
     */
    structuredContent: objectType({}).passthrough().optional(),
    /**
     * Whether the tool call ended in an error.
     *
     * If not set, this is assumed to be false (the call was successful).
     *
     * Any errors that originate from the tool SHOULD be reported inside the result
     * object, with `isError` set to true, _not_ as an MCP protocol-level error
     * response. Otherwise, the LLM would not be able to see that an error occurred
     * and self-correct.
     *
     * However, any errors in _finding_ the tool, an error indicating that the
     * server does not support tool calls, or any other exceptional conditions,
     * should be reported as an MCP error response.
     */
    isError: optionalType(booleanType())
});
/**
 * CallToolResultSchema extended with backwards compatibility to protocol version 2024-10-07.
 */
CallToolResultSchema.or(ResultSchema.extend({
    toolResult: unknownType()
}));
/**
 * Used by the client to invoke a tool provided by the server.
 */
const CallToolRequestSchema = RequestSchema.extend({
    method: literalType('tools/call'),
    params: BaseRequestParamsSchema.extend({
        name: stringType(),
        arguments: optionalType(recordType(unknownType()))
    })
});
/**
 * An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.
 */
const ToolListChangedNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/tools/list_changed')
});
/* Logging */
/**
 * The severity of a log message.
 */
const LoggingLevelSchema = enumType(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']);
/**
 * A request from the client to the server, to enable or adjust logging.
 */
const SetLevelRequestSchema = RequestSchema.extend({
    method: literalType('logging/setLevel'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: LoggingLevelSchema
    })
});
/**
 * Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically.
 */
const LoggingMessageNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/message'),
    params: BaseNotificationParamsSchema.extend({
        /**
         * The severity of this log message.
         */
        level: LoggingLevelSchema,
        /**
         * An optional name of the logger issuing this message.
         */
        logger: optionalType(stringType()),
        /**
         * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
         */
        data: unknownType()
    })
});
/* Sampling */
/**
 * Hints to use for model selection.
 */
const ModelHintSchema = objectType({
    /**
     * A hint for a model name.
     */
    name: stringType().optional()
})
    .passthrough();
/**
 * The server's preferences for model selection, requested of the client during sampling.
 */
const ModelPreferencesSchema = objectType({
    /**
     * Optional hints to use for model selection.
     */
    hints: optionalType(arrayType(ModelHintSchema)),
    /**
     * How much to prioritize cost when selecting a model.
     */
    costPriority: optionalType(numberType().min(0).max(1)),
    /**
     * How much to prioritize sampling speed (latency) when selecting a model.
     */
    speedPriority: optionalType(numberType().min(0).max(1)),
    /**
     * How much to prioritize intelligence and capabilities when selecting a model.
     */
    intelligencePriority: optionalType(numberType().min(0).max(1))
})
    .passthrough();
/**
 * Describes a message issued to or received from an LLM API.
 */
const SamplingMessageSchema = objectType({
    role: enumType(['user', 'assistant']),
    content: unionType([TextContentSchema, ImageContentSchema, AudioContentSchema])
})
    .passthrough();
/**
 * A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.
 */
const CreateMessageRequestSchema = RequestSchema.extend({
    method: literalType('sampling/createMessage'),
    params: BaseRequestParamsSchema.extend({
        messages: arrayType(SamplingMessageSchema),
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: optionalType(stringType()),
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: optionalType(enumType(['none', 'thisServer', 'allServers'])),
        temperature: optionalType(numberType()),
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: numberType().int(),
        stopSequences: optionalType(arrayType(stringType())),
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: optionalType(objectType({}).passthrough()),
        /**
         * The server's preferences for which model to select.
         */
        modelPreferences: optionalType(ModelPreferencesSchema)
    })
});
/**
 * The client's response to a sampling/create_message request from the server. The client should inform the user before returning the sampled message, to allow them to inspect the response (human in the loop) and decide whether to allow the server to see it.
 */
const CreateMessageResultSchema = ResultSchema.extend({
    /**
     * The name of the model that generated the message.
     */
    model: stringType(),
    /**
     * The reason why sampling stopped.
     */
    stopReason: optionalType(enumType(['endTurn', 'stopSequence', 'maxTokens']).or(stringType())),
    role: enumType(['user', 'assistant']),
    content: discriminatedUnionType('type', [TextContentSchema, ImageContentSchema, AudioContentSchema])
});
/* Elicitation */
/**
 * Primitive schema definition for boolean fields.
 */
const BooleanSchemaSchema = objectType({
    type: literalType('boolean'),
    title: optionalType(stringType()),
    description: optionalType(stringType()),
    default: optionalType(booleanType())
})
    .passthrough();
/**
 * Primitive schema definition for string fields.
 */
const StringSchemaSchema = objectType({
    type: literalType('string'),
    title: optionalType(stringType()),
    description: optionalType(stringType()),
    minLength: optionalType(numberType()),
    maxLength: optionalType(numberType()),
    format: optionalType(enumType(['email', 'uri', 'date', 'date-time']))
})
    .passthrough();
/**
 * Primitive schema definition for number fields.
 */
const NumberSchemaSchema = objectType({
    type: enumType(['number', 'integer']),
    title: optionalType(stringType()),
    description: optionalType(stringType()),
    minimum: optionalType(numberType()),
    maximum: optionalType(numberType())
})
    .passthrough();
/**
 * Primitive schema definition for enum fields.
 */
const EnumSchemaSchema = objectType({
    type: literalType('string'),
    title: optionalType(stringType()),
    description: optionalType(stringType()),
    enum: arrayType(stringType()),
    enumNames: optionalType(arrayType(stringType()))
})
    .passthrough();
/**
 * Union of all primitive schema definitions.
 */
const PrimitiveSchemaDefinitionSchema = unionType([BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema, EnumSchemaSchema]);
/**
 * A request from the server to elicit user input via the client.
 * The client should present the message and form fields to the user.
 */
const ElicitRequestSchema = RequestSchema.extend({
    method: literalType('elicitation/create'),
    params: BaseRequestParamsSchema.extend({
        /**
         * The message to present to the user.
         */
        message: stringType(),
        /**
         * The schema for the requested user input.
         */
        requestedSchema: objectType({
            type: literalType('object'),
            properties: recordType(stringType(), PrimitiveSchemaDefinitionSchema),
            required: optionalType(arrayType(stringType()))
        })
            .passthrough()
    })
});
/**
 * The client's response to an elicitation/create request from the server.
 */
const ElicitResultSchema = ResultSchema.extend({
    /**
     * The user's response action.
     */
    action: enumType(['accept', 'decline', 'cancel']),
    /**
     * The collected user input content (only present if action is "accept").
     */
    content: optionalType(recordType(stringType(), unknownType()))
});
/* Autocomplete */
/**
 * A reference to a resource or resource template definition.
 */
const ResourceTemplateReferenceSchema = objectType({
    type: literalType('ref/resource'),
    /**
     * The URI or URI template of the resource.
     */
    uri: stringType()
})
    .passthrough();
/**
 * Identifies a prompt.
 */
const PromptReferenceSchema = objectType({
    type: literalType('ref/prompt'),
    /**
     * The name of the prompt or prompt template
     */
    name: stringType()
})
    .passthrough();
/**
 * A request from the client to the server, to ask for completion options.
 */
const CompleteRequestSchema = RequestSchema.extend({
    method: literalType('completion/complete'),
    params: BaseRequestParamsSchema.extend({
        ref: unionType([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
        /**
         * The argument's information
         */
        argument: objectType({
            /**
             * The name of the argument
             */
            name: stringType(),
            /**
             * The value of the argument to use for completion matching.
             */
            value: stringType()
        })
            .passthrough(),
        context: optionalType(objectType({
            /**
             * Previously-resolved variables in a URI template or prompt.
             */
            arguments: optionalType(recordType(stringType(), stringType()))
        }))
    })
});
/**
 * The server's response to a completion/complete request
 */
const CompleteResultSchema = ResultSchema.extend({
    completion: objectType({
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: arrayType(stringType()).max(100),
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: optionalType(numberType().int()),
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: optionalType(booleanType())
    })
        .passthrough()
});
/* Roots */
/**
 * Represents a root directory or file that the server can operate on.
 */
const RootSchema = objectType({
    /**
     * The URI identifying the root. This *must* start with file:// for now.
     */
    uri: stringType().startsWith('file://'),
    /**
     * An optional name for the root.
     */
    name: optionalType(stringType()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: optionalType(objectType({}).passthrough())
})
    .passthrough();
/**
 * Sent from the server to request a list of root URIs from the client.
 */
const ListRootsRequestSchema = RequestSchema.extend({
    method: literalType('roots/list')
});
/**
 * The client's response to a roots/list request from the server.
 */
const ListRootsResultSchema = ResultSchema.extend({
    roots: arrayType(RootSchema)
});
/**
 * A notification from the client to the server, informing it that the list of roots has changed.
 */
const RootsListChangedNotificationSchema = NotificationSchema.extend({
    method: literalType('notifications/roots/list_changed')
});
/* Client messages */
unionType([
    PingRequestSchema,
    InitializeRequestSchema,
    CompleteRequestSchema,
    SetLevelRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
    CallToolRequestSchema,
    ListToolsRequestSchema
]);
unionType([
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    InitializedNotificationSchema,
    RootsListChangedNotificationSchema
]);
unionType([EmptyResultSchema, CreateMessageResultSchema, ElicitResultSchema, ListRootsResultSchema]);
/* Server messages */
unionType([PingRequestSchema, CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema]);
unionType([
    CancelledNotificationSchema,
    ProgressNotificationSchema,
    LoggingMessageNotificationSchema,
    ResourceUpdatedNotificationSchema,
    ResourceListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
    PromptListChangedNotificationSchema
]);
unionType([
    EmptyResultSchema,
    InitializeResultSchema,
    CompleteResultSchema,
    GetPromptResultSchema,
    ListPromptsResultSchema,
    ListResourcesResultSchema,
    ListResourceTemplatesResultSchema,
    ReadResourceResultSchema,
    CallToolResultSchema,
    ListToolsResultSchema
]);
class McpError extends Error {
    constructor(code, message, data) {
        super(`MCP error ${code}: ${message}`);
        this.code = code;
        this.data = data;
        this.name = 'McpError';
    }
}

/**
 * The default request timeout, in miliseconds.
 */
const DEFAULT_REQUEST_TIMEOUT_MSEC = 60000;
/**
 * Implements MCP protocol framing on top of a pluggable transport, including
 * features like request/response linking, notifications, and progress.
 */
class Protocol {
    constructor(_options) {
        this._options = _options;
        this._requestMessageId = 0;
        this._requestHandlers = new Map();
        this._requestHandlerAbortControllers = new Map();
        this._notificationHandlers = new Map();
        this._responseHandlers = new Map();
        this._progressHandlers = new Map();
        this._timeoutInfo = new Map();
        this._pendingDebouncedNotifications = new Set();
        this.setNotificationHandler(CancelledNotificationSchema, notification => {
            const controller = this._requestHandlerAbortControllers.get(notification.params.requestId);
            controller === null || controller === void 0 ? void 0 : controller.abort(notification.params.reason);
        });
        this.setNotificationHandler(ProgressNotificationSchema, notification => {
            this._onprogress(notification);
        });
        this.setRequestHandler(PingRequestSchema, 
        // Automatic pong by default.
        _request => ({}));
    }
    _setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = false) {
        this._timeoutInfo.set(messageId, {
            timeoutId: setTimeout(onTimeout, timeout),
            startTime: Date.now(),
            timeout,
            maxTotalTimeout,
            resetTimeoutOnProgress,
            onTimeout
        });
    }
    _resetTimeout(messageId) {
        const info = this._timeoutInfo.get(messageId);
        if (!info)
            return false;
        const totalElapsed = Date.now() - info.startTime;
        if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout) {
            this._timeoutInfo.delete(messageId);
            throw new McpError(ErrorCode.RequestTimeout, 'Maximum total timeout exceeded', {
                maxTotalTimeout: info.maxTotalTimeout,
                totalElapsed
            });
        }
        clearTimeout(info.timeoutId);
        info.timeoutId = setTimeout(info.onTimeout, info.timeout);
        return true;
    }
    _cleanupTimeout(messageId) {
        const info = this._timeoutInfo.get(messageId);
        if (info) {
            clearTimeout(info.timeoutId);
            this._timeoutInfo.delete(messageId);
        }
    }
    /**
     * Attaches to the given transport, starts it, and starts listening for messages.
     *
     * The Protocol object assumes ownership of the Transport, replacing any callbacks that have already been set, and expects that it is the only user of the Transport instance going forward.
     */
    async connect(transport) {
        var _a, _b, _c;
        this._transport = transport;
        const _onclose = (_a = this.transport) === null || _a === void 0 ? void 0 : _a.onclose;
        this._transport.onclose = () => {
            _onclose === null || _onclose === void 0 ? void 0 : _onclose();
            this._onclose();
        };
        const _onerror = (_b = this.transport) === null || _b === void 0 ? void 0 : _b.onerror;
        this._transport.onerror = (error) => {
            _onerror === null || _onerror === void 0 ? void 0 : _onerror(error);
            this._onerror(error);
        };
        const _onmessage = (_c = this._transport) === null || _c === void 0 ? void 0 : _c.onmessage;
        this._transport.onmessage = (message, extra) => {
            _onmessage === null || _onmessage === void 0 ? void 0 : _onmessage(message, extra);
            if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
                this._onresponse(message);
            }
            else if (isJSONRPCRequest(message)) {
                this._onrequest(message, extra);
            }
            else if (isJSONRPCNotification(message)) {
                this._onnotification(message);
            }
            else {
                this._onerror(new Error(`Unknown message type: ${JSON.stringify(message)}`));
            }
        };
        await this._transport.start();
    }
    _onclose() {
        var _a;
        const responseHandlers = this._responseHandlers;
        this._responseHandlers = new Map();
        this._progressHandlers.clear();
        this._pendingDebouncedNotifications.clear();
        this._transport = undefined;
        (_a = this.onclose) === null || _a === void 0 ? void 0 : _a.call(this);
        const error = new McpError(ErrorCode.ConnectionClosed, 'Connection closed');
        for (const handler of responseHandlers.values()) {
            handler(error);
        }
    }
    _onerror(error) {
        var _a;
        (_a = this.onerror) === null || _a === void 0 ? void 0 : _a.call(this, error);
    }
    _onnotification(notification) {
        var _a;
        const handler = (_a = this._notificationHandlers.get(notification.method)) !== null && _a !== void 0 ? _a : this.fallbackNotificationHandler;
        // Ignore notifications not being subscribed to.
        if (handler === undefined) {
            return;
        }
        // Starting with Promise.resolve() puts any synchronous errors into the monad as well.
        Promise.resolve()
            .then(() => handler(notification))
            .catch(error => this._onerror(new Error(`Uncaught error in notification handler: ${error}`)));
    }
    _onrequest(request, extra) {
        var _a, _b;
        const handler = (_a = this._requestHandlers.get(request.method)) !== null && _a !== void 0 ? _a : this.fallbackRequestHandler;
        // Capture the current transport at request time to ensure responses go to the correct client
        const capturedTransport = this._transport;
        if (handler === undefined) {
            capturedTransport === null || capturedTransport === void 0 ? void 0 : capturedTransport.send({
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: ErrorCode.MethodNotFound,
                    message: 'Method not found'
                }
            }).catch(error => this._onerror(new Error(`Failed to send an error response: ${error}`)));
            return;
        }
        const abortController = new AbortController();
        this._requestHandlerAbortControllers.set(request.id, abortController);
        const fullExtra = {
            signal: abortController.signal,
            sessionId: capturedTransport === null || capturedTransport === void 0 ? void 0 : capturedTransport.sessionId,
            _meta: (_b = request.params) === null || _b === void 0 ? void 0 : _b._meta,
            sendNotification: notification => this.notification(notification, { relatedRequestId: request.id }),
            sendRequest: (r, resultSchema, options) => this.request(r, resultSchema, { ...options, relatedRequestId: request.id }),
            authInfo: extra === null || extra === void 0 ? void 0 : extra.authInfo,
            requestId: request.id,
            requestInfo: extra === null || extra === void 0 ? void 0 : extra.requestInfo
        };
        // Starting with Promise.resolve() puts any synchronous errors into the monad as well.
        Promise.resolve()
            .then(() => handler(request, fullExtra))
            .then(result => {
            if (abortController.signal.aborted) {
                return;
            }
            return capturedTransport === null || capturedTransport === void 0 ? void 0 : capturedTransport.send({
                result,
                jsonrpc: '2.0',
                id: request.id
            });
        }, error => {
            var _a;
            if (abortController.signal.aborted) {
                return;
            }
            return capturedTransport === null || capturedTransport === void 0 ? void 0 : capturedTransport.send({
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: Number.isSafeInteger(error['code']) ? error['code'] : ErrorCode.InternalError,
                    message: (_a = error.message) !== null && _a !== void 0 ? _a : 'Internal error'
                }
            });
        })
            .catch(error => this._onerror(new Error(`Failed to send response: ${error}`)))
            .finally(() => {
            this._requestHandlerAbortControllers.delete(request.id);
        });
    }
    _onprogress(notification) {
        const { progressToken, ...params } = notification.params;
        const messageId = Number(progressToken);
        const handler = this._progressHandlers.get(messageId);
        if (!handler) {
            this._onerror(new Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
            return;
        }
        const responseHandler = this._responseHandlers.get(messageId);
        const timeoutInfo = this._timeoutInfo.get(messageId);
        if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress) {
            try {
                this._resetTimeout(messageId);
            }
            catch (error) {
                responseHandler(error);
                return;
            }
        }
        handler(params);
    }
    _onresponse(response) {
        const messageId = Number(response.id);
        const handler = this._responseHandlers.get(messageId);
        if (handler === undefined) {
            this._onerror(new Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
            return;
        }
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        if (isJSONRPCResponse(response)) {
            handler(response);
        }
        else {
            const error = new McpError(response.error.code, response.error.message, response.error.data);
            handler(error);
        }
    }
    get transport() {
        return this._transport;
    }
    /**
     * Closes the connection.
     */
    async close() {
        var _a;
        await ((_a = this._transport) === null || _a === void 0 ? void 0 : _a.close());
    }
    /**
     * Sends a request and wait for a response.
     *
     * Do not use this method to emit notifications! Use notification() instead.
     */
    request(request, resultSchema, options) {
        const { relatedRequestId, resumptionToken, onresumptiontoken } = options !== null && options !== void 0 ? options : {};
        return new Promise((resolve, reject) => {
            var _a, _b, _c, _d, _e, _f;
            if (!this._transport) {
                reject(new Error('Not connected'));
                return;
            }
            if (((_a = this._options) === null || _a === void 0 ? void 0 : _a.enforceStrictCapabilities) === true) {
                this.assertCapabilityForMethod(request.method);
            }
            (_b = options === null || options === void 0 ? void 0 : options.signal) === null || _b === void 0 ? void 0 : _b.throwIfAborted();
            const messageId = this._requestMessageId++;
            const jsonrpcRequest = {
                ...request,
                jsonrpc: '2.0',
                id: messageId
            };
            if (options === null || options === void 0 ? void 0 : options.onprogress) {
                this._progressHandlers.set(messageId, options.onprogress);
                jsonrpcRequest.params = {
                    ...request.params,
                    _meta: {
                        ...(((_c = request.params) === null || _c === void 0 ? void 0 : _c._meta) || {}),
                        progressToken: messageId
                    }
                };
            }
            const cancel = (reason) => {
                var _a;
                this._responseHandlers.delete(messageId);
                this._progressHandlers.delete(messageId);
                this._cleanupTimeout(messageId);
                (_a = this._transport) === null || _a === void 0 ? void 0 : _a.send({
                    jsonrpc: '2.0',
                    method: 'notifications/cancelled',
                    params: {
                        requestId: messageId,
                        reason: String(reason)
                    }
                }, { relatedRequestId, resumptionToken, onresumptiontoken }).catch(error => this._onerror(new Error(`Failed to send cancellation: ${error}`)));
                reject(reason);
            };
            this._responseHandlers.set(messageId, response => {
                var _a;
                if ((_a = options === null || options === void 0 ? void 0 : options.signal) === null || _a === void 0 ? void 0 : _a.aborted) {
                    return;
                }
                if (response instanceof Error) {
                    return reject(response);
                }
                try {
                    const result = resultSchema.parse(response.result);
                    resolve(result);
                }
                catch (error) {
                    reject(error);
                }
            });
            (_d = options === null || options === void 0 ? void 0 : options.signal) === null || _d === void 0 ? void 0 : _d.addEventListener('abort', () => {
                var _a;
                cancel((_a = options === null || options === void 0 ? void 0 : options.signal) === null || _a === void 0 ? void 0 : _a.reason);
            });
            const timeout = (_e = options === null || options === void 0 ? void 0 : options.timeout) !== null && _e !== void 0 ? _e : DEFAULT_REQUEST_TIMEOUT_MSEC;
            const timeoutHandler = () => cancel(new McpError(ErrorCode.RequestTimeout, 'Request timed out', { timeout }));
            this._setupTimeout(messageId, timeout, options === null || options === void 0 ? void 0 : options.maxTotalTimeout, timeoutHandler, (_f = options === null || options === void 0 ? void 0 : options.resetTimeoutOnProgress) !== null && _f !== void 0 ? _f : false);
            this._transport.send(jsonrpcRequest, { relatedRequestId, resumptionToken, onresumptiontoken }).catch(error => {
                this._cleanupTimeout(messageId);
                reject(error);
            });
        });
    }
    /**
     * Emits a notification, which is a one-way message that does not expect a response.
     */
    async notification(notification, options) {
        var _a, _b;
        if (!this._transport) {
            throw new Error('Not connected');
        }
        this.assertNotificationCapability(notification.method);
        const debouncedMethods = (_b = (_a = this._options) === null || _a === void 0 ? void 0 : _a.debouncedNotificationMethods) !== null && _b !== void 0 ? _b : [];
        // A notification can only be debounced if it's in the list AND it's "simple"
        // (i.e., has no parameters and no related request ID that could be lost).
        const canDebounce = debouncedMethods.includes(notification.method) && !notification.params && !(options === null || options === void 0 ? void 0 : options.relatedRequestId);
        if (canDebounce) {
            // If a notification of this type is already scheduled, do nothing.
            if (this._pendingDebouncedNotifications.has(notification.method)) {
                return;
            }
            // Mark this notification type as pending.
            this._pendingDebouncedNotifications.add(notification.method);
            // Schedule the actual send to happen in the next microtask.
            // This allows all synchronous calls in the current event loop tick to be coalesced.
            Promise.resolve().then(() => {
                var _a;
                // Un-mark the notification so the next one can be scheduled.
                this._pendingDebouncedNotifications.delete(notification.method);
                // SAFETY CHECK: If the connection was closed while this was pending, abort.
                if (!this._transport) {
                    return;
                }
                const jsonrpcNotification = {
                    ...notification,
                    jsonrpc: '2.0'
                };
                // Send the notification, but don't await it here to avoid blocking.
                // Handle potential errors with a .catch().
                (_a = this._transport) === null || _a === void 0 ? void 0 : _a.send(jsonrpcNotification, options).catch(error => this._onerror(error));
            });
            // Return immediately.
            return;
        }
        const jsonrpcNotification = {
            ...notification,
            jsonrpc: '2.0'
        };
        await this._transport.send(jsonrpcNotification, options);
    }
    /**
     * Registers a handler to invoke when this protocol object receives a request with the given method.
     *
     * Note that this will replace any previous request handler for the same method.
     */
    setRequestHandler(requestSchema, handler) {
        const method = requestSchema.shape.method.value;
        this.assertRequestHandlerCapability(method);
        this._requestHandlers.set(method, (request, extra) => {
            return Promise.resolve(handler(requestSchema.parse(request), extra));
        });
    }
    /**
     * Removes the request handler for the given method.
     */
    removeRequestHandler(method) {
        this._requestHandlers.delete(method);
    }
    /**
     * Asserts that a request handler has not already been set for the given method, in preparation for a new one being automatically installed.
     */
    assertCanSetRequestHandler(method) {
        if (this._requestHandlers.has(method)) {
            throw new Error(`A request handler for ${method} already exists, which would be overridden`);
        }
    }
    /**
     * Registers a handler to invoke when this protocol object receives a notification with the given method.
     *
     * Note that this will replace any previous notification handler for the same method.
     */
    setNotificationHandler(notificationSchema, handler) {
        this._notificationHandlers.set(notificationSchema.shape.method.value, notification => Promise.resolve(handler(notificationSchema.parse(notification))));
    }
    /**
     * Removes the notification handler for the given method.
     */
    removeNotificationHandler(method) {
        this._notificationHandlers.delete(method);
    }
}
function mergeCapabilities(base, additional) {
    return Object.entries(additional).reduce((acc, [key, value]) => {
        if (value && typeof value === 'object') {
            acc[key] = acc[key] ? { ...acc[key], ...value } : value;
        }
        else {
            acc[key] = value;
        }
        return acc;
    }, { ...base });
}

var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var ajv = {exports: {}};

var core$3 = {};

var validate = {};

var boolSchema = {};

var errors = {};

var codegen = {};

var code$1 = {};

var hasRequiredCode$1;

function requireCode$1 () {
	if (hasRequiredCode$1) return code$1;
	hasRequiredCode$1 = 1;
	(function (exports) {
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;
		// eslint-disable-next-line @typescript-eslint/no-extraneous-class
		class _CodeOrName {
		}
		exports._CodeOrName = _CodeOrName;
		exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
		class Name extends _CodeOrName {
		    constructor(s) {
		        super();
		        if (!exports.IDENTIFIER.test(s))
		            throw new Error("CodeGen: name must be a valid identifier");
		        this.str = s;
		    }
		    toString() {
		        return this.str;
		    }
		    emptyStr() {
		        return false;
		    }
		    get names() {
		        return { [this.str]: 1 };
		    }
		}
		exports.Name = Name;
		class _Code extends _CodeOrName {
		    constructor(code) {
		        super();
		        this._items = typeof code === "string" ? [code] : code;
		    }
		    toString() {
		        return this.str;
		    }
		    emptyStr() {
		        if (this._items.length > 1)
		            return false;
		        const item = this._items[0];
		        return item === "" || item === '""';
		    }
		    get str() {
		        var _a;
		        return ((_a = this._str) !== null && _a !== void 0 ? _a : (this._str = this._items.reduce((s, c) => `${s}${c}`, "")));
		    }
		    get names() {
		        var _a;
		        return ((_a = this._names) !== null && _a !== void 0 ? _a : (this._names = this._items.reduce((names, c) => {
		            if (c instanceof Name)
		                names[c.str] = (names[c.str] || 0) + 1;
		            return names;
		        }, {})));
		    }
		}
		exports._Code = _Code;
		exports.nil = new _Code("");
		function _(strs, ...args) {
		    const code = [strs[0]];
		    let i = 0;
		    while (i < args.length) {
		        addCodeArg(code, args[i]);
		        code.push(strs[++i]);
		    }
		    return new _Code(code);
		}
		exports._ = _;
		const plus = new _Code("+");
		function str(strs, ...args) {
		    const expr = [safeStringify(strs[0])];
		    let i = 0;
		    while (i < args.length) {
		        expr.push(plus);
		        addCodeArg(expr, args[i]);
		        expr.push(plus, safeStringify(strs[++i]));
		    }
		    optimize(expr);
		    return new _Code(expr);
		}
		exports.str = str;
		function addCodeArg(code, arg) {
		    if (arg instanceof _Code)
		        code.push(...arg._items);
		    else if (arg instanceof Name)
		        code.push(arg);
		    else
		        code.push(interpolate(arg));
		}
		exports.addCodeArg = addCodeArg;
		function optimize(expr) {
		    let i = 1;
		    while (i < expr.length - 1) {
		        if (expr[i] === plus) {
		            const res = mergeExprItems(expr[i - 1], expr[i + 1]);
		            if (res !== undefined) {
		                expr.splice(i - 1, 3, res);
		                continue;
		            }
		            expr[i++] = "+";
		        }
		        i++;
		    }
		}
		function mergeExprItems(a, b) {
		    if (b === '""')
		        return a;
		    if (a === '""')
		        return b;
		    if (typeof a == "string") {
		        if (b instanceof Name || a[a.length - 1] !== '"')
		            return;
		        if (typeof b != "string")
		            return `${a.slice(0, -1)}${b}"`;
		        if (b[0] === '"')
		            return a.slice(0, -1) + b.slice(1);
		        return;
		    }
		    if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
		        return `"${a}${b.slice(1)}`;
		    return;
		}
		function strConcat(c1, c2) {
		    return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str `${c1}${c2}`;
		}
		exports.strConcat = strConcat;
		// TODO do not allow arrays here
		function interpolate(x) {
		    return typeof x == "number" || typeof x == "boolean" || x === null
		        ? x
		        : safeStringify(Array.isArray(x) ? x.join(",") : x);
		}
		function stringify(x) {
		    return new _Code(safeStringify(x));
		}
		exports.stringify = stringify;
		function safeStringify(x) {
		    return JSON.stringify(x)
		        .replace(/\u2028/g, "\\u2028")
		        .replace(/\u2029/g, "\\u2029");
		}
		exports.safeStringify = safeStringify;
		function getProperty(key) {
		    return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _ `[${key}]`;
		}
		exports.getProperty = getProperty;
		//Does best effort to format the name properly
		function getEsmExportName(key) {
		    if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
		        return new _Code(`${key}`);
		    }
		    throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
		}
		exports.getEsmExportName = getEsmExportName;
		function regexpCode(rx) {
		    return new _Code(rx.toString());
		}
		exports.regexpCode = regexpCode;
		
	} (code$1));
	return code$1;
}

var scope = {};

var hasRequiredScope;

function requireScope () {
	if (hasRequiredScope) return scope;
	hasRequiredScope = 1;
	(function (exports) {
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
		const code_1 = requireCode$1();
		class ValueError extends Error {
		    constructor(name) {
		        super(`CodeGen: "code" for ${name} not defined`);
		        this.value = name.value;
		    }
		}
		var UsedValueState;
		(function (UsedValueState) {
		    UsedValueState[UsedValueState["Started"] = 0] = "Started";
		    UsedValueState[UsedValueState["Completed"] = 1] = "Completed";
		})(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
		exports.varKinds = {
		    const: new code_1.Name("const"),
		    let: new code_1.Name("let"),
		    var: new code_1.Name("var"),
		};
		class Scope {
		    constructor({ prefixes, parent } = {}) {
		        this._names = {};
		        this._prefixes = prefixes;
		        this._parent = parent;
		    }
		    toName(nameOrPrefix) {
		        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
		    }
		    name(prefix) {
		        return new code_1.Name(this._newName(prefix));
		    }
		    _newName(prefix) {
		        const ng = this._names[prefix] || this._nameGroup(prefix);
		        return `${prefix}${ng.index++}`;
		    }
		    _nameGroup(prefix) {
		        var _a, _b;
		        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || (this._prefixes && !this._prefixes.has(prefix))) {
		            throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
		        }
		        return (this._names[prefix] = { prefix, index: 0 });
		    }
		}
		exports.Scope = Scope;
		class ValueScopeName extends code_1.Name {
		    constructor(prefix, nameStr) {
		        super(nameStr);
		        this.prefix = prefix;
		    }
		    setValue(value, { property, itemIndex }) {
		        this.value = value;
		        this.scopePath = (0, code_1._) `.${new code_1.Name(property)}[${itemIndex}]`;
		    }
		}
		exports.ValueScopeName = ValueScopeName;
		const line = (0, code_1._) `\n`;
		class ValueScope extends Scope {
		    constructor(opts) {
		        super(opts);
		        this._values = {};
		        this._scope = opts.scope;
		        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
		    }
		    get() {
		        return this._scope;
		    }
		    name(prefix) {
		        return new ValueScopeName(prefix, this._newName(prefix));
		    }
		    value(nameOrPrefix, value) {
		        var _a;
		        if (value.ref === undefined)
		            throw new Error("CodeGen: ref must be passed in value");
		        const name = this.toName(nameOrPrefix);
		        const { prefix } = name;
		        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
		        let vs = this._values[prefix];
		        if (vs) {
		            const _name = vs.get(valueKey);
		            if (_name)
		                return _name;
		        }
		        else {
		            vs = this._values[prefix] = new Map();
		        }
		        vs.set(valueKey, name);
		        const s = this._scope[prefix] || (this._scope[prefix] = []);
		        const itemIndex = s.length;
		        s[itemIndex] = value.ref;
		        name.setValue(value, { property: prefix, itemIndex });
		        return name;
		    }
		    getValue(prefix, keyOrRef) {
		        const vs = this._values[prefix];
		        if (!vs)
		            return;
		        return vs.get(keyOrRef);
		    }
		    scopeRefs(scopeName, values = this._values) {
		        return this._reduceValues(values, (name) => {
		            if (name.scopePath === undefined)
		                throw new Error(`CodeGen: name "${name}" has no value`);
		            return (0, code_1._) `${scopeName}${name.scopePath}`;
		        });
		    }
		    scopeCode(values = this._values, usedValues, getCode) {
		        return this._reduceValues(values, (name) => {
		            if (name.value === undefined)
		                throw new Error(`CodeGen: name "${name}" has no value`);
		            return name.value.code;
		        }, usedValues, getCode);
		    }
		    _reduceValues(values, valueCode, usedValues = {}, getCode) {
		        let code = code_1.nil;
		        for (const prefix in values) {
		            const vs = values[prefix];
		            if (!vs)
		                continue;
		            const nameSet = (usedValues[prefix] = usedValues[prefix] || new Map());
		            vs.forEach((name) => {
		                if (nameSet.has(name))
		                    return;
		                nameSet.set(name, UsedValueState.Started);
		                let c = valueCode(name);
		                if (c) {
		                    const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
		                    code = (0, code_1._) `${code}${def} ${name} = ${c};${this.opts._n}`;
		                }
		                else if ((c = getCode === null || getCode === void 0 ? void 0 : getCode(name))) {
		                    code = (0, code_1._) `${code}${c}${this.opts._n}`;
		                }
		                else {
		                    throw new ValueError(name);
		                }
		                nameSet.set(name, UsedValueState.Completed);
		            });
		        }
		        return code;
		    }
		}
		exports.ValueScope = ValueScope;
		
	} (scope));
	return scope;
}

var hasRequiredCodegen;

function requireCodegen () {
	if (hasRequiredCodegen) return codegen;
	hasRequiredCodegen = 1;
	(function (exports) {
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
		const code_1 = requireCode$1();
		const scope_1 = requireScope();
		var code_2 = requireCode$1();
		Object.defineProperty(exports, "_", { enumerable: true, get: function () { return code_2._; } });
		Object.defineProperty(exports, "str", { enumerable: true, get: function () { return code_2.str; } });
		Object.defineProperty(exports, "strConcat", { enumerable: true, get: function () { return code_2.strConcat; } });
		Object.defineProperty(exports, "nil", { enumerable: true, get: function () { return code_2.nil; } });
		Object.defineProperty(exports, "getProperty", { enumerable: true, get: function () { return code_2.getProperty; } });
		Object.defineProperty(exports, "stringify", { enumerable: true, get: function () { return code_2.stringify; } });
		Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function () { return code_2.regexpCode; } });
		Object.defineProperty(exports, "Name", { enumerable: true, get: function () { return code_2.Name; } });
		var scope_2 = requireScope();
		Object.defineProperty(exports, "Scope", { enumerable: true, get: function () { return scope_2.Scope; } });
		Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function () { return scope_2.ValueScope; } });
		Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function () { return scope_2.ValueScopeName; } });
		Object.defineProperty(exports, "varKinds", { enumerable: true, get: function () { return scope_2.varKinds; } });
		exports.operators = {
		    GT: new code_1._Code(">"),
		    GTE: new code_1._Code(">="),
		    LT: new code_1._Code("<"),
		    LTE: new code_1._Code("<="),
		    EQ: new code_1._Code("==="),
		    NEQ: new code_1._Code("!=="),
		    NOT: new code_1._Code("!"),
		    OR: new code_1._Code("||"),
		    AND: new code_1._Code("&&"),
		    ADD: new code_1._Code("+"),
		};
		class Node {
		    optimizeNodes() {
		        return this;
		    }
		    optimizeNames(_names, _constants) {
		        return this;
		    }
		}
		class Def extends Node {
		    constructor(varKind, name, rhs) {
		        super();
		        this.varKind = varKind;
		        this.name = name;
		        this.rhs = rhs;
		    }
		    render({ es5, _n }) {
		        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
		        const rhs = this.rhs === undefined ? "" : ` = ${this.rhs}`;
		        return `${varKind} ${this.name}${rhs};` + _n;
		    }
		    optimizeNames(names, constants) {
		        if (!names[this.name.str])
		            return;
		        if (this.rhs)
		            this.rhs = optimizeExpr(this.rhs, names, constants);
		        return this;
		    }
		    get names() {
		        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
		    }
		}
		class Assign extends Node {
		    constructor(lhs, rhs, sideEffects) {
		        super();
		        this.lhs = lhs;
		        this.rhs = rhs;
		        this.sideEffects = sideEffects;
		    }
		    render({ _n }) {
		        return `${this.lhs} = ${this.rhs};` + _n;
		    }
		    optimizeNames(names, constants) {
		        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
		            return;
		        this.rhs = optimizeExpr(this.rhs, names, constants);
		        return this;
		    }
		    get names() {
		        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
		        return addExprNames(names, this.rhs);
		    }
		}
		class AssignOp extends Assign {
		    constructor(lhs, op, rhs, sideEffects) {
		        super(lhs, rhs, sideEffects);
		        this.op = op;
		    }
		    render({ _n }) {
		        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
		    }
		}
		class Label extends Node {
		    constructor(label) {
		        super();
		        this.label = label;
		        this.names = {};
		    }
		    render({ _n }) {
		        return `${this.label}:` + _n;
		    }
		}
		class Break extends Node {
		    constructor(label) {
		        super();
		        this.label = label;
		        this.names = {};
		    }
		    render({ _n }) {
		        const label = this.label ? ` ${this.label}` : "";
		        return `break${label};` + _n;
		    }
		}
		class Throw extends Node {
		    constructor(error) {
		        super();
		        this.error = error;
		    }
		    render({ _n }) {
		        return `throw ${this.error};` + _n;
		    }
		    get names() {
		        return this.error.names;
		    }
		}
		class AnyCode extends Node {
		    constructor(code) {
		        super();
		        this.code = code;
		    }
		    render({ _n }) {
		        return `${this.code};` + _n;
		    }
		    optimizeNodes() {
		        return `${this.code}` ? this : undefined;
		    }
		    optimizeNames(names, constants) {
		        this.code = optimizeExpr(this.code, names, constants);
		        return this;
		    }
		    get names() {
		        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
		    }
		}
		class ParentNode extends Node {
		    constructor(nodes = []) {
		        super();
		        this.nodes = nodes;
		    }
		    render(opts) {
		        return this.nodes.reduce((code, n) => code + n.render(opts), "");
		    }
		    optimizeNodes() {
		        const { nodes } = this;
		        let i = nodes.length;
		        while (i--) {
		            const n = nodes[i].optimizeNodes();
		            if (Array.isArray(n))
		                nodes.splice(i, 1, ...n);
		            else if (n)
		                nodes[i] = n;
		            else
		                nodes.splice(i, 1);
		        }
		        return nodes.length > 0 ? this : undefined;
		    }
		    optimizeNames(names, constants) {
		        const { nodes } = this;
		        let i = nodes.length;
		        while (i--) {
		            // iterating backwards improves 1-pass optimization
		            const n = nodes[i];
		            if (n.optimizeNames(names, constants))
		                continue;
		            subtractNames(names, n.names);
		            nodes.splice(i, 1);
		        }
		        return nodes.length > 0 ? this : undefined;
		    }
		    get names() {
		        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
		    }
		}
		class BlockNode extends ParentNode {
		    render(opts) {
		        return "{" + opts._n + super.render(opts) + "}" + opts._n;
		    }
		}
		class Root extends ParentNode {
		}
		class Else extends BlockNode {
		}
		Else.kind = "else";
		class If extends BlockNode {
		    constructor(condition, nodes) {
		        super(nodes);
		        this.condition = condition;
		    }
		    render(opts) {
		        let code = `if(${this.condition})` + super.render(opts);
		        if (this.else)
		            code += "else " + this.else.render(opts);
		        return code;
		    }
		    optimizeNodes() {
		        super.optimizeNodes();
		        const cond = this.condition;
		        if (cond === true)
		            return this.nodes; // else is ignored here
		        let e = this.else;
		        if (e) {
		            const ns = e.optimizeNodes();
		            e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
		        }
		        if (e) {
		            if (cond === false)
		                return e instanceof If ? e : e.nodes;
		            if (this.nodes.length)
		                return this;
		            return new If(not(cond), e instanceof If ? [e] : e.nodes);
		        }
		        if (cond === false || !this.nodes.length)
		            return undefined;
		        return this;
		    }
		    optimizeNames(names, constants) {
		        var _a;
		        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
		        if (!(super.optimizeNames(names, constants) || this.else))
		            return;
		        this.condition = optimizeExpr(this.condition, names, constants);
		        return this;
		    }
		    get names() {
		        const names = super.names;
		        addExprNames(names, this.condition);
		        if (this.else)
		            addNames(names, this.else.names);
		        return names;
		    }
		}
		If.kind = "if";
		class For extends BlockNode {
		}
		For.kind = "for";
		class ForLoop extends For {
		    constructor(iteration) {
		        super();
		        this.iteration = iteration;
		    }
		    render(opts) {
		        return `for(${this.iteration})` + super.render(opts);
		    }
		    optimizeNames(names, constants) {
		        if (!super.optimizeNames(names, constants))
		            return;
		        this.iteration = optimizeExpr(this.iteration, names, constants);
		        return this;
		    }
		    get names() {
		        return addNames(super.names, this.iteration.names);
		    }
		}
		class ForRange extends For {
		    constructor(varKind, name, from, to) {
		        super();
		        this.varKind = varKind;
		        this.name = name;
		        this.from = from;
		        this.to = to;
		    }
		    render(opts) {
		        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
		        const { name, from, to } = this;
		        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
		    }
		    get names() {
		        const names = addExprNames(super.names, this.from);
		        return addExprNames(names, this.to);
		    }
		}
		class ForIter extends For {
		    constructor(loop, varKind, name, iterable) {
		        super();
		        this.loop = loop;
		        this.varKind = varKind;
		        this.name = name;
		        this.iterable = iterable;
		    }
		    render(opts) {
		        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
		    }
		    optimizeNames(names, constants) {
		        if (!super.optimizeNames(names, constants))
		            return;
		        this.iterable = optimizeExpr(this.iterable, names, constants);
		        return this;
		    }
		    get names() {
		        return addNames(super.names, this.iterable.names);
		    }
		}
		class Func extends BlockNode {
		    constructor(name, args, async) {
		        super();
		        this.name = name;
		        this.args = args;
		        this.async = async;
		    }
		    render(opts) {
		        const _async = this.async ? "async " : "";
		        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
		    }
		}
		Func.kind = "func";
		class Return extends ParentNode {
		    render(opts) {
		        return "return " + super.render(opts);
		    }
		}
		Return.kind = "return";
		class Try extends BlockNode {
		    render(opts) {
		        let code = "try" + super.render(opts);
		        if (this.catch)
		            code += this.catch.render(opts);
		        if (this.finally)
		            code += this.finally.render(opts);
		        return code;
		    }
		    optimizeNodes() {
		        var _a, _b;
		        super.optimizeNodes();
		        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
		        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
		        return this;
		    }
		    optimizeNames(names, constants) {
		        var _a, _b;
		        super.optimizeNames(names, constants);
		        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
		        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants);
		        return this;
		    }
		    get names() {
		        const names = super.names;
		        if (this.catch)
		            addNames(names, this.catch.names);
		        if (this.finally)
		            addNames(names, this.finally.names);
		        return names;
		    }
		}
		class Catch extends BlockNode {
		    constructor(error) {
		        super();
		        this.error = error;
		    }
		    render(opts) {
		        return `catch(${this.error})` + super.render(opts);
		    }
		}
		Catch.kind = "catch";
		class Finally extends BlockNode {
		    render(opts) {
		        return "finally" + super.render(opts);
		    }
		}
		Finally.kind = "finally";
		class CodeGen {
		    constructor(extScope, opts = {}) {
		        this._values = {};
		        this._blockStarts = [];
		        this._constants = {};
		        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
		        this._extScope = extScope;
		        this._scope = new scope_1.Scope({ parent: extScope });
		        this._nodes = [new Root()];
		    }
		    toString() {
		        return this._root.render(this.opts);
		    }
		    // returns unique name in the internal scope
		    name(prefix) {
		        return this._scope.name(prefix);
		    }
		    // reserves unique name in the external scope
		    scopeName(prefix) {
		        return this._extScope.name(prefix);
		    }
		    // reserves unique name in the external scope and assigns value to it
		    scopeValue(prefixOrName, value) {
		        const name = this._extScope.value(prefixOrName, value);
		        const vs = this._values[name.prefix] || (this._values[name.prefix] = new Set());
		        vs.add(name);
		        return name;
		    }
		    getScopeValue(prefix, keyOrRef) {
		        return this._extScope.getValue(prefix, keyOrRef);
		    }
		    // return code that assigns values in the external scope to the names that are used internally
		    // (same names that were returned by gen.scopeName or gen.scopeValue)
		    scopeRefs(scopeName) {
		        return this._extScope.scopeRefs(scopeName, this._values);
		    }
		    scopeCode() {
		        return this._extScope.scopeCode(this._values);
		    }
		    _def(varKind, nameOrPrefix, rhs, constant) {
		        const name = this._scope.toName(nameOrPrefix);
		        if (rhs !== undefined && constant)
		            this._constants[name.str] = rhs;
		        this._leafNode(new Def(varKind, name, rhs));
		        return name;
		    }
		    // `const` declaration (`var` in es5 mode)
		    const(nameOrPrefix, rhs, _constant) {
		        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
		    }
		    // `let` declaration with optional assignment (`var` in es5 mode)
		    let(nameOrPrefix, rhs, _constant) {
		        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
		    }
		    // `var` declaration with optional assignment
		    var(nameOrPrefix, rhs, _constant) {
		        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
		    }
		    // assignment code
		    assign(lhs, rhs, sideEffects) {
		        return this._leafNode(new Assign(lhs, rhs, sideEffects));
		    }
		    // `+=` code
		    add(lhs, rhs) {
		        return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
		    }
		    // appends passed SafeExpr to code or executes Block
		    code(c) {
		        if (typeof c == "function")
		            c();
		        else if (c !== code_1.nil)
		            this._leafNode(new AnyCode(c));
		        return this;
		    }
		    // returns code for object literal for the passed argument list of key-value pairs
		    object(...keyValues) {
		        const code = ["{"];
		        for (const [key, value] of keyValues) {
		            if (code.length > 1)
		                code.push(",");
		            code.push(key);
		            if (key !== value || this.opts.es5) {
		                code.push(":");
		                (0, code_1.addCodeArg)(code, value);
		            }
		        }
		        code.push("}");
		        return new code_1._Code(code);
		    }
		    // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
		    if(condition, thenBody, elseBody) {
		        this._blockNode(new If(condition));
		        if (thenBody && elseBody) {
		            this.code(thenBody).else().code(elseBody).endIf();
		        }
		        else if (thenBody) {
		            this.code(thenBody).endIf();
		        }
		        else if (elseBody) {
		            throw new Error('CodeGen: "else" body without "then" body');
		        }
		        return this;
		    }
		    // `else if` clause - invalid without `if` or after `else` clauses
		    elseIf(condition) {
		        return this._elseNode(new If(condition));
		    }
		    // `else` clause - only valid after `if` or `else if` clauses
		    else() {
		        return this._elseNode(new Else());
		    }
		    // end `if` statement (needed if gen.if was used only with condition)
		    endIf() {
		        return this._endBlockNode(If, Else);
		    }
		    _for(node, forBody) {
		        this._blockNode(node);
		        if (forBody)
		            this.code(forBody).endFor();
		        return this;
		    }
		    // a generic `for` clause (or statement if `forBody` is passed)
		    for(iteration, forBody) {
		        return this._for(new ForLoop(iteration), forBody);
		    }
		    // `for` statement for a range of values
		    forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
		        const name = this._scope.toName(nameOrPrefix);
		        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
		    }
		    // `for-of` statement (in es5 mode replace with a normal for loop)
		    forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
		        const name = this._scope.toName(nameOrPrefix);
		        if (this.opts.es5) {
		            const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
		            return this.forRange("_i", 0, (0, code_1._) `${arr}.length`, (i) => {
		                this.var(name, (0, code_1._) `${arr}[${i}]`);
		                forBody(name);
		            });
		        }
		        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
		    }
		    // `for-in` statement.
		    // With option `ownProperties` replaced with a `for-of` loop for object keys
		    forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
		        if (this.opts.ownProperties) {
		            return this.forOf(nameOrPrefix, (0, code_1._) `Object.keys(${obj})`, forBody);
		        }
		        const name = this._scope.toName(nameOrPrefix);
		        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
		    }
		    // end `for` loop
		    endFor() {
		        return this._endBlockNode(For);
		    }
		    // `label` statement
		    label(label) {
		        return this._leafNode(new Label(label));
		    }
		    // `break` statement
		    break(label) {
		        return this._leafNode(new Break(label));
		    }
		    // `return` statement
		    return(value) {
		        const node = new Return();
		        this._blockNode(node);
		        this.code(value);
		        if (node.nodes.length !== 1)
		            throw new Error('CodeGen: "return" should have one node');
		        return this._endBlockNode(Return);
		    }
		    // `try` statement
		    try(tryBody, catchCode, finallyCode) {
		        if (!catchCode && !finallyCode)
		            throw new Error('CodeGen: "try" without "catch" and "finally"');
		        const node = new Try();
		        this._blockNode(node);
		        this.code(tryBody);
		        if (catchCode) {
		            const error = this.name("e");
		            this._currNode = node.catch = new Catch(error);
		            catchCode(error);
		        }
		        if (finallyCode) {
		            this._currNode = node.finally = new Finally();
		            this.code(finallyCode);
		        }
		        return this._endBlockNode(Catch, Finally);
		    }
		    // `throw` statement
		    throw(error) {
		        return this._leafNode(new Throw(error));
		    }
		    // start self-balancing block
		    block(body, nodeCount) {
		        this._blockStarts.push(this._nodes.length);
		        if (body)
		            this.code(body).endBlock(nodeCount);
		        return this;
		    }
		    // end the current self-balancing block
		    endBlock(nodeCount) {
		        const len = this._blockStarts.pop();
		        if (len === undefined)
		            throw new Error("CodeGen: not in self-balancing block");
		        const toClose = this._nodes.length - len;
		        if (toClose < 0 || (nodeCount !== undefined && toClose !== nodeCount)) {
		            throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
		        }
		        this._nodes.length = len;
		        return this;
		    }
		    // `function` heading (or definition if funcBody is passed)
		    func(name, args = code_1.nil, async, funcBody) {
		        this._blockNode(new Func(name, args, async));
		        if (funcBody)
		            this.code(funcBody).endFunc();
		        return this;
		    }
		    // end function definition
		    endFunc() {
		        return this._endBlockNode(Func);
		    }
		    optimize(n = 1) {
		        while (n-- > 0) {
		            this._root.optimizeNodes();
		            this._root.optimizeNames(this._root.names, this._constants);
		        }
		    }
		    _leafNode(node) {
		        this._currNode.nodes.push(node);
		        return this;
		    }
		    _blockNode(node) {
		        this._currNode.nodes.push(node);
		        this._nodes.push(node);
		    }
		    _endBlockNode(N1, N2) {
		        const n = this._currNode;
		        if (n instanceof N1 || (N2 && n instanceof N2)) {
		            this._nodes.pop();
		            return this;
		        }
		        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
		    }
		    _elseNode(node) {
		        const n = this._currNode;
		        if (!(n instanceof If)) {
		            throw new Error('CodeGen: "else" without "if"');
		        }
		        this._currNode = n.else = node;
		        return this;
		    }
		    get _root() {
		        return this._nodes[0];
		    }
		    get _currNode() {
		        const ns = this._nodes;
		        return ns[ns.length - 1];
		    }
		    set _currNode(node) {
		        const ns = this._nodes;
		        ns[ns.length - 1] = node;
		    }
		}
		exports.CodeGen = CodeGen;
		function addNames(names, from) {
		    for (const n in from)
		        names[n] = (names[n] || 0) + (from[n] || 0);
		    return names;
		}
		function addExprNames(names, from) {
		    return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
		}
		function optimizeExpr(expr, names, constants) {
		    if (expr instanceof code_1.Name)
		        return replaceName(expr);
		    if (!canOptimize(expr))
		        return expr;
		    return new code_1._Code(expr._items.reduce((items, c) => {
		        if (c instanceof code_1.Name)
		            c = replaceName(c);
		        if (c instanceof code_1._Code)
		            items.push(...c._items);
		        else
		            items.push(c);
		        return items;
		    }, []));
		    function replaceName(n) {
		        const c = constants[n.str];
		        if (c === undefined || names[n.str] !== 1)
		            return n;
		        delete names[n.str];
		        return c;
		    }
		    function canOptimize(e) {
		        return (e instanceof code_1._Code &&
		            e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== undefined));
		    }
		}
		function subtractNames(names, from) {
		    for (const n in from)
		        names[n] = (names[n] || 0) - (from[n] || 0);
		}
		function not(x) {
		    return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._) `!${par(x)}`;
		}
		exports.not = not;
		const andCode = mappend(exports.operators.AND);
		// boolean AND (&&) expression with the passed arguments
		function and(...args) {
		    return args.reduce(andCode);
		}
		exports.and = and;
		const orCode = mappend(exports.operators.OR);
		// boolean OR (||) expression with the passed arguments
		function or(...args) {
		    return args.reduce(orCode);
		}
		exports.or = or;
		function mappend(op) {
		    return (x, y) => (x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._) `${par(x)} ${op} ${par(y)}`);
		}
		function par(x) {
		    return x instanceof code_1.Name ? x : (0, code_1._) `(${x})`;
		}
		
	} (codegen));
	return codegen;
}

var util = {};

Object.defineProperty(util, "__esModule", { value: true });
util.checkStrictMode = util.getErrorPath = util.Type = util.useFunc = util.setEvaluated = util.evaluatedPropsToName = util.mergeEvaluated = util.eachItem = util.unescapeJsonPointer = util.escapeJsonPointer = util.escapeFragment = util.unescapeFragment = util.schemaRefOrVal = util.schemaHasRulesButRef = util.schemaHasRules = util.checkUnknownRules = util.alwaysValidSchema = util.toHash = void 0;
const codegen_1$o = requireCodegen();
const code_1$9 = requireCode$1();
// TODO refactor to use Set
function toHash(arr) {
    const hash = {};
    for (const item of arr)
        hash[item] = true;
    return hash;
}
util.toHash = toHash;
function alwaysValidSchema(it, schema) {
    if (typeof schema == "boolean")
        return schema;
    if (Object.keys(schema).length === 0)
        return true;
    checkUnknownRules(it, schema);
    return !schemaHasRules(schema, it.self.RULES.all);
}
util.alwaysValidSchema = alwaysValidSchema;
function checkUnknownRules(it, schema = it.schema) {
    const { opts, self } = it;
    if (!opts.strictSchema)
        return;
    if (typeof schema === "boolean")
        return;
    const rules = self.RULES.keywords;
    for (const key in schema) {
        if (!rules[key])
            checkStrictMode(it, `unknown keyword: "${key}"`);
    }
}
util.checkUnknownRules = checkUnknownRules;
function schemaHasRules(schema, rules) {
    if (typeof schema == "boolean")
        return !schema;
    for (const key in schema)
        if (rules[key])
            return true;
    return false;
}
util.schemaHasRules = schemaHasRules;
function schemaHasRulesButRef(schema, RULES) {
    if (typeof schema == "boolean")
        return !schema;
    for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
            return true;
    return false;
}
util.schemaHasRulesButRef = schemaHasRulesButRef;
function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
    if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
            return schema;
        if (typeof schema == "string")
            return (0, codegen_1$o._) `${schema}`;
    }
    return (0, codegen_1$o._) `${topSchemaRef}${schemaPath}${(0, codegen_1$o.getProperty)(keyword)}`;
}
util.schemaRefOrVal = schemaRefOrVal;
function unescapeFragment(str) {
    return unescapeJsonPointer(decodeURIComponent(str));
}
util.unescapeFragment = unescapeFragment;
function escapeFragment(str) {
    return encodeURIComponent(escapeJsonPointer(str));
}
util.escapeFragment = escapeFragment;
function escapeJsonPointer(str) {
    if (typeof str == "number")
        return `${str}`;
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
}
util.escapeJsonPointer = escapeJsonPointer;
function unescapeJsonPointer(str) {
    return str.replace(/~1/g, "/").replace(/~0/g, "~");
}
util.unescapeJsonPointer = unescapeJsonPointer;
function eachItem(xs, f) {
    if (Array.isArray(xs)) {
        for (const x of xs)
            f(x);
    }
    else {
        f(xs);
    }
}
util.eachItem = eachItem;
function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName, }) {
    return (gen, from, to, toName) => {
        const res = to === undefined
            ? from
            : to instanceof codegen_1$o.Name
                ? (from instanceof codegen_1$o.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to)
                : from instanceof codegen_1$o.Name
                    ? (mergeToName(gen, to, from), from)
                    : mergeValues(from, to);
        return toName === codegen_1$o.Name && !(res instanceof codegen_1$o.Name) ? resultToName(gen, res) : res;
    };
}
util.mergeEvaluated = {
    props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1$o._) `${to} !== true && ${from} !== undefined`, () => {
            gen.if((0, codegen_1$o._) `${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1$o._) `${to} || {}`).code((0, codegen_1$o._) `Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1$o._) `${to} !== true`, () => {
            if (from === true) {
                gen.assign(to, true);
            }
            else {
                gen.assign(to, (0, codegen_1$o._) `${to} || {}`);
                setEvaluated(gen, to, from);
            }
        }),
        mergeValues: (from, to) => (from === true ? true : { ...from, ...to }),
        resultToName: evaluatedPropsToName,
    }),
    items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1$o._) `${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1$o._) `${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1$o._) `${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1$o._) `${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => (from === true ? true : Math.max(from, to)),
        resultToName: (gen, items) => gen.var("items", items),
    }),
};
function evaluatedPropsToName(gen, ps) {
    if (ps === true)
        return gen.var("props", true);
    const props = gen.var("props", (0, codegen_1$o._) `{}`);
    if (ps !== undefined)
        setEvaluated(gen, props, ps);
    return props;
}
util.evaluatedPropsToName = evaluatedPropsToName;
function setEvaluated(gen, props, ps) {
    Object.keys(ps).forEach((p) => gen.assign((0, codegen_1$o._) `${props}${(0, codegen_1$o.getProperty)(p)}`, true));
}
util.setEvaluated = setEvaluated;
const snippets = {};
function useFunc(gen, f) {
    return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1$9._Code(f.code)),
    });
}
util.useFunc = useFunc;
var Type;
(function (Type) {
    Type[Type["Num"] = 0] = "Num";
    Type[Type["Str"] = 1] = "Str";
})(Type || (util.Type = Type = {}));
function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
    // let path
    if (dataProp instanceof codegen_1$o.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax
            ? isNumber
                ? (0, codegen_1$o._) `"[" + ${dataProp} + "]"`
                : (0, codegen_1$o._) `"['" + ${dataProp} + "']"`
            : isNumber
                ? (0, codegen_1$o._) `"/" + ${dataProp}`
                : (0, codegen_1$o._) `"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`; // TODO maybe use global escapePointer
    }
    return jsPropertySyntax ? (0, codegen_1$o.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
}
util.getErrorPath = getErrorPath;
function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
    if (!mode)
        return;
    msg = `strict mode: ${msg}`;
    if (mode === true)
        throw new Error(msg);
    it.self.logger.warn(msg);
}
util.checkStrictMode = checkStrictMode;

var names = {};

var hasRequiredNames;

function requireNames () {
	if (hasRequiredNames) return names;
	hasRequiredNames = 1;
	Object.defineProperty(names, "__esModule", { value: true });
	const codegen_1 = requireCodegen();
	const names$1 = {
	    // validation function arguments
	    data: new codegen_1.Name("data"), // data passed to validation function
	    // args passed from referencing schema
	    valCxt: new codegen_1.Name("valCxt"), // validation/data context - should not be used directly, it is destructured to the names below
	    instancePath: new codegen_1.Name("instancePath"),
	    parentData: new codegen_1.Name("parentData"),
	    parentDataProperty: new codegen_1.Name("parentDataProperty"),
	    rootData: new codegen_1.Name("rootData"), // root data - same as the data passed to the first/top validation function
	    dynamicAnchors: new codegen_1.Name("dynamicAnchors"), // used to support recursiveRef and dynamicRef
	    // function scoped variables
	    vErrors: new codegen_1.Name("vErrors"), // null or array of validation errors
	    errors: new codegen_1.Name("errors"), // counter of validation errors
	    this: new codegen_1.Name("this"),
	    // "globals"
	    self: new codegen_1.Name("self"),
	    scope: new codegen_1.Name("scope"),
	    // JTD serialize/parse name for JSON string and position
	    json: new codegen_1.Name("json"),
	    jsonPos: new codegen_1.Name("jsonPos"),
	    jsonLen: new codegen_1.Name("jsonLen"),
	    jsonPart: new codegen_1.Name("jsonPart"),
	};
	names.default = names$1;
	
	return names;
}

var hasRequiredErrors;

function requireErrors () {
	if (hasRequiredErrors) return errors;
	hasRequiredErrors = 1;
	(function (exports) {
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
		const codegen_1 = requireCodegen();
		const util_1 = util;
		const names_1 = requireNames();
		exports.keywordError = {
		    message: ({ keyword }) => (0, codegen_1.str) `must pass "${keyword}" keyword validation`,
		};
		exports.keyword$DataError = {
		    message: ({ keyword, schemaType }) => schemaType
		        ? (0, codegen_1.str) `"${keyword}" keyword must be ${schemaType} ($data)`
		        : (0, codegen_1.str) `"${keyword}" keyword is invalid ($data)`,
		};
		function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
		    const { it } = cxt;
		    const { gen, compositeRule, allErrors } = it;
		    const errObj = errorObjectCode(cxt, error, errorPaths);
		    if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : (compositeRule || allErrors)) {
		        addError(gen, errObj);
		    }
		    else {
		        returnErrors(it, (0, codegen_1._) `[${errObj}]`);
		    }
		}
		exports.reportError = reportError;
		function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
		    const { it } = cxt;
		    const { gen, compositeRule, allErrors } = it;
		    const errObj = errorObjectCode(cxt, error, errorPaths);
		    addError(gen, errObj);
		    if (!(compositeRule || allErrors)) {
		        returnErrors(it, names_1.default.vErrors);
		    }
		}
		exports.reportExtraError = reportExtraError;
		function resetErrorsCount(gen, errsCount) {
		    gen.assign(names_1.default.errors, errsCount);
		    gen.if((0, codegen_1._) `${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._) `${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
		}
		exports.resetErrorsCount = resetErrorsCount;
		function extendErrors({ gen, keyword, schemaValue, data, errsCount, it, }) {
		    /* istanbul ignore if */
		    if (errsCount === undefined)
		        throw new Error("ajv implementation error");
		    const err = gen.name("err");
		    gen.forRange("i", errsCount, names_1.default.errors, (i) => {
		        gen.const(err, (0, codegen_1._) `${names_1.default.vErrors}[${i}]`);
		        gen.if((0, codegen_1._) `${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._) `${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
		        gen.assign((0, codegen_1._) `${err}.schemaPath`, (0, codegen_1.str) `${it.errSchemaPath}/${keyword}`);
		        if (it.opts.verbose) {
		            gen.assign((0, codegen_1._) `${err}.schema`, schemaValue);
		            gen.assign((0, codegen_1._) `${err}.data`, data);
		        }
		    });
		}
		exports.extendErrors = extendErrors;
		function addError(gen, errObj) {
		    const err = gen.const("err", errObj);
		    gen.if((0, codegen_1._) `${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._) `[${err}]`), (0, codegen_1._) `${names_1.default.vErrors}.push(${err})`);
		    gen.code((0, codegen_1._) `${names_1.default.errors}++`);
		}
		function returnErrors(it, errs) {
		    const { gen, validateName, schemaEnv } = it;
		    if (schemaEnv.$async) {
		        gen.throw((0, codegen_1._) `new ${it.ValidationError}(${errs})`);
		    }
		    else {
		        gen.assign((0, codegen_1._) `${validateName}.errors`, errs);
		        gen.return(false);
		    }
		}
		const E = {
		    keyword: new codegen_1.Name("keyword"),
		    schemaPath: new codegen_1.Name("schemaPath"), // also used in JTD errors
		    params: new codegen_1.Name("params"),
		    propertyName: new codegen_1.Name("propertyName"),
		    message: new codegen_1.Name("message"),
		    schema: new codegen_1.Name("schema"),
		    parentSchema: new codegen_1.Name("parentSchema"),
		};
		function errorObjectCode(cxt, error, errorPaths) {
		    const { createErrors } = cxt.it;
		    if (createErrors === false)
		        return (0, codegen_1._) `{}`;
		    return errorObject(cxt, error, errorPaths);
		}
		function errorObject(cxt, error, errorPaths = {}) {
		    const { gen, it } = cxt;
		    const keyValues = [
		        errorInstancePath(it, errorPaths),
		        errorSchemaPath(cxt, errorPaths),
		    ];
		    extraErrorProps(cxt, error, keyValues);
		    return gen.object(...keyValues);
		}
		function errorInstancePath({ errorPath }, { instancePath }) {
		    const instPath = instancePath
		        ? (0, codegen_1.str) `${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}`
		        : errorPath;
		    return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
		}
		function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
		    let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str) `${errSchemaPath}/${keyword}`;
		    if (schemaPath) {
		        schPath = (0, codegen_1.str) `${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
		    }
		    return [E.schemaPath, schPath];
		}
		function extraErrorProps(cxt, { params, message }, keyValues) {
		    const { keyword, data, schemaValue, it } = cxt;
		    const { opts, propertyName, topSchemaRef, schemaPath } = it;
		    keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._) `{}`]);
		    if (opts.messages) {
		        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
		    }
		    if (opts.verbose) {
		        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._) `${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
		    }
		    if (propertyName)
		        keyValues.push([E.propertyName, propertyName]);
		}
		
	} (errors));
	return errors;
}

var hasRequiredBoolSchema;

function requireBoolSchema () {
	if (hasRequiredBoolSchema) return boolSchema;
	hasRequiredBoolSchema = 1;
	Object.defineProperty(boolSchema, "__esModule", { value: true });
	boolSchema.boolOrEmptySchema = boolSchema.topBoolOrEmptySchema = void 0;
	const errors_1 = requireErrors();
	const codegen_1 = requireCodegen();
	const names_1 = requireNames();
	const boolError = {
	    message: "boolean schema is false",
	};
	function topBoolOrEmptySchema(it) {
	    const { gen, schema, validateName } = it;
	    if (schema === false) {
	        falseSchemaError(it, false);
	    }
	    else if (typeof schema == "object" && schema.$async === true) {
	        gen.return(names_1.default.data);
	    }
	    else {
	        gen.assign((0, codegen_1._) `${validateName}.errors`, null);
	        gen.return(true);
	    }
	}
	boolSchema.topBoolOrEmptySchema = topBoolOrEmptySchema;
	function boolOrEmptySchema(it, valid) {
	    const { gen, schema } = it;
	    if (schema === false) {
	        gen.var(valid, false); // TODO var
	        falseSchemaError(it);
	    }
	    else {
	        gen.var(valid, true); // TODO var
	    }
	}
	boolSchema.boolOrEmptySchema = boolOrEmptySchema;
	function falseSchemaError(it, overrideAllErrors) {
	    const { gen, data } = it;
	    // TODO maybe some other interface should be used for non-keyword validation errors...
	    const cxt = {
	        gen,
	        keyword: "false schema",
	        data,
	        schema: false,
	        schemaCode: false,
	        schemaValue: false,
	        params: {},
	        it,
	    };
	    (0, errors_1.reportError)(cxt, boolError, undefined, overrideAllErrors);
	}
	
	return boolSchema;
}

var dataType = {};

var rules = {};

Object.defineProperty(rules, "__esModule", { value: true });
rules.getRules = rules.isJSONType = void 0;
const _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
const jsonTypes = new Set(_jsonTypes);
function isJSONType(x) {
    return typeof x == "string" && jsonTypes.has(x);
}
rules.isJSONType = isJSONType;
function getRules() {
    const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] },
    };
    return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {},
    };
}
rules.getRules = getRules;

var applicability = {};

var hasRequiredApplicability;

function requireApplicability () {
	if (hasRequiredApplicability) return applicability;
	hasRequiredApplicability = 1;
	Object.defineProperty(applicability, "__esModule", { value: true });
	applicability.shouldUseRule = applicability.shouldUseGroup = applicability.schemaHasRulesForType = void 0;
	function schemaHasRulesForType({ schema, self }, type) {
	    const group = self.RULES.types[type];
	    return group && group !== true && shouldUseGroup(schema, group);
	}
	applicability.schemaHasRulesForType = schemaHasRulesForType;
	function shouldUseGroup(schema, group) {
	    return group.rules.some((rule) => shouldUseRule(schema, rule));
	}
	applicability.shouldUseGroup = shouldUseGroup;
	function shouldUseRule(schema, rule) {
	    var _a;
	    return (schema[rule.keyword] !== undefined ||
	        ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== undefined)));
	}
	applicability.shouldUseRule = shouldUseRule;
	
	return applicability;
}

Object.defineProperty(dataType, "__esModule", { value: true });
dataType.reportTypeError = dataType.checkDataTypes = dataType.checkDataType = dataType.coerceAndCheckDataType = dataType.getJSONTypes = dataType.getSchemaTypes = dataType.DataType = void 0;
const rules_1 = rules;
const applicability_1 = requireApplicability();
const errors_1 = requireErrors();
const codegen_1$n = requireCodegen();
const util_1$m = util;
var DataType;
(function (DataType) {
    DataType[DataType["Correct"] = 0] = "Correct";
    DataType[DataType["Wrong"] = 1] = "Wrong";
})(DataType || (dataType.DataType = DataType = {}));
function getSchemaTypes(schema) {
    const types = getJSONTypes(schema.type);
    const hasNull = types.includes("null");
    if (hasNull) {
        if (schema.nullable === false)
            throw new Error("type: null contradicts nullable: false");
    }
    else {
        if (!types.length && schema.nullable !== undefined) {
            throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
            types.push("null");
    }
    return types;
}
dataType.getSchemaTypes = getSchemaTypes;
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function getJSONTypes(ts) {
    const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
    if (types.every(rules_1.isJSONType))
        return types;
    throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
}
dataType.getJSONTypes = getJSONTypes;
function coerceAndCheckDataType(it, types) {
    const { gen, data, opts } = it;
    const coerceTo = coerceToTypes(types, opts.coerceTypes);
    const checkTypes = types.length > 0 &&
        !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
    if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
            if (coerceTo.length)
                coerceData(it, types, coerceTo);
            else
                reportTypeError(it);
        });
    }
    return checkTypes;
}
dataType.coerceAndCheckDataType = coerceAndCheckDataType;
const COERCIBLE = new Set(["string", "number", "integer", "boolean", "null"]);
function coerceToTypes(types, coerceTypes) {
    return coerceTypes
        ? types.filter((t) => COERCIBLE.has(t) || (coerceTypes === "array" && t === "array"))
        : [];
}
function coerceData(it, types, coerceTo) {
    const { gen, data, opts } = it;
    const dataType = gen.let("dataType", (0, codegen_1$n._) `typeof ${data}`);
    const coerced = gen.let("coerced", (0, codegen_1$n._) `undefined`);
    if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1$n._) `${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen
            .assign(data, (0, codegen_1$n._) `${data}[0]`)
            .assign(dataType, (0, codegen_1$n._) `typeof ${data}`)
            .if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
    }
    gen.if((0, codegen_1$n._) `${coerced} !== undefined`);
    for (const t of coerceTo) {
        if (COERCIBLE.has(t) || (t === "array" && opts.coerceTypes === "array")) {
            coerceSpecificType(t);
        }
    }
    gen.else();
    reportTypeError(it);
    gen.endIf();
    gen.if((0, codegen_1$n._) `${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
    });
    function coerceSpecificType(t) {
        switch (t) {
            case "string":
                gen
                    .elseIf((0, codegen_1$n._) `${dataType} == "number" || ${dataType} == "boolean"`)
                    .assign(coerced, (0, codegen_1$n._) `"" + ${data}`)
                    .elseIf((0, codegen_1$n._) `${data} === null`)
                    .assign(coerced, (0, codegen_1$n._) `""`);
                return;
            case "number":
                gen
                    .elseIf((0, codegen_1$n._) `${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`)
                    .assign(coerced, (0, codegen_1$n._) `+${data}`);
                return;
            case "integer":
                gen
                    .elseIf((0, codegen_1$n._) `${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`)
                    .assign(coerced, (0, codegen_1$n._) `+${data}`);
                return;
            case "boolean":
                gen
                    .elseIf((0, codegen_1$n._) `${data} === "false" || ${data} === 0 || ${data} === null`)
                    .assign(coerced, false)
                    .elseIf((0, codegen_1$n._) `${data} === "true" || ${data} === 1`)
                    .assign(coerced, true);
                return;
            case "null":
                gen.elseIf((0, codegen_1$n._) `${data} === "" || ${data} === 0 || ${data} === false`);
                gen.assign(coerced, null);
                return;
            case "array":
                gen
                    .elseIf((0, codegen_1$n._) `${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`)
                    .assign(coerced, (0, codegen_1$n._) `[${data}]`);
        }
    }
}
function assignParentData({ gen, parentData, parentDataProperty }, expr) {
    // TODO use gen.property
    gen.if((0, codegen_1$n._) `${parentData} !== undefined`, () => gen.assign((0, codegen_1$n._) `${parentData}[${parentDataProperty}]`, expr));
}
function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
    const EQ = correct === DataType.Correct ? codegen_1$n.operators.EQ : codegen_1$n.operators.NEQ;
    let cond;
    switch (dataType) {
        case "null":
            return (0, codegen_1$n._) `${data} ${EQ} null`;
        case "array":
            cond = (0, codegen_1$n._) `Array.isArray(${data})`;
            break;
        case "object":
            cond = (0, codegen_1$n._) `${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
            break;
        case "integer":
            cond = numCond((0, codegen_1$n._) `!(${data} % 1) && !isNaN(${data})`);
            break;
        case "number":
            cond = numCond();
            break;
        default:
            return (0, codegen_1$n._) `typeof ${data} ${EQ} ${dataType}`;
    }
    return correct === DataType.Correct ? cond : (0, codegen_1$n.not)(cond);
    function numCond(_cond = codegen_1$n.nil) {
        return (0, codegen_1$n.and)((0, codegen_1$n._) `typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1$n._) `isFinite(${data})` : codegen_1$n.nil);
    }
}
dataType.checkDataType = checkDataType;
function checkDataTypes(dataTypes, data, strictNums, correct) {
    if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
    }
    let cond;
    const types = (0, util_1$m.toHash)(dataTypes);
    if (types.array && types.object) {
        const notObj = (0, codegen_1$n._) `typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1$n._) `!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
    }
    else {
        cond = codegen_1$n.nil;
    }
    if (types.number)
        delete types.integer;
    for (const t in types)
        cond = (0, codegen_1$n.and)(cond, checkDataType(t, data, strictNums, correct));
    return cond;
}
dataType.checkDataTypes = checkDataTypes;
const typeError = {
    message: ({ schema }) => `must be ${schema}`,
    params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1$n._) `{type: ${schema}}` : (0, codegen_1$n._) `{type: ${schemaValue}}`,
};
function reportTypeError(it) {
    const cxt = getTypeErrorContext(it);
    (0, errors_1.reportError)(cxt, typeError);
}
dataType.reportTypeError = reportTypeError;
function getTypeErrorContext(it) {
    const { gen, data, schema } = it;
    const schemaCode = (0, util_1$m.schemaRefOrVal)(it, schema, "type");
    return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it,
    };
}

var defaults = {};

var hasRequiredDefaults;

function requireDefaults () {
	if (hasRequiredDefaults) return defaults;
	hasRequiredDefaults = 1;
	Object.defineProperty(defaults, "__esModule", { value: true });
	defaults.assignDefaults = void 0;
	const codegen_1 = requireCodegen();
	const util_1 = util;
	function assignDefaults(it, ty) {
	    const { properties, items } = it.schema;
	    if (ty === "object" && properties) {
	        for (const key in properties) {
	            assignDefault(it, key, properties[key].default);
	        }
	    }
	    else if (ty === "array" && Array.isArray(items)) {
	        items.forEach((sch, i) => assignDefault(it, i, sch.default));
	    }
	}
	defaults.assignDefaults = assignDefaults;
	function assignDefault(it, prop, defaultValue) {
	    const { gen, compositeRule, data, opts } = it;
	    if (defaultValue === undefined)
	        return;
	    const childData = (0, codegen_1._) `${data}${(0, codegen_1.getProperty)(prop)}`;
	    if (compositeRule) {
	        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
	        return;
	    }
	    let condition = (0, codegen_1._) `${childData} === undefined`;
	    if (opts.useDefaults === "empty") {
	        condition = (0, codegen_1._) `${condition} || ${childData} === null || ${childData} === ""`;
	    }
	    // `${childData} === undefined` +
	    // (opts.useDefaults === "empty" ? ` || ${childData} === null || ${childData} === ""` : "")
	    gen.if(condition, (0, codegen_1._) `${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
	}
	
	return defaults;
}

var keyword = {};

var code = {};

var hasRequiredCode;

function requireCode () {
	if (hasRequiredCode) return code;
	hasRequiredCode = 1;
	Object.defineProperty(code, "__esModule", { value: true });
	code.validateUnion = code.validateArray = code.usePattern = code.callValidateCode = code.schemaProperties = code.allSchemaProperties = code.noPropertyInData = code.propertyInData = code.isOwnProperty = code.hasPropFunc = code.reportMissingProp = code.checkMissingProp = code.checkReportMissingProp = void 0;
	const codegen_1 = requireCodegen();
	const util_1 = util;
	const names_1 = requireNames();
	const util_2 = util;
	function checkReportMissingProp(cxt, prop) {
	    const { gen, data, it } = cxt;
	    gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
	        cxt.setParams({ missingProperty: (0, codegen_1._) `${prop}` }, true);
	        cxt.error();
	    });
	}
	code.checkReportMissingProp = checkReportMissingProp;
	function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
	    return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._) `${missing} = ${prop}`)));
	}
	code.checkMissingProp = checkMissingProp;
	function reportMissingProp(cxt, missing) {
	    cxt.setParams({ missingProperty: missing }, true);
	    cxt.error();
	}
	code.reportMissingProp = reportMissingProp;
	function hasPropFunc(gen) {
	    return gen.scopeValue("func", {
	        // eslint-disable-next-line @typescript-eslint/unbound-method
	        ref: Object.prototype.hasOwnProperty,
	        code: (0, codegen_1._) `Object.prototype.hasOwnProperty`,
	    });
	}
	code.hasPropFunc = hasPropFunc;
	function isOwnProperty(gen, data, property) {
	    return (0, codegen_1._) `${hasPropFunc(gen)}.call(${data}, ${property})`;
	}
	code.isOwnProperty = isOwnProperty;
	function propertyInData(gen, data, property, ownProperties) {
	    const cond = (0, codegen_1._) `${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
	    return ownProperties ? (0, codegen_1._) `${cond} && ${isOwnProperty(gen, data, property)}` : cond;
	}
	code.propertyInData = propertyInData;
	function noPropertyInData(gen, data, property, ownProperties) {
	    const cond = (0, codegen_1._) `${data}${(0, codegen_1.getProperty)(property)} === undefined`;
	    return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
	}
	code.noPropertyInData = noPropertyInData;
	function allSchemaProperties(schemaMap) {
	    return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
	}
	code.allSchemaProperties = allSchemaProperties;
	function schemaProperties(it, schemaMap) {
	    return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
	}
	code.schemaProperties = schemaProperties;
	function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
	    const dataAndSchema = passSchema ? (0, codegen_1._) `${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
	    const valCxt = [
	        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
	        [names_1.default.parentData, it.parentData],
	        [names_1.default.parentDataProperty, it.parentDataProperty],
	        [names_1.default.rootData, names_1.default.rootData],
	    ];
	    if (it.opts.dynamicRef)
	        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
	    const args = (0, codegen_1._) `${dataAndSchema}, ${gen.object(...valCxt)}`;
	    return context !== codegen_1.nil ? (0, codegen_1._) `${func}.call(${context}, ${args})` : (0, codegen_1._) `${func}(${args})`;
	}
	code.callValidateCode = callValidateCode;
	const newRegExp = (0, codegen_1._) `new RegExp`;
	function usePattern({ gen, it: { opts } }, pattern) {
	    const u = opts.unicodeRegExp ? "u" : "";
	    const { regExp } = opts.code;
	    const rx = regExp(pattern, u);
	    return gen.scopeValue("pattern", {
	        key: rx.toString(),
	        ref: rx,
	        code: (0, codegen_1._) `${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`,
	    });
	}
	code.usePattern = usePattern;
	function validateArray(cxt) {
	    const { gen, data, keyword, it } = cxt;
	    const valid = gen.name("valid");
	    if (it.allErrors) {
	        const validArr = gen.let("valid", true);
	        validateItems(() => gen.assign(validArr, false));
	        return validArr;
	    }
	    gen.var(valid, true);
	    validateItems(() => gen.break());
	    return valid;
	    function validateItems(notValid) {
	        const len = gen.const("len", (0, codegen_1._) `${data}.length`);
	        gen.forRange("i", 0, len, (i) => {
	            cxt.subschema({
	                keyword,
	                dataProp: i,
	                dataPropType: util_1.Type.Num,
	            }, valid);
	            gen.if((0, codegen_1.not)(valid), notValid);
	        });
	    }
	}
	code.validateArray = validateArray;
	function validateUnion(cxt) {
	    const { gen, schema, keyword, it } = cxt;
	    /* istanbul ignore if */
	    if (!Array.isArray(schema))
	        throw new Error("ajv implementation error");
	    const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
	    if (alwaysValid && !it.opts.unevaluated)
	        return;
	    const valid = gen.let("valid", false);
	    const schValid = gen.name("_valid");
	    gen.block(() => schema.forEach((_sch, i) => {
	        const schCxt = cxt.subschema({
	            keyword,
	            schemaProp: i,
	            compositeRule: true,
	        }, schValid);
	        gen.assign(valid, (0, codegen_1._) `${valid} || ${schValid}`);
	        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
	        // can short-circuit if `unevaluatedProperties/Items` not supported (opts.unevaluated !== true)
	        // or if all properties and items were evaluated (it.props === true && it.items === true)
	        if (!merged)
	            gen.if((0, codegen_1.not)(valid));
	    }));
	    cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
	}
	code.validateUnion = validateUnion;
	
	return code;
}

var hasRequiredKeyword;

function requireKeyword () {
	if (hasRequiredKeyword) return keyword;
	hasRequiredKeyword = 1;
	Object.defineProperty(keyword, "__esModule", { value: true });
	keyword.validateKeywordUsage = keyword.validSchemaType = keyword.funcKeywordCode = keyword.macroKeywordCode = void 0;
	const codegen_1 = requireCodegen();
	const names_1 = requireNames();
	const code_1 = requireCode();
	const errors_1 = requireErrors();
	function macroKeywordCode(cxt, def) {
	    const { gen, keyword, schema, parentSchema, it } = cxt;
	    const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
	    const schemaRef = useKeyword(gen, keyword, macroSchema);
	    if (it.opts.validateSchema !== false)
	        it.self.validateSchema(macroSchema, true);
	    const valid = gen.name("valid");
	    cxt.subschema({
	        schema: macroSchema,
	        schemaPath: codegen_1.nil,
	        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
	        topSchemaRef: schemaRef,
	        compositeRule: true,
	    }, valid);
	    cxt.pass(valid, () => cxt.error(true));
	}
	keyword.macroKeywordCode = macroKeywordCode;
	function funcKeywordCode(cxt, def) {
	    var _a;
	    const { gen, keyword, schema, parentSchema, $data, it } = cxt;
	    checkAsyncKeyword(it, def);
	    const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
	    const validateRef = useKeyword(gen, keyword, validate);
	    const valid = gen.let("valid");
	    cxt.block$data(valid, validateKeyword);
	    cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
	    function validateKeyword() {
	        if (def.errors === false) {
	            assignValid();
	            if (def.modifying)
	                modifyData(cxt);
	            reportErrs(() => cxt.error());
	        }
	        else {
	            const ruleErrs = def.async ? validateAsync() : validateSync();
	            if (def.modifying)
	                modifyData(cxt);
	            reportErrs(() => addErrs(cxt, ruleErrs));
	        }
	    }
	    function validateAsync() {
	        const ruleErrs = gen.let("ruleErrs", null);
	        gen.try(() => assignValid((0, codegen_1._) `await `), (e) => gen.assign(valid, false).if((0, codegen_1._) `${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._) `${e}.errors`), () => gen.throw(e)));
	        return ruleErrs;
	    }
	    function validateSync() {
	        const validateErrs = (0, codegen_1._) `${validateRef}.errors`;
	        gen.assign(validateErrs, null);
	        assignValid(codegen_1.nil);
	        return validateErrs;
	    }
	    function assignValid(_await = def.async ? (0, codegen_1._) `await ` : codegen_1.nil) {
	        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
	        const passSchema = !(("compile" in def && !$data) || def.schema === false);
	        gen.assign(valid, (0, codegen_1._) `${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
	    }
	    function reportErrs(errors) {
	        var _a;
	        gen.if((0, codegen_1.not)((_a = def.valid) !== null && _a !== void 0 ? _a : valid), errors);
	    }
	}
	keyword.funcKeywordCode = funcKeywordCode;
	function modifyData(cxt) {
	    const { gen, data, it } = cxt;
	    gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._) `${it.parentData}[${it.parentDataProperty}]`));
	}
	function addErrs(cxt, errs) {
	    const { gen } = cxt;
	    gen.if((0, codegen_1._) `Array.isArray(${errs})`, () => {
	        gen
	            .assign(names_1.default.vErrors, (0, codegen_1._) `${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`)
	            .assign(names_1.default.errors, (0, codegen_1._) `${names_1.default.vErrors}.length`);
	        (0, errors_1.extendErrors)(cxt);
	    }, () => cxt.error());
	}
	function checkAsyncKeyword({ schemaEnv }, def) {
	    if (def.async && !schemaEnv.$async)
	        throw new Error("async keyword in sync schema");
	}
	function useKeyword(gen, keyword, result) {
	    if (result === undefined)
	        throw new Error(`keyword "${keyword}" failed to compile`);
	    return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
	}
	function validSchemaType(schema, schemaType, allowUndefined = false) {
	    // TODO add tests
	    return (!schemaType.length ||
	        schemaType.some((st) => st === "array"
	            ? Array.isArray(schema)
	            : st === "object"
	                ? schema && typeof schema == "object" && !Array.isArray(schema)
	                : typeof schema == st || (allowUndefined && typeof schema == "undefined")));
	}
	keyword.validSchemaType = validSchemaType;
	function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
	    /* istanbul ignore if */
	    if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
	        throw new Error("ajv implementation error");
	    }
	    const deps = def.dependencies;
	    if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
	        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
	    }
	    if (def.validateSchema) {
	        const valid = def.validateSchema(schema[keyword]);
	        if (!valid) {
	            const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` +
	                self.errorsText(def.validateSchema.errors);
	            if (opts.validateSchema === "log")
	                self.logger.error(msg);
	            else
	                throw new Error(msg);
	        }
	    }
	}
	keyword.validateKeywordUsage = validateKeywordUsage;
	
	return keyword;
}

var subschema = {};

var hasRequiredSubschema;

function requireSubschema () {
	if (hasRequiredSubschema) return subschema;
	hasRequiredSubschema = 1;
	Object.defineProperty(subschema, "__esModule", { value: true });
	subschema.extendSubschemaMode = subschema.extendSubschemaData = subschema.getSubschema = void 0;
	const codegen_1 = requireCodegen();
	const util_1 = util;
	function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
	    if (keyword !== undefined && schema !== undefined) {
	        throw new Error('both "keyword" and "schema" passed, only one allowed');
	    }
	    if (keyword !== undefined) {
	        const sch = it.schema[keyword];
	        return schemaProp === undefined
	            ? {
	                schema: sch,
	                schemaPath: (0, codegen_1._) `${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
	                errSchemaPath: `${it.errSchemaPath}/${keyword}`,
	            }
	            : {
	                schema: sch[schemaProp],
	                schemaPath: (0, codegen_1._) `${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
	                errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`,
	            };
	    }
	    if (schema !== undefined) {
	        if (schemaPath === undefined || errSchemaPath === undefined || topSchemaRef === undefined) {
	            throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
	        }
	        return {
	            schema,
	            schemaPath,
	            topSchemaRef,
	            errSchemaPath,
	        };
	    }
	    throw new Error('either "keyword" or "schema" must be passed');
	}
	subschema.getSubschema = getSubschema;
	function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
	    if (data !== undefined && dataProp !== undefined) {
	        throw new Error('both "data" and "dataProp" passed, only one allowed');
	    }
	    const { gen } = it;
	    if (dataProp !== undefined) {
	        const { errorPath, dataPathArr, opts } = it;
	        const nextData = gen.let("data", (0, codegen_1._) `${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
	        dataContextProps(nextData);
	        subschema.errorPath = (0, codegen_1.str) `${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
	        subschema.parentDataProperty = (0, codegen_1._) `${dataProp}`;
	        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
	    }
	    if (data !== undefined) {
	        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true); // replaceable if used once?
	        dataContextProps(nextData);
	        if (propertyName !== undefined)
	            subschema.propertyName = propertyName;
	        // TODO something is possibly wrong here with not changing parentDataProperty and not appending dataPathArr
	    }
	    if (dataTypes)
	        subschema.dataTypes = dataTypes;
	    function dataContextProps(_nextData) {
	        subschema.data = _nextData;
	        subschema.dataLevel = it.dataLevel + 1;
	        subschema.dataTypes = [];
	        it.definedProperties = new Set();
	        subschema.parentData = it.data;
	        subschema.dataNames = [...it.dataNames, _nextData];
	    }
	}
	subschema.extendSubschemaData = extendSubschemaData;
	function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
	    if (compositeRule !== undefined)
	        subschema.compositeRule = compositeRule;
	    if (createErrors !== undefined)
	        subschema.createErrors = createErrors;
	    if (allErrors !== undefined)
	        subschema.allErrors = allErrors;
	    subschema.jtdDiscriminator = jtdDiscriminator; // not inherited
	    subschema.jtdMetadata = jtdMetadata; // not inherited
	}
	subschema.extendSubschemaMode = extendSubschemaMode;
	
	return subschema;
}

var resolve$2 = {};

// do not edit .js files directly - edit src/index.jst



var fastDeepEqual = function equal(a, b) {
  if (a === b) return true;

  if (a && b && typeof a == 'object' && typeof b == 'object') {
    if (a.constructor !== b.constructor) return false;

    var length, i, keys;
    if (Array.isArray(a)) {
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0;)
        if (!equal(a[i], b[i])) return false;
      return true;
    }



    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();

    keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;

    for (i = length; i-- !== 0;)
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;

    for (i = length; i-- !== 0;) {
      var key = keys[i];

      if (!equal(a[key], b[key])) return false;
    }

    return true;
  }

  // true if both NaN, false otherwise
  return a!==a && b!==b;
};

var jsonSchemaTraverse = {exports: {}};

var traverse$1 = jsonSchemaTraverse.exports = function (schema, opts, cb) {
  // Legacy support for v0.3.1 and earlier.
  if (typeof opts == 'function') {
    cb = opts;
    opts = {};
  }

  cb = opts.cb || cb;
  var pre = (typeof cb == 'function') ? cb : cb.pre || function() {};
  var post = cb.post || function() {};

  _traverse(opts, pre, post, schema, '', schema);
};


traverse$1.keywords = {
  additionalItems: true,
  items: true,
  contains: true,
  additionalProperties: true,
  propertyNames: true,
  not: true,
  if: true,
  then: true,
  else: true
};

traverse$1.arrayKeywords = {
  items: true,
  allOf: true,
  anyOf: true,
  oneOf: true
};

traverse$1.propsKeywords = {
  $defs: true,
  definitions: true,
  properties: true,
  patternProperties: true,
  dependencies: true
};

traverse$1.skipKeywords = {
  default: true,
  enum: true,
  const: true,
  required: true,
  maximum: true,
  minimum: true,
  exclusiveMaximum: true,
  exclusiveMinimum: true,
  multipleOf: true,
  maxLength: true,
  minLength: true,
  pattern: true,
  format: true,
  maxItems: true,
  minItems: true,
  uniqueItems: true,
  maxProperties: true,
  minProperties: true
};


function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
  if (schema && typeof schema == 'object' && !Array.isArray(schema)) {
    pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
    for (var key in schema) {
      var sch = schema[key];
      if (Array.isArray(sch)) {
        if (key in traverse$1.arrayKeywords) {
          for (var i=0; i<sch.length; i++)
            _traverse(opts, pre, post, sch[i], jsonPtr + '/' + key + '/' + i, rootSchema, jsonPtr, key, schema, i);
        }
      } else if (key in traverse$1.propsKeywords) {
        if (sch && typeof sch == 'object') {
          for (var prop in sch)
            _traverse(opts, pre, post, sch[prop], jsonPtr + '/' + key + '/' + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
        }
      } else if (key in traverse$1.keywords || (opts.allKeys && !(key in traverse$1.skipKeywords))) {
        _traverse(opts, pre, post, sch, jsonPtr + '/' + key, rootSchema, jsonPtr, key, schema);
      }
    }
    post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
  }
}


function escapeJsonPtr(str) {
  return str.replace(/~/g, '~0').replace(/\//g, '~1');
}

var jsonSchemaTraverseExports = jsonSchemaTraverse.exports;

Object.defineProperty(resolve$2, "__esModule", { value: true });
resolve$2.getSchemaRefs = resolve$2.resolveUrl = resolve$2.normalizeId = resolve$2._getFullPath = resolve$2.getFullPath = resolve$2.inlineRef = void 0;
const util_1$l = util;
const equal$3 = fastDeepEqual;
const traverse = jsonSchemaTraverseExports;
// TODO refactor to use keyword definitions
const SIMPLE_INLINED = new Set([
    "type",
    "format",
    "pattern",
    "maxLength",
    "minLength",
    "maxProperties",
    "minProperties",
    "maxItems",
    "minItems",
    "maximum",
    "minimum",
    "uniqueItems",
    "multipleOf",
    "required",
    "enum",
    "const",
]);
function inlineRef(schema, limit = true) {
    if (typeof schema == "boolean")
        return true;
    if (limit === true)
        return !hasRef(schema);
    if (!limit)
        return false;
    return countKeys(schema) <= limit;
}
resolve$2.inlineRef = inlineRef;
const REF_KEYWORDS = new Set([
    "$ref",
    "$recursiveRef",
    "$recursiveAnchor",
    "$dynamicRef",
    "$dynamicAnchor",
]);
function hasRef(schema) {
    for (const key in schema) {
        if (REF_KEYWORDS.has(key))
            return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
            return true;
        if (typeof sch == "object" && hasRef(sch))
            return true;
    }
    return false;
}
function countKeys(schema) {
    let count = 0;
    for (const key in schema) {
        if (key === "$ref")
            return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
            continue;
        if (typeof schema[key] == "object") {
            (0, util_1$l.eachItem)(schema[key], (sch) => (count += countKeys(sch)));
        }
        if (count === Infinity)
            return Infinity;
    }
    return count;
}
function getFullPath(resolver, id = "", normalize) {
    if (normalize !== false)
        id = normalizeId(id);
    const p = resolver.parse(id);
    return _getFullPath(resolver, p);
}
resolve$2.getFullPath = getFullPath;
function _getFullPath(resolver, p) {
    const serialized = resolver.serialize(p);
    return serialized.split("#")[0] + "#";
}
resolve$2._getFullPath = _getFullPath;
const TRAILING_SLASH_HASH = /#\/?$/;
function normalizeId(id) {
    return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
}
resolve$2.normalizeId = normalizeId;
function resolveUrl(resolver, baseId, id) {
    id = normalizeId(id);
    return resolver.resolve(baseId, id);
}
resolve$2.resolveUrl = resolveUrl;
const ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
function getSchemaRefs(schema, baseId) {
    if (typeof schema == "boolean")
        return {};
    const { schemaId, uriResolver } = this.opts;
    const schId = normalizeId(schema[schemaId] || baseId);
    const baseIds = { "": schId };
    const pathPrefix = getFullPath(uriResolver, schId, false);
    const localRefs = {};
    const schemaRefs = new Set();
    traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === undefined)
            return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
            innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
            // eslint-disable-next-line @typescript-eslint/unbound-method
            const _resolve = this.opts.uriResolver.resolve;
            ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
            if (schemaRefs.has(ref))
                throw ambiguos(ref);
            schemaRefs.add(ref);
            let schOrRef = this.refs[ref];
            if (typeof schOrRef == "string")
                schOrRef = this.refs[schOrRef];
            if (typeof schOrRef == "object") {
                checkAmbiguosRef(sch, schOrRef.schema, ref);
            }
            else if (ref !== normalizeId(fullPath)) {
                if (ref[0] === "#") {
                    checkAmbiguosRef(sch, localRefs[ref], ref);
                    localRefs[ref] = sch;
                }
                else {
                    this.refs[ref] = fullPath;
                }
            }
            return ref;
        }
        function addAnchor(anchor) {
            if (typeof anchor == "string") {
                if (!ANCHOR.test(anchor))
                    throw new Error(`invalid anchor "${anchor}"`);
                addRef.call(this, `#${anchor}`);
            }
        }
    });
    return localRefs;
    function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== undefined && !equal$3(sch1, sch2))
            throw ambiguos(ref);
    }
    function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
    }
}
resolve$2.getSchemaRefs = getSchemaRefs;

var hasRequiredValidate;

function requireValidate () {
	if (hasRequiredValidate) return validate;
	hasRequiredValidate = 1;
	Object.defineProperty(validate, "__esModule", { value: true });
	validate.getData = validate.KeywordCxt = validate.validateFunctionCode = void 0;
	const boolSchema_1 = requireBoolSchema();
	const dataType_1 = dataType;
	const applicability_1 = requireApplicability();
	const dataType_2 = dataType;
	const defaults_1 = requireDefaults();
	const keyword_1 = requireKeyword();
	const subschema_1 = requireSubschema();
	const codegen_1 = requireCodegen();
	const names_1 = requireNames();
	const resolve_1 = resolve$2;
	const util_1 = util;
	const errors_1 = requireErrors();
	// schema compilation - generates validation function, subschemaCode (below) is used for subschemas
	function validateFunctionCode(it) {
	    if (isSchemaObj(it)) {
	        checkKeywords(it);
	        if (schemaCxtHasRules(it)) {
	            topSchemaObjCode(it);
	            return;
	        }
	    }
	    validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
	}
	validate.validateFunctionCode = validateFunctionCode;
	function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
	    if (opts.code.es5) {
	        gen.func(validateName, (0, codegen_1._) `${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
	            gen.code((0, codegen_1._) `"use strict"; ${funcSourceUrl(schema, opts)}`);
	            destructureValCxtES5(gen, opts);
	            gen.code(body);
	        });
	    }
	    else {
	        gen.func(validateName, (0, codegen_1._) `${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
	    }
	}
	function destructureValCxt(opts) {
	    return (0, codegen_1._) `{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._) `, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
	}
	function destructureValCxtES5(gen, opts) {
	    gen.if(names_1.default.valCxt, () => {
	        gen.var(names_1.default.instancePath, (0, codegen_1._) `${names_1.default.valCxt}.${names_1.default.instancePath}`);
	        gen.var(names_1.default.parentData, (0, codegen_1._) `${names_1.default.valCxt}.${names_1.default.parentData}`);
	        gen.var(names_1.default.parentDataProperty, (0, codegen_1._) `${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
	        gen.var(names_1.default.rootData, (0, codegen_1._) `${names_1.default.valCxt}.${names_1.default.rootData}`);
	        if (opts.dynamicRef)
	            gen.var(names_1.default.dynamicAnchors, (0, codegen_1._) `${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
	    }, () => {
	        gen.var(names_1.default.instancePath, (0, codegen_1._) `""`);
	        gen.var(names_1.default.parentData, (0, codegen_1._) `undefined`);
	        gen.var(names_1.default.parentDataProperty, (0, codegen_1._) `undefined`);
	        gen.var(names_1.default.rootData, names_1.default.data);
	        if (opts.dynamicRef)
	            gen.var(names_1.default.dynamicAnchors, (0, codegen_1._) `{}`);
	    });
	}
	function topSchemaObjCode(it) {
	    const { schema, opts, gen } = it;
	    validateFunction(it, () => {
	        if (opts.$comment && schema.$comment)
	            commentKeyword(it);
	        checkNoDefault(it);
	        gen.let(names_1.default.vErrors, null);
	        gen.let(names_1.default.errors, 0);
	        if (opts.unevaluated)
	            resetEvaluated(it);
	        typeAndKeywords(it);
	        returnResults(it);
	    });
	    return;
	}
	function resetEvaluated(it) {
	    // TODO maybe some hook to execute it in the end to check whether props/items are Name, as in assignEvaluated
	    const { gen, validateName } = it;
	    it.evaluated = gen.const("evaluated", (0, codegen_1._) `${validateName}.evaluated`);
	    gen.if((0, codegen_1._) `${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._) `${it.evaluated}.props`, (0, codegen_1._) `undefined`));
	    gen.if((0, codegen_1._) `${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._) `${it.evaluated}.items`, (0, codegen_1._) `undefined`));
	}
	function funcSourceUrl(schema, opts) {
	    const schId = typeof schema == "object" && schema[opts.schemaId];
	    return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._) `/*# sourceURL=${schId} */` : codegen_1.nil;
	}
	// schema compilation - this function is used recursively to generate code for sub-schemas
	function subschemaCode(it, valid) {
	    if (isSchemaObj(it)) {
	        checkKeywords(it);
	        if (schemaCxtHasRules(it)) {
	            subSchemaObjCode(it, valid);
	            return;
	        }
	    }
	    (0, boolSchema_1.boolOrEmptySchema)(it, valid);
	}
	function schemaCxtHasRules({ schema, self }) {
	    if (typeof schema == "boolean")
	        return !schema;
	    for (const key in schema)
	        if (self.RULES.all[key])
	            return true;
	    return false;
	}
	function isSchemaObj(it) {
	    return typeof it.schema != "boolean";
	}
	function subSchemaObjCode(it, valid) {
	    const { schema, gen, opts } = it;
	    if (opts.$comment && schema.$comment)
	        commentKeyword(it);
	    updateContext(it);
	    checkAsyncSchema(it);
	    const errsCount = gen.const("_errs", names_1.default.errors);
	    typeAndKeywords(it, errsCount);
	    // TODO var
	    gen.var(valid, (0, codegen_1._) `${errsCount} === ${names_1.default.errors}`);
	}
	function checkKeywords(it) {
	    (0, util_1.checkUnknownRules)(it);
	    checkRefsAndKeywords(it);
	}
	function typeAndKeywords(it, errsCount) {
	    if (it.opts.jtd)
	        return schemaKeywords(it, [], false, errsCount);
	    const types = (0, dataType_1.getSchemaTypes)(it.schema);
	    const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
	    schemaKeywords(it, types, !checkedTypes, errsCount);
	}
	function checkRefsAndKeywords(it) {
	    const { schema, errSchemaPath, opts, self } = it;
	    if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
	        self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
	    }
	}
	function checkNoDefault(it) {
	    const { schema, opts } = it;
	    if (schema.default !== undefined && opts.useDefaults && opts.strictSchema) {
	        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
	    }
	}
	function updateContext(it) {
	    const schId = it.schema[it.opts.schemaId];
	    if (schId)
	        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
	}
	function checkAsyncSchema(it) {
	    if (it.schema.$async && !it.schemaEnv.$async)
	        throw new Error("async schema in sync schema");
	}
	function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
	    const msg = schema.$comment;
	    if (opts.$comment === true) {
	        gen.code((0, codegen_1._) `${names_1.default.self}.logger.log(${msg})`);
	    }
	    else if (typeof opts.$comment == "function") {
	        const schemaPath = (0, codegen_1.str) `${errSchemaPath}/$comment`;
	        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
	        gen.code((0, codegen_1._) `${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
	    }
	}
	function returnResults(it) {
	    const { gen, schemaEnv, validateName, ValidationError, opts } = it;
	    if (schemaEnv.$async) {
	        // TODO assign unevaluated
	        gen.if((0, codegen_1._) `${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._) `new ${ValidationError}(${names_1.default.vErrors})`));
	    }
	    else {
	        gen.assign((0, codegen_1._) `${validateName}.errors`, names_1.default.vErrors);
	        if (opts.unevaluated)
	            assignEvaluated(it);
	        gen.return((0, codegen_1._) `${names_1.default.errors} === 0`);
	    }
	}
	function assignEvaluated({ gen, evaluated, props, items }) {
	    if (props instanceof codegen_1.Name)
	        gen.assign((0, codegen_1._) `${evaluated}.props`, props);
	    if (items instanceof codegen_1.Name)
	        gen.assign((0, codegen_1._) `${evaluated}.items`, items);
	}
	function schemaKeywords(it, types, typeErrors, errsCount) {
	    const { gen, schema, data, allErrors, opts, self } = it;
	    const { RULES } = self;
	    if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
	        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition)); // TODO typecast
	        return;
	    }
	    if (!opts.jtd)
	        checkStrictTypes(it, types);
	    gen.block(() => {
	        for (const group of RULES.rules)
	            groupKeywords(group);
	        groupKeywords(RULES.post);
	    });
	    function groupKeywords(group) {
	        if (!(0, applicability_1.shouldUseGroup)(schema, group))
	            return;
	        if (group.type) {
	            gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
	            iterateKeywords(it, group);
	            if (types.length === 1 && types[0] === group.type && typeErrors) {
	                gen.else();
	                (0, dataType_2.reportTypeError)(it);
	            }
	            gen.endIf();
	        }
	        else {
	            iterateKeywords(it, group);
	        }
	        // TODO make it "ok" call?
	        if (!allErrors)
	            gen.if((0, codegen_1._) `${names_1.default.errors} === ${errsCount || 0}`);
	    }
	}
	function iterateKeywords(it, group) {
	    const { gen, schema, opts: { useDefaults }, } = it;
	    if (useDefaults)
	        (0, defaults_1.assignDefaults)(it, group.type);
	    gen.block(() => {
	        for (const rule of group.rules) {
	            if ((0, applicability_1.shouldUseRule)(schema, rule)) {
	                keywordCode(it, rule.keyword, rule.definition, group.type);
	            }
	        }
	    });
	}
	function checkStrictTypes(it, types) {
	    if (it.schemaEnv.meta || !it.opts.strictTypes)
	        return;
	    checkContextTypes(it, types);
	    if (!it.opts.allowUnionTypes)
	        checkMultipleTypes(it, types);
	    checkKeywordTypes(it, it.dataTypes);
	}
	function checkContextTypes(it, types) {
	    if (!types.length)
	        return;
	    if (!it.dataTypes.length) {
	        it.dataTypes = types;
	        return;
	    }
	    types.forEach((t) => {
	        if (!includesType(it.dataTypes, t)) {
	            strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
	        }
	    });
	    narrowSchemaTypes(it, types);
	}
	function checkMultipleTypes(it, ts) {
	    if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
	        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
	    }
	}
	function checkKeywordTypes(it, ts) {
	    const rules = it.self.RULES.all;
	    for (const keyword in rules) {
	        const rule = rules[keyword];
	        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
	            const { type } = rule.definition;
	            if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
	                strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
	            }
	        }
	    }
	}
	function hasApplicableType(schTs, kwdT) {
	    return schTs.includes(kwdT) || (kwdT === "number" && schTs.includes("integer"));
	}
	function includesType(ts, t) {
	    return ts.includes(t) || (t === "integer" && ts.includes("number"));
	}
	function narrowSchemaTypes(it, withTypes) {
	    const ts = [];
	    for (const t of it.dataTypes) {
	        if (includesType(withTypes, t))
	            ts.push(t);
	        else if (withTypes.includes("integer") && t === "number")
	            ts.push("integer");
	    }
	    it.dataTypes = ts;
	}
	function strictTypesError(it, msg) {
	    const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
	    msg += ` at "${schemaPath}" (strictTypes)`;
	    (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
	}
	class KeywordCxt {
	    constructor(it, def, keyword) {
	        (0, keyword_1.validateKeywordUsage)(it, def, keyword);
	        this.gen = it.gen;
	        this.allErrors = it.allErrors;
	        this.keyword = keyword;
	        this.data = it.data;
	        this.schema = it.schema[keyword];
	        this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
	        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
	        this.schemaType = def.schemaType;
	        this.parentSchema = it.schema;
	        this.params = {};
	        this.it = it;
	        this.def = def;
	        if (this.$data) {
	            this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
	        }
	        else {
	            this.schemaCode = this.schemaValue;
	            if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
	                throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
	            }
	        }
	        if ("code" in def ? def.trackErrors : def.errors !== false) {
	            this.errsCount = it.gen.const("_errs", names_1.default.errors);
	        }
	    }
	    result(condition, successAction, failAction) {
	        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
	    }
	    failResult(condition, successAction, failAction) {
	        this.gen.if(condition);
	        if (failAction)
	            failAction();
	        else
	            this.error();
	        if (successAction) {
	            this.gen.else();
	            successAction();
	            if (this.allErrors)
	                this.gen.endIf();
	        }
	        else {
	            if (this.allErrors)
	                this.gen.endIf();
	            else
	                this.gen.else();
	        }
	    }
	    pass(condition, failAction) {
	        this.failResult((0, codegen_1.not)(condition), undefined, failAction);
	    }
	    fail(condition) {
	        if (condition === undefined) {
	            this.error();
	            if (!this.allErrors)
	                this.gen.if(false); // this branch will be removed by gen.optimize
	            return;
	        }
	        this.gen.if(condition);
	        this.error();
	        if (this.allErrors)
	            this.gen.endIf();
	        else
	            this.gen.else();
	    }
	    fail$data(condition) {
	        if (!this.$data)
	            return this.fail(condition);
	        const { schemaCode } = this;
	        this.fail((0, codegen_1._) `${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
	    }
	    error(append, errorParams, errorPaths) {
	        if (errorParams) {
	            this.setParams(errorParams);
	            this._error(append, errorPaths);
	            this.setParams({});
	            return;
	        }
	        this._error(append, errorPaths);
	    }
	    _error(append, errorPaths) {
	        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
	    }
	    $dataError() {
	        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
	    }
	    reset() {
	        if (this.errsCount === undefined)
	            throw new Error('add "trackErrors" to keyword definition');
	        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
	    }
	    ok(cond) {
	        if (!this.allErrors)
	            this.gen.if(cond);
	    }
	    setParams(obj, assign) {
	        if (assign)
	            Object.assign(this.params, obj);
	        else
	            this.params = obj;
	    }
	    block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
	        this.gen.block(() => {
	            this.check$data(valid, $dataValid);
	            codeBlock();
	        });
	    }
	    check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
	        if (!this.$data)
	            return;
	        const { gen, schemaCode, schemaType, def } = this;
	        gen.if((0, codegen_1.or)((0, codegen_1._) `${schemaCode} === undefined`, $dataValid));
	        if (valid !== codegen_1.nil)
	            gen.assign(valid, true);
	        if (schemaType.length || def.validateSchema) {
	            gen.elseIf(this.invalid$data());
	            this.$dataError();
	            if (valid !== codegen_1.nil)
	                gen.assign(valid, false);
	        }
	        gen.else();
	    }
	    invalid$data() {
	        const { gen, schemaCode, schemaType, def, it } = this;
	        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
	        function wrong$DataType() {
	            if (schemaType.length) {
	                /* istanbul ignore if */
	                if (!(schemaCode instanceof codegen_1.Name))
	                    throw new Error("ajv implementation error");
	                const st = Array.isArray(schemaType) ? schemaType : [schemaType];
	                return (0, codegen_1._) `${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
	            }
	            return codegen_1.nil;
	        }
	        function invalid$DataSchema() {
	            if (def.validateSchema) {
	                const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema }); // TODO value.code for standalone
	                return (0, codegen_1._) `!${validateSchemaRef}(${schemaCode})`;
	            }
	            return codegen_1.nil;
	        }
	    }
	    subschema(appl, valid) {
	        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
	        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
	        (0, subschema_1.extendSubschemaMode)(subschema, appl);
	        const nextContext = { ...this.it, ...subschema, items: undefined, props: undefined };
	        subschemaCode(nextContext, valid);
	        return nextContext;
	    }
	    mergeEvaluated(schemaCxt, toName) {
	        const { it, gen } = this;
	        if (!it.opts.unevaluated)
	            return;
	        if (it.props !== true && schemaCxt.props !== undefined) {
	            it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
	        }
	        if (it.items !== true && schemaCxt.items !== undefined) {
	            it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
	        }
	    }
	    mergeValidEvaluated(schemaCxt, valid) {
	        const { it, gen } = this;
	        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
	            gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
	            return true;
	        }
	    }
	}
	validate.KeywordCxt = KeywordCxt;
	function keywordCode(it, keyword, def, ruleType) {
	    const cxt = new KeywordCxt(it, def, keyword);
	    if ("code" in def) {
	        def.code(cxt, ruleType);
	    }
	    else if (cxt.$data && def.validate) {
	        (0, keyword_1.funcKeywordCode)(cxt, def);
	    }
	    else if ("macro" in def) {
	        (0, keyword_1.macroKeywordCode)(cxt, def);
	    }
	    else if (def.compile || def.validate) {
	        (0, keyword_1.funcKeywordCode)(cxt, def);
	    }
	}
	const JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
	const RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
	function getData($data, { dataLevel, dataNames, dataPathArr }) {
	    let jsonPointer;
	    let data;
	    if ($data === "")
	        return names_1.default.rootData;
	    if ($data[0] === "/") {
	        if (!JSON_POINTER.test($data))
	            throw new Error(`Invalid JSON-pointer: ${$data}`);
	        jsonPointer = $data;
	        data = names_1.default.rootData;
	    }
	    else {
	        const matches = RELATIVE_JSON_POINTER.exec($data);
	        if (!matches)
	            throw new Error(`Invalid JSON-pointer: ${$data}`);
	        const up = +matches[1];
	        jsonPointer = matches[2];
	        if (jsonPointer === "#") {
	            if (up >= dataLevel)
	                throw new Error(errorMsg("property/index", up));
	            return dataPathArr[dataLevel - up];
	        }
	        if (up > dataLevel)
	            throw new Error(errorMsg("data", up));
	        data = dataNames[dataLevel - up];
	        if (!jsonPointer)
	            return data;
	    }
	    let expr = data;
	    const segments = jsonPointer.split("/");
	    for (const segment of segments) {
	        if (segment) {
	            data = (0, codegen_1._) `${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
	            expr = (0, codegen_1._) `${expr} && ${data}`;
	        }
	    }
	    return expr;
	    function errorMsg(pointerType, up) {
	        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
	    }
	}
	validate.getData = getData;
	
	return validate;
}

var validation_error = {};

var hasRequiredValidation_error;

function requireValidation_error () {
	if (hasRequiredValidation_error) return validation_error;
	hasRequiredValidation_error = 1;
	Object.defineProperty(validation_error, "__esModule", { value: true });
	class ValidationError extends Error {
	    constructor(errors) {
	        super("validation failed");
	        this.errors = errors;
	        this.ajv = this.validation = true;
	    }
	}
	validation_error.default = ValidationError;
	
	return validation_error;
}

var ref_error = {};

var hasRequiredRef_error;

function requireRef_error () {
	if (hasRequiredRef_error) return ref_error;
	hasRequiredRef_error = 1;
	Object.defineProperty(ref_error, "__esModule", { value: true });
	const resolve_1 = resolve$2;
	class MissingRefError extends Error {
	    constructor(resolver, baseId, ref, msg) {
	        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
	        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
	        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
	    }
	}
	ref_error.default = MissingRefError;
	
	return ref_error;
}

var compile = {};

Object.defineProperty(compile, "__esModule", { value: true });
compile.resolveSchema = compile.getCompilingSchema = compile.resolveRef = compile.compileSchema = compile.SchemaEnv = void 0;
const codegen_1$m = requireCodegen();
const validation_error_1 = requireValidation_error();
const names_1$2 = requireNames();
const resolve_1 = resolve$2;
const util_1$k = util;
const validate_1$1 = requireValidate();
class SchemaEnv {
    constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
            schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
    }
}
compile.SchemaEnv = SchemaEnv;
// let codeSize = 0
// let nodeCount = 0
// Compiles schema in SchemaEnv
function compileSchema(sch) {
    // TODO refactor - remove compilations
    const _sch = getCompilingSchema.call(this, sch);
    if (_sch)
        return _sch;
    const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId); // TODO if getFullPath removed 1 tests fails
    const { es5, lines } = this.opts.code;
    const { ownProperties } = this.opts;
    const gen = new codegen_1$m.CodeGen(this.scope, { es5, lines, ownProperties });
    let _ValidationError;
    if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
            ref: validation_error_1.default,
            code: (0, codegen_1$m._) `require("ajv/dist/runtime/validation_error").default`,
        });
    }
    const validateName = gen.scopeName("validate");
    sch.validateName = validateName;
    const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1$2.default.data,
        parentData: names_1$2.default.parentData,
        parentDataProperty: names_1$2.default.parentDataProperty,
        dataNames: [names_1$2.default.data],
        dataPathArr: [codegen_1$m.nil], // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true
            ? { ref: sch.schema, code: (0, codegen_1$m.stringify)(sch.schema) }
            : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1$m.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1$m._) `""`,
        opts: this.opts,
        self: this,
    };
    let sourceCode;
    try {
        this._compilations.add(sch);
        (0, validate_1$1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        // gen.optimize(1)
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1$2.default.scope)}return ${validateCode}`;
        // console.log((codeSize += sourceCode.length), (nodeCount += gen.nodeCount))
        if (this.opts.code.process)
            sourceCode = this.opts.code.process(sourceCode, sch);
        // console.log("\n\n\n *** \n", sourceCode)
        const makeValidate = new Function(`${names_1$2.default.self}`, `${names_1$2.default.scope}`, sourceCode);
        const validate = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate });
        validate.errors = null;
        validate.schema = sch.schema;
        validate.schemaEnv = sch;
        if (sch.$async)
            validate.$async = true;
        if (this.opts.code.source === true) {
            validate.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
            const { props, items } = schemaCxt;
            validate.evaluated = {
                props: props instanceof codegen_1$m.Name ? undefined : props,
                items: items instanceof codegen_1$m.Name ? undefined : items,
                dynamicProps: props instanceof codegen_1$m.Name,
                dynamicItems: items instanceof codegen_1$m.Name,
            };
            if (validate.source)
                validate.source.evaluated = (0, codegen_1$m.stringify)(validate.evaluated);
        }
        sch.validate = validate;
        return sch;
    }
    catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
            this.logger.error("Error compiling schema, function code:", sourceCode);
        // console.log("\n\n\n *** \n", sourceCode, this.opts)
        throw e;
    }
    finally {
        this._compilations.delete(sch);
    }
}
compile.compileSchema = compileSchema;
function resolveRef(root, baseId, ref) {
    var _a;
    ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
    const schOrFunc = root.refs[ref];
    if (schOrFunc)
        return schOrFunc;
    let _sch = resolve$1.call(this, root, ref);
    if (_sch === undefined) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref]; // TODO maybe localRefs should hold SchemaEnv
        const { schemaId } = this.opts;
        if (schema)
            _sch = new SchemaEnv({ schema, schemaId, root, baseId });
    }
    if (_sch === undefined)
        return;
    return (root.refs[ref] = inlineOrCompile.call(this, _sch));
}
compile.resolveRef = resolveRef;
function inlineOrCompile(sch) {
    if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
    return sch.validate ? sch : compileSchema.call(this, sch);
}
// Index of schema compilation in the currently compiled list
function getCompilingSchema(schEnv) {
    for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
            return sch;
    }
}
compile.getCompilingSchema = getCompilingSchema;
function sameSchemaEnv(s1, s2) {
    return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
}
// resolve and compile the references ($ref)
// TODO returns AnySchemaObject (if the schema can be inlined) or validation function
function resolve$1(root, // information about the root schema for the current schema
ref // reference to resolve
) {
    let sch;
    while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
    return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
}
// Resolve schema, its root and baseId
function resolveSchema(root, // root object with properties schema, refs TODO below SchemaEnv is assigned to it
ref // reference to resolve
) {
    const p = this.opts.uriResolver.parse(ref);
    const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
    let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, undefined);
    // TODO `Object.keys(root.schema).length > 0` should not be needed - but removing breaks 2 tests
    if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
    }
    const id = (0, resolve_1.normalizeId)(refPath);
    const schOrRef = this.refs[id] || this.schemas[id];
    if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
            return;
        return getJsonPointer.call(this, p, sch);
    }
    if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
    if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
    if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
            baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
    }
    return getJsonPointer.call(this, p, schOrRef);
}
compile.resolveSchema = resolveSchema;
const PREVENT_SCOPE_CHANGE = new Set([
    "properties",
    "patternProperties",
    "enum",
    "dependencies",
    "definitions",
]);
function getJsonPointer(parsedRef, { baseId, schema, root }) {
    var _a;
    if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
    for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
            return;
        const partSchema = schema[(0, util_1$k.unescapeFragment)(part)];
        if (partSchema === undefined)
            return;
        schema = partSchema;
        // TODO PREVENT_SCOPE_CHANGE could be defined in keyword def?
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
            baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
    }
    let env;
    if (typeof schema != "boolean" && schema.$ref && !(0, util_1$k.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
    }
    // even though resolution failed we need to return SchemaEnv to throw exception
    // so that compileAsync loads missing schema.
    const { schemaId } = this.opts;
    env = env || new SchemaEnv({ schema, schemaId, root, baseId });
    if (env.schema !== env.root.schema)
        return env;
    return undefined;
}

var $id$1 = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#";
var description = "Meta-schema for $data reference (JSON AnySchema extension proposal)";
var type$1 = "object";
var required$1 = [
	"$data"
];
var properties$2 = {
	$data: {
		type: "string",
		anyOf: [
			{
				format: "relative-json-pointer"
			},
			{
				format: "json-pointer"
			}
		]
	}
};
var additionalProperties$1 = false;
var require$$9 = {
	$id: $id$1,
	description: description,
	type: type$1,
	required: required$1,
	properties: properties$2,
	additionalProperties: additionalProperties$1
};

var uri$1 = {};

var fastUri$1 = {exports: {}};

/** @type {(value: string) => boolean} */
const isUUID$1 = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);

/** @type {(value: string) => boolean} */
const isIPv4$1 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);

/**
 * @param {Array<string>} input
 * @returns {string}
 */
function stringArrayToHexStripped (input) {
  let acc = '';
  let code = 0;
  let i = 0;

  for (i = 0; i < input.length; i++) {
    code = input[i].charCodeAt(0);
    if (code === 48) {
      continue
    }
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))) {
      return ''
    }
    acc += input[i];
    break
  }

  for (i += 1; i < input.length; i++) {
    code = input[i].charCodeAt(0);
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))) {
      return ''
    }
    acc += input[i];
  }
  return acc
}

/**
 * @typedef {Object} GetIPV6Result
 * @property {boolean} error - Indicates if there was an error parsing the IPv6 address.
 * @property {string} address - The parsed IPv6 address.
 * @property {string} [zone] - The zone identifier, if present.
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
const nonSimpleDomain$1 = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);

/**
 * @param {Array<string>} buffer
 * @returns {boolean}
 */
function consumeIsZone (buffer) {
  buffer.length = 0;
  return true
}

/**
 * @param {Array<string>} buffer
 * @param {Array<string>} address
 * @param {GetIPV6Result} output
 * @returns {boolean}
 */
function consumeHextets (buffer, address, output) {
  if (buffer.length) {
    const hex = stringArrayToHexStripped(buffer);
    if (hex !== '') {
      address.push(hex);
    } else {
      output.error = true;
      return false
    }
    buffer.length = 0;
  }
  return true
}

/**
 * @param {string} input
 * @returns {GetIPV6Result}
 */
function getIPV6 (input) {
  let tokenCount = 0;
  const output = { error: false, address: '', zone: '' };
  /** @type {Array<string>} */
  const address = [];
  /** @type {Array<string>} */
  const buffer = [];
  let endipv6Encountered = false;
  let endIpv6 = false;

  let consume = consumeHextets;

  for (let i = 0; i < input.length; i++) {
    const cursor = input[i];
    if (cursor === '[' || cursor === ']') { continue }
    if (cursor === ':') {
      if (endipv6Encountered === true) {
        endIpv6 = true;
      }
      if (!consume(buffer, address, output)) { break }
      if (++tokenCount > 7) {
        // not valid
        output.error = true;
        break
      }
      if (i > 0 && input[i - 1] === ':') {
        endipv6Encountered = true;
      }
      address.push(':');
      continue
    } else if (cursor === '%') {
      if (!consume(buffer, address, output)) { break }
      // switch to zone detection
      consume = consumeIsZone;
    } else {
      buffer.push(cursor);
      continue
    }
  }
  if (buffer.length) {
    if (consume === consumeIsZone) {
      output.zone = buffer.join('');
    } else if (endIpv6) {
      address.push(buffer.join(''));
    } else {
      address.push(stringArrayToHexStripped(buffer));
    }
  }
  output.address = address.join('');
  return output
}

/**
 * @typedef {Object} NormalizeIPv6Result
 * @property {string} host - The normalized host.
 * @property {string} [escapedHost] - The escaped host.
 * @property {boolean} isIPV6 - Indicates if the host is an IPv6 address.
 */

/**
 * @param {string} host
 * @returns {NormalizeIPv6Result}
 */
function normalizeIPv6$1 (host) {
  if (findToken(host, ':') < 2) { return { host, isIPV6: false } }
  const ipv6 = getIPV6(host);

  if (!ipv6.error) {
    let newHost = ipv6.address;
    let escapedHost = ipv6.address;
    if (ipv6.zone) {
      newHost += '%' + ipv6.zone;
      escapedHost += '%25' + ipv6.zone;
    }
    return { host: newHost, isIPV6: true, escapedHost }
  } else {
    return { host, isIPV6: false }
  }
}

/**
 * @param {string} str
 * @param {string} token
 * @returns {number}
 */
function findToken (str, token) {
  let ind = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === token) ind++;
  }
  return ind
}

/**
 * @param {string} path
 * @returns {string}
 *
 * @see https://datatracker.ietf.org/doc/html/rfc3986#section-5.2.4
 */
function removeDotSegments$1 (path) {
  let input = path;
  const output = [];
  let nextSlash = -1;
  let len = 0;

  // eslint-disable-next-line no-cond-assign
  while (len = input.length) {
    if (len === 1) {
      if (input === '.') {
        break
      } else if (input === '/') {
        output.push('/');
        break
      } else {
        output.push(input);
        break
      }
    } else if (len === 2) {
      if (input[0] === '.') {
        if (input[1] === '.') {
          break
        } else if (input[1] === '/') {
          input = input.slice(2);
          continue
        }
      } else if (input[0] === '/') {
        if (input[1] === '.' || input[1] === '/') {
          output.push('/');
          break
        }
      }
    } else if (len === 3) {
      if (input === '/..') {
        if (output.length !== 0) {
          output.pop();
        }
        output.push('/');
        break
      }
    }
    if (input[0] === '.') {
      if (input[1] === '.') {
        if (input[2] === '/') {
          input = input.slice(3);
          continue
        }
      } else if (input[1] === '/') {
        input = input.slice(2);
        continue
      }
    } else if (input[0] === '/') {
      if (input[1] === '.') {
        if (input[2] === '/') {
          input = input.slice(2);
          continue
        } else if (input[2] === '.') {
          if (input[3] === '/') {
            input = input.slice(3);
            if (output.length !== 0) {
              output.pop();
            }
            continue
          }
        }
      }
    }

    // Rule 2E: Move normal path segment to output
    if ((nextSlash = input.indexOf('/', 1)) === -1) {
      output.push(input);
      break
    } else {
      output.push(input.slice(0, nextSlash));
      input = input.slice(nextSlash);
    }
  }

  return output.join('')
}

/**
 * @param {import('../types/index').URIComponent} component
 * @param {boolean} esc
 * @returns {import('../types/index').URIComponent}
 */
function normalizeComponentEncoding$1 (component, esc) {
  const func = esc !== true ? escape : unescape;
  if (component.scheme !== undefined) {
    component.scheme = func(component.scheme);
  }
  if (component.userinfo !== undefined) {
    component.userinfo = func(component.userinfo);
  }
  if (component.host !== undefined) {
    component.host = func(component.host);
  }
  if (component.path !== undefined) {
    component.path = func(component.path);
  }
  if (component.query !== undefined) {
    component.query = func(component.query);
  }
  if (component.fragment !== undefined) {
    component.fragment = func(component.fragment);
  }
  return component
}

/**
 * @param {import('../types/index').URIComponent} component
 * @returns {string|undefined}
 */
function recomposeAuthority$1 (component) {
  const uriTokens = [];

  if (component.userinfo !== undefined) {
    uriTokens.push(component.userinfo);
    uriTokens.push('@');
  }

  if (component.host !== undefined) {
    let host = unescape(component.host);
    if (!isIPv4$1(host)) {
      const ipV6res = normalizeIPv6$1(host);
      if (ipV6res.isIPV6 === true) {
        host = `[${ipV6res.escapedHost}]`;
      } else {
        host = component.host;
      }
    }
    uriTokens.push(host);
  }

  if (typeof component.port === 'number' || typeof component.port === 'string') {
    uriTokens.push(':');
    uriTokens.push(String(component.port));
  }

  return uriTokens.length ? uriTokens.join('') : undefined
}
var utils = {
  nonSimpleDomain: nonSimpleDomain$1,
  recomposeAuthority: recomposeAuthority$1,
  normalizeComponentEncoding: normalizeComponentEncoding$1,
  removeDotSegments: removeDotSegments$1,
  isIPv4: isIPv4$1,
  isUUID: isUUID$1,
  normalizeIPv6: normalizeIPv6$1};

const { isUUID } = utils;
const URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;

/**
 * @callback SchemeFn
 * @param {import('../types/index').URIComponent} component
 * @param {import('../types/index').Options} options
 * @returns {import('../types/index').URIComponent}
 */

/**
 * @typedef {Object} SchemeHandler
 * @property {SchemeName} scheme - The scheme name.
 * @property {boolean} [domainHost] - Indicates if the scheme supports domain hosts.
 * @property {SchemeFn} parse - Function to parse the URI component for this scheme.
 * @property {SchemeFn} serialize - Function to serialize the URI component for this scheme.
 * @property {boolean} [skipNormalize] - Indicates if normalization should be skipped for this scheme.
 * @property {boolean} [absolutePath] - Indicates if the scheme uses absolute paths.
 * @property {boolean} [unicodeSupport] - Indicates if the scheme supports Unicode.
 */

/**
 * @param {import('../types/index').URIComponent} wsComponent
 * @returns {boolean}
 */
function wsIsSecure (wsComponent) {
  if (wsComponent.secure === true) {
    return true
  } else if (wsComponent.secure === false) {
    return false
  } else if (wsComponent.scheme) {
    return (
      wsComponent.scheme.length === 3 &&
      (wsComponent.scheme[0] === 'w' || wsComponent.scheme[0] === 'W') &&
      (wsComponent.scheme[1] === 's' || wsComponent.scheme[1] === 'S') &&
      (wsComponent.scheme[2] === 's' || wsComponent.scheme[2] === 'S')
    )
  } else {
    return false
  }
}

/** @type {SchemeFn} */
function httpParse (component) {
  if (!component.host) {
    component.error = component.error || 'HTTP URIs must have a host.';
  }

  return component
}

/** @type {SchemeFn} */
function httpSerialize (component) {
  const secure = String(component.scheme).toLowerCase() === 'https';

  // normalize the default port
  if (component.port === (secure ? 443 : 80) || component.port === '') {
    component.port = undefined;
  }

  // normalize the empty path
  if (!component.path) {
    component.path = '/';
  }

  // NOTE: We do not parse query strings for HTTP URIs
  // as WWW Form Url Encoded query strings are part of the HTML4+ spec,
  // and not the HTTP spec.

  return component
}

/** @type {SchemeFn} */
function wsParse (wsComponent) {
// indicate if the secure flag is set
  wsComponent.secure = wsIsSecure(wsComponent);

  // construct resouce name
  wsComponent.resourceName = (wsComponent.path || '/') + (wsComponent.query ? '?' + wsComponent.query : '');
  wsComponent.path = undefined;
  wsComponent.query = undefined;

  return wsComponent
}

/** @type {SchemeFn} */
function wsSerialize (wsComponent) {
// normalize the default port
  if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === '') {
    wsComponent.port = undefined;
  }

  // ensure scheme matches secure flag
  if (typeof wsComponent.secure === 'boolean') {
    wsComponent.scheme = (wsComponent.secure ? 'wss' : 'ws');
    wsComponent.secure = undefined;
  }

  // reconstruct path from resource name
  if (wsComponent.resourceName) {
    const [path, query] = wsComponent.resourceName.split('?');
    wsComponent.path = (path && path !== '/' ? path : undefined);
    wsComponent.query = query;
    wsComponent.resourceName = undefined;
  }

  // forbid fragment component
  wsComponent.fragment = undefined;

  return wsComponent
}

/** @type {SchemeFn} */
function urnParse (urnComponent, options) {
  if (!urnComponent.path) {
    urnComponent.error = 'URN can not be parsed';
    return urnComponent
  }
  const matches = urnComponent.path.match(URN_REG);
  if (matches) {
    const scheme = options.scheme || urnComponent.scheme || 'urn';
    urnComponent.nid = matches[1].toLowerCase();
    urnComponent.nss = matches[2];
    const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
    const schemeHandler = getSchemeHandler$1(urnScheme);
    urnComponent.path = undefined;

    if (schemeHandler) {
      urnComponent = schemeHandler.parse(urnComponent, options);
    }
  } else {
    urnComponent.error = urnComponent.error || 'URN can not be parsed.';
  }

  return urnComponent
}

/** @type {SchemeFn} */
function urnSerialize (urnComponent, options) {
  if (urnComponent.nid === undefined) {
    throw new Error('URN without nid cannot be serialized')
  }
  const scheme = options.scheme || urnComponent.scheme || 'urn';
  const nid = urnComponent.nid.toLowerCase();
  const urnScheme = `${scheme}:${options.nid || nid}`;
  const schemeHandler = getSchemeHandler$1(urnScheme);

  if (schemeHandler) {
    urnComponent = schemeHandler.serialize(urnComponent, options);
  }

  const uriComponent = urnComponent;
  const nss = urnComponent.nss;
  uriComponent.path = `${nid || options.nid}:${nss}`;

  options.skipEscape = true;
  return uriComponent
}

/** @type {SchemeFn} */
function urnuuidParse (urnComponent, options) {
  const uuidComponent = urnComponent;
  uuidComponent.uuid = uuidComponent.nss;
  uuidComponent.nss = undefined;

  if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
    uuidComponent.error = uuidComponent.error || 'UUID is not valid.';
  }

  return uuidComponent
}

/** @type {SchemeFn} */
function urnuuidSerialize (uuidComponent) {
  const urnComponent = uuidComponent;
  // normalize UUID
  urnComponent.nss = (uuidComponent.uuid || '').toLowerCase();
  return urnComponent
}

const http = /** @type {SchemeHandler} */ ({
  scheme: 'http',
  domainHost: true,
  parse: httpParse,
  serialize: httpSerialize
});

const https = /** @type {SchemeHandler} */ ({
  scheme: 'https',
  domainHost: http.domainHost,
  parse: httpParse,
  serialize: httpSerialize
});

const ws = /** @type {SchemeHandler} */ ({
  scheme: 'ws',
  domainHost: true,
  parse: wsParse,
  serialize: wsSerialize
});

const wss = /** @type {SchemeHandler} */ ({
  scheme: 'wss',
  domainHost: ws.domainHost,
  parse: ws.parse,
  serialize: ws.serialize
});

const urn = /** @type {SchemeHandler} */ ({
  scheme: 'urn',
  parse: urnParse,
  serialize: urnSerialize,
  skipNormalize: true
});

const urnuuid = /** @type {SchemeHandler} */ ({
  scheme: 'urn:uuid',
  parse: urnuuidParse,
  serialize: urnuuidSerialize,
  skipNormalize: true
});

const SCHEMES$1 = /** @type {Record<SchemeName, SchemeHandler>} */ ({
  http,
  https,
  ws,
  wss,
  urn,
  'urn:uuid': urnuuid
});

Object.setPrototypeOf(SCHEMES$1, null);

/**
 * @param {string|undefined} scheme
 * @returns {SchemeHandler|undefined}
 */
function getSchemeHandler$1 (scheme) {
  return (
    scheme && (
      SCHEMES$1[/** @type {SchemeName} */ (scheme)] ||
      SCHEMES$1[/** @type {SchemeName} */(scheme.toLowerCase())])
  ) ||
    undefined
}

var schemes = {
  SCHEMES: SCHEMES$1,
  getSchemeHandler: getSchemeHandler$1,
};

const { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizeComponentEncoding, isIPv4, nonSimpleDomain } = utils;
const { SCHEMES, getSchemeHandler } = schemes;

/**
 * @template {import('./types/index').URIComponent|string} T
 * @param {T} uri
 * @param {import('./types/index').Options} [options]
 * @returns {T}
 */
function normalize (uri, options) {
  if (typeof uri === 'string') {
    uri = /** @type {T} */ (serialize(parse$2(uri, options), options));
  } else if (typeof uri === 'object') {
    uri = /** @type {T} */ (parse$2(serialize(uri, options), options));
  }
  return uri
}

/**
 * @param {string} baseURI
 * @param {string} relativeURI
 * @param {import('./types/index').Options} [options]
 * @returns {string}
 */
function resolve (baseURI, relativeURI, options) {
  const schemelessOptions = options ? Object.assign({ scheme: 'null' }, options) : { scheme: 'null' };
  const resolved = resolveComponent(parse$2(baseURI, schemelessOptions), parse$2(relativeURI, schemelessOptions), schemelessOptions, true);
  schemelessOptions.skipEscape = true;
  return serialize(resolved, schemelessOptions)
}

/**
 * @param {import ('./types/index').URIComponent} base
 * @param {import ('./types/index').URIComponent} relative
 * @param {import('./types/index').Options} [options]
 * @param {boolean} [skipNormalization=false]
 * @returns {import ('./types/index').URIComponent}
 */
function resolveComponent (base, relative, options, skipNormalization) {
  /** @type {import('./types/index').URIComponent} */
  const target = {};
  if (!skipNormalization) {
    base = parse$2(serialize(base, options), options); // normalize base component
    relative = parse$2(serialize(relative, options), options); // normalize relative component
  }
  options = options || {};

  if (!options.tolerant && relative.scheme) {
    target.scheme = relative.scheme;
    // target.authority = relative.authority;
    target.userinfo = relative.userinfo;
    target.host = relative.host;
    target.port = relative.port;
    target.path = removeDotSegments(relative.path || '');
    target.query = relative.query;
  } else {
    if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
      // target.authority = relative.authority;
      target.userinfo = relative.userinfo;
      target.host = relative.host;
      target.port = relative.port;
      target.path = removeDotSegments(relative.path || '');
      target.query = relative.query;
    } else {
      if (!relative.path) {
        target.path = base.path;
        if (relative.query !== undefined) {
          target.query = relative.query;
        } else {
          target.query = base.query;
        }
      } else {
        if (relative.path[0] === '/') {
          target.path = removeDotSegments(relative.path);
        } else {
          if ((base.userinfo !== undefined || base.host !== undefined || base.port !== undefined) && !base.path) {
            target.path = '/' + relative.path;
          } else if (!base.path) {
            target.path = relative.path;
          } else {
            target.path = base.path.slice(0, base.path.lastIndexOf('/') + 1) + relative.path;
          }
          target.path = removeDotSegments(target.path);
        }
        target.query = relative.query;
      }
      // target.authority = base.authority;
      target.userinfo = base.userinfo;
      target.host = base.host;
      target.port = base.port;
    }
    target.scheme = base.scheme;
  }

  target.fragment = relative.fragment;

  return target
}

/**
 * @param {import ('./types/index').URIComponent|string} uriA
 * @param {import ('./types/index').URIComponent|string} uriB
 * @param {import ('./types/index').Options} options
 * @returns {boolean}
 */
function equal$2 (uriA, uriB, options) {
  if (typeof uriA === 'string') {
    uriA = unescape(uriA);
    uriA = serialize(normalizeComponentEncoding(parse$2(uriA, options), true), { ...options, skipEscape: true });
  } else if (typeof uriA === 'object') {
    uriA = serialize(normalizeComponentEncoding(uriA, true), { ...options, skipEscape: true });
  }

  if (typeof uriB === 'string') {
    uriB = unescape(uriB);
    uriB = serialize(normalizeComponentEncoding(parse$2(uriB, options), true), { ...options, skipEscape: true });
  } else if (typeof uriB === 'object') {
    uriB = serialize(normalizeComponentEncoding(uriB, true), { ...options, skipEscape: true });
  }

  return uriA.toLowerCase() === uriB.toLowerCase()
}

/**
 * @param {Readonly<import('./types/index').URIComponent>} cmpts
 * @param {import('./types/index').Options} [opts]
 * @returns {string}
 */
function serialize (cmpts, opts) {
  const component = {
    host: cmpts.host,
    scheme: cmpts.scheme,
    userinfo: cmpts.userinfo,
    port: cmpts.port,
    path: cmpts.path,
    query: cmpts.query,
    nid: cmpts.nid,
    nss: cmpts.nss,
    uuid: cmpts.uuid,
    fragment: cmpts.fragment,
    reference: cmpts.reference,
    resourceName: cmpts.resourceName,
    secure: cmpts.secure,
    error: ''
  };
  const options = Object.assign({}, opts);
  const uriTokens = [];

  // find scheme handler
  const schemeHandler = getSchemeHandler(options.scheme || component.scheme);

  // perform scheme specific serialization
  if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);

  if (component.path !== undefined) {
    if (!options.skipEscape) {
      component.path = escape(component.path);

      if (component.scheme !== undefined) {
        component.path = component.path.split('%3A').join(':');
      }
    } else {
      component.path = unescape(component.path);
    }
  }

  if (options.reference !== 'suffix' && component.scheme) {
    uriTokens.push(component.scheme, ':');
  }

  const authority = recomposeAuthority(component);
  if (authority !== undefined) {
    if (options.reference !== 'suffix') {
      uriTokens.push('//');
    }

    uriTokens.push(authority);

    if (component.path && component.path[0] !== '/') {
      uriTokens.push('/');
    }
  }
  if (component.path !== undefined) {
    let s = component.path;

    if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
      s = removeDotSegments(s);
    }

    if (
      authority === undefined &&
      s[0] === '/' &&
      s[1] === '/'
    ) {
      // don't allow the path to start with "//"
      s = '/%2F' + s.slice(2);
    }

    uriTokens.push(s);
  }

  if (component.query !== undefined) {
    uriTokens.push('?', component.query);
  }

  if (component.fragment !== undefined) {
    uriTokens.push('#', component.fragment);
  }
  return uriTokens.join('')
}

const URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;

/**
 * @param {string} uri
 * @param {import('./types/index').Options} [opts]
 * @returns
 */
function parse$2 (uri, opts) {
  const options = Object.assign({}, opts);
  /** @type {import('./types/index').URIComponent} */
  const parsed = {
    scheme: undefined,
    userinfo: undefined,
    host: '',
    port: undefined,
    path: '',
    query: undefined,
    fragment: undefined
  };

  let isIP = false;
  if (options.reference === 'suffix') {
    if (options.scheme) {
      uri = options.scheme + ':' + uri;
    } else {
      uri = '//' + uri;
    }
  }

  const matches = uri.match(URI_PARSE);

  if (matches) {
    // store each component
    parsed.scheme = matches[1];
    parsed.userinfo = matches[3];
    parsed.host = matches[4];
    parsed.port = parseInt(matches[5], 10);
    parsed.path = matches[6] || '';
    parsed.query = matches[7];
    parsed.fragment = matches[8];

    // fix port number
    if (isNaN(parsed.port)) {
      parsed.port = matches[5];
    }
    if (parsed.host) {
      const ipv4result = isIPv4(parsed.host);
      if (ipv4result === false) {
        const ipv6result = normalizeIPv6(parsed.host);
        parsed.host = ipv6result.host.toLowerCase();
        isIP = ipv6result.isIPV6;
      } else {
        isIP = true;
      }
    }
    if (parsed.scheme === undefined && parsed.userinfo === undefined && parsed.host === undefined && parsed.port === undefined && parsed.query === undefined && !parsed.path) {
      parsed.reference = 'same-document';
    } else if (parsed.scheme === undefined) {
      parsed.reference = 'relative';
    } else if (parsed.fragment === undefined) {
      parsed.reference = 'absolute';
    } else {
      parsed.reference = 'uri';
    }

    // check for reference errors
    if (options.reference && options.reference !== 'suffix' && options.reference !== parsed.reference) {
      parsed.error = parsed.error || 'URI is not a ' + options.reference + ' reference.';
    }

    // find scheme handler
    const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);

    // check if scheme can't handle IRIs
    if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
      // if host component is a domain name
      if (parsed.host && (options.domainHost || (schemeHandler && schemeHandler.domainHost)) && isIP === false && nonSimpleDomain(parsed.host)) {
        // convert Unicode IDN -> ASCII IDN
        try {
          parsed.host = URL.domainToASCII(parsed.host.toLowerCase());
        } catch (e) {
          parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
        }
      }
      // convert IRI -> URI
    }

    if (!schemeHandler || (schemeHandler && !schemeHandler.skipNormalize)) {
      if (uri.indexOf('%') !== -1) {
        if (parsed.scheme !== undefined) {
          parsed.scheme = unescape(parsed.scheme);
        }
        if (parsed.host !== undefined) {
          parsed.host = unescape(parsed.host);
        }
      }
      if (parsed.path) {
        parsed.path = escape(unescape(parsed.path));
      }
      if (parsed.fragment) {
        parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
      }
    }

    // perform scheme specific parsing
    if (schemeHandler && schemeHandler.parse) {
      schemeHandler.parse(parsed, options);
    }
  } else {
    parsed.error = parsed.error || 'URI can not be parsed.';
  }
  return parsed
}

const fastUri = {
  SCHEMES,
  normalize,
  resolve,
  resolveComponent,
  equal: equal$2,
  serialize,
  parse: parse$2
};

fastUri$1.exports = fastUri;
fastUri$1.exports.default = fastUri;
fastUri$1.exports.fastUri = fastUri;

var fastUriExports = fastUri$1.exports;

Object.defineProperty(uri$1, "__esModule", { value: true });
const uri = fastUriExports;
uri.code = 'require("ajv/dist/runtime/uri").default';
uri$1.default = uri;

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
	var validate_1 = requireValidate();
	Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function () { return validate_1.KeywordCxt; } });
	var codegen_1 = requireCodegen();
	Object.defineProperty(exports, "_", { enumerable: true, get: function () { return codegen_1._; } });
	Object.defineProperty(exports, "str", { enumerable: true, get: function () { return codegen_1.str; } });
	Object.defineProperty(exports, "stringify", { enumerable: true, get: function () { return codegen_1.stringify; } });
	Object.defineProperty(exports, "nil", { enumerable: true, get: function () { return codegen_1.nil; } });
	Object.defineProperty(exports, "Name", { enumerable: true, get: function () { return codegen_1.Name; } });
	Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function () { return codegen_1.CodeGen; } });
	const validation_error_1 = requireValidation_error();
	const ref_error_1 = requireRef_error();
	const rules_1 = rules;
	const compile_1 = compile;
	const codegen_2 = requireCodegen();
	const resolve_1 = resolve$2;
	const dataType_1 = dataType;
	const util_1 = util;
	const $dataRefSchema = require$$9;
	const uri_1 = uri$1;
	const defaultRegExp = (str, flags) => new RegExp(str, flags);
	defaultRegExp.code = "new RegExp";
	const META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
	const EXT_SCOPE_NAMES = new Set([
	    "validate",
	    "serialize",
	    "parse",
	    "wrapper",
	    "root",
	    "schema",
	    "keyword",
	    "pattern",
	    "formats",
	    "validate$data",
	    "func",
	    "obj",
	    "Error",
	]);
	const removedOptions = {
	    errorDataPath: "",
	    format: "`validateFormats: false` can be used instead.",
	    nullable: '"nullable" keyword is supported by default.',
	    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
	    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
	    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
	    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
	    sourceCode: "Use option `code: {source: true}`",
	    strictDefaults: "It is default now, see option `strict`.",
	    strictKeywords: "It is default now, see option `strict`.",
	    uniqueItems: '"uniqueItems" keyword is always validated.',
	    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
	    cache: "Map is used as cache, schema object as key.",
	    serialize: "Map is used as cache, schema object as key.",
	    ajvErrors: "It is default now.",
	};
	const deprecatedOptions = {
	    ignoreKeywordsWithRef: "",
	    jsPropertySyntax: "",
	    unicode: '"minLength"/"maxLength" account for unicode characters by default.',
	};
	const MAX_EXPRESSION = 200;
	// eslint-disable-next-line complexity
	function requiredOptions(o) {
	    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
	    const s = o.strict;
	    const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
	    const optimize = _optz === true || _optz === undefined ? 1 : _optz || 0;
	    const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
	    const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
	    return {
	        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
	        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
	        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
	        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
	        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
	        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
	        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
	        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
	        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
	        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
	        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
	        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
	        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
	        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
	        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
	        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
	        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
	        uriResolver: uriResolver,
	    };
	}
	class Ajv {
	    constructor(opts = {}) {
	        this.schemas = {};
	        this.refs = {};
	        this.formats = {};
	        this._compilations = new Set();
	        this._loading = {};
	        this._cache = new Map();
	        opts = this.opts = { ...opts, ...requiredOptions(opts) };
	        const { es5, lines } = this.opts.code;
	        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
	        this.logger = getLogger(opts.logger);
	        const formatOpt = opts.validateFormats;
	        opts.validateFormats = false;
	        this.RULES = (0, rules_1.getRules)();
	        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
	        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
	        this._metaOpts = getMetaSchemaOptions.call(this);
	        if (opts.formats)
	            addInitialFormats.call(this);
	        this._addVocabularies();
	        this._addDefaultMetaSchema();
	        if (opts.keywords)
	            addInitialKeywords.call(this, opts.keywords);
	        if (typeof opts.meta == "object")
	            this.addMetaSchema(opts.meta);
	        addInitialSchemas.call(this);
	        opts.validateFormats = formatOpt;
	    }
	    _addVocabularies() {
	        this.addKeyword("$async");
	    }
	    _addDefaultMetaSchema() {
	        const { $data, meta, schemaId } = this.opts;
	        let _dataRefSchema = $dataRefSchema;
	        if (schemaId === "id") {
	            _dataRefSchema = { ...$dataRefSchema };
	            _dataRefSchema.id = _dataRefSchema.$id;
	            delete _dataRefSchema.$id;
	        }
	        if (meta && $data)
	            this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
	    }
	    defaultMeta() {
	        const { meta, schemaId } = this.opts;
	        return (this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : undefined);
	    }
	    validate(schemaKeyRef, // key, ref or schema object
	    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
	    data // to be validated
	    ) {
	        let v;
	        if (typeof schemaKeyRef == "string") {
	            v = this.getSchema(schemaKeyRef);
	            if (!v)
	                throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
	        }
	        else {
	            v = this.compile(schemaKeyRef);
	        }
	        const valid = v(data);
	        if (!("$async" in v))
	            this.errors = v.errors;
	        return valid;
	    }
	    compile(schema, _meta) {
	        const sch = this._addSchema(schema, _meta);
	        return (sch.validate || this._compileSchemaEnv(sch));
	    }
	    compileAsync(schema, meta) {
	        if (typeof this.opts.loadSchema != "function") {
	            throw new Error("options.loadSchema should be a function");
	        }
	        const { loadSchema } = this.opts;
	        return runCompileAsync.call(this, schema, meta);
	        async function runCompileAsync(_schema, _meta) {
	            await loadMetaSchema.call(this, _schema.$schema);
	            const sch = this._addSchema(_schema, _meta);
	            return sch.validate || _compileAsync.call(this, sch);
	        }
	        async function loadMetaSchema($ref) {
	            if ($ref && !this.getSchema($ref)) {
	                await runCompileAsync.call(this, { $ref }, true);
	            }
	        }
	        async function _compileAsync(sch) {
	            try {
	                return this._compileSchemaEnv(sch);
	            }
	            catch (e) {
	                if (!(e instanceof ref_error_1.default))
	                    throw e;
	                checkLoaded.call(this, e);
	                await loadMissingSchema.call(this, e.missingSchema);
	                return _compileAsync.call(this, sch);
	            }
	        }
	        function checkLoaded({ missingSchema: ref, missingRef }) {
	            if (this.refs[ref]) {
	                throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
	            }
	        }
	        async function loadMissingSchema(ref) {
	            const _schema = await _loadSchema.call(this, ref);
	            if (!this.refs[ref])
	                await loadMetaSchema.call(this, _schema.$schema);
	            if (!this.refs[ref])
	                this.addSchema(_schema, ref, meta);
	        }
	        async function _loadSchema(ref) {
	            const p = this._loading[ref];
	            if (p)
	                return p;
	            try {
	                return await (this._loading[ref] = loadSchema(ref));
	            }
	            finally {
	                delete this._loading[ref];
	            }
	        }
	    }
	    // Adds schema to the instance
	    addSchema(schema, // If array is passed, `key` will be ignored
	    key, // Optional schema key. Can be passed to `validate` method instead of schema object or id/ref. One schema per instance can have empty `id` and `key`.
	    _meta, // true if schema is a meta-schema. Used internally, addMetaSchema should be used instead.
	    _validateSchema = this.opts.validateSchema // false to skip schema validation. Used internally, option validateSchema should be used instead.
	    ) {
	        if (Array.isArray(schema)) {
	            for (const sch of schema)
	                this.addSchema(sch, undefined, _meta, _validateSchema);
	            return this;
	        }
	        let id;
	        if (typeof schema === "object") {
	            const { schemaId } = this.opts;
	            id = schema[schemaId];
	            if (id !== undefined && typeof id != "string") {
	                throw new Error(`schema ${schemaId} must be string`);
	            }
	        }
	        key = (0, resolve_1.normalizeId)(key || id);
	        this._checkUnique(key);
	        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
	        return this;
	    }
	    // Add schema that will be used to validate other schemas
	    // options in META_IGNORE_OPTIONS are alway set to false
	    addMetaSchema(schema, key, // schema key
	    _validateSchema = this.opts.validateSchema // false to skip schema validation, can be used to override validateSchema option for meta-schema
	    ) {
	        this.addSchema(schema, key, true, _validateSchema);
	        return this;
	    }
	    //  Validate schema against its meta-schema
	    validateSchema(schema, throwOrLogError) {
	        if (typeof schema == "boolean")
	            return true;
	        let $schema;
	        $schema = schema.$schema;
	        if ($schema !== undefined && typeof $schema != "string") {
	            throw new Error("$schema must be a string");
	        }
	        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
	        if (!$schema) {
	            this.logger.warn("meta-schema not available");
	            this.errors = null;
	            return true;
	        }
	        const valid = this.validate($schema, schema);
	        if (!valid && throwOrLogError) {
	            const message = "schema is invalid: " + this.errorsText();
	            if (this.opts.validateSchema === "log")
	                this.logger.error(message);
	            else
	                throw new Error(message);
	        }
	        return valid;
	    }
	    // Get compiled schema by `key` or `ref`.
	    // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
	    getSchema(keyRef) {
	        let sch;
	        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
	            keyRef = sch;
	        if (sch === undefined) {
	            const { schemaId } = this.opts;
	            const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
	            sch = compile_1.resolveSchema.call(this, root, keyRef);
	            if (!sch)
	                return;
	            this.refs[keyRef] = sch;
	        }
	        return (sch.validate || this._compileSchemaEnv(sch));
	    }
	    // Remove cached schema(s).
	    // If no parameter is passed all schemas but meta-schemas are removed.
	    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
	    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
	    removeSchema(schemaKeyRef) {
	        if (schemaKeyRef instanceof RegExp) {
	            this._removeAllSchemas(this.schemas, schemaKeyRef);
	            this._removeAllSchemas(this.refs, schemaKeyRef);
	            return this;
	        }
	        switch (typeof schemaKeyRef) {
	            case "undefined":
	                this._removeAllSchemas(this.schemas);
	                this._removeAllSchemas(this.refs);
	                this._cache.clear();
	                return this;
	            case "string": {
	                const sch = getSchEnv.call(this, schemaKeyRef);
	                if (typeof sch == "object")
	                    this._cache.delete(sch.schema);
	                delete this.schemas[schemaKeyRef];
	                delete this.refs[schemaKeyRef];
	                return this;
	            }
	            case "object": {
	                const cacheKey = schemaKeyRef;
	                this._cache.delete(cacheKey);
	                let id = schemaKeyRef[this.opts.schemaId];
	                if (id) {
	                    id = (0, resolve_1.normalizeId)(id);
	                    delete this.schemas[id];
	                    delete this.refs[id];
	                }
	                return this;
	            }
	            default:
	                throw new Error("ajv.removeSchema: invalid parameter");
	        }
	    }
	    // add "vocabulary" - a collection of keywords
	    addVocabulary(definitions) {
	        for (const def of definitions)
	            this.addKeyword(def);
	        return this;
	    }
	    addKeyword(kwdOrDef, def // deprecated
	    ) {
	        let keyword;
	        if (typeof kwdOrDef == "string") {
	            keyword = kwdOrDef;
	            if (typeof def == "object") {
	                this.logger.warn("these parameters are deprecated, see docs for addKeyword");
	                def.keyword = keyword;
	            }
	        }
	        else if (typeof kwdOrDef == "object" && def === undefined) {
	            def = kwdOrDef;
	            keyword = def.keyword;
	            if (Array.isArray(keyword) && !keyword.length) {
	                throw new Error("addKeywords: keyword must be string or non-empty array");
	            }
	        }
	        else {
	            throw new Error("invalid addKeywords parameters");
	        }
	        checkKeyword.call(this, keyword, def);
	        if (!def) {
	            (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
	            return this;
	        }
	        keywordMetaschema.call(this, def);
	        const definition = {
	            ...def,
	            type: (0, dataType_1.getJSONTypes)(def.type),
	            schemaType: (0, dataType_1.getJSONTypes)(def.schemaType),
	        };
	        (0, util_1.eachItem)(keyword, definition.type.length === 0
	            ? (k) => addRule.call(this, k, definition)
	            : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
	        return this;
	    }
	    getKeyword(keyword) {
	        const rule = this.RULES.all[keyword];
	        return typeof rule == "object" ? rule.definition : !!rule;
	    }
	    // Remove keyword
	    removeKeyword(keyword) {
	        // TODO return type should be Ajv
	        const { RULES } = this;
	        delete RULES.keywords[keyword];
	        delete RULES.all[keyword];
	        for (const group of RULES.rules) {
	            const i = group.rules.findIndex((rule) => rule.keyword === keyword);
	            if (i >= 0)
	                group.rules.splice(i, 1);
	        }
	        return this;
	    }
	    // Add format
	    addFormat(name, format) {
	        if (typeof format == "string")
	            format = new RegExp(format);
	        this.formats[name] = format;
	        return this;
	    }
	    errorsText(errors = this.errors, // optional array of validation errors
	    { separator = ", ", dataVar = "data" } = {} // optional options with properties `separator` and `dataVar`
	    ) {
	        if (!errors || errors.length === 0)
	            return "No errors";
	        return errors
	            .map((e) => `${dataVar}${e.instancePath} ${e.message}`)
	            .reduce((text, msg) => text + separator + msg);
	    }
	    $dataMetaSchema(metaSchema, keywordsJsonPointers) {
	        const rules = this.RULES.all;
	        metaSchema = JSON.parse(JSON.stringify(metaSchema));
	        for (const jsonPointer of keywordsJsonPointers) {
	            const segments = jsonPointer.split("/").slice(1); // first segment is an empty string
	            let keywords = metaSchema;
	            for (const seg of segments)
	                keywords = keywords[seg];
	            for (const key in rules) {
	                const rule = rules[key];
	                if (typeof rule != "object")
	                    continue;
	                const { $data } = rule.definition;
	                const schema = keywords[key];
	                if ($data && schema)
	                    keywords[key] = schemaOrData(schema);
	            }
	        }
	        return metaSchema;
	    }
	    _removeAllSchemas(schemas, regex) {
	        for (const keyRef in schemas) {
	            const sch = schemas[keyRef];
	            if (!regex || regex.test(keyRef)) {
	                if (typeof sch == "string") {
	                    delete schemas[keyRef];
	                }
	                else if (sch && !sch.meta) {
	                    this._cache.delete(sch.schema);
	                    delete schemas[keyRef];
	                }
	            }
	        }
	    }
	    _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
	        let id;
	        const { schemaId } = this.opts;
	        if (typeof schema == "object") {
	            id = schema[schemaId];
	        }
	        else {
	            if (this.opts.jtd)
	                throw new Error("schema must be object");
	            else if (typeof schema != "boolean")
	                throw new Error("schema must be object or boolean");
	        }
	        let sch = this._cache.get(schema);
	        if (sch !== undefined)
	            return sch;
	        baseId = (0, resolve_1.normalizeId)(id || baseId);
	        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
	        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
	        this._cache.set(sch.schema, sch);
	        if (addSchema && !baseId.startsWith("#")) {
	            // TODO atm it is allowed to overwrite schemas without id (instead of not adding them)
	            if (baseId)
	                this._checkUnique(baseId);
	            this.refs[baseId] = sch;
	        }
	        if (validateSchema)
	            this.validateSchema(schema, true);
	        return sch;
	    }
	    _checkUnique(id) {
	        if (this.schemas[id] || this.refs[id]) {
	            throw new Error(`schema with key or id "${id}" already exists`);
	        }
	    }
	    _compileSchemaEnv(sch) {
	        if (sch.meta)
	            this._compileMetaSchema(sch);
	        else
	            compile_1.compileSchema.call(this, sch);
	        /* istanbul ignore if */
	        if (!sch.validate)
	            throw new Error("ajv implementation error");
	        return sch.validate;
	    }
	    _compileMetaSchema(sch) {
	        const currentOpts = this.opts;
	        this.opts = this._metaOpts;
	        try {
	            compile_1.compileSchema.call(this, sch);
	        }
	        finally {
	            this.opts = currentOpts;
	        }
	    }
	}
	Ajv.ValidationError = validation_error_1.default;
	Ajv.MissingRefError = ref_error_1.default;
	exports.default = Ajv;
	function checkOptions(checkOpts, options, msg, log = "error") {
	    for (const key in checkOpts) {
	        const opt = key;
	        if (opt in options)
	            this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
	    }
	}
	function getSchEnv(keyRef) {
	    keyRef = (0, resolve_1.normalizeId)(keyRef); // TODO tests fail without this line
	    return this.schemas[keyRef] || this.refs[keyRef];
	}
	function addInitialSchemas() {
	    const optsSchemas = this.opts.schemas;
	    if (!optsSchemas)
	        return;
	    if (Array.isArray(optsSchemas))
	        this.addSchema(optsSchemas);
	    else
	        for (const key in optsSchemas)
	            this.addSchema(optsSchemas[key], key);
	}
	function addInitialFormats() {
	    for (const name in this.opts.formats) {
	        const format = this.opts.formats[name];
	        if (format)
	            this.addFormat(name, format);
	    }
	}
	function addInitialKeywords(defs) {
	    if (Array.isArray(defs)) {
	        this.addVocabulary(defs);
	        return;
	    }
	    this.logger.warn("keywords option as map is deprecated, pass array");
	    for (const keyword in defs) {
	        const def = defs[keyword];
	        if (!def.keyword)
	            def.keyword = keyword;
	        this.addKeyword(def);
	    }
	}
	function getMetaSchemaOptions() {
	    const metaOpts = { ...this.opts };
	    for (const opt of META_IGNORE_OPTIONS)
	        delete metaOpts[opt];
	    return metaOpts;
	}
	const noLogs = { log() { }, warn() { }, error() { } };
	function getLogger(logger) {
	    if (logger === false)
	        return noLogs;
	    if (logger === undefined)
	        return console;
	    if (logger.log && logger.warn && logger.error)
	        return logger;
	    throw new Error("logger must implement log, warn and error methods");
	}
	const KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
	function checkKeyword(keyword, def) {
	    const { RULES } = this;
	    (0, util_1.eachItem)(keyword, (kwd) => {
	        if (RULES.keywords[kwd])
	            throw new Error(`Keyword ${kwd} is already defined`);
	        if (!KEYWORD_NAME.test(kwd))
	            throw new Error(`Keyword ${kwd} has invalid name`);
	    });
	    if (!def)
	        return;
	    if (def.$data && !("code" in def || "validate" in def)) {
	        throw new Error('$data keyword must have "code" or "validate" function');
	    }
	}
	function addRule(keyword, definition, dataType) {
	    var _a;
	    const post = definition === null || definition === void 0 ? void 0 : definition.post;
	    if (dataType && post)
	        throw new Error('keyword with "post" flag cannot have "type"');
	    const { RULES } = this;
	    let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
	    if (!ruleGroup) {
	        ruleGroup = { type: dataType, rules: [] };
	        RULES.rules.push(ruleGroup);
	    }
	    RULES.keywords[keyword] = true;
	    if (!definition)
	        return;
	    const rule = {
	        keyword,
	        definition: {
	            ...definition,
	            type: (0, dataType_1.getJSONTypes)(definition.type),
	            schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType),
	        },
	    };
	    if (definition.before)
	        addBeforeRule.call(this, ruleGroup, rule, definition.before);
	    else
	        ruleGroup.rules.push(rule);
	    RULES.all[keyword] = rule;
	    (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
	}
	function addBeforeRule(ruleGroup, rule, before) {
	    const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
	    if (i >= 0) {
	        ruleGroup.rules.splice(i, 0, rule);
	    }
	    else {
	        ruleGroup.rules.push(rule);
	        this.logger.warn(`rule ${before} is not defined`);
	    }
	}
	function keywordMetaschema(def) {
	    let { metaSchema } = def;
	    if (metaSchema === undefined)
	        return;
	    if (def.$data && this.opts.$data)
	        metaSchema = schemaOrData(metaSchema);
	    def.validateSchema = this.compile(metaSchema, true);
	}
	const $dataRef = {
	    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
	};
	function schemaOrData(schema) {
	    return { anyOf: [schema, $dataRef] };
	}
	
} (core$3));

var draft7 = {};

var core$2 = {};

var id = {};

Object.defineProperty(id, "__esModule", { value: true });
const def$s = {
    keyword: "id",
    code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
    },
};
id.default = def$s;

var ref = {};

Object.defineProperty(ref, "__esModule", { value: true });
ref.callRef = ref.getValidate = void 0;
const ref_error_1$1 = requireRef_error();
const code_1$8 = requireCode();
const codegen_1$l = requireCodegen();
const names_1$1 = requireNames();
const compile_1$1 = compile;
const util_1$j = util;
const def$r = {
    keyword: "$ref",
    schemaType: "string",
    code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
            return callRootRef();
        const schOrEnv = compile_1$1.resolveRef.call(self, root, baseId, $ref);
        if (schOrEnv === undefined)
            throw new ref_error_1$1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1$1.SchemaEnv)
            return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
            if (env === root)
                return callRef(cxt, validateName, env, env.$async);
            const rootName = gen.scopeValue("root", { ref: root });
            return callRef(cxt, (0, codegen_1$l._) `${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
            const v = getValidate(cxt, sch);
            callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
            const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1$l.stringify)(sch) } : { ref: sch });
            const valid = gen.name("valid");
            const schCxt = cxt.subschema({
                schema: sch,
                dataTypes: [],
                schemaPath: codegen_1$l.nil,
                topSchemaRef: schName,
                errSchemaPath: $ref,
            }, valid);
            cxt.mergeEvaluated(schCxt);
            cxt.ok(valid);
        }
    },
};
function getValidate(cxt, sch) {
    const { gen } = cxt;
    return sch.validate
        ? gen.scopeValue("validate", { ref: sch.validate })
        : (0, codegen_1$l._) `${gen.scopeValue("wrapper", { ref: sch })}.validate`;
}
ref.getValidate = getValidate;
function callRef(cxt, v, sch, $async) {
    const { gen, it } = cxt;
    const { allErrors, schemaEnv: env, opts } = it;
    const passCxt = opts.passContext ? names_1$1.default.this : codegen_1$l.nil;
    if ($async)
        callAsyncRef();
    else
        callSyncRef();
    function callAsyncRef() {
        if (!env.$async)
            throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
            gen.code((0, codegen_1$l._) `await ${(0, code_1$8.callValidateCode)(cxt, v, passCxt)}`);
            addEvaluatedFrom(v); // TODO will not work with async, it has to be returned with the result
            if (!allErrors)
                gen.assign(valid, true);
        }, (e) => {
            gen.if((0, codegen_1$l._) `!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
            addErrorsFrom(e);
            if (!allErrors)
                gen.assign(valid, false);
        });
        cxt.ok(valid);
    }
    function callSyncRef() {
        cxt.result((0, code_1$8.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
    }
    function addErrorsFrom(source) {
        const errs = (0, codegen_1$l._) `${source}.errors`;
        gen.assign(names_1$1.default.vErrors, (0, codegen_1$l._) `${names_1$1.default.vErrors} === null ? ${errs} : ${names_1$1.default.vErrors}.concat(${errs})`); // TODO tagged
        gen.assign(names_1$1.default.errors, (0, codegen_1$l._) `${names_1$1.default.vErrors}.length`);
    }
    function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
            return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        // TODO refactor
        if (it.props !== true) {
            if (schEvaluated && !schEvaluated.dynamicProps) {
                if (schEvaluated.props !== undefined) {
                    it.props = util_1$j.mergeEvaluated.props(gen, schEvaluated.props, it.props);
                }
            }
            else {
                const props = gen.var("props", (0, codegen_1$l._) `${source}.evaluated.props`);
                it.props = util_1$j.mergeEvaluated.props(gen, props, it.props, codegen_1$l.Name);
            }
        }
        if (it.items !== true) {
            if (schEvaluated && !schEvaluated.dynamicItems) {
                if (schEvaluated.items !== undefined) {
                    it.items = util_1$j.mergeEvaluated.items(gen, schEvaluated.items, it.items);
                }
            }
            else {
                const items = gen.var("items", (0, codegen_1$l._) `${source}.evaluated.items`);
                it.items = util_1$j.mergeEvaluated.items(gen, items, it.items, codegen_1$l.Name);
            }
        }
    }
}
ref.callRef = callRef;
ref.default = def$r;

Object.defineProperty(core$2, "__esModule", { value: true });
const id_1 = id;
const ref_1 = ref;
const core$1 = [
    "$schema",
    "$id",
    "$defs",
    "$vocabulary",
    { keyword: "$comment" },
    "definitions",
    id_1.default,
    ref_1.default,
];
core$2.default = core$1;

var validation$1 = {};

var limitNumber = {};

Object.defineProperty(limitNumber, "__esModule", { value: true });
const codegen_1$k = requireCodegen();
const ops = codegen_1$k.operators;
const KWDs = {
    maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE },
};
const error$i = {
    message: ({ keyword, schemaCode }) => (0, codegen_1$k.str) `must be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1$k._) `{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`,
};
const def$q = {
    keyword: Object.keys(KWDs),
    type: "number",
    schemaType: "number",
    $data: true,
    error: error$i,
    code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1$k._) `${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
    },
};
limitNumber.default = def$q;

var multipleOf = {};

Object.defineProperty(multipleOf, "__esModule", { value: true });
const codegen_1$j = requireCodegen();
const error$h = {
    message: ({ schemaCode }) => (0, codegen_1$j.str) `must be multiple of ${schemaCode}`,
    params: ({ schemaCode }) => (0, codegen_1$j._) `{multipleOf: ${schemaCode}}`,
};
const def$p = {
    keyword: "multipleOf",
    type: "number",
    schemaType: "number",
    $data: true,
    error: error$h,
    code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        // const bdt = bad$DataType(schemaCode, <string>def.schemaType, $data)
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec
            ? (0, codegen_1$j._) `Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}`
            : (0, codegen_1$j._) `${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1$j._) `(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
    },
};
multipleOf.default = def$p;

var limitLength = {};

var ucs2length$1 = {};

Object.defineProperty(ucs2length$1, "__esModule", { value: true });
// https://mathiasbynens.be/notes/javascript-encoding
// https://github.com/bestiejs/punycode.js - punycode.ucs2.decode
function ucs2length(str) {
    const len = str.length;
    let length = 0;
    let pos = 0;
    let value;
    while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 0xd800 && value <= 0xdbff && pos < len) {
            // high surrogate, and there is a next character
            value = str.charCodeAt(pos);
            if ((value & 0xfc00) === 0xdc00)
                pos++; // low surrogate
        }
    }
    return length;
}
ucs2length$1.default = ucs2length;
ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';

Object.defineProperty(limitLength, "__esModule", { value: true });
const codegen_1$i = requireCodegen();
const util_1$i = util;
const ucs2length_1 = ucs2length$1;
const error$g = {
    message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1$i.str) `must NOT have ${comp} than ${schemaCode} characters`;
    },
    params: ({ schemaCode }) => (0, codegen_1$i._) `{limit: ${schemaCode}}`,
};
const def$o = {
    keyword: ["maxLength", "minLength"],
    type: "string",
    schemaType: "number",
    $data: true,
    error: error$g,
    code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1$i.operators.GT : codegen_1$i.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1$i._) `${data}.length` : (0, codegen_1$i._) `${(0, util_1$i.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1$i._) `${len} ${op} ${schemaCode}`);
    },
};
limitLength.default = def$o;

var pattern = {};

Object.defineProperty(pattern, "__esModule", { value: true });
const code_1$7 = requireCode();
const codegen_1$h = requireCodegen();
const error$f = {
    message: ({ schemaCode }) => (0, codegen_1$h.str) `must match pattern "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1$h._) `{pattern: ${schemaCode}}`,
};
const def$n = {
    keyword: "pattern",
    type: "string",
    schemaType: "string",
    $data: true,
    error: error$f,
    code(cxt) {
        const { data, $data, schema, schemaCode, it } = cxt;
        // TODO regexp should be wrapped in try/catchs
        const u = it.opts.unicodeRegExp ? "u" : "";
        const regExp = $data ? (0, codegen_1$h._) `(new RegExp(${schemaCode}, ${u}))` : (0, code_1$7.usePattern)(cxt, schema);
        cxt.fail$data((0, codegen_1$h._) `!${regExp}.test(${data})`);
    },
};
pattern.default = def$n;

var limitProperties = {};

Object.defineProperty(limitProperties, "__esModule", { value: true });
const codegen_1$g = requireCodegen();
const error$e = {
    message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1$g.str) `must NOT have ${comp} than ${schemaCode} properties`;
    },
    params: ({ schemaCode }) => (0, codegen_1$g._) `{limit: ${schemaCode}}`,
};
const def$m = {
    keyword: ["maxProperties", "minProperties"],
    type: "object",
    schemaType: "number",
    $data: true,
    error: error$e,
    code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1$g.operators.GT : codegen_1$g.operators.LT;
        cxt.fail$data((0, codegen_1$g._) `Object.keys(${data}).length ${op} ${schemaCode}`);
    },
};
limitProperties.default = def$m;

var required = {};

Object.defineProperty(required, "__esModule", { value: true });
const code_1$6 = requireCode();
const codegen_1$f = requireCodegen();
const util_1$h = util;
const error$d = {
    message: ({ params: { missingProperty } }) => (0, codegen_1$f.str) `must have required property '${missingProperty}'`,
    params: ({ params: { missingProperty } }) => (0, codegen_1$f._) `{missingProperty: ${missingProperty}}`,
};
const def$l = {
    keyword: "required",
    type: "object",
    schemaType: "array",
    $data: true,
    error: error$d,
    code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
            return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
            allErrorsMode();
        else
            exitOnErrorMode();
        if (opts.strictRequired) {
            const props = cxt.parentSchema.properties;
            const { definedProperties } = cxt.it;
            for (const requiredKey of schema) {
                if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === undefined && !definedProperties.has(requiredKey)) {
                    const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
                    const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
                    (0, util_1$h.checkStrictMode)(it, msg, it.opts.strictRequired);
                }
            }
        }
        function allErrorsMode() {
            if (useLoop || $data) {
                cxt.block$data(codegen_1$f.nil, loopAllRequired);
            }
            else {
                for (const prop of schema) {
                    (0, code_1$6.checkReportMissingProp)(cxt, prop);
                }
            }
        }
        function exitOnErrorMode() {
            const missing = gen.let("missing");
            if (useLoop || $data) {
                const valid = gen.let("valid", true);
                cxt.block$data(valid, () => loopUntilMissing(missing, valid));
                cxt.ok(valid);
            }
            else {
                gen.if((0, code_1$6.checkMissingProp)(cxt, schema, missing));
                (0, code_1$6.reportMissingProp)(cxt, missing);
                gen.else();
            }
        }
        function loopAllRequired() {
            gen.forOf("prop", schemaCode, (prop) => {
                cxt.setParams({ missingProperty: prop });
                gen.if((0, code_1$6.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
            });
        }
        function loopUntilMissing(missing, valid) {
            cxt.setParams({ missingProperty: missing });
            gen.forOf(missing, schemaCode, () => {
                gen.assign(valid, (0, code_1$6.propertyInData)(gen, data, missing, opts.ownProperties));
                gen.if((0, codegen_1$f.not)(valid), () => {
                    cxt.error();
                    gen.break();
                });
            }, codegen_1$f.nil);
        }
    },
};
required.default = def$l;

var limitItems = {};

Object.defineProperty(limitItems, "__esModule", { value: true });
const codegen_1$e = requireCodegen();
const error$c = {
    message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1$e.str) `must NOT have ${comp} than ${schemaCode} items`;
    },
    params: ({ schemaCode }) => (0, codegen_1$e._) `{limit: ${schemaCode}}`,
};
const def$k = {
    keyword: ["maxItems", "minItems"],
    type: "array",
    schemaType: "number",
    $data: true,
    error: error$c,
    code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1$e.operators.GT : codegen_1$e.operators.LT;
        cxt.fail$data((0, codegen_1$e._) `${data}.length ${op} ${schemaCode}`);
    },
};
limitItems.default = def$k;

var uniqueItems = {};

var equal$1 = {};

Object.defineProperty(equal$1, "__esModule", { value: true });
// https://github.com/ajv-validator/ajv/issues/889
const equal = fastDeepEqual;
equal.code = 'require("ajv/dist/runtime/equal").default';
equal$1.default = equal;

Object.defineProperty(uniqueItems, "__esModule", { value: true });
const dataType_1 = dataType;
const codegen_1$d = requireCodegen();
const util_1$g = util;
const equal_1$2 = equal$1;
const error$b = {
    message: ({ params: { i, j } }) => (0, codegen_1$d.str) `must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
    params: ({ params: { i, j } }) => (0, codegen_1$d._) `{i: ${i}, j: ${j}}`,
};
const def$j = {
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    $data: true,
    error: error$b,
    code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
            return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1$d._) `${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
            const i = gen.let("i", (0, codegen_1$d._) `${data}.length`);
            const j = gen.let("j");
            cxt.setParams({ i, j });
            gen.assign(valid, true);
            gen.if((0, codegen_1$d._) `${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
            return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
            const item = gen.name("item");
            const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
            const indices = gen.const("indices", (0, codegen_1$d._) `{}`);
            gen.for((0, codegen_1$d._) `;${i}--;`, () => {
                gen.let(item, (0, codegen_1$d._) `${data}[${i}]`);
                gen.if(wrongType, (0, codegen_1$d._) `continue`);
                if (itemTypes.length > 1)
                    gen.if((0, codegen_1$d._) `typeof ${item} == "string"`, (0, codegen_1$d._) `${item} += "_"`);
                gen
                    .if((0, codegen_1$d._) `typeof ${indices}[${item}] == "number"`, () => {
                    gen.assign(j, (0, codegen_1$d._) `${indices}[${item}]`);
                    cxt.error();
                    gen.assign(valid, false).break();
                })
                    .code((0, codegen_1$d._) `${indices}[${item}] = ${i}`);
            });
        }
        function loopN2(i, j) {
            const eql = (0, util_1$g.useFunc)(gen, equal_1$2.default);
            const outer = gen.name("outer");
            gen.label(outer).for((0, codegen_1$d._) `;${i}--;`, () => gen.for((0, codegen_1$d._) `${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1$d._) `${eql}(${data}[${i}], ${data}[${j}])`, () => {
                cxt.error();
                gen.assign(valid, false).break(outer);
            })));
        }
    },
};
uniqueItems.default = def$j;

var _const = {};

Object.defineProperty(_const, "__esModule", { value: true });
const codegen_1$c = requireCodegen();
const util_1$f = util;
const equal_1$1 = equal$1;
const error$a = {
    message: "must be equal to constant",
    params: ({ schemaCode }) => (0, codegen_1$c._) `{allowedValue: ${schemaCode}}`,
};
const def$i = {
    keyword: "const",
    $data: true,
    error: error$a,
    code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || (schema && typeof schema == "object")) {
            cxt.fail$data((0, codegen_1$c._) `!${(0, util_1$f.useFunc)(gen, equal_1$1.default)}(${data}, ${schemaCode})`);
        }
        else {
            cxt.fail((0, codegen_1$c._) `${schema} !== ${data}`);
        }
    },
};
_const.default = def$i;

var _enum = {};

Object.defineProperty(_enum, "__esModule", { value: true });
const codegen_1$b = requireCodegen();
const util_1$e = util;
const equal_1 = equal$1;
const error$9 = {
    message: "must be equal to one of the allowed values",
    params: ({ schemaCode }) => (0, codegen_1$b._) `{allowedValues: ${schemaCode}}`,
};
const def$h = {
    keyword: "enum",
    schemaType: "array",
    $data: true,
    error: error$9,
    code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
            throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => (eql !== null && eql !== void 0 ? eql : (eql = (0, util_1$e.useFunc)(gen, equal_1.default)));
        let valid;
        if (useLoop || $data) {
            valid = gen.let("valid");
            cxt.block$data(valid, loopEnum);
        }
        else {
            /* istanbul ignore if */
            if (!Array.isArray(schema))
                throw new Error("ajv implementation error");
            const vSchema = gen.const("vSchema", schemaCode);
            valid = (0, codegen_1$b.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
            gen.assign(valid, false);
            gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1$b._) `${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
            const sch = schema[i];
            return typeof sch === "object" && sch !== null
                ? (0, codegen_1$b._) `${getEql()}(${data}, ${vSchema}[${i}])`
                : (0, codegen_1$b._) `${data} === ${sch}`;
        }
    },
};
_enum.default = def$h;

Object.defineProperty(validation$1, "__esModule", { value: true });
const limitNumber_1 = limitNumber;
const multipleOf_1 = multipleOf;
const limitLength_1 = limitLength;
const pattern_1 = pattern;
const limitProperties_1 = limitProperties;
const required_1 = required;
const limitItems_1 = limitItems;
const uniqueItems_1 = uniqueItems;
const const_1 = _const;
const enum_1 = _enum;
const validation = [
    // number
    limitNumber_1.default,
    multipleOf_1.default,
    // string
    limitLength_1.default,
    pattern_1.default,
    // object
    limitProperties_1.default,
    required_1.default,
    // array
    limitItems_1.default,
    uniqueItems_1.default,
    // any
    { keyword: "type", schemaType: ["string", "array"] },
    { keyword: "nullable", schemaType: "boolean" },
    const_1.default,
    enum_1.default,
];
validation$1.default = validation;

var applicator = {};

var additionalItems = {};

Object.defineProperty(additionalItems, "__esModule", { value: true });
additionalItems.validateAdditionalItems = void 0;
const codegen_1$a = requireCodegen();
const util_1$d = util;
const error$8 = {
    message: ({ params: { len } }) => (0, codegen_1$a.str) `must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1$a._) `{limit: ${len}}`,
};
const def$g = {
    keyword: "additionalItems",
    type: "array",
    schemaType: ["boolean", "object"],
    before: "uniqueItems",
    error: error$8,
    code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
            (0, util_1$d.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
            return;
        }
        validateAdditionalItems(cxt, items);
    },
};
function validateAdditionalItems(cxt, items) {
    const { gen, schema, data, keyword, it } = cxt;
    it.items = true;
    const len = gen.const("len", (0, codegen_1$a._) `${data}.length`);
    if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1$a._) `${len} <= ${items.length}`);
    }
    else if (typeof schema == "object" && !(0, util_1$d.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1$a._) `${len} <= ${items.length}`); // TODO var
        gen.if((0, codegen_1$a.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
    }
    function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
            cxt.subschema({ keyword, dataProp: i, dataPropType: util_1$d.Type.Num }, valid);
            if (!it.allErrors)
                gen.if((0, codegen_1$a.not)(valid), () => gen.break());
        });
    }
}
additionalItems.validateAdditionalItems = validateAdditionalItems;
additionalItems.default = def$g;

var prefixItems = {};

var items = {};

Object.defineProperty(items, "__esModule", { value: true });
items.validateTuple = void 0;
const codegen_1$9 = requireCodegen();
const util_1$c = util;
const code_1$5 = requireCode();
const def$f = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "array", "boolean"],
    before: "uniqueItems",
    code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
            return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1$c.alwaysValidSchema)(it, schema))
            return;
        cxt.ok((0, code_1$5.validateArray)(cxt));
    },
};
function validateTuple(cxt, extraItems, schArr = cxt.schema) {
    const { gen, parentSchema, data, keyword, it } = cxt;
    checkStrictTuple(parentSchema);
    if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1$c.mergeEvaluated.items(gen, schArr.length, it.items);
    }
    const valid = gen.name("valid");
    const len = gen.const("len", (0, codegen_1$9._) `${data}.length`);
    schArr.forEach((sch, i) => {
        if ((0, util_1$c.alwaysValidSchema)(it, sch))
            return;
        gen.if((0, codegen_1$9._) `${len} > ${i}`, () => cxt.subschema({
            keyword,
            schemaProp: i,
            dataProp: i,
        }, valid));
        cxt.ok(valid);
    });
    function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
            const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
            (0, util_1$c.checkStrictMode)(it, msg, opts.strictTuples);
        }
    }
}
items.validateTuple = validateTuple;
items.default = def$f;

Object.defineProperty(prefixItems, "__esModule", { value: true });
const items_1$1 = items;
const def$e = {
    keyword: "prefixItems",
    type: "array",
    schemaType: ["array"],
    before: "uniqueItems",
    code: (cxt) => (0, items_1$1.validateTuple)(cxt, "items"),
};
prefixItems.default = def$e;

var items2020 = {};

Object.defineProperty(items2020, "__esModule", { value: true });
const codegen_1$8 = requireCodegen();
const util_1$b = util;
const code_1$4 = requireCode();
const additionalItems_1$1 = additionalItems;
const error$7 = {
    message: ({ params: { len } }) => (0, codegen_1$8.str) `must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1$8._) `{limit: ${len}}`,
};
const def$d = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    error: error$7,
    code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1$b.alwaysValidSchema)(it, schema))
            return;
        if (prefixItems)
            (0, additionalItems_1$1.validateAdditionalItems)(cxt, prefixItems);
        else
            cxt.ok((0, code_1$4.validateArray)(cxt));
    },
};
items2020.default = def$d;

var contains = {};

Object.defineProperty(contains, "__esModule", { value: true });
const codegen_1$7 = requireCodegen();
const util_1$a = util;
const error$6 = {
    message: ({ params: { min, max } }) => max === undefined
        ? (0, codegen_1$7.str) `must contain at least ${min} valid item(s)`
        : (0, codegen_1$7.str) `must contain at least ${min} and no more than ${max} valid item(s)`,
    params: ({ params: { min, max } }) => max === undefined ? (0, codegen_1$7._) `{minContains: ${min}}` : (0, codegen_1$7._) `{minContains: ${min}, maxContains: ${max}}`,
};
const def$c = {
    keyword: "contains",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    trackErrors: true,
    error: error$6,
    code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
            min = minContains === undefined ? 1 : minContains;
            max = maxContains;
        }
        else {
            min = 1;
        }
        const len = gen.const("len", (0, codegen_1$7._) `${data}.length`);
        cxt.setParams({ min, max });
        if (max === undefined && min === 0) {
            (0, util_1$a.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
            return;
        }
        if (max !== undefined && min > max) {
            (0, util_1$a.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
            cxt.fail();
            return;
        }
        if ((0, util_1$a.alwaysValidSchema)(it, schema)) {
            let cond = (0, codegen_1$7._) `${len} >= ${min}`;
            if (max !== undefined)
                cond = (0, codegen_1$7._) `${cond} && ${len} <= ${max}`;
            cxt.pass(cond);
            return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === undefined && min === 1) {
            validateItems(valid, () => gen.if(valid, () => gen.break()));
        }
        else if (min === 0) {
            gen.let(valid, true);
            if (max !== undefined)
                gen.if((0, codegen_1$7._) `${data}.length > 0`, validateItemsWithCount);
        }
        else {
            gen.let(valid, false);
            validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
            const schValid = gen.name("_valid");
            const count = gen.let("count", 0);
            validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
            gen.forRange("i", 0, len, (i) => {
                cxt.subschema({
                    keyword: "contains",
                    dataProp: i,
                    dataPropType: util_1$a.Type.Num,
                    compositeRule: true,
                }, _valid);
                block();
            });
        }
        function checkLimits(count) {
            gen.code((0, codegen_1$7._) `${count}++`);
            if (max === undefined) {
                gen.if((0, codegen_1$7._) `${count} >= ${min}`, () => gen.assign(valid, true).break());
            }
            else {
                gen.if((0, codegen_1$7._) `${count} > ${max}`, () => gen.assign(valid, false).break());
                if (min === 1)
                    gen.assign(valid, true);
                else
                    gen.if((0, codegen_1$7._) `${count} >= ${min}`, () => gen.assign(valid, true));
            }
        }
    },
};
contains.default = def$c;

var dependencies = {};

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
	const codegen_1 = requireCodegen();
	const util_1 = util;
	const code_1 = requireCode();
	exports.error = {
	    message: ({ params: { property, depsCount, deps } }) => {
	        const property_ies = depsCount === 1 ? "property" : "properties";
	        return (0, codegen_1.str) `must have ${property_ies} ${deps} when property ${property} is present`;
	    },
	    params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._) `{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`, // TODO change to reference
	};
	const def = {
	    keyword: "dependencies",
	    type: "object",
	    schemaType: "object",
	    error: exports.error,
	    code(cxt) {
	        const [propDeps, schDeps] = splitDependencies(cxt);
	        validatePropertyDeps(cxt, propDeps);
	        validateSchemaDeps(cxt, schDeps);
	    },
	};
	function splitDependencies({ schema }) {
	    const propertyDeps = {};
	    const schemaDeps = {};
	    for (const key in schema) {
	        if (key === "__proto__")
	            continue;
	        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
	        deps[key] = schema[key];
	    }
	    return [propertyDeps, schemaDeps];
	}
	function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
	    const { gen, data, it } = cxt;
	    if (Object.keys(propertyDeps).length === 0)
	        return;
	    const missing = gen.let("missing");
	    for (const prop in propertyDeps) {
	        const deps = propertyDeps[prop];
	        if (deps.length === 0)
	            continue;
	        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
	        cxt.setParams({
	            property: prop,
	            depsCount: deps.length,
	            deps: deps.join(", "),
	        });
	        if (it.allErrors) {
	            gen.if(hasProperty, () => {
	                for (const depProp of deps) {
	                    (0, code_1.checkReportMissingProp)(cxt, depProp);
	                }
	            });
	        }
	        else {
	            gen.if((0, codegen_1._) `${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
	            (0, code_1.reportMissingProp)(cxt, missing);
	            gen.else();
	        }
	    }
	}
	exports.validatePropertyDeps = validatePropertyDeps;
	function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
	    const { gen, data, keyword, it } = cxt;
	    const valid = gen.name("valid");
	    for (const prop in schemaDeps) {
	        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
	            continue;
	        gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties), () => {
	            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
	            cxt.mergeValidEvaluated(schCxt, valid);
	        }, () => gen.var(valid, true) // TODO var
	        );
	        cxt.ok(valid);
	    }
	}
	exports.validateSchemaDeps = validateSchemaDeps;
	exports.default = def;
	
} (dependencies));

var propertyNames = {};

Object.defineProperty(propertyNames, "__esModule", { value: true });
const codegen_1$6 = requireCodegen();
const util_1$9 = util;
const error$5 = {
    message: "property name must be valid",
    params: ({ params }) => (0, codegen_1$6._) `{propertyName: ${params.propertyName}}`,
};
const def$b = {
    keyword: "propertyNames",
    type: "object",
    schemaType: ["object", "boolean"],
    error: error$5,
    code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1$9.alwaysValidSchema)(it, schema))
            return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
            cxt.setParams({ propertyName: key });
            cxt.subschema({
                keyword: "propertyNames",
                data: key,
                dataTypes: ["string"],
                propertyName: key,
                compositeRule: true,
            }, valid);
            gen.if((0, codegen_1$6.not)(valid), () => {
                cxt.error(true);
                if (!it.allErrors)
                    gen.break();
            });
        });
        cxt.ok(valid);
    },
};
propertyNames.default = def$b;

var additionalProperties = {};

Object.defineProperty(additionalProperties, "__esModule", { value: true });
const code_1$3 = requireCode();
const codegen_1$5 = requireCodegen();
const names_1 = requireNames();
const util_1$8 = util;
const error$4 = {
    message: "must NOT have additional properties",
    params: ({ params }) => (0, codegen_1$5._) `{additionalProperty: ${params.additionalProperty}}`,
};
const def$a = {
    keyword: "additionalProperties",
    type: ["object"],
    schemaType: ["boolean", "object"],
    allowUndefined: true,
    trackErrors: true,
    error: error$4,
    code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        /* istanbul ignore if */
        if (!errsCount)
            throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1$8.alwaysValidSchema)(it, schema))
            return;
        const props = (0, code_1$3.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1$3.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1$5._) `${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
            gen.forIn("key", data, (key) => {
                if (!props.length && !patProps.length)
                    additionalPropertyCode(key);
                else
                    gen.if(isAdditional(key), () => additionalPropertyCode(key));
            });
        }
        function isAdditional(key) {
            let definedProp;
            if (props.length > 8) {
                // TODO maybe an option instead of hard-coded 8?
                const propsSchema = (0, util_1$8.schemaRefOrVal)(it, parentSchema.properties, "properties");
                definedProp = (0, code_1$3.isOwnProperty)(gen, propsSchema, key);
            }
            else if (props.length) {
                definedProp = (0, codegen_1$5.or)(...props.map((p) => (0, codegen_1$5._) `${key} === ${p}`));
            }
            else {
                definedProp = codegen_1$5.nil;
            }
            if (patProps.length) {
                definedProp = (0, codegen_1$5.or)(definedProp, ...patProps.map((p) => (0, codegen_1$5._) `${(0, code_1$3.usePattern)(cxt, p)}.test(${key})`));
            }
            return (0, codegen_1$5.not)(definedProp);
        }
        function deleteAdditional(key) {
            gen.code((0, codegen_1$5._) `delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
            if (opts.removeAdditional === "all" || (opts.removeAdditional && schema === false)) {
                deleteAdditional(key);
                return;
            }
            if (schema === false) {
                cxt.setParams({ additionalProperty: key });
                cxt.error();
                if (!allErrors)
                    gen.break();
                return;
            }
            if (typeof schema == "object" && !(0, util_1$8.alwaysValidSchema)(it, schema)) {
                const valid = gen.name("valid");
                if (opts.removeAdditional === "failing") {
                    applyAdditionalSchema(key, valid, false);
                    gen.if((0, codegen_1$5.not)(valid), () => {
                        cxt.reset();
                        deleteAdditional(key);
                    });
                }
                else {
                    applyAdditionalSchema(key, valid);
                    if (!allErrors)
                        gen.if((0, codegen_1$5.not)(valid), () => gen.break());
                }
            }
        }
        function applyAdditionalSchema(key, valid, errors) {
            const subschema = {
                keyword: "additionalProperties",
                dataProp: key,
                dataPropType: util_1$8.Type.Str,
            };
            if (errors === false) {
                Object.assign(subschema, {
                    compositeRule: true,
                    createErrors: false,
                    allErrors: false,
                });
            }
            cxt.subschema(subschema, valid);
        }
    },
};
additionalProperties.default = def$a;

var properties$1 = {};

Object.defineProperty(properties$1, "__esModule", { value: true });
const validate_1 = requireValidate();
const code_1$2 = requireCode();
const util_1$7 = util;
const additionalProperties_1$1 = additionalProperties;
const def$9 = {
    keyword: "properties",
    type: "object",
    schemaType: "object",
    code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === undefined) {
            additionalProperties_1$1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1$1.default, "additionalProperties"));
        }
        const allProps = (0, code_1$2.allSchemaProperties)(schema);
        for (const prop of allProps) {
            it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
            it.props = util_1$7.mergeEvaluated.props(gen, (0, util_1$7.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1$7.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
            return;
        const valid = gen.name("valid");
        for (const prop of properties) {
            if (hasDefault(prop)) {
                applyPropertySchema(prop);
            }
            else {
                gen.if((0, code_1$2.propertyInData)(gen, data, prop, it.opts.ownProperties));
                applyPropertySchema(prop);
                if (!it.allErrors)
                    gen.else().var(valid, true);
                gen.endIf();
            }
            cxt.it.definedProperties.add(prop);
            cxt.ok(valid);
        }
        function hasDefault(prop) {
            return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== undefined;
        }
        function applyPropertySchema(prop) {
            cxt.subschema({
                keyword: "properties",
                schemaProp: prop,
                dataProp: prop,
            }, valid);
        }
    },
};
properties$1.default = def$9;

var patternProperties = {};

Object.defineProperty(patternProperties, "__esModule", { value: true });
const code_1$1 = requireCode();
const codegen_1$4 = requireCodegen();
const util_1$6 = util;
const util_2 = util;
const def$8 = {
    keyword: "patternProperties",
    type: "object",
    schemaType: "object",
    code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1$1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1$6.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 ||
            (alwaysValidPatterns.length === patterns.length &&
                (!it.opts.unevaluated || it.props === true))) {
            return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1$4.Name)) {
            it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
            for (const pat of patterns) {
                if (checkProperties)
                    checkMatchingProperties(pat);
                if (it.allErrors) {
                    validateProperties(pat);
                }
                else {
                    gen.var(valid, true); // TODO var
                    validateProperties(pat);
                    gen.if(valid);
                }
            }
        }
        function checkMatchingProperties(pat) {
            for (const prop in checkProperties) {
                if (new RegExp(pat).test(prop)) {
                    (0, util_1$6.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
                }
            }
        }
        function validateProperties(pat) {
            gen.forIn("key", data, (key) => {
                gen.if((0, codegen_1$4._) `${(0, code_1$1.usePattern)(cxt, pat)}.test(${key})`, () => {
                    const alwaysValid = alwaysValidPatterns.includes(pat);
                    if (!alwaysValid) {
                        cxt.subschema({
                            keyword: "patternProperties",
                            schemaProp: pat,
                            dataProp: key,
                            dataPropType: util_2.Type.Str,
                        }, valid);
                    }
                    if (it.opts.unevaluated && props !== true) {
                        gen.assign((0, codegen_1$4._) `${props}[${key}]`, true);
                    }
                    else if (!alwaysValid && !it.allErrors) {
                        // can short-circuit if `unevaluatedProperties` is not supported (opts.next === false)
                        // or if all properties were evaluated (props === true)
                        gen.if((0, codegen_1$4.not)(valid), () => gen.break());
                    }
                });
            });
        }
    },
};
patternProperties.default = def$8;

var not = {};

Object.defineProperty(not, "__esModule", { value: true });
const util_1$5 = util;
const def$7 = {
    keyword: "not",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1$5.alwaysValidSchema)(it, schema)) {
            cxt.fail();
            return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
            keyword: "not",
            compositeRule: true,
            createErrors: false,
            allErrors: false,
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
    },
    error: { message: "must NOT be valid" },
};
not.default = def$7;

var anyOf = {};

Object.defineProperty(anyOf, "__esModule", { value: true });
const code_1 = requireCode();
const def$6 = {
    keyword: "anyOf",
    schemaType: "array",
    trackErrors: true,
    code: code_1.validateUnion,
    error: { message: "must match a schema in anyOf" },
};
anyOf.default = def$6;

var oneOf = {};

Object.defineProperty(oneOf, "__esModule", { value: true });
const codegen_1$3 = requireCodegen();
const util_1$4 = util;
const error$3 = {
    message: "must match exactly one schema in oneOf",
    params: ({ params }) => (0, codegen_1$3._) `{passingSchemas: ${params.passing}}`,
};
const def$5 = {
    keyword: "oneOf",
    schemaType: "array",
    trackErrors: true,
    error: error$3,
    code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        /* istanbul ignore if */
        if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
            return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        // TODO possibly fail straight away (with warning or exception) if there are two empty always valid schemas
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
            schArr.forEach((sch, i) => {
                let schCxt;
                if ((0, util_1$4.alwaysValidSchema)(it, sch)) {
                    gen.var(schValid, true);
                }
                else {
                    schCxt = cxt.subschema({
                        keyword: "oneOf",
                        schemaProp: i,
                        compositeRule: true,
                    }, schValid);
                }
                if (i > 0) {
                    gen
                        .if((0, codegen_1$3._) `${schValid} && ${valid}`)
                        .assign(valid, false)
                        .assign(passing, (0, codegen_1$3._) `[${passing}, ${i}]`)
                        .else();
                }
                gen.if(schValid, () => {
                    gen.assign(valid, true);
                    gen.assign(passing, i);
                    if (schCxt)
                        cxt.mergeEvaluated(schCxt, codegen_1$3.Name);
                });
            });
        }
    },
};
oneOf.default = def$5;

var allOf = {};

Object.defineProperty(allOf, "__esModule", { value: true });
const util_1$3 = util;
const def$4 = {
    keyword: "allOf",
    schemaType: "array",
    code(cxt) {
        const { gen, schema, it } = cxt;
        /* istanbul ignore if */
        if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
            if ((0, util_1$3.alwaysValidSchema)(it, sch))
                return;
            const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
            cxt.ok(valid);
            cxt.mergeEvaluated(schCxt);
        });
    },
};
allOf.default = def$4;

var _if = {};

Object.defineProperty(_if, "__esModule", { value: true });
const codegen_1$2 = requireCodegen();
const util_1$2 = util;
const error$2 = {
    message: ({ params }) => (0, codegen_1$2.str) `must match "${params.ifClause}" schema`,
    params: ({ params }) => (0, codegen_1$2._) `{failingKeyword: ${params.ifClause}}`,
};
const def$3 = {
    keyword: "if",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    error: error$2,
    code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === undefined && parentSchema.else === undefined) {
            (0, util_1$2.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
            return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
            const ifClause = gen.let("ifClause");
            cxt.setParams({ ifClause });
            gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        }
        else if (hasThen) {
            gen.if(schValid, validateClause("then"));
        }
        else {
            gen.if((0, codegen_1$2.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
            const schCxt = cxt.subschema({
                keyword: "if",
                compositeRule: true,
                createErrors: false,
                allErrors: false,
            }, schValid);
            cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
            return () => {
                const schCxt = cxt.subschema({ keyword }, schValid);
                gen.assign(valid, schValid);
                cxt.mergeValidEvaluated(schCxt, valid);
                if (ifClause)
                    gen.assign(ifClause, (0, codegen_1$2._) `${keyword}`);
                else
                    cxt.setParams({ ifClause: keyword });
            };
        }
    },
};
function hasSchema(it, keyword) {
    const schema = it.schema[keyword];
    return schema !== undefined && !(0, util_1$2.alwaysValidSchema)(it, schema);
}
_if.default = def$3;

var thenElse = {};

Object.defineProperty(thenElse, "__esModule", { value: true });
const util_1$1 = util;
const def$2 = {
    keyword: ["then", "else"],
    schemaType: ["object", "boolean"],
    code({ keyword, parentSchema, it }) {
        if (parentSchema.if === undefined)
            (0, util_1$1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
    },
};
thenElse.default = def$2;

Object.defineProperty(applicator, "__esModule", { value: true });
const additionalItems_1 = additionalItems;
const prefixItems_1 = prefixItems;
const items_1 = items;
const items2020_1 = items2020;
const contains_1 = contains;
const dependencies_1 = dependencies;
const propertyNames_1 = propertyNames;
const additionalProperties_1 = additionalProperties;
const properties_1 = properties$1;
const patternProperties_1 = patternProperties;
const not_1 = not;
const anyOf_1 = anyOf;
const oneOf_1 = oneOf;
const allOf_1 = allOf;
const if_1 = _if;
const thenElse_1 = thenElse;
function getApplicator(draft2020 = false) {
    const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default,
    ];
    // array
    if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
    else
        applicator.push(additionalItems_1.default, items_1.default);
    applicator.push(contains_1.default);
    return applicator;
}
applicator.default = getApplicator;

var format$2 = {};

var format$1 = {};

Object.defineProperty(format$1, "__esModule", { value: true });
const codegen_1$1 = requireCodegen();
const error$1 = {
    message: ({ schemaCode }) => (0, codegen_1$1.str) `must match format "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1$1._) `{format: ${schemaCode}}`,
};
const def$1 = {
    keyword: "format",
    type: ["number", "string"],
    schemaType: "string",
    $data: true,
    error: error$1,
    code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self } = it;
        if (!opts.validateFormats)
            return;
        if ($data)
            validate$DataFormat();
        else
            validateFormat();
        function validate$DataFormat() {
            const fmts = gen.scopeValue("formats", {
                ref: self.formats,
                code: opts.code.formats,
            });
            const fDef = gen.const("fDef", (0, codegen_1$1._) `${fmts}[${schemaCode}]`);
            const fType = gen.let("fType");
            const format = gen.let("format");
            // TODO simplify
            gen.if((0, codegen_1$1._) `typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1$1._) `${fDef}.type || "string"`).assign(format, (0, codegen_1$1._) `${fDef}.validate`), () => gen.assign(fType, (0, codegen_1$1._) `"string"`).assign(format, fDef));
            cxt.fail$data((0, codegen_1$1.or)(unknownFmt(), invalidFmt()));
            function unknownFmt() {
                if (opts.strictSchema === false)
                    return codegen_1$1.nil;
                return (0, codegen_1$1._) `${schemaCode} && !${format}`;
            }
            function invalidFmt() {
                const callFormat = schemaEnv.$async
                    ? (0, codegen_1$1._) `(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))`
                    : (0, codegen_1$1._) `${format}(${data})`;
                const validData = (0, codegen_1$1._) `(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
                return (0, codegen_1$1._) `${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
            }
        }
        function validateFormat() {
            const formatDef = self.formats[schema];
            if (!formatDef) {
                unknownFormat();
                return;
            }
            if (formatDef === true)
                return;
            const [fmtType, format, fmtRef] = getFormat(formatDef);
            if (fmtType === ruleType)
                cxt.pass(validCondition());
            function unknownFormat() {
                if (opts.strictSchema === false) {
                    self.logger.warn(unknownMsg());
                    return;
                }
                throw new Error(unknownMsg());
                function unknownMsg() {
                    return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
                }
            }
            function getFormat(fmtDef) {
                const code = fmtDef instanceof RegExp
                    ? (0, codegen_1$1.regexpCode)(fmtDef)
                    : opts.code.formats
                        ? (0, codegen_1$1._) `${opts.code.formats}${(0, codegen_1$1.getProperty)(schema)}`
                        : undefined;
                const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
                if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
                    return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1$1._) `${fmt}.validate`];
                }
                return ["string", fmtDef, fmt];
            }
            function validCondition() {
                if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
                    if (!schemaEnv.$async)
                        throw new Error("async format in sync schema");
                    return (0, codegen_1$1._) `await ${fmtRef}(${data})`;
                }
                return typeof format == "function" ? (0, codegen_1$1._) `${fmtRef}(${data})` : (0, codegen_1$1._) `${fmtRef}.test(${data})`;
            }
        }
    },
};
format$1.default = def$1;

Object.defineProperty(format$2, "__esModule", { value: true });
const format_1$1 = format$1;
const format = [format_1$1.default];
format$2.default = format;

var metadata = {};

Object.defineProperty(metadata, "__esModule", { value: true });
metadata.contentVocabulary = metadata.metadataVocabulary = void 0;
metadata.metadataVocabulary = [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples",
];
metadata.contentVocabulary = [
    "contentMediaType",
    "contentEncoding",
    "contentSchema",
];

Object.defineProperty(draft7, "__esModule", { value: true });
const core_1 = core$2;
const validation_1 = validation$1;
const applicator_1 = applicator;
const format_1 = format$2;
const metadata_1 = metadata;
const draft7Vocabularies = [
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary,
];
draft7.default = draft7Vocabularies;

var discriminator = {};

var types = {};

Object.defineProperty(types, "__esModule", { value: true });
types.DiscrError = void 0;
var DiscrError;
(function (DiscrError) {
    DiscrError["Tag"] = "tag";
    DiscrError["Mapping"] = "mapping";
})(DiscrError || (types.DiscrError = DiscrError = {}));

Object.defineProperty(discriminator, "__esModule", { value: true });
const codegen_1 = requireCodegen();
const types_1 = types;
const compile_1 = compile;
const ref_error_1 = requireRef_error();
const util_1 = util;
const error = {
    message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag
        ? `tag "${tagName}" must be string`
        : `value of tag "${tagName}" must be in oneOf`,
    params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._) `{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`,
};
const def = {
    keyword: "discriminator",
    type: "object",
    schemaType: "object",
    error,
    code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
            throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
            throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
            throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
            throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._) `${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._) `typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
            const mapping = getMapping();
            gen.if(false);
            for (const tagValue in mapping) {
                gen.elseIf((0, codegen_1._) `${tag} === ${tagValue}`);
                gen.assign(valid, applyTagSchema(mapping[tagValue]));
            }
            gen.else();
            cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
            gen.endIf();
        }
        function applyTagSchema(schemaProp) {
            const _valid = gen.name("valid");
            const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
            cxt.mergeEvaluated(schCxt, codegen_1.Name);
            return _valid;
        }
        function getMapping() {
            var _a;
            const oneOfMapping = {};
            const topRequired = hasRequired(parentSchema);
            let tagRequired = true;
            for (let i = 0; i < oneOf.length; i++) {
                let sch = oneOf[i];
                if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
                    const ref = sch.$ref;
                    sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
                    if (sch instanceof compile_1.SchemaEnv)
                        sch = sch.schema;
                    if (sch === undefined)
                        throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
                }
                const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
                if (typeof propSch != "object") {
                    throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
                }
                tagRequired = tagRequired && (topRequired || hasRequired(sch));
                addMappings(propSch, i);
            }
            if (!tagRequired)
                throw new Error(`discriminator: "${tagName}" must be required`);
            return oneOfMapping;
            function hasRequired({ required }) {
                return Array.isArray(required) && required.includes(tagName);
            }
            function addMappings(sch, i) {
                if (sch.const) {
                    addMapping(sch.const, i);
                }
                else if (sch.enum) {
                    for (const tagValue of sch.enum) {
                        addMapping(tagValue, i);
                    }
                }
                else {
                    throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
                }
            }
            function addMapping(tagValue, i) {
                if (typeof tagValue != "string" || tagValue in oneOfMapping) {
                    throw new Error(`discriminator: "${tagName}" values must be unique strings`);
                }
                oneOfMapping[tagValue] = i;
            }
        }
    },
};
discriminator.default = def;

var $schema = "http://json-schema.org/draft-07/schema#";
var $id = "http://json-schema.org/draft-07/schema#";
var title = "Core schema meta-schema";
var definitions = {
	schemaArray: {
		type: "array",
		minItems: 1,
		items: {
			$ref: "#"
		}
	},
	nonNegativeInteger: {
		type: "integer",
		minimum: 0
	},
	nonNegativeIntegerDefault0: {
		allOf: [
			{
				$ref: "#/definitions/nonNegativeInteger"
			},
			{
				"default": 0
			}
		]
	},
	simpleTypes: {
		"enum": [
			"array",
			"boolean",
			"integer",
			"null",
			"number",
			"object",
			"string"
		]
	},
	stringArray: {
		type: "array",
		items: {
			type: "string"
		},
		uniqueItems: true,
		"default": [
		]
	}
};
var type = [
	"object",
	"boolean"
];
var properties = {
	$id: {
		type: "string",
		format: "uri-reference"
	},
	$schema: {
		type: "string",
		format: "uri"
	},
	$ref: {
		type: "string",
		format: "uri-reference"
	},
	$comment: {
		type: "string"
	},
	title: {
		type: "string"
	},
	description: {
		type: "string"
	},
	"default": true,
	readOnly: {
		type: "boolean",
		"default": false
	},
	examples: {
		type: "array",
		items: true
	},
	multipleOf: {
		type: "number",
		exclusiveMinimum: 0
	},
	maximum: {
		type: "number"
	},
	exclusiveMaximum: {
		type: "number"
	},
	minimum: {
		type: "number"
	},
	exclusiveMinimum: {
		type: "number"
	},
	maxLength: {
		$ref: "#/definitions/nonNegativeInteger"
	},
	minLength: {
		$ref: "#/definitions/nonNegativeIntegerDefault0"
	},
	pattern: {
		type: "string",
		format: "regex"
	},
	additionalItems: {
		$ref: "#"
	},
	items: {
		anyOf: [
			{
				$ref: "#"
			},
			{
				$ref: "#/definitions/schemaArray"
			}
		],
		"default": true
	},
	maxItems: {
		$ref: "#/definitions/nonNegativeInteger"
	},
	minItems: {
		$ref: "#/definitions/nonNegativeIntegerDefault0"
	},
	uniqueItems: {
		type: "boolean",
		"default": false
	},
	contains: {
		$ref: "#"
	},
	maxProperties: {
		$ref: "#/definitions/nonNegativeInteger"
	},
	minProperties: {
		$ref: "#/definitions/nonNegativeIntegerDefault0"
	},
	required: {
		$ref: "#/definitions/stringArray"
	},
	additionalProperties: {
		$ref: "#"
	},
	definitions: {
		type: "object",
		additionalProperties: {
			$ref: "#"
		},
		"default": {
		}
	},
	properties: {
		type: "object",
		additionalProperties: {
			$ref: "#"
		},
		"default": {
		}
	},
	patternProperties: {
		type: "object",
		additionalProperties: {
			$ref: "#"
		},
		propertyNames: {
			format: "regex"
		},
		"default": {
		}
	},
	dependencies: {
		type: "object",
		additionalProperties: {
			anyOf: [
				{
					$ref: "#"
				},
				{
					$ref: "#/definitions/stringArray"
				}
			]
		}
	},
	propertyNames: {
		$ref: "#"
	},
	"const": true,
	"enum": {
		type: "array",
		items: true,
		minItems: 1,
		uniqueItems: true
	},
	type: {
		anyOf: [
			{
				$ref: "#/definitions/simpleTypes"
			},
			{
				type: "array",
				items: {
					$ref: "#/definitions/simpleTypes"
				},
				minItems: 1,
				uniqueItems: true
			}
		]
	},
	format: {
		type: "string"
	},
	contentMediaType: {
		type: "string"
	},
	contentEncoding: {
		type: "string"
	},
	"if": {
		$ref: "#"
	},
	then: {
		$ref: "#"
	},
	"else": {
		$ref: "#"
	},
	allOf: {
		$ref: "#/definitions/schemaArray"
	},
	anyOf: {
		$ref: "#/definitions/schemaArray"
	},
	oneOf: {
		$ref: "#/definitions/schemaArray"
	},
	not: {
		$ref: "#"
	}
};
var require$$3 = {
	$schema: $schema,
	$id: $id,
	title: title,
	definitions: definitions,
	type: type,
	properties: properties,
	"default": true
};

(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
	const core_1 = core$3;
	const draft7_1 = draft7;
	const discriminator_1 = discriminator;
	const draft7MetaSchema = require$$3;
	const META_SUPPORT_DATA = ["/properties"];
	const META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
	class Ajv extends core_1.default {
	    _addVocabularies() {
	        super._addVocabularies();
	        draft7_1.default.forEach((v) => this.addVocabulary(v));
	        if (this.opts.discriminator)
	            this.addKeyword(discriminator_1.default);
	    }
	    _addDefaultMetaSchema() {
	        super._addDefaultMetaSchema();
	        if (!this.opts.meta)
	            return;
	        const metaSchema = this.opts.$data
	            ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA)
	            : draft7MetaSchema;
	        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
	        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
	    }
	    defaultMeta() {
	        return (this.opts.defaultMeta =
	            super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined));
	    }
	}
	exports.Ajv = Ajv;
	module.exports = exports = Ajv;
	module.exports.Ajv = Ajv;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = Ajv;
	var validate_1 = requireValidate();
	Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function () { return validate_1.KeywordCxt; } });
	var codegen_1 = requireCodegen();
	Object.defineProperty(exports, "_", { enumerable: true, get: function () { return codegen_1._; } });
	Object.defineProperty(exports, "str", { enumerable: true, get: function () { return codegen_1.str; } });
	Object.defineProperty(exports, "stringify", { enumerable: true, get: function () { return codegen_1.stringify; } });
	Object.defineProperty(exports, "nil", { enumerable: true, get: function () { return codegen_1.nil; } });
	Object.defineProperty(exports, "Name", { enumerable: true, get: function () { return codegen_1.Name; } });
	Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function () { return codegen_1.CodeGen; } });
	var validation_error_1 = requireValidation_error();
	Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return validation_error_1.default; } });
	var ref_error_1 = requireRef_error();
	Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function () { return ref_error_1.default; } });
	
} (ajv, ajv.exports));

var ajvExports = ajv.exports;

var dist = {exports: {}};

var formats = {};

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
	function fmtDef(validate, compare) {
	    return { validate, compare };
	}
	exports.fullFormats = {
	    // date: http://tools.ietf.org/html/rfc3339#section-5.6
	    date: fmtDef(date, compareDate),
	    // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
	    time: fmtDef(getTime(true), compareTime),
	    "date-time": fmtDef(getDateTime(true), compareDateTime),
	    "iso-time": fmtDef(getTime(), compareIsoTime),
	    "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
	    // duration: https://tools.ietf.org/html/rfc3339#appendix-A
	    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
	    uri,
	    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
	    // uri-template: https://tools.ietf.org/html/rfc6570
	    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
	    // For the source: https://gist.github.com/dperini/729294
	    // For test cases: https://mathiasbynens.be/demo/url-regex
	    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
	    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
	    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
	    // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
	    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
	    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
	    regex,
	    // uuid: http://tools.ietf.org/html/rfc4122
	    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
	    // JSON-pointer: https://tools.ietf.org/html/rfc6901
	    // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
	    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
	    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
	    // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
	    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
	    // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
	    // byte: https://github.com/miguelmota/is-base64
	    byte,
	    // signed 32 bit integer
	    int32: { type: "number", validate: validateInt32 },
	    // signed 64 bit integer
	    int64: { type: "number", validate: validateInt64 },
	    // C-type float
	    float: { type: "number", validate: validateNumber },
	    // C-type double
	    double: { type: "number", validate: validateNumber },
	    // hint to the UI to hide input strings
	    password: true,
	    // unchecked string payload
	    binary: true,
	};
	exports.fastFormats = {
	    ...exports.fullFormats,
	    date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
	    time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
	    "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
	    "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
	    "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
	    // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
	    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
	    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
	    // email (sources from jsen validator):
	    // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
	    // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
	    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
	};
	exports.formatNames = Object.keys(exports.fullFormats);
	function isLeapYear(year) {
	    // https://tools.ietf.org/html/rfc3339#appendix-C
	    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	}
	const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
	const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	function date(str) {
	    // full-date from http://tools.ietf.org/html/rfc3339#section-5.6
	    const matches = DATE.exec(str);
	    if (!matches)
	        return false;
	    const year = +matches[1];
	    const month = +matches[2];
	    const day = +matches[3];
	    return (month >= 1 &&
	        month <= 12 &&
	        day >= 1 &&
	        day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]));
	}
	function compareDate(d1, d2) {
	    if (!(d1 && d2))
	        return undefined;
	    if (d1 > d2)
	        return 1;
	    if (d1 < d2)
	        return -1;
	    return 0;
	}
	const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
	function getTime(strictTimeZone) {
	    return function time(str) {
	        const matches = TIME.exec(str);
	        if (!matches)
	            return false;
	        const hr = +matches[1];
	        const min = +matches[2];
	        const sec = +matches[3];
	        const tz = matches[4];
	        const tzSign = matches[5] === "-" ? -1 : 1;
	        const tzH = +(matches[6] || 0);
	        const tzM = +(matches[7] || 0);
	        if (tzH > 23 || tzM > 59 || (strictTimeZone && !tz))
	            return false;
	        if (hr <= 23 && min <= 59 && sec < 60)
	            return true;
	        // leap second
	        const utcMin = min - tzM * tzSign;
	        const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
	        return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
	    };
	}
	function compareTime(s1, s2) {
	    if (!(s1 && s2))
	        return undefined;
	    const t1 = new Date("2020-01-01T" + s1).valueOf();
	    const t2 = new Date("2020-01-01T" + s2).valueOf();
	    if (!(t1 && t2))
	        return undefined;
	    return t1 - t2;
	}
	function compareIsoTime(t1, t2) {
	    if (!(t1 && t2))
	        return undefined;
	    const a1 = TIME.exec(t1);
	    const a2 = TIME.exec(t2);
	    if (!(a1 && a2))
	        return undefined;
	    t1 = a1[1] + a1[2] + a1[3];
	    t2 = a2[1] + a2[2] + a2[3];
	    if (t1 > t2)
	        return 1;
	    if (t1 < t2)
	        return -1;
	    return 0;
	}
	const DATE_TIME_SEPARATOR = /t|\s/i;
	function getDateTime(strictTimeZone) {
	    const time = getTime(strictTimeZone);
	    return function date_time(str) {
	        // http://tools.ietf.org/html/rfc3339#section-5.6
	        const dateTime = str.split(DATE_TIME_SEPARATOR);
	        return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
	    };
	}
	function compareDateTime(dt1, dt2) {
	    if (!(dt1 && dt2))
	        return undefined;
	    const d1 = new Date(dt1).valueOf();
	    const d2 = new Date(dt2).valueOf();
	    if (!(d1 && d2))
	        return undefined;
	    return d1 - d2;
	}
	function compareIsoDateTime(dt1, dt2) {
	    if (!(dt1 && dt2))
	        return undefined;
	    const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
	    const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
	    const res = compareDate(d1, d2);
	    if (res === undefined)
	        return undefined;
	    return res || compareTime(t1, t2);
	}
	const NOT_URI_FRAGMENT = /\/|:/;
	const URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
	function uri(str) {
	    // http://jmrware.com/articles/2009/uri_regexp/URI_regex.html + optional protocol + required "."
	    return NOT_URI_FRAGMENT.test(str) && URI.test(str);
	}
	const BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
	function byte(str) {
	    BYTE.lastIndex = 0;
	    return BYTE.test(str);
	}
	const MIN_INT32 = -2147483648;
	const MAX_INT32 = 2 ** 31 - 1;
	function validateInt32(value) {
	    return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
	}
	function validateInt64(value) {
	    // JSON and javascript max Int is 2**53, so any int that passes isInteger is valid for Int64
	    return Number.isInteger(value);
	}
	function validateNumber() {
	    return true;
	}
	const Z_ANCHOR = /[^\\]\\Z/;
	function regex(str) {
	    if (Z_ANCHOR.test(str))
	        return false;
	    try {
	        new RegExp(str);
	        return true;
	    }
	    catch (e) {
	        return false;
	    }
	}
	
} (formats));

var limit = {};

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.formatLimitDefinition = void 0;
	const ajv_1 = ajvExports;
	const codegen_1 = requireCodegen();
	const ops = codegen_1.operators;
	const KWDs = {
	    formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
	    formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
	    formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
	    formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE },
	};
	const error = {
	    message: ({ keyword, schemaCode }) => (0, codegen_1.str) `should be ${KWDs[keyword].okStr} ${schemaCode}`,
	    params: ({ keyword, schemaCode }) => (0, codegen_1._) `{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`,
	};
	exports.formatLimitDefinition = {
	    keyword: Object.keys(KWDs),
	    type: "string",
	    schemaType: "string",
	    $data: true,
	    error,
	    code(cxt) {
	        const { gen, data, schemaCode, keyword, it } = cxt;
	        const { opts, self } = it;
	        if (!opts.validateFormats)
	            return;
	        const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
	        if (fCxt.$data)
	            validate$DataFormat();
	        else
	            validateFormat();
	        function validate$DataFormat() {
	            const fmts = gen.scopeValue("formats", {
	                ref: self.formats,
	                code: opts.code.formats,
	            });
	            const fmt = gen.const("fmt", (0, codegen_1._) `${fmts}[${fCxt.schemaCode}]`);
	            cxt.fail$data((0, codegen_1.or)((0, codegen_1._) `typeof ${fmt} != "object"`, (0, codegen_1._) `${fmt} instanceof RegExp`, (0, codegen_1._) `typeof ${fmt}.compare != "function"`, compareCode(fmt)));
	        }
	        function validateFormat() {
	            const format = fCxt.schema;
	            const fmtDef = self.formats[format];
	            if (!fmtDef || fmtDef === true)
	                return;
	            if (typeof fmtDef != "object" ||
	                fmtDef instanceof RegExp ||
	                typeof fmtDef.compare != "function") {
	                throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
	            }
	            const fmt = gen.scopeValue("formats", {
	                key: format,
	                ref: fmtDef,
	                code: opts.code.formats ? (0, codegen_1._) `${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : undefined,
	            });
	            cxt.fail$data(compareCode(fmt));
	        }
	        function compareCode(fmt) {
	            return (0, codegen_1._) `${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
	        }
	    },
	    dependencies: ["format"],
	};
	const formatLimitPlugin = (ajv) => {
	    ajv.addKeyword(exports.formatLimitDefinition);
	    return ajv;
	};
	exports.default = formatLimitPlugin;
	
} (limit));

(function (module, exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	const formats_1 = formats;
	const limit_1 = limit;
	const codegen_1 = requireCodegen();
	const fullName = new codegen_1.Name("fullFormats");
	const fastName = new codegen_1.Name("fastFormats");
	const formatsPlugin = (ajv, opts = { keywords: true }) => {
	    if (Array.isArray(opts)) {
	        addFormats(ajv, opts, formats_1.fullFormats, fullName);
	        return ajv;
	    }
	    const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
	    const list = opts.formats || formats_1.formatNames;
	    addFormats(ajv, list, formats, exportName);
	    if (opts.keywords)
	        (0, limit_1.default)(ajv);
	    return ajv;
	};
	formatsPlugin.get = (name, mode = "full") => {
	    const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
	    const f = formats[name];
	    if (!f)
	        throw new Error(`Unknown format "${name}"`);
	    return f;
	};
	function addFormats(ajv, list, fs, exportName) {
	    var _a;
	    var _b;
	    (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 ? _a : (_b.formats = (0, codegen_1._) `require("ajv-formats/dist/formats").${exportName}`);
	    for (const f of list)
	        ajv.addFormat(f, fs[f]);
	}
	module.exports = exports = formatsPlugin;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = formatsPlugin;
	
} (dist, dist.exports));

var distExports = dist.exports;
var _addFormats = /*@__PURE__*/getDefaultExportFromCjs(distExports);

/**
 * AJV-based JSON Schema validator provider
 */
function createDefaultAjvInstance() {
    const ajv = new ajvExports.Ajv({
        strict: false,
        validateFormats: true,
        validateSchema: false,
        allErrors: true
    });
    const addFormats = _addFormats;
    addFormats(ajv);
    return ajv;
}
/**
 * @example
 * ```typescript
 * // Use with default AJV instance (recommended)
 * import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
 * const validator = new AjvJsonSchemaValidator();
 *
 * // Use with custom AJV instance
 * import { Ajv } from 'ajv';
 * const ajv = new Ajv({ strict: true, allErrors: true });
 * const validator = new AjvJsonSchemaValidator(ajv);
 * ```
 */
class AjvJsonSchemaValidator {
    /**
     * Create an AJV validator
     *
     * @param ajv - Optional pre-configured AJV instance. If not provided, a default instance will be created.
     *
     * @example
     * ```typescript
     * // Use default configuration (recommended for most cases)
     * import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
     * const validator = new AjvJsonSchemaValidator();
     *
     * // Or provide custom AJV instance for advanced configuration
     * import { Ajv } from 'ajv';
     * import addFormats from 'ajv-formats';
     *
     * const ajv = new Ajv({ validateFormats: true });
     * addFormats(ajv);
     * const validator = new AjvJsonSchemaValidator(ajv);
     * ```
     */
    constructor(ajv) {
        this._ajv = ajv !== null && ajv !== void 0 ? ajv : createDefaultAjvInstance();
    }
    /**
     * Create a validator for the given JSON Schema
     *
     * The validator is compiled once and can be reused multiple times.
     * If the schema has an $id, it will be cached by AJV automatically.
     *
     * @param schema - Standard JSON Schema object
     * @returns A validator function that validates input data
     */
    getValidator(schema) {
        var _a;
        // Check if schema has $id and is already compiled/cached
        const ajvValidator = '$id' in schema && typeof schema.$id === 'string'
            ? ((_a = this._ajv.getSchema(schema.$id)) !== null && _a !== void 0 ? _a : this._ajv.compile(schema))
            : this._ajv.compile(schema);
        return (input) => {
            const valid = ajvValidator(input);
            if (valid) {
                return {
                    valid: true,
                    data: input,
                    errorMessage: undefined
                };
            }
            else {
                return {
                    valid: false,
                    data: undefined,
                    errorMessage: this._ajv.errorsText(ajvValidator.errors)
                };
            }
        };
    }
}

/**
 * An MCP client on top of a pluggable transport.
 *
 * The client will automatically begin the initialization flow with the server when connect() is called.
 *
 * To use with custom types, extend the base Request/Notification/Result types and pass them as type parameters:
 *
 * ```typescript
 * // Custom schemas
 * const CustomRequestSchema = RequestSchema.extend({...})
 * const CustomNotificationSchema = NotificationSchema.extend({...})
 * const CustomResultSchema = ResultSchema.extend({...})
 *
 * // Type aliases
 * type CustomRequest = z.infer<typeof CustomRequestSchema>
 * type CustomNotification = z.infer<typeof CustomNotificationSchema>
 * type CustomResult = z.infer<typeof CustomResultSchema>
 *
 * // Create typed client
 * const client = new Client<CustomRequest, CustomNotification, CustomResult>({
 *   name: "CustomClient",
 *   version: "1.0.0"
 * })
 * ```
 */
class Client extends Protocol {
    /**
     * Initializes this client with the given name and version information.
     */
    constructor(_clientInfo, options) {
        var _a, _b;
        super(options);
        this._clientInfo = _clientInfo;
        this._cachedToolOutputValidators = new Map();
        this._capabilities = (_a = options === null || options === void 0 ? void 0 : options.capabilities) !== null && _a !== void 0 ? _a : {};
        this._jsonSchemaValidator = (_b = options === null || options === void 0 ? void 0 : options.jsonSchemaValidator) !== null && _b !== void 0 ? _b : new AjvJsonSchemaValidator();
    }
    /**
     * Registers new capabilities. This can only be called before connecting to a transport.
     *
     * The new capabilities will be merged with any existing capabilities previously given (e.g., at initialization).
     */
    registerCapabilities(capabilities) {
        if (this.transport) {
            throw new Error('Cannot register capabilities after connecting to transport');
        }
        this._capabilities = mergeCapabilities(this._capabilities, capabilities);
    }
    assertCapability(capability, method) {
        var _a;
        if (!((_a = this._serverCapabilities) === null || _a === void 0 ? void 0 : _a[capability])) {
            throw new Error(`Server does not support ${capability} (required for ${method})`);
        }
    }
    async connect(transport, options) {
        await super.connect(transport);
        // When transport sessionId is already set this means we are trying to reconnect.
        // In this case we don't need to initialize again.
        if (transport.sessionId !== undefined) {
            return;
        }
        try {
            const result = await this.request({
                method: 'initialize',
                params: {
                    protocolVersion: LATEST_PROTOCOL_VERSION,
                    capabilities: this._capabilities,
                    clientInfo: this._clientInfo
                }
            }, InitializeResultSchema, options);
            if (result === undefined) {
                throw new Error(`Server sent invalid initialize result: ${result}`);
            }
            if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
                throw new Error(`Server's protocol version is not supported: ${result.protocolVersion}`);
            }
            this._serverCapabilities = result.capabilities;
            this._serverVersion = result.serverInfo;
            // HTTP transports must set the protocol version in each header after initialization.
            if (transport.setProtocolVersion) {
                transport.setProtocolVersion(result.protocolVersion);
            }
            this._instructions = result.instructions;
            await this.notification({
                method: 'notifications/initialized'
            });
        }
        catch (error) {
            // Disconnect if initialization fails.
            void this.close();
            throw error;
        }
    }
    /**
     * After initialization has completed, this will be populated with the server's reported capabilities.
     */
    getServerCapabilities() {
        return this._serverCapabilities;
    }
    /**
     * After initialization has completed, this will be populated with information about the server's name and version.
     */
    getServerVersion() {
        return this._serverVersion;
    }
    /**
     * After initialization has completed, this may be populated with information about the server's instructions.
     */
    getInstructions() {
        return this._instructions;
    }
    assertCapabilityForMethod(method) {
        var _a, _b, _c, _d, _e;
        switch (method) {
            case 'logging/setLevel':
                if (!((_a = this._serverCapabilities) === null || _a === void 0 ? void 0 : _a.logging)) {
                    throw new Error(`Server does not support logging (required for ${method})`);
                }
                break;
            case 'prompts/get':
            case 'prompts/list':
                if (!((_b = this._serverCapabilities) === null || _b === void 0 ? void 0 : _b.prompts)) {
                    throw new Error(`Server does not support prompts (required for ${method})`);
                }
                break;
            case 'resources/list':
            case 'resources/templates/list':
            case 'resources/read':
            case 'resources/subscribe':
            case 'resources/unsubscribe':
                if (!((_c = this._serverCapabilities) === null || _c === void 0 ? void 0 : _c.resources)) {
                    throw new Error(`Server does not support resources (required for ${method})`);
                }
                if (method === 'resources/subscribe' && !this._serverCapabilities.resources.subscribe) {
                    throw new Error(`Server does not support resource subscriptions (required for ${method})`);
                }
                break;
            case 'tools/call':
            case 'tools/list':
                if (!((_d = this._serverCapabilities) === null || _d === void 0 ? void 0 : _d.tools)) {
                    throw new Error(`Server does not support tools (required for ${method})`);
                }
                break;
            case 'completion/complete':
                if (!((_e = this._serverCapabilities) === null || _e === void 0 ? void 0 : _e.completions)) {
                    throw new Error(`Server does not support completions (required for ${method})`);
                }
                break;
        }
    }
    assertNotificationCapability(method) {
        var _a;
        switch (method) {
            case 'notifications/roots/list_changed':
                if (!((_a = this._capabilities.roots) === null || _a === void 0 ? void 0 : _a.listChanged)) {
                    throw new Error(`Client does not support roots list changed notifications (required for ${method})`);
                }
                break;
        }
    }
    assertRequestHandlerCapability(method) {
        switch (method) {
            case 'sampling/createMessage':
                if (!this._capabilities.sampling) {
                    throw new Error(`Client does not support sampling capability (required for ${method})`);
                }
                break;
            case 'elicitation/create':
                if (!this._capabilities.elicitation) {
                    throw new Error(`Client does not support elicitation capability (required for ${method})`);
                }
                break;
            case 'roots/list':
                if (!this._capabilities.roots) {
                    throw new Error(`Client does not support roots capability (required for ${method})`);
                }
                break;
        }
    }
    async ping(options) {
        return this.request({ method: 'ping' }, EmptyResultSchema, options);
    }
    async complete(params, options) {
        return this.request({ method: 'completion/complete', params }, CompleteResultSchema, options);
    }
    async setLoggingLevel(level, options) {
        return this.request({ method: 'logging/setLevel', params: { level } }, EmptyResultSchema, options);
    }
    async getPrompt(params, options) {
        return this.request({ method: 'prompts/get', params }, GetPromptResultSchema, options);
    }
    async listPrompts(params, options) {
        return this.request({ method: 'prompts/list', params }, ListPromptsResultSchema, options);
    }
    async listResources(params, options) {
        return this.request({ method: 'resources/list', params }, ListResourcesResultSchema, options);
    }
    async listResourceTemplates(params, options) {
        return this.request({ method: 'resources/templates/list', params }, ListResourceTemplatesResultSchema, options);
    }
    async readResource(params, options) {
        return this.request({ method: 'resources/read', params }, ReadResourceResultSchema, options);
    }
    async subscribeResource(params, options) {
        return this.request({ method: 'resources/subscribe', params }, EmptyResultSchema, options);
    }
    async unsubscribeResource(params, options) {
        return this.request({ method: 'resources/unsubscribe', params }, EmptyResultSchema, options);
    }
    async callTool(params, resultSchema = CallToolResultSchema, options) {
        const result = await this.request({ method: 'tools/call', params }, resultSchema, options);
        // Check if the tool has an outputSchema
        const validator = this.getToolOutputValidator(params.name);
        if (validator) {
            // If tool has outputSchema, it MUST return structuredContent (unless it's an error)
            if (!result.structuredContent && !result.isError) {
                throw new McpError(ErrorCode.InvalidRequest, `Tool ${params.name} has an output schema but did not return structured content`);
            }
            // Only validate structured content if present (not when there's an error)
            if (result.structuredContent) {
                try {
                    // Validate the structured content against the schema
                    const validationResult = validator(result.structuredContent);
                    if (!validationResult.valid) {
                        throw new McpError(ErrorCode.InvalidParams, `Structured content does not match the tool's output schema: ${validationResult.errorMessage}`);
                    }
                }
                catch (error) {
                    if (error instanceof McpError) {
                        throw error;
                    }
                    throw new McpError(ErrorCode.InvalidParams, `Failed to validate structured content: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        return result;
    }
    /**
     * Cache validators for tool output schemas.
     * Called after listTools() to pre-compile validators for better performance.
     */
    cacheToolOutputSchemas(tools) {
        this._cachedToolOutputValidators.clear();
        for (const tool of tools) {
            // If the tool has an outputSchema, create and cache the validator
            if (tool.outputSchema) {
                const toolValidator = this._jsonSchemaValidator.getValidator(tool.outputSchema);
                this._cachedToolOutputValidators.set(tool.name, toolValidator);
            }
        }
    }
    /**
     * Get cached validator for a tool
     */
    getToolOutputValidator(toolName) {
        return this._cachedToolOutputValidators.get(toolName);
    }
    async listTools(params, options) {
        const result = await this.request({ method: 'tools/list', params }, ListToolsResultSchema, options);
        // Cache the tools and their output schemas for future validation
        this.cacheToolOutputSchemas(result.tools);
        return result;
    }
    async sendRootsListChanged() {
        return this.notification({ method: 'notifications/roots/list_changed' });
    }
}

var crossSpawn = {exports: {}};

var windows;
var hasRequiredWindows;

function requireWindows () {
	if (hasRequiredWindows) return windows;
	hasRequiredWindows = 1;
	windows = isexe;
	isexe.sync = sync;

	var fs = require$$0;

	function checkPathExt (path, options) {
	  var pathext = options.pathExt !== undefined ?
	    options.pathExt : process.env.PATHEXT;

	  if (!pathext) {
	    return true
	  }

	  pathext = pathext.split(';');
	  if (pathext.indexOf('') !== -1) {
	    return true
	  }
	  for (var i = 0; i < pathext.length; i++) {
	    var p = pathext[i].toLowerCase();
	    if (p && path.substr(-p.length).toLowerCase() === p) {
	      return true
	    }
	  }
	  return false
	}

	function checkStat (stat, path, options) {
	  if (!stat.isSymbolicLink() && !stat.isFile()) {
	    return false
	  }
	  return checkPathExt(path, options)
	}

	function isexe (path, options, cb) {
	  fs.stat(path, function (er, stat) {
	    cb(er, er ? false : checkStat(stat, path, options));
	  });
	}

	function sync (path, options) {
	  return checkStat(fs.statSync(path), path, options)
	}
	return windows;
}

var mode;
var hasRequiredMode;

function requireMode () {
	if (hasRequiredMode) return mode;
	hasRequiredMode = 1;
	mode = isexe;
	isexe.sync = sync;

	var fs = require$$0;

	function isexe (path, options, cb) {
	  fs.stat(path, function (er, stat) {
	    cb(er, er ? false : checkStat(stat, options));
	  });
	}

	function sync (path, options) {
	  return checkStat(fs.statSync(path), options)
	}

	function checkStat (stat, options) {
	  return stat.isFile() && checkMode(stat, options)
	}

	function checkMode (stat, options) {
	  var mod = stat.mode;
	  var uid = stat.uid;
	  var gid = stat.gid;

	  var myUid = options.uid !== undefined ?
	    options.uid : process.getuid && process.getuid();
	  var myGid = options.gid !== undefined ?
	    options.gid : process.getgid && process.getgid();

	  var u = parseInt('100', 8);
	  var g = parseInt('010', 8);
	  var o = parseInt('001', 8);
	  var ug = u | g;

	  var ret = (mod & o) ||
	    (mod & g) && gid === myGid ||
	    (mod & u) && uid === myUid ||
	    (mod & ug) && myUid === 0;

	  return ret
	}
	return mode;
}

var core;
if (process.platform === 'win32' || commonjsGlobal.TESTING_WINDOWS) {
  core = requireWindows();
} else {
  core = requireMode();
}

var isexe_1 = isexe$1;
isexe$1.sync = sync;

function isexe$1 (path, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = {};
  }

  if (!cb) {
    if (typeof Promise !== 'function') {
      throw new TypeError('callback not provided')
    }

    return new Promise(function (resolve, reject) {
      isexe$1(path, options || {}, function (er, is) {
        if (er) {
          reject(er);
        } else {
          resolve(is);
        }
      });
    })
  }

  core(path, options || {}, function (er, is) {
    // ignore EACCES because that just means we aren't allowed to run it
    if (er) {
      if (er.code === 'EACCES' || options && options.ignoreErrors) {
        er = null;
        is = false;
      }
    }
    cb(er, is);
  });
}

function sync (path, options) {
  // my kingdom for a filtered catch
  try {
    return core.sync(path, options || {})
  } catch (er) {
    if (options && options.ignoreErrors || er.code === 'EACCES') {
      return false
    } else {
      throw er
    }
  }
}

const isWindows = process.platform === 'win32' ||
    process.env.OSTYPE === 'cygwin' ||
    process.env.OSTYPE === 'msys';

const path$2 = require$$0$1;
const COLON = isWindows ? ';' : ':';
const isexe = isexe_1;

const getNotFoundError = (cmd) =>
  Object.assign(new Error(`not found: ${cmd}`), { code: 'ENOENT' });

const getPathInfo = (cmd, opt) => {
  const colon = opt.colon || COLON;

  // If it has a slash, then we don't bother searching the pathenv.
  // just check the file itself, and that's it.
  const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? ['']
    : (
      [
        // windows always checks the cwd first
        ...(isWindows ? [process.cwd()] : []),
        ...(opt.path || process.env.PATH ||
          /* istanbul ignore next: very unusual */ '').split(colon),
      ]
    );
  const pathExtExe = isWindows
    ? opt.pathExt || process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM'
    : '';
  const pathExt = isWindows ? pathExtExe.split(colon) : [''];

  if (isWindows) {
    if (cmd.indexOf('.') !== -1 && pathExt[0] !== '')
      pathExt.unshift('');
  }

  return {
    pathEnv,
    pathExt,
    pathExtExe,
  }
};

const which$1 = (cmd, opt, cb) => {
  if (typeof opt === 'function') {
    cb = opt;
    opt = {};
  }
  if (!opt)
    opt = {};

  const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
  const found = [];

  const step = i => new Promise((resolve, reject) => {
    if (i === pathEnv.length)
      return opt.all && found.length ? resolve(found)
        : reject(getNotFoundError(cmd))

    const ppRaw = pathEnv[i];
    const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;

    const pCmd = path$2.join(pathPart, cmd);
    const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd
      : pCmd;

    resolve(subStep(p, i, 0));
  });

  const subStep = (p, i, ii) => new Promise((resolve, reject) => {
    if (ii === pathExt.length)
      return resolve(step(i + 1))
    const ext = pathExt[ii];
    isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
      if (!er && is) {
        if (opt.all)
          found.push(p + ext);
        else
          return resolve(p + ext)
      }
      return resolve(subStep(p, i, ii + 1))
    });
  });

  return cb ? step(0).then(res => cb(null, res), cb) : step(0)
};

const whichSync = (cmd, opt) => {
  opt = opt || {};

  const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
  const found = [];

  for (let i = 0; i < pathEnv.length; i ++) {
    const ppRaw = pathEnv[i];
    const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;

    const pCmd = path$2.join(pathPart, cmd);
    const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd
      : pCmd;

    for (let j = 0; j < pathExt.length; j ++) {
      const cur = p + pathExt[j];
      try {
        const is = isexe.sync(cur, { pathExt: pathExtExe });
        if (is) {
          if (opt.all)
            found.push(cur);
          else
            return cur
        }
      } catch (ex) {}
    }
  }

  if (opt.all && found.length)
    return found

  if (opt.nothrow)
    return null

  throw getNotFoundError(cmd)
};

var which_1 = which$1;
which$1.sync = whichSync;

var pathKey$1 = {exports: {}};

const pathKey = (options = {}) => {
	const environment = options.env || process.env;
	const platform = options.platform || process.platform;

	if (platform !== 'win32') {
		return 'PATH';
	}

	return Object.keys(environment).reverse().find(key => key.toUpperCase() === 'PATH') || 'Path';
};

pathKey$1.exports = pathKey;
// TODO: Remove this for the next major release
pathKey$1.exports.default = pathKey;

var pathKeyExports = pathKey$1.exports;

const path$1 = require$$0$1;
const which = which_1;
const getPathKey = pathKeyExports;

function resolveCommandAttempt(parsed, withoutPathExt) {
    const env = parsed.options.env || process.env;
    const cwd = process.cwd();
    const hasCustomCwd = parsed.options.cwd != null;
    // Worker threads do not have process.chdir()
    const shouldSwitchCwd = hasCustomCwd && process.chdir !== undefined && !process.chdir.disabled;

    // If a custom `cwd` was specified, we need to change the process cwd
    // because `which` will do stat calls but does not support a custom cwd
    if (shouldSwitchCwd) {
        try {
            process.chdir(parsed.options.cwd);
        } catch (err) {
            /* Empty */
        }
    }

    let resolved;

    try {
        resolved = which.sync(parsed.command, {
            path: env[getPathKey({ env })],
            pathExt: withoutPathExt ? path$1.delimiter : undefined,
        });
    } catch (e) {
        /* Empty */
    } finally {
        if (shouldSwitchCwd) {
            process.chdir(cwd);
        }
    }

    // If we successfully resolved, ensure that an absolute path is returned
    // Note that when a custom `cwd` was used, we need to resolve to an absolute path based on it
    if (resolved) {
        resolved = path$1.resolve(hasCustomCwd ? parsed.options.cwd : '', resolved);
    }

    return resolved;
}

function resolveCommand$1(parsed) {
    return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
}

var resolveCommand_1 = resolveCommand$1;

var _escape = {};

// See http://www.robvanderwoude.com/escapechars.php
const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(arg) {
    // Escape meta chars
    arg = arg.replace(metaCharsRegExp, '^$1');

    return arg;
}

function escapeArgument(arg, doubleEscapeMetaChars) {
    // Convert to string
    arg = `${arg}`;

    // Algorithm below is based on https://qntm.org/cmd
    // It's slightly altered to disable JS backtracking to avoid hanging on specially crafted input
    // Please see https://github.com/moxystudio/node-cross-spawn/pull/160 for more information

    // Sequence of backslashes followed by a double quote:
    // double up all the backslashes and escape the double quote
    arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');

    // Sequence of backslashes followed by the end of the string
    // (which will become a double quote later):
    // double up all the backslashes
    arg = arg.replace(/(?=(\\+?)?)\1$/, '$1$1');

    // All other backslashes occur literally

    // Quote the whole thing:
    arg = `"${arg}"`;

    // Escape meta chars
    arg = arg.replace(metaCharsRegExp, '^$1');

    // Double escape meta chars if necessary
    if (doubleEscapeMetaChars) {
        arg = arg.replace(metaCharsRegExp, '^$1');
    }

    return arg;
}

_escape.command = escapeCommand;
_escape.argument = escapeArgument;

var shebangRegex$1 = /^#!(.*)/;

const shebangRegex = shebangRegex$1;

var shebangCommand$1 = (string = '') => {
	const match = string.match(shebangRegex);

	if (!match) {
		return null;
	}

	const [path, argument] = match[0].replace(/#! ?/, '').split(' ');
	const binary = path.split('/').pop();

	if (binary === 'env') {
		return argument;
	}

	return argument ? `${binary} ${argument}` : binary;
};

const fs = require$$0;
const shebangCommand = shebangCommand$1;

function readShebang$1(command) {
    // Read the first 150 bytes from the file
    const size = 150;
    const buffer = Buffer.alloc(size);

    let fd;

    try {
        fd = fs.openSync(command, 'r');
        fs.readSync(fd, buffer, 0, size, 0);
        fs.closeSync(fd);
    } catch (e) { /* Empty */ }

    // Attempt to extract shebang (null is returned if not a shebang)
    return shebangCommand(buffer.toString());
}

var readShebang_1 = readShebang$1;

const path = require$$0$1;
const resolveCommand = resolveCommand_1;
const escape$1 = _escape;
const readShebang = readShebang_1;

const isWin$1 = process.platform === 'win32';
const isExecutableRegExp = /\.(?:com|exe)$/i;
const isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;

function detectShebang(parsed) {
    parsed.file = resolveCommand(parsed);

    const shebang = parsed.file && readShebang(parsed.file);

    if (shebang) {
        parsed.args.unshift(parsed.file);
        parsed.command = shebang;

        return resolveCommand(parsed);
    }

    return parsed.file;
}

function parseNonShell(parsed) {
    if (!isWin$1) {
        return parsed;
    }

    // Detect & add support for shebangs
    const commandFile = detectShebang(parsed);

    // We don't need a shell if the command filename is an executable
    const needsShell = !isExecutableRegExp.test(commandFile);

    // If a shell is required, use cmd.exe and take care of escaping everything correctly
    // Note that `forceShell` is an hidden option used only in tests
    if (parsed.options.forceShell || needsShell) {
        // Need to double escape meta chars if the command is a cmd-shim located in `node_modules/.bin/`
        // The cmd-shim simply calls execute the package bin file with NodeJS, proxying any argument
        // Because the escape of metachars with ^ gets interpreted when the cmd.exe is first called,
        // we need to double escape them
        const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);

        // Normalize posix paths into OS compatible paths (e.g.: foo/bar -> foo\bar)
        // This is necessary otherwise it will always fail with ENOENT in those cases
        parsed.command = path.normalize(parsed.command);

        // Escape command & arguments
        parsed.command = escape$1.command(parsed.command);
        parsed.args = parsed.args.map((arg) => escape$1.argument(arg, needsDoubleEscapeMetaChars));

        const shellCommand = [parsed.command].concat(parsed.args).join(' ');

        parsed.args = ['/d', '/s', '/c', `"${shellCommand}"`];
        parsed.command = process.env.comspec || 'cmd.exe';
        parsed.options.windowsVerbatimArguments = true; // Tell node's spawn that the arguments are already escaped
    }

    return parsed;
}

function parse$1(command, args, options) {
    // Normalize arguments, similar to nodejs
    if (args && !Array.isArray(args)) {
        options = args;
        args = null;
    }

    args = args ? args.slice(0) : []; // Clone array to avoid changing the original
    options = Object.assign({}, options); // Clone object to avoid changing the original

    // Build our parsed object
    const parsed = {
        command,
        args,
        options,
        file: undefined,
        original: {
            command,
            args,
        },
    };

    // Delegate further parsing to shell or non-shell
    return options.shell ? parsed : parseNonShell(parsed);
}

var parse_1 = parse$1;

const isWin = process.platform === 'win32';

function notFoundError(original, syscall) {
    return Object.assign(new Error(`${syscall} ${original.command} ENOENT`), {
        code: 'ENOENT',
        errno: 'ENOENT',
        syscall: `${syscall} ${original.command}`,
        path: original.command,
        spawnargs: original.args,
    });
}

function hookChildProcess(cp, parsed) {
    if (!isWin) {
        return;
    }

    const originalEmit = cp.emit;

    cp.emit = function (name, arg1) {
        // If emitting "exit" event and exit code is 1, we need to check if
        // the command exists and emit an "error" instead
        // See https://github.com/IndigoUnited/node-cross-spawn/issues/16
        if (name === 'exit') {
            const err = verifyENOENT(arg1, parsed);

            if (err) {
                return originalEmit.call(cp, 'error', err);
            }
        }

        return originalEmit.apply(cp, arguments); // eslint-disable-line prefer-rest-params
    };
}

function verifyENOENT(status, parsed) {
    if (isWin && status === 1 && !parsed.file) {
        return notFoundError(parsed.original, 'spawn');
    }

    return null;
}

function verifyENOENTSync(status, parsed) {
    if (isWin && status === 1 && !parsed.file) {
        return notFoundError(parsed.original, 'spawnSync');
    }

    return null;
}

var enoent$1 = {
    hookChildProcess,
    verifyENOENT,
    verifyENOENTSync,
    notFoundError,
};

const cp = require$$0$2;
const parse = parse_1;
const enoent = enoent$1;

function spawn(command, args, options) {
    // Parse the arguments
    const parsed = parse(command, args, options);

    // Spawn the child process
    const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);

    // Hook into child process "exit" event to emit an error if the command
    // does not exists, see: https://github.com/IndigoUnited/node-cross-spawn/issues/16
    enoent.hookChildProcess(spawned, parsed);

    return spawned;
}

function spawnSync(command, args, options) {
    // Parse the arguments
    const parsed = parse(command, args, options);

    // Spawn the child process
    const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);

    // Analyze if the command does not exist, see: https://github.com/IndigoUnited/node-cross-spawn/issues/16
    result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);

    return result;
}

crossSpawn.exports = spawn;
crossSpawn.exports.spawn = spawn;
crossSpawn.exports.sync = spawnSync;

crossSpawn.exports._parse = parse;
crossSpawn.exports._enoent = enoent;

var crossSpawnExports = crossSpawn.exports;
var spawn$1 = /*@__PURE__*/getDefaultExportFromCjs(crossSpawnExports);

/**
 * Buffers a continuous stdio stream into discrete JSON-RPC messages.
 */
class ReadBuffer {
    append(chunk) {
        this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
    }
    readMessage() {
        if (!this._buffer) {
            return null;
        }
        const index = this._buffer.indexOf('\n');
        if (index === -1) {
            return null;
        }
        const line = this._buffer.toString('utf8', 0, index).replace(/\r$/, '');
        this._buffer = this._buffer.subarray(index + 1);
        return deserializeMessage(line);
    }
    clear() {
        this._buffer = undefined;
    }
}
function deserializeMessage(line) {
    return JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
    return JSON.stringify(message) + '\n';
}

/**
 * Environment variables to inherit by default, if an environment is not explicitly given.
 */
const DEFAULT_INHERITED_ENV_VARS = process$1.platform === 'win32'
    ? [
        'APPDATA',
        'HOMEDRIVE',
        'HOMEPATH',
        'LOCALAPPDATA',
        'PATH',
        'PROCESSOR_ARCHITECTURE',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'USERNAME',
        'USERPROFILE',
        'PROGRAMFILES'
    ]
    : /* list inspired by the default env inheritance of sudo */
        ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];
/**
 * Returns a default environment object including only environment variables deemed safe to inherit.
 */
function getDefaultEnvironment() {
    const env = {};
    for (const key of DEFAULT_INHERITED_ENV_VARS) {
        const value = process$1.env[key];
        if (value === undefined) {
            continue;
        }
        if (value.startsWith('()')) {
            // Skip functions, which are a security risk.
            continue;
        }
        env[key] = value;
    }
    return env;
}
/**
 * Client transport for stdio: this will connect to a server by spawning a process and communicating with it over stdin/stdout.
 *
 * This transport is only available in Node.js environments.
 */
class StdioClientTransport {
    constructor(server) {
        this._abortController = new AbortController();
        this._readBuffer = new ReadBuffer();
        this._stderrStream = null;
        this._serverParams = server;
        if (server.stderr === 'pipe' || server.stderr === 'overlapped') {
            this._stderrStream = new node_stream.PassThrough();
        }
    }
    /**
     * Starts the server process and prepares to communicate with it.
     */
    async start() {
        if (this._process) {
            throw new Error('StdioClientTransport already started! If using Client class, note that connect() calls start() automatically.');
        }
        return new Promise((resolve, reject) => {
            var _a, _b, _c, _d, _e;
            this._process = spawn$1(this._serverParams.command, (_a = this._serverParams.args) !== null && _a !== void 0 ? _a : [], {
                // merge default env with server env because mcp server needs some env vars
                env: {
                    ...getDefaultEnvironment(),
                    ...this._serverParams.env
                },
                stdio: ['pipe', 'pipe', (_b = this._serverParams.stderr) !== null && _b !== void 0 ? _b : 'inherit'],
                shell: false,
                signal: this._abortController.signal,
                windowsHide: process$1.platform === 'win32' && isElectron(),
                cwd: this._serverParams.cwd
            });
            this._process.on('error', error => {
                var _a, _b;
                if (error.name === 'AbortError') {
                    // Expected when close() is called.
                    (_a = this.onclose) === null || _a === void 0 ? void 0 : _a.call(this);
                    return;
                }
                reject(error);
                (_b = this.onerror) === null || _b === void 0 ? void 0 : _b.call(this, error);
            });
            this._process.on('spawn', () => {
                resolve();
            });
            this._process.on('close', _code => {
                var _a;
                this._process = undefined;
                (_a = this.onclose) === null || _a === void 0 ? void 0 : _a.call(this);
            });
            (_c = this._process.stdin) === null || _c === void 0 ? void 0 : _c.on('error', error => {
                var _a;
                (_a = this.onerror) === null || _a === void 0 ? void 0 : _a.call(this, error);
            });
            (_d = this._process.stdout) === null || _d === void 0 ? void 0 : _d.on('data', chunk => {
                this._readBuffer.append(chunk);
                this.processReadBuffer();
            });
            (_e = this._process.stdout) === null || _e === void 0 ? void 0 : _e.on('error', error => {
                var _a;
                (_a = this.onerror) === null || _a === void 0 ? void 0 : _a.call(this, error);
            });
            if (this._stderrStream && this._process.stderr) {
                this._process.stderr.pipe(this._stderrStream);
            }
        });
    }
    /**
     * The stderr stream of the child process, if `StdioServerParameters.stderr` was set to "pipe" or "overlapped".
     *
     * If stderr piping was requested, a PassThrough stream is returned _immediately_, allowing callers to
     * attach listeners before the start method is invoked. This prevents loss of any early
     * error output emitted by the child process.
     */
    get stderr() {
        var _a, _b;
        if (this._stderrStream) {
            return this._stderrStream;
        }
        return (_b = (_a = this._process) === null || _a === void 0 ? void 0 : _a.stderr) !== null && _b !== void 0 ? _b : null;
    }
    /**
     * The child process pid spawned by this transport.
     *
     * This is only available after the transport has been started.
     */
    get pid() {
        var _a, _b;
        return (_b = (_a = this._process) === null || _a === void 0 ? void 0 : _a.pid) !== null && _b !== void 0 ? _b : null;
    }
    processReadBuffer() {
        var _a, _b;
        while (true) {
            try {
                const message = this._readBuffer.readMessage();
                if (message === null) {
                    break;
                }
                (_a = this.onmessage) === null || _a === void 0 ? void 0 : _a.call(this, message);
            }
            catch (error) {
                (_b = this.onerror) === null || _b === void 0 ? void 0 : _b.call(this, error);
            }
        }
    }
    async close() {
        this._abortController.abort();
        this._process = undefined;
        this._readBuffer.clear();
    }
    send(message) {
        return new Promise(resolve => {
            var _a;
            if (!((_a = this._process) === null || _a === void 0 ? void 0 : _a.stdin)) {
                throw new Error('Not connected');
            }
            const json = serializeMessage(message);
            if (this._process.stdin.write(json)) {
                resolve();
            }
            else {
                this._process.stdin.once('drain', resolve);
            }
        });
    }
}
function isElectron() {
    return 'type' in process$1;
}

/**
 * MCPClientService: Manages connections to Model Context Protocol servers
 * Architecture: Optional enhancement layer for context retrieval
 *
 * Features:
 * - Connect to multiple MCP servers via stdio transport
 * - Fetch resources and prompts from servers
 * - Graceful degradation if MCP is disabled or fails
 * - Non-blocking - doesn't interrupt existing workflows
 */
class MCPClientService {
    constructor(config) {
        this.clients = new Map();
        this.isInitialized = false;
        this.config = config;
    }
    /**
     * Initialize MCP connections
     * Called on plugin load
     */
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.get('enableMCP')) {
                console.log('MCP is disabled in settings');
                return;
            }
            const servers = this.config.get('mcpServers');
            if (!servers || servers.length === 0) {
                console.log('No MCP servers configured');
                return;
            }
            console.log(`Initializing ${servers.length} MCP servers...`);
            for (const serverConfig of servers) {
                if (serverConfig.enabled) {
                    try {
                        yield this.connectToServer(serverConfig);
                    }
                    catch (error) {
                        console.error(`Failed to connect to MCP server ${serverConfig.name}:`, error);
                        // Continue with other servers - don't let one failure block others
                    }
                }
            }
            this.isInitialized = true;
            console.log(`MCP initialized with ${this.clients.size} active connections`);
        });
    }
    /**
     * Connect to a single MCP server
     */
    connectToServer(serverConfig) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`Connecting to MCP server: ${serverConfig.name}`);
                // Create stdio transport
                const transport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: serverConfig.args || [],
                    env: serverConfig.env || {},
                });
                // Create client
                const client = new Client({
                    name: 'zeddal',
                    version: '1.0.0',
                }, {
                    capabilities: {},
                });
                // Connect
                yield client.connect(transport);
                // Store client
                this.clients.set(serverConfig.id, {
                    client,
                    transport,
                    config: serverConfig,
                });
                console.log(`Successfully connected to ${serverConfig.name}`);
            }
            catch (error) {
                console.error(`Failed to connect to ${serverConfig.name}:`, error);
                throw error;
            }
        });
    }
    /**
     * Retrieve context from all connected MCP servers
     * This is the main method called during transcription refinement
     */
    retrieveContext(query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.get('enableMCP') || !this.isInitialized) {
                return [];
            }
            if (this.clients.size === 0) {
                console.log('No active MCP connections');
                return [];
            }
            const contexts = [];
            for (const [serverId, mcpClient] of this.clients.entries()) {
                try {
                    const context = yield this.fetchContextFromServer(mcpClient, query);
                    if (context.resources.length > 0) {
                        contexts.push(context);
                    }
                }
                catch (error) {
                    console.error(`Failed to fetch context from ${mcpClient.config.name}:`, error);
                    // Continue with other servers - don't let one failure block others
                }
            }
            console.log(`Retrieved context from ${contexts.length} MCP servers`);
            return contexts;
        });
    }
    /**
     * Fetch context from a single server
     */
    fetchContextFromServer(mcpClient, query) {
        return __awaiter(this, void 0, void 0, function* () {
            const resources = [];
            try {
                // List available resources
                const resourcesResponse = yield mcpClient.client.listResources();
                if (resourcesResponse.resources && resourcesResponse.resources.length > 0) {
                    // Limit to first 5 resources to avoid overwhelming the LLM
                    const resourcesToFetch = resourcesResponse.resources.slice(0, 5);
                    for (const resource of resourcesToFetch) {
                        try {
                            // Read each resource
                            const resourceData = yield mcpClient.client.readResource({
                                uri: resource.uri,
                            });
                            if (resourceData.contents && resourceData.contents.length > 0) {
                                const content = resourceData.contents[0];
                                // Only handle text content for now
                                if (content.text && typeof content.text === 'string') {
                                    resources.push({
                                        uri: resource.uri,
                                        name: resource.name,
                                        description: resource.description,
                                        mimeType: content.mimeType || 'text/plain',
                                        content: content.text,
                                    });
                                }
                            }
                        }
                        catch (error) {
                            console.error(`Failed to read resource ${resource.uri}:`, error);
                            // Continue with other resources
                        }
                    }
                }
            }
            catch (error) {
                console.error(`Failed to list resources from ${mcpClient.config.name}:`, error);
            }
            return {
                serverId: mcpClient.config.id,
                serverName: mcpClient.config.name,
                resources,
                timestamp: Date.now(),
            };
        });
    }
    /**
     * Disconnect from all MCP servers
     * Called on plugin unload
     */
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(`Disconnecting from ${this.clients.size} MCP servers...`);
            for (const [serverId, mcpClient] of this.clients.entries()) {
                try {
                    yield mcpClient.client.close();
                    console.log(`Disconnected from ${mcpClient.config.name}`);
                }
                catch (error) {
                    console.error(`Error disconnecting from ${mcpClient.config.name}:`, error);
                }
            }
            this.clients.clear();
            this.isInitialized = false;
        });
    }
    /**
     * Reconnect to all servers (useful after settings change)
     */
    reconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.disconnect();
            yield this.initialize();
        });
    }
    /**
     * Check if MCP is available and ready
     */
    isReady() {
        return this.isInitialized && this.clients.size > 0;
    }
    /**
     * Get connection status for each server
     */
    getStatus() {
        const servers = this.config.get('mcpServers');
        return servers.map((server) => ({
            serverId: server.id,
            serverName: server.name,
            connected: this.clients.has(server.id),
        }));
    }
}

/**
 * AudioFileService: Manages saving and loading audio recordings
 * Architecture: Persistent audio storage with metadata tracking
 *
 * Features:
 * - Save audio blobs to vault with unique filenames
 * - Load audio files for playback or re-transcription
 * - Generate metadata files alongside audio
 * - Support drag-and-drop workflow
 */
class AudioFileService {
    constructor(app, config) {
        this.app = app;
        this.config = config;
    }
    /**
     * Save audio recording to vault
     * Creates audio file and optional metadata JSON
     */
    saveRecording(audioChunk) {
        return __awaiter(this, void 0, void 0, function* () {
            const recordingsPath = this.config.get('recordingsPath');
            // Ensure recordings directory exists
            yield this.ensureDirectory(recordingsPath);
            // Generate unique filename
            const timestamp = audioChunk.timestamp;
            const date = new Date(timestamp);
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
            // Determine file extension from mime type
            const extension = this.getExtensionFromMimeType(audioChunk.blob.type);
            const filename = `recording-${dateStr}-${timeStr}.${extension}`;
            const filePath = obsidian.normalizePath(`${recordingsPath}/${filename}`);
            // Convert blob to ArrayBuffer
            const arrayBuffer = yield audioChunk.blob.arrayBuffer();
            // Write audio file
            yield this.app.vault.adapter.writeBinary(filePath, arrayBuffer);
            console.log(`Saved audio recording: ${filePath} (${audioChunk.blob.size} bytes)`);
            const savedFile = {
                filePath,
                timestamp,
                duration: audioChunk.duration,
                mimeType: audioChunk.blob.type,
                size: audioChunk.blob.size,
            };
            // Save metadata JSON for easier lookup
            yield this.saveMetadata(savedFile);
            return savedFile;
        });
    }
    /**
     * Load audio file from vault
     */
    loadRecording(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const arrayBuffer = yield this.app.vault.adapter.readBinary(filePath);
            const mimeType = this.getMimeTypeFromPath(filePath);
            const blob = new Blob([arrayBuffer], { type: mimeType });
            // Try to load metadata for duration
            const metadata = yield this.loadMetadata(filePath);
            return {
                blob,
                timestamp: (metadata === null || metadata === void 0 ? void 0 : metadata.timestamp) || Date.now(),
                duration: (metadata === null || metadata === void 0 ? void 0 : metadata.duration) || 0,
            };
        });
    }
    /**
     * Save metadata JSON alongside audio file
     */
    saveMetadata(savedFile) {
        return __awaiter(this, void 0, void 0, function* () {
            const metadataPath = this.getMetadataPath(savedFile.filePath);
            const metadata = JSON.stringify(savedFile, null, 2);
            try {
                yield this.app.vault.adapter.write(metadataPath, metadata);
            }
            catch (error) {
                console.warn(`Failed to save metadata for ${savedFile.filePath}:`, error);
            }
        });
    }
    /**
     * Load metadata JSON for audio file
     */
    loadMetadata(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const metadataPath = this.getMetadataPath(filePath);
            try {
                const exists = yield this.app.vault.adapter.exists(metadataPath);
                if (!exists) {
                    return null;
                }
                const content = yield this.app.vault.adapter.read(metadataPath);
                return JSON.parse(content);
            }
            catch (error) {
                console.warn(`Failed to load metadata for ${filePath}:`, error);
                return null;
            }
        });
    }
    /**
     * Update metadata with transcription result
     */
    updateMetadata(filePath, updates) {
        return __awaiter(this, void 0, void 0, function* () {
            const existingMetadata = yield this.loadMetadata(filePath);
            if (!existingMetadata) {
                console.warn(`No metadata found for ${filePath}`);
                return;
            }
            const updatedMetadata = Object.assign(Object.assign({}, existingMetadata), updates);
            yield this.saveMetadata(updatedMetadata);
        });
    }
    /**
     * Get metadata file path for audio file
     */
    getMetadataPath(audioPath) {
        return audioPath.replace(/\.(webm|mp3|wav|m4a|ogg)$/, '.metadata.json');
    }
    /**
     * Ensure directory exists, creating if necessary
     */
    ensureDirectory(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedPath = obsidian.normalizePath(path);
            const exists = yield this.app.vault.adapter.exists(normalizedPath);
            if (!exists) {
                yield this.app.vault.createFolder(normalizedPath);
                console.log(`Created recordings directory: ${normalizedPath}`);
            }
        });
    }
    /**
     * Get file extension from MIME type
     */
    getExtensionFromMimeType(mimeType) {
        if (mimeType.includes('webm'))
            return 'webm';
        if (mimeType.includes('mp3'))
            return 'mp3';
        if (mimeType.includes('wav'))
            return 'wav';
        if (mimeType.includes('m4a'))
            return 'm4a';
        if (mimeType.includes('ogg'))
            return 'ogg';
        return 'webm'; // Default fallback
    }
    /**
     * Get MIME type from file path
     */
    getMimeTypeFromPath(path) {
        if (path.endsWith('.webm'))
            return 'audio/webm;codecs=opus';
        if (path.endsWith('.mp3'))
            return 'audio/mpeg';
        if (path.endsWith('.wav'))
            return 'audio/wav';
        if (path.endsWith('.m4a'))
            return 'audio/mp4';
        if (path.endsWith('.ogg'))
            return 'audio/ogg;codecs=opus';
        return 'audio/webm;codecs=opus'; // Default fallback
    }
    /**
     * Check if file is an audio recording that can be processed
     */
    isAudioFile(path) {
        const audioExtensions = ['.webm', '.mp3', '.wav', '.m4a', '.ogg'];
        return audioExtensions.some(ext => path.toLowerCase().endsWith(ext));
    }
    /**
     * List all recordings in the recordings folder
     */
    listRecordings() {
        return __awaiter(this, void 0, void 0, function* () {
            const recordingsPath = this.config.get('recordingsPath');
            const recordings = [];
            try {
                const files = this.app.vault.getFiles();
                for (const file of files) {
                    if (file.path.startsWith(recordingsPath) && this.isAudioFile(file.path)) {
                        const metadata = yield this.loadMetadata(file.path);
                        if (metadata) {
                            recordings.push(metadata);
                        }
                        else {
                            // Create basic metadata from file stats
                            recordings.push({
                                filePath: file.path,
                                timestamp: file.stat.ctime,
                                duration: 0,
                                mimeType: this.getMimeTypeFromPath(file.path),
                                size: file.stat.size,
                            });
                        }
                    }
                }
            }
            catch (error) {
                console.error('Failed to list recordings:', error);
            }
            // Sort by timestamp descending (newest first)
            return recordings.sort((a, b) => b.timestamp - a.timestamp);
        });
    }
    /**
     * Delete audio file and its metadata
     */
    deleteRecording(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Delete audio file
                const audioFile = this.app.vault.getAbstractFileByPath(filePath);
                if (audioFile) {
                    yield this.app.vault.delete(audioFile);
                }
                // Delete metadata file
                const metadataPath = this.getMetadataPath(filePath);
                const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);
                if (metadataFile) {
                    yield this.app.vault.delete(metadataFile);
                }
                console.log(`Deleted recording: ${filePath}`);
            }
            catch (error) {
                console.error(`Failed to delete recording ${filePath}:`, error);
                throw error;
            }
        });
    }
}

/**
 * VaultOps: Safe vault file operations
 * Architecture: Read/write with Obsidian API and history tracking
 * Status: Phase 2 - Implemented
 */
class VaultOps {
    constructor(app) {
        this.app = app;
    }
    /**
     * Read file content by path
     */
    read(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedPath = obsidian.normalizePath(filePath);
            const file = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (!file || !(file instanceof obsidian.TFile)) {
                throw new Error(`File not found: ${filePath}`);
            }
            return yield this.app.vault.read(file);
        });
    }
    /**
     * Write file with backup (overwrites existing)
     */
    write(filePath, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedPath = obsidian.normalizePath(filePath);
            const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (existingFile && existingFile instanceof obsidian.TFile) {
                // Create backup before overwriting
                const existingContent = yield this.app.vault.read(existingFile);
                yield this.createBackup(normalizedPath, existingContent);
                // Overwrite existing file
                yield this.app.vault.modify(existingFile, content);
                eventBus.emit('file-modified', { path: normalizedPath, content });
                return existingFile;
            }
            else {
                // Create new file
                return yield this.create(normalizedPath, content);
            }
        });
    }
    /**
     * Create new file (ensures parent folders exist)
     */
    create(filePath, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedPath = obsidian.normalizePath(filePath);
            // Ensure parent folder exists
            const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
            if (parentPath) {
                yield this.ensureFolderExists(parentPath);
            }
            // Check if file already exists
            const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (existingFile) {
                throw new Error(`File already exists: ${filePath}`);
            }
            const file = yield this.app.vault.create(normalizedPath, content);
            eventBus.emit('file-created', { path: normalizedPath, content });
            return file;
        });
    }
    /**
     * Append to existing file (creates if doesn't exist)
     */
    append(filePath_1, content_1) {
        return __awaiter(this, arguments, void 0, function* (filePath, content, separator = '\n\n') {
            const normalizedPath = obsidian.normalizePath(filePath);
            const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (existingFile && existingFile instanceof obsidian.TFile) {
                // Create backup before modifying
                const existingContent = yield this.app.vault.read(existingFile);
                yield this.createBackup(normalizedPath, existingContent);
                // Append content
                const newContent = existingContent + separator + content;
                yield this.app.vault.modify(existingFile, newContent);
                eventBus.emit('file-modified', { path: normalizedPath, content: newContent });
                return existingFile;
            }
            else {
                // Create new file
                return yield this.create(normalizedPath, content);
            }
        });
    }
    /**
     * Insert at cursor position in active file
     */
    insertAtCursor(content) {
        return __awaiter(this, void 0, void 0, function* () {
            const activeLeaf = this.app.workspace.activeLeaf;
            if (!activeLeaf) {
                throw new Error('No active leaf found');
            }
            const view = activeLeaf.view;
            if (view.getViewType() !== 'markdown') {
                throw new Error('Active view is not a markdown editor');
            }
            // Access the editor through the view state
            const editor = view.editor;
            if (!editor) {
                throw new Error('No editor found in active markdown view');
            }
            const cursor = editor.getCursor();
            editor.replaceRange(content, cursor);
            eventBus.emit('content-inserted', { content, position: cursor });
        });
    }
    /**
     * Get the folder path for the currently active file, if any
     */
    getActiveFolderPath() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            return null;
        }
        const path = activeFile.path || '';
        const segments = path.split('/');
        segments.pop(); // remove filename
        const folderPath = segments.join('/');
        return folderPath || null;
    }
    /**
     * Get vault root path
     */
    getVaultRoot() {
        const rootPath = this.app.vault.getRoot().path || '';
        if (!rootPath || rootPath === '/' || rootPath === '\\') {
            return '';
        }
        return rootPath;
    }
    /**
     * Create a new daily note or append to existing
     */
    createOrAppendDailyNote(content) {
        return __awaiter(this, void 0, void 0, function* () {
            const dailyNotesFolder = 'Daily Notes'; // TODO: Make this configurable
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
            const filePath = `${dailyNotesFolder}/${dateStr}.md`;
            return yield this.append(filePath, content);
        });
    }
    /**
     * List all markdown files in vault
     */
    listMarkdownFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.app.vault.getMarkdownFiles();
        });
    }
    /**
     * Search for files by name pattern
     */
    findFilesByName(pattern) {
        return __awaiter(this, void 0, void 0, function* () {
            const allFiles = yield this.listMarkdownFiles();
            const regex = new RegExp(pattern, 'i');
            return allFiles.filter((file) => regex.test(file.name));
        });
    }
    /**
     * Ensure folder exists (creates if missing)
     */
    ensureFolderExists(folderPath) {
        return __awaiter(this, void 0, void 0, function* () {
            const normalizedPath = obsidian.normalizePath(folderPath);
            const existingFolder = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (!existingFolder) {
                yield this.app.vault.createFolder(normalizedPath);
            }
            else if (!(existingFolder instanceof obsidian.TFolder)) {
                throw new Error(`Path exists but is not a folder: ${folderPath}`);
            }
        });
    }
    /**
     * Create backup with timestamp
     */
    createBackup(filePath, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const timestamp = Date.now();
            const backupPath = `${filePath}.${timestamp}.bak`;
            try {
                yield this.app.vault.adapter.write(backupPath, content);
                eventBus.emit('backup-created', { original: filePath, backup: backupPath });
            }
            catch (error) {
                console.error('Failed to create backup:', error);
                // Don't throw - backup failure shouldn't block the operation
            }
        });
    }
    /**
     * Get file by path
     */
    getFile(filePath) {
        const normalizedPath = obsidian.normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        return file instanceof obsidian.TFile ? file : null;
    }
    /**
     * Check if file exists
     */
    exists(filePath) {
        const normalizedPath = obsidian.normalizePath(filePath);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        return file instanceof obsidian.TFile;
    }
}

/**
 * VoiceCommandProcessor: Process voice commands for wikilinks and formatting
 * Architecture: Post-process transcriptions to convert voice commands to markdown
 */
const COMMAND_STOP_WORDS = [
    'and',
    'but',
    'or',
    'so',
    'because',
    'while',
    'when',
    'then',
    'than',
    'the',
    'a',
    'an',
    'in',
    'on',
    'at',
    'for',
    'with',
    'from',
    'by',
    'about',
    'as',
    'of',
    'is',
    'was',
    'are',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'should',
    'could',
    'may',
    'might',
    'can',
    'must',
    'shall',
    'that',
    'this',
    'these',
    'those',
    'there',
    'here',
    'it',
    'he',
    'she',
    'we',
    'they',
    'you',
];
const STOP_PATTERN = `(?:\\s+(?:${COMMAND_STOP_WORDS.join('|')})\\b|[.,;!?]|$)`;
const LINK_COMMAND_REGEX = new RegExp(`zeddal\\s+link\\s+([a-zA-Z0-9][a-zA-Z0-9\\s'\\-]{0,80}?)\\s+to\\s+([a-zA-Z0-9][a-zA-Z0-9\\s'\\-]{0,120}?)(?=${STOP_PATTERN})`, 'gi');
const SIMPLE_LINK_REGEX = new RegExp(`zeddal\\s+link\\s+([a-zA-Z0-9][a-zA-Z0-9\\s'\\-]{0,80}?)(?=${STOP_PATTERN})`, 'gi');
const SENTENCE_LINK_REGEX = /(^|\.\s+)link\s+([a-zA-Z0-9\-']+)/gi;
class VoiceCommandProcessor {
    /**
     * Process transcription text and convert voice commands to markdown
     */
    static process(text) {
        let processed = text;
        // Normalize common misrecognitions of "zeddal"
        processed = this.normalizeWakeWord(processed);
        // Process wikilink commands
        processed = this.processExplicitLinkCommands(processed);
        processed = this.processSimpleLinkCommands(processed);
        processed = this.processSentenceLinkCommands(processed);
        // Normalize brand name mentions
        processed = this.normalizeBrandName(processed);
        return processed;
    }
    /**
     * Normalize common misrecognitions of the "zeddal" wake word
     * Common misrecognitions: zettle,zettel, zetal, zedal, sedal, etc.
     */
    static normalizeWakeWord(text) {
        // Replace common misrecognitions (including concatenated/hyphenated forms) with "zeddal link"
        return text.replace(/(zeddal|zettle|zettel|zetal|zedal|sedal|zettal|zeddle|zedle|zetl)(?:\s*|-)?link(?![a-z])/gi, 'zeddal link');
    }
    /**
     * Handle "Zeddal link <display> to <existing note>" commands
     */
    static processExplicitLinkCommands(text) {
        return text.replace(LINK_COMMAND_REGEX, (_match, displayRaw, targetRaw) => {
            const display = this.cleanPhrase(displayRaw);
            const target = this.cleanPhrase(targetRaw);
            if (!target) {
                return display || targetRaw;
            }
            return this.formatWikilink(target, display);
        });
    }
    /**
     * Handle "Zeddal link <phrase>" shorthand commands
     */
    static processSimpleLinkCommands(text) {
        return text.replace(SIMPLE_LINK_REGEX, (_match, phraseRaw) => {
            const phrase = this.cleanPhrase(phraseRaw);
            return phrase ? this.formatWikilink(phrase) : phraseRaw;
        });
    }
    /**
     * Handle sentence-starting "Link <word>" fallback
     */
    static processSentenceLinkCommands(text) {
        return text.replace(SENTENCE_LINK_REGEX, (match, prefix, word) => {
            const cleaned = this.cleanPhrase(word, 1);
            return cleaned ? `${prefix}${this.formatWikilink(cleaned)}` : match;
        });
    }
    /**
     * Normalize standalone mentions of the brand name to "Zeddal"
     */
    static normalizeBrandName(text) {
        return text.replace(/\b(zeddal|zettle|zettel|zetal|zedal|sedal|zettal|zeddle|zedle|zetl)\b/gi, 'Zeddal');
    }
    /**
     * Extract potential wikilinks that user mentioned
     * This helps identify what the user might want to link to
     */
    static extractLinkCandidates(text) {
        const candidates = [];
        const normalized = this.normalizeWakeWord(text);
        // Explicit commands
        for (const match of normalized.matchAll(LINK_COMMAND_REGEX)) {
            const displaySegment = this.cleanPhrase(match[1]);
            const targetSegment = this.cleanPhrase(match[2]);
            if (targetSegment) {
                candidates.push(targetSegment);
            }
            if (displaySegment && displaySegment !== targetSegment) {
                candidates.push(displaySegment);
            }
        }
        // Simple commands
        for (const match of normalized.matchAll(SIMPLE_LINK_REGEX)) {
            const phrase = this.cleanPhrase(match[1]);
            if (phrase)
                candidates.push(phrase);
        }
        return candidates;
    }
    /**
     * Check if text contains voice commands
     */
    static hasVoiceCommands(text) {
        // Normalize first to capture wake-word variants like "ZettelLink"
        const normalized = this.normalizeWakeWord(text);
        const hasWakeWord = /zeddal\s+link/gi.test(normalized);
        SENTENCE_LINK_REGEX.lastIndex = 0;
        const hasSentenceLink = SENTENCE_LINK_REGEX.test(normalized);
        return hasWakeWord || hasSentenceLink;
    }
    /**
     * Preview what commands would be processed
     * Useful for showing user what will happen
     */
    static previewCommands(text) {
        const previews = [];
        const normalized = this.normalizeWakeWord(text);
        for (const match of normalized.matchAll(LINK_COMMAND_REGEX)) {
            const display = this.cleanPhrase(match[1]);
            const target = this.cleanPhrase(match[2]);
            if (!target)
                continue;
            previews.push({
                original: match[0],
                processed: this.formatWikilink(target, display),
            });
        }
        for (const match of normalized.matchAll(SIMPLE_LINK_REGEX)) {
            const phrase = this.cleanPhrase(match[1]);
            if (!phrase)
                continue;
            previews.push({
                original: match[0],
                processed: this.formatWikilink(phrase),
            });
        }
        return previews;
    }
    /**
     * Clean a spoken phrase by trimming, collapsing whitespace, and limiting words
     */
    static cleanPhrase(phrase, wordLimit = 6) {
        if (!phrase)
            return '';
        const trimmed = phrase
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/^[^a-zA-Z0-9]+/, '')
            .replace(/[^a-zA-Z0-9]+$/, '');
        if (!trimmed)
            return '';
        return trimmed
            .split(' ')
            .filter(Boolean)
            .slice(0, wordLimit)
            .join(' ');
    }
    /**
     * Format a wikilink, optionally with alias
     */
    static formatWikilink(target, display) {
        if (!display || display.toLowerCase() === target.toLowerCase()) {
            return `[[${target}]]`;
        }
        return `[[${target}|${display}]]`;
    }
}

/**
 * LinkResolver: Ensures voice command wikilinks target existing vault notes
 */
class LinkResolver {
    /**
     * Resolve wikilinks in text to canonical vault note titles when possible.
     */
    static resolveExistingNotes(text_1, vaultOps_1) {
        return __awaiter(this, arguments, void 0, function* (text, vaultOps, options = {}) {
            try {
                const files = yield vaultOps.listMarkdownFiles();
                if (!files || files.length === 0) {
                    return text;
                }
                const index = this.buildIndex(files);
                let output = text.replace(/\[\[([^\]\|]+)(\|([^\]]+))?\]\]/g, (match, rawTarget, aliasWithPipe, alias) => {
                    const canonical = this.findCanonicalTitle(rawTarget, index);
                    if (!canonical) {
                        return match;
                    }
                    if (alias) {
                        return `[[${canonical}|${alias.trim()}]]`;
                    }
                    return `[[${canonical}]]`;
                });
                if (options.autoLinkFirstMatch) {
                    output = this.autoLinkFirstMatch(output, index);
                }
                return output;
            }
            catch (error) {
                console.error('LinkResolver failed to resolve notes:', error);
                return text;
            }
        });
    }
    /**
     * Build searchable index of vault notes.
     */
    static buildIndex(files) {
        const seen = new Set();
        const index = [];
        for (const file of files) {
            const normalized = this.normalize(file.basename);
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            index.push({
                title: file.basename,
                normalized,
                regex: this.createMatchRegex(file.basename),
                folderPath: this.getFolderPath(file),
            });
        }
        return index;
    }
    /**
     * Attempt to find the canonical vault title for a spoke target.
     */
    static findCanonicalTitle(target, notes) {
        const normalizedTarget = this.normalize(target);
        if (!normalizedTarget)
            return null;
        // Exact normalized match first
        const exact = notes.find((note) => note.normalized === normalizedTarget);
        if (exact) {
            return exact.title;
        }
        // Fuzzy match: Contains / StartsWith
        const containsMatch = notes.find((note) => note.normalized.includes(normalizedTarget) ||
            normalizedTarget.includes(note.normalized));
        if (containsMatch) {
            return containsMatch.title;
        }
        return null;
    }
    /**
     * Normalize phrases for loose comparison.
     */
    static normalize(value) {
        return value
            .toLowerCase()
            .replace(/[\[\]\(\)\{\}\.,'"`]/g, '')
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }
    /**
     * Attempt to link the earliest plain-text occurrence of a vault note
     */
    static autoLinkFirstMatch(text, notes) {
        if (!notes.length || !text)
            return text;
        const existingRanges = this.findExistingLinkRanges(text);
        let bestMatch = null;
        for (const note of notes) {
            note.regex.lastIndex = 0;
            const match = note.regex.exec(text);
            if (!match)
                continue;
            const start = match.index;
            const end = start + match[0].length;
            if (this.isInsideExistingLink(start, existingRanges))
                continue;
            if (!bestMatch || start < bestMatch.start) {
                bestMatch = {
                    start,
                    end,
                    title: note.title,
                    original: match[0],
                };
            }
        }
        if (!bestMatch)
            return text;
        const before = text.slice(0, bestMatch.start);
        const after = text.slice(bestMatch.end);
        const needsAlias = bestMatch.original.toLowerCase() !== bestMatch.title.toLowerCase();
        const link = needsAlias
            ? `[[${bestMatch.title}|${bestMatch.original}]]`
            : `[[${bestMatch.title}]]`;
        return `${before}${link}${after}`;
    }
    static findExistingLinkRanges(text) {
        const ranges = [];
        const regex = /\[\[[^\]]+\]\]/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
        return ranges;
    }
    static isInsideExistingLink(index, ranges) {
        return ranges.some((range) => index >= range.start && index <= range.end);
    }
    static createMatchRegex(title) {
        const escaped = title
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\s+/g, '\\s+');
        return new RegExp(`\\b${escaped}\\b`, 'i');
    }
    static getFolderPath(file) {
        const path = file.path || '';
        const slashIndex = path.lastIndexOf('/');
        if (slashIndex === -1) {
            return '';
        }
        return path.substring(0, slashIndex);
    }
    /**
     * Suggest a folder based on the first matching note reference in content
     */
    static suggestFolderForContent(text, vaultOps) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!text || !text.trim())
                return null;
            try {
                const files = yield vaultOps.listMarkdownFiles();
                if (!files || files.length === 0) {
                    return null;
                }
                const index = this.buildIndex(files);
                const ranges = this.findExistingLinkRanges(text);
                let best = null;
                for (const note of index) {
                    note.regex.lastIndex = 0;
                    const match = note.regex.exec(text);
                    if (!match)
                        continue;
                    const start = match.index;
                    if (this.isInsideExistingLink(start, ranges))
                        continue;
                    if (!best || start < best.start) {
                        best = {
                            start,
                            folder: note.folderPath,
                        };
                    }
                }
                if (!best)
                    return null;
                return best.folder || null;
            }
            catch (error) {
                console.error('LinkResolver.suggestFolderForContent failed:', error);
                return null;
            }
        });
    }
}

const mapConfidenceToStatus = (score) => {
    const value = Math.max(0, Math.min(1, score || 0));
    if (value >= 0.85) {
        return {
            label: 'Ready to share',
            color: 'success',
            helpText: 'Transcription looks excellent. You can confidently share it as-is.',
        };
    }
    if (value >= 0.7) {
        return {
            label: 'A quick skim is recommended',
            color: 'info',
            helpText: 'Most of the transcript looks solid. Give it a quick skim before sharing.',
        };
    }
    if (value >= 0.5) {
        return {
            label: 'We flagged a few uncertain words.',
            color: 'warning',
            helpText: 'Some words need a closer look. Review the highlighted segments below.',
        };
    }
    return {
        label: 'Audio quality or unclear speech affected accuracy.',
        color: 'danger',
        helpText: 'Audio was difficult to process. Carefully verify the transcript.',
    };
};

/**
 * RecordModal: Recording interface with live progress
 * Architecture: Modal showing confidence %, duration, pause/resume/stop controls
 */
class RecordModal extends obsidian.Modal {
    constructor(app, recorderService, whisperService, llmRefineService, vaultOps, toast, plugin, contextLinkService, vaultRAGService, mcpClientService, audioFileService, savedAudioFile) {
        super(app);
        this.plugin = plugin;
        this.contextLinkService = contextLinkService;
        this.isRecording = false;
        this.isProcessing = false; // Prevent duplicate transcription
        this.unsubscribers = []; // Track event unsubscribers
        this.currentTranscription = '';
        this.updateInterval = null;
        this.equalizerBars = [];
        this.equalizerContainer = null;
        this.equalizerWrapper = null;
        this.linkCount = 0;
        this.lastUpdated = null;
        this.lastTelemetrySnapshot = {
            speakingTimeMs: 0,
            totalRecordingTimeMs: 0,
        };
        this.savedAudioFile = null;
        this.audioPlayer = null;
        this.recorderService = recorderService;
        this.whisperService = whisperService;
        this.llmRefineService = llmRefineService;
        this.vaultRAGService = vaultRAGService;
        this.mcpClientService = mcpClientService;
        this.audioFileService = audioFileService;
        this.vaultOps = vaultOps;
        this.toast = toast;
        this.savedAudioFile = savedAudioFile || null;
    }
    onOpen() {
        // If opening with existing audio file (drag-and-drop scenario),
        // skip recording and go directly to transcription
        if (this.savedAudioFile) {
            this.renderTranscriptionUI();
            this.processExistingAudio();
        }
        else {
            this.renderRecordingUI();
            this.setupEventListeners();
            this.startRecording();
        }
    }
    onClose() {
        var _a;
        this.cleanup();
        this.teardownEventListeners();
        (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.setState('idle', 'Ready');
    }
    /**
     * Start recording
     */
    startRecording() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                yield this.recorderService.start();
                this.isRecording = true;
                this.startUIUpdates();
                this.lastUpdated = new Date();
                (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.setState('listening', 'Listening…');
            }
            catch (error) {
                console.error('Failed to start recording:', error);
                this.toast.error('Failed to access microphone');
                this.close();
            }
        });
    }
    /**
     * Stop recording and transcribe
     */
    stopRecording() {
        var _a;
        if (!this.isRecording)
            return;
        this.isRecording = false;
        this.recorderService.stop();
        this.statusEl.textContent = 'Processing...';
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.setEqualizerPaused(true);
        (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.setState('processing', 'Processing…');
    }
    /**
     * Toggle pause/resume
     */
    togglePause() {
        const state = this.recorderService.getState();
        if (state.isPaused) {
            this.recorderService.resume();
            this.pauseBtn.textContent = 'Pause';
            this.statusEl.innerHTML =
                '<span class="zeddal-recording-pulse"></span> Recording...';
            this.setEqualizerPaused(false);
        }
        else {
            this.recorderService.pause();
            this.pauseBtn.textContent = 'Resume';
            this.statusEl.textContent = '⏸ Paused';
            this.setEqualizerPaused(true);
        }
    }
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for recording stopped
        const unsubStop = eventBus.on('recording-stopped', (event) => __awaiter(this, void 0, void 0, function* () {
            if (this.isProcessing) {
                console.log('Already processing, ignoring duplicate event');
                return;
            }
            this.isProcessing = true;
            const { audioChunk } = event.data;
            yield this.handleTranscription(audioChunk);
        }));
        this.unsubscribers.push(unsubStop);
        // Listen for errors
        const unsubError = eventBus.on('error', (event) => {
            console.error('Recording error:', event.data);
            this.toast.error(event.data.message || 'An error occurred');
            this.close();
        });
        this.unsubscribers.push(unsubError);
    }
    /**
     * Handle transcription of recorded audio
     */
    handleTranscription(audioChunk) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                const fileSizeMB = (audioChunk.blob.size / (1024 * 1024)).toFixed(1);
                const durationSec = Math.floor(audioChunk.duration / 1000);
                this.statusEl.textContent = `Transcribing audio (${fileSizeMB} MB, ~${durationSec}s)...`;
                if (!this.whisperService.isReady()) {
                    throw new Error('Whisper service not configured. Please add OpenAI API key.');
                }
                (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.setState('processing', 'Processing…');
                const transcription = yield this.whisperService.transcribe(audioChunk);
                // Process voice commands (convert "zeddal link word" to [[word]])
                const processedText = VoiceCommandProcessor.process(transcription.text);
                const resolvedText = yield LinkResolver.resolveExistingNotes(processedText, this.vaultOps, { autoLinkFirstMatch: true });
                const contextLinked = this.pluginSettings().autoContextLinks
                    ? yield this.contextLinkService.applyContextLinks(resolvedText)
                    : { text: resolvedText, matches: 0 };
                this.currentTranscription = contextLinked.text;
                this.linkCount = this.countLinks(this.currentTranscription);
                (_b = this.statusBar()) === null || _b === void 0 ? void 0 : _b.setLinkCount(this.linkCount);
                console.log('Transcription result:', transcription);
                console.log('Processed text:', processedText);
                // Show command preview if voice commands detected
                if (VoiceCommandProcessor.hasVoiceCommands(transcription.text)) {
                    const commands = VoiceCommandProcessor.previewCommands(transcription.text);
                    console.log('Voice commands detected:', commands);
                    this.toast.info(`Detected ${commands.length} link command(s)`);
                }
                // Display transcription result in modal
                if (this.statusEl) {
                    this.statusEl.textContent = '✓ Transcription Complete';
                    if (this.statusEl.style) {
                        this.statusEl.style.color = 'var(--text-accent)';
                    }
                }
                // Show the transcription text in the modal
                const resultContainer = this.contentEl.createDiv('zeddal-result');
                resultContainer.createEl('h3', { text: 'Transcription:' });
                const textEl = resultContainer.createEl('p', {
                    text: this.currentTranscription || transcription.text || '(no speech detected)',
                    cls: 'zeddal-transcription-text'
                });
                textEl.style.whiteSpace = 'pre-wrap';
                textEl.style.padding = '12px';
                textEl.style.backgroundColor = 'var(--background-secondary)';
                textEl.style.borderRadius = '6px';
                textEl.style.marginTop = '12px';
                this.renderLinkSummary(resultContainer, this.linkCount, 'Links detected');
                // Replace the control buttons with new actions (only if they exist from recording UI)
                if (this.pauseBtn) {
                    this.pauseBtn.style.display = 'none';
                }
                if (this.stopBtn) {
                    this.stopBtn.remove();
                }
                this.destroyEqualizer();
                const actionsContainer = this.contentEl.createDiv('zeddal-actions');
                actionsContainer.style.display = 'flex';
                actionsContainer.style.gap = '8px';
                actionsContainer.style.marginTop = '16px';
                // Play Recording button (if audio was saved)
                if (this.savedAudioFile) {
                    const playBtn = actionsContainer.createEl('button', {
                        text: '▶ Play Recording',
                        cls: 'mod-cta'
                    });
                    playBtn.onclick = () => this.playAudio();
                }
                // Copy button
                const copyBtn = actionsContainer.createEl('button', {
                    text: 'Copy',
                    cls: 'mod-cta'
                });
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(this.currentTranscription);
                    this.toast.success('Copied to clipboard!');
                };
                // Save as-is button
                const saveRawBtn = actionsContainer.createEl('button', {
                    text: 'Save Raw Copy',
                    cls: 'mod-cta'
                });
                saveRawBtn.onclick = () => this.quickSaveRawCopy();
                if (this.pluginSettings().autoSaveRaw) {
                    yield this.autoSaveRawTranscript();
                }
                // Refine & Save button
                const refineBtn = actionsContainer.createEl('button', {
                    text: 'Refine & Save',
                    cls: 'mod-cta'
                });
                refineBtn.onclick = () => this.showSaveOptions(true);
                const rerecordBtn = actionsContainer.createEl('button', {
                    text: 'Re-record',
                    cls: 'mod-warning'
                });
                rerecordBtn.onclick = () => this.restartRecordingSession();
                // Close button
                const closeBtn = actionsContainer.createEl('button', {
                    text: 'Close',
                });
                closeBtn.onclick = () => this.close();
                this.lastUpdated = new Date();
                (_c = this.statusBar()) === null || _c === void 0 ? void 0 : _c.setState('saved', 'Saved successfully');
                setTimeout(() => { var _a; return (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.setState('idle', 'Ready'); }, 4000);
                this.toast.success('Transcription complete!');
            }
            catch (error) {
                console.error('Transcription failed:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('Error details:', errorMessage);
                this.toast.error(`Transcription failed: ${errorMessage}`);
                this.close();
            }
        });
    }
    /**
     * Show save location options
     */
    showSaveOptions(refine) {
        return __awaiter(this, void 0, void 0, function* () {
            // Clear existing UI
            this.contentEl.empty();
            this.contentEl.addClass('zeddal-save-modal');
            this.destroyEqualizer();
            const title = this.contentEl.createEl('h2', {
                text: refine ? 'Refining & Saving...' : 'Choose Save Location'
            });
            let noteToSave = this.currentTranscription;
            let noteTitle = '';
            // If refining, show progress
            if (refine) {
                this.statusEl = this.contentEl.createDiv('zeddal-status');
                // Retrieve RAG context if enabled
                let ragContext = [];
                let ragFolders = [];
                if (this.pluginSettings().enableRAG) {
                    this.statusEl.textContent = '🔍 Analyzing vault context...';
                    try {
                        ragContext = yield this.vaultRAGService.retrieveContext(this.currentTranscription);
                        if (ragContext.length > 0) {
                            // Extract folder names from context for display
                            ragFolders = ragContext.map(ctx => {
                                const match = ctx.match(/From "(.+)":/);
                                if (match) {
                                    const path = match[1];
                                    return path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : 'Root';
                                }
                                return 'Unknown';
                            });
                            const uniqueFolders = [...new Set(ragFolders)];
                            this.statusEl.textContent = `✓ Found ${ragContext.length} similar notes in: ${uniqueFolders.join(', ')}`;
                            yield new Promise(resolve => setTimeout(resolve, 1200)); // Brief pause to show status
                        }
                        else {
                            this.statusEl.textContent = 'ℹ️ No similar notes found (using general refinement)';
                            yield new Promise(resolve => setTimeout(resolve, 800));
                        }
                    }
                    catch (error) {
                        console.error('RAG context retrieval failed:', error);
                        // Continue without context on error
                    }
                }
                // Retrieve MCP context if enabled
                let mcpContext = [];
                if (this.pluginSettings().enableMCP && this.mcpClientService.isReady()) {
                    this.statusEl.textContent = '🔌 Fetching MCP context...';
                    try {
                        const mcpContexts = yield this.mcpClientService.retrieveContext(this.currentTranscription);
                        if (mcpContexts.length > 0) {
                            // Convert MCP contexts to string format
                            mcpContext = mcpContexts.flatMap(ctx => ctx.resources.map(resource => `From MCP server "${ctx.serverName}" (${resource.name}):\n${resource.content}`));
                            const serverNames = mcpContexts.map(ctx => ctx.serverName).join(', ');
                            const totalResources = mcpContexts.reduce((sum, ctx) => sum + ctx.resources.length, 0);
                            this.statusEl.textContent = `✓ Retrieved ${totalResources} resource(s) from ${mcpContexts.length} MCP server(s): ${serverNames}`;
                            yield new Promise(resolve => setTimeout(resolve, 1200));
                        }
                    }
                    catch (error) {
                        console.error('MCP context retrieval failed:', error);
                        // Continue without MCP - don't block refinement
                    }
                }
                // Combine RAG and MCP context
                const combinedContext = [...ragContext, ...mcpContext];
                this.statusEl.textContent = '✨ Refining with GPT-4 (Step 1/2: Analyzing)...';
                try {
                    // Show progress during refinement
                    setTimeout(() => {
                        if (this.statusEl) {
                            this.statusEl.textContent = '✨ Refining with GPT-4 (Step 2/2: Generating)...';
                        }
                    }, 1500);
                    const refined = yield this.llmRefineService.refine(this.currentTranscription, combinedContext);
                    noteToSave = yield LinkResolver.resolveExistingNotes(refined.body, this.vaultOps, {
                        autoLinkFirstMatch: true,
                    });
                    noteTitle = refined.title;
                    const wordCount = noteToSave.split(/\s+/).length;
                    const contextSummary = `${ragContext.length} RAG + ${mcpContext.length} MCP chunks`;
                    this.statusEl.textContent = `✓ Refinement complete (${wordCount} words, ${contextSummary} used)`;
                    this.statusEl.style.color = 'var(--text-accent)';
                    // Show refined result
                    const refinedContainer = this.contentEl.createDiv('zeddal-refined-result');
                    refinedContainer.createEl('h3', { text: 'Refined Note:' });
                    const refinedText = refinedContainer.createEl('p', {
                        text: noteToSave,
                        cls: 'zeddal-transcription-text'
                    });
                    refinedText.style.whiteSpace = 'pre-wrap';
                    refinedText.style.padding = '12px';
                    refinedText.style.backgroundColor = 'var(--background-secondary)';
                    refinedText.style.borderRadius = '6px';
                    refinedText.style.marginBottom = '16px';
                    refinedText.style.maxHeight = '300px';
                    refinedText.style.overflow = 'auto';
                    const refinedLinkCount = this.countLinks(noteToSave);
                    this.renderLinkSummary(refinedContainer, refinedLinkCount, 'Links ready to save');
                }
                catch (error) {
                    console.error('Refinement failed:', error);
                    this.toast.error('Refinement failed. Saving raw transcription instead.');
                    noteToSave = this.currentTranscription;
                }
                title.textContent = 'Choose Save Location';
            }
            // Title input section
            const titleSection = this.contentEl.createDiv('zeddal-title-section');
            titleSection.style.marginBottom = '16px';
            const titleLabel = titleSection.createEl('label', {
                text: 'Note Title (for new notes):',
                cls: 'zeddal-title-label'
            });
            titleLabel.style.display = 'block';
            titleLabel.style.marginBottom = '8px';
            titleLabel.style.fontWeight = '500';
            const titleInput = titleSection.createEl('input', {
                type: 'text',
                placeholder: 'Enter custom title or leave blank for auto-generated',
                value: noteTitle,
                cls: 'zeddal-title-input'
            });
            titleInput.style.width = '100%';
            titleInput.style.padding = '8px 12px';
            titleInput.style.border = '1px solid var(--background-modifier-border)';
            titleInput.style.borderRadius = '4px';
            titleInput.style.backgroundColor = 'var(--background-primary)';
            titleInput.style.color = 'var(--text-normal)';
            titleInput.style.fontSize = '14px';
            // Allow Enter key to save as new note
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const customTitle = titleInput.value.trim();
                    this.saveAsNewNote(noteToSave, customTitle || noteTitle);
                }
            });
            // Save location options
            const optionsContainer = this.contentEl.createDiv('zeddal-save-options');
            const newNoteBtn = optionsContainer.createEl('button', {
                text: 'New Note',
                cls: 'mod-cta'
            });
            newNoteBtn.onclick = () => {
                const customTitle = titleInput.value.trim();
                this.saveAsNewNote(noteToSave, customTitle || noteTitle);
            };
            const dailyNoteBtn = optionsContainer.createEl('button', {
                text: 'Append to Daily Note',
                cls: 'mod-cta'
            });
            dailyNoteBtn.onclick = () => this.appendToDailyNote(noteToSave);
            const cursorBtn = optionsContainer.createEl('button', {
                text: 'Insert at Cursor',
                cls: 'mod-cta'
            });
            cursorBtn.onclick = () => this.insertAtCursor(noteToSave);
            const cancelBtn = optionsContainer.createEl('button', {
                text: 'Cancel'
            });
            cancelBtn.onclick = () => this.close();
            // Focus the title input for easy editing
            setTimeout(() => titleInput.focus(), 100);
        });
    }
    /**
     * Save as new note
     */
    saveAsNewNote(content, title) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                // Sanitize filename by removing invalid characters
                let fileName = title || `Voice Note ${new Date().toISOString().split('T')[0]}`;
                fileName = this.sanitizeFileName(fileName);
                const folderPath = yield this.determineTargetFolder(content);
                const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
                const contentWithMeta = this.appendTelemetryMetadata(content);
                yield this.vaultOps.create(filePath, contentWithMeta);
                this.contextLinkService.markDirty();
                (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.flagRawSaved();
                // Enhanced success message showing folder location
                const folderDisplay = folderPath || 'Root';
                this.toast.success(`✓ Created note in ${folderDisplay}/`);
                this.close();
            }
            catch (error) {
                console.error('Failed to create note:', error);
                if (error instanceof Error && error.message.includes('already exists')) {
                    // Try with timestamp
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const fileName = `Voice Note ${timestamp}`;
                    const folderPath = yield this.determineTargetFolder(content);
                    const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
                    yield this.vaultOps.create(filePath, this.appendTelemetryMetadata(content));
                    this.contextLinkService.markDirty();
                    this.toast.success(`Created note: ${fileName}`);
                    this.close();
                }
                else {
                    this.toast.error('Failed to create note');
                }
            }
        });
    }
    /**
     * Sanitize filename by removing invalid characters
     */
    sanitizeFileName(fileName) {
        // Remove or replace invalid characters: \ / : * ? " < > |
        return fileName
            .replace(/[\\/:*?"<>|]/g, '-') // Replace invalid chars with dash
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/^\.+/, '') // Remove leading dots
            .trim();
    }
    /**
     * Append to daily note
     */
    appendToDailyNote(content) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.vaultOps.createOrAppendDailyNote(this.appendTelemetryMetadata(content));
                this.contextLinkService.markDirty();
                this.toast.success('Appended to daily note');
                this.close();
            }
            catch (error) {
                console.error('Failed to append to daily note:', error);
                this.toast.error('Failed to append to daily note');
            }
        });
    }
    /**
     * Insert at cursor position
     */
    insertAtCursor(content) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.vaultOps.insertAtCursor(this.appendTelemetryMetadata(content));
                this.contextLinkService.markDirty();
                this.toast.success('Inserted at cursor');
                this.close();
            }
            catch (error) {
                console.error('Failed to insert at cursor:', error);
                this.toast.error('Failed to insert at cursor. Is a note open?');
            }
        });
    }
    /**
     * Start UI updates
     */
    startUIUpdates() {
        this.updateInterval = window.setInterval(() => {
            if (!this.isRecording)
                return;
            const state = this.recorderService.getState();
            this.updateUI(state);
        }, 100); // Update every 100ms for smooth progress
    }
    /**
     * Update UI with current state
     */
    updateUI(state) {
        var _a;
        // Update trust status display and subtle progress cues
        this.renderConfidenceStatus(state.confidence);
        const confidencePercent = Math.round(state.confidence * 100);
        this.progressBar.style.width = `${confidencePercent}%`;
        if (confidencePercent > 70) {
            this.progressBar.style.backgroundColor = 'var(--text-accent)';
        }
        else if (confidencePercent > 40) {
            this.progressBar.style.backgroundColor = 'var(--text-warning)';
        }
        else {
            this.progressBar.style.backgroundColor = 'var(--text-error)';
        }
        // Update telemetry displays
        const telemetry = this.recorderService.getTelemetrySnapshot();
        this.lastTelemetrySnapshot = telemetry;
        this.speakingEl.textContent = this.formatSeconds(telemetry.speakingTimeMs);
        this.recordingEl.textContent = this.formatSeconds(telemetry.totalRecordingTimeMs);
        (_a = this.statusBar()) === null || _a === void 0 ? void 0 : _a.updateTelemetry(telemetry);
        this.updateEqualizer(state.confidence);
    }
    /**
     * Cleanup on close
     */
    cleanup() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.isRecording) {
            this.recorderService.stop();
        }
        this.destroyEqualizer();
    }
    /**
     * Create the live equalizer visualization
     */
    createEqualizer(parent) {
        this.equalizerWrapper = parent.createDiv('zeddal-eq-wrapper');
        const wrapper = this.equalizerWrapper;
        const label = wrapper.createEl('div', { text: 'Live capture', cls: 'zeddal-eq-label' });
        label.setAttr('aria-hidden', 'true');
        this.equalizerContainer = wrapper.createDiv('zeddal-equalizer');
        this.equalizerBars = [];
        for (let i = 0; i < 14; i++) {
            const bar = this.equalizerContainer.createDiv('zeddal-equalizer-bar');
            bar.style.height = `${10 + i % 4 * 5}%`;
            this.equalizerBars.push(bar);
        }
    }
    /**
     * Destroy equalizer DOM references
     */
    destroyEqualizer() {
        this.equalizerBars = [];
        if (this.equalizerWrapper) {
            this.equalizerWrapper.remove();
            this.equalizerWrapper = null;
        }
        if (this.equalizerContainer) {
            this.equalizerContainer.remove();
            this.equalizerContainer = null;
        }
    }
    /**
     * Update equalizer bars based on confidence level
     */
    updateEqualizer(level) {
        if (!this.equalizerContainer || this.equalizerBars.length === 0)
            return;
        if (this.equalizerContainer.classList.contains('is-paused'))
            return;
        const clamped = Math.max(0, Math.min(1, level));
        this.equalizerBars.forEach((bar, index) => {
            const noise = (Math.sin(Date.now() / 180 + index) + 1) / 2;
            const variance = 0.35 + noise * 0.65;
            const height = Math.max(10, Math.min(96, (clamped * 90 * variance) + 8));
            bar.style.height = `${height}%`;
            bar.style.opacity = `${0.35 + clamped * 0.65}`;
        });
    }
    /**
     * Set equalizer paused state
     */
    setEqualizerPaused(paused) {
        if (!this.equalizerContainer)
            return;
        this.equalizerContainer.classList.toggle('is-paused', paused);
        if (paused) {
            this.equalizerBars.forEach((bar, idx) => {
                bar.style.height = `${10 + (idx % 3) * 4}%`;
            });
        }
    }
    /**
     * Determine best folder location for a new note
     * Uses RAG-based semantic similarity to find the folder with most related content
     */
    determineTargetFolder(content) {
        return __awaiter(this, void 0, void 0, function* () {
            // Use RAG to find semantically similar notes
            try {
                const similarContexts = yield this.vaultRAGService.retrieveContext(content);
                if (similarContexts.length > 0) {
                    // Extract folder paths from similar notes
                    const folderCounts = new Map();
                    for (const context of similarContexts) {
                        // Extract file path from context (format: 'From "path/to/file.md":\n...')
                        const pathMatch = context.match(/From "(.+)":/);
                        if (pathMatch) {
                            const filePath = pathMatch[1];
                            // Get folder path (everything before the last /)
                            const folderPath = filePath.includes('/')
                                ? filePath.substring(0, filePath.lastIndexOf('/'))
                                : '';
                            // Count occurrences of each folder
                            const count = folderCounts.get(folderPath) || 0;
                            folderCounts.set(folderPath, count + 1);
                        }
                    }
                    // Find folder with most similar content
                    let maxCount = 0;
                    let bestFolder = null;
                    for (const [folder, count] of folderCounts.entries()) {
                        if (count > maxCount) {
                            maxCount = count;
                            bestFolder = folder;
                        }
                    }
                    if (bestFolder !== null) {
                        console.log(`RAG determined best folder: "${bestFolder}" with ${maxCount} similar notes`);
                        return bestFolder || null; // Return null if root folder (empty string)
                    }
                }
            }
            catch (error) {
                console.error('Failed to determine folder using RAG:', error);
            }
            // Fallback: try LinkResolver
            const contextualFolder = yield LinkResolver.suggestFolderForContent(this.currentTranscription || content, this.vaultOps);
            if (contextualFolder) {
                return contextualFolder;
            }
            // Fallback: use active folder if available
            const activeFolder = this.vaultOps.getActiveFolderPath();
            if (activeFolder) {
                return activeFolder;
            }
            // Final fallback: voice notes folder from settings
            return this.plugin.settings.voiceNotesFolder || null;
        });
    }
    /**
     * Render the core recording UI shell
     */
    renderRecordingUI() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.removeClass('zeddal-save-modal');
        contentEl.addClass('zeddal-record-modal');
        const title = contentEl.createEl('h2', { text: 'Zeddal Recording' });
        title.addClass('zeddal-modal-title');
        this.statusEl = contentEl.createDiv('zeddal-status');
        this.statusEl.innerHTML = '<span class="zeddal-recording-pulse"></span> Recording...';
        this.createEqualizer(contentEl);
        const progressContainer = contentEl.createDiv('zeddal-progress-container');
        this.progressBar = progressContainer.createDiv('zeddal-progress-bar');
        const metricsContainer = contentEl.createDiv('zeddal-metrics');
        const speakingContainer = metricsContainer.createDiv('zeddal-metric');
        speakingContainer.createEl('label', { text: 'Speaking (s)' });
        this.speakingEl = speakingContainer.createEl('span', {
            text: '0.00s',
            cls: 'zeddal-metric-value',
        });
        const recordedContainer = metricsContainer.createDiv('zeddal-metric');
        recordedContainer.createEl('label', { text: 'Recorded (s)' });
        this.recordingEl = recordedContainer.createEl('span', {
            text: '0.00s',
            cls: 'zeddal-metric-value',
        });
        const confidenceContainer = metricsContainer.createDiv('zeddal-metric');
        confidenceContainer.createEl('label', { text: 'Audio clarity' });
        this.confidenceEl = confidenceContainer.createDiv('zeddal-confidence-status');
        const controls = contentEl.createDiv('zeddal-controls');
        this.pauseBtn = controls.createEl('button', {
            text: 'Pause',
            cls: 'mod-cta',
        });
        this.pauseBtn.onclick = () => this.togglePause();
        this.stopBtn = controls.createEl('button', {
            text: 'Stop & Transcribe',
            cls: 'mod-warning',
        });
        this.stopBtn.onclick = () => this.stopRecording();
    }
    /**
     * Render minimal UI for existing audio transcription
     */
    renderTranscriptionUI() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('zeddal-modal');
        contentEl.createEl('h2', { text: 'Process Audio Recording' });
        this.statusEl = contentEl.createDiv('zeddal-status');
        this.statusEl.textContent = 'Loading audio...';
    }
    /**
     * Process existing audio file (drag-and-drop scenario)
     */
    processExistingAudio() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.savedAudioFile) {
                this.toast.error('No audio file provided');
                this.close();
                return;
            }
            try {
                // Load audio chunk from file
                const audioChunk = yield this.audioFileService.loadRecording(this.savedAudioFile.filePath);
                // Process transcription
                yield this.handleTranscription(audioChunk);
            }
            catch (error) {
                console.error('Failed to process existing audio:', error);
                this.toast.error('Failed to process audio file');
                this.close();
            }
        });
    }
    /**
     * Play audio recording
     */
    playAudio() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.savedAudioFile) {
                this.toast.error('No audio file available');
                return;
            }
            try {
                // Cleanup existing player if any
                if (this.audioPlayer) {
                    this.audioPlayer.pause();
                    this.audioPlayer.remove();
                    this.audioPlayer = null;
                }
                // Load audio file
                const audioChunk = yield this.audioFileService.loadRecording(this.savedAudioFile.filePath);
                const audioUrl = URL.createObjectURL(audioChunk.blob);
                // Create audio player
                this.audioPlayer = new Audio(audioUrl);
                this.audioPlayer.controls = true;
                this.audioPlayer.style.width = '100%';
                this.audioPlayer.style.marginTop = '12px';
                // Add to modal
                const audioContainer = this.contentEl.querySelector('.zeddal-result');
                if (audioContainer) {
                    audioContainer.appendChild(this.audioPlayer);
                }
                else {
                    this.contentEl.appendChild(this.audioPlayer);
                }
                // Play audio
                yield this.audioPlayer.play();
                this.toast.success('Playing recording');
                // Cleanup URL when done
                this.audioPlayer.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                };
            }
            catch (error) {
                console.error('Failed to play audio:', error);
                this.toast.error('Failed to play recording');
            }
        });
    }
    /**
     * Teardown event listeners
     */
    teardownEventListeners() {
        this.unsubscribers.forEach((unsub) => unsub());
        this.unsubscribers = [];
        // Cleanup audio player
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.remove();
            this.audioPlayer = null;
        }
    }
    /**
     * Restart the recording session
     */
    restartRecordingSession() {
        return __awaiter(this, void 0, void 0, function* () {
            this.cleanup();
            this.teardownEventListeners();
            this.destroyEqualizer();
            this.isProcessing = false;
            this.isRecording = false;
            this.currentTranscription = '';
            this.linkCount = 0;
            this.renderRecordingUI();
            this.setupEventListeners();
            try {
                yield this.startRecording();
                this.toast.info('Ready for a new take');
            }
            catch (error) {
                console.error('Failed to restart recording:', error);
                this.toast.error('Unable to restart recording session');
                this.close();
            }
        });
    }
    /**
     * Render link summary magic-moment indicator
     */
    renderLinkSummary(container, count, label) {
        const summary = container.createDiv('zeddal-link-summary');
        summary.textContent =
            count > 0 ? `✨ ${label}: ${count} ${count === 1 ? 'link' : 'links'}` : `✨ ${label}: none yet`;
    }
    /**
     * Count wikilinks in given text
     */
    countLinks(text) {
        if (!text)
            return 0;
        const matches = text.match(/\[\[[^\]]+\]\]/g);
        return matches ? matches.length : 0;
    }
    autoSaveRawTranscript() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.writeRawFile(this.currentTranscription, true);
        });
    }
    quickSaveRawCopy() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.writeRawFile(this.currentTranscription, false);
        });
    }
    writeRawFile(content_1) {
        return __awaiter(this, arguments, void 0, function* (content, silent = false) {
            if (!(content === null || content === void 0 ? void 0 : content.trim()))
                return;
            try {
                const title = this.generateRawTitle(content);
                const heading = `# ${title}\n\n`;
                const body = this.appendTelemetryMetadata(heading + content);
                const timestamp = new Date().toLocaleString();
                let fileName = this.sanitizeFileName(`RAW - ${title} - ${timestamp}`);
                const folderPath = yield this.determineTargetFolder(content);
                let filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
                try {
                    yield this.vaultOps.create(filePath, body);
                }
                catch (error) {
                    const fallback = `${fileName}-${Date.now()}`;
                    filePath = folderPath ? `${folderPath}/${fallback}.md` : `${fallback}.md`;
                    yield this.vaultOps.create(filePath, body);
                }
                this.contextLinkService.markDirty();
                if (!silent) {
                    this.toast.info(`Raw note saved: ${fileName}`);
                }
            }
            catch (error) {
                console.error('Raw save failed:', error);
                if (!silent) {
                    this.toast.error('Unable to save raw note');
                }
            }
        });
    }
    generateRawTitle(content) {
        const clean = content.replace(/\s+/g, ' ').trim();
        if (!clean) {
            const date = new Date();
            return `Voice Note ${date.toLocaleDateString()}`;
        }
        const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
        const snippet = sentence.substring(0, 60).trim();
        return snippet || `Voice Note ${new Date().toLocaleDateString()}`;
    }
    pluginSettings() {
        var _a;
        return ((_a = this.plugin) === null || _a === void 0 ? void 0 : _a.settings) || {};
    }
    renderConfidenceStatus(score) {
        if (!this.confidenceEl)
            return;
        const status = mapConfidenceToStatus(score);
        const timestamp = this.lastUpdated
            ? this.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        this.confidenceEl.empty();
        const row = this.confidenceEl.createDiv({ cls: 'zeddal-status-row' });
        row.createSpan({ text: 'Audio clarity: ', cls: 'zeddal-status-label' });
        row.createSpan({
            text: status.label,
            cls: `zeddal-status-chip zeddal-status-${status.color}`,
        });
        const helpIcon = row.createSpan({ text: ' ⓘ', cls: 'zeddal-status-help' });
        helpIcon.setAttr('title', `${status.helpText}\nConfidence: ${(score * 100).toFixed(1)}%`);
        if (timestamp) {
            const ts = this.confidenceEl.createDiv({ cls: 'zeddal-status-timestamp' });
            ts.textContent = `Last updated: ${timestamp}`;
        }
    }
    appendTelemetryMetadata(content) {
        const speaking = this.formatSeconds(this.lastTelemetrySnapshot.speakingTimeMs);
        const recorded = this.formatSeconds(this.lastTelemetrySnapshot.totalRecordingTimeMs);
        const meta = `> Transcription meta\n> Speaking: ${speaking}\n> Recorded: ${recorded}`;
        const trimmed = content.trimEnd();
        return `${trimmed}\n\n${meta}`;
    }
    formatSeconds(ms) {
        const seconds = Math.max(0, ms / 1000);
        return `${seconds.toFixed(2)}s`;
    }
    statusBar() {
        var _a, _b;
        return (_b = (_a = this.plugin) === null || _a === void 0 ? void 0 : _a.statusBar) !== null && _b !== void 0 ? _b : null;
    }
}

/**
 * MicButton: Ribbon icon to trigger recording modal
 * Architecture: Simple toggle for RecordModal with visual feedback
 */
class MicButton {
    constructor(plugin, recorderService, whisperService, llmRefineService, vaultOps, toast, contextLinkService, vaultRAGService, audioFileService) {
        this.ribbonIcon = null;
        this.plugin = plugin;
        this.recorderService = recorderService;
        this.whisperService = whisperService;
        this.llmRefineService = llmRefineService;
        this.vaultOps = vaultOps;
        this.toast = toast;
        this.contextLinkService = contextLinkService;
        this.vaultRAGService = vaultRAGService;
        this.audioFileService = audioFileService;
    }
    /**
     * Add microphone button to ribbon
     */
    addToRibbon() {
        this.ribbonIcon = this.plugin.addRibbonIcon('microphone', 'Zeddal: Record voice note', (evt) => {
            this.startRecording(evt);
        });
        this.ribbonIcon.addClass('zeddal-ribbon-icon');
    }
    /**
     * Handle button click
     */
    startRecording(evt) {
        // Check if Whisper service is configured
        if (!this.whisperService.isReady()) {
            this.toast.warning('Please configure OpenAI API key in settings');
            return;
        }
        // Open recording modal
        const modal = new RecordModal(this.plugin.app, this.recorderService, this.whisperService, this.llmRefineService, this.vaultOps, this.toast, this.plugin, this.contextLinkService, this.vaultRAGService, this.plugin.mcpClientService, this.audioFileService);
        modal.open();
    }
    /**
     * Remove button from ribbon
     */
    remove() {
        if (this.ribbonIcon) {
            this.ribbonIcon.remove();
            this.ribbonIcon = null;
        }
    }
    /**
     * Update button state (for future use)
     */
    setActive(active) {
        if (this.ribbonIcon) {
            if (active) {
                this.ribbonIcon.addClass('zeddal-ribbon-active');
            }
            else {
                this.ribbonIcon.removeClass('zeddal-ribbon-active');
            }
        }
    }
}

/**
 * Toast: Non-blocking notification system
 * Architecture: Obsidian-styled toast notifications for user feedback
 */
class Toast {
    constructor() {
        this.container = null;
        this.activeToasts = new Set();
        this.initContainer();
    }
    /**
     * Initialize toast container
     */
    initContainer() {
        this.container = document.createElement('div');
        this.container.addClass('zeddal-toast-container');
        document.body.appendChild(this.container);
    }
    /**
     * Show a toast notification
     */
    show(options) {
        if (!this.container) {
            this.initContainer();
        }
        const { message, type = 'info', duration = 4000, action, } = options;
        const toast = this.createToast(message, type, action);
        this.container.appendChild(toast);
        this.activeToasts.add(toast);
        // Trigger animation
        setTimeout(() => toast.addClass('zeddal-toast-show'), 10);
        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => this.dismiss(toast), duration);
        }
    }
    /**
     * Show info toast
     */
    info(message, duration) {
        this.show({ message, type: 'info', duration });
    }
    /**
     * Show success toast
     */
    success(message, duration) {
        this.show({ message, type: 'success', duration });
    }
    /**
     * Show warning toast
     */
    warning(message, duration) {
        this.show({ message, type: 'warning', duration });
    }
    /**
     * Show error toast
     */
    error(message, duration) {
        this.show({ message, type: 'error', duration });
    }
    /**
     * Create toast element
     */
    createToast(message, type, action) {
        const toast = document.createElement('div');
        toast.addClass('zeddal-toast', `zeddal-toast-${type}`);
        // Icon
        const icon = this.getIconForType(type);
        const iconEl = document.createElement('span');
        iconEl.addClass('zeddal-toast-icon');
        iconEl.textContent = icon;
        toast.appendChild(iconEl);
        // Message
        const messageEl = document.createElement('span');
        messageEl.addClass('zeddal-toast-message');
        messageEl.textContent = message;
        toast.appendChild(messageEl);
        // Action button
        if (action) {
            const actionBtn = document.createElement('button');
            actionBtn.addClass('zeddal-toast-action');
            actionBtn.textContent = action.label;
            actionBtn.onclick = () => {
                action.callback();
                this.dismiss(toast);
            };
            toast.appendChild(actionBtn);
        }
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.addClass('zeddal-toast-close');
        closeBtn.textContent = '×';
        closeBtn.onclick = () => this.dismiss(toast);
        toast.appendChild(closeBtn);
        return toast;
    }
    /**
     * Dismiss a toast
     */
    dismiss(toast) {
        if (!this.activeToasts.has(toast))
            return;
        toast.removeClass('zeddal-toast-show');
        toast.addClass('zeddal-toast-hide');
        setTimeout(() => {
            toast.remove();
            this.activeToasts.delete(toast);
        }, 300); // Match CSS transition duration
    }
    /**
     * Get icon for toast type
     */
    getIconForType(type) {
        switch (type) {
            case 'success':
                return '✓';
            case 'warning':
                return '⚠';
            case 'error':
                return '✕';
            default:
                return 'ℹ';
        }
    }
    /**
     * Clear all active toasts
     */
    clearAll() {
        this.activeToasts.forEach((toast) => this.dismiss(toast));
    }
    /**
     * Cleanup on unload
     */
    destroy() {
        this.clearAll();
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }
}

class OnboardingModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('zeddal-record-modal');
        contentEl.createEl('h2', { text: 'Welcome to Zeddal' });
        contentEl.createEl('p', {
            text: 'To keep your data private and costs under your control, Zeddal requires you to bring your own API key. You can use OpenAI or point to a custom self-hosted endpoint.',
            cls: 'setting-item-description',
        });
        let provider = this.plugin.settings.llmProvider || 'openai';
        let apiKey = this.plugin.settings.openaiApiKey || '';
        let customBase = this.plugin.settings.customApiBase || '';
        let customTranscribe = this.plugin.settings.customTranscriptionUrl || '';
        new obsidian.Setting(contentEl)
            .setName('Provider')
            .setDesc('Choose OpenAI or a custom OpenAI-compatible endpoint')
            .addDropdown((dropdown) => {
            dropdown
                .addOption('openai', 'OpenAI (api.openai.com)')
                .addOption('custom', 'Custom / Self-hosted')
                .setValue(provider)
                .onChange((value) => {
                provider = value;
                customSection.toggleClass('is-hidden', provider !== 'custom');
            });
        });
        new obsidian.Setting(contentEl)
            .setName('API Key')
            .setDesc('Paste the key issued by your provider. This is stored locally inside Obsidian.')
            .addText((text) => text
            .setPlaceholder('sk-...')
            .setValue(apiKey)
            .onChange((value) => (apiKey = value.trim())));
        const customSection = contentEl.createDiv('zeddal-onboarding-custom');
        if (provider !== 'custom')
            customSection.addClass('is-hidden');
        new obsidian.Setting(customSection)
            .setName('Custom API base URL')
            .setDesc('Example: https://my-llm.example.com/v1')
            .addText((text) => text
            .setPlaceholder('https://hosted-llm.example.com/v1')
            .setValue(customBase)
            .onChange((value) => (customBase = value.trim())));
        new obsidian.Setting(customSection)
            .setName('Custom transcription endpoint')
            .setDesc('If your Whisper server uses a different URL, add it here')
            .addText((text) => text
            .setPlaceholder('https://my-llm.example.com/audio/transcriptions')
            .setValue(customTranscribe)
            .onChange((value) => (customTranscribe = value.trim())));
        const actions = contentEl.createDiv('zeddal-controls');
        const docsLink = actions.createEl('button', { text: 'How to get a key' });
        docsLink.onclick = () => {
            window.open('https://platform.openai.com/account/api-keys', '_blank');
        };
        const saveBtn = actions.createEl('button', {
            text: 'Save & Continue',
            cls: 'mod-cta',
        });
        saveBtn.onclick = () => __awaiter(this, void 0, void 0, function* () {
            if (provider === 'openai' && !apiKey) {
                new obsidian.Notice('Please provide an API key.');
                return;
            }
            this.plugin.settings.llmProvider = provider;
            this.plugin.settings.openaiApiKey = apiKey;
            this.plugin.settings.customApiBase = customBase;
            this.plugin.settings.customTranscriptionUrl = customTranscribe;
            yield this.plugin.saveSettings();
            new obsidian.Notice('Zeddal is ready. You can adjust these settings later.');
            this.close();
        });
    }
    onClose() {
        this.contentEl.empty();
    }
}

class ContextLinkService {
    constructor(app) {
        this.app = app;
        this.index = [];
        this.isDirty = true;
        this.lastBuilt = 0;
    }
    markDirty() {
        this.isDirty = true;
    }
    shouldRebuild() {
        const TEN_MINUTES = 10 * 60 * 1000;
        return this.isDirty || Date.now() - this.lastBuilt > TEN_MINUTES;
    }
    ensureIndex() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.shouldRebuild())
                return;
            const files = this.app.vault.getMarkdownFiles();
            this.index = files.map((file) => ({
                title: file.basename,
                normalized: this.normalize(file.basename),
            }));
            this.lastBuilt = Date.now();
            this.isDirty = false;
        });
    }
    applyContextLinks(text) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(text === null || text === void 0 ? void 0 : text.trim())) {
                return { text, matches: 0 };
            }
            yield this.ensureIndex();
            if (!this.index.length) {
                return { text, matches: 0 };
            }
            const sortByLength = [...this.index].sort((a, b) => b.title.length - a.title.length);
            let output = text;
            let matches = 0;
            for (const entry of sortByLength) {
                if (!entry.title || entry.title.length < 3)
                    continue;
                const pattern = this.buildRegex(entry.title);
                output = output.replace(pattern, (match, captured) => {
                    matches += 1;
                    const aliasNeeded = captured.toLowerCase() !== entry.title.toLowerCase();
                    return aliasNeeded
                        ? `[[${entry.title}|${captured}]]`
                        : `[[${entry.title}]]`;
                });
            }
            return { text: output, matches };
        });
    }
    buildRegex(title) {
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<!\\[\\[)(${escaped})(?![^\\]]*\\]\])`, 'gi');
    }
    normalize(value) {
        return value.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
}

class LinkInspectorModal extends obsidian.Modal {
    constructor(app, plugin, contextLinkService) {
        super(app);
        this.plugin = plugin;
        this.contextLinkService = contextLinkService;
        this.candidates = [];
    }
    onOpen() {
        return __awaiter(this, void 0, void 0, function* () {
            const { contentEl } = this;
            contentEl.empty();
            contentEl.addClass('zeddal-record-modal');
            contentEl.createEl('h2', { text: 'Zeddal Link Inspector' });
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                contentEl.createEl('p', { text: 'Open a note to inspect contextual links.' });
                return;
            }
            const raw = yield this.app.vault.read(activeFile);
            const linked = yield this.contextLinkService.applyContextLinks(raw);
            const matches = linked.matches;
            if (!matches) {
                contentEl.createEl('p', { text: 'No link opportunities detected.' });
                return;
            }
            const preview = contentEl.createDiv('zeddal-refined-result');
            preview.createEl('h3', { text: 'Suggested Links:' });
            preview.createEl('p', {
                text: 'Click "Apply" to update the note with these wikilinks. A backup will be created automatically.',
                cls: 'setting-item-description',
            });
            const previewBlock = preview.createEl('pre', {
                text: linked.text,
                cls: 'zeddal-transcription-text',
            });
            previewBlock.style.maxHeight = '260px';
            previewBlock.style.overflow = 'auto';
            new obsidian.Setting(contentEl)
                .addButton((btn) => btn
                .setButtonText('Apply to note')
                .setCta()
                .onClick(() => __awaiter(this, void 0, void 0, function* () {
                const existingContent = yield this.plugin.app.vault.read(activeFile);
                const backupPath = `${activeFile.path}.${Date.now()}.bak`;
                yield this.plugin.app.vault.adapter.write(backupPath, existingContent);
                yield this.plugin.app.vault.modify(activeFile, linked.text);
                this.contextLinkService.markDirty();
                new obsidian.Notice(`Links applied. Backup created at ${backupPath}`);
                this.close();
            })))
                .addExtraButton((btn) => btn
                .setIcon('cross')
                .setTooltip('Cancel')
                .onClick(() => this.close()));
        });
    }
}

/**
 * RecordingHistoryModal: Browse and manage saved audio recordings
 * Architecture: List view with search, playback, and re-processing
 */
class RecordingHistoryModal extends obsidian.Modal {
    constructor(app, plugin, audioFileService, toast) {
        super(app);
        this.recordings = [];
        this.filteredRecordings = [];
        this.searchQuery = '';
        this.currentAudioPlayer = null;
        this.plugin = plugin;
        this.audioFileService = audioFileService;
        this.toast = toast;
    }
    onOpen() {
        return __awaiter(this, void 0, void 0, function* () {
            const { contentEl } = this;
            contentEl.empty();
            contentEl.addClass('zeddal-history-modal');
            // Title
            const titleContainer = contentEl.createDiv('zeddal-history-header');
            titleContainer.createEl('h2', { text: 'Recording History' });
            // Search bar
            const searchContainer = contentEl.createDiv('zeddal-history-search');
            const searchInput = searchContainer.createEl('input', {
                type: 'text',
                placeholder: '🔍 Search recordings...',
            });
            searchInput.addClass('zeddal-history-search-input');
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.filterAndRenderRecordings();
            });
            // Loading indicator
            const loadingEl = contentEl.createDiv('zeddal-history-loading');
            loadingEl.setText('Loading recordings...');
            try {
                // Load recordings
                this.recordings = yield this.audioFileService.listRecordings();
                this.filteredRecordings = [...this.recordings];
                // Remove loading indicator
                loadingEl.remove();
                // Render recordings
                this.renderRecordings(contentEl);
                // Action buttons
                this.renderActions(contentEl);
            }
            catch (error) {
                console.error('Failed to load recordings:', error);
                loadingEl.setText('Failed to load recordings');
                this.toast.error('Failed to load recording history');
            }
        });
    }
    onClose() {
        // Stop any playing audio
        if (this.currentAudioPlayer) {
            this.currentAudioPlayer.pause();
            this.currentAudioPlayer.remove();
            this.currentAudioPlayer = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }
    filterAndRenderRecordings() {
        // Filter recordings based on search query
        if (this.searchQuery.trim() === '') {
            this.filteredRecordings = [...this.recordings];
        }
        else {
            this.filteredRecordings = this.recordings.filter(recording => {
                const fileName = recording.filePath.toLowerCase();
                const transcription = (recording.transcription || '').toLowerCase();
                return fileName.includes(this.searchQuery) || transcription.includes(this.searchQuery);
            });
        }
        // Re-render the list
        const listContainer = this.contentEl.querySelector('.zeddal-history-list');
        if (listContainer) {
            listContainer.remove();
        }
        this.renderRecordings(this.contentEl);
    }
    renderRecordings(container) {
        const listContainer = container.createDiv('zeddal-history-list');
        if (this.filteredRecordings.length === 0) {
            const emptyState = listContainer.createDiv('zeddal-history-empty');
            emptyState.createEl('p', {
                text: this.searchQuery
                    ? 'No recordings match your search'
                    : 'No recordings found. Start recording to see your history!'
            });
            return;
        }
        // Group recordings by date
        const grouped = this.groupRecordingsByDate(this.filteredRecordings);
        for (const [dateLabel, recordings] of Object.entries(grouped)) {
            // Date header
            const dateHeader = listContainer.createDiv('zeddal-history-date-header');
            dateHeader.createEl('h3', { text: dateLabel });
            // Recording items
            for (const recording of recordings) {
                this.renderRecordingItem(listContainer, recording);
            }
        }
    }
    renderRecordingItem(container, recording) {
        var _a;
        const item = container.createDiv('zeddal-history-item');
        // Icon and info
        const infoContainer = item.createDiv('zeddal-history-item-info');
        infoContainer.createEl('span', { text: '🎙️', cls: 'zeddal-history-item-icon' });
        const details = infoContainer.createDiv('zeddal-history-item-details');
        // File name (without extension and path)
        const fileName = ((_a = recording.filePath.split('/').pop()) === null || _a === void 0 ? void 0 : _a.replace(/\.[^.]+$/, '')) || 'Recording';
        details.createEl('div', { text: fileName, cls: 'zeddal-history-item-title' });
        // Metadata
        const metadata = details.createDiv('zeddal-history-item-metadata');
        const durationText = this.formatDuration(recording.duration);
        const sizeText = this.formatFileSize(recording.size);
        const folder = recording.filePath.includes('/')
            ? recording.filePath.substring(0, recording.filePath.lastIndexOf('/'))
            : 'Root';
        metadata.createEl('span', { text: `${durationText} • ${sizeText} • ${folder}` });
        // Actions
        const actions = item.createDiv('zeddal-history-item-actions');
        // Play button
        const playBtn = actions.createEl('button', {
            text: '▶ Play',
            cls: 'mod-cta',
        });
        playBtn.addEventListener('click', () => this.playRecording(recording, playBtn));
        // Re-process button
        const reprocessBtn = actions.createEl('button', {
            text: '📝 Re-process',
        });
        reprocessBtn.addEventListener('click', () => this.reprocessRecording(recording));
        // Delete button
        const deleteBtn = actions.createEl('button', {
            text: '🗑️ Delete',
            cls: 'mod-warning',
        });
        deleteBtn.addEventListener('click', () => this.deleteRecording(recording, item));
    }
    playRecording(recording, button) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Stop any currently playing audio
                if (this.currentAudioPlayer) {
                    this.currentAudioPlayer.pause();
                    this.currentAudioPlayer.remove();
                    this.currentAudioPlayer = null;
                }
                // Load and play audio
                const audioChunk = yield this.audioFileService.loadRecording(recording.filePath);
                const audioUrl = URL.createObjectURL(audioChunk.blob);
                this.currentAudioPlayer = new Audio(audioUrl);
                this.currentAudioPlayer.addEventListener('ended', () => {
                    URL.revokeObjectURL(audioUrl);
                    button.setText('▶ Play');
                });
                button.setText('⏸ Playing...');
                yield this.currentAudioPlayer.play();
            }
            catch (error) {
                console.error('Failed to play recording:', error);
                this.toast.error('Failed to play recording');
                button.setText('▶ Play');
            }
        });
    }
    reprocessRecording(recording) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.toast.info('Opening recording for re-processing...');
                // Close history modal
                this.close();
                // Open RecordModal with existing audio file
                const modal = new RecordModal(this.app, this.plugin.recorderService, this.plugin.whisperService, this.plugin.llmRefineService, this.plugin.vaultOps, this.toast, this.plugin, this.plugin.contextLinkService, this.plugin.vaultRAGService, this.plugin.mcpClientService, this.audioFileService, recording // Pass the saved audio file
                );
                modal.open();
            }
            catch (error) {
                console.error('Failed to re-process recording:', error);
                this.toast.error('Failed to open recording');
            }
        });
    }
    deleteRecording(recording, itemEl) {
        return __awaiter(this, void 0, void 0, function* () {
            const confirmed = confirm(`Delete recording "${recording.filePath.split('/').pop()}"?\n\nThis cannot be undone.`);
            if (!confirmed) {
                return;
            }
            try {
                yield this.audioFileService.deleteRecording(recording.filePath);
                // Remove from list
                this.recordings = this.recordings.filter(r => r.filePath !== recording.filePath);
                this.filteredRecordings = this.filteredRecordings.filter(r => r.filePath !== recording.filePath);
                // Remove from UI
                itemEl.remove();
                this.toast.success('Recording deleted');
                // Show empty state if no recordings left
                if (this.filteredRecordings.length === 0) {
                    const listContainer = this.contentEl.querySelector('.zeddal-history-list');
                    if (listContainer) {
                        listContainer.remove();
                    }
                    this.renderRecordings(this.contentEl);
                }
            }
            catch (error) {
                console.error('Failed to delete recording:', error);
                this.toast.error('Failed to delete recording');
            }
        });
    }
    renderActions(container) {
        const actionsContainer = container.createDiv('zeddal-history-actions');
        const importBtn = actionsContainer.createEl('button', {
            text: '📂 Import Audio File',
            cls: 'mod-cta',
        });
        importBtn.addEventListener('click', () => {
            this.toast.info('Drag and drop audio files into Obsidian to import them');
            this.close();
        });
        const closeBtn = actionsContainer.createEl('button', {
            text: 'Close',
        });
        closeBtn.addEventListener('click', () => this.close());
    }
    groupRecordingsByDate(recordings) {
        const groups = {
            'Today': [],
            'Yesterday': [],
            'This Week': [],
            'This Month': [],
            'Older': [],
        };
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const oneWeekMs = 7 * oneDayMs;
        const oneMonthMs = 30 * oneDayMs;
        for (const recording of recordings) {
            const age = now - recording.timestamp;
            if (age < oneDayMs) {
                groups['Today'].push(recording);
            }
            else if (age < 2 * oneDayMs) {
                groups['Yesterday'].push(recording);
            }
            else if (age < oneWeekMs) {
                groups['This Week'].push(recording);
            }
            else if (age < oneMonthMs) {
                groups['This Month'].push(recording);
            }
            else {
                groups['Older'].push(recording);
            }
        }
        // Remove empty groups
        for (const key of Object.keys(groups)) {
            if (groups[key].length === 0) {
                delete groups[key];
            }
        }
        return groups;
    }
    formatDuration(ms) {
        if (ms === 0)
            return 'Unknown';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) {
            return `${remainingSeconds}s`;
        }
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    formatFileSize(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        else {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }
}

class StatusBar {
    constructor(app, onRecordRequest) {
        this.app = app;
        this.onRecordRequest = onRecordRequest;
        this.telemetrySnapshot = {
            speakingTimeMs: 0,
            totalRecordingTimeMs: 0,
        };
        this.currentState = 'idle';
        this.lastLinkCount = 0;
        this.lastRawSaved = false;
        this.isRecording = false;
        this.dragState = {
            isDragging: false,
            offsetX: 0,
            offsetY: 0,
        };
        this.handlePointerDown = (event) => {
            const target = event.target;
            if (target === null || target === void 0 ? void 0 : target.closest('.zeddal-status-record')) {
                return;
            }
            if (event.button !== undefined && event.button !== 0) {
                return;
            }
            this.dragState.isDragging = true;
            const rect = this.getContainerRect();
            this.dragState.offsetX = event.clientX - rect.left;
            this.dragState.offsetY = event.clientY - rect.top;
            this.container.classList.add('is-dragging');
            this.attachGlobalDragListeners();
            event.preventDefault();
        };
        this.handlePointerMove = (event) => {
            if (!this.dragState.isDragging)
                return;
            event.preventDefault();
            this.updatePosition(event.clientX, event.clientY);
        };
        this.handlePointerUp = () => {
            if (!this.dragState.isDragging)
                return;
            this.dragState.isDragging = false;
            this.container.classList.remove('is-dragging');
            this.detachGlobalDragListeners();
        };
        this.container = createDiv({ cls: 'zeddal-status-bar' });
        this.topRow = this.container.createDiv({ cls: 'zeddal-status-top' });
        this.stateDot = this.topRow.createDiv({ cls: 'zeddal-status-dot' });
        this.stateText = this.topRow.createSpan({ cls: 'zeddal-status-text', text: 'Ready' });
        this.recordButton = this.topRow.createEl('button', {
            cls: 'zeddal-status-record',
            text: '● Record',
        });
        this.metricsText = this.container.createSpan({ cls: 'zeddal-status-metrics', text: '' });
        this.badgesContainer = this.container.createDiv({ cls: 'zeddal-status-badges' });
        const root = document.body.querySelector('.modals-container') || document.body;
        root.appendChild(this.container);
        this.registerListeners();
        this.render();
        this.enableDragging();
        this.registerButtonHandlers();
        this.resetRecordButton();
    }
    destroy() {
        var _a, _b;
        (_a = this.container) === null || _a === void 0 ? void 0 : _a.removeEventListener('pointerdown', this.handlePointerDown);
        this.detachGlobalDragListeners();
        (_b = this.container) === null || _b === void 0 ? void 0 : _b.remove();
    }
    updateTelemetry(snapshot) {
        this.telemetrySnapshot = snapshot;
        this.renderMetrics();
    }
    setLinkCount(count) {
        this.lastLinkCount = count;
        this.renderBadges();
    }
    flagRawSaved() {
        this.lastRawSaved = true;
        this.renderBadges();
        setTimeout(() => {
            this.lastRawSaved = false;
            this.renderBadges();
        }, 4000);
    }
    setState(state, message) {
        this.currentState = state;
        if (message) {
            this.stateText.textContent = message;
        }
        this.renderState();
    }
    registerListeners() {
        eventBus.on('recording-started', () => {
            this.isRecording = true;
            this.setState('listening', 'Listening…');
            this.updateRecordButton('Recording…', true);
        });
        eventBus.on('recording-paused', () => {
            this.setState('idle', 'Paused');
            this.updateRecordButton('Resume in modal', true);
        });
        eventBus.on('recording-resumed', () => {
            this.setState('listening', 'Listening…');
            this.updateRecordButton('Recording…', true);
        });
        eventBus.on('recording-stopped', () => {
            this.isRecording = false;
            this.setState('processing', 'Processing…');
            this.updateRecordButton('Processing…', true);
        });
        eventBus.on('refined', () => {
            this.setState('saved', 'Saved successfully');
            this.resetRecordButton();
            setTimeout(() => this.setState('idle', 'Ready'), 4000);
        });
        eventBus.on('error', (event) => {
            var _a;
            this.setState('error', ((_a = event.data) === null || _a === void 0 ? void 0 : _a.message) || 'Error');
            this.isRecording = false;
            this.resetRecordButton();
        });
    }
    render() {
        this.renderState();
        this.renderMetrics();
        this.renderBadges();
    }
    renderState() {
        this.stateDot.setAttr('data-state', this.currentState);
        if (this.currentState === 'idle' && !this.stateText.textContent) {
            this.stateText.textContent = 'Ready';
        }
    }
    renderMetrics() {
        const { speakingTimeMs, totalRecordingTimeMs } = this.telemetrySnapshot;
        this.metricsText.textContent = `Speaking ${this.formatSeconds(speakingTimeMs)} · Recorded ${this.formatSeconds(totalRecordingTimeMs)}`;
    }
    renderBadges() {
        this.badgesContainer.empty();
        if (this.lastLinkCount > 0) {
            this.badgesContainer.createSpan({
                cls: 'zeddal-status-badge',
                text: `${this.lastLinkCount} links inserted`,
            });
        }
        if (this.lastRawSaved) {
            this.badgesContainer.createSpan({
                cls: 'zeddal-status-badge',
                text: 'Raw snapshot saved',
            });
        }
    }
    formatSeconds(ms) {
        const seconds = Math.max(0, ms / 1000);
        return `${seconds.toFixed(1)}s`;
    }
    enableDragging() {
        this.container.addEventListener('pointerdown', this.handlePointerDown);
    }
    attachGlobalDragListeners() {
        if (typeof document === 'undefined')
            return;
        document.addEventListener('pointermove', this.handlePointerMove);
        document.addEventListener('pointerup', this.handlePointerUp);
    }
    detachGlobalDragListeners() {
        if (typeof document === 'undefined')
            return;
        document.removeEventListener('pointermove', this.handlePointerMove);
        document.removeEventListener('pointerup', this.handlePointerUp);
    }
    updatePosition(clientX, clientY) {
        const margin = 12;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
        const rect = this.getContainerRect();
        const width = rect.width || 260;
        const height = rect.height || 80;
        const rawX = clientX - this.dragState.offsetX;
        const rawY = clientY - this.dragState.offsetY;
        const maxX = Math.max(margin, viewportWidth - width - margin);
        const maxY = Math.max(margin, viewportHeight - height - margin);
        const x = this.clamp(rawX, margin, maxX);
        const y = this.clamp(rawY, margin, maxY);
        this.container.style.left = `${x}px`;
        this.container.style.top = `${y}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
    }
    clamp(value, min, max) {
        if (Number.isNaN(value))
            return min;
        return Math.min(Math.max(value, min), max);
    }
    getContainerRect() {
        var _a, _b;
        const rect = (_b = (_a = this.container).getBoundingClientRect) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (rect) {
            return {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            };
        }
        const parse = (value, fallback) => {
            const parsed = value ? parseFloat(value) : NaN;
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        return {
            left: parse(this.container.style.left, 0),
            top: parse(this.container.style.top, 0),
            width: parse(this.container.style.width, 260),
            height: parse(this.container.style.height, 80),
        };
    }
    registerButtonHandlers() {
        this.recordButton.addEventListener('pointerdown', (evt) => {
            evt.stopPropagation();
        });
        this.recordButton.addEventListener('click', (evt) => {
            var _a;
            evt.preventDefault();
            evt.stopPropagation();
            if (this.isRecording || this.recordButton.disabled) {
                return;
            }
            (_a = this.onRecordRequest) === null || _a === void 0 ? void 0 : _a.call(this);
        });
    }
    updateRecordButton(label, disabled) {
        this.recordButton.textContent = label;
        this.recordButton.disabled = disabled;
    }
    resetRecordButton() {
        this.isRecording = false;
        this.updateRecordButton('● Record', false);
    }
}

class MCPWarningModal extends obsidian.Modal {
    constructor(app, options) {
        super(app);
        this.options = options;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('zeddal-record-modal');
        contentEl.createEl('h2', { text: 'Enable MCP? Review Security Risks' });
        contentEl.createEl('p', {
            text: 'MCP servers run external code with access to your vault context. Only proceed if you fully trust the servers you configure.',
            cls: 'setting-item-description',
        });
        const list = contentEl.createEl('ul', { cls: 'zeddal-warning-list' });
        list.createEl('li', {
            text: 'External MCP processes can read or write shared data. Never expose API keys, classified notes, or credentials unless absolutely necessary.',
        });
        list.createEl('li', {
            text: 'A compromised MCP server can exfiltrate notes or inject malicious responses into your refinement flow.',
        });
        list.createEl('li', {
            text: 'Run MCP servers in sandboxed environments and audit their source before connecting.',
        });
        contentEl.createEl('p', {
            text: 'If you acknowledge these risks and still want to continue, click “Enable MCP” below.',
            cls: 'setting-item-description',
        });
        const actions = contentEl.createDiv('zeddal-modal-actions');
        const cancelBtn = actions.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => {
            var _a, _b;
            (_b = (_a = this.options).onCancel) === null || _b === void 0 ? void 0 : _b.call(_a);
            this.close();
        };
        const confirmBtn = actions.createEl('button', {
            text: 'Enable MCP',
            cls: 'mod-warning',
        });
        confirmBtn.onclick = () => __awaiter(this, void 0, void 0, function* () {
            yield this.options.onConfirm();
            this.close();
        });
    }
}

/**
 * Zeddal: Speak your mind
 * Main plugin entry point
 * Architecture: Orchestrates RecorderService, WhisperService, and UI components
 */
class ZeddalPlugin extends obsidian.Plugin {
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Loading Zeddal plugin...');
            // Load settings
            yield this.loadSettings();
            // Initialize config
            this.config = new Config(this.settings);
            // Initialize services
            this.whisperService = new WhisperService(this.config);
            this.recorderService = new RecorderService(this.config);
            this.llmRefineService = new LLMRefineService(this.config);
            this.vaultRAGService = new VaultRAGService(this.app, this.config);
            this.mcpClientService = new MCPClientService(this.config);
            this.audioFileService = new AudioFileService(this.app, this.config);
            this.vaultOps = new VaultOps(this.app);
            this.toast = new Toast();
            this.contextLinkService = new ContextLinkService(this.app);
            this.statusBar = new StatusBar(this.app, () => this.handleStatusBarRecordRequest());
            // Initialize RAG index (async, don't block plugin load)
            this.initializeRAGIndex();
            // Initialize MCP connections (async, don't block plugin load)
            this.initializeMCP();
            // Setup vault file listeners for incremental RAG updates
            this.setupVaultListeners();
            // Setup drag-and-drop handler for audio files
            this.setupAudioFileDropHandler();
            // Initialize UI
            this.micButton = new MicButton(this, this.recorderService, this.whisperService, this.llmRefineService, this.vaultOps, this.toast, this.contextLinkService, this.vaultRAGService, this.audioFileService);
            this.micButton.addToRibbon();
            // Add command
            this.addCommand({
                id: 'start-recording',
                name: 'Start voice recording',
                callback: () => {
                    // Trigger the same action as ribbon button
                    this.micButton.startRecording(new MouseEvent('click'));
                },
            });
            this.addCommand({
                id: 'link-inspector',
                name: 'Zeddal: Inspect contextual links in current note',
                callback: () => {
                    const modal = new LinkInspectorModal(this.app, this, this.contextLinkService);
                    modal.open();
                },
            });
            this.addCommand({
                id: 'recording-history',
                name: 'Zeddal: Browse recording history',
                callback: () => {
                    const modal = new RecordingHistoryModal(this.app, this, this.audioFileService, this.toast);
                    modal.open();
                },
            });
            // Register file menu for audio files
            this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof obsidian.TFile && this.audioFileService.isAudioFile(file.path)) {
                    menu.addItem((item) => {
                        item
                            .setTitle('🎙️ Re-process with Zeddal')
                            .setIcon('microphone')
                            .onClick(() => __awaiter(this, void 0, void 0, function* () {
                            yield this.reprocessAudioFile(file.path);
                        }));
                    });
                }
            }));
            // Add settings tab
            this.addSettingTab(new ZeddalSettingTab(this.app, this));
            // Setup global error handler
            this.setupErrorHandling();
            // Show onboarding if user hasn't set credentials
            this.showOnboardingIfNeeded();
            console.log('Zeddal plugin loaded successfully');
        });
    }
    onunload() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Unloading Zeddal plugin...');
            // Cleanup services
            if (this.recorderService) {
                this.recorderService.stop();
            }
            // Disconnect MCP clients
            if (this.mcpClientService) {
                yield this.mcpClientService.disconnect();
            }
            // Cleanup UI
            if (this.micButton) {
                this.micButton.remove();
            }
            if (this.toast) {
                this.toast.destroy();
            }
            if (this.statusBar) {
                this.statusBar.destroy();
            }
            // Clear event bus
            eventBus.clear();
            console.log('Zeddal plugin unloaded');
        });
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings);
            this.config.update(this.settings);
            // Update services with new settings
            if (this.whisperService) {
                this.whisperService.updateApiKey(this.settings.openaiApiKey);
            }
        });
    }
    setupErrorHandling() {
        eventBus.on('error', (event) => {
            const { message, error } = event.data;
            console.error('Zeddal error:', message, error);
            this.toast.error(message);
        });
    }
    showOnboardingIfNeeded() {
        if (!this.settings.openaiApiKey || !this.settings.openaiApiKey.trim()) {
            const modal = new OnboardingModal(this.app, this);
            modal.open();
        }
    }
    handleStatusBarRecordRequest() {
        var _a, _b;
        if (!this.micButton) {
            console.warn('Status bar record requested before mic button initialized');
            (_b = (_a = this.toast) === null || _a === void 0 ? void 0 : _a.warning) === null || _b === void 0 ? void 0 : _b.call(_a, 'Recorder not ready yet');
            return;
        }
        this.micButton.startRecording();
    }
    /**
     * Initialize RAG index in background
     */
    initializeRAGIndex() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.settings.enableRAG) {
                console.log('RAG is disabled in settings');
                return;
            }
            try {
                console.log('Building RAG index...');
                yield this.vaultRAGService.buildIndex();
                const stats = this.vaultRAGService.getStats();
                console.log(`RAG index ready: ${stats.totalChunks} chunks from ${stats.totalFiles} files`);
            }
            catch (error) {
                console.error('Failed to build RAG index:', error);
                this.toast.error('Failed to initialize RAG: ' + error.message);
            }
        });
    }
    /**
     * Initialize MCP client connections
     * Non-blocking - failures won't prevent plugin from working
     */
    initializeMCP() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.settings.enableMCP) {
                console.log('MCP is disabled in settings');
                return;
            }
            try {
                console.log('Initializing MCP connections...');
                yield this.mcpClientService.initialize();
                const status = this.mcpClientService.getStatus();
                const connectedServers = status.filter(s => s.connected);
                if (connectedServers.length > 0) {
                    console.log(`MCP ready: Connected to ${connectedServers.length} server(s)`);
                }
                else {
                    console.log('MCP: No servers connected');
                }
            }
            catch (error) {
                console.error('Failed to initialize MCP:', error);
                // Don't show toast error - MCP is optional enhancement
                // Plugin should continue working without it
            }
        });
    }
    /**
     * Setup vault listeners for incremental RAG updates
     */
    setupVaultListeners() {
        if (!this.settings.enableRAG) {
            return;
        }
        // Update index when files are modified
        this.registerEvent(this.app.vault.on('modify', (file) => __awaiter(this, void 0, void 0, function* () {
            if (file instanceof obsidian.TFile && file.extension === 'md') {
                yield this.vaultRAGService.updateFile(file);
            }
        })));
        // Update index when files are created
        this.registerEvent(this.app.vault.on('create', (file) => __awaiter(this, void 0, void 0, function* () {
            if (file instanceof obsidian.TFile && file.extension === 'md') {
                yield this.vaultRAGService.updateFile(file);
            }
        })));
        // Remove from index when files are deleted
        this.registerEvent(this.app.vault.on('delete', (file) => __awaiter(this, void 0, void 0, function* () {
            if (file instanceof obsidian.TFile && file.extension === 'md') {
                yield this.vaultRAGService.removeFile(file.path);
            }
        })));
        // Rebuild index when files are renamed (remove old, add new)
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => __awaiter(this, void 0, void 0, function* () {
            if (file instanceof obsidian.TFile && file.extension === 'md') {
                yield this.vaultRAGService.removeFile(oldPath);
                yield this.vaultRAGService.updateFile(file);
            }
        })));
    }
    /**
     * Setup drag-and-drop handler for audio files
     * Allows users to drag audio files into Obsidian and process them
     */
    setupAudioFileDropHandler() {
        this.registerDomEvent(document, 'drop', (evt) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            // Check if files were dropped
            if (!((_a = evt.dataTransfer) === null || _a === void 0 ? void 0 : _a.files) || evt.dataTransfer.files.length === 0) {
                return;
            }
            // Check if any dropped files are audio files
            const files = Array.from(evt.dataTransfer.files);
            const audioFiles = files.filter(file => {
                const name = file.name.toLowerCase();
                return name.endsWith('.webm') ||
                    name.endsWith('.mp3') ||
                    name.endsWith('.wav') ||
                    name.endsWith('.m4a') ||
                    name.endsWith('.ogg');
            });
            // If no audio files, let Obsidian handle the drop normally
            if (audioFiles.length === 0) {
                return;
            }
            // Prevent default drop behavior for audio files
            evt.preventDefault();
            evt.stopPropagation();
            // Process the first audio file
            const audioFile = audioFiles[0];
            try {
                // Check API key
                if (!this.whisperService.isReady()) {
                    this.toast.warning('Please configure OpenAI API key in settings');
                    return;
                }
                // Show toast for multiple files
                if (audioFiles.length > 1) {
                    this.toast.warning(`Processing first audio file: ${audioFile.name}`);
                }
                // Save the dropped audio file to the recordings folder
                this.toast.info(`Importing audio file: ${audioFile.name}`);
                // Convert File to Blob
                const blob = new Blob([yield audioFile.arrayBuffer()], { type: audioFile.type });
                // Create AudioChunk
                const audioChunk = {
                    blob,
                    timestamp: Date.now(),
                    duration: 0, // We don't know duration from drag-and-drop
                };
                // Save to recordings folder
                const savedAudioFile = yield this.audioFileService.saveRecording(audioChunk);
                // Open RecordModal with existing audio file
                const modal = new RecordModal(this.app, this.recorderService, this.whisperService, this.llmRefineService, this.vaultOps, this.toast, this, this.contextLinkService, this.vaultRAGService, this.mcpClientService, this.audioFileService, savedAudioFile // Pass existing audio file
                );
                modal.open();
                this.toast.success('Audio file imported successfully');
            }
            catch (error) {
                console.error('Failed to process dropped audio file:', error);
                this.toast.error('Failed to import audio file: ' + error.message);
            }
        }));
        console.log('Audio file drag-and-drop handler registered');
    }
    /**
     * Re-process an existing audio file from the vault
     * Used by file menu context menu and commands
     */
    reprocessAudioFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Check API key
                if (!this.whisperService.isReady()) {
                    this.toast.warning('Please configure OpenAI API key in settings');
                    return;
                }
                // Check if file is an audio file
                if (!this.audioFileService.isAudioFile(filePath)) {
                    this.toast.error('Selected file is not a supported audio format');
                    return;
                }
                this.toast.info('Loading audio file...');
                // Load the audio file and metadata
                const audioChunk = yield this.audioFileService.loadRecording(filePath);
                const metadata = yield this.audioFileService.loadMetadata(filePath);
                // Create SavedAudioFile object
                const savedAudioFile = metadata || {
                    filePath,
                    timestamp: audioChunk.timestamp,
                    duration: audioChunk.duration,
                    mimeType: audioChunk.blob.type,
                    size: audioChunk.blob.size,
                };
                // Open RecordModal with existing audio file
                const modal = new RecordModal(this.app, this.recorderService, this.whisperService, this.llmRefineService, this.vaultOps, this.toast, this, this.contextLinkService, this.vaultRAGService, this.mcpClientService, this.audioFileService, savedAudioFile);
                modal.open();
                this.toast.success('Audio file loaded for re-processing');
            }
            catch (error) {
                console.error('Failed to re-process audio file:', error);
                this.toast.error('Failed to load audio file: ' + error.message);
            }
        });
    }
}
/**
 * Settings tab for Zeddal configuration
 */
class ZeddalSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Zeddal Settings' });
        containerEl.createEl('p', {
            text: 'Configure OpenAI API access for voice transcription and refinement.',
            cls: 'setting-item-description',
        });
        // OpenAI API Key
        new obsidian.Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Your OpenAI API key for Whisper and GPT-4 access')
            .addText((text) => text
            .setPlaceholder('sk-...')
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.openaiApiKey = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName('Provider')
            .setDesc('Choose OpenAI or a custom OpenAI-compatible endpoint')
            .addDropdown((dropdown) => dropdown
            .addOption('openai', 'OpenAI (api.openai.com)')
            .addOption('custom', 'Custom / Self-hosted')
            .setValue(this.plugin.settings.llmProvider)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.llmProvider = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName('Custom API base URL')
            .setDesc('Required if provider is set to custom (e.g., https://my-llm.example.com/v1)')
            .addText((text) => text
            .setPlaceholder('https://my-llm.example.com/v1')
            .setValue(this.plugin.settings.customApiBase || '')
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.customApiBase = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName('Custom transcription endpoint')
            .setDesc('Optional override if your Whisper endpoint differs from /audio/transcriptions')
            .addText((text) => text
            .setPlaceholder('https://my-llm.example.com/audio/transcriptions')
            .setValue(this.plugin.settings.customTranscriptionUrl || '')
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.customTranscriptionUrl = value;
            yield this.plugin.saveSettings();
        })));
        // OpenAI Model
        new obsidian.Setting(containerEl)
            .setName('GPT Model')
            .setDesc('Model for note refinement')
            .addDropdown((dropdown) => dropdown
            .addOption('gpt-4-turbo', 'GPT-4 Turbo')
            .addOption('gpt-4', 'GPT-4')
            .addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
            .setValue(this.plugin.settings.openaiModel)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.openaiModel = value;
            yield this.plugin.saveSettings();
        })));
        // Whisper Model
        new obsidian.Setting(containerEl)
            .setName('Whisper Model')
            .setDesc('Model for audio transcription')
            .addDropdown((dropdown) => dropdown
            .addOption('whisper-1', 'Whisper-1')
            .setValue(this.plugin.settings.whisperModel)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.whisperModel = value;
            yield this.plugin.saveSettings();
        })));
        containerEl.createEl('h3', { text: 'Recording Settings' });
        // Silence Threshold
        new obsidian.Setting(containerEl)
            .setName('Silence Threshold')
            .setDesc('RMS level below which audio is considered silent (0.0-1.0)')
            .addSlider((slider) => slider
            .setLimits(0, 0.1, 0.001)
            .setValue(this.plugin.settings.silenceThreshold)
            .setDynamicTooltip()
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.silenceThreshold = value;
            yield this.plugin.saveSettings();
        })));
        // Silence Duration
        new obsidian.Setting(containerEl)
            .setName('Silence Duration')
            .setDesc('Milliseconds of silence before auto-pause')
            .addSlider((slider) => slider
            .setLimits(500, 5000, 100)
            .setValue(this.plugin.settings.silenceDuration)
            .setDynamicTooltip()
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.silenceDuration = value;
            yield this.plugin.saveSettings();
        })));
        // Recordings Path
        new obsidian.Setting(containerEl)
            .setName('Recordings Path')
            .setDesc('Folder path where raw audio recordings will be saved (e.g., Voice Notes/Recordings)')
            .addText((text) => text
            .setPlaceholder('Voice Notes/Recordings')
            .setValue(this.plugin.settings.recordingsPath)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.recordingsPath = value;
            yield this.plugin.saveSettings();
        })));
        containerEl.createEl('h3', { text: 'Merge Settings' });
        // Auto-merge Threshold
        new obsidian.Setting(containerEl)
            .setName('Auto-merge Threshold')
            .setDesc('Similarity threshold for automatic note merging (0.0-1.0)')
            .addSlider((slider) => slider
            .setLimits(0.5, 1.0, 0.05)
            .setValue(this.plugin.settings.autoMergeThreshold)
            .setDynamicTooltip()
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.autoMergeThreshold = value;
            yield this.plugin.saveSettings();
        })));
        containerEl.createEl('h3', { text: 'Note Insertion Settings' });
        // Auto-refine with GPT-4
        new obsidian.Setting(containerEl)
            .setName('Auto-refine with GPT-4')
            .setDesc('Automatically refine transcriptions with GPT-4 before saving')
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.autoRefine)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.autoRefine = value;
            yield this.plugin.saveSettings();
        })));
        // Auto-save raw transcript
        new obsidian.Setting(containerEl)
            .setName('Auto-save raw transcript')
            .setDesc('Automatically save the unedited transcript before refinement (ideal for evidentiary use)')
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.autoSaveRaw)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.autoSaveRaw = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName('Contextual auto-linking')
            .setDesc('Automatically scan your vault for matching notes and insert wikilinks inside summaries')
            .addToggle((toggle) => toggle
            .setValue(this.plugin.settings.autoContextLinks)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.autoContextLinks = value;
            yield this.plugin.saveSettings();
        })));
        // Default save location
        new obsidian.Setting(containerEl)
            .setName('Default Save Location')
            .setDesc('Where to save voice notes by default')
            .addDropdown((dropdown) => dropdown
            .addOption('ask', 'Ask each time')
            .addOption('new-note', 'New note in folder')
            .addOption('daily-note', 'Append to daily note')
            .addOption('cursor', 'Insert at cursor')
            .setValue(this.plugin.settings.defaultSaveLocation)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.defaultSaveLocation = value;
            yield this.plugin.saveSettings();
        })));
        // Voice notes folder
        new obsidian.Setting(containerEl)
            .setName('Voice Notes Folder')
            .setDesc('Folder for saving new voice notes')
            .addText((text) => text
            .setPlaceholder('Voice Notes')
            .setValue(this.plugin.settings.voiceNotesFolder)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.voiceNotesFolder = value;
            yield this.plugin.saveSettings();
        })));
        containerEl.createEl('h3', { text: 'RAG Settings (Retrieval-Augmented Generation)' });
        containerEl.createEl('p', {
            text: 'Use vault context to inform GPT-4 refinement style and tone. Requires embedding generation (~$0.13 one-time cost for 1000 notes).',
            cls: 'setting-item-description',
        });
        // Enable RAG
        new obsidian.Setting(containerEl)
            .setName('Enable RAG')
            .setDesc('Use vector embeddings to provide vault context during refinement')
            .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableRAG).onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.enableRAG = value;
            yield this.plugin.saveSettings();
        })));
        // Custom Embedding URL
        new obsidian.Setting(containerEl)
            .setName('Custom embedding endpoint')
            .setDesc('Optional: URL for local/self-hosted embedding server (e.g., for DOD/DOJ walled infrastructure). Leave blank to use OpenAI.')
            .addText((text) => text
            .setPlaceholder('https://my-embedding-server.example.com/embeddings')
            .setValue(this.plugin.settings.customEmbeddingUrl || '')
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.customEmbeddingUrl = value;
            yield this.plugin.saveSettings();
        })));
        // RAG Top-K
        new obsidian.Setting(containerEl)
            .setName('Context chunks')
            .setDesc('Number of similar vault chunks to retrieve (1-10)')
            .addSlider((slider) => slider
            .setLimits(1, 10, 1)
            .setValue(this.plugin.settings.ragTopK)
            .setDynamicTooltip()
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.ragTopK = value;
            yield this.plugin.saveSettings();
        })));
        // RAG rebuild button
        new obsidian.Setting(containerEl)
            .setName('Rebuild RAG index')
            .setDesc('Force rebuild of the vector index (use after changing embedding settings)')
            .addButton((button) => button
            .setButtonText('Rebuild Index')
            .onClick(() => __awaiter(this, void 0, void 0, function* () {
            button.setButtonText('Building...');
            button.setDisabled(true);
            try {
                // Access vaultRAGService through plugin instance
                yield this.plugin.vaultRAGService.buildIndex(true);
                const stats = this.plugin.vaultRAGService.getStats();
                button.setButtonText('Rebuild Index');
                button.setDisabled(false);
                this.plugin.toast.success(`Index rebuilt: ${stats.totalChunks} chunks from ${stats.totalFiles} files`);
            }
            catch (error) {
                button.setButtonText('Rebuild Index');
                button.setDisabled(false);
                this.plugin.toast.error('Failed to rebuild index: ' + error.message);
            }
        })));
        containerEl.createEl('h3', { text: 'MCP Settings (Model Context Protocol)' });
        containerEl.createEl('p', {
            text: 'Connect to external MCP servers to fetch additional context during refinement. MCP provides access to external data sources, APIs, and services.',
            cls: 'setting-item-description',
        });
        // Enable MCP
        new obsidian.Setting(containerEl)
            .setName('Enable MCP')
            .setDesc('Enable Model Context Protocol integration for external context retrieval')
            .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableMCP).onChange((value) => __awaiter(this, void 0, void 0, function* () {
            if (value) {
                toggle.setValue(false);
                const modal = new MCPWarningModal(this.app, {
                    onConfirm: () => __awaiter(this, void 0, void 0, function* () {
                        toggle.setValue(true);
                        yield this.applyMCPSetting(true);
                        this.display();
                    }),
                    onCancel: () => {
                        this.plugin.toast.info('MCP remains disabled until you accept the security notice.');
                    },
                });
                modal.open();
            }
            else {
                yield this.applyMCPSetting(false);
                toggle.setValue(false);
                this.display();
            }
        })));
        // Only show server management if MCP is enabled
        if (this.plugin.settings.enableMCP) {
            containerEl.createEl('h4', { text: 'MCP Servers' });
            // Display existing servers
            if (this.plugin.settings.mcpServers.length === 0) {
                containerEl.createEl('p', {
                    text: 'No MCP servers configured. Add a server below to get started.',
                    cls: 'setting-item-description',
                });
            }
            else {
                this.plugin.settings.mcpServers.forEach((server, index) => {
                    new obsidian.Setting(containerEl)
                        .setName(server.name)
                        .setDesc(`Command: ${server.command}${server.args ? ' ' + server.args.join(' ') : ''}`)
                        .addToggle((toggle) => toggle.setValue(server.enabled).onChange((value) => __awaiter(this, void 0, void 0, function* () {
                        this.plugin.settings.mcpServers[index].enabled = value;
                        yield this.plugin.saveSettings();
                        yield this.plugin.mcpClientService.reconnect();
                        this.plugin.toast.info(value ? `Server "${server.name}" enabled` : `Server "${server.name}" disabled`);
                    })))
                        .addButton((button) => button
                        .setButtonText('Remove')
                        .setWarning()
                        .onClick(() => __awaiter(this, void 0, void 0, function* () {
                        this.plugin.settings.mcpServers.splice(index, 1);
                        yield this.plugin.saveSettings();
                        yield this.plugin.mcpClientService.reconnect();
                        this.plugin.toast.info(`Server "${server.name}" removed`);
                        this.display();
                    })));
                });
            }
            // Add new server section
            containerEl.createEl('h4', { text: 'Add New MCP Server' });
            let newServerName = '';
            let newServerCommand = '';
            let newServerArgs = '';
            let newServerEnv = '';
            new obsidian.Setting(containerEl)
                .setName('Server Name')
                .setDesc('Display name for this server')
                .addText((text) => text
                .setPlaceholder('My MCP Server')
                .onChange((value) => {
                newServerName = value;
            }));
            new obsidian.Setting(containerEl)
                .setName('Command')
                .setDesc('Command to run the MCP server (e.g., "npx", "python", "/path/to/server")')
                .addText((text) => text
                .setPlaceholder('npx')
                .onChange((value) => {
                newServerCommand = value;
            }));
            new obsidian.Setting(containerEl)
                .setName('Arguments')
                .setDesc('Space-separated command arguments (e.g., "-r @modelcontextprotocol/server-everything")')
                .addText((text) => text
                .setPlaceholder('-r @modelcontextprotocol/server-everything')
                .onChange((value) => {
                newServerArgs = value;
            }));
            new obsidian.Setting(containerEl)
                .setName('Environment Variables')
                .setDesc('Optional: JSON object of environment variables (e.g., {"API_KEY": "xyz"})')
                .addTextArea((text) => {
                text
                    .setPlaceholder('{"API_KEY": "your-key"}')
                    .onChange((value) => {
                    newServerEnv = value;
                });
                text.inputEl.rows = 3;
            });
            new obsidian.Setting(containerEl)
                .setName('Add Server')
                .addButton((button) => button
                .setButtonText('Add MCP Server')
                .setCta()
                .onClick(() => __awaiter(this, void 0, void 0, function* () {
                if (!newServerName || !newServerCommand) {
                    this.plugin.toast.warning('Server name and command are required');
                    return;
                }
                // Parse args
                const args = newServerArgs
                    .split(' ')
                    .map((arg) => arg.trim())
                    .filter((arg) => arg.length > 0);
                // Parse env
                let env = {};
                if (newServerEnv) {
                    try {
                        env = JSON.parse(newServerEnv);
                    }
                    catch (error) {
                        this.plugin.toast.error('Invalid JSON for environment variables');
                        return;
                    }
                }
                // Add new server
                const newServer = {
                    id: `mcp-${Date.now()}`,
                    name: newServerName,
                    command: newServerCommand,
                    args: args.length > 0 ? args : undefined,
                    env: Object.keys(env).length > 0 ? env : undefined,
                    enabled: true,
                };
                this.plugin.settings.mcpServers.push(newServer);
                yield this.plugin.saveSettings();
                yield this.plugin.mcpClientService.reconnect();
                this.plugin.toast.success(`MCP server "${newServerName}" added`);
                this.display();
            })));
            // Connection status
            containerEl.createEl('h4', { text: 'Connection Status' });
            const statusContainer = containerEl.createDiv();
            const status = this.plugin.mcpClientService.getStatus();
            if (status.length === 0) {
                statusContainer.createEl('p', {
                    text: 'No servers configured',
                    cls: 'setting-item-description',
                });
            }
            else {
                status.forEach((server) => {
                    const statusEl = statusContainer.createDiv();
                    statusEl.style.padding = '8px 12px';
                    statusEl.style.marginBottom = '8px';
                    statusEl.style.borderRadius = '4px';
                    statusEl.style.backgroundColor = server.connected
                        ? 'rgba(61, 213, 152, 0.12)'
                        : 'rgba(167, 169, 172, 0.12)';
                    const statusText = statusEl.createEl('span');
                    statusText.style.color = server.connected ? '#3dd598' : 'var(--text-muted)';
                    statusText.textContent = `${server.connected ? '✓' : '✗'} ${server.serverName}: ${server.connected ? 'Connected' : 'Disconnected'}`;
                });
            }
        }
    }
    applyMCPSetting(value) {
        return __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.enableMCP = value;
            yield this.plugin.saveSettings();
            if (value) {
                yield this.plugin.mcpClientService.initialize();
                this.plugin.toast.success('MCP enabled - connecting to servers...');
            }
            else {
                yield this.plugin.mcpClientService.disconnect();
                this.plugin.toast.info('MCP disabled');
            }
        });
    }
}

module.exports = ZeddalPlugin;
