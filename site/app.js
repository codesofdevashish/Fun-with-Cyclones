(() => {
  const S = window.SITE || {};
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") n.textContent = v;
      else if (k === "style") n.setAttribute("style", v);
      else n.setAttribute(k, v);
    }
    for (const k of [].concat(kids)) if (k) n.append(k);
    return n;
  };

  const CAT_VAR = (kt) => kt >= 137 ? "--c5" : kt >= 113 ? "--c4" : kt >= 96 ? "--c3" : kt >= 83 ? "--c2"
                        : kt >= 64 ? "--c1" : kt >= 34 ? "--ts" : "--td";
  const css = getComputedStyle(document.documentElement);
  const catColor = (kt) => css.getPropertyValue(CAT_VAR(kt)).trim();
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmt = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")} UTC`; };
  const ll = (lat, lon) => { const lo = ((lon + 540) % 360) - 180; return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`; };
  const catText = (s) => s.category > 0 ? `Category ${s.category}` : s.category === 0 ? "Tropical storm strength" : "Depression strength";

  // ---------- profile
  $("#who").textContent = S.name || "Tropical cyclones";
  $("#about-name").textContent = S.name || "";
  $("#about-role").textContent = [S.role, S.affiliation].filter(Boolean).join(", ");
  $("#about-summary").textContent = S.summary || "";
  for (const i of S.interests || []) $("#about-interests").append(el("li", { text: i }));
  for (const m of S.memberships || []) $("#about-members").append(el("li", { text: m }));
  const L = S.links || {};
  const linkDefs = [["email", "Email", (v) => `mailto:${v}`], ["scholar", "Google Scholar"], ["github", "GitHub"], ["linkedin", "LinkedIn"], ["cv", "CV (PDF)"]];
  for (const [k, label, f] of linkDefs) if (L[k]) $("#about-links").append(el("a", { href: f ? f(L[k]) : L[k], text: label, rel: "noopener" }));

  // ---------- decorative isobars around a low (the hero's weather-chart backdrop)
  (function isobars() {
    const svg = $(".isobars"), ns = "http://www.w3.org/2000/svg";
    const cx = 900, cy = 250;
    for (let k = 0; k < 11; k++) {
      const r = 38 + k * 46, pts = [];
      for (let a = 0; a <= 360; a += 6) {
        const t = a * Math.PI / 180;
        const w = 1 + 0.08 * Math.sin(3 * t + k * 0.7) + 0.05 * Math.cos(5 * t - k);
        pts.push([cx + r * w * Math.cos(t) * 1.35, cy + r * w * Math.sin(t)]);
      }
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", "M" + pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join("L") + "Z");
      svg.append(p);
    }
  })();

  // ---------- map
  const map = L_map();
  function L_map() {
    if (!window.L) return null;
    const m = window.L.map("map", { worldCopyJump: true, minZoom: 1, zoomSnap: 0.5, scrollWheelZoom: false })
      .setView([12, 80], 2);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap contributors © CARTO", subdomains: "abcd", maxZoom: 8,
    }).addTo(m);
    return m;
  }
  function drawTrack(s) {
    if (!map) return;
    const tr = s.track; if (!tr || tr.length < 1) return;
    let prev = null; const pts = [];
    for (const [, lat, lon, kt] of tr) {                      // unwrap longitudes across the dateline
      let lo = lon; if (prev !== null) { while (lo - prev > 180) lo -= 360; while (lo - prev < -180) lo += 360; }
      prev = lo; pts.push([lat, lo, kt]);
    }
    for (let i = 1; i < pts.length; i++)
      window.L.polyline([pts[i - 1].slice(0, 2), pts[i].slice(0, 2)], { color: catColor(pts[i][2]), weight: 4, opacity: 0.95 }).addTo(map);
    const last = pts[pts.length - 1];
    window.L.circleMarker(last.slice(0, 2), { radius: 7, color: "#14283a", weight: 2, fillColor: catColor(last[2]), fillOpacity: 1 })
      .addTo(map).bindTooltip(`${s.name}, ${s.vmax_kt} kt`, { permanent: true, direction: "right", className: "stormtip" })
      .on("click", () => document.getElementById(`s-${s.key}`)?.scrollIntoView({ behavior: "smooth" }));
    return pts;
  }

  // ---------- intensity sparkline (official Vmax, RI windows shaded)
  function spark(tr) {
    const ns = "http://www.w3.org/2000/svg", W = 300, H = 70, P = 4;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "spark");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Official intensity over time");
    if (!tr || tr.length < 2) return svg;
    const t = tr.map((r) => Date.parse(r[0])), v = tr.map((r) => r[3]);
    const t0 = t[0], t1 = t[t.length - 1], vmax = Math.max(40, ...v) * 1.1;
    const X = (x) => P + (W - 2 * P) * (x - t0) / Math.max(1, t1 - t0), Y = (y) => H - 14 - (H - 22) * y / vmax;
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const dt = (t[j] - t[i]) / 36e5;
      if (Math.abs(dt - 24) <= 3 && v[j] - v[i] >= 30) {
        const r = document.createElementNS(ns, "path");
        r.setAttribute("d", `M${X(t[i])},4H${X(t[j])}V${H - 14}H${X(t[i])}Z`); r.setAttribute("class", "ri"); svg.append(r);
      }
    }
    for (const g of [34, 64, 96]) if (g < vmax * 0.9) {
      const ln = document.createElementNS(ns, "line");
      ln.setAttribute("x1", P); ln.setAttribute("x2", W - P); ln.setAttribute("y1", Y(g)); ln.setAttribute("y2", Y(g)); svg.append(ln);
      const tx = document.createElementNS(ns, "text"); tx.setAttribute("x", W - P); tx.setAttribute("y", Y(g) - 2);
      tx.setAttribute("text-anchor", "end"); tx.textContent = `${g} kt`; svg.append(tx);
    }
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", t.map((x, i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(v[i]).toFixed(1)}`).join(""));
    p.setAttribute("class", "line"); svg.append(p);
    const a = document.createElementNS(ns, "text"); a.setAttribute("x", P); a.setAttribute("y", H - 2); a.textContent = fmt(tr[0][0]).replace(" UTC", "");
    const b = document.createElementNS(ns, "text"); b.setAttribute("x", W - P); b.setAttribute("y", H - 2); b.setAttribute("text-anchor", "end");
    b.textContent = fmt(tr[tr.length - 1][0]).replace(" UTC", ""); svg.append(a, b);
    return svg;
  }

  function stormRow(s) {
    const video = el("video", { controls: "", muted: "", loop: "", playsinline: "", preload: "metadata", poster: s.poster, src: s.video,
      "aria-label": `3D flow animation of ${s.label} ${s.name}` });
    const dl = el("dl", {}, [
      el("dt", { text: "Intensity" }), el("dd", { text: `${s.vmax_kt} kt, ${s.pmin} hPa` }),
      el("dt", { text: "Peak so far" }), el("dd", { text: `${s.peak_kt} kt` }),
      el("dt", { text: "Position" }), el("dd", { text: ll(s.lat, s.lon) }),
      el("dt", { text: "Basin" }), el("dd", { text: `${s.basin_name} (${s.centre})` }),
      el("dt", { text: "First advisory" }), el("dd", { text: fmt(s.first_seen) }),
      el("dt", { text: "Video runs to" }), el("dd", { text: `analysis of ${fmt(s.window_end || s.rendered)}` }),
    ]);
    const tags = el("p", { class: "tags" }, [el("span", { class: "chip", text: catText(s) })]);
    if (s.ri) { tags.append(" "); tags.append(el("span", { class: "ri", text: "Rapid intensification" })); }
    const facts = el("div", { class: "facts" }, [
      el("p", { class: "label", text: `${s.label} ${s.sid}` }), el("h3", { text: s.name }), tags, dl, spark(s.track),
      el("a", { class: "dl", href: s.video, download: `${s.key}.mp4`, text: "Download the video (MP4)" }),
    ]);
    return el("article", { class: "storm", id: `s-${s.key}`, style: `--cat:var(${CAT_VAR(s.vmax_kt)})` }, [video, facts]);
  }

  function archiveItem(s) {
    const b = el("button", { class: "arch", type: "button" }, [
      el("img", { src: s.poster, alt: "", loading: "lazy" }),
      el("strong", { text: `${s.name} (${s.year})` }),
      el("span", { text: `${s.basin_name}, peak ${s.peak_kt} kt${s.ri ? ", rapid intensification" : ""}` }),
    ]);
    b.addEventListener("click", () => {
      $("#player-title").textContent = `${s.label} ${s.name} (${s.sid}, ${s.year})`;
      const v = $("#player-video"); v.poster = s.poster; v.src = s.video; $("#player").showModal(); v.play().catch(() => {});
    });
    return b;
  }
  $("#player").addEventListener("close", () => { const v = $("#player-video"); v.pause(); v.removeAttribute("src"); v.load(); });

  // ---------- data
  fetch(`data/storms.json?t=${Date.now()}`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => {
      const act = d.storms.filter((s) => s.status === "active");
      const arc = d.storms.filter((s) => s.status !== "active");
      const n = act.length;
      $("#headline").textContent = n === 0 ? "No tropical cyclones are active right now"
        : n === 1 ? "One tropical cyclone is active right now" : `${n} tropical cyclones are active right now`;
      const ends = act.map((s) => s.window_end).filter(Boolean).sort();
      $("#status").textContent = ends.length
        ? `Videos run to the GFS analysis of ${fmt(ends[ends.length - 1])}. Positions and intensities are the latest official advisories.`
        : "Past storms stay in the archive below. This page updates every morning.";
      $("#generated").textContent = `Site rebuilt ${fmt(d.generated)}.`;
      const bounds = [];
      for (const s of act) { const pts = drawTrack(s); if (pts) bounds.push(...pts.map((p) => p.slice(0, 2))); }
      if (map && bounds.length) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 5 });
      const al = $("#active-list");
      if (n === 0) al.append(el("p", { class: "empty", text: "Nothing to show today. Past storms are in the archive below, and this page updates every morning." }));
      for (const s of act) al.append(stormRow(s));
      const ar = $("#archive-list");
      if (!arc.length) ar.append(el("p", { class: "empty", text: "Storms appear here after they dissipate." }));
      for (const s of arc) ar.append(archiveItem(s));
    })
    .catch(() => {
      $("#status").textContent = "The storm list could not be loaded. It is created by the daily update; run the workflow once to build it.";
    });
})();
