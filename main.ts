import { crypto } from "@std/crypto/crypto";
import { ensureDir } from "@std/fs";
import { encodeHex, encodeBase64 } from "@std/encoding";
import { escape } from "@std/html/entities";

const user = Deno.env.get("GITHUB_REPOSITORY_OWNER") || "Haselnussbomber";
const env = Deno.env.get("ENVIRONMENT");
const token = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("PAT");

console.log("env:", env);
const isDev = env == "development";

interface GitHubRelease {
  tag_name: string;
  published_at: string;
}

interface D17Release {
  AssemblyVersion: string;
  LastUpdate: number;
}

interface Repository {
  name: string;
  full_name: string;

  fork: boolean;
  private: boolean;
  archived: boolean;
  disabled: boolean;

  html_url: string;
  homepage: string;
  description: string;
  topics: string[];

  latestRelease: GitHubRelease;
  d17Release: D17Release;
}

async function hashString(str: string) {
  return encodeHex(await crypto.subtle.digest("BLAKE3", new TextEncoder().encode(str)));
}

async function customFetch(url: string) {
  console.log(`Fetching: ${url}`);
  const filename = isDev ? `./.cache/${await hashString(url)}.json` : "";

  if (isDev) {
    await ensureDir("./.cache");
    let data = "";
    try {
      data = await Deno.readTextFile(filename);
      console.log(`Loaded from cache: ${url}`);
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
    console.log(`Cached: ${url}`);
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
    if (repo.fork || repo.private || repo.archived || repo.disabled)
      continue;

    if (repo.topics.includes("dalamud-plugin")) {
      try {
        repo.d17Release = await customFetch(`https://kamori.goats.dev/Plugin/Plugin/${repo.name}`);
        repos.push(repo);
        continue;
      } catch(_e) {
        console.error(_e);
      }
    }

    try {
      repo.latestRelease = await customFetch(`https://api.github.com/repos/${repo.full_name}/releases/latest`);
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

const formatDate = (str: number | string | Date) =>
  new Date(str).toLocaleString("en-us", { dateStyle: "medium" });

const cleanVersion = (str: string) =>
  str.endsWith(".0") ? str.slice(0, -2) : str;

const formatRepo = (repo: Repository) => {
  const releaseDate = repo.d17Release
    ? formatDate(repo.d17Release.LastUpdate * 1000)
    : formatDate(repo.latestRelease.published_at);
    
  const releaseVersion = repo.d17Release
  ? cleanVersion(repo.d17Release.AssemblyVersion)
  : repo.latestRelease.tag_name;
  
  return `- <b><a href="${repo.html_url}" title="${escape(repo.description)}">${repo.name}</a> <span title="Released ${releaseDate}">${releaseVersion}</span></b>  \n  ${repo.description}\n`;
}

await Deno.writeTextFile("README.md", `## Heya!

I'm Alexander from Germany.

I create plugins for Final Fantasy XIV and small addons for World of Warcraft. While I develop them for my personal use, I decided to share them on GitHub in case others find them as helpful as I do.

Developing FFXIV plugins led me to reverse-engineering, so I started contributing extensively to [FFXIVClientStructs](https://github.com/aers/FFXIVClientStructs), a project that documents the internal structures of the game and provides an interface for plugin developers to hook into the game and enhance it with various quality of life features.

I hope you find my creations useful and wish you a nice day! 😊

### Final Fantasy XIV Plugins

${repos.filter(byTag("ffxiv")).map(formatRepo).join("\n").trim()}

### World of Warcraft Addons

${repos.filter(byTag("wow")).map(formatRepo).join("\n").trim()}
`);
