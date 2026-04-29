"use client";

import { useEffect, useRef, useState } from "react";

interface GlobeVizProps {
  size?: number;
  dotColor?: string;
  lineColor?: string;
  bgColor?: string;
  theme?: "dark" | "light";
  className?: string;
}

/**
 * Lightweight wireframe dotted globe — no external data fetch,
 * drawn with pure Canvas2D using a simplified sphere + lat/lng grid.
 */
export function GlobeViz({
  size = 160,
  dotColor,
  lineColor,
  bgColor = "transparent",
  theme = "dark",
  className = "",
}: GlobeVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const rotationRef = useRef(0);

  const resolvedDotColor = dotColor ?? (theme === "dark" ? "rgba(147,197,253,0.75)" : "rgba(29,78,216,0.55)");
  const resolvedLineColor = lineColor ?? (theme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(29,78,216,0.10)");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const px = size * dpr;
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d")!;
    const cx = px / 2;
    const cy = px / 2;
    const r = (size / 2 - 6) * dpr;

    // ── Convert lat/lng + yaw to 3-D point ──
    const project = (lat: number, lng: number, yaw: number) => {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lng + yaw) * (Math.PI / 180);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = -r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      return { x: cx + x, y: cy + y, z };
    };

    // ── Simple land approximation: major continent lat/lng bands ──
    // Each entry: [minLat, maxLat, minLng, maxLng]
    const landBands: [number, number, number, number][] = [
      // North America
      [25, 72, -168, -52],
      // Greenland
      [60, 83, -55, -15],
      // South America
      [-56, 12, -82, -34],
      // Europe
      [36, 71, -10, 40],
      // Africa
      [-35, 37, -18, 52],
      // Asia (rough)
      [5, 77, 25, 145],
      // Southeast Asia
      [-10, 25, 95, 145],
      // Australia
      [-44, -10, 113, 154],
      // Antarctica
      [-90, -66, -180, 180],
      // Japan/Korea
      [30, 46, 128, 146],
      // UK/Ireland
      [50, 62, -10, 2],
      // Indonesia
      [-8, 6, 95, 141],
    ];

    const isLand = (lat: number, lng: number): boolean => {
      const normLng = ((lng + 180) % 360) - 180;
      return landBands.some(
        ([mnLat, mxLat, mnLng, mxLng]) =>
          lat >= mnLat && lat <= mxLat && normLng >= mnLng && normLng <= mxLng,
      );
    };

    // Pre-generate grid dots
    const STEP = 7;
    const dots: { lat: number; lng: number; land: boolean }[] = [];
    for (let lat = -90; lat <= 90; lat += STEP) {
      for (let lng = -180; lng < 180; lng += STEP) {
        dots.push({ lat, lng, land: isLand(lat, lng) });
      }
    }

    // Lat/lng graticule lines
    const graticuleLines: [number, number][][] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: [number, number][] = [];
      for (let lng = -180; lng <= 180; lng += 5) pts.push([lat, lng]);
      graticuleLines.push(pts);
    }
    for (let lng = -180; lng < 180; lng += 30) {
      const pts: [number, number][] = [];
      for (let lat = -90; lat <= 90; lat += 5) pts.push([lat, lng]);
      graticuleLines.push(pts);
    }

    const draw = () => {
      ctx.clearRect(0, 0, px, px);
      const yaw = rotationRef.current;

      // Globe sphere fill
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = bgColor === "transparent"
        ? theme === "dark" ? "rgba(4,6,26,0.0)" : "rgba(255,255,255,0.0)"
        : bgColor;
      ctx.fill();

      // Graticule
      ctx.save();
      ctx.strokeStyle = resolvedLineColor;
      ctx.lineWidth = 0.75 * dpr;
      for (const line of graticuleLines) {
        ctx.beginPath();
        let first = true;
        for (const [lat, lng] of line) {
          const { x, y, z } = project(lat, lng, yaw);
          if (z < 0) { first = true; continue; } // behind sphere
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Dots
      for (const { lat, lng, land } of dots) {
        const { x, y, z } = project(lat, lng, yaw);
        if (z < 0) continue; // behind sphere
        const alpha = 0.3 + (z / r) * 0.7; // depth shading
        const radius = land ? 1.6 * dpr : 1.0 * dpr;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        const base = land ? resolvedDotColor : (theme === "dark" ? "rgba(255,255,255,0.18)" : "rgba(29,78,216,0.18)");
        // Apply depth alpha via globalAlpha
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = base;
        ctx.fill();
        ctx.restore();
      }

      // Globe rim
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = theme === "dark"
        ? "rgba(255,255,255,0.12)"
        : "rgba(29,78,216,0.14)";
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      rotationRef.current += 0.25;
      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frameRef.current);
  }, [size, theme, resolvedDotColor, resolvedLineColor, bgColor]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
