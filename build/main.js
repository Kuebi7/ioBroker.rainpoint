"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_api = require("./lib/api");
var import_devices = require("./lib/devices");
var import_types = require("./lib/types");
class Rainpoint extends utils.Adapter {
  client;
  pollTimer;
  remainingTimer;
  devices = /* @__PURE__ */ new Map();
  zoneTargets = /* @__PURE__ */ new Map();
  commandInFlight = false;
  unloading = false;
  statesSubscribed = false;
  constructor(options = {}) {
    super({
      ...options,
      name: "rainpoint"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    await this.setState("info.connection", false, true);
    if (!this.config.email || !this.config.password) {
      this.log.error("Please set email and password in the adapter configuration");
      return;
    }
    this.log.warn(
      "RainPoint allows only one cloud session per account. Use a dedicated member account so the phone app stays logged in."
    );
    this.client = new import_api.HomgarClient(
      {
        email: this.config.email,
        password: this.config.password,
        areaCode: String(this.config.areaCode || "49"),
        region: String(this.config.region || "3"),
        appType: this.config.appType === "homgar" ? "homgar" : "rainpoint"
      },
      this.log
    );
    await this.connect();
  }
  async ensureInfoStates() {
    await this.extendObjectAsync("info.homeId", {
      type: "state",
      common: { name: "Home ID", type: "string", role: "text", read: true, write: false },
      native: {}
    });
    await this.extendObjectAsync("info.homeName", {
      type: "state",
      common: { name: "Home name", type: "string", role: "text", read: true, write: false },
      native: {}
    });
    await this.extendObjectAsync("info.lastUpdate", {
      type: "state",
      common: {
        name: "Last successful cloud update",
        type: "number",
        role: "value.time",
        read: true,
        write: false
      },
      native: {}
    });
    await this.extendObjectAsync("info.lastError", {
      type: "state",
      common: { name: "Last error", type: "string", role: "text", read: true, write: false },
      native: {}
    });
  }
  async connect() {
    var _a;
    if (!this.client) {
      return;
    }
    try {
      await this.client.login();
      const homes = await this.client.getHomes();
      if (!homes.length) {
        throw new Error("No homes found for this account");
      }
      const home = homes[Math.min(Math.max(this.config.homeIndex || 0, 0), homes.length - 1)];
      this.client.setHome(home.id);
      this.log.info(`Using home "${home.name}" (${home.id})`);
      await this.ensureInfoStates();
      await this.setStateAsync("info.homeId", { val: home.id, ack: true });
      await this.setStateAsync("info.homeName", { val: home.name, ack: true });
      await this.setState("info.connection", true, true);
      await this.poll();
      this.schedulePoll();
      this.scheduleRemainingCountdown();
      if (!this.statesSubscribed) {
        this.subscribeStates("devices.*");
        this.statesSubscribed = true;
      }
    } catch (error) {
      const message = error.message;
      this.log.error(`Startup failed: ${message}`);
      if (error instanceof import_types.HomgarApiError && error.code === 2001) {
        this.log.error(
          "Tip: re-enter password, set the country code of the RainPoint account, and confirm the phone app is RainPoint Home/HomGar \u2014 not RainPoint-TY."
        );
      }
      if (error instanceof import_types.HomgarApiError && error.code === 9993) {
        this.log.warn("Do not restart the instance now. The cloud blocks further logins for a few minutes.");
      }
      await this.setState("info.connection", false, true);
      await this.ensureInfoStates();
      await this.setState("info.lastError", message, true);
      let waitSeconds = 60;
      if (error instanceof import_types.HomgarApiError && error.code === 9993) {
        waitSeconds = (_a = error.retryAfterSeconds) != null ? _a : 180;
      } else if (error instanceof import_types.HomgarApiError && error.code === 2001) {
        waitSeconds = 600;
      }
      this.log.info(`Retrying login in ${waitSeconds} seconds`);
      this.scheduleReconnect(waitSeconds);
    }
  }
  scheduleReconnect(delaySeconds) {
    if (this.pollTimer) {
      this.clearTimeout(this.pollTimer);
    }
    this.pollTimer = this.setTimeout(() => {
      void this.connect();
    }, delaySeconds * 1e3);
  }
  schedulePoll(delaySeconds) {
    if (this.pollTimer) {
      this.clearTimeout(this.pollTimer);
    }
    const seconds = delaySeconds != null ? delaySeconds : Math.max(this.config.pollInterval || 120, 30);
    this.pollTimer = this.setTimeout(() => {
      void this.poll().then(() => {
        if (!this.unloading) {
          this.schedulePoll();
        }
      }).catch((error) => {
        var _a;
        this.log.error(`Poll failed: ${error.message}`);
        if (this.unloading) {
          return;
        }
        if (error instanceof import_types.HomgarApiError && error.code === 9993) {
          const waitSeconds = (_a = error.retryAfterSeconds) != null ? _a : 180;
          this.log.info(`Waiting ${waitSeconds} seconds after cloud rate limit`);
          this.schedulePoll(waitSeconds);
          return;
        }
        this.schedulePoll();
      });
    }, seconds * 1e3);
  }
  scheduleRemainingCountdown() {
    if (this.remainingTimer) {
      this.clearTimeout(this.remainingTimer);
    }
    this.remainingTimer = this.setTimeout(() => {
      void this.tickRemaining().finally(() => {
        if (!this.unloading) {
          this.scheduleRemainingCountdown();
        }
      });
    }, 1e3);
  }
  async tickRemaining() {
    for (const target of this.zoneTargets.values()) {
      const remainingId = `${target.prefix}.remaining`;
      const onId = `${target.prefix}.on`;
      const remainingState = await this.getStateAsync(remainingId);
      if (typeof (remainingState == null ? void 0 : remainingState.val) !== "number" || remainingState.val <= 0) {
        continue;
      }
      const next = remainingState.val - 1;
      await this.setState(remainingId, next, true);
      if (next <= 0) {
        await this.setState(onId, false, true);
      }
    }
  }
  async poll() {
    if (!this.client || this.commandInFlight) {
      return;
    }
    try {
      const devices = await this.client.getDevices();
      this.devices.clear();
      for (const device of devices) {
        this.devices.set(device.id, device);
        await this.syncDeviceObjects(device);
      }
      const statuses = await this.client.getDeviceStatuses([...this.devices.keys()]);
      for (const [id, status] of statuses) {
        await this.applyStatus(id, status);
      }
      await this.setState("info.connection", true, true);
      await this.setState("info.lastUpdate", Date.now(), true);
      await this.setState("info.lastError", "", true);
    } catch (error) {
      await this.setState("info.connection", false, true);
      await this.setState("info.lastError", error.message, true);
      throw error;
    }
  }
  async syncDeviceObjects(device) {
    const prefix = `devices.${(0, import_devices.sanitizeId)(device.id)}`;
    await this.extendObjectAsync(prefix, {
      type: "device",
      common: { name: device.name },
      native: { id: device.id, model: device.model, kind: device.kind }
    });
    await this.setStateValue(`${prefix}.name`, device.name, "text", "Name");
    await this.setStateValue(`${prefix}.model`, device.model, "text", "Model");
    await this.setStateValue(`${prefix}.online`, device.online, "indicator.reachable", "Online", "boolean");
    await this.setStateValue(`${prefix}.kind`, device.kind, "text", "Device kind");
    if (device.firmware) {
      await this.setStateValue(`${prefix}.firmware`, device.firmware, "text", "Firmware");
    }
    if ((0, import_devices.isValveKind)(device.kind)) {
      await this.extendObjectAsync(`${prefix}.zones`, {
        type: "channel",
        common: { name: "Zones" },
        native: {}
      });
      for (let port = 1; port <= device.portNumber; port++) {
        await this.syncZoneObjects(device, prefix, port);
      }
    }
  }
  async syncZoneObjects(device, devicePrefix, port) {
    var _a;
    const prefix = `${devicePrefix}.zones.${port}`;
    const zoneName = (_a = device.zoneNames[port - 1]) != null ? _a : `Zone ${port}`;
    await this.extendObjectAsync(prefix, {
      type: "channel",
      common: { name: zoneName },
      native: { deviceId: device.id, port }
    });
    await this.setStateValue(`${prefix}.name`, zoneName, "text", "Zone name");
    await this.extendObjectAsync(`${prefix}.on`, {
      type: "state",
      common: {
        name: `${zoneName} on`,
        type: "boolean",
        role: "switch",
        read: true,
        write: true,
        def: false
      },
      native: { deviceId: device.id, port }
    });
    await this.extendObjectAsync(`${prefix}.duration`, {
      type: "state",
      common: {
        name: `${zoneName} duration`,
        type: "number",
        role: "value",
        read: true,
        write: true,
        unit: "min",
        min: 1,
        max: 180,
        def: this.config.defaultDuration || 10
      },
      native: { deviceId: device.id, port }
    });
    await this.extendObjectAsync(`${prefix}.remaining`, {
      type: "state",
      common: {
        name: `${zoneName} remaining`,
        type: "number",
        role: "value.interval",
        read: true,
        write: false,
        unit: "s",
        def: 0
      },
      native: {}
    });
    this.zoneTargets.set(`${this.namespace}.${prefix}.on`, { deviceId: device.id, port, prefix });
    const durationState = await this.getStateAsync(`${prefix}.duration`);
    if ((durationState == null ? void 0 : durationState.val) == null) {
      await this.setState(`${prefix}.duration`, this.config.defaultDuration || 10, true);
    }
  }
  async applyStatus(deviceId, status) {
    const device = this.devices.get(deviceId);
    if (!device) {
      return;
    }
    const prefix = `devices.${(0, import_devices.sanitizeId)(deviceId)}`;
    await this.setState(`${prefix}.online`, status.online, true);
    if (status.moisture !== null) {
      await this.setStateValue(
        `${prefix}.moisture`,
        status.moisture,
        "value.moisture",
        "Soil moisture",
        "number",
        "%"
      );
    }
    if (status.temperature !== null) {
      await this.setStateValue(
        `${prefix}.temperature`,
        status.temperature,
        "value.temperature",
        "Temperature",
        "number",
        "\xB0C"
      );
    }
    if (status.humidity !== null) {
      await this.setStateValue(
        `${prefix}.humidity`,
        status.humidity,
        "value.humidity",
        "Humidity",
        "number",
        "%"
      );
    }
    if (status.battery !== null) {
      await this.setStateValue(`${prefix}.battery`, status.battery, "value.battery", "Battery", "number", "%");
    }
    if (status.illuminance !== null) {
      await this.setStateValue(
        `${prefix}.illuminance`,
        status.illuminance,
        "value.brightness",
        "Illuminance",
        "number",
        "lx"
      );
    }
    if (status.pressure !== null) {
      await this.setStateValue(
        `${prefix}.pressure`,
        status.pressure,
        "value.pressure",
        "Pressure",
        "number",
        "Pa"
      );
    }
    if (status.rssi !== null) {
      await this.setStateValue(`${prefix}.rssi`, status.rssi, "value", "RF RSSI", "number", "dBm");
    }
    if (status.rainTotalMm !== null || status.rainHourMm !== null) {
      await this.extendObjectAsync(`${prefix}.rain`, {
        type: "channel",
        common: { name: "Rain" },
        native: {}
      });
      if (status.rainTotalMm !== null) {
        await this.setStateValue(
          `${prefix}.rain.total`,
          status.rainTotalMm,
          "value",
          "Rain total",
          "number",
          "mm"
        );
      }
      if (status.rainHourMm !== null) {
        await this.setStateValue(
          `${prefix}.rain.lastHour`,
          status.rainHourMm,
          "value",
          "Rain last hour",
          "number",
          "mm"
        );
      }
      if (status.rainDailyMm !== null) {
        await this.setStateValue(
          `${prefix}.rain.last24h`,
          status.rainDailyMm,
          "value",
          "Rain last 24h",
          "number",
          "mm"
        );
      }
      if (status.rainWeekMm !== null) {
        await this.setStateValue(
          `${prefix}.rain.last7d`,
          status.rainWeekMm,
          "value",
          "Rain last 7 days",
          "number",
          "mm"
        );
      }
    }
    for (const zone of status.zones) {
      const zonePrefix = `${prefix}.zones.${zone.port}`;
      await this.setState(`${zonePrefix}.on`, zone.isOn, true);
      await this.setState(`${zonePrefix}.remaining`, zone.remainingSeconds, true);
      await this.setState(`${zonePrefix}.name`, zone.name, true);
    }
  }
  async setStateValue(id, value, role, name, type = "string", unit) {
    await this.extendObjectAsync(id, {
      type: "state",
      common: {
        name,
        type,
        role,
        read: true,
        write: false,
        ...unit ? { unit } : {}
      },
      native: {}
    });
    await this.setState(id, value, true);
  }
  async onStateChange(id, state) {
    if (!state || state.ack || !this.client) {
      return;
    }
    const target = this.zoneTargets.get(id);
    if (!target) {
      if (id.endsWith(".duration")) {
        await this.setState(id, state.val, true);
      }
      return;
    }
    if (typeof state.val !== "boolean") {
      return;
    }
    this.commandInFlight = true;
    try {
      if (state.val) {
        const durationState = await this.getStateAsync(`${target.prefix}.duration`);
        const minutes = typeof (durationState == null ? void 0 : durationState.val) === "number" && durationState.val > 0 ? durationState.val : this.config.defaultDuration || 10;
        const seconds = Math.round(minutes * 60);
        this.log.info(`Opening ${target.deviceId} zone ${target.port} for ${minutes} min`);
        await this.client.turnZoneOn(target.deviceId, target.port, seconds);
        await this.setState(`${target.prefix}.on`, true, true);
        await this.setState(`${target.prefix}.remaining`, seconds, true);
      } else {
        this.log.info(`Closing ${target.deviceId} zone ${target.port}`);
        await this.client.turnZoneOff(target.deviceId, target.port);
        await this.setState(`${target.prefix}.on`, false, true);
        await this.setState(`${target.prefix}.remaining`, 0, true);
      }
    } catch (error) {
      this.log.error(`Valve command failed: ${error.message}`);
      await this.setState("info.lastError", error.message, true);
      await this.setState(`${target.prefix}.on`, !state.val, true);
    } finally {
      this.commandInFlight = false;
    }
  }
  onUnload(callback) {
    this.unloading = true;
    try {
      if (this.pollTimer) {
        this.clearTimeout(this.pollTimer);
      }
      if (this.remainingTimer) {
        this.clearTimeout(this.remainingTimer);
      }
      void this.setState("info.connection", false, true);
      callback();
    } catch {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Rainpoint(options);
} else {
  (() => new Rainpoint())();
}
//# sourceMappingURL=main.js.map
