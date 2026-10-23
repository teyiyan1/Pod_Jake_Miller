"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8766);
const HOST = "127.0.0.1";

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadDotEnv();

const mimeTypes = {
  ".aac": "audio/aac",
  ".css": "text/css; charset=utf-8",
  ".flac": "audio/flac",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webp": "image/webp"
};

function parseByteRange(header, size) {
  if (typeof header !== "string") return null;
  // Unsupported units, malformed ranges and multipart requests use the full file.
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return null;
  if (size === 0) return { unsatisfiable: true };

  let start;
  let end;
  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) return { unsatisfiable: true };
  } else {
    const suffixLength = Number(match[2]);
    if (suffixLength === 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }
  return { start, end };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function appleToken() {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKeyPath = process.env.APPLE_MUSIC_PRIVATE_KEY_PATH;
  if (!teamId || !keyId || !privateKeyPath) return null;

  const resolvedKeyPath = path.resolve(ROOT, privateKeyPath);
  const privateKey = fs.readFileSync(resolvedKeyPath, "utf8");
  const now = Math.floor(Date.now() / 1000);
  const requestedTtl = Number.parseInt(process.env.APPLE_MUSIC_TOKEN_TTL_DAYS || "30", 10);
  const ttlDays = Number.isInteger(requestedTtl) ? Math.max(1, Math.min(180, requestedTtl)) : 30;
  const origin = process.env.APPLE_MUSIC_ORIGIN || `http://${HOST}:${PORT}`;
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now, exp: now + ttlDays * 86400, origin: [origin] }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return { developerToken: `${signingInput}.${signature}`, expiresAt: now + ttlDays * 86400 };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function normalizeLyricsValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLyricsTitle(value) {
  const withoutFeatureCredit = String(value || "")
    .replace(/\s*[([]?\s*(?:feat(?:uring)?|ft)\.?\s+[^)\]]*[)\]]?/gi, "")
    .replace(/\s+(?:feat(?:uring)?|ft)\.?\s+.+$/i, "");
  return normalizeLyricsValue(withoutFeatureCredit);
}

function lyricsArtistCreditsMatch(recordArtist, expectedArtist) {
  const tokens = value => new Set(normalizeLyricsValue(value)
    .split(/\s+/)
    .filter(token => token && !["and", "feat", "featuring", "ft", "with"].includes(token)));
  const recordTokens = tokens(recordArtist);
  const expectedTokens = tokens(expectedArtist);
  if (!recordTokens.size || !expectedTokens.size) return false;
  return [...recordTokens].every(token => expectedTokens.has(token))
    || [...expectedTokens].every(token => recordTokens.has(token));
}

function rankLyricsSearchResult(record, trackName, artistName, albumName, duration) {
  if (!record || typeof record !== "object") return null;
  const expectedTitle = normalizeLyricsTitle(trackName);
  const recordTitle = normalizeLyricsTitle(record.trackName || record.name);
  if (!recordTitle || recordTitle !== expectedTitle) return null;
  if (!lyricsArtistCreditsMatch(record.artistName, artistName)) return null;
  if (!record.plainLyrics?.trim() && !record.syncedLyrics?.trim()) return null;

  const recordDuration = Number(record.duration);
  const expectedDuration = Number(duration);
  const durationDifference = Number.isFinite(recordDuration) && Number.isFinite(expectedDuration)
    ? Math.abs(recordDuration - expectedDuration)
    : Number.POSITIVE_INFINITY;
  if (duration && durationDifference > 2) return null;

  const albumMatches = albumName && normalizeLyricsValue(record.albumName) === normalizeLyricsValue(albumName);
  const syncBonus = record.syncedLyrics?.trim() ? 100 : 0;
  return { record, score: syncBonus + (albumMatches ? 20 : 0) - (Number.isFinite(durationDifference) ? durationDifference : 0) };
}

async function searchLyricsRecords(trackName, artistName, albumName, duration, headers, signal) {
  const searchUrl = new URL("https://lrclib.net/api/search");
  searchUrl.searchParams.set("track_name", trackName);
  searchUrl.searchParams.set("artist_name", artistName);
  const searchResponse = await fetch(searchUrl, { headers, signal });
  if (!searchResponse.ok) return [];
  const results = await searchResponse.json();
  return (Array.isArray(results) ? results : [])
    .map((record) => rankLyricsSearchResult(record, trackName, artistName, albumName, duration))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

async function fetchPlainLyrics(trackName, artistName, albumName, headers, signal) {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artistName)}/${encodeURIComponent(trackName)}`;
  const upstream = await fetch(url, { headers, signal });
  if (upstream.status === 404) return null;
  if (!upstream.ok) throw new Error(`Lyrics.ovh returned ${upstream.status}`);
  const result = await upstream.json();
  const plainLyrics = typeof result?.lyrics === "string" ? result.lyrics.trim() : "";
  return plainLyrics ? { trackName, artistName, albumName, plainLyrics, syncedLyrics: null, provider: "lyrics.ovh" } : null;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  if (requestUrl.pathname === "/api/apple-music-token") {
    try {
      const allowedOrigin = process.env.APPLE_MUSIC_ORIGIN || `http://${HOST}:${PORT}`;
      if (request.headers.origin && request.headers.origin !== allowedOrigin) {
        sendJson(response, 403, { configured: false, error: "Apple Music token requests must use the configured local origin." });
        return;
      }
      const token = appleToken();
      if (!token) {
        sendJson(response, 200, { configured: false });
        return;
      }
      sendJson(response, 200, { configured: true, ...token });
    } catch (error) {
      console.error("Apple Music token could not be generated:", error.message);
      sendJson(response, 503, { configured: false, error: "Apple Music credentials need attention." });
    }
    return;
  }

  if (requestUrl.pathname === "/api/lyrics") {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end("Method not allowed");
      return;
    }
    const trackName = requestUrl.searchParams.get("track_name") || "";
    const artistName = requestUrl.searchParams.get("artist_name") || "";
    const albumName = requestUrl.searchParams.get("album_name") || "";
    const duration = requestUrl.searchParams.get("duration");
    if (!trackName || !artistName || trackName.length > 200 || artistName.length > 200 || albumName.length > 200) {
      sendJson(response, 400, { error: "Track title and artist are required." });
      return;
    }
    if (duration && (!Number.isFinite(Number(duration)) || Number(duration) < 1 || Number(duration) > 3600)) {
      sendJson(response, 400, { error: "Duration must be between 1 and 3600 seconds." });
      return;
    }

    const upstreamUrl = new URL("https://lrclib.net/api/get");
    upstreamUrl.searchParams.set("track_name", trackName);
    upstreamUrl.searchParams.set("artist_name", artistName);
    if (albumName) upstreamUrl.searchParams.set("album_name", albumName);
    if (duration) upstreamUrl.searchParams.set("duration", duration);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const headers = {
      Accept: "application/json",
      "Lrclib-Client": "JakeMillerListeningRoom/1.4.1"
    };
    (async () => {
      // Local acoustic timing was built against this full text. Some catalog
      // records omit entire verses, so fetch the matching text first on request.
      if (requestUrl.searchParams.get("prefer_plain") === "1") {
        try {
          const plain = await fetchPlainLyrics(trackName, artistName, albumName, headers,
            AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)]));
          if (plain) {
            sendJson(response, 200, plain);
            return;
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          console.error("Preferred plain lyrics failed:", error.message);
        }
      }
      const upstream = await fetch(upstreamUrl, { headers, signal: controller.signal });
      if (upstream.ok) {
        const record = await upstream.json();
        if (!record.syncedLyrics?.trim()) {
          try {
            const syncedMatch = (await searchLyricsRecords(
              trackName, artistName, albumName, duration, headers, controller.signal
            )).find((candidate) => candidate.record.syncedLyrics?.trim());
            if (syncedMatch) {
              sendJson(response, 200, syncedMatch.record);
              return;
            }
          } catch (error) {
            if (error.name === "AbortError") throw error;
            console.error("LRCLIB synced search failed:", error.message);
          }
        }
        sendJson(response, upstream.status, record);
        return;
      }
      if (upstream.status === 404 || upstream.status === 429 || upstream.status >= 500) {
        try {
          const match = (await searchLyricsRecords(
            trackName, artistName, albumName, duration, headers, controller.signal
          ))[0];
          if (match) {
            sendJson(response, 200, match.record);
            return;
          }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          console.error("LRCLIB search failed:", error.message);
        }

        if (upstream.status === 404 || upstream.status >= 500) {
          const plain = await fetchPlainLyrics(trackName, artistName, albumName, headers, controller.signal);
          if (plain) {
            sendJson(response, 200, plain);
            return;
          }
        }
      }

      const body = await upstream.text();
      response.writeHead(upstream.status, {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(body);
    })().catch((error) => {
        console.error("Lyrics lookup failed:", error.message);
        sendJson(response, 502, { error: "The lyrics service could not be reached." });
      })
      .finally(() => clearTimeout(timeoutId));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(ROOT, `.${pathname}`);
  const relativePath = path.relative(ROOT, filePath);
  const firstSegment = relativePath.split(path.sep)[0];
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || [".git", "node_modules", "secrets"].includes(firstSegment) || [".env", "server.cjs"].includes(relativePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const isAudio = contentType.startsWith("audio/");
    const headers = {
      "Cache-Control": filePath.endsWith(".html") ? "no-cache" : "public, max-age=300",
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    };
    if (isAudio) headers["Accept-Ranges"] = "bytes";
    // Range only applies to GET. Without a matching validator, If-Range gets a full response.
    const range = isAudio && request.method === "GET" && !request.headers["if-range"]
      ? parseByteRange(request.headers.range, stat.size)
      : null;
    if (range && range.unsatisfiable) {
      response.writeHead(416, { ...headers, "Content-Length": 0, "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    if (range) {
      headers["Content-Length"] = range.end - range.start + 1;
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    }
    if (request.method === "HEAD") {
      response.writeHead(200, headers);
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath, range || undefined);
    stream.on("error", () => {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Could not read file");
      }
    });
    response.on("close", () => stream.destroy());
    stream.once("open", () => {
      if (response.destroyed) {
        stream.destroy();
        return;
      }
      response.writeHead(range ? 206 : 200, headers);
      stream.pipe(response);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Listening Room running at http://${HOST}:${PORT}/`);
});

server.on("error", (error) => {
  console.error(`Could not start the local preview server: ${error.message}`);
  process.exitCode = 1;
});
