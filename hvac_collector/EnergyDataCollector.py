#!/usr/bin/env python3
"""
Unified Energy Data Collector
Collects data from AC, Water Heater, and Solar systems every hour
Provides recommendations for optimal energy usage based on solar production
"""

import asyncio
import csv
import os
import json
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import APIs
from pyeconet import EcoNetApiInterface
from pyeconet.equipment import EquipmentType
import requests
import base64
import aiohttp
import uuid
from thinqconnect import ThinQApi

# Import automated auth
from AutomatedAuth import load_tokens, is_token_valid, automated_auth

# ============================================================================
# CONFIGURATION
# ============================================================================

# AC (LG ThinQ) Configuration
AC_PAT = os.getenv("AC_PAT")
AC_COUNTRY_CODE = os.getenv("AC_COUNTRY_CODE", "US")

# Water Heater (EcoNet) Configuration
HWH_EMAIL = os.getenv("HWH_EMAIL")
HWH_PASSWORD = os.getenv("HWH_PASSWORD")

# Solar (Enphase) Configuration
SOLAR_CLIENT_ID = os.getenv("SOLAR_CLIENT_ID")
SOLAR_CLIENT_SECRET = os.getenv("SOLAR_CLIENT_SECRET")
SOLAR_API_KEY = os.getenv("SOLAR_API_KEY")
SOLAR_SYSTEM_ID = os.getenv("SOLAR_SYSTEM_ID")
SOLAR_USE_FALLBACK_ONLY = os.getenv("SOLAR_USE_FALLBACK_ONLY", "false").strip().lower() in ("1", "true", "yes", "on")

# CSV Configuration — 3 separate files
AC_CSV_FILE = "ac_data.csv"
AC_CSV_HEADERS = [
    "timestamp",
    "hour",
    "ac_device_name",
    "ac_power_mode",
    "ac_operation_mode",
    "ac_run_state",
    "ac_current_temp_c",
    "ac_target_temp_c",
    "ac_current_temp_f",
    "ac_target_temp_f",
    "ac_fan_speed",
    "ac_recommendation",
]

HWH_CSV_FILE = "hwh_data.csv"
HWH_CSV_HEADERS = [
    "timestamp",
    "hour",
    "hwh_set_point_f",
    "hwh_mode",
    "hwh_mode_name",
    "hwh_running",
    "hwh_tank_health",
    "hwh_compressor_health",
    "hwh_todays_energy_kwh",
    "hwh_connected",
    "hwh_recommendation",
]

SOLAR_CSV_FILE = "solar_data.csv"
SOLAR_CSV_HEADERS = [
    "timestamp",
    "hour",
    "solar_current_power_w",
    "solar_energy_lifetime_wh",
    "solar_system_status",
    "overall_recommendation",
    "recommendation_reason",
]

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_enphase_access_token(refreshToken):
    """Get Enphase access token from refresh token"""
    credentials = f"{SOLAR_CLIENT_ID}:{SOLAR_CLIENT_SECRET}"
    encoded_credentials = base64.b64encode(credentials.encode()).decode()
    
    headers = {
        'Authorization': f'Basic {encoded_credentials}'
    }
    
    url = f"https://api.enphaseenergy.com/oauth/token?grant_type=refresh_token&refresh_token={refreshToken}"
    
    try:
        response = requests.post(url, headers=headers, data={})
        if response.status_code == 200:
            data = response.json()
            return data.get("access_token")
        else:
            print(f"  ⚠ Failed to get Enphase token: {response.status_code}")
            return None
    except Exception as e:
        print(f"  ⚠ Error getting Enphase token: {e}")
        return None

def get_solar_summary(accessToken):
    """Fetch solar system summary"""
    url = f"https://api.enphaseenergy.com/api/v4/systems/{SOLAR_SYSTEM_ID}/summary?key={SOLAR_API_KEY}"
    headers = {
        'Authorization': f"Bearer {accessToken}"
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  ⚠ Error fetching solar summary: {e}")
        return None

def get_mode_name(mode):
    """Convert water heater mode number to readable name"""
    mode_map = {
        1: "OFF",
        2: "ELECTRIC_MODE",
        3: "ENERGY_SAVING",
        4: "HEAT_PUMP_ONLY",
        5: "HIGH_DEMAND",
        9: "VACATION"
    }
    return mode_map.get(mode, f"UNKNOWN_{mode}")

def get_ac_recommendation(solar_power, ac_current_temp_f, ac_target_temp_f):
    """
    Recommend AC on/off based on solar production and temperature
    
    Logic:
    - If solar production is high (>500W) and temp difference significant, recommend ON
    - If solar production is low (<200W), recommend OFF
    - If moderate solar, recommend based on temp difference
    """
    temp_diff = abs(ac_current_temp_f - ac_target_temp_f)
    
    if solar_power is None:
        solar_power = 0
    
    if solar_power > 500 and temp_diff > 2:
        return "ON", f"Good solar production ({solar_power}W) and temperature difference ({temp_diff}°F)"
    elif solar_power < 200 or temp_diff < 1:
        return "OFF", f"Low solar production ({solar_power}W) or minimal temperature difference"
    elif 200 <= solar_power <= 500:
        if temp_diff > 3:
            return "ON", f"Moderate solar ({solar_power}W) with significant temp difference ({temp_diff}°F)"
        else:
            return "OFF", f"Moderate solar ({solar_power}W) with low temp difference ({temp_diff}°F)"
    else:
        return "STANDBY", "Insufficient data for recommendation"

def get_hwh_recommendation(solar_power, hwh_running, tank_health):
    """
    Recommend Water Heater on/off based on solar production
    
    Logic:
    - If solar production is high and tank not fully healthy, recommend ON
    - If solar production is low, recommend OFF
    - Consider tank health status
    """
    if solar_power is None:
        solar_power = 0
    
    if tank_health is None:
        tank_health = 50
    
    # If solar production is excellent (>1000W) and tank health < 100, allow heating
    if solar_power > 1000 and tank_health < 100:
        return "ON", f"Excellent solar production ({solar_power}W), tank health: {tank_health}%"
    
    # If solar is good (>500W) and tank needs heating
    elif solar_power > 500 and tank_health < 80:
        return "ON", f"Good solar production ({solar_power}W), tank health: {tank_health}%"
    
    # If solar is marginal or tank is healthy, keep off
    elif solar_power < 300 or tank_health >= 95:
        return "OFF", f"Low solar ({solar_power}W) or tank already healthy ({tank_health}%)"
    
    else:
        return "EFFICIENT_MODE", f"Moderate solar ({solar_power}W), tank health: {tank_health}%"

def get_overall_recommendation(ac_rec, hwh_rec):
    """Combine individual recommendations"""
    ac_status, _ = ac_rec
    hwh_status, _ = hwh_rec
    
    if ac_status == "ON" or hwh_status == "ON":
        return "MAXIMIZED_USAGE", "Using solar energy for climate control"
    else:
        return "CONSERVATIVE", "Minimal electrical usage, preserving energy"

# ============================================================================
# DATA COLLECTION FUNCTIONS
# ============================================================================

async def collect_ac_data():
    """Collect AC data from LG ThinQ API"""
    try:
        print("[AC] Connecting to LG ThinQ API...")
        async with aiohttp.ClientSession() as session:
            api = ThinQApi(
                session=session,
                access_token=AC_PAT,
                country_code=AC_COUNTRY_CODE,
                client_id=str(uuid.uuid4())
            )
            
            devices = await api.async_get_device_list()
            if not devices:
                print("[AC] No devices found")
                return None
            
            device = devices[0]  # Get first device
            device_info = device.get('deviceInfo', {})
            device_id = device.get('deviceId')
            device_name = device_info.get('alias', 'Unknown AC')
            
            status = await api.async_get_device_status(device_id)
            
            # Parse status data
            operation = status.get('operation', {})
            power_mode = operation.get('airConOperationMode', 'UNKNOWN')
            
            job_mode = status.get('airConJobMode', {})
            operation_mode = job_mode.get('currentJobMode', 'UNKNOWN')
            
            run_state = status.get('runState', {})
            state = run_state.get('currentState', 'UNKNOWN')
            
            temp_units = status.get('temperatureInUnits', [])
            temp_c = temp_f = target_c = target_f = None
            
            for temp_unit in temp_units:
                if temp_unit.get('unit') == 'C':
                    temp_c = temp_unit.get('currentTemperature')
                    target_c = temp_unit.get('targetTemperature')
                elif temp_unit.get('unit') == 'F':
                    temp_f = temp_unit.get('currentTemperature')
                    target_f = temp_unit.get('targetTemperature')
            
            air_flow = status.get('airFlow', {})
            fan_speed = air_flow.get('windStrength', 'UNKNOWN')
            
            print(f"[AC] ✓ Data collected: {device_name}")
            
            return {
                "device_name": device_name,
                "power_mode": power_mode,
                "operation_mode": operation_mode,
                "run_state": state,
                "current_temp_c": temp_c,
                "target_temp_c": target_c,
                "current_temp_f": temp_f,
                "target_temp_f": target_f,
                "fan_speed": fan_speed
            }
    except Exception as e:
        print(f"[AC] ✗ Error: {e}")
        return None

async def collect_hwh_data():
    """Collect Water Heater data from EcoNet API"""
    try:
        print("[HWH] Connecting to EcoNet API...")
        api = await EcoNetApiInterface.login(HWH_EMAIL, password=HWH_PASSWORD)
        
        all_equipment = await api.get_equipment_by_type([EquipmentType.WATER_HEATER])
        
        hwh_data = None
        for equip_list in all_equipment.values():
            for device in equip_list:
                # Retry energy usage fetch up to 2 times
                for attempt in range(2):
                    try:
                        await device.get_energy_usage()
                        break  # success
                    except Exception as e:
                        if attempt == 1:
                            print(f"[HWH] ⚠ Could not fetch energy usage after 2 attempts: {e}")
                
                hwh_data = {
                    "set_point": device.set_point if hasattr(device, 'set_point') else None,
                    "mode": device.mode if hasattr(device, 'mode') else None,
                    "mode_name": get_mode_name(device.mode) if hasattr(device, 'mode') else None,
                    "running": device.running if hasattr(device, 'running') else None,
                    "tank_health": device.tank_health if hasattr(device, 'tank_health') else None,
                    "compressor_health": device.compressor_health if hasattr(device, 'compressor_health') else None,
                    "todays_energy_kwh": device.todays_energy_usage if hasattr(device, 'todays_energy_usage') else None,
                    "connected": device.connected if hasattr(device, 'connected') else None,
                }
                break
            break
        
        if hwh_data:
            print("[HWH] ✓ Data collected")
        return hwh_data
        
    except Exception as e:
        print(f"[HWH] ✗ Error: {e}")
        return None

def collect_solar_data():
    """Collect Solar data from Enphase API with automated authentication"""
    try:
        if SOLAR_USE_FALLBACK_ONLY:
            print("[SOLAR] Fallback-only mode enabled; skipping Enphase OAuth")
            return get_fallback_solar_data()

        print("[SOLAR] Checking for valid authentication...")
        
        # Try to load existing tokens
        token_data = load_tokens()
        
        if token_data and 'refresh_token' in token_data:
            REFRESH_TOKEN = token_data.get('refresh_token')
        else:
            print("[SOLAR] No valid token found, initiating automated authentication...")
            token_data = automated_auth()
            if not token_data:
                print("[SOLAR] ✗ Authentication failed")
                return get_fallback_solar_data()
            REFRESH_TOKEN = token_data.get('refresh_token')
        
        print("[SOLAR] Getting access token...")
        accessToken = get_enphase_access_token(REFRESH_TOKEN)
        
        if not accessToken:
            print("[SOLAR] ⚠ Failed to get access token, using fallback data")
            return get_fallback_solar_data()
        
        print("[SOLAR] Fetching system summary...")
        summary = get_solar_summary(accessToken)
        
        if summary:
            print("[SOLAR] ✓ Data collected")
            return {
                "current_power": summary.get('current_power'),
                "energy_lifetime": summary.get('energy_lifetime'),
                "status": summary.get('status')
            }
        return get_fallback_solar_data()
        
    except Exception as e:
        print(f"[SOLAR] ✗ Error: {e}")
        return get_fallback_solar_data()

def get_fallback_solar_data():
    """Fallback solar data based on time of day"""
    from datetime import datetime
    hour = datetime.now().hour
    
    # Simple fallback: higher generation during midday hours
    if 6 <= hour < 18:
        power = max(0, 500 - abs((hour - 12) * 100))  # Peak at noon
    else:
        power = 0
    
    return {
        "current_power": power,
        "energy_lifetime": 4511529,
        "status": "unavailable"
    }

# ============================================================================
# MAIN DATA COLLECTION AND CSV WRITE
# ============================================================================

async def collect_all_data():
    """Collect data from all three sources"""
    print(f"\n{'='*70}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting unified data collection")
    print(f"{'='*70}")
    
    # Collect AC data
    ac_data = await collect_ac_data()
    
    # Collect HWH data
    hwh_data = await collect_hwh_data()
    
    # Collect Solar data
    solar_data = collect_solar_data()
    
    # Generate recommendations
    ac_rec = ("UNAVAILABLE", "No AC data")
    hwh_rec = ("UNAVAILABLE", "No HWH data")
    overall_rec = ("UNAVAILABLE", "Insufficient data")
    
    if ac_data and solar_data and solar_data.get('current_power') is not None:
        ac_rec = get_ac_recommendation(
            solar_data.get('current_power'),
            ac_data.get('current_temp_f'),
            ac_data.get('target_temp_f')
        )
    
    if hwh_data and solar_data and solar_data.get('current_power') is not None:
        hwh_rec = get_hwh_recommendation(
            solar_data.get('current_power'),
            hwh_data.get('running'),
            hwh_data.get('tank_health')
        )
    
    if ac_rec[0] != "UNAVAILABLE" and hwh_rec[0] != "UNAVAILABLE":
        overall_rec_status, overall_reason = get_overall_recommendation(ac_rec, hwh_rec)
        overall_rec = (overall_rec_status, overall_reason)
    
    # Prepare data row
    now = datetime.now()
    data_row = {
        "timestamp": now.strftime('%Y-%m-%d %H:%M:%S'),
        "hour": now.strftime('%H'),
        
        # AC Data
        "ac_device_name": ac_data.get('device_name') if ac_data else None,
        "ac_power_mode": ac_data.get('power_mode') if ac_data else None,
        "ac_operation_mode": ac_data.get('operation_mode') if ac_data else None,
        "ac_run_state": ac_data.get('run_state') if ac_data else None,
        "ac_current_temp_c": ac_data.get('current_temp_c') if ac_data else None,
        "ac_target_temp_c": ac_data.get('target_temp_c') if ac_data else None,
        "ac_current_temp_f": ac_data.get('current_temp_f') if ac_data else None,
        "ac_target_temp_f": ac_data.get('target_temp_f') if ac_data else None,
        "ac_fan_speed": ac_data.get('fan_speed') if ac_data else None,
        
        # HWH Data
        "hwh_set_point_f": hwh_data.get('set_point') if hwh_data else None,
        "hwh_mode": hwh_data.get('mode') if hwh_data else None,
        "hwh_mode_name": hwh_data.get('mode_name') if hwh_data else None,
        "hwh_running": hwh_data.get('running') if hwh_data else None,
        "hwh_tank_health": hwh_data.get('tank_health') if hwh_data else None,
        "hwh_compressor_health": hwh_data.get('compressor_health') if hwh_data else None,
        "hwh_todays_energy_kwh": hwh_data.get('todays_energy_kwh') if hwh_data else None,
        "hwh_connected": hwh_data.get('connected') if hwh_data else None,
        
        # Solar Data
        "solar_current_power_w": solar_data.get('current_power') if solar_data else None,
        "solar_energy_lifetime_wh": solar_data.get('energy_lifetime') if solar_data else None,
        "solar_system_status": solar_data.get('status') if solar_data else None,
        
        # Recommendations
        "ac_recommendation": ac_rec[0],
        "hwh_recommendation": hwh_rec[0],
        "overall_recommendation": overall_rec[0],
        "recommendation_reason": overall_rec[1]
    }
    
    return data_row

def _append_to_csv(filepath, headers, row_data):
    """Append a single row to a CSV file, creating it with headers if needed."""
    file_exists = os.path.isfile(filepath)
    try:
        with open(filepath, 'a', newline='') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=headers, extrasaction='ignore')
            if not file_exists:
                writer.writeheader()
                print(f"[CSV] Created new file: {filepath}")
            writer.writerow(row_data)
            print(f"[CSV] ✓ Data written to {filepath}")
    except Exception as e:
        print(f"[CSV] ✗ Error writing to {filepath}: {e}")

async def write_to_csv(data_row):
    """Write data to the 3 separate CSV files (AC, HWH, Solar)"""
    _append_to_csv(AC_CSV_FILE,    AC_CSV_HEADERS,    data_row)
    _append_to_csv(HWH_CSV_FILE,   HWH_CSV_HEADERS,   data_row)
    _append_to_csv(SOLAR_CSV_FILE, SOLAR_CSV_HEADERS,  data_row)

async def write_to_supabase(data_row):
    """Write data row to Supabase energy_readings table (primary persistence)."""
    try:
        from supabase_writer import write_reading
        write_reading(
            ac_device_name         = data_row.get("ac_device_name"),
            ac_power_mode          = data_row.get("ac_power_mode"),
            ac_operation_mode      = data_row.get("ac_operation_mode"),
            ac_run_state           = data_row.get("ac_run_state"),
            ac_current_temp_c      = data_row.get("ac_current_temp_c"),
            ac_target_temp_c       = data_row.get("ac_target_temp_c"),
            ac_current_temp_f      = data_row.get("ac_current_temp_f"),
            ac_target_temp_f       = data_row.get("ac_target_temp_f"),
            ac_fan_speed           = data_row.get("ac_fan_speed"),
            ac_recommendation      = data_row.get("ac_recommendation"),
            hwh_set_point_f        = data_row.get("hwh_set_point_f"),
            hwh_mode               = data_row.get("hwh_mode"),
            hwh_mode_name          = data_row.get("hwh_mode_name"),
            hwh_running            = data_row.get("hwh_running"),
            hwh_tank_health        = data_row.get("hwh_tank_health"),
            hwh_compressor_health  = data_row.get("hwh_compressor_health"),
            hwh_todays_energy_kwh  = data_row.get("hwh_todays_energy_kwh"),
            hwh_connected          = data_row.get("hwh_connected"),
            hwh_recommendation     = data_row.get("hwh_recommendation"),
            solar_current_power_w  = data_row.get("solar_current_power_w"),
            solar_energy_lifetime_wh = data_row.get("solar_energy_lifetime_wh"),
            solar_system_status    = data_row.get("solar_system_status"),
            overall_recommendation = data_row.get("overall_recommendation"),
            recommendation_reason  = data_row.get("recommendation_reason"),
        )
    except Exception as e:
        print(f"[SUPABASE] ✗ Write failed (CSV still saved): {e}")

async def main():
    """Main function to collect and save data"""
    try:
        data_row = await collect_all_data()
        await write_to_csv(data_row)
        await write_to_supabase(data_row)

        # Print summary
        print(f"\n{'-'*70}")
        print("RECOMMENDATIONS SUMMARY:")
        print(f"  AC:       {data_row['ac_recommendation']}")
        print(f"  HWH:      {data_row['hwh_recommendation']}")
        print(f"  Overall:  {data_row['overall_recommendation']}")
        print(f"  Reason:   {data_row['recommendation_reason']}")
        print(f"  Solar:    {data_row['solar_current_power_w']} W")
        print(f"{'-'*70}\n")
        
    except Exception as e:
        print(f"✗ Fatal error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
