"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var decoder_exports = {};
__export(decoder_exports, {
  decodeSensor: () => decodeSensor,
  decodeValve: () => decodeValve
});
module.exports = __toCommonJS(decoder_exports);
var import_devices = require("./devices");
const TYPE_WIDTHS = {
  216: 1,
  220: 1,
  173: 2,
  32: 2,
  225: 2,
  183: 4,
  159: 4,
  196: 1,
  197: 1,
  198: 1
};
const BATTERY_MAP = {
  4095: 100,
  4094: 90,
  4093: 80,
  4092: 70,
  4091: 60,
  4090: 50,
  4089: 40,
  4088: 30,
  4087: 20,
  4086: 10
};
const HUB_STATE_DP = 24;
const ZONE_DURATION_DP_BASE = 36;
const MAX_ZONES = 8;
const MOISTURE_SIMPLE_MODELS = /* @__PURE__ */ new Set(["HCS026FRF", "HCS005FRF", "HCS003FRF"]);
const MOISTURE_FULL_MODELS = /* @__PURE__ */ new Set([
  "HCS021FRF",
  "HCS024FRF-V1",
  "HCS666FRF",
  "HCS666RFR-P",
  "HCS999FRF",
  "HCS999FRF-P",
  "HCS666FRF-X",
  "HCS044FRF"
]);
function emptySensor() {
  return {
    moisture: null,
    temperature: null,
    humidity: null,
    battery: null,
    illuminance: null,
    pressure: null,
    rssi: null,
    rainTotalMm: null,
    rainHourMm: null,
    rainDailyMm: null,
    rainWeekMm: null
  };
}
function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return out;
}
function parsePayloadBytes(raw) {
  const idx = raw.indexOf("#");
  if (idx < 0) {
    throw new Error(`Payload missing '#' separator: ${raw}`);
  }
  return hexToBytes(raw.substring(idx + 1));
}
function parseDpMap(bytes) {
  const map = /* @__PURE__ */ new Map();
  let i = 0;
  while (i < bytes.length - 1) {
    const dpId = bytes[i];
    const typeByte = bytes[i + 1];
    const width = TYPE_WIDTHS[typeByte];
    if (width === void 0) {
      i += 1;
      continue;
    }
    if (i + 2 + width > bytes.length) {
      break;
    }
    let value = 0;
    if (typeByte === 173) {
      for (let k = 0; k < width; k++) {
        value |= bytes[i + 2 + k] << 8 * k;
      }
    } else {
      for (let k = 0; k < width; k++) {
        value = value << 8 | bytes[i + 2 + k];
      }
    }
    map.set(dpId, { type: typeByte, value });
    i += 2 + width;
  }
  return map;
}
function le16(bytes, offset) {
  return (bytes[offset] | bytes[offset + 1] << 8) & 65535;
}
function signed8(bytes, offset) {
  const value = bytes[offset];
  return value < 128 ? value : value - 256;
}
function statusCodeAt(bytes, off, off2) {
  return (bytes[off] | bytes[off2] << 8) & 65535;
}
function batteryFromStatus(code) {
  return code in BATTERY_MAP ? BATTERY_MAP[code] : null;
}
function isHexPayload(raw) {
  return raw.startsWith("10#") || raw.startsWith("11#");
}
function isAsciiPayload(raw) {
  return raw.includes(",") && (raw.includes(";") || raw.includes("|") || raw.includes("="));
}
function parseRssiFromAscii(raw) {
  const semi = raw.indexOf(";");
  if (semi < 0) {
    return null;
  }
  const general = raw.substring(0, semi).split(",");
  if (general.length < 2) {
    return null;
  }
  const rssi = parseInt(general[1], 10);
  return Number.isNaN(rssi) ? null : rssi;
}
function parseStatsValue(token) {
  const match = /^(\d+)\((\d+)\/(\d+)\/(\d+)\)/.exec(token.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}
function decodeValve(raw) {
  try {
    if (isHexPayload(raw)) {
      const bytes = parsePayloadBytes(raw);
      const dpMap = parseDpMap(bytes);
      const hubEntry = dpMap.get(HUB_STATE_DP);
      let hubOnline = null;
      if (hubEntry && hubEntry.type === 220) {
        hubOnline = hubEntry.value === 1;
      }
      const zones = /* @__PURE__ */ new Map();
      for (let n = 1; n <= MAX_ZONES; n++) {
        const stateEntry = dpMap.get(HUB_STATE_DP + n);
        if (!stateEntry || stateEntry.type !== 216) {
          continue;
        }
        const open = (stateEntry.value & 1) === 1;
        let durationSeconds = 0;
        const durEntry = dpMap.get(ZONE_DURATION_DP_BASE + n);
        if (durEntry && durEntry.type === 173) {
          durationSeconds = durEntry.value;
        }
        zones.set(n, { open, durationSeconds });
      }
      return { hubOnline, zones };
    }
    if (isAsciiPayload(raw)) {
      return decodeValveAscii(raw);
    }
  } catch {
  }
  return { hubOnline: null, zones: /* @__PURE__ */ new Map() };
}
function decodeValveAscii(raw) {
  const zones = /* @__PURE__ */ new Map();
  const semi = raw.indexOf(";");
  if (semi < 0) {
    return { hubOnline: true, zones };
  }
  const zonePart = raw.substring(semi + 1);
  let n = 1;
  for (const section of zonePart.split("|")) {
    const parts = section.split(",");
    if (parts.length < 1) {
      continue;
    }
    const wkRaw = parseInt(parts[0], 10);
    if (Number.isNaN(wkRaw)) {
      continue;
    }
    const workMode = wkRaw & 15;
    const open = workMode !== 0;
    let durationSeconds = 0;
    if (parts.length > 1 && open) {
      const durationMin = parseInt(parts[1], 10);
      if (!Number.isNaN(durationMin)) {
        durationSeconds = durationMin * 60;
      }
    }
    zones.set(n, { open, durationSeconds });
    n++;
  }
  return { hubOnline: true, zones };
}
function decodeMoistureSimple(raw) {
  const result = emptySensor();
  const bytes = parsePayloadBytes(raw);
  if (bytes.length < 9) {
    return result;
  }
  result.moisture = bytes[6];
  result.battery = batteryFromStatus(statusCodeAt(bytes, 7, 8));
  result.rssi = bytes.length > 1 ? signed8(bytes, 1) : null;
  return result;
}
function decodeMoistureFull(raw) {
  const result = emptySensor();
  const bytes = parsePayloadBytes(raw);
  if (bytes.length < 16) {
    return decodeMoistureSimple(raw);
  }
  result.temperature = (0, import_devices.fahrenheitTenthsToCelsius)(le16(bytes, 6));
  result.moisture = bytes[9];
  result.illuminance = Math.round(le16(bytes, 11) * 0.1 * 10) / 10;
  result.battery = batteryFromStatus(statusCodeAt(bytes, 14, 15));
  result.rssi = signed8(bytes, 1);
  return result;
}
function decodeRainHex(raw) {
  const result = emptySensor();
  const bytes = parsePayloadBytes(raw);
  if (bytes.length >= 24) {
    result.battery = batteryFromStatus(statusCodeAt(bytes, 22, 23));
  }
  return result;
}
function decodeRainAscii(raw) {
  const result = emptySensor();
  result.rssi = parseRssiFromAscii(raw);
  const semi = raw.indexOf(";");
  const body = semi >= 0 ? raw.substring(semi + 1) : raw;
  const rainToken = body.split(",").map((part) => part.trim()).find((part) => part.startsWith("R="));
  if (!rainToken) {
    return result;
  }
  const stats = parseStatsValue(rainToken.substring(2));
  if (!stats) {
    return result;
  }
  result.rainTotalMm = stats[0] / 10;
  result.rainHourMm = stats[1] / 10;
  result.rainDailyMm = stats[2] / 10;
  result.rainWeekMm = stats[3] / 10;
  return result;
}
function decodeDisplayHub(raw) {
  const result = emptySensor();
  result.rssi = parseRssiFromAscii(raw);
  const semi = raw.indexOf(";");
  if (semi < 0) {
    return result;
  }
  for (const item of raw.substring(semi + 1).split(",")) {
    const token = item.trim();
    if (!token) {
      continue;
    }
    const head = token.split("(")[0].trim();
    if (head.startsWith("P=")) {
      const pressure = parseInt(head.substring(2), 10);
      if (!Number.isNaN(pressure)) {
        result.pressure = pressure;
      }
      continue;
    }
    if (result.temperature === null) {
      const tempF10 = parseInt(head, 10);
      if (!Number.isNaN(tempF10)) {
        result.temperature = (0, import_devices.fahrenheitTenthsToCelsius)(tempF10);
      }
    } else if (result.humidity === null) {
      const humidity = parseInt(head, 10);
      if (!Number.isNaN(humidity)) {
        result.humidity = humidity;
      }
    }
  }
  return result;
}
function decodeMoistureFullAscii(raw) {
  const result = emptySensor();
  result.rssi = parseRssiFromAscii(raw);
  const semi = raw.indexOf(";");
  if (semi < 0) {
    return result;
  }
  const parts = raw.substring(semi + 1).split(",");
  if (parts.length < 2) {
    return result;
  }
  const tempRawF10 = parseInt(parts[0], 10);
  const moisture = parseInt(parts[1], 10);
  result.temperature = Number.isNaN(tempRawF10) ? null : (0, import_devices.fahrenheitTenthsToCelsius)(tempRawF10);
  result.moisture = Number.isNaN(moisture) ? null : moisture;
  const light = parts.find((part) => part.trim().startsWith("G="));
  if (light) {
    const luxTenths = parseInt(light.trim().substring(2), 10);
    if (!Number.isNaN(luxTenths)) {
      result.illuminance = Math.round(luxTenths) / 10;
    }
  }
  return result;
}
function decodeSensor(raw, model) {
  try {
    if (model === "HCS012ARF" || model.startsWith("HCS012")) {
      if (isAsciiPayload(raw)) {
        return decodeRainAscii(raw);
      }
      return decodeRainHex(raw);
    }
    if (model.startsWith("HWS") && isAsciiPayload(raw)) {
      return decodeDisplayHub(raw);
    }
    if (MOISTURE_SIMPLE_MODELS.has(model) && isHexPayload(raw)) {
      return decodeMoistureSimple(raw);
    }
    if (MOISTURE_FULL_MODELS.has(model) && isHexPayload(raw)) {
      return decodeMoistureFull(raw);
    }
    if (isHexPayload(raw)) {
      const full = decodeMoistureFull(raw);
      if (full.moisture !== null || full.temperature !== null || full.battery !== null) {
        return full;
      }
      return decodeMoistureSimple(raw);
    }
    if (isAsciiPayload(raw)) {
      if (raw.includes("R=")) {
        return decodeRainAscii(raw);
      }
      if (raw.includes("P=")) {
        return decodeDisplayHub(raw);
      }
      return decodeMoistureFullAscii(raw);
    }
  } catch {
  }
  return emptySensor();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  decodeSensor,
  decodeValve
});
//# sourceMappingURL=decoder.js.map
