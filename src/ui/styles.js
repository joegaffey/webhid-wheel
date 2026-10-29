export const BASE_CSS = `
:host {
  display: block;
  box-sizing: border-box;
  color: var(--wheel-fg-color, #e6e8eb);
  font-family: var(--wheel-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: 12px;
  line-height: 1.4;
}
*, *::before, *::after { box-sizing: border-box; }
.panel {
  background: var(--wheel-bg-color, #0d1117);
  border: 1px solid var(--wheel-border-color, #2a303a);
  border-radius: var(--wheel-radius, 4px);
  padding: 10px;
}
h3, h4 { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--wheel-muted-color, #8f9bab); }
h4 { font-size: 10px; margin: 8px 0 4px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.field { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; align-items: center; margin: 6px 0; }
.field > label { color: var(--wheel-muted-color, #8f9bab); }
.field input[type="range"] { grid-column: 1 / -1; width: 100%; accent-color: var(--wheel-accent, #38bdf8); }
.field output, .muted { color: var(--wheel-muted-color, #8f9bab); }
button, select, input[type="text"], input[type="number"] {
  font: inherit;
  color: inherit;
  background: #080a0d;
  border: 1px solid var(--wheel-border-color, #2a303a);
  border-radius: 3px;
  min-height: 26px;
  padding: 3px 7px;
}
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--wheel-accent, #38bdf8); }
button:disabled { opacity: .45; cursor: default; }
button.primary { border-color: var(--wheel-accent, #38bdf8); color: var(--wheel-accent, #38bdf8); }
button.danger { border-color: var(--wheel-danger, #f87171); color: var(--wheel-danger, #f87171); }
input[type="checkbox"] { accent-color: var(--wheel-accent, #38bdf8); }
.status:empty { display: none; }
.status {
  min-height: 30px;
  padding: 6px 8px;
  border: 1px solid var(--wheel-border-color, #2a303a);
  background: #080a0d;
  color: var(--wheel-muted-color, #8f9bab);
  white-space: pre-line;
}
.status.ready { color: var(--wheel-success, #34d399); }
.status.error { color: var(--wheel-danger, #f87171); }
.list { display: grid; gap: 4px; margin: 8px 0; }
.list-item { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 4px 6px; border: 1px solid var(--wheel-border-color, #2a303a); border-radius: 3px; }
.badge { display: inline-flex; align-items: center; justify-content: center; line-height: 1; font-size: 10px; color: var(--wheel-muted-color, #8f9bab); border: 1px solid var(--wheel-border-color, #2a303a); border-radius: 999px; padding: 2px 6px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.grid { display: grid; gap: 6px; }
`;
