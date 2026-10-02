// Search-as-you-type against /api/search, plus GitHub-parity heading ids so
// #anchors written in the docs scroll here exactly as they do on GitHub.
// (Slug algorithm mirrors src/slug.ts — keep the two in sync.)

const input = document.getElementById("search");
const resultsBox = document.getElementById("search-results");

function githubSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

// Assign heading ids with GitHub's -1/-2 dedupe — the SAME collision loop as
// src/slug.ts Slugger (a suffixed form can itself collide with a later
// literal heading), or server-validated anchors would not scroll here.
const counts = new Map();
for (const h of document.querySelectorAll(
  "article h1, article h2, article h3, article h4, article h5, article h6",
)) {
  const base = githubSlug(h.textContent ?? "");
  const seen = counts.get(base);
  if (seen === undefined) {
    counts.set(base, 0);
    h.id = base;
  } else {
    let next = seen + 1;
    let candidate = `${base}-${next}`;
    while (counts.has(candidate)) {
      next += 1;
      candidate = `${base}-${next}`;
    }
    counts.set(base, next);
    counts.set(candidate, 0);
    h.id = candidate;
  }
}
// Now that ids exist, honour any #fragment the browser already tried.
if (location.hash !== "") {
  const target = document.getElementById(
    decodeURIComponent(location.hash.slice(1)),
  );
  if (target !== null) target.scrollIntoView();
}

// Backlinks pane tabs. The graph module is fetched lazily the first time the
// Graph tab is opened — a doc page should not pay for a canvas nobody looked
// at, and most visits never leave the list.
const pane = document.getElementById("backlinks");
if (pane) {
  const tabs = [...pane.querySelectorAll('[role="tab"]')];
  // Memoise the PROMISE, not the resolved value: two clicks before the lazy
  // import settles would otherwise both see null and mount twice, attaching
  // duplicate pointer listeners to one canvas.
  let paneGraphPromise = null;
  const select = async (tab) => {
    for (const t of tabs) {
      const panel = document.getElementById(t.getAttribute("aria-controls"));
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.classList.toggle("on", on);
      if (panel) panel.hidden = !on;
    }
    if (tab.id !== "tab-graph") return;
    const canvas = document.getElementById("pane-graph");
    const pageId = pane.dataset.page;
    if (!canvas || !pageId) return;
    paneGraphPromise ??= import("/assets/pane-graph.mjs").then((m) =>
      m.mountPaneGraph(
        canvas,
        pageId,
        document.getElementById("pane-graph-legend"),
      ),
    );
    // The canvas has no size while hidden, so sizing and the draw loop can
    // only start once the panel is visible.
    (await paneGraphPromise)?.show();
  };
  // The enlarged view is a SECOND instance on its own canvas rather than a
  // relocated one: the layout module is pure, so two instances are
  // independent, and moving a live canvas between containers is the kind of
  // thing that works until it doesn't.
  const modal = document.getElementById("graph-modal");
  const modalCanvas = document.getElementById("pane-graph-full");
  let modalGraphPromise = null;

  const openModal = async () => {
    if (!modal || !modalCanvas || modal.open) return;
    modal.showModal();
    const pageId = pane.dataset.page;
    if (!pageId) return;
    modalGraphPromise ??= import("/assets/pane-graph.mjs").then((m) =>
      m.mountPaneGraph(
        modalCanvas,
        pageId,
        document.getElementById("pane-graph-full-legend"),
      ),
    );
    // The canvas only has a size once the dialog is open.
    (await modalGraphPromise)?.show();
  };

  document
    .getElementById("graph-expand")
    ?.addEventListener("click", () => void openModal());
  document
    .getElementById("graph-modal-close")
    ?.addEventListener("click", () => modal?.close());
  // Click outside the content closes it — <dialog> reports backdrop clicks
  // as clicks on the dialog element itself.
  modal?.addEventListener("click", (ev) => {
    if (ev.target === modal) modal.close();
  });

  // #graph opens the graph tab directly and #graph-full opens the enlarged
  // view, so both are linkable — and so a headless browser can screenshot
  // them without synthesising a click.
  const fromHash = () => {
    if (location.hash === "#graph-full") {
      const tab = tabs.find((t) => t.id === "tab-graph");
      if (tab) void select(tab).then(openModal);
      return;
    }
    const wanted = location.hash === "#graph" ? "tab-graph" : null;
    const tab = wanted && tabs.find((t) => t.id === wanted);
    if (tab) void select(tab);
  };
  addEventListener("hashchange", fromHash);
  fromHash();

  for (const tab of tabs) {
    tab.addEventListener("click", () => void select(tab));
    tab.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const i = tabs.indexOf(tab);
      const next =
        tabs[
          (i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
        ];
      next.focus();
      void select(next);
    });
  }
}

let active = -1;
let items = [];

function hide() {
  resultsBox.hidden = true;
  active = -1;
  items = [];
}

function show(hits) {
  resultsBox.innerHTML = "";
  items = hits.map((hit) => {
    const a = document.createElement("a");
    a.href = `/page/${hit.id}`;
    const title = document.createElement("span");
    title.textContent = hit.title;
    const id = document.createElement("span");
    id.className = "id";
    id.textContent = hit.id;
    a.append(title, id);
    resultsBox.append(a);
    return a;
  });
  resultsBox.hidden = items.length === 0;
  active = -1;
}

let timer = null;
input?.addEventListener("input", () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (q === "") {
    hide();
    return;
  }
  timer = setTimeout(async () => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    show(await res.json());
  }, 120);
});

input?.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    hide();
    input.blur();
    return;
  }
  if (items.length === 0) return;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    items[active]?.classList.remove("active");
    active =
      ev.key === "ArrowDown"
        ? (active + 1) % items.length
        : (active - 1 + items.length) % items.length;
    items[active].classList.add("active");
    items[active].scrollIntoView({ block: "nearest" });
  } else if (ev.key === "Enter" && active >= 0) {
    ev.preventDefault();
    location.href = items[active].href;
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "/" && document.activeElement !== input) {
    ev.preventDefault();
    input?.focus();
    input?.select();
  }
  // "f" enlarges the graph, matching the corpus graph's refit shortcut in
  // spirit: a one-key way to get more room.
  if (ev.key === "f" && document.activeElement !== input) {
    const panel = document.getElementById("panel-graph");
    if (panel && !panel.hidden)
      document.getElementById("graph-expand")?.click();
  }
});

document.addEventListener("click", (ev) => {
  if (!resultsBox?.contains(ev.target) && ev.target !== input) hide();
});
