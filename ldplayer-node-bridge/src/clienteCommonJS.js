"use strict";

const http = require("http");
const https = require("https");

const DEFAULT_URL = process.env.LOG_SERVER_URL || "http://localhost:3025/log";
const DEFAULT_TIMEOUT = 2000;

const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 50
});

const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50
});

let endpoint = DEFAULT_URL;

/**
 * Cambiar servidor de logs.
 */
function setLogServer(url) {

    if (typeof url === "string" && url.trim()) {
        endpoint = url.trim();
    }

}

/**
 * Enviar log.
 *
 * Fire & Forget.
 */
function normalizeMessage(message) {

    if (message == null)
        return "";

    if (typeof message === "string")
        return message;

    if (message instanceof Error)
        return message.stack || message.message;

    // consoleLog("a", "b", "c")
    if (Array.isArray(message))
        return message
            .map(normalizeMessage)
            .join("");

    // Buffer
    if (Buffer.isBuffer(message))
        return message.toString("utf8");

    // Objetos
    if (typeof message === "object") {

        try {
            return JSON.stringify(message, null, 2);
        } catch {
            return String(message);
        }

    }

    return String(message);

}

function consoleLog(
    dirtyMessage,
    data = null,
    level = "INFO",
    source = process.title || "Node",
    localLog = false
) {
    const message = normalizeMessage(dirtyMessage);

    if (localLog) {
        console.log(
            typeof message === "string"
                ? message
                : message instanceof Error
                    ? message.stack || message.message
                    : typeof message === "object" && message !== null
                        ? JSON.stringify(message, null, 2)
                        : String(message)
        );
    }
    try {

        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, DEFAULT_TIMEOUT);

        const body = JSON.stringify({
            time: new Date().toISOString(),
            level,
            source,
            message,
            data
        });

        fetch(endpoint, {

            method: "POST",

            signal: controller.signal,

            headers: {
                "Content-Type": "application/json"
            },

            body,

            agent: ({ protocol }) =>
                protocol === "https:"
                    ? httpsAgent
                    : httpAgent

        })
            .catch(() => { })
            .finally(() => clearTimeout(timeout));

    } catch (_) {
        // Nunca romper la aplicación.
    }

}

module.exports = {

    consoleLog,
    setLogServer

};

//----------------------------------------
// 1.
//  Uso const { consoleLog } = require("./logger");
//consoleLog("Servidor iniciado");
//
// 2.
// Uso con cambio de server
// const { consoleLog, setLogServer } = require("./logger");
// setLogServer("http://192.168.1.100:3085/log");
// consoleLog("Servidor iniciado");
//----------------------------------------
