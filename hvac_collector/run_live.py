#!/usr/bin/env python3
"""
Live Energy Data Poller
Continuously collects data from AC (LG ThinQ), Water Heater (EcoNet),
and Solar (Enphase) every 15 seconds and writes to Supabase.

The React Energy Dashboard reads from Supabase via the FastAPI backend.
CSV files are kept as a local backup only.

Usage:
    cd hvac_collector
    python run_live.py
"""

import asyncio
from datetime import datetime
import EnergyDataCollector


async def poll_data():
    headers = [
        "timestamp", "hour", "ac_device_name", "ac_power_mode", "ac_operation_mode",
        "ac_run_state", "ac_current_temp_c", "ac_target_temp_c", "ac_current_temp_f",
        "ac_target_temp_f", "ac_fan_speed", "hwh_set_point_f", "hwh_mode",
        "hwh_mode_name", "hwh_running", "hwh_tank_health", "hwh_compressor_health",
        "hwh_todays_energy_kwh", "hwh_connected", "solar_current_power_w",
        "solar_energy_lifetime_wh", "solar_system_status", "ac_recommendation",
        "hwh_recommendation", "overall_recommendation", "recommendation_reason",
    ]

    print("🚀 Live Energy Poller started — writing to Supabase every 15 s")
    print("   React dashboard polls /energy/dashboard for live data.\n")

    while True:
        try:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 🔄 Collecting from devices...")
            data_row = await EnergyDataCollector.collect_all_data()

            # Primary: write to Supabase (React dashboard reads this)
            await EnergyDataCollector.write_to_supabase(data_row)

            # Backup: write to local CSV
            await EnergyDataCollector.write_to_csv(data_row)
            EnergyDataCollector._append_to_csv("energy_data.csv", headers, data_row)

        except Exception as e:
            print(f"  ✗ Error during poll: {e}")

        print("  ⏳ Next poll in 15 s...")
        await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(poll_data())
