import { apiClient } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EnergyLatest {
  timestamp: string;
  // AC
  ac_power_mode: string | null;
  ac_operation_mode: string | null;
  ac_current_temp_f: number;
  ac_target_temp_f: number;
  ac_consumption_w: number;
  ac_fan_speed: string | null;
  // HWH
  hwh_set_point_f: number;
  hwh_running: boolean;
  hwh_consumption_w: number;
  hwh_tank_health: number | null;
  hwh_compressor_health: number | null;
  hwh_todays_energy_kwh: number | null;
  // Solar
  solar_current_power_w: number;
  solar_system_status: string | null;
  // Computed
  total_consumption_w: number;
  net_balance_w: number;
  // Recommendations
  overall_recommendation: string | null;
  recommendation_reason: string | null;
}

export interface EnergyHistory {
  labels: string[];
  solar: number[];
  ac: number[];
  hwh: number[];
  consumption: number[];
  net: number[];
}

export interface EnergyStats {
  solar_peak_today: number;
  total_consumption_avg: number;
  savings_status: "SURPLUS" | "DEFICIT" | "UNKNOWN";
}

export interface EnergyDashboardData {
  latest: EnergyLatest | null;
  history: EnergyHistory;
  stats: EnergyStats;
  live: boolean;
}

// ── API ────────────────────────────────────────────────────────────────────────

export const energyApi = {
  getDashboard: async (hours = 24): Promise<EnergyDashboardData> => {
    const { data } = await apiClient.get<EnergyDashboardData>("/energy/dashboard", {
      params: { hours },
    });
    return data;
  },
};
