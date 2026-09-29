import { escapeHtml, type Person } from './auth';

export const CSS = `
:root {
  --blackout: #0C0B0A;
  --wings: #161311;
  --cue: #F2EBE3;
  --gel: #E8A317;
  --gel-deep: #C4890F;
  --on-gel: #1A1206;
  --chrome: #9AA3AD;
  --line: rgba(242, 235, 227, 0.1);
  --radius: 14px;
  --touch: 44px;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; background: var(--blackout); color: var(--cue); }
body { font-family: Barlow, system-ui, sans-serif; min-height: 100svh; }
:focus { outline: none !important; }
body.kbd :focus-visible { outline: 2px solid var(--gel) !important; outline-offset: 3px; }
::selection, ::-moz-selection { background: var(--gel); color: var(--on-gel); }
body.nav-open { overflow: hidden; }
.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
a { color: var(--gel); text-decoration: none; }
h1, h2, h3, .display { font-family: "Bebas Neue", system-ui, sans-serif; letter-spacing: 0.04em; text-transform: uppercase; margin: 0; }
.bar {
  position: sticky; top: 0; z-index: 60;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  min-height: 4rem; padding: 0 1rem;
  padding-top: env(safe-area-inset-top);
  background: rgba(12,11,10,0.92); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.brand-lockup { display: flex; align-items: center; gap: 0.55rem; color: var(--gel); min-height: var(--touch); flex: 0 0 auto; max-width: min(46vw, 13rem); position: relative; z-index: 1; }
.brand-glyph { width: 28px; height: 28px; object-fit: contain; flex: 0 0 auto; }
.brand-word { height: 26px; width: auto; max-width: min(46vw, 13rem); display: block; object-fit: contain; object-position: left center; }
.brand-text { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.35rem; letter-spacing: 0.04em; white-space: nowrap; }
.desk {
  display: flex; gap: 0.85rem; flex: 1 1 auto; min-width: 0; justify-content: flex-end;
  flex-wrap: nowrap; font-size: 0.85rem; align-items: center; position: relative; z-index: 2;
  overflow-x: auto; scrollbar-width: none;
}
.desk::-webkit-scrollbar { display: none; }
.desk a {
  color: var(--chrome); min-height: var(--touch); display: inline-flex; align-items: center;
  white-space: nowrap; border-bottom: 2px solid transparent;
}
.desk a:hover { color: var(--cue); }
.desk a.is-on { color: var(--cue); border-bottom-color: var(--gel); }
.desk a.is-main {
  color: #14110c; background: var(--gel); border-radius: 999px; border-bottom-color: transparent;
  padding: 0 0.85rem; font-weight: 700;
}
.desk a.is-main.is-on { color: #14110c; border-bottom-color: transparent; }
body.kind-member .bar {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
  align-items: center;
  min-height: 4.75rem;
}
.bar-out {
  display: none;
  color: var(--chrome);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  min-height: var(--touch);
  align-items: center;
  padding: 0 0.15rem;
}
.bar-out:hover { color: var(--cue); }
body.kind-member .desk { justify-content: center; overflow: visible; gap: 0.15rem; }
body.kind-member .desk a.nav-link {
  flex-direction: column; justify-content: center; gap: 0.05rem;
  min-width: 4.25rem; min-height: 3.35rem; padding: 0.2rem 0.3rem;
  border-bottom: 0; border-radius: 14px;
  font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--chrome);
}
body.kind-member .desk a.nav-link svg { width: 18px; height: 18px; }
body.kind-member .desk a.nav-link:hover { color: var(--cue); background: rgba(242,235,227,0.04); }
body.kind-member .desk a.nav-link.is-on:not(.is-main) {
  color: var(--gel); border-bottom-color: transparent; background: transparent;
  box-shadow: inset 0 -2px 0 var(--gel);
}
body.kind-member .desk a.nav-link.is-main {
  width: 3.55rem; height: 3.55rem; min-width: 3.55rem; min-height: 3.55rem;
  margin: 0 0.35rem; padding: 0; border-radius: 50%;
  background: radial-gradient(circle at 35% 28%, #f6c95e, var(--gel) 46%, var(--gel-deep));
  color: var(--on-gel);
  box-shadow: 0 0 0 6px rgba(232,163,23,0.12), 0 10px 22px rgba(232,163,23,0.28);
}
body.kind-member .desk a.nav-link.is-main span { font-size: 0.5rem; line-height: 1; letter-spacing: 0.04em; }
body.kind-member .desk a.nav-link.is-main svg { width: 16px; height: 16px; }
body.kind-member .desk a.nav-link.is-main:hover,
body.kind-member .desk a.nav-link.is-main.is-on { color: var(--on-gel); background: radial-gradient(circle at 35% 28%, #f6c95e, var(--gel) 46%, var(--gel-deep)); }
body.kind-member .btn { border-radius: 999px; }
body.kind-member .az .btn { border-radius: var(--radius); }
.wrap { max-width: 56rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
.wrap.wide { max-width: 72rem; }
.panel {
  background: var(--wings);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.25rem 1.35rem;
}
.stack { display: grid; gap: 1rem; }
.grid { display: grid; gap: 1rem; }
@media (min-width: 720px) { .grid.two { grid-template-columns: 1fr 1fr; } }
label { display: block; font-size: 0.75rem; color: var(--chrome); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.4rem; }
input, textarea, select {
  width: 100%; background: var(--blackout); color: var(--cue);
  border: 1px solid rgba(154,163,173,0.35); border-radius: var(--radius);
  padding: 0.75rem 0.9rem; font: inherit; font-size: 16px;
}
textarea { min-height: 7rem; }
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--touch); padding: 0.55rem 1rem; border: 0; border-radius: var(--radius);
  background: var(--gel); color: var(--on-gel); font-weight: 700; cursor: pointer; font: inherit;
}
.btn.ghost { background: transparent; color: var(--cue); border: 1px solid rgba(154,163,173,0.35); }
.muted { color: var(--chrome); }
.gel { color: var(--gel); }
.row { display: flex; gap: 0.65rem; flex-wrap: wrap; align-items: center; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th, td { text-align: left; padding: 0.65rem 0.4rem; border-bottom: 1px solid var(--line); }
.empty { color: var(--chrome); padding: 1.5rem 0; }
.flash { color: var(--gel); font-size: 0.95rem; }
.err { color: #e08a7a; font-size: 0.95rem; }
.tabs { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 1.4rem; border-bottom: 1px solid var(--line); padding-bottom: 0.65rem; }
.tabs a { color: var(--chrome); min-height: var(--touch); display: inline-flex; align-items: center; }
.tabs a.is-on { color: var(--gel); }
.kpi { font-size: 2rem; margin: 0.4rem 0 0; }
.pre { white-space: pre-wrap; font-size: 0.88rem; color: var(--chrome); }
textarea.tall { min-height: 14rem; }
.check { display: flex; gap: 0.55rem; align-items: flex-start; font-size: 0.92rem; color: var(--chrome); }
.check input { width: auto; margin-top: 0.2rem; }
.kpis { display: grid; gap: 0.85rem; grid-template-columns: 1fr 1fr; }
@media (min-width: 900px) { .kpis { grid-template-columns: repeat(4, 1fr); } }
.kpi-card {
  display: flex; flex-direction: column; color: inherit;
  background: var(--wings); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 1.05rem 1.15rem; min-height: 8rem;
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms ease, background 180ms ease;
}
.kpi-card:hover { transform: translateY(-2px); border-color: rgba(232,163,23,0.45); }
.kpi-card:focus-visible { outline: 2px solid var(--gel); outline-offset: 3px; }
.kpi-card .label { margin-bottom: 0.15rem; }
.label { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--chrome); }
.kpi-card .kpi { flex: 1; margin: 0.35rem 0 0.55rem; line-height: 1; }
.kpi-card .go { font-size: 0.8rem; color: var(--gel); margin-top: auto; }
.dash { display: grid; gap: 1rem; }
@media (min-width: 960px) {
  .dash { grid-template-columns: minmax(0, 1.7fr) minmax(18rem, 1fr); }
  .dash-full { grid-column: 1 / -1; }
}
.mix { display: flex; height: 12px; border-radius: 99px; overflow: hidden; background: var(--blackout); margin: 0.85rem 0 0.65rem; }
.mix i { display: block; height: 100%; }
.mix-wait { background: #9AA3AD; }
.mix-found { background: var(--gel); }
.mix-active { background: #F2EBE3; }
.mix-cancel { background: #e08a7a; }
.legend { display: flex; flex-wrap: wrap; gap: 0.75rem 1.1rem; font-size: 0.85rem; color: var(--chrome); }
.legend b { color: var(--cue); font-weight: 600; }
.pill { display: inline-flex; align-items: center; min-height: 28px; padding: 0 0.55rem; border-radius: 99px; font-size: 0.75rem; border: 1px solid var(--line); color: var(--chrome); }
.pill.waitlist { color: var(--cue); }
.pill.founding, .pill.active { color: var(--gel); border-color: rgba(232,163,23,0.35); }
.pill.canceled { color: #e08a7a; }
.pill.is-on { color: var(--on-gel); background: var(--gel); border-color: var(--gel); }
.member-bar { position: sticky; top: calc(4rem + env(safe-area-inset-top)); z-index: 20; margin-top: 1rem; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; }
.quick-actions form { margin: 0; }
.quick-actions .btn, td .btn { width: auto; }
/* Rudiments: streak, segments, ladder, medals, metronome */
.streak-bar {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  background: var(--wings); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 0.9rem 1.1rem; margin: 0 0 1rem;
}
.streak-bar.is-risk { border-color: rgba(232,163,23,0.55); }
.streak-count { display: flex; align-items: baseline; gap: 0.4rem; }
.streak-num { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 2.6rem; line-height: 1; color: var(--gel); }
.streak-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--chrome); }
.streak-meta { flex: 1; min-width: 12rem; }
.streak-state { margin: 0; font-weight: 600; }
.streak-best { margin: 0.2rem 0 0; font-size: 0.82rem; }
.streak-week { display: flex; gap: 0.25rem; }
.streak-week i { width: 10px; height: 10px; border-radius: 3px; background: var(--gel); display: block; }
.segs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 1.2rem 0 0.6rem; }
.seg {
  display: inline-flex; align-items: center; min-height: var(--touch);
  padding: 0 0.9rem; border-radius: 99px; border: 1px solid var(--line);
  color: var(--chrome); font-size: 0.85rem; font-weight: 600;
}
.seg.is-on { background: var(--gel); border-color: var(--gel); color: var(--on-gel); }
.legend-limbs { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.78rem; color: var(--chrome); margin: 0 0 0.4rem; }
.legend-limbs b { color: var(--gel); }
.practice-switch {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem;
  margin: 1.15rem 0 0.15rem; padding: 0.3rem;
  background: var(--wings); border: 1px solid var(--line); border-radius: 16px;
}
.practice-switch a {
  display: flex; align-items: center; justify-content: center; text-align: center;
  min-height: var(--touch); padding: 0.4rem 0.6rem; border-radius: 12px;
  color: var(--chrome); font-weight: 700; cursor: pointer;
  transition: background 180ms ease, color 180ms ease;
}
.practice-switch a:hover { color: var(--cue); }
.practice-switch a.is-on { background: var(--gel); color: var(--on-gel); }
.practice-switch a:focus-visible { outline: 2px solid var(--gel); outline-offset: 2px; }
.practice-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem;
  margin: 1.35rem 0 0.65rem; font-size: 1.7rem;
}
.practice-head > span:last-child {
  font-family: Barlow, system-ui, sans-serif; font-size: 0.75rem; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--chrome);
}
.practice-head .head-title { display: inline-flex; align-items: center; gap: 0.55rem; }
.practice-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 720px) { .practice-list { grid-template-columns: 1fr 1fr; } }
.practice-card {
  --heat: 0;
  position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 0.55rem;
  min-height: 8.25rem; padding: 0.95rem 1rem 0.9rem; color: inherit; cursor: pointer;
  background:
    radial-gradient(90% 80% at 100% 0%, rgba(232,163,23,0.1), transparent 58%),
    var(--wings);
  border: 1px solid var(--line); border-radius: 14px;
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms ease;
}
.practice-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--gel);
  transform: scaleY(var(--heat)); transform-origin: bottom;
}
.practice-card:hover { transform: translateY(-2px); border-color: rgba(232,163,23,0.5); }
.practice-card:focus-visible { outline: 2px solid var(--gel); outline-offset: 3px; }
.practice-card.is-hot { border-color: rgba(232,163,23,0.42); }
.practice-card.is-locked { opacity: 0.62; }
.practice-card.is-locked:hover { transform: none; }
.practice-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
.practice-name { font-weight: 700; min-width: 0; font-size: 1.05rem; line-height: 1.25; }
.practice-card .sticking { min-height: 1.7rem; }
.practice-foot { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.7rem; align-items: center; margin-top: auto; }
.practice-bpm {
  font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.7rem; line-height: 1;
  letter-spacing: 0.03em; color: var(--cue); font-variant-numeric: tabular-nums;
}
.practice-bpm span { color: var(--chrome); font-size: 1.05rem; }
.practice-card.is-locked .practice-bpm {
  font-family: Barlow, system-ui, sans-serif; font-size: 0.78rem; letter-spacing: 0; font-weight: 600; color: var(--chrome);
  max-width: 7.5rem;
}
.ladder { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.rung a { display: grid; gap: 0.35rem; padding: 0.75rem 0.85rem; border: 1px solid var(--line); border-radius: 12px; color: inherit; }
.rung a:hover { border-color: rgba(232,163,23,0.45); }
.rung.is-locked a { opacity: 0.6; }
.rung-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
.rung-title { font-weight: 600; }
.rung-foot { font-size: 0.78rem; }
.sticking { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0; font-size: 0.82rem; }
.stick {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 1.6rem; padding: 0.1rem 0.3rem; border-radius: 6px;
  background: rgba(242,235,227,0.06); font-variant-numeric: tabular-nums; letter-spacing: 0.04em;
}
.stick.is-grace { opacity: 0.75; font-size: 0.76rem; }
.limb-K { color: var(--gel); background: rgba(232,163,23,0.14); }
.limb-H { color: #9ec89a; background: rgba(158,200,154,0.12); }
.meter { display: block; height: 8px; border-radius: 99px; background: var(--blackout); overflow: hidden; }
.meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--gel-deep), var(--gel)); }
.medal {
  display: inline-flex; align-items: center; gap: 0.35rem; min-height: 24px;
  padding: 0.12rem 0.55rem 0.12rem 0.12rem;
  border-radius: 99px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; border: 1px solid var(--line); color: var(--chrome); background: transparent;
}
.medal img { width: 28px; height: 28px; display: block; object-fit: contain; }
.medal-ladder .medal img { width: 40px; height: 40px; }
.medal.is-locked { opacity: 0.72; }
.medal.is-locked img { filter: grayscale(0.75); }
.medal-bronze { color: #c98b5a; border-color: rgba(201,139,90,0.45); }
.medal-silver { color: #cfd6dd; border-color: rgba(207,214,221,0.45); }
.medal-gold { color: var(--gel); border-color: rgba(232,163,23,0.5); }
.medal-platinum { color: #e6f0f5; border-color: rgba(230,240,245,0.5); }
.medal-diamond { color: #8fd3e8; border-color: rgba(143,211,232,0.55); }
.medal-legendary { color: var(--gel); border-color: var(--gel); }
.medal-insanity { color: #ffe39a; border-color: var(--gel); background: linear-gradient(90deg, rgba(232,163,23,0.16), rgba(156,15,46,0.22)); }
.medal-diamond:not(.is-locked) img,
.medal-legendary:not(.is-locked) img { filter: drop-shadow(0 0 6px rgba(232,163,23,0.7)); }
.medal-insanity:not(.is-locked) img { filter: drop-shadow(0 0 7px rgba(255,122,40,0.85)); }
.medal-ladder { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
.medal-ladder li { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; opacity: 0.55; }
.medal-ladder li.is-earned { opacity: 1; }
.daily-card { border-color: rgba(232,163,23,0.4); }
.staff { min-height: 3rem; overflow-x: auto; }
.staff svg { max-width: 100%; height: auto; display: block; }
.metro-read { display: flex; align-items: center; justify-content: center; gap: 0.65rem; }
.metro-bpm { font-family: "Bebas Neue", system-ui, sans-serif; font-size: clamp(4.4rem, 18vw, 6.4rem); line-height: 0.85; color: var(--cue); font-variant-numeric: tabular-nums; }
.metro-unit { font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--chrome); }
.metro-dot { width: 22px; height: 22px; border-radius: 50%; background: rgba(232,163,23,0.28); }
.metro-dot.is-hit { background: var(--gel); box-shadow: 0 0 16px rgba(232,163,23,0.75); }
.metro.is-running .metro-bpm { color: var(--gel); }
.metro-hint { margin: 0; text-align: center; }
.metro-controls { display: grid; grid-template-columns: 1fr 1.35fr 1fr; gap: 0.5rem; }
.metro-controls .btn { width: 100%; }
.metro-play { min-height: 52px; font-size: 1.05rem; }
.metro-side { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.metro-side .label { margin: 0; }
.sub-switch { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.4rem; }
.sub-switch button {
  min-height: var(--touch); border-radius: 12px; border: 1px solid var(--line);
  background: transparent; color: var(--chrome); font: inherit; font-weight: 700; font-size: 0.9rem; cursor: pointer;
}
.sub-switch button.is-on { background: var(--gel); border-color: var(--gel); color: var(--on-gel); }
.sub-switch button:focus-visible, .metro-play:focus-visible { outline: 2px solid var(--gel); outline-offset: 2px; }
.metro input[type="range"] { padding: 0; accent-color: var(--gel); }
.metro-timer { margin: 0; text-align: center; font-variant-numeric: tabular-nums; font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.6rem; letter-spacing: 0.04em; color: var(--cue); }
.pattern-title { font-size: clamp(2.4rem, 8vw, 3.4rem); line-height: 0.9; margin-top: 0.35rem; }
.pattern-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; margin: 0.9rem 0 0; }
.pattern-stat {
  display: grid; align-content: start; gap: 0.35rem;
  background: var(--wings); border: 1px solid var(--line); border-radius: 14px;
  padding: 0.75rem 0.8rem 0.85rem; min-height: 4.75rem;
}
.pattern-stat .label { margin: 0; }
.pattern-stat strong {
  font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.85rem; line-height: 1;
  font-weight: 400; letter-spacing: 0.03em; font-variant-numeric: tabular-nums;
}
.pattern-stat strong span { color: var(--chrome); font-size: 1.15rem; }
.sheet .staff-stage {
  background: #070605; border-radius: 12px; padding: 0.45rem 0.35rem 0.15rem; min-height: 8.5rem;
}
.medal-ladder li.is-next { opacity: 1; }
.log-card h2 { font-size: 1.6rem; }
@media (prefers-reduced-motion: reduce) {
  .metro-dot.is-hit { box-shadow: none; }
}
.attn { border-color: rgba(224,138,122,0.5); }
.attn h2 { color: #e08a7a; }
.ok { color: #9ec89a; }
.click-row { color: inherit; }
.click-row:hover td { color: var(--cue); }
.list-link { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); color: inherit; min-height: var(--touch); align-items: center; }
.list-link:last-child { border-bottom: 0; }
.list-link:hover .gel { text-decoration: underline; }
.player {
  position: relative; width: 100%; aspect-ratio: 16 / 9;
  background: #000; border-radius: var(--radius); overflow: hidden;
}
.player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.tag {
  display: inline-flex; align-items: center; gap: 0.35rem;
  min-height: 28px; padding: 0 0.55rem; border-radius: 99px;
  border: 1px solid rgba(232,163,23,0.35); color: var(--gel); font-size: 0.78rem;
}
.tag button { background: none; border: 0; color: var(--chrome); cursor: pointer; font: inherit; padding: 0; }
.video-grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 720px) { .video-grid { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1100px) { .video-grid { grid-template-columns: 1fr 1fr 1fr; } }
.video-card {
  display: flex; flex-direction: column; color: inherit; overflow: hidden;
  background: var(--wings); border: 1px solid var(--line); border-radius: var(--radius);
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms ease;
}
.video-card:hover { transform: translateY(-2px); border-color: rgba(232,163,23,0.45); }
.video-card:focus-visible { outline: 2px solid var(--gel); outline-offset: 3px; }
.thumb {
  position: relative; aspect-ratio: 16 / 9; background:
    radial-gradient(120% 80% at 50% 120%, rgba(232,163,23,0.16), transparent 55%),
    #070605;
  overflow: hidden;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb .cue-week {
  position: absolute; left: 0.7rem; top: 0.7rem;
  font-family: "Bebas Neue", system-ui, sans-serif; letter-spacing: 0.06em;
  font-size: 0.95rem; padding: 0.2rem 0.45rem; border-radius: 6px;
  background: rgba(12,11,10,0.78); color: var(--gel);
}
.thumb .missing {
  position: absolute; inset: 0; display: grid; place-items: center;
  color: var(--chrome); font-size: 0.88rem; letter-spacing: 0.06em; text-transform: uppercase;
}
.video-card .meta { padding: 0.9rem 1rem 1.05rem; display: grid; gap: 0.4rem; }
.video-card h2 { font-size: 1.35rem; line-height: 1; }
.studio { display: grid; gap: 1rem; }
@media (min-width: 960px) {
  .studio { grid-template-columns: minmax(0, 1.65fr) minmax(18rem, 0.95fr); align-items: start; }
}
.drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  gap: 0.35rem; min-height: 9.5rem; padding: 1.2rem;
  border: 1.5px dashed rgba(232,163,23,0.38); border-radius: var(--radius);
  background: var(--blackout); cursor: pointer; color: var(--chrome);
}
.drop:hover, .drop:focus-visible, .drop.is-over { border-color: var(--gel); color: var(--cue); background: rgba(232,163,23,0.06); }
.drop[aria-disabled="true"] { cursor: not-allowed; opacity: 0.55; border-color: var(--line); }
.drop input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.stage-empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 1.2rem; text-align: center; }
.bar-stats { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.9rem 0 1.1rem; }
details summary { cursor: pointer; color: var(--gel); font-weight: 700; }
.hero-mark {
  width: 4.5rem; height: 4.5rem; border-radius: 50%;
  display: grid; place-items: center;
  background: radial-gradient(circle at 40% 30%, rgba(232,163,23,0.35), transparent 60%), var(--wings);
  border: 1px solid rgba(232,163,23,0.35);
  font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.8rem; color: var(--gel);
}
.avatar-photo { width: 5.5rem; height: 5.5rem; border-radius: 50%; object-fit: cover; border: 2px solid var(--gel); }
.profile-head { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.profile-title { font-size: 3rem; line-height: 0.9; margin: 0; }
.membership-card { margin-bottom: 1rem; }
.road { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
.road li { display: grid; gap: 0.2rem; padding-left: 1rem; border-left: 3px solid var(--gel); }
.road strong { font-size: 1.35rem; }
.drawer-unit { font-size: 1rem; font-weight: 600; letter-spacing: 0.04em; }
.board { display: grid; gap: 0; }
.board-row {
  display: grid; grid-template-columns: 2.2rem 1fr auto; gap: 0.75rem;
  align-items: center; min-height: var(--touch);
  padding: 0.55rem 0; border-bottom: 1px solid var(--line); color: inherit;
}
.board-row:last-child { border-bottom: 0; }
.board-row.is-you { color: var(--gel); }
.rank { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.2rem; color: var(--chrome); }
.score { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.35rem; color: var(--gel); }
.room { display: grid; gap: 1rem; margin-top: 1rem; }
@media (min-width: 840px) { .room { grid-template-columns: minmax(0, 1.4fr) minmax(16rem, 0.9fr); } }
.week-card { color: inherit; overflow: hidden; padding: 0; }
.week-card .meta { padding: 1.05rem 1.15rem 1.2rem; }
.bar-toggle {
  display: none; width: var(--touch); height: var(--touch);
  border: 0; background: transparent; cursor: pointer; padding: 0;
  place-items: center; gap: 6px;
}
.bar-toggle span { display: block; width: 18px; height: 2px; background: var(--cue); }
.dock { display: none; }
.nav-drawer, .nav-scrim { display: none; }
.crumb { color: var(--chrome); }

/* Member dashboard */
.greet { margin: 0 0 0.8rem; font-size: 0.85rem; letter-spacing: 0.06em; text-transform: uppercase; }
.dash-grid { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 900px) {
  .dash-grid { grid-template-columns: minmax(0, 1.5fr) minmax(18rem, 1fr); }
  .dash-wide { grid-column: 1 / -1; }
}
.hero-card {
  display: grid; gap: 1.25rem; align-items: center;
  border-color: rgba(232,163,23,0.4);
  background:
    radial-gradient(120% 140% at 88% 12%, rgba(232,163,23,0.14) 0%, transparent 58%),
    var(--wings);
}
@media (min-width: 640px) { .hero-card { grid-template-columns: minmax(0, 1fr) auto; } }
.hero-copy { min-width: 0; }
.hero-title { font-size: clamp(2.1rem, 6vw, 3rem); line-height: 0.92; margin-top: 0.2rem; }
.hero-note { margin: 0.55rem 0 0; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.1rem; }
.hero-cta { padding: 0.7rem 1.4rem; font-size: 1rem; }
.tiles { display: grid; gap: 0.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 720px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.stat-tile {
  display: grid; gap: 0.1rem; align-content: start; color: inherit;
  background: var(--wings); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 0.9rem 1rem 1rem; min-height: 5.5rem;
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms ease;
}
.stat-tile:hover { transform: translateY(-2px); border-color: rgba(232,163,23,0.45); }
.stat-label { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--chrome); }
.stat-num { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 2.2rem; line-height: 1; color: var(--cue); }
.stat-foot { font-size: 0.74rem; }
.next-card .next-body { display: flex; gap: 0.9rem; align-items: center; color: inherit; margin-top: 0.6rem; }
.next-thumb { width: 6.5rem; flex: 0 0 auto; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; background: var(--blackout); display: block; }
.next-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.next-thumb .missing { width: 100%; height: 100%; display: grid; place-items: center; font-size: 0.7rem; color: var(--chrome); text-transform: uppercase; letter-spacing: 0.08em; }
.next-meta { display: grid; gap: 0.15rem; min-width: 0; }
.next-meta strong { font-size: 1.05rem; }
.next-week { font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--chrome); }
.quick-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.quick-row a {
  display: inline-flex; align-items: center; min-height: var(--touch);
  padding: 0 1rem; border-radius: 99px; border: 1px solid var(--line);
  color: var(--chrome); font-size: 0.85rem; font-weight: 600;
}
.quick-row a:hover { color: var(--cue); border-color: rgba(232,163,23,0.45); }
.streak-ring { display: grid; justify-items: center; gap: 0.3rem; }
.streak-ring .ring {
  --pct: 0%;
  width: 7.5rem; height: 7.5rem; border-radius: 50%;
  display: grid; place-content: center; justify-items: center;
  background:
    conic-gradient(var(--gel) var(--pct), rgba(242,235,227,0.09) var(--pct));
  position: relative;
}
.streak-ring .ring::after {
  content: ''; position: absolute; inset: 9px; border-radius: 50%; background: var(--wings);
}
.streak-ring .ring-num,
.streak-ring .ring-unit { position: relative; z-index: 1; }
.ring-num { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 2.6rem; line-height: 1; color: var(--gel); }
.ring-unit { font-size: 0.66rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--chrome); }
.ring-line { margin: 0.35rem 0 0; font-size: 0.85rem; font-weight: 600; }
.ring-best { margin: 0; font-size: 0.74rem; }
.streak-ring.is-cold .ring { background: conic-gradient(rgba(242,235,227,0.14) 100%, rgba(242,235,227,0.14) 0); }
.streak-ring.is-cold .ring-num { color: var(--chrome); }
.page-tools { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; min-height: 2.5rem; }
.page-tools:empty { display: none; min-height: 0; }
.page-tools .greet { margin: 0; }
.reward-slot { display: flex; justify-content: flex-end; margin-left: auto; }
.reward-bell {
  position: relative; display: grid; place-items: center;
  width: var(--touch); height: var(--touch); padding: 0;
  border: 1px solid var(--line); border-radius: 12px; background: var(--wings);
  color: var(--chrome); cursor: pointer;
}
.reward-bell svg { width: 20px; height: 20px; }
.reward-bell:hover { color: var(--cue); border-color: rgba(232,163,23,0.45); }
.reward-bell.is-new { color: var(--gel); border-color: rgba(232,163,23,0.55); }
.reward-pip {
  position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--gel); box-shadow: 0 0 0 2px var(--wings);
  animation: reward-flash 1.1s ease-in-out infinite;
}
@keyframes reward-flash {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.45); opacity: 0.35; }
}
.reward-pop {
  width: min(32rem, calc(100vw - 1.5rem)); max-height: min(80vh, 40rem); overflow: auto;
  margin: auto; padding: 1.1rem 1.1rem 1.2rem; color: var(--cue);
  background: var(--wings); border: 1px solid var(--line); border-radius: 16px;
}
.reward-pop::backdrop { background: rgba(12, 11, 10, 0.72); }
.badge-drawer {
  margin: 0 0 1.1rem; border: 1px solid rgba(232,163,23,0.3); border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, #1d1916 0%, #120f0d 100%);
  box-shadow: 0 12px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(242,235,227,0.06);
}
.drawer-face {
  appearance: none; border: 0; background: transparent; color: inherit; font: inherit; text-align: left;
  width: 100%; cursor: pointer; position: relative;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.35rem 0.9rem;
  padding: 0.9rem 1rem 1.45rem;
}
.drawer-face:focus-visible { outline: 2px solid var(--gel); outline-offset: -3px; border-radius: 16px; }
.drawer-mark { width: 56px; height: 56px; object-fit: contain; display: block; }
.drawer-mark.is-hot { filter: drop-shadow(0 0 8px rgba(232,163,23,0.7)); }
.drawer-summary { display: grid; gap: 0.12rem; min-width: 0; }
.drawer-count { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.95rem; line-height: 1; color: var(--cue); letter-spacing: 0.02em; }
.drawer-summary .muted { font-size: 0.82rem; }
.drawer-cta {
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gel);
  border: 1px solid rgba(232,163,23,0.45); border-radius: 99px; padding: 0.4rem 0.75rem; white-space: nowrap;
}
.drawer-face:hover .drawer-cta { background: rgba(232,163,23,0.12); }
.drawer-pull {
  position: absolute; left: 50%; bottom: 0.5rem; width: 88px; height: 9px; transform: translateX(-50%);
  border-radius: 99px; background: linear-gradient(180deg, #f6c95e, var(--gel-deep));
  box-shadow: inset 0 -2px 0 rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.55);
}
.drawer-tray { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 360ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.badge-drawer.is-open .drawer-tray { grid-template-rows: 1fr; }
.drawer-inner { min-height: 0; overflow: hidden; visibility: hidden; transition: visibility 0s linear 360ms; }
.badge-drawer.is-open .drawer-inner { visibility: visible; transition-delay: 0s; }
.drawer-bed {
  margin: 0 0.6rem 0.6rem; padding: 1rem 0.9rem 1.1rem; display: grid; gap: 0.7rem;
  border-radius: 4px 4px 12px 12px; background: #0a0908;
  box-shadow: inset 0 16px 18px -12px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(232,163,23,0.14);
}
.drawer-bed h3 { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.4rem; line-height: 1; margin: 0.25rem 0 0; color: var(--cue); letter-spacing: 0.02em; }
.case-rule { margin: 0; font-size: 0.8rem; }
.case-tiers { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.45rem; }
@media (min-width: 720px) { .case-tiers { grid-template-columns: repeat(7, minmax(0, 1fr)); } }
.case-tiers li {
  display: grid; justify-items: center; gap: 0.15rem; text-align: center;
  padding: 0.55rem 0.25rem 0.6rem; border-radius: 12px; background: var(--wings); border: 1px solid var(--line);
}
.case-tiers li.is-earned { border-color: rgba(232,163,23,0.35); }
.case-tiers img { width: 52px; height: 52px; object-fit: contain; }
.case-tiers strong { font-size: 0.74rem; }
.case-tiers .muted { font-size: 0.72rem; }
.case-tiers li.is-locked, .case-strip li.is-locked { opacity: 0.3; }
.case-tiers li.is-locked img, .case-strip li.is-locked img { filter: grayscale(0.9); }
.case-tiers li.is-hot img, .case-strip li.is-hot img { filter: drop-shadow(0 0 5px rgba(232,163,23,0.8)); }
.case-group h4 { margin: 0.2rem 0 0.4rem; font-size: 0.7rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gel); }
.case-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
@media (min-width: 960px) { .case-rows { grid-template-columns: 1fr 1fr; column-gap: 0.7rem; } }
.case-row {
  display: flex; justify-content: space-between; align-items: center; gap: 0.6rem;
  padding: 0.45rem 0.55rem; border-radius: 10px; background: #15120f; border: 1px solid var(--line);
}
.case-row.is-idle { opacity: 0.6; }
.case-name { display: grid; min-width: 0; }
.case-name strong { font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.case-name .muted { font-size: 0.72rem; }
.case-strip { list-style: none; margin: 0; padding: 0; display: flex; gap: 2px; flex: none; }
.case-strip img { width: 24px; height: 24px; display: block; object-fit: contain; }
@media (max-width: 560px) {
  .case-row { flex-direction: column; align-items: stretch; gap: 0.35rem; }
  .case-strip { justify-content: space-between; }
  .case-strip img { width: 28px; height: 28px; }
  .drawer-face { grid-template-columns: auto minmax(0, 1fr); }
  .drawer-cta { grid-column: 1 / -1; justify-self: start; }
}
.badge-grid { list-style: none; margin: 0.55rem 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; }
@media (min-width: 840px) { .badge-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); } }
.badge-grid li {
  display: grid; justify-items: center; gap: 0.2rem; text-align: center;
  padding: 0.65rem 0.3rem 0.7rem; border: 1px solid var(--line); border-radius: 14px; background: var(--wings);
}
.badge-grid img { width: 64px; height: 64px; object-fit: contain; }
.badge-grid strong { font-size: 0.78rem; }
.badge-grid li.is-locked { opacity: 0.42; }
.badge-grid li.is-locked img { filter: grayscale(0.8); }
.badge-grid li.is-hot img { filter: drop-shadow(0 0 8px rgba(232,163,23,0.75)); }
.reward-mark { width: 40px; height: 40px; object-fit: contain; display: block; }
.reward-list li.is-locked .reward-mark, .reward-list li:not(.is-earned) .reward-mark { filter: grayscale(0.75); opacity: 0.7; }
.reward-pop h2 { font-size: 1.7rem; }
.reward-list { list-style: none; margin: 0.85rem 0 0; padding: 0; display: grid; gap: 0.45rem; }
.reward-list li {
  display: grid; grid-template-columns: 3.1rem minmax(0, 1fr) auto; gap: 0.7rem; align-items: center;
  padding: 0.65rem 0.75rem; border: 1px solid var(--line); border-radius: 12px;
  background: rgba(12, 11, 10, 0.35); opacity: 0.5;
}
.reward-list li.is-earned { opacity: 1; border-color: rgba(232, 163, 23, 0.45); }
.reward-list li.is-next { opacity: 1; border-style: dashed; border-color: rgba(232, 163, 23, 0.75); }
.reward-days { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 1.55rem; line-height: 1; color: var(--chrome); }
.reward-list li.is-earned .reward-days,
.reward-list li.is-next .reward-days { color: var(--gel); }
.reward-copy { display: grid; gap: 0.12rem; min-width: 0; }
.reward-copy .muted { font-size: 0.82rem; }
.reward-flag { font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: var(--chrome); white-space: nowrap; }
.reward-list li.is-earned .reward-flag { color: var(--gel); }
.rise-in { animation: rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
.rise-in:nth-child(2) { animation-delay: 0.06s; }
.rise-in:nth-child(3) { animation-delay: 0.12s; }
.rise-in:nth-child(4) { animation-delay: 0.18s; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

@media (max-width: 840px) {
  .desk { display: none; }
  body.kind-admin .bar-toggle { display: grid; }
  body.kind-member { padding-bottom: calc(7.6rem + env(safe-area-inset-bottom)); }
  body.kind-member .stage { margin-bottom: 9.25rem; }
  .bar-out { display: none !important; }
  body.kind-member .dock {
    display: flex; position: fixed; z-index: 80; align-items: flex-end; justify-content: space-around;
    left: max(0.55rem, env(safe-area-inset-left));
    right: max(0.55rem, env(safe-area-inset-right));
    bottom: calc(0.4rem + env(safe-area-inset-bottom));
    padding: 0.35rem 0.25rem 0.4rem;
    background: rgba(18, 15, 13, 0.94);
    border: 1px solid rgba(242,235,227,0.08);
    border-radius: 24px;
    box-shadow: inset 0 1px 0 rgba(242,235,227,0.06), 0 18px 40px rgba(0,0,0,0.5);
  }
  .dock a {
    flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 0.12rem;
    min-height: var(--touch); color: var(--chrome); font-size: 0.62rem; letter-spacing: 0.06em;
    text-transform: uppercase; font-weight: 700; text-align: center;
    border-radius: 14px;
    transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), color 160ms ease;
  }
  .dock a:active { transform: scale(0.96); }
  .dock a span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dock a.is-on:not(.is-main) { color: var(--gel); }
  .dock a.is-on:not(.is-main)::after {
    content: ''; width: 4px; height: 4px; border-radius: 50%; background: var(--gel);
  }
  .dock a.is-main {
    flex: 0 0 4.45rem; width: 4.45rem; height: 4.45rem; margin-top: -1.65rem;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 28%, #f6c95e, var(--gel) 46%, var(--gel-deep));
    color: #14110c; justify-content: center;
    box-shadow: 0 0 0 5px #0c0b0a, 0 0 0 6px rgba(232,163,23,0.35), 0 12px 24px rgba(232,163,23,0.32);
  }
  .dock a.is-main.is-on, .dock a.is-main { color: #14110c; }
  .dock a.is-main span { font-size: 0.5rem; letter-spacing: 0.04em; }
  .dock a.is-main::after { content: none; }
  .dock svg { width: 22px; height: 22px; }
  @media (max-width: 360px) {
    .dock a { font-size: 0.54rem; }
    .dock svg { width: 18px; height: 18px; }
  }
  body.kind-admin.nav-open .nav-scrim {
    display: block; position: fixed; inset: 0; z-index: 45;
    background: rgba(12,11,10,0.72); border: 0;
  }
  body.kind-admin.nav-open .nav-drawer {
    display: flex; flex-direction: column; gap: 0.2rem;
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 46;
    width: min(20rem, 86vw); padding: calc(4.5rem + env(safe-area-inset-top)) 1.1rem 1.4rem;
    background: var(--wings); border-left: 1px solid var(--line);
  }
  body.kind-admin.nav-open .nav-drawer a {
    color: var(--cue); min-height: var(--touch); display: flex; align-items: center;
    padding: 0 0.4rem; border-radius: 10px;
  }
  body.kind-admin.nav-open .nav-drawer a.is-on { color: var(--gel); }
  .wrap { padding: 1.2rem 1rem 2rem; }
  .display { font-size: 2.4rem !important; }
  body.kind-member .bench-title,
  body.kind-member .stage-title,
  body.kind-member .lead-title { font-size: clamp(2.7rem, 12vw, 3.8rem) !important; }
  body.kind-member .pattern-title { font-size: clamp(2.4rem, 11vw, 3.4rem) !important; }
  table.stack-sm thead { display: none; }
  table.stack-sm tr { display: block; padding: 0.85rem 0; border-bottom: 1px solid var(--line); }
  table.stack-sm td { display: block; padding: 0.2rem 0; border: 0; }
  table.stack-sm td[data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--chrome);
    margin-top: 0.35rem;
  }
  .kpis { grid-template-columns: 1fr 1fr; }
  .player { border-radius: 10px; }
}

/* Practice instrument: Home, Practice, Rudiments, Profile */
.bench-mast { display: grid; gap: 0.2rem; margin: 0 0 1rem; }
.bench-mast .greet { margin: 0; }
.stage-side .streak-ring .ring::after,
.streak-well .streak-ring .ring::after { background: #14110e; }
body.kind-member .practice-card { border-radius: 18px; background-color: #14110e; }
.id-strip > div { min-width: 0; }
.profile-title { overflow-wrap: anywhere; }
@media (max-width: 520px) {
  .id-strip { grid-template-columns: auto minmax(0, 1fr); }
  .id-strip .reward-slot { grid-column: 1 / -1; justify-content: flex-start; }
}
.bench-mast .muted { margin: 0.15rem 0 0; max-width: 38rem; }
.bench-kicker { margin: 0.15rem 0 0; font-size: 0.92rem; }
.bench-title { font-size: clamp(3.4rem, 9vw, 5.4rem); line-height: 0.82; }
.stage {
  display: grid; gap: 0.55rem; padding: 0.45rem;
  border-radius: 28px;
  background: rgba(242,235,227,0.035);
  border: 1px solid rgba(242,235,227,0.08);
}
@media (min-width: 800px) { .stage { grid-template-columns: minmax(0, 1.55fr) minmax(15.5rem, 0.72fr); } }
.stage-main, .stage-side {
  border-radius: 22px;
  background:
    radial-gradient(90% 80% at 100% 0%, rgba(232,163,23,0.13), transparent 56%),
    #14110e;
  box-shadow: inset 0 1px 0 rgba(242,235,227,0.07);
  padding: 1.2rem 1.25rem 1.3rem;
}
.stage-side { display: grid; align-content: center; justify-items: center; gap: 0.85rem; text-align: center; }
@media (max-width: 799px) {
  .stage-side {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    justify-items: start;
    text-align: left;
    gap: 0.85rem 1rem;
    padding: 0.95rem 1rem;
  }
  .stage-side .streak-ring { justify-items: center; }
  .stage-side .streak-ring .ring { width: 5.75rem; height: 5.75rem; }
  .stage-side .readout-num { font-size: 2.6rem; }
}
.stage-title { font-size: clamp(3rem, 7vw, 5rem); line-height: 0.84; margin-top: 0.2rem; }
.stage-note { margin: 0.7rem 0 0; max-width: 36rem; color: var(--chrome); }
.stage-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.15rem; }
.stage-actions .btn { min-height: 52px; padding-inline: 1.35rem; }
.readout { display: grid; gap: 0.15rem; margin: 0; }
.readout-num {
  font-family: "Bebas Neue", system-ui, sans-serif;
  font-size: clamp(3rem, 8vw, 4.2rem); line-height: 0.85; letter-spacing: 0.03em; color: var(--cue);
  font-variant-numeric: tabular-nums;
}
/* Home: mast, gap bar, evidence rail, ladder, Analyze strip. Phone first. */
.home-mast { grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: 0.75rem; }
@media (max-width: 380px) { .home-mast { grid-template-columns: minmax(0, 1fr); } }
.chip {
  display: inline-flex; align-items: center; gap: 0.45rem; align-self: center;
  padding: 0.4rem 0.75rem; border-radius: 999px; white-space: nowrap;
  border: 1px solid var(--line); background: #14110e;
  color: var(--chrome); font-size: 0.74rem; letter-spacing: 0.02em;
}
.chip i { width: 7px; height: 7px; border-radius: 50%; background: var(--chrome); }
.chip.is-on i { background: #7BC96F; }
.chip.is-off i { background: rgba(242,235,227,0.28); }
.stage-sticking { margin: 0.55rem 0 0; color: var(--chrome); font-weight: 600; letter-spacing: 0.28em; font-size: 0.82rem; }
.gap-bar { margin: 1rem 0 0; max-width: 27rem; }
.gap-read { display: flex; justify-content: space-between; gap: 0.75rem; margin: 0 0 0.45rem; font-size: 0.88rem; }
.gap-read strong { font-variant-numeric: tabular-nums; }
.gap-track { height: 10px; border-radius: 8px; background: rgba(242,235,227,0.08); overflow: hidden; }
.gap-track i { display: block; height: 100%; background: var(--gel); transition: width 0.4s ease; }
.gap-note { margin: 0.55rem 0 0; color: var(--chrome); font-size: 0.86rem; }
.section-label { margin: 1.6rem 0 0.6rem; color: var(--gel); font-weight: 700; }
.rail-empty { margin: 0 0 0.9rem; }
.rail { display: flex; gap: 0.65rem; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 0.3rem; }
.rail::-webkit-scrollbar { height: 0; }
.fact {
  flex: 0 0 auto; min-width: 72%; scroll-snap-align: start;
  display: grid; align-content: start; gap: 0.3rem;
  padding: 0.9rem 1rem 1rem; border-radius: 18px;
  background: #14110e; border: 1px solid rgba(242,235,227,0.08);
  box-shadow: inset 0 1px 0 rgba(242,235,227,0.05);
}
@media (min-width: 720px) {
  .rail { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
  .fact { min-width: 0; }
}
.fact-head { margin: 0; color: var(--chrome); font-size: 0.68rem; letter-spacing: 0.13em; text-transform: uppercase; }
.fact-num {
  margin: 0; font-family: "Bebas Neue", system-ui, sans-serif;
  font-size: clamp(2rem, 7vw, 2.4rem); line-height: 1; letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
}
.fact-num i { font-style: normal; font-size: 0.85rem; color: var(--chrome); margin-left: 0.3rem; }
.fact-sub { margin: 0; font-size: 0.82rem; }
.step { font-size: 0.8rem; font-weight: 600; }
.step.up { color: #7BC96F; }
.bars { display: flex; align-items: flex-end; gap: 4px; height: 34px; margin-top: 0.35rem; }
.bars i { flex: 1; height: var(--h); border-radius: 3px; background: var(--gel); opacity: 0.85; }
.bars i.rest { height: 2px; background: rgba(242,235,227,0.14); }
.spark { width: 100%; height: 34px; margin-top: 0.35rem; }
.ladder-panel, .strip { margin-top: 0.65rem; border-radius: 18px; background: #14110e; }
.panel-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.3rem 1rem; align-items: baseline; }
.panel-head .label { color: var(--gel); font-weight: 700; }
.panel-note { margin: 0; font-size: 0.82rem; }
.ladder { list-style: none; display: flex; gap: 5px; margin: 0.85rem 0 0; padding: 0; }
.rung { flex: 1; min-width: 0; text-align: center; }
.rung .cap { display: block; height: 8px; border-radius: 6px; background: rgba(242,235,227,0.08); }
.rung.done .cap { background: rgba(232,163,23,0.55); }
.rung.now .cap { background: var(--gel); }
.rung small { display: block; margin-top: 0.45rem; font-size: 0.6rem; line-height: 1.3; letter-spacing: 0.06em; text-transform: uppercase; color: var(--chrome); }
.rung small b { display: block; font-weight: 600; }
.rung.now small { color: var(--cue); font-weight: 700; }
@media (max-width: 560px) { .rung.is-far { display: none; } }
.ladder-next { margin: 0.9rem 0 0; font-size: 0.84rem; }
.ladder-next a { color: var(--cue); }
.ladder-next strong { color: var(--cue); }
.dot-sep { margin: 0 0.45rem; color: var(--chrome); }
.strip { display: grid; gap: 0.85rem; align-items: center; }
@media (min-width: 720px) { .strip { grid-template-columns: minmax(0, 1fr) auto; } }
.strip-copy { margin: 0.35rem 0 0; font-size: 0.98rem; }
.strip-note { margin: 0.35rem 0 0; font-size: 0.84rem; }
.strip .btn { width: 100%; justify-content: center; }
@media (min-width: 720px) { .strip .btn { width: auto; } }
.home-foot { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 1.1rem; }
.home-foot a {
  display: inline-flex; align-items: center; min-height: var(--touch);
  padding: 0 0.9rem; border-radius: 999px; border: 1px solid var(--line);
  color: var(--chrome); font-size: 0.8rem;
}
.home-foot a:hover { color: var(--cue); }
.home-status { margin: 0.8rem 0 0; font-size: 0.8rem; }
.streak-slim {
  display: flex; flex-wrap: wrap; gap: 0.35rem 0.85rem; align-items: baseline;
  margin: 0 0 0.9rem; padding: 0.7rem 0.95rem; border-radius: 999px;
  background: #14110e; border: 1px solid rgba(242,235,227,0.08);
}
.streak-slim .label { margin: 0; }
.streak-slim strong { color: var(--gel); font-variant-numeric: tabular-nums; }
.lead {
  padding: 0.45rem; border-radius: 28px;
  background: rgba(242,235,227,0.035);
  border: 1px solid rgba(232,163,23,0.32);
}
.lead-core {
  display: grid; gap: 0.75rem 1rem; align-items: center;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 1.15rem 1.2rem 1.25rem; border-radius: 22px;
  background:
    radial-gradient(80% 90% at 0% 0%, rgba(232,163,23,0.16), transparent 52%),
    #14110e;
  box-shadow: inset 0 1px 0 rgba(242,235,227,0.07);
}
.lead-read, .lead-actions { grid-column: 1 / -1; }
@media (min-width: 860px) {
  .lead-core {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "medal copy read" "medal actions read";
  }
  .lead-medal { grid-area: medal; }
  .lead-copy { grid-area: copy; }
  .lead-read { grid-area: read; grid-column: auto; align-self: center; text-align: right; min-width: 9rem; }
  .lead-actions { grid-area: actions; grid-column: auto; }
}
.lead-medal { width: 5.5rem; height: 5.5rem; object-fit: contain; filter: drop-shadow(0 10px 16px rgba(0,0,0,0.45)); }
.lead-copy { display: grid; gap: 0.45rem; min-width: 0; }
.lead-title { font-size: clamp(2.6rem, 6vw, 4.2rem); line-height: 0.86; }
.lead-bpm {
  margin: 0.15rem 0 0; font-family: "Bebas Neue", system-ui, sans-serif;
  font-size: clamp(3.2rem, 8vw, 4.6rem); line-height: 0.82; color: var(--gel);
  font-variant-numeric: tabular-nums;
}
.lead-bpm span { color: var(--chrome); font-size: 0.42em; letter-spacing: 0.08em; }
.lead-next { margin: 0; color: var(--chrome); }
.lead-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-top: 0.35rem; }
.lead-actions .btn { min-height: 52px; padding-inline: 1.45rem; }
.lock-line { margin: 0; color: var(--chrome); }
.practice-head .yours {
  font-family: Barlow, system-ui, sans-serif; font-style: normal; font-weight: 700;
  font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--on-gel);
  background: var(--gel); border-radius: 99px; padding: 0.22rem 0.55rem; margin-left: 0.35rem;
}
.practice-group.is-yours .practice-card { border-color: rgba(232,163,23,0.28); }
.id-strip {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.9rem; align-items: center;
  margin-bottom: 1rem;
}
.id-meta { margin: 0.3rem 0 0; }
.profile-stage { display: grid; gap: 0.75rem; margin-bottom: 1rem; }
@media (min-width: 800px) {
  .profile-stage:has(.streak-well) { grid-template-columns: minmax(14rem, 0.72fr) minmax(0, 1.3fr); align-items: stretch; }
}
.streak-well {
  display: grid; place-items: center; padding: 1.1rem 1rem 1.2rem;
  border-radius: 22px; background: #14110e;
  border: 1px solid rgba(242,235,227,0.08);
  box-shadow: inset 0 1px 0 rgba(242,235,227,0.06);
}
.member-pass {
  position: relative; overflow: hidden; display: grid; align-content: start; gap: 0.45rem;
  min-height: 12rem; padding: 1.2rem 1.25rem 1.3rem; border-radius: 22px;
  background:
    linear-gradient(155deg, rgba(232,163,23,0.2), transparent 46%),
    linear-gradient(180deg, #2a231c 0%, #120f0d 100%);
  border: 1px solid rgba(232,163,23,0.48);
  box-shadow: inset 0 1px 0 rgba(246,201,94,0.28), 0 16px 32px rgba(0,0,0,0.28);
}
.member-pass h2 { font-size: clamp(2.6rem, 6vw, 3.6rem); line-height: 0.86; }
.pass-status { margin: 0.15rem 0 0; }
.pass-rate { margin: 0; font-variant-numeric: tabular-nums; color: var(--cue); }
.pass-bill { margin: 0.35rem 0 0; color: var(--chrome); }
.member-pass .btn { width: fit-content; margin-top: 0.35rem; }
.settings-bench { background: transparent; border-radius: 22px; }
.settings-grid { display: grid; gap: 1rem; }
@media (min-width: 720px) {
  .settings-grid { grid-template-columns: 1fr 1fr; }
  .settings-grid .span-2, .settings-bench > .span-2 { grid-column: 1 / -1; }
}
.settings-bench .btn { width: fit-content; min-width: 10rem; }
.foot-meta { margin: 1.1rem 0 0; color: var(--chrome); font-size: 0.85rem; }
.kit-room .panel { border-radius: 22px; }
.kit-room .metro {
  border-color: rgba(232,163,23,0.32);
  background:
    radial-gradient(70% 50% at 50% 0%, rgba(232,163,23,0.12), transparent 62%),
    #14110e;
}
.kit-room .sheet { background: #100e0c; }
body.kind-member .empty {
  margin: 0.4rem 0; padding: 1.25rem 1rem;
  border: 1px dashed rgba(242,235,227,0.16); border-radius: 16px;
}
.badge-drawer { border-radius: 22px; }

@media (min-width: 841px) {
  body.kind-member .bar-out { display: inline-flex; }
}

@media (prefers-reduced-motion: reduce) {
  .kpi-card, .video-card, .stat-tile, .practice-card, .practice-switch a, .dock a { transition: none; }
  .kpi-card:hover, .video-card:hover, .stat-tile:hover, .practice-card:hover { transform: none; }
  .dock a:active { transform: none; }
  .rise-in { animation: none; }
  .reward-pip { animation: none; }
  .medal-diamond img, .medal-legendary img, .medal-insanity img, .badge-grid li.is-hot img, .lead-medal { filter: none; }
  .drawer-tray, .drawer-inner { transition: none; }
}
`;

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export const icons = {
  home: icon(
    '<ellipse cx="12" cy="14.2" rx="7.2" ry="4.4"/><path d="M5.2 13.2c.4-2.6 3.2-4.6 6.8-4.6s6.4 2 6.8 4.6"/><path d="M8.2 6.2 4.8 3.4"/><path d="M15.8 6.2 19.2 3.4"/><path d="M9.2 14.2h5.6"/>',
  ),
  library: icon(
    '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9.2h16"/><path d="M8.2 13.2h4.2"/><path d="M8.2 16h7.4"/><path d="M16.6 3.4 19.4 6"/>',
  ),
  challenges: icon(
    '<path d="M12 3.4v3.2"/><circle cx="12" cy="14" r="6.2"/><path d="M12 10.4v3.6l2.4 1.4"/><path d="M8.4 4.8h7.2"/><path d="M7.2 6.4 5.2 8.6"/><path d="M16.8 6.4 18.8 8.6"/>',
  ),
  profile: icon(
    '<circle cx="12" cy="8.2" r="3.1"/><path d="M5.6 19.2c.8-3.2 3.3-5 6.4-5s5.6 1.8 6.4 5"/><path d="M18.4 7.2 20.6 5"/>',
  ),
  analyze: icon(
    '<path d="M3 12.5h2.6l2.2-5.6 3.2 11 3-8.2 1.9 4.4 1.3-1.6H21"/><circle cx="19.2" cy="5.2" r="1.6"/>',
  ),
  rudiments: icon(
    '<path d="M4 7.4h16"/><path d="M4 12h16"/><path d="M4 16.6h16"/><path d="M8.4 4.6v6.2"/><path d="M15.6 13.2v6.2"/><circle cx="8.4" cy="12" r="1.6"/><circle cx="15.6" cy="16.6" r="1.6"/>',
  ),
  practice: icon(
    '<circle cx="12" cy="12" r="7.2"/><path d="M12 8.2v4l2.6 1.6"/>',
  ),
};

/**
 * Member nav flag: Analyze replaced Challenges in the member nav on 2026-09-26. The /challenges
 * route, its code, and its D1 data are untouched and still reachable. Flip to true to bring the tab back.
 */
export const SHOW_CHALLENGES_IN_NAV = false;
export const APP_VERSION = '1.0.0';

export type ShellOpts = {
  title: string;
  base: string;
  kind: 'member' | 'admin';
  path: string;
  user?: Person | null;
  body: string;
  wide?: boolean;
  scripts?: string;
};

function isOn(path: string, href: string): boolean {
  return path === href || (href !== '/' && path.startsWith(href));
}

export function shell(opts: ShellOpts): string {
  const { title, base, kind, path, user, body } = opts;
  const adminNav: [string, string][] = [
    ['/', 'Dashboard'],
    ['/members', 'Members'],
    ['/lessons', 'Lessons'],
    ['/rudiments', 'Rudiments'],
    ['/challenges', 'Challenges'],
    ['/marketing', 'Marketing'],
    ['/financials', 'Financials'],
  ];
  const memberNav: [string, string, keyof typeof icons][] = [
    ['/', 'Home', 'home'],
    ['/practice', 'Practice', 'practice'],
    ['/rudiments', 'Rudiments', 'rudiments'],
    SHOW_CHALLENGES_IN_NAV ? ['/challenges', 'Challenges', 'challenges'] : ['/analyze', 'Analyze', 'analyze'],
    ['/profile', 'Profile', 'profile'],
  ];
  const desk =
    user && kind === 'admin'
      ? adminNav
          .map(([href, label]) => `<a href="${base}${href}" class="${isOn(path, href) ? 'is-on' : ''}">${label}</a>`)
          .join('') + `<a href="${base}/logout">Log out</a>`
      : user && kind === 'member'
        ? memberNav
            .map(([href, label, key]) => {
              const main = href === '/rudiments' ? ' is-main' : '';
              const on = isOn(path, href) ? ' is-on' : '';
              const current = isOn(path, href) ? ' aria-current="page"' : '';
              return `<a href="${base}${href}" class="nav-link${on}${main}"${current}>${icons[key]}<span>${label}</span></a>`;
            })
            .join('')
        : '';
  const signOut = user && kind === 'member' ? `<a class="bar-out" href="${base}/logout">Sign out</a>` : '';
  const dock =
    user && kind === 'member'
      ? `<nav class="dock" aria-label="Member">
          ${memberNav
            .map(([href, label, key]) => {
              const main = href === '/rudiments' ? ' is-main' : '';
              const on = isOn(path, href) ? ' is-on' : '';
              const current = isOn(path, href) ? ' aria-current="page"' : '';
              return `<a href="${base}${href}" class="${on}${main}"${current}>${icons[key]}<span>${label}</span></a>`;
            })
            .join('')}
        </nav>`
      : '';
  const drawer =
    user && kind === 'admin'
      ? `<button class="nav-scrim" data-nav-scrim hidden aria-label="Close menu"></button>
         <nav class="nav-drawer" id="admin-drawer" hidden>
           ${adminNav
             .map(([href, label]) => `<a href="${base}${href}" class="${isOn(path, href) ? 'is-on' : ''}">${label}</a>`)
             .join('')}
           <a href="${base}/logout">Log out</a>
         </nav>`
      : '';
  const toggle =
    user && kind === 'admin'
      ? `<button type="button" class="bar-toggle" data-nav-toggle aria-expanded="false" aria-controls="admin-drawer" aria-label="Open menu"><span></span><span></span></button>`
      : '';
  // The wordmark already contains the crossed-sticks mark, so the member header never adds the glyph.
  const brand =
    kind === 'admin'
      ? `<a class="brand-lockup" href="${base}/"><img class="brand-glyph" src="/img/brand/glyph.png" alt="" width="28" height="28" /><span class="brand-text">SIO Admin</span></a>`
      : `<a class="brand-lockup" href="${base}/"><img class="brand-word" src="/img/brand/wordmark.png" alt="Stick It Out" width="309" height="40" /></a>`;
  const adminScript =
    kind === 'admin' && user
      ? `<script>
          (function () {
            var toggle = document.querySelector('[data-nav-toggle]');
            var drawer = document.getElementById('admin-drawer');
            var scrim = document.querySelector('[data-nav-scrim]');
            if (!toggle || !drawer) return;
            function setOpen(open) {
              drawer.hidden = !open;
              if (scrim) scrim.hidden = !open;
              document.body.classList.toggle('nav-open', open);
              toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
              toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            }
            toggle.addEventListener('click', function () { setOpen(drawer.hidden); });
            if (scrim) scrim.addEventListener('click', function () { setOpen(false); });
            drawer.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
          })();
        </script>`
      : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="theme-color" content="#0C0B0A" />
  <meta name="color-scheme" content="dark" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Stick It Out" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Bebas+Neue&display=swap" rel="stylesheet" />
  <style>${CSS}</style>
</head>
<body class="kind-${kind}">
  <header class="bar">
    ${brand}
    <nav class="desk" aria-label="Primary">${desk}</nav>
    ${toggle}
    ${signOut}
  </header>
  ${drawer}
  <main class="wrap${opts.wide ? ' wide' : ''}">${body}</main>
  ${dock}
  <script>
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') document.body.classList.add('kbd');
    });
  </script>
  ${adminScript}
  ${opts.scripts || ''}
</body>
</html>`;
}
