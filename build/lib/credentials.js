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
var credentials_exports = {};
__export(credentials_exports, {
  appCodeForType: () => appCodeForType,
  looksEncrypted: () => looksEncrypted,
  normalizeAreaCode: () => normalizeAreaCode,
  normalizeEmail: () => normalizeEmail,
  normalizePassword: () => normalizePassword
});
module.exports = __toCommonJS(credentials_exports);
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function normalizePassword(value) {
  return String(value || "").trim();
}
function normalizeAreaCode(value) {
  let code = String(value || "49").trim();
  if (code.startsWith("+")) {
    code = code.slice(1);
  }
  if (code.startsWith("00")) {
    code = code.slice(2);
  }
  code = code.replace(/\D/g, "");
  return code || "49";
}
function appCodeForType(appType) {
  return appType === "homgar" ? "1" : "2";
}
function looksEncrypted(password) {
  return password.startsWith("$/") || password.startsWith("$/secret") || /aes-\d+-cbc/i.test(password);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  appCodeForType,
  looksEncrypted,
  normalizeAreaCode,
  normalizeEmail,
  normalizePassword
});
//# sourceMappingURL=credentials.js.map
