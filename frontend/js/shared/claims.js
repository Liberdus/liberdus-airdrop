import { UI_ROOT } from "./constants.js";
import { ethers } from "./ethers.js";
import { normalizeAddress } from "./format.js";

export function normalizeClaimCatalog(rawCatalog) {
  const sourceRows = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog?.epochs || rawCatalog?.rounds || rawCatalog?.claims || [];

  if (!Array.isArray(sourceRows)) {
    throw new Error("Claims catalog must be an array or an object with an `epochs` array.");
  }

  return sourceRows.map((row, idx) => {
    const rawEpoch = row.epoch;
    const epoch = rawEpoch == null || rawEpoch === ""
      ? null
      : Number(rawEpoch);
    if (epoch !== null && (!Number.isInteger(epoch) || epoch <= 0)) {
      throw new Error(`Claims catalog row ${idx} has an invalid epoch.`);
    }

    const file = String(row.file || row.path || row.url || "").trim();
    if (!file) {
      throw new Error(`Claims catalog row ${idx} is missing a file path.`);
    }

    return {
      epoch,
      label: row.label || row.name ? String(row.label || row.name) : "",
      description: row.description ? String(row.description) : "",
      file,
    };
  });
}

export async function loadClaimCatalog(manifestPath = "./claims/index.json") {
  const manifestUrl = new URL(manifestPath, UI_ROOT);
  const response = await fetch(manifestUrl, { cache: "no-store" });

  if (!response.ok) {
    if (response.status === 404) {
      return {
        manifestUrl: manifestUrl.toString(),
        baseUrl: new URL(".", manifestUrl).toString(),
        sources: [],
      };
    }

    throw new Error(`Failed to load claims catalog (${response.status}).`);
  }

  return {
    manifestUrl: manifestUrl.toString(),
    baseUrl: new URL(".", manifestUrl).toString(),
    sources: normalizeClaimCatalog(await response.json()),
  };
}

export async function fetchClaimArtifact(source, catalogBaseUrl) {
  const artifactUrl = new URL(source.file, catalogBaseUrl);
  const response = await fetch(artifactUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load claim file ${source.file} (${response.status}).`);
  }

  const artifact = await response.json();
  if (!Array.isArray(artifact?.claims)) {
    throw new Error(`Claim file ${source.file} is missing a claims array.`);
  }

  return {
    ...artifact,
    source,
    artifactUrl: artifactUrl.toString(),
  };
}

export function findClaimEntry(artifact, account) {
  if (!account) return null;
  const normalizedAccount = normalizeAddress(account);
  if (!normalizedAccount) return null;

  const matches = artifact.claims.filter(
    (entry) => normalizeAddress(entry.account)?.toLowerCase() === normalizedAccount.toLowerCase(),
  );

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Found ${matches.length} claim rows for ${normalizedAccount} in ${artifact.source.file}. Each account should appear only once per round.`);
  }

  const [entry] = matches;
  return {
    ...entry,
    account: ethers.getAddress(entry.account),
    index: String(entry.index),
    amountRaw: String(entry.amountRaw),
    proof: Array.isArray(entry.proof) ? entry.proof : [],
  };
}
