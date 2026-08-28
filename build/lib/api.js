"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var api_exports = {};
__export(api_exports, {
  HomgarClient: () => HomgarClient
});
module.exports = __toCommonJS(api_exports);
var import_node_crypto = __toESM(require("node:crypto"));
var import_node_https = __toESM(require("node:https"));
var import_types = require("./types");
var import_decoder = require("./decoder");
var import_devices = require("./devices");
var import_credentials = require("./credentials");
const API_VERSION = "1.16.1065";
const SCENE_TYPE = "1";
const USER_AGENT = "okhttp/4.9.3";
const CONTROL_MODE_CLOSE = 0;
const CONTROL_MODE_OPEN = 1;
const REAUTH_CODES = /* @__PURE__ */ new Set([1001, 1004]);
const THROTTLE_CODE = 9993;
const LOGIN_COOLDOWN_SECONDS = 180;
function md5(input) {
  return import_node_crypto.default.createHash("md5").update(input, "utf8").digest("hex");
}
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function asString(value) {
  return value == null ? "" : String(value);
}
function parseGatewayState(state) {
  if (!state || state.includes("#") || state.includes(";") || state.includes("=")) {
    return { battery: null, rssi: null };
  }
  const parts = state.split(",");
  if (parts.length < 2) {
    return { battery: null, rssi: null };
  }
  const battery = parseInt(parts[0], 10);
  const rssi = parseInt(parts[1], 10);
  return {
    battery: Number.isNaN(battery) ? null : battery,
    rssi: Number.isNaN(rssi) ? null : rssi
  };
}
class HomgarClient {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.baseUrl = `https://region${config.region || "3"}.homgarus.com`;
    this.appCode = (0, import_credentials.appCodeForType)(config.appType);
  }
  token = "";
  refreshTokenValue = "";
  tokenExpired = 0;
  hid = "";
  baseUrl;
  appCode;
  loginCooldownUntil = 0;
  deviceCache = /* @__PURE__ */ new Map();
  async login() {
    this.assertNotThrottled();
    const email = (0, import_credentials.normalizeEmail)(this.config.email);
    const password = (0, import_credentials.normalizePassword)(this.config.password);
    const areaCode = (0, import_credentials.normalizeAreaCode)(this.config.areaCode);
    if (!email || !password) {
      throw new Error("Email and password are required");
    }
    if ((0, import_credentials.looksEncrypted)(password)) {
      throw new Error(
        "Password still looks encrypted. Open the adapter settings, re-enter the password and save."
      );
    }
    const preferred = this.config.appType === "homgar" ? "homgar" : "rainpoint";
    const order = preferred === "homgar" ? ["homgar", "rainpoint"] : ["rainpoint", "homgar"];
    for (let i = 0; i < order.length; i++) {
      const appType = order[i];
      this.appCode = (0, import_credentials.appCodeForType)(appType);
      try {
        this.log.info(`Logging in as ${email} (areaCode=${areaCode}, app=${appType}, appCode=${this.appCode})`);
        await this.loginOnce(email, password, areaCode);
        if (appType !== preferred) {
          this.log.warn(
            `Login succeeded with ${appType} instead of configured ${preferred}. Keep using that app in the settings.`
          );
        }
        return;
      } catch (error) {
        if (error instanceof import_types.HomgarApiError && error.code === THROTTLE_CODE) {
          throw error;
        }
        if (error instanceof import_types.HomgarApiError && error.code === 2001 && i < order.length - 1) {
          this.log.warn(`Login rejected for ${appType} (appCode ${this.appCode}): ${error.message}`);
          await sleep(1500);
          continue;
        }
        if (error instanceof import_types.HomgarApiError && error.code === 2001) {
          break;
        }
        throw error;
      }
    }
    throw new import_types.HomgarApiError(
      2001,
      "Wrong account or password. Check email/password, the country calling code used when the account was created, and that this is RainPoint Home or HomGar \u2014 not RainPoint-TY/Tuya."
    );
  }
  async loginOnce(email, password, areaCode) {
    const deviceId = md5(`${email}${areaCode}`);
    const response = await this.request(
      "POST",
      "/auth/basic/app/login",
      {
        areaCode,
        phoneOrEmail: email,
        password: md5(password),
        deviceId
      },
      false
    );
    this.token = response.data.token;
    this.refreshTokenValue = response.data.refreshToken;
    this.tokenExpired = response.ts + response.data.tokenExpired * 1e3;
    this.log.info(`Logged in to HomGar/RainPoint cloud as ${email}`);
  }
  setHome(homeId) {
    this.hid = homeId;
  }
  async getHomes() {
    const response = await this.request("GET", "/app/member/appHome/list");
    return (response.data || []).map((home) => ({
      id: asString(home.hid),
      name: home.homeName
    }));
  }
  async getDevices() {
    var _a;
    const response = await this.request(
      "GET",
      `/app/device/getDeviceByHid?hid=${encodeURIComponent(this.hid)}`
    );
    const devices = [];
    this.deviceCache.clear();
    for (const device of response.data || []) {
      const children = (device.subDevices || []).filter((sub) => sub.addr !== 1);
      const main = this.normalize(device, 0, device.name, false, void 0, children.length > 0);
      devices.push(main);
      this.deviceCache.set(main.id, main);
      this.log.debug(
        `Device ${main.name} (${main.model}, ${main.kind}, mid=${main.id}) with ${children.length} sub-device(s)`
      );
      for (const sub of children) {
        const subDevice = this.normalize(
          sub,
          (_a = sub.addr) != null ? _a : 0,
          sub.name || device.name,
          true,
          asString(device.mid)
        );
        devices.push(subDevice);
        this.deviceCache.set(subDevice.id, subDevice);
      }
    }
    this.log.debug(`Normalized ${devices.length} RainPoint device(s)`);
    return devices;
  }
  async getDeviceStatuses(deviceIds) {
    var _a, _b, _c, _d, _e, _f, _g;
    const result = /* @__PURE__ */ new Map();
    if (deviceIds.length === 0) {
      return result;
    }
    if (this.deviceCache.size === 0) {
      await this.getDevices();
    }
    const hubEntries = /* @__PURE__ */ new Map();
    for (const id of deviceIds) {
      const device = this.deviceCache.get(id);
      const hubId = (_a = device == null ? void 0 : device.parentId) != null ? _a : id;
      if (hubEntries.has(hubId)) {
        continue;
      }
      const hub = this.deviceCache.get(hubId);
      hubEntries.set(hubId, {
        mid: hubId,
        deviceName: (_b = hub == null ? void 0 : hub.deviceName) != null ? _b : "",
        productKey: (_c = hub == null ? void 0 : hub.productKey) != null ? _c : ""
      });
    }
    const hubStatuses = await this.fetchHubStatuses([...hubEntries.values()]);
    for (const id of deviceIds) {
      const device = this.deviceCache.get(id);
      if (!device) {
        result.set(id, this.emptyStatus(id, false));
        continue;
      }
      const hubId = (_d = device.parentId) != null ? _d : id;
      const hubStatus = hubStatuses.get(hubId);
      const payload = device.isSubDevice ? (_e = hubStatus == null ? void 0 : hubStatus.byAddr.get(device.addr)) != null ? _e : null : (_f = hubStatus == null ? void 0 : hubStatus.state) != null ? _f : null;
      result.set(id, this.decodeStatus(id, device, payload, (_g = hubStatus == null ? void 0 : hubStatus.online) != null ? _g : false));
    }
    return result;
  }
  async turnZoneOn(deviceId, port, durationSeconds) {
    await this.controlWorkMode(deviceId, port, CONTROL_MODE_OPEN, durationSeconds);
  }
  async turnZoneOff(deviceId, port) {
    await this.controlWorkMode(deviceId, port, CONTROL_MODE_CLOSE, 0);
  }
  async controlWorkMode(deviceId, port, mode, duration) {
    const { hubId, hub, addr } = this.resolveControlTarget(deviceId);
    try {
      await this.request("POST", "/app/device/controlWorkMode", {
        mid: hubId,
        addr,
        deviceName: hub.deviceName,
        productKey: hub.productKey,
        port,
        mode,
        duration,
        hid: this.hid
      });
    } catch (error) {
      if (error instanceof import_types.HomgarApiError && error.code === 4) {
        this.log.debug("controlWorkMode: device already in requested state");
        return;
      }
      throw error;
    }
  }
  resolveControlTarget(deviceId) {
    var _a;
    const device = this.deviceCache.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    const hubId = (_a = device.parentId) != null ? _a : deviceId;
    const hub = this.deviceCache.get(hubId);
    if (!hub) {
      throw new Error(`Hub ${hubId} not found for device ${deviceId}`);
    }
    return {
      hubId,
      hub,
      addr: device.isSubDevice ? device.addr : 0
    };
  }
  normalize(device, addr, name, isSubDevice, parentId, hasSubDevices = false) {
    var _a, _b, _c;
    const portNumber = device.portNumber || 1;
    return {
      id: asString(isSubDevice ? (_a = device.sid) != null ? _a : device.mid : device.mid),
      name,
      model: device.model,
      productKey: (_b = device.productKey) != null ? _b : "",
      deviceName: (_c = device.deviceName) != null ? _c : "",
      online: device.enabled !== 0,
      portNumber,
      zoneNames: (0, import_devices.parseZoneNames)(device.portDescribe, portNumber),
      kind: (0, import_devices.getDeviceKind)(device.model, hasSubDevices),
      isSubDevice,
      parentId,
      addr,
      firmware: device.softVer
    };
  }
  emptyStatus(deviceId, online) {
    return {
      deviceId,
      online,
      zones: [],
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
      rainWeekMm: null,
      rawPayload: null
    };
  }
  decodeStatus(deviceId, device, payload, fallbackOnline) {
    var _a, _b, _c, _d;
    if (device.kind === "gateway") {
      const hub = parseGatewayState(payload);
      return {
        ...this.emptyStatus(deviceId, fallbackOnline),
        battery: hub.battery,
        rssi: hub.rssi,
        rawPayload: payload
      };
    }
    if (!payload) {
      return this.emptyStatus(deviceId, fallbackOnline);
    }
    if ((0, import_devices.isValveKind)(device.kind)) {
      const decoded2 = (0, import_decoder.decodeValve)(payload);
      const zones = [];
      for (let port = 1; port <= device.portNumber; port++) {
        const zone = decoded2.zones.get(port);
        zones.push({
          port,
          name: (_a = device.zoneNames[port - 1]) != null ? _a : `Zone ${port}`,
          isOn: (_b = zone == null ? void 0 : zone.open) != null ? _b : false,
          remainingSeconds: (_c = zone == null ? void 0 : zone.durationSeconds) != null ? _c : 0
        });
      }
      return {
        ...this.emptyStatus(deviceId, (_d = decoded2.hubOnline) != null ? _d : fallbackOnline),
        zones,
        rawPayload: payload
      };
    }
    const decoded = (0, import_decoder.decodeSensor)(payload, device.model);
    return {
      ...this.emptyStatus(deviceId, true),
      ...decoded,
      rawPayload: payload
    };
  }
  async fetchHubStatuses(hubs) {
    const result = /* @__PURE__ */ new Map();
    if (hubs.length === 0) {
      return result;
    }
    if (hubs.length === 1) {
      const data = await this.getDeviceStatus(hubs[0].mid);
      result.set(hubs[0].mid, this.extractSingleHubStatus(data));
      return result;
    }
    const response = await this.request("POST", "/app/device/multipleDeviceStatus", {
      devices: hubs
    });
    for (const multi of response.data || []) {
      result.set(asString(multi.mid), this.extractParams(multi.status || [], null, true));
    }
    return result;
  }
  extractSingleHubStatus(data) {
    return this.extractParams(data.subDeviceStatus || [], data.state || null, data.connected !== "0");
  }
  extractParams(status, state, fallbackOnline) {
    var _a;
    const byAddr = /* @__PURE__ */ new Map();
    let resolvedState = state;
    let online = fallbackOnline;
    for (const param of status) {
      if (param.id === "state" || param.id === "State") {
        resolvedState = param.value;
        continue;
      }
      if (param.id === "connected") {
        online = param.value !== "0";
        continue;
      }
      if (((_a = param.id) == null ? void 0 : _a.startsWith("D")) && param.value) {
        const addr = parseInt(param.id.substring(1), 10);
        if (!Number.isNaN(addr)) {
          byAddr.set(addr, param.value);
        }
      }
    }
    return {
      online: online || byAddr.size > 0 || resolvedState != null,
      byAddr,
      state: resolvedState
    };
  }
  async getDeviceStatus(mid) {
    const response = await this.request(
      "GET",
      `/app/device/getDeviceStatus?mid=${encodeURIComponent(mid)}`
    );
    return response.data;
  }
  async ensureAuthenticated() {
    this.assertNotThrottled();
    if (Date.now() >= this.tokenExpired - 5 * 60 * 1e3) {
      await this.refreshAccessToken();
    }
  }
  async refreshAccessToken() {
    try {
      const response = await this.request(
        "POST",
        "/app/refreshToken",
        { refreshToken: this.refreshTokenValue },
        false
      );
      this.token = response.data.token;
      this.refreshTokenValue = response.data.refreshToken;
      this.tokenExpired = response.ts + response.data.tokenExpired * 1e3;
      this.log.debug("Refreshed HomGar/RainPoint access token");
    } catch (error) {
      this.log.warn(`Token refresh failed (${error.message}), logging in again`);
      await this.login();
    }
  }
  assertNotThrottled() {
    const remainingMs = this.loginCooldownUntil - Date.now();
    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1e3);
      throw new import_types.HomgarApiError(
        THROTTLE_CODE,
        `operate too frequently \u2014 wait ${seconds}s before the next login`,
        seconds
      );
    }
  }
  armLoginCooldown() {
    this.loginCooldownUntil = Date.now() + LOGIN_COOLDOWN_SECONDS * 1e3;
    this.log.warn(
      `RainPoint cloud rate limit (9993). Cooling down ${LOGIN_COOLDOWN_SECONDS}s \u2014 do not restart the adapter.`
    );
  }
  async request(method, path, body, requireAuth = true, retried = false) {
    if (requireAuth) {
      await this.ensureAuthenticated();
    }
    const headers = {
      "Content-Type": "application/json",
      lang: "en",
      version: API_VERSION,
      appCode: this.appCode,
      sceneType: SCENE_TYPE,
      "User-Agent": USER_AGENT
    };
    if (requireAuth && this.token) {
      headers.auth = this.token;
    }
    const url = new URL(path, `${this.baseUrl}/`);
    const payload = body ? JSON.stringify(body) : void 0;
    this.log.debug(`${method} ${url.toString()}`);
    const parsed = await this.httpsJson(method, url, headers, payload);
    if (parsed.code === THROTTLE_CODE) {
      this.armLoginCooldown();
      throw new import_types.HomgarApiError(
        THROTTLE_CODE,
        "operate too frequently \u2014 wait before the next login",
        LOGIN_COOLDOWN_SECONDS
      );
    }
    if (parsed.code !== 0) {
      if (REAUTH_CODES.has(parsed.code) && requireAuth && !retried) {
        this.log.warn(`API returned ${parsed.code} (${parsed.msg}) \u2014 re-authenticating`);
        this.token = "";
        this.tokenExpired = 0;
        await this.login();
        return this.request(method, path, body, requireAuth, true);
      }
      throw new import_types.HomgarApiError(parsed.code, parsed.msg);
    }
    return parsed;
  }
  httpsJson(method, url, headers, payload) {
    return new Promise((resolve, reject) => {
      const req = import_node_https.default.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          timeout: 2e4
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode === 403) {
              resolve({
                code: THROTTLE_CODE,
                msg: "operate too frequently",
                data: null,
                ts: Date.now()
              });
              return;
            }
            const data = Buffer.concat(chunks).toString("utf8");
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`Failed to parse API response: ${error.message}`));
            }
          });
        }
      );
      req.on("error", (error) => reject(new Error(`HTTP request failed: ${error.message}`)));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HomgarClient
});
//# sourceMappingURL=api.js.map
