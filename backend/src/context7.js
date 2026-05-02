/**
 * Forge IDE — Context7 integration
 *
 * Extracts imported symbols from source code, fetches targeted
 * documentation from Context7 (via MCP), and returns a compact
 * system-prompt snippet — no LLM calls, no version filtering.
 *
 * Usage:
 *   const snippet = await fetchContext7Snippet(fileContent, filename, callMcpTool);
 *   // inject into system prompt if non-empty
 */

// ─── Import / symbol extraction ───────────────────────────────────────────────
// Returns Map<libName, string[]> — e.g. { 'react': ['useState','useEffect'] }
export function extractImportSymbols(content) {
  const symbols = new Map();

  function add(lib, names) {
    // Strip scoped package subpaths: '@tanstack/react-query/v5' → '@tanstack/react-query'
    const base = lib.startsWith('@')
      ? lib.split('/').slice(0, 2).join('/')
      : lib.split('/')[0];
    if (!base) return;
    const existing = symbols.get(base) || new Set();
    for (const n of names) if (n) existing.add(n.trim());
    symbols.set(base, existing);
  }

  // ES named imports:  import { useState, useRef as ref } from 'react'
  for (const m of content.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    add(m[2], names);
  }

  // ES default import:  import React from 'react'
  for (const m of content.matchAll(/import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
    add(m[2], [m[1]]);
  }

  // ES namespace:  import * as _ from 'lodash'
  for (const m of content.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
    add(m[2], [m[1]]);
  }

  // Side-effect:  import 'reflect-metadata'  — no symbols, but register the lib
  for (const m of content.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    add(m[1], []);
  }

  // CommonJS:  const { x, y } = require('lib')
  for (const m of content.matchAll(/(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g)) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    add(m[2], names);
  }

  // CommonJS default:  const axios = require('axios')
  for (const m of content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(['"]([^'"]+)['"]\)/g)) {
    add(m[2], [m[1]]);
  }

  // Python:  from flask import Flask, request
  for (const m of content.matchAll(/from\s+([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)\s+import\s+([^\n]+)/g)) {
    const names = m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    add(m[1].split('.')[0], names);
  }

  // Python bare:  import numpy as np
  for (const m of content.matchAll(/^import\s+([a-zA-Z][a-zA-Z0-9_]*)/gm)) {
    add(m[1], [m[1]]);
  }

  return symbols;
}

// ─── In-memory doc cache ──────────────────────────────────────────────────────
// key: `${lib}::${symbols_sorted}`  →  { snippet, fetchedAt }
const docCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheKey(lib, symbols) {
  return `${lib}::${[...symbols].sort().join(',')}`;
}

function getCached(lib, symbols) {
  const entry = docCache.get(cacheKey(lib, symbols));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) { docCache.delete(cacheKey(lib, symbols)); return null; }
  return entry.snippet;
}

function setCache(lib, symbols, snippet) {
  docCache.set(cacheKey(lib, symbols), { snippet, fetchedAt: Date.now() });
}

// ─── Fetch docs for one library ───────────────────────────────────────────────
async function fetchLibDocs(lib, symbols, callMcpTool) {
  const symbolList = [...symbols];
  const cached = getCached(lib, symbolList);
  if (cached !== null) return cached;

  try {
    // Step 1: resolve library name → Context7 ID
    const resolved = await callMcpTool('context7', 'resolve-library-id', { libraryName: lib });
    const libId = resolved?.id || resolved?.libraryId || resolved?.content?.[0]?.text;
    if (!libId) return null;

    // Step 2: fetch targeted docs — topic = space-separated symbol names
    const topic = symbolList.length > 0 ? symbolList.slice(0, 8).join(' ') : lib;
    const docs = await callMcpTool('context7', 'get-library-docs', {
      context7CompatibleLibraryID: libId,
      topic,
      tokens: 1500,
    });

    const text = docs?.content?.[0]?.text || docs?.content || '';
    if (!text) return null;

    // Compact: trim to 1200 chars to keep context lean
    const snippet = `## ${lib} (${symbolList.length > 0 ? symbolList.slice(0, 6).join(', ') : 'docs'}) — via Context7\n${text.slice(0, 1200)}`;
    setCache(lib, symbolList, snippet);
    return snippet;
  } catch {
    // Context7 unreachable or lib not found — fail silently
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * Given file content and a callMcpTool function, returns a system-prompt
 * snippet with targeted library docs, or an empty string if Context7 is
 * not connected or no imports are found.
 *
 * All library fetches run in parallel. Total added latency ≈ one HTTP round-trip.
 */
export async function fetchContext7Snippet(content, filename, callMcpTool) {
  if (!callMcpTool) return '';

  const symbolMap = extractImportSymbols(content);
  if (symbolMap.size === 0) return '';

  // Fire all lib fetches in parallel
  const results = await Promise.allSettled(
    [...symbolMap.entries()].map(([lib, symSet]) =>
      fetchLibDocs(lib, symSet, callMcpTool)
    )
  );

  const snippets = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (snippets.length === 0) return '';

  return `\n\n---\n# Library documentation (Context7)\n\n${snippets.join('\n\n---\n\n')}`;
}

// Expose cache clearing for tests / settings panel
export function clearContext7Cache() { docCache.clear(); }
export function getContext7CacheStats() {
  return { entries: docCache.size, libs: [...docCache.keys()].map(k => k.split('::')[0]) };
}
