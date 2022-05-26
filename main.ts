import { crypto } from "https://deno.land/std@0.140.0/crypto/mod.ts";
import { ensureDir } from "https://deno.land/std@0.140.0/fs/mod.ts";
import { encode as encodeHex } from "https://deno.land/std@0.140.0/encoding/hex.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.140.0/encoding/base64.ts"

const user = Deno.env.get("GITHUB_REPOSITORY_OWNER") || "Haselnussbomber";
const env = Deno.env.get("ENVIRONMENT");
const token = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("PAT");

console.log("env:", env);
const isDev = env == "development";

interface Release {
  tag_name: string;
  published_at: string;
}

interface Repository {
  name: string;
  full_name: string;

  private: boolean;
  archived: boolean;
  disabled: boolean;

  html_url: string;
  homepage: string;
  description: string;
  topics: string[];

  latestRelease: Release;
}

async function hashString(str: string) {
  const digest = await crypto.subtle.digest("BLAKE3", new TextEncoder().encode(str));
  return new TextDecoder().decode(encodeHex(new Uint8Array(digest)));
}

async function customFetch(url: string) {
  const filename = isDev ? `./.cache/${await hashString(url)}.json` : "";

  if (isDev) {
    await ensureDir("./.cache");
    let data = "";
    try {
      data = await Deno.readTextFile(filename);
    } catch (_e) {
      // ignore
    }
    if (data) {
      const res = JSON.parse(data);
      res.headers = new Headers(res.headers);
      if (!res.ok) {
        throw new Error(`[cache:${url}] Server responded with ${res.status}`);
      }
      return Promise.resolve(res.payload);
    }
  }

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Basic ${encodeBase64("Haselnussbomber:" + token)}`);
  }

  const res = await fetch(url, { headers });
  const payload = await res.json();

  if (isDev) {
    await Deno.writeTextFile(filename, JSON.stringify({
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      payload
    }, null, 2));
  }

  if (!res.ok) {
    throw new Error(`[${url}] Server responded with ${res.status}`);
  }
  return payload;
}

const repos: Repository[] = [];

let page = 0;
let pageRepos = [];
do {
  pageRepos = await customFetch(`https://api.github.com/users/${user}/repos?page=${++page}`);

  for (const repo of pageRepos) {
    if (repo.private || repo.archived || repo.disabled)
      continue;

    try {
      const release = await customFetch(`https://api.github.com/repos/${repo.full_name}/releases/latest`);
      repo.latestRelease = release;

      // only add repo if it has a release
      repos.push(repo);
    } catch(_e) {
      console.error(_e);
      // ignore
    }
  }
} while (pageRepos.length == 30);

repos.sort((a, b) => a.name.localeCompare(b.name));

console.log(`${repos.length} repos`);

const byTag = (tag: string) =>
  (repo: Repository) => repo.topics.includes(tag);

const formatDate = (str: string) =>
  new Date(str).toLocaleString("en-us", { dateStyle: "medium" });

//! https://stackoverflow.com/a/6234804
const escapeHtml = (str: string) => str
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const formatRepo = (repo: Repository) =>
  `#### <a href="${repo.html_url}" title="${escapeHtml(repo.description)}">${repo.name}</a> <span title="Released ${formatDate(repo.latestRelease.published_at)}">${repo.latestRelease.tag_name}</span>\n\n${repo.description}\n`;

await Deno.writeTextFile("README.md", `## Hey there!

These are a bunch of small and simple Addons/Plugins that I wrote. Have fun!

### Final Fantasy XIV Plugins

${repos.filter(byTag("ffxiv")).map(formatRepo).join("\n").trim()}

### World of Warcraft Addons

${repos.filter(byTag("wow")).map(formatRepo).join("\n").trim()}
`);
