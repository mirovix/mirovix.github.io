const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const logsDir = path.join(rootDir, "logs");
const logFile = path.join(logsDir, "access.log");
const port = Number(process.env.PORT || 4173);

const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8"
};

fs.mkdirSync(logsDir, { recursive: true });

function getIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return forwarded.split(",")[0].trim();
    return req.socket.remoteAddress || null;
}

function writeLog(entry) {
    fs.appendFile(logFile, `${JSON.stringify(entry)}\n`, (error) => {
        if (error) console.error("Unable to write usage log:", error);
    });
}

function readJson(req, callback) {
    let body = "";
    req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy();
    });
    req.on("end", () => {
        try {
            callback(null, body ? JSON.parse(body) : {});
        } catch (error) {
            callback(error);
        }
    });
}

function serveFile(req, res) {
    const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
    const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(distDir, safePath === "/" ? "index.html" : safePath);

    if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
        }

        res.writeHead(200, {
            "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
            "Cache-Control": "no-store"
        });
        res.end(content);
    });
}

const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/cookie-usage-log") {
        readJson(req, (error, payload) => {
            if (error) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false }));
                return;
            }

            writeLog({
                kind: "cookie-usage-log",
                receivedAt: new Date().toISOString(),
                ip: getIp(req),
                userAgent: req.headers["user-agent"] || null,
                referrer: req.headers.referer || null,
                payload
            });
            res.writeHead(204);
            res.end();
        });
        return;
    }

    writeLog({
        kind: "request",
        receivedAt: new Date().toISOString(),
        method: req.method,
        path: req.url,
        ip: getIp(req),
        userAgent: req.headers["user-agent"] || null,
        referrer: req.headers.referer || null
    });
    serveFile(req, res);
});

server.listen(port, () => {
    console.log(`Serving dist at http://localhost:${port}/`);
    console.log(`Writing logs to ${logFile}`);
});
