import { ethers } from "./ethers.js";

function trimFormattedUnits(value) {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function normalizeAddress(value) {
  return ethers.isAddress(value) ? ethers.getAddress(value) : "";
}

export function formatAddressShort(value) {
  if (!value || !ethers.isAddress(value)) return String(value ?? "");
  const normalized = ethers.getAddress(value);
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function sameAddress(left, right) {
  return ethers.isAddress(left) && ethers.isAddress(right) && ethers.getAddress(left) === ethers.getAddress(right);
}

export function parseRequiredBigInt(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${label} is required.`);

  try {
    return BigInt(raw);
  } catch {
    throw new Error(`${label} must be an integer value.`);
  }
}

export function parseHumanAmount(value, decimals) {
  if (!value?.trim()) throw new Error("Amount is required.");
  return ethers.parseUnits(value.trim(), decimals);
}

export function formatTokenAmount(value, decimals, symbol) {
  return `${trimFormattedUnits(ethers.formatUnits(value, decimals))} ${symbol}`;
}

export function formatDisplayAmount(value, decimals, symbol) {
  try {
    const raw = typeof value === "bigint" ? value : BigInt(value);
    return `${trimFormattedUnits(ethers.formatUnits(raw, decimals))} ${symbol}`;
  } catch {
    return String(value);
  }
}

export function formatDeadline(value) {
  const deadline = Number(value);
  if (!deadline) return "No epochs yet";
  return `${new Date(deadline * 1000).toLocaleString()} (${deadline})`;
}

export function formatDeadlineLocal(value) {
  const deadline = Number(value);
  if (!deadline) return "Not scheduled";
  return new Date(deadline * 1000).toLocaleString();
}

export function formatDeadlineUtc(value) {
  const deadline = Number(value);
  if (!deadline) return "Not scheduled";
  return new Date(deadline * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function formatDeadlineShort(value) {
  const deadline = Number(value);
  if (!deadline) return "Not scheduled";
  return new Date(deadline * 1000).toLocaleString();
}

export function formatDateTimeLocalValue(value) {
  const deadline = Number(value);
  if (!deadline) return "";

  const date = new Date(deadline * 1000);
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-") + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatUtcInputValue(value) {
  const deadline = Number(value);
  if (!deadline) return "";

  const date = new Date(deadline * 1000);
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join("-") + `T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

export function getUnixFromDateTimeLocal(value) {
  if (!value) return "";
  return String(Math.floor(new Date(value).getTime() / 1000));
}

export function getUnixFromUtcInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/i);
  if (!match) return "";

  const [, year, month, day, hours, minutes, seconds = "00"] = match;
  const unix = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );

  if (Number.isNaN(unix)) return "";
  return String(Math.floor(unix / 1000));
}
