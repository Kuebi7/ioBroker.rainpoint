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
var devices_exports = {};
__export(devices_exports, {
  fahrenheitTenthsToCelsius: () => fahrenheitTenthsToCelsius,
  getDeviceKind: () => getDeviceKind,
  getModelPrefix: () => getModelPrefix,
  isValveKind: () => isValveKind,
  parseZoneNames: () => parseZoneNames,
  sanitizeId: () => sanitizeId
});
module.exports = __toCommonJS(devices_exports);
function getModelPrefix(model) {
  return model.replace(/[\d_]+.*/, "").toUpperCase();
}
function getDeviceKind(model, hasSubDevices = false) {
  const prefix = getModelPrefix(model);
  if (prefix.startsWith("HWG")) {
    return "gateway";
  }
  if (prefix.startsWith("HIS") && hasSubDevices) {
    return "gateway";
  }
  if (prefix.startsWith("HTV") || prefix.startsWith("HCC") || prefix.startsWith("HIS") || prefix.startsWith("HIC") || prefix.startsWith("HTP")) {
    return "valve";
  }
  if (prefix.startsWith("HCS")) {
    return "sensor";
  }
  if (prefix.startsWith("HWS")) {
    return "hub";
  }
  return "unknown";
}
function isValveKind(kind) {
  return kind === "valve";
}
function sanitizeId(value) {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned || "device";
}
function parseZoneNames(portDescribe, portNumber) {
  const count = Math.max(portNumber || 1, 1);
  if (!portDescribe) {
    return Array.from({ length: count }, (_, i) => `Zone ${i + 1}`);
  }
  const parts = portDescribe.split("|");
  return Array.from({ length: count }, (_, i) => {
    var _a;
    return ((_a = parts[i]) == null ? void 0 : _a.trim()) || `Zone ${i + 1}`;
  });
}
function fahrenheitTenthsToCelsius(value) {
  return Math.round((value / 10 - 32) * 5 / 9 * 10) / 10;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fahrenheitTenthsToCelsius,
  getDeviceKind,
  getModelPrefix,
  isValveKind,
  parseZoneNames,
  sanitizeId
});
//# sourceMappingURL=devices.js.map
