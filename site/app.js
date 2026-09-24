(() => {
  "use strict";
  const CONF = window.SITE || {};
  const $ = (s, r = document) => r.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of [].concat(kids)) if (k !== null && k !== undefined) n.append(k);
    return n;
  };
  const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  // ---------------------------------------------------------------- formatting
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const toMs = (s) => { if (!s) return NaN; let t = String(s).replace(" ", "T"); if (!/Z|[+-]\d\d:?\d\d$/.test(t)) t += "Z"; return Date.parse(t); };
  const fmt = (ms, short) => { const d = new Date(ms); const hh = String(d.getUTCHours()).padStart(2, "0");
    return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${hh}:${String(d.getUTCMinutes()).padStart(2, "0")}${short ? "" : " UTC"}`; };
  const ll = (lat, lon) => { const lo = ((lon + 540) % 360) - 180;
    return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`; };
  const CATV = (kt) => kt >= 137 ? "--c5" : kt >= 113 ? "--c4" : kt >= 96 ? "--c3" : kt >= 83 ? "--c2" : kt >= 64 ? "--c1" : kt >= 34 ? "--ts" : "--td";
  const catName = (kt) => kt >= 137 ? "Category 5" : kt >= 113 ? "Category 4" : kt >= 96 ? "Category 3" : kt >= 83 ? "Category 2"
                        : kt >= 64 ? "Category 1" : kt >= 34 ? "Tropical storm" : "Depression";
  const col = (kt) => getComputedStyle(document.documentElement).getPropertyValue(CATV(kt)).trim();
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  // ---------------------------------------------------------------- storm helpers
  function prep(s) {
    let prev = null;
    s._pts = (s.track || []).map(([t, lat, lon, kt]) => {
      let lo = lon; if (prev !== null) { while (lo - prev > 180) lo -= 360; while (lo - prev < -180) lo += 360; }
      prev = lo; return { t: toMs(t), lat, lon: lo, kt };
    }).filter((p) => !isNaN(p.t));
    s._ace = s._pts.filter((p) => p.kt >= 34 && new Date(p.t).getUTCHours() % 6 === 0).reduce((a, p) => a + p.kt * p.kt, 0) / 1e4;
    s._ws = toMs(s.window_start); s._we = toMs(s.window_end);
    s._fps = s.video_fps || 15.1515; s._fph = s.video_fph || 1;
    s._ri = [];
    const P = s._pts;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dh = (P[j].t - P[i].t) / 36e5; if (dh > 27) break;
      if (Math.abs(dh - 24) <= 3 && P[j].kt - P[i].kt >= 30) s._ri.push([P[i].t, P[j].t]);
    }
    s._ri.sort((a, b) => a[0] - b[0]);                  // merge overlapping 24 h windows into RI periods
    s._ri = s._ri.reduce((acc, w) => { const l = acc[acc.length - 1];
      if (l && w[0] <= l[1]) l[1] = Math.max(l[1], w[1]); else acc.push([w[0], w[1]]); return acc; }, []);
    return s;
  }
  function at(s, t) {                                   // interpolate the official track
    const P = s._pts; if (!P.length) return null;
    if (t <= P[0].t) return P[0]; if (t >= P[P.length - 1].t) return P[P.length - 1];
    for (let i = 1; i < P.length; i++) if (P[i].t >= t) {
      const a = (t - P[i - 1].t) / (P[i].t - P[i - 1].t), A = P[i - 1], B = P[i];
      return { t, lat: A.lat + a * (B.lat - A.lat), lon: A.lon + a * (B.lon - A.lon), kt: A.kt + a * (B.kt - A.kt) };
    }
  }
  const videoTime = (s, v) => {                          // video clock -> analysis time
    if (isNaN(s._ws)) return NaN;
    const frames = Math.round((s._we - s._ws) / 36e5 * s._fph) + 1;
    return s._ws + Math.min(v.currentTime * s._fps, frames - 1) / s._fph * 36e5;
  };
  const seekTo = (s, v, t) => {
    if (isNaN(s._ws) || t < s._ws || t > s._we) return false;
    v.currentTime = (t - s._ws) / 36e5 * s._fph / s._fps + 1e-3; return true;
  };

  // ---------------------------------------------------------------- state
  let ALL = [], ACTIVE = [], ARCH = [], SEL = null, BASIN = "";
  const video = $("#v-video");

  // ---------------------------------------------------------------- theme
  const themeBtn = $("#theme");
  const isDark = () => document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const syncThemeBtn = () => { themeBtn.textContent = isDark() ? "Light" : "Dark"; };
  themeBtn.addEventListener("click", () => {
    const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t;
    try { localStorage.setItem("tc-theme", t); } catch (e) { /* storage unavailable */ }
    syncThemeBtn(); setTiles(); if (SEL) { drawMap(); drawChart(SEL); syncVideo(); }
  });
  syncThemeBtn();

  // ---------------------------------------------------------------- profile
  $("#brand-name").textContent = CONF.name || "Tropical cyclones";
  if (CONF.name) $("#brand-name").after(el("span", { class: "brand-sub", text: "Tropical cyclones" }));
  $("#about-name").textContent = CONF.name || "";
  $("#about-role").textContent = [CONF.role, CONF.affiliation].filter(Boolean).join(", ");
  $("#about-summary").textContent = CONF.summary || "";
  for (const i of CONF.interests || []) $("#about-interests").append(el("li", { text: i }));
  for (const m of CONF.memberships || []) $("#about-members").append(el("li", { text: m }));
  const SKILLS = CONF.skills || [
    "Automatic global storm detection from operational TCVitals, every day",
    "Processing of NCEP GFS 0.25° analyses (GRIB2) for any basin, including dateline and Southern Hemisphere storms",
    "3D visualisation of tropical cyclone flow, vortex core and convection",
    "Structure diagnostics: vortex tilt, 850–500 hPa shear, radius of maximum wind",
    "Rapid intensification detection from official intensities",
    "Fully automated pipeline on GitHub Actions and GitHub Pages",
  ];
  for (const k of SKILLS) $("#about-skills").append(el("li", { text: k }));
  const Lk = CONF.links || {};
  for (const [k, label, f] of [["email", "Email", (v) => `mailto:${v}`], ["scholar", "Google Scholar"], ["github", "GitHub"],
                                ["linkedin", "LinkedIn"], ["cv", "CV (PDF)"]])
    if (Lk[k]) $("#about-links").append(el("a", { href: f ? f(Lk[k]) : Lk[k], text: label, rel: "noopener" }));

  // ---------------------------------------------------------------- map
  const map = window.L ? L.map("map", { worldCopyJump: true, minZoom: 1, zoomSnap: 0.5, scrollWheelZoom: false }).setView([15, 90], 2) : null;
  let tiles = null;
  function setTiles() {
    if (!map) return;
    if (tiles) map.removeLayer(tiles);
    const base = isDark() ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
    tiles = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${base}/MapServer/tile/{z}/{y}/{x}`,
      { attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors", maxZoom: 16 });
    let errors = 0;
    tiles.on("tileerror", () => { if (++errors === 6) { map.removeLayer(tiles);
      tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 18 }).addTo(map); } });
    tiles.addTo(map);
  }
  setTiles();
  const layers = new Map();
  const symbol = (south) => L.divIcon({ className: `now-icon${south ? " south" : ""}`, iconSize: [26, 26],
    html: `<svg viewBox="-13 -13 26 26" aria-hidden="true"><g transform="scale(${south ? -1 : 1},1)">` +
          `<path d="M0,-4.5 C6,-6 9,-2 10,4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>` +
          `<path d="M0,4.5 C-6,6 -9,2 -10,-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></g>` +
          `<circle r="4.5" fill="var(--paper)" stroke="currentColor" stroke-width="2"/></svg>` });
  let nowMarker = null, ghost = null;
  function drawMap() {
    if (!map) return;
    for (const g of layers.values()) map.removeLayer(g);
    layers.clear();
    const shown = ACTIVE.slice(); if (SEL && !shown.includes(SEL)) shown.push(SEL);
    for (const s of shown) {
      const g = L.layerGroup(); const sel = s === SEL; const P = s._pts;
      for (let i = 1; i < P.length; i++)
        L.polyline([[P[i - 1].lat, P[i - 1].lon], [P[i].lat, P[i].lon]], { color: col(P[i].kt), weight: sel ? 5 : 3, opacity: sel ? 1 : 0.45 }).addTo(g);
      const last = P[P.length - 1];
      if (last) L.circleMarker([last.lat, last.lon], { radius: sel ? 6 : 5, color: "#14283a", weight: 2, fillColor: col(last.kt), fillOpacity: 1 })
        .bindTooltip(`${s.name}, ${last.kt} kt`, { permanent: sel || ACTIVE.length <= 4, direction: "right", className: "stormtip" })
        .on("click", () => select(s)).addTo(g);
      g.addTo(map); layers.set(s.key, g);
    }
    if (nowMarker) { map.removeLayer(nowMarker); nowMarker = null; }
    if (SEL && SEL._pts.length) {
      const p = SEL._pts[SEL._pts.length - 1];
      nowMarker = L.marker([p.lat, p.lon], { icon: symbol(p.lat < 0), interactive: false, keyboard: false }).addTo(map);
    }
  }
  function fit(s) {
    if (!map) return;
    const pts = (s ? [s] : ACTIVE).flatMap((x) => x._pts.map((p) => [p.lat, p.lon]));
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 6 });
  }
  $("#fit-all").addEventListener("click", () => fit(null));

  // ---------------------------------------------------------------- intensity chart
  const chartBox = $("#chart"), tip = $("#chart-tip");
  let CH = null;
  function drawChart(s) {
    chartBox.textContent = ""; CH = null; tip.textContent = "";
    const P = s._pts; if (P.length < 2) { chartBox.append(el("p", { class: "tip", text: "Not enough track points yet." })); return; }
    const W = Math.max(300, chartBox.clientWidth || 400), H = 190, m = { l: 34, r: 12, t: 10, b: 24 };
    const t0 = P[0].t, t1 = P[P.length - 1].t, ymax = Math.max(70, Math.max(...P.map((p) => p.kt)) * 1.15);
    const X = (t) => m.l + (W - m.l - m.r) * (t - t0) / Math.max(1, t1 - t0), Y = (k) => H - m.b - (H - m.t - m.b) * k / ymax;
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Official intensity of ${s.name}` });
    for (const [a, b, k] of [[0, 34, 20], [34, 64, 40], [64, 83, 70], [83, 96, 90], [96, 113, 100], [113, 137, 120], [137, 999, 140]])
      if (a < ymax) svg.append(sv("rect", { class: "band", x: m.l, width: W - m.l - m.r, y: Y(Math.min(b, ymax)), height: Y(a) - Y(Math.min(b, ymax)), fill: col(k) }));
    for (const g of [34, 64, 96, 137]) if (g < ymax) {
      svg.append(sv("line", { class: "grid", x1: m.l, x2: W - m.r, y1: Y(g), y2: Y(g) }));
      const tx = sv("text", { x: m.l - 4, y: Y(g) + 4, "text-anchor": "end" }); tx.textContent = g; svg.append(tx);
    }
    const d0 = new Date(t0); d0.setUTCHours(0, 0, 0, 0);
    for (let d = d0.getTime() + 864e5; d < t1; d += 864e5) {
      svg.append(sv("line", { class: "grid", x1: X(d), x2: X(d), y1: m.t, y2: H - m.b }));
      const tx = sv("text", { x: X(d) + 3, y: H - 8 }); const dd = new Date(d); tx.textContent = `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`; svg.append(tx);
    }
    if (!isNaN(s._ws)) svg.append(sv("rect", { class: "win", x: X(Math.max(s._ws, t0)), y: m.t, height: H - m.t - m.b,
      width: Math.max(0, X(Math.min(s._we, t1)) - X(Math.max(s._ws, t0))) }));
    for (const [a, b] of s._ri) svg.append(sv("rect", { class: "riw", x: X(a), width: X(b) - X(a), y: m.t, height: H - m.t - m.b }));
    for (let i = 1; i < P.length; i++)
      svg.append(sv("line", { x1: X(P[i - 1].t), y1: Y(P[i - 1].kt), x2: X(P[i].t), y2: Y(P[i].kt),
        stroke: col(Math.max(P[i - 1].kt, P[i].kt)), "stroke-width": 3.5, "stroke-linecap": "round" }));
    for (const p of P) svg.append(sv("circle", { cx: X(p.t), cy: Y(p.kt), r: 2, fill: "var(--ink)" }));
    const yl = sv("text", { x: 2, y: m.t + 8 }); yl.textContent = "kt"; svg.append(yl);
    const cur = sv("line", { class: "cur", y1: m.t, y2: H - m.b, x1: -10, x2: -10 }); svg.append(cur);
    const hov = sv("line", { class: "hov", y1: m.t, y2: H - m.b, x1: -10, x2: -10 }); svg.append(hov);
    const dot = sv("circle", { r: 5, fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": 2, cx: -10, cy: -10 }); svg.append(dot);
    const hit = sv("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent", tabindex: 0, style: "cursor:crosshair",
      "aria-label": "Intensity chart. Use left and right arrow keys to step through advisories, Enter to jump the video." });
    svg.append(hit); chartBox.append(svg);
    CH = { X, t0, t1, cur };
    let kIdx = P.length - 1;
    const tAtEvent = (ev) => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * W / r.width;
      return t0 + (t1 - t0) * Math.min(1, Math.max(0, (x - m.l) / (W - m.l - m.r))); };
    const inspect = (t) => {
      const p = at(s, t); hov.setAttribute("x1", X(t)); hov.setAttribute("x2", X(t));
      dot.setAttribute("cx", X(t)); dot.setAttribute("cy", Y(p.kt));
      tip.textContent = `${fmt(t)}: ${Math.round(p.kt)} kt (${catName(p.kt)}), ${ll(p.lat, p.lon)}` +
        (!isNaN(s._ws) && t >= s._ws && t <= s._we ? ". Click to jump the video here." : ". Outside the video window.");
      if (map) { if (!ghost) ghost = L.circleMarker([p.lat, p.lon], { radius: 7, color: "#14283a", weight: 2, fillColor: "#fff", fillOpacity: .9, interactive: false }).addTo(map);
                 else ghost.setLatLng([p.lat, p.lon]); }
    };
    const leave = () => { hov.setAttribute("x1", -10); hov.setAttribute("x2", -10); dot.setAttribute("cx", -10);
      tip.textContent = ""; if (ghost && map) { map.removeLayer(ghost); ghost = null; } };
    hit.addEventListener("pointermove", (e) => inspect(tAtEvent(e)));
    hit.addEventListener("pointerleave", leave);
    hit.addEventListener("click", (e) => { if (seekTo(s, video, tAtEvent(e))) video.play().catch(() => {}); });
    hit.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { kIdx = Math.max(0, Math.min(P.length - 1, kIdx + (e.key === "ArrowRight" ? 1 : -1))); inspect(P[kIdx].t); e.preventDefault(); }
      if (e.key === "Enter") seekTo(s, video, P[kIdx].t);
    });
    hit.addEventListener("blur", leave);
  }

  // ---------------------------------------------------------------- video sync
  function syncVideo() {
    const s = SEL; if (!s) return;
    const t = videoTime(s, video); const ro = $("#v-readout");
    if (isNaN(t)) { ro.textContent = ""; return; }
    const p = at(s, t);
    ro.textContent = `Frame time ${fmt(t)}   ${ll(p.lat, p.lon)}   official ${Math.round(p.kt)} kt`;
    if (nowMarker) nowMarker.setLatLng([p.lat, p.lon]);
    if (CH) { const x = CH.X(Math.min(Math.max(t, CH.t0), CH.t1)); CH.cur.setAttribute("x1", x); CH.cur.setAttribute("x2", x); }
  }
  let raf = 0;
  const loop = () => { syncVideo(); raf = requestAnimationFrame(loop); };
  video.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); });
  video.addEventListener("pause", () => { cancelAnimationFrame(raf); syncVideo(); });
  video.addEventListener("seeked", syncVideo);
  video.addEventListener("loadedmetadata", syncVideo);

  // ---------------------------------------------------------------- tabs
  const tabs = [...document.querySelectorAll(".tabs button")];
  function showTab(name) {
    for (const b of tabs) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    for (const id of ["overview", "structure", "facts"]) $(`#tab-${id}`).hidden = id !== name;
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); showTab(n.dataset.tab); } });
  });
  function gauge(title, value, unit, max, a, b, note) {
    const v = Math.min(max, Math.max(0, value));
    return el("div", { class: "gauge" }, [
      el("h4", {}, [title, el("span", { text: `${value.toFixed(0)} ${unit}` })]),
      el("div", { class: "gbar", style: `--a:${a / max * 100}%;--b:${b / max * 100}%` }, [el("i", { style: `left:${v / max * 100}%` })]),
      el("div", { class: "gscale" }, [el("span", { style: `left:${a / max * 50}%`, text: note[0] }),
        el("span", { style: `left:${(a + b) / max * 50}%`, text: note[1] }), el("span", { style: `left:${(b + max) / max * 50}%`, text: note[2] })]),
    ]);
  }
  function fillTabs(s) {
    const ov = $("#tab-overview"); ov.textContent = "";
    const story = s.story || [];
    ov.append(el("p", { text: story[0] || "A written summary appears after the next daily update." }));
    const st = $("#tab-structure"); st.textContent = "";
    const e = s.env;
    if (e && e.shear_now !== undefined) {
      const g = el("div", { class: "gauges" });
      g.append(gauge("850–500 hPa shear", e.shear_now, "m/s", 20, 5, 10, ["light", "moderate", "strong"]));
      g.append(gauge("Vortex tilt, 850 to 500 hPa", e.tilt_now, "km", 300, 50, 150, ["upright", "tilted", "strongly tilted"]));
      if (e.rmw_now !== undefined) g.append(gauge("Radius of maximum wind, 850 hPa", e.rmw_now, "km", 300, 60, 150, ["compact", "moderate", "broad"]));
      st.append(g);
    }
    st.append(el("p", { text: story[1] || "Structure diagnostics appear once the storm's video has been rendered." }));
    const fa = $("#tab-facts"); fa.textContent = "";
    const rows = [["Current intensity", `${s.vmax_kt} kt, ${s.pmin} hPa`], ["Peak so far", `${s.peak_kt} kt`],
      ["Motion", cap(s.motion) || "n/a"], ["Position", ll(s.lat, s.lon)], ["Basin", `${s.basin_name} (${s.centre})`],
      ["Tracked since", fmt(toMs(s.first_seen))], ["Last advisory", fmt(toMs(s.last_seen))],
      ["Accumulated cyclone energy", `${s._ace.toFixed(1)} × 10⁴ kt²`],
      ["Video covers", isNaN(s._ws) ? "n/a" : `${fmt(s._ws, true)} to ${fmt(s._we)}`]];
    fa.append(el("dl", { class: "facts" }, rows.map(([k, v]) => el("div", {}, [el("dt", { text: k }), el("dd", { text: v })]))));
    const share = el("button", { type: "button", class: "btn ghost", text: "Copy link" });
    share.addEventListener("click", () => {
      const url = `${location.origin}${location.pathname}#storm=${s.key}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        () => { share.textContent = "Link copied"; setTimeout(() => (share.textContent = "Copy link"), 2000); }, () => prompt("Copy this link:", url));
    });
    fa.append(el("p", { class: "actions" }, [el("a", { class: "btn", href: s.video, download: `${s.key}.mp4`, text: "Download video (MP4)" }),
      el("a", { class: "btn ghost", href: s.poster, target: "_blank", rel: "noopener", text: "Open still frame" }), share]));
  }

  // ---------------------------------------------------------------- selection
  function select(s, opts = {}) {
    if (!s) return;
    SEL = s;
    $(".stage-head").style.setProperty("--cat", `var(${CATV(s.vmax_kt)})`);
    $("#v-kicker").textContent = `${s.label} ${s.sid}, ${s.basin_name}${s.status !== "active" ? `, ${s.year} (archived)` : ""}`;
    $("#v-name").textContent = s.name;
    const tags = $("#v-tags"); tags.textContent = "";
    tags.style.setProperty("--cat", `var(${CATV(s.vmax_kt)})`);
    tags.append(el("span", { class: "tag cat", text: `${catName(s.vmax_kt)}, ${s.vmax_kt} kt` }));
    if (s.status === "active" && s.trend && s.dv24 !== null && s.dv24 !== undefined)
      tags.append(el("span", { class: "tag", text: `${cap(s.trend)}, ${s.dv24 > 0 ? "+" : ""}${s.dv24} kt in 24 h` }));
    if (s.ri && !(s.status === "active" && s.trend === "rapidly intensifying"))
      tags.append(el("span", { class: "tag ri", text: s.status === "active" ? "Rapid intensification earlier" : "Rapid intensification" }));
    if (s.status === "active" && s.trend === "rapidly intensifying") tags.lastChild.classList.add("ri");
    if (s.status !== "active") tags.append(el("span", { class: "tag arch", text: `Peak ${s.peak_kt} kt` }));
    video.poster = s.poster; video.src = s.video; video.load();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && opts.autoplay !== false) video.play().catch(() => {});
    fillTabs(s); drawMap(); fit(s); drawChart(s); syncVideo();
    for (const c of document.querySelectorAll(".chip")) c.setAttribute("aria-selected", String(c.dataset.key === s.key));
    try { history.replaceState(null, "", `#storm=${s.key}`); } catch (e) { /* not available */ }
    if (!$("#guide-img").getAttribute("src")) $("#guide-img").src = s.poster;
    if (opts.scroll) $("#live").scrollIntoView({ behavior: "smooth" });
  }

  // ---------------------------------------------------------------- rail
  function drawRail() {
    const fb = $("#basin-filters"); fb.textContent = "";
    const basins = [...new Set(ACTIVE.map((s) => s.basin_name))];
    if (basins.length > 1) for (const b of ["", ...basins]) {
      const n = b ? ACTIVE.filter((s) => s.basin_name === b).length : ACTIVE.length;
      const btn = el("button", { type: "button", "aria-pressed": String(BASIN === b), text: `${b || "All basins"} (${n})` });
      btn.addEventListener("click", () => { BASIN = b; drawRail(); }); fb.append(btn);
    }
    const ch = $("#storm-chips"); ch.textContent = "";
    const list = ACTIVE.filter((s) => !BASIN || s.basin_name === BASIN);
    if (SEL && SEL.status !== "active") list.push(SEL);
    for (const s of list) {
      const arrow = s.status !== "active" ? "archived" : s.dv24 >= 10 ? `▲ ${s.dv24} kt` : s.dv24 <= -10 ? `▼ ${-s.dv24} kt` : "steady";
      const c = el("button", { type: "button", role: "tab", class: `chip${s.status !== "active" ? " archived" : ""}`, "data-key": s.key,
        "aria-selected": String(SEL === s), style: `--c:var(${CATV(s.vmax_kt)})` },
        [el("strong", { text: s.name }), el("span", { text: `${s.vmax_kt} kt, ${s.basin_name}` }), el("span", { class: "tr", text: arrow })]);
      c.addEventListener("click", () => select(s));
      ch.append(c);
    }
    const chips = [...ch.children];
    chips.forEach((c, i) => c.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = chips[(i + (e.key === "ArrowRight" ? 1 : chips.length - 1)) % chips.length]; n.focus(); n.click(); e.preventDefault();
    }));
  }

  // ---------------------------------------------------------------- archive
  function drawArchive() {
    const box = $("#archive-list"); box.textContent = "";
    const y = $("#f-year").value, b = $("#f-basin").value, sort = $("#f-sort").value;
    const list = ARCH.filter((s) => (!y || String(s.year) === y) && (!b || s.basin_name === b));
    list.sort(sort === "peak" ? (p, q) => q.peak_kt - p.peak_kt : sort === "ace" ? (p, q) => q._ace - p._ace
                              : (p, q) => toMs(q.last_seen) - toMs(p.last_seen));
    if (!list.length) { box.append(el("p", { class: "empty", text: ARCH.length ? "No storms match these filters." : "Storms appear here after they dissipate." })); return; }
    for (const s of list) {
      const c = el("button", { type: "button", class: "card", style: `--c:var(${CATV(s.peak_kt)})` }, [
        el("img", { src: s.poster, alt: "", loading: "lazy" }),
        el("div", {}, [el("strong", { text: `${s.name} (${s.year})` }),
          el("span", { text: `${s.basin_name}, peak ${s.peak_kt} kt, ACE ${s._ace.toFixed(1)}${s.ri ? ", rapid intensification" : ""}` })]),
      ]);
      c.addEventListener("click", () => { select(s, { scroll: true }); drawRail(); });
      box.append(c);
    }
  }
  for (const id of ["#f-year", "#f-basin", "#f-sort"]) $(id).addEventListener("change", drawArchive);

  // ---------------------------------------------------------------- guide (hotspots on a real frame)
  const SPOTS = [
    [36, 3, "Title", "Storm name, agency ID and the analysis time of this frame. Frames are one hour apart."],
    [35, 42, "3D flow box", "The box follows the storm from 900 hPa near the surface up to 500 hPa. Streamlines and tracers are coloured by wind speed; " +
      "the red surface is the vortex core (high relative vorticity), grey patches are strong ascent, and the white line joins the circulation centre at each level."],
    [70, 45, "Wind speed scale", "Colour scale for streamlines and tracers, in m/s. Strong flow is also drawn brighter and thicker."],
    [88, 13, "Diagnostics", "Official intensity, GFS 900 hPa maximum wind, radius of maximum wind, shear, tilt, local solar time and centre position for this frame."],
    [86, 77, "Shear and tilt compass", "Plan view: the orange arrow is 850–500 hPa shear, the white arrow is where the 500 hPa centre sits relative to 850 hPa. " +
      "Tilt pointing downshear, then precessing and aligning, is a classic path to rapid intensification."],
    [35, 88, "Intensity timeline", "White: official maximum wind. Blue: GFS 900 hPa maximum wind. Red shading: rapid intensification (official +30 kt in 24 h). The cursor marks this frame."],
    [40, 70, "Day and night floor", "The ocean and land are shaded by the real position of the sun, so you can follow the diurnal cycle of convection."],
  ];
  const gf = $("#guide-frame"), gt = $("#guide-text");
  function showSpot(i) {
    for (const h of gf.querySelectorAll(".hot")) h.setAttribute("aria-pressed", String(+h.dataset.i === i));
    gt.textContent = ""; gt.append(el("h3", { text: `${i + 1}. ${SPOTS[i][2]}` }), el("p", { text: SPOTS[i][3] }));
  }
  SPOTS.forEach(([x, y, name], i) => {
    const h = el("button", { type: "button", class: "hot", "data-i": i, style: `left:${x}%;top:${y}%`, "aria-label": name, "aria-pressed": "false", text: i + 1 });
    h.addEventListener("click", () => showSpot(i)); gf.append(h);
  });
  showSpot(1);

  // ---------------------------------------------------------------- head, stats
  function drawHead(d) {
    const n = ACTIVE.length;
    const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
    $("#headline").textContent = n === 0 ? "No tropical cyclones are active right now"
      : `${words[n] || n} tropical cyclone${n > 1 ? "s" : ""} active right now`;
    const ends = ACTIVE.map((s) => s._we).filter((x) => !isNaN(x));
    $("#status").textContent = ends.length ? `Videos run to the GFS analysis of ${fmt(Math.max(...ends))}. Positions and intensities are the latest official advisories.`
      : ARCH.length ? "Showing the most recent storm from the archive. The page updates every morning." : "The page updates every morning.";
    const st = $("#stats"); st.textContent = "";
    if (n) {
      const top = ACTIVE.reduce((a, b) => (b.vmax_kt > a.vmax_kt ? b : a));
      for (const [k, v] of [["Active", n], ["Strongest", `${top.name}, ${top.vmax_kt} kt`],
        ["ACE, active storms", ACTIVE.reduce((a, s) => a + s._ace, 0).toFixed(1)], ["Basins", new Set(ACTIVE.map((s) => s.basin_name)).size]])
        st.append(el("div", {}, [el("dt", { text: k }), el("dd", { text: String(v) })]));
    }
    $("#generated").textContent = d.generated ? `Site rebuilt ${fmt(toMs(d.generated))}.` : "";
    const basins = new Set(ALL.map((s) => s.basin_name));
    if (ALL.length) $("#site-stats").textContent = `This site currently holds videos of ${ALL.length} storm${ALL.length > 1 ? "s" : ""} from ${basins.size} basin${basins.size > 1 ? "s" : ""}.`;
  }
  let rT = 0; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => SEL && (drawChart(SEL), syncVideo()), 150); });

  // ---------------------------------------------------------------- load
  fetch(`data/storms.json?t=${Date.now()}`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => {
      ALL = (d.storms || []).map(prep);
      ACTIVE = ALL.filter((s) => s.status === "active").sort((a, b) => b.vmax_kt - a.vmax_kt);
      ARCH = ALL.filter((s) => s.status !== "active");
      for (const y of [...new Set(ARCH.map((s) => s.year))].sort().reverse()) $("#f-year").append(el("option", { value: y, text: y }));
      for (const b of [...new Set(ARCH.map((s) => s.basin_name))].sort()) $("#f-basin").append(el("option", { value: b, text: b }));
      drawHead(d); drawArchive();
      const m = location.hash.match(/storm=([\w-]+)/);
      const first = (m && ALL.find((s) => s.key === m[1])) || ACTIVE[0] ||
        ARCH.slice().sort((a, b) => toMs(b.last_seen) - toMs(a.last_seen))[0];
      drawRail();
      if (first) select(first, { autoplay: !!ACTIVE.length });
      else { $("#v-name").textContent = "No storms yet"; $("#tab-overview").append(el("p", { text: "Run the daily workflow once to build the storm list." })); }
    })
    .catch((err) => { console.error(err); $("#status").textContent = "The storm list could not be loaded. It is created by the daily update; run the workflow once to build it."; });
})();
