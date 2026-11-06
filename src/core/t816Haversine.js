/*
 * t816Haversine.js — Haversine 球面距离（CyberChef #213）。
 *
 * 口径与 CyberChef src/core/operations/HaversineDistance.mjs 逐行一致：
 * 输入 "lat1, lng1, lat2, lng2"，地球半径 6371000 m，输出米数（String）。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";

register({
  id: "haversine",
  cat: "analysis",
  name: "Haversine 球面距离",
  desc: "输入 lat1,lng1,lat2,lng2（逗号分隔四值），按 Haversine 公式与 R=6371000 m 输出两点球面距离（米）。口径同 CyberChef「Haversine distance」",
  params: [],
  run(text) {
    const input = String(text == null ? "" : text);
    const values = input.match(/^(-?\d+(\.\d+)?), ?(-?\d+(\.\d+)?), ?(-?\d+(\.\d+)?), ?(-?\d+(\.\d+)?)$/);
    if (!values) throw new Error("输入格式须为 lat1, lng1, lat2, lng2");
    const lat1 = parseFloat(values[1]);
    const lng1 = parseFloat(values[3]);
    const lat2 = parseFloat(values[5]);
    const lng2 = parseFloat(values[7]);
    const TO_RAD = Math.PI / 180;
    const dLat = (lat2 - lat1) * TO_RAD;
    const dLng = (lng2 - lng1) * TO_RAD;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * TO_RAD) * Math.cos(lat2 * TO_RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const metres = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return String(metres);
  },
});
