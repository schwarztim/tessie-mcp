#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TessieClient } from "./tessie-client.ts";
import { wrapContent, summarizeList } from "./format.ts";
import { toMcpError } from "./errors.ts";
import {
  toBatterySummary,
  toDriveSummary,
  toStateSummary,
  toVehicleListItem,
} from "./mappers.ts";
import {
  TessieBatteryState,
  TessieDrive,
  TessieVehicleState,
} from "./types.ts";

export const configSchema = z.object({
  accessToken: z
    .string()
    .min(1)
    .describe("Tessie API access token from https://dash.tessie.com/settings/api"),
});

export function getTool(server: McpServer, name: string) {
  // MCP SDK keeps tools private; this is a test helper.
  return (server as any)._registeredTools?.[name];
}

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

const operations = [
  // Basic Vehicle Control
  "lock",
  "unlock",
  "wake",
  "flash_lights",
  "honk",

  // Trunk & Access
  "activate_front_trunk",
  "activate_rear_trunk",
  "open_tonneau",
  "close_tonneau",

  // Windows & Sunroof
  "vent_windows",
  "close_windows",
  "vent_sunroof",
  "close_sunroof",

  // Climate Control
  "start_climate",
  "stop_climate",
  "set_temperature",
  "set_seat_heating",
  "set_seat_cooling",
  "start_defrost",
  "stop_defrost",
  "start_steering_wheel_heater",
  "stop_steering_wheel_heater",
  "set_cabin_overheat_protection",
  "set_cabin_overheat_protection_temp",
  "set_bioweapon_mode",
  "set_climate_keeper_mode",

  // Charging
  "start_charging",
  "stop_charging",
  "set_charge_limit",
  "set_charging_amps",
  "open_charge_port",
  "close_charge_port",
  "set_scheduled_charging",
  "add_charge_schedule",
  "remove_charge_schedule",

  // Convenience & Features
  "trigger_homelink",
  "remote_start",
  "remote_boombox",
  "share",

  // Security & Modes
  "enable_sentry_mode",
  "disable_sentry_mode",
  "enable_valet_mode",
  "disable_valet_mode",
  "enable_guest_mode",
  "disable_guest_mode",

  // Speed Limiting
  "set_speed_limit",
  "enable_speed_limit",
  "disable_speed_limit",
  "clear_speed_limit_pin",

  // Software Updates
  "schedule_software_update",
  "cancel_software_update",

  // Scheduling & Departure
  "set_scheduled_departure",
  "add_precondition_schedule",
  "remove_precondition_schedule",
] as const;

const SAFE_OPERATIONS: Operation[] = [
  "flash_lights",
  "honk",
  "wake",
  "activate_front_trunk",
  "activate_rear_trunk",
  "open_tonneau",
  "close_tonneau",
  "vent_windows",
  "close_windows",
  "vent_sunroof",
  "close_sunroof",
  "trigger_homelink",
  "remote_boombox",
];
const LIST_LIMIT = 12;
const PATH_POINT_LIMIT = 200;

type Operation = (typeof operations)[number];

type CommandInput = {
  vin: string;
  operation: Operation;
  params?: {
    charge_limit_percent?: number;
    charging_amps?: number;
    cabin_temp_c?: number;
    seat_position?: number;
    seat_level?: number;
    speed_limit_mph?: number;
    speed_limit_pin?: string;
    fan_only?: boolean;
    cabin_overheat_on?: boolean;
    cabin_overheat_temp_c?: number;
    wait_for_completion?: boolean;
    confirm?: boolean;
  };
};

const commandMap: Record<
  CommandInput["operation"],
  {
    endpoint: string;
    buildPayload?: (params?: CommandInput["params"]) => Record<string, unknown>;
  }
> = {
  lock: { endpoint: "lock" },
  unlock: { endpoint: "unlock" },
  start_charging: { endpoint: "start_charging" },
  stop_charging: { endpoint: "stop_charging" },
  flash_lights: { endpoint: "flash" },
  honk: { endpoint: "honk" },
  wake: { endpoint: "wake" },
  start_climate: { endpoint: "start_climate" },
  stop_climate: { endpoint: "stop_climate" },
  start_defrost: { endpoint: "start_max_defrost" },
  stop_defrost: { endpoint: "stop_max_defrost" },
  start_steering_wheel_heater: { endpoint: "start_steering_wheel_heater" },
  stop_steering_wheel_heater: { endpoint: "stop_steering_wheel_heater" },
  set_charge_limit: {
    endpoint: "set_charge_limit",
    buildPayload: (p) => ({
      percent: p?.charge_limit_percent,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_charging_amps: {
    endpoint: "set_charging_amps",
    buildPayload: (p) => ({
      amps: p?.charging_amps,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_temperature: {
    endpoint: "set_temperature",
    buildPayload: (p) => ({
      temperature: p?.cabin_temp_c,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_seat_heating: {
    endpoint: "set_seat_heat",
    buildPayload: (p) => ({
      seat: p?.seat_position,
      level: p?.seat_level,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_seat_cooling: {
    endpoint: "set_seat_cool",
    buildPayload: (p) => ({
      seat: p?.seat_position,
      level: p?.seat_level,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_speed_limit: {
    endpoint: "set_speed_limit",
    buildPayload: (p) => ({
      mph: p?.speed_limit_mph,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  enable_speed_limit: {
    endpoint: "enable_speed_limit",
    buildPayload: (p) => ({
      pin: p?.speed_limit_pin,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  disable_speed_limit: {
    endpoint: "disable_speed_limit",
    buildPayload: (p) => ({
      pin: p?.speed_limit_pin,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  clear_speed_limit_pin: {
    endpoint: "clear_speed_limit_pin",
    buildPayload: (p) => ({
      pin: p?.speed_limit_pin,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_cabin_overheat_protection: {
    endpoint: "set_cabin_overheat_protection",
    buildPayload: (p) => ({
      on: p?.cabin_overheat_on,
      fan_only: p?.fan_only,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_cabin_overheat_protection_temp: {
    endpoint: "set_cop_temp",
    buildPayload: (p) => ({
      cop_temp: p?.cabin_overheat_temp_c,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  enable_sentry_mode: { endpoint: "enable_sentry" },
  disable_sentry_mode: { endpoint: "disable_sentry" },

  // Trunk & Access
  activate_front_trunk: { endpoint: "activate_front_trunk" },
  activate_rear_trunk: { endpoint: "activate_rear_trunk" },
  open_tonneau: { endpoint: "open_tonneau" },
  close_tonneau: { endpoint: "close_tonneau" },

  // Windows & Sunroof
  vent_windows: { endpoint: "vent_windows" },
  close_windows: { endpoint: "close_windows" },
  vent_sunroof: { endpoint: "vent_sunroof" },
  close_sunroof: { endpoint: "close_sunroof" },

  // Charging (additional)
  open_charge_port: { endpoint: "open_charge_port" },
  close_charge_port: { endpoint: "close_charge_port" },
  set_scheduled_charging: {
    endpoint: "set_scheduled_charging",
    buildPayload: (p) => ({
      enable: p?.cabin_overheat_on,
      time: p?.speed_limit_pin, // Reusing fields for flexibility
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  add_charge_schedule: {
    endpoint: "add_charge_schedule",
    buildPayload: (p) => ({
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  remove_charge_schedule: {
    endpoint: "remove_charge_schedule",
    buildPayload: (p) => ({
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },

  // Climate (additional)
  set_bioweapon_mode: {
    endpoint: "set_bioweapon_mode",
    buildPayload: (p) => ({
      on: p?.cabin_overheat_on,
      manual_override: false,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  set_climate_keeper_mode: {
    endpoint: "set_climate_keeper_mode",
    buildPayload: (p) => ({
      mode: p?.seat_level ?? 0, // 0=off, 1=keep, 2=dog, 3=camp
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },

  // Convenience & Features
  trigger_homelink: { endpoint: "trigger_homelink" },
  remote_start: { endpoint: "remote_start" },
  remote_boombox: { endpoint: "remote_boombox" },
  share: {
    endpoint: "share",
    buildPayload: (p) => ({
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },

  // Security & Modes
  enable_valet_mode: {
    endpoint: "enable_valet",
    buildPayload: (p) => ({
      pin: p?.speed_limit_pin,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  disable_valet_mode: {
    endpoint: "disable_valet",
    buildPayload: (p) => ({
      pin: p?.speed_limit_pin,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  enable_guest_mode: { endpoint: "enable_guest" },
  disable_guest_mode: { endpoint: "disable_guest" },

  // Software Updates
  schedule_software_update: {
    endpoint: "schedule_software_update",
    buildPayload: (p) => ({
      offset: p?.charging_amps ?? 0,
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  cancel_software_update: { endpoint: "cancel_software_update" },

  // Scheduling & Departure
  set_scheduled_departure: {
    endpoint: "set_scheduled_departure",
    buildPayload: (p) => ({
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  add_precondition_schedule: {
    endpoint: "add_precondition_schedule",
    buildPayload: (p) => ({
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
  remove_precondition_schedule: {
    endpoint: "remove_precondition_schedule",
    buildPayload: (p) => ({
      wait_for_completion: p?.wait_for_completion ?? true,
    }),
  },
};

function ensurePositive(value: number | undefined, name: string) {
  if (value === undefined || Number.isNaN(value) || value <= 0) {
    throw new Error(`Missing or invalid ${name}`);
  }
}

function ensureNumberProvided(
  value: number | undefined,
  name: string,
  allowZero = false,
) {
  if (value === undefined || Number.isNaN(value) || (!allowZero && value <= 0)) {
    throw new Error(`Missing or invalid ${name}`);
  }
}

function ensureNonEmptyString(value: string | undefined, name: string) {
  if (!value || !value.trim()) {
    throw new Error(`Missing or invalid ${name}`);
  }
}

function ensureRange(
  value: number | undefined,
  name: string,
  min: number,
  max: number,
) {
  if (value === undefined || Number.isNaN(value) || value < min || value > max) {
    throw new Error(`Missing or invalid ${name} (expected ${min}-${max})`);
  }
}

function ensureBoolean(value: boolean | undefined, name: string) {
  if (value === undefined || typeof value !== "boolean") {
    throw new Error(`Missing or invalid ${name}`);
  }
}

export default function createServer({
  config,
  client: clientOverride,
}: {
  config: z.infer<typeof configSchema>;
  client?: TessieClient;
}) {
  const apiKey = config?.accessToken?.trim();
  const server = new McpServer({
    name: "tessie-mcp-server",
    title: "Tessie Vehicle Data (v2)",
    version: "2.0.0",
  });

  const client = clientOverride ?? (apiKey ? new TessieClient(apiKey) : null);

  const requireClient = () => {
    if (client) return client;
    throw new Error("TESSIE_API_KEY is required to call Tessie APIs.");
  };

  server.tool(
    "get_active_context",
    "Quick context: vehicles you can access plus next-step guidance.",
    {
      only_active: z.boolean().optional().describe("Only include vehicles with an active status."),
    },
    async ({ only_active }) => {
      try {
        const activeClient = requireClient();
        const vehicles = await activeClient.listVehicles({ onlyActive: only_active });
        const items = vehicles.map((v) => toVehicleListItem(v));

        return wrapContent({
          vehicles: summarizeList(items, LIST_LIMIT),
          next_steps: [
            "Use fetch_vehicle_state to inspect a specific VIN.",
            "Use manage_vehicle_command to act safely with confirmation.",
            "Use search_drives to pull recent driving history.",
          ],
        });
      } catch (error) {
        return wrapContent(toMcpError(error, "get_active_context"));
      }
    },
  );

  server.tool(
    "fetch_vehicle_state",
    "Fetch the latest vehicle state (location, climate, locks, battery snapshot).",
    {
      vin: z.string().regex(VIN_REGEX, "VIN must be 17 alphanumeric characters (no I/O/Q).").describe("Vehicle VIN."),
    },
    async ({ vin }) => {
      try {
        const activeClient = requireClient();
        const state: TessieVehicleState = await activeClient.getVehicleState(vin);
        const summary = toStateSummary(vin, state);

        return wrapContent({
          summary,
          raw_state: state,
        });
      } catch (error) {
        return wrapContent(toMcpError(error, "fetch_vehicle_state"));
      }
    },
  );

  server.tool(
    "fetch_vehicle_battery",
    "Fetch battery and charging details for a vehicle.",
    {
      vin: z.string().regex(VIN_REGEX, "VIN must be 17 alphanumeric characters (no I/O/Q).").describe("Vehicle VIN."),
    },
    async ({ vin }) => {
      try {
        const activeClient = requireClient();
        const battery: TessieBatteryState = await activeClient.getVehicleBattery(vin);
        return wrapContent({
          summary: toBatterySummary(vin, battery),
          battery,
        });
      } catch (error) {
        return wrapContent(toMcpError(error, "fetch_vehicle_battery"));
      }
    },
  );

  server.tool(
    "search_drives",
    "List recent drives for a vehicle (summary-first with optional date range).",
    {
      vin: z.string().regex(VIN_REGEX, "VIN must be 17 alphanumeric characters (no I/O/Q).").describe("Vehicle VIN."),
      start: z.string().optional().describe("ISO 8601 start timestamp."),
      end: z.string().optional().describe("ISO 8601 end timestamp."),
      limit: z.number().int().positive().optional().default(20),
    },
    async ({ vin, start, end, limit = 20 }) => {
      try {
        const activeClient = requireClient();
        const drives: TessieDrive[] = await activeClient.getDrives(vin, { start, end, limit });
        const summaries = drives.map((drive) => toDriveSummary(drive));

        return wrapContent({
          vin,
          drives: summarizeList(summaries, limit),
          note: "Use get_driving_path for coordinates or fetch_vehicle_state for live status.",
        });
      } catch (error) {
        return wrapContent(toMcpError(error, "search_drives"));
      }
    },
  );

  server.tool(
    "get_driving_path",
    "Get driving path coordinates for a vehicle over a timeframe.",
    {
      vin: z.string().regex(VIN_REGEX, "VIN must be 17 alphanumeric characters (no I/O/Q).").describe("Vehicle VIN."),
      start: z.string().optional().describe("ISO 8601 start timestamp."),
      end: z.string().optional().describe("ISO 8601 end timestamp."),
    },
    async ({ vin, start, end }) => {
      try {
        const activeClient = requireClient();
        const path: any[] = await activeClient.getDrivingPath(vin, { start, end });
        return wrapContent({
          vin,
          points: summarizeList(path, PATH_POINT_LIMIT),
          guidance: "Use this polyline for mapping or anomaly detection.",
        });
      } catch (error) {
        return wrapContent(toMcpError(error, "get_driving_path"));
      }
    },
  );

  server.tool(
    "manage_vehicle_command",
    "Composite command executor for Tessie vehicle actions (lock, charging, climate, speed limit, sentry). Speed limit PIN is sensitive—avoid logging or sharing it.",
    {
      vin: z.string().regex(VIN_REGEX, "VIN must be 17 alphanumeric characters (no I/O/Q).").describe("Vehicle VIN."),
      operation: z.enum(operations),
      params: z
        .object({
          charge_limit_percent: z.number().optional(),
          charging_amps: z.number().optional(),
          cabin_temp_c: z.number().optional(),
          seat_position: z
            .number()
            .optional()
            .describe("Seat index per Tessie docs (0=driver,1=passenger,...)."),
          seat_level: z
            .number()
            .optional()
            .describe("Heating/cooling level (0-3)."),
          speed_limit_mph: z.number().optional(),
          speed_limit_pin: z.string().optional().describe("Speed limit PIN (sensitive; avoid logging)."),
          fan_only: z.boolean().optional(),
          cabin_overheat_on: z.boolean().optional(),
          cabin_overheat_temp_c: z.number().optional(),
          wait_for_completion: z.boolean().optional(),
          confirm: z
            .boolean()
            .optional()
            .describe("Required true for state-changing operations."),
        })
        .optional(),
    },
    async ({ vin, operation, params }) => {
      try {
        const activeClient = requireClient();
        const config = commandMap[operation];
        if (!config) {
          throw new Error(`Unsupported operation: ${operation}`);
        }

        const isDestructive = !SAFE_OPERATIONS.includes(operation);
        if (isDestructive && params?.confirm !== true) {
          return wrapContent({
            isError: true,
            message: "Confirmation required for this operation.",
            guidance: "Pass params.confirm: true to proceed.",
          });
        }

        if (operation === "set_charge_limit") {
          ensureRange(params?.charge_limit_percent, "charge_limit_percent", 1, 100);
        }
        if (operation === "set_charging_amps") {
          ensurePositive(params?.charging_amps, "charging_amps");
        }
        if (operation === "set_temperature") {
          ensureRange(params?.cabin_temp_c, "cabin_temp_c", -10, 40);
        }
        if (operation === "set_speed_limit") {
          ensurePositive(params?.speed_limit_mph, "speed_limit_mph");
        }
        if (operation === "set_seat_heating" || operation === "set_seat_cooling") {
          ensureNumberProvided(params?.seat_position, "seat_position", true);
          ensureRange(params?.seat_level, "seat_level", 0, 3);
        }
        if (
          operation === "enable_speed_limit" ||
          operation === "disable_speed_limit" ||
          operation === "clear_speed_limit_pin"
        ) {
          ensureNonEmptyString(params?.speed_limit_pin, "speed_limit_pin");
        }
        if (operation === "set_cabin_overheat_protection_temp") {
          ensureRange(params?.cabin_overheat_temp_c, "cabin_overheat_temp_c", 15, 60);
        }
        if (operation === "set_cabin_overheat_protection") {
          ensureBoolean(params?.cabin_overheat_on, "cabin_overheat_on");
        }

        const payload = config.buildPayload
          ? config.buildPayload(params)
          : { wait_for_completion: params?.wait_for_completion ?? true };

        const result = await activeClient.sendCommand(vin, config.endpoint, payload);
        return wrapContent({
          vin,
          operation,
          request: payload,
          result,
          guidance: "Verify status with fetch_vehicle_state if needed.",
        });
      } catch (error) {
        return wrapContent(toMcpError(error, "manage_vehicle_command"));
      }
    },
  );

  return server;
}
