(function (root) {
  "use strict";

  function words(text) {
    return String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) || [];
  }

  function fingerprint(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) {
      value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    }
    return value >>> 0;
  }

  function splitLines(text) {
    return String(text || "").replace(/([a-z])([A-Z])/g, "$1\n$2")
      .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function synchronize(text, timing) {
    if (!timing?.lines?.length || !timing.words?.length) return null;
    const lines = splitLines(text);
    const normalized = lines.map(line => words(line).join(" "));
    if (lines.length === timing.lines.length && fingerprint(normalized.join("\n")) === timing.textFingerprint) {
      return timing.lines.flatMap((stamp, index) => stamp ? [{text: lines[index], time: stamp[0], end: stamp[1]}] : []);
    }

    // Match words in order so punctuation and alternative line breaks do not
    // detach a timing record from its actual lyric text.
    const incoming = lines.flatMap((line, lineIndex) => words(line).map(word => ({hash: fingerprint(word), lineIndex})));
    const known = timing.words;
    if (!incoming.length || incoming.length > 2500 || known.length > 2500) return null;
    const width = known.length + 1;
    const scores = new Uint16Array((incoming.length + 1) * width);
    for (let i = incoming.length - 1; i >= 0; i--) {
      for (let j = known.length - 1; j >= 0; j--) {
        scores[i * width + j] = incoming[i].hash === known[j][0]
          ? 1 + scores[(i + 1) * width + j + 1]
          : Math.max(scores[(i + 1) * width + j], scores[i * width + j + 1]);
      }
    }
    const matched = lines.map(() => []);
    let i = 0;
    let j = 0;
    let count = 0;
    while (i < incoming.length && j < known.length) {
      if (incoming[i].hash === known[j][0]) {
        matched[incoming[i].lineIndex].push(known[j]);
        count++;
        i++;
        j++;
      } else if (scores[(i + 1) * width + j] > scores[i * width + j + 1]) i++;
      else j++;
    }
    // A different edit or recording must retain its ordinary lyric view.
    if (count / Math.max(incoming.length, known.length) < .8) return null;
    const result = lines.flatMap((line, index) => {
      const found = matched[index];
      if (!found.length || found.length / Math.max(1, words(line).length) < .6) return [];
      const start = found[0][1];
      const end = found[found.length - 1][2];
      return end - start >= .25 ? [{text: line, time: start, end}] : [];
    });
    const grouped = [];
    for (const row of result) {
      const previous = grouped[grouped.length - 1];
      if (previous && previous.time === row.time) {
        previous.text += ` ${row.text}`;
        previous.end = Math.max(previous.end, row.end);
      } else grouped.push(row);
    }
    return grouped.length ? grouped : null;
  }

  function matchesText(text, timing) {
    const lines = splitLines(text);
    return lines.length === timing?.lines?.length
      && fingerprint(lines.map(line => words(line).join(" ")).join("\n")) === timing.textFingerprint;
  }

  const api = {words, fingerprint, splitLines, synchronize, matchesText};
  if (typeof module !== "undefined") module.exports = api;
  if (root) root.EncoreLyricTiming = api;
})(typeof window !== "undefined" ? window : null);
